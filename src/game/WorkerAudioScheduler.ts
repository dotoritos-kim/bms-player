/**
 * WorkerAudioScheduler - Main Thread wrapper for Editor/Preview.
 *
 * Communicates with AudioSchedulerWorker to provide gapless audio scheduling even in the background.
 * Replaces the rAF-based schedulers of the Editor playbackLoop and useBmsPreview.
 *
 * Timing: every play/resume/seek/speed change anchors chart time to the
 * AudioContext clock. Notes are placed at `anchorCtxTime + (sec - anchorSec) / speed`,
 * so message latency between the worker and the main thread (or a busy main
 * thread) no longer shifts sounds; a note that still arrives late is started
 * with the elapsed part skipped (worklet `catchUp`) to stay on the beat.
 */

import type { AudioPreloader } from '../audio/loader/AudioPreloader';
import type {
  SchedulerMainToWorker,
  SchedulerWorkerToMain,
  SchedulerNote,
} from './AudioSchedulerWorker';

export interface WorkerAudioSchedulerConfig {
  worker: Worker;
  preloader: AudioPreloader;
  notes: SchedulerNote[];
  /**
   * Re-triggering a keysound cuts its previous voice (BMS behaviour; default true).
   * Prevents identical samples stacking up into phasing/clipping on dense charts.
   */
  chokeSameKeysound?: boolean;
}

export type SchedulerTickCallback = (currentSec: number) => void;
export type SchedulerEndCallback = () => void;

/** Lead time between an anchor and the first audible sample. */
const START_DELAY_SEC = 0.05;

export class WorkerAudioScheduler {
  private worker: Worker;
  private preloader: AudioPreloader;
  private notes: SchedulerNote[];
  private readonly choke: boolean;
  /** Chart time at which playback ends: when the longest sample has rung out. */
  readonly endSec: number | undefined;
  private _isPlaying: boolean = false;
  private onTick: SchedulerTickCallback | null = null;
  private onEnd: SchedulerEndCallback | null = null;

  // Chart time ↔ AudioContext time anchor
  private anchorSec = 0;
  private anchorCtxTime = 0;
  private speed = 1;

  /** Longest buffer among the scheduled keysounds (bounds the catch-up scan). */
  private maxDuration = -1;

  // rAF for UI updates (rendering only, not audio scheduling)
  private rafId: number = 0;

  constructor(config: WorkerAudioSchedulerConfig) {
    this.worker = config.worker;
    this.preloader = config.preloader;
    this.notes = config.notes.slice().sort((a, b) => a.sec - b.sec);
    this.choke = config.chokeSameKeysound ?? true;
    this.endSec = this.computeEndSec();

    this.worker.onmessage = this.handleWorkerMessage;

    // Send notes to worker; playback ends once the longest sample has rung out
    this.postToWorker({
      type: 'init',
      payload: { notes: this.notes, endSec: this.endSec },
    });
  }

  // ==================== Public API ====================

  play(startSec: number, speed: number): void {
    this._isPlaying = true;
    this.setAnchor(startSec, speed);
    // Starting mid-song: sounds that began earlier are still ringing.
    this.playCatchUpNotes(startSec);
    this.postToWorker({
      type: 'play',
      payload: { startSec, speed },
    });
  }

  pause(): void {
    this._isPlaying = false;
    this.postToWorker({ type: 'pause' });
  }

  resume(resumeSec: number, speed: number): void {
    this._isPlaying = true;
    this.setAnchor(resumeSec, speed);
    // Catch-up: replay keysounds that were playing before the pause, with an offset applied
    this.playCatchUpNotes(resumeSec);
    this.postToWorker({
      type: 'resume',
      payload: { resumeSec, speed },
    });
  }

  stop(): void {
    this._isPlaying = false;
    this.postToWorker({ type: 'stop' });
    this.preloader.stopAllAudio();
  }

  seek(seekSec: number, speed: number): void {
    this.preloader.stopAllAudio();
    this.setAnchor(seekSec, speed);

    // Catch-up: play keysounds that started before seekSec but are still audible
    if (this._isPlaying) this.playCatchUpNotes(seekSec);

    this.postToWorker({
      type: 'seek',
      payload: { seekSec, speed },
    });
  }

  setSpeed(speed: number): void {
    if (this._isPlaying) {
      const now = this.currentSec();
      this.setAnchor(now, speed);
      // Already-queued voices were placed with the old speed; re-place them.
      this.preloader.stopAllAudio();
      this.playCatchUpNotes(now);
    } else {
      this.speed = speed;
    }
    this.postToWorker({
      type: 'setSpeed',
      payload: { speed },
    });
  }

  setOnTick(cb: SchedulerTickCallback | null): void {
    this.onTick = cb;
  }

  setOnEnd(cb: SchedulerEndCallback | null): void {
    this.onEnd = cb;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Current chart time derived from the audio clock (what is being heard). */
  currentSec(): number {
    const ctx = this.preloader.context;
    if (!ctx) return this.anchorSec;
    const elapsed = Math.max(0, ctx.currentTime - this.anchorCtxTime);
    return this.anchorSec + elapsed * this.speed;
  }

  dispose(): void {
    this._isPlaying = false;
    cancelAnimationFrame(this.rafId);
    this.postToWorker({ type: 'dispose' });
    this.worker.terminate();
  }

  // ==================== Internal ====================

  private setAnchor(sec: number, speed: number): void {
    const ctx = this.preloader.context;
    this.anchorSec = sec;
    this.speed = speed > 0 ? speed : 1;
    this.anchorCtxTime = (ctx?.currentTime ?? 0) + START_DELAY_SEC;
  }

  /** AudioContext time at which chart time `sec` is heard. */
  private ctxTimeFor(sec: number): number {
    return this.anchorCtxTime + (sec - this.anchorSec) / this.speed;
  }

  /** Last moment any scheduled keysound is still audible (+0.5 s), or undefined without notes. */
  private computeEndSec(): number | undefined {
    if (this.notes.length === 0) return undefined;
    let end = this.notes[this.notes.length - 1].sec + 2;
    for (const n of this.notes) {
      const d = this.preloader.getAudioDuration(n.keysound) - n.offset;
      if (d > 0 && n.sec + d + 0.5 > end) end = n.sec + d + 0.5;
    }
    return end;
  }

  private getMaxDuration(): number {
    if (this.maxDuration >= 0) return this.maxDuration;
    let max = 0;
    const seen = new Set<string>();
    for (const n of this.notes) {
      if (seen.has(n.keysound)) continue;
      seen.add(n.keysound);
      const d = this.preloader.getAudioDuration(n.keysound);
      if (d > max) max = d;
    }
    this.maxDuration = max;
    return max;
  }

  /**
   * Starts, at the anchor, the keysounds that began before `targetSec` and are
   * still ringing, skipping the part already elapsed. Only the latest note per
   * keysound is restarted when choking is on (an earlier one would have been cut).
   */
  private playCatchUpNotes(targetSec: number): void {
    const window = this.getMaxDuration();
    if (window <= 0) return;

    // Binary search: find first note index at or after targetSec
    let lo = 0, hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].sec < targetSec) lo = mid + 1;
      else hi = mid;
    }

    const when = this.anchorCtxTime;
    const restarted = new Set<string>();
    const pending: SchedulerNote[] = [];
    for (let i = lo - 1; i >= 0; i--) {
      const note = this.notes[i];
      if (targetSec - note.sec > window) break;
      if (this.choke) {
        if (restarted.has(note.keysound)) continue;
        restarted.add(note.keysound);
      }
      const duration = this.preloader.getAudioDuration(note.keysound);
      if (duration <= 0) continue;
      const offset = note.offset + (targetSec - note.sec);
      if (offset >= duration) continue;
      pending.push({ ...note, offset });
    }
    // Oldest first so choke-group order matches the chart.
    for (let i = pending.length - 1; i >= 0; i--) {
      const n = pending[i];
      this.preloader.playAudioSync(n.keysound, false, true, n.offset, when, n.volume, {
        chokeGroup: this.choke ? n.keysound : undefined,
        catchUp: true,
      });
    }
  }

  // ==================== Worker Message Handler ====================

  private handleWorkerMessage = (e: MessageEvent<SchedulerWorkerToMain>): void => {
    const msg = e.data;

    switch (msg.type) {
      case 'playSound': {
        if (!this._isPlaying) break;
        const { keysound, offset, delaySec, volume, sec } = msg.payload;
        const ctx = this.preloader.context;
        if (!ctx || ctx.state === 'closed' || ctx.state === 'suspended') break;

        const scheduledTime = typeof sec === 'number'
          ? this.ctxTimeFor(sec)
          : ctx.currentTime + Math.max(0, delaySec);

        this.preloader.playAudioSync(keysound, false, true, offset, scheduledTime, volume, {
          chokeGroup: this.choke ? keysound : undefined,
          catchUp: true,
        });
        break;
      }

      case 'tick':
        // Report what is audible (audio clock), not the worker's own clock.
        this.onTick?.(this._isPlaying ? this.currentSec() : msg.payload.currentSec);
        break;

      case 'ended':
        this._isPlaying = false;
        this.onEnd?.();
        break;

      case 'ready':
        // Worker initialized
        break;
    }
  };

  private postToWorker(msg: SchedulerMainToWorker): void {
    this.worker.postMessage(msg);
  }
}

export default WorkerAudioScheduler;
