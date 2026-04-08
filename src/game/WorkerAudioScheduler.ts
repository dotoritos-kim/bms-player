/**
 * WorkerAudioScheduler - Editor/Preview용 Main Thread 래퍼
 *
 * AudioSchedulerWorker와 통신하여 백그라운드에서도 끊김 없는 오디오 스케줄링 제공.
 * Editor playbackLoop과 useBmsPreview의 rAF 기반 스케줄러를 대체.
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

  // 이번 재생 세션의 시작 위치 (catch-up 범위 제한용)
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
    // Catch-up: 일시정지 전에 재생 중이던 키음을 offset 적용하여 재생
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
   * 현재 시점에 이미 재생 중이어야 하는 키음을 offset 적용하여 재생.
   * sessionStartSec 이후에 시작된 노트만 대상 (실제 재생된 적 있는 것만).
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
      // 이번 세션에서 재생된 적 없는 노트는 건너뜀
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
