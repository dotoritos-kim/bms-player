/**
 * WorkerAudioScheduler - Main Thread wrapper for Editor/Preview.
 *
 * Communicates with AudioSchedulerWorker to provide gapless audio scheduling even in the background.
 * Replaces the rAF-based schedulers of the Editor playbackLoop and useBmsPreview.
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
}

export type SchedulerTickCallback = (currentSec: number) => void;
export type SchedulerEndCallback = () => void;

export class WorkerAudioScheduler {
  private worker: Worker;
  private preloader: AudioPreloader;
  private notes: SchedulerNote[];
  private _isPlaying: boolean = false;
  private onTick: SchedulerTickCallback | null = null;
  private onEnd: SchedulerEndCallback | null = null;

  // Start position of the current playback session (limits the catch-up range)
  private sessionStartSec: number = 0;

  // rAF for UI updates (rendering only, not audio scheduling)
  private rafId: number = 0;

  constructor(config: WorkerAudioSchedulerConfig) {
    this.worker = config.worker;
    this.preloader = config.preloader;
    this.notes = config.notes;

    this.worker.onmessage = this.handleWorkerMessage;

    // Send notes to worker
    this.postToWorker({
      type: 'init',
      payload: { notes: config.notes },
    });
  }

  // ==================== Public API ====================

  play(startSec: number, speed: number): void {
    this._isPlaying = true;
    this.sessionStartSec = startSec;
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
    this.sessionStartSec = seekSec;

    // Catch-up: play keysounds that started before seekSec but are still audible
    this.playCatchUpNotes(seekSec);

    this.postToWorker({
      type: 'seek',
      payload: { seekSec, speed },
    });
  }

  /**
   * Plays keysounds that should already be playing at the current point, with an offset applied.
   * Only targets notes that started after sessionStartSec (i.e. ones that were actually played).
   */
  private playCatchUpNotes(targetSec: number): void {
    // Binary search: find first note index at or after targetSec
    let lo = 0, hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].sec < targetSec) lo = mid + 1;
      else hi = mid;
    }
    // Walk backwards from lo-1 (notes before targetSec) checking if still audible
    for (let i = lo - 1; i >= 0; i--) {
      const note = this.notes[i];
      // Skip notes that were never played in this session
      if (note.sec < this.sessionStartSec) break;

      const duration = this.preloader.getAudioDuration(note.keysound);
      if (duration <= 0) continue;

      const offset = targetSec - note.sec;
      if (offset >= duration) continue;

      this.preloader.playAudioSync(
        note.keysound, false, true, offset, 0, note.volume,
      );
    }
  }

  setSpeed(speed: number): void {
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

  dispose(): void {
    this._isPlaying = false;
    cancelAnimationFrame(this.rafId);
    this.postToWorker({ type: 'dispose' });
    this.worker.terminate();
  }

  // ==================== Worker Message Handler ====================

  private handleWorkerMessage = (e: MessageEvent<SchedulerWorkerToMain>): void => {
    const msg = e.data;

    switch (msg.type) {
      case 'playSound': {
        const { keysound, offset, delaySec, volume } = msg.payload;
        const ctx = this.preloader.context;
        if (!ctx || ctx.state === 'closed' || ctx.state === 'suspended') break;

        const scheduledTime = delaySec > 0
          ? ctx.currentTime + delaySec
          : 0;

        this.preloader.playAudioSync(keysound, false, true, offset, scheduledTime, volume);
        break;
      }

      case 'tick':
        this.onTick?.(msg.payload.currentSec);
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

  // ==================== Internal ====================

  private postToWorker(msg: SchedulerMainToWorker): void {
    this.worker.postMessage(msg);
  }
}

export default WorkerAudioScheduler;
