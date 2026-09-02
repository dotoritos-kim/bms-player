/**
 * WorkerGameLoop - Main Thread side Worker wrapper.
 *
 * Provides the same API as GameLoop, but game logic runs in the Worker.
 * Key input → keysound plays immediately via the nextNotes cache (0ms added latency).
 * Receives judgment/state updates from the Worker and forwards them via callbacks.
 */

import type { Notechart } from '../audio/judgements';
import type { KeysoundPlayer } from '../types/KeysoundPlayer';
import {
  type GamePhase,
  PHASE_READY,
  PHASE_PLAYING,
  PHASE_PAUSED,
  PHASE_COMPLETED,
  PHASE_FAILED,
  gamePhaseToFlags,
} from '../types/GamePhase';
import type { KeyColumn } from './InputHandler';
import { InputHandler } from './InputHandler';
import type { GameLoopState, GameLoopCallbacks } from './GameLoop';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  SerializedNotechart,
  SerializedGameState,
  NextNotePayload,
} from './workerProtocol';
import type { GaugeType } from './GaugeSystem';

export interface WorkerGameLoopConfig {
  notechart: Notechart;
  keysoundPlayer: KeysoundPlayer;
  audioContext: AudioContext;
  worker: Worker;
  gaugeType?: GaugeType;
  total?: number;
  rank?: number;
  defexrank?: number;
  inputHandler?: InputHandler;
  startOffset?: number;
  playbackRate?: number;
  audioLatency?: number;
  judgmentOffset?: number;
  visualOffset?: number;
  autoplay?: boolean;
}

export class WorkerGameLoop {
  private worker: Worker;
  private keysoundPlayer: KeysoundPlayer;
  private audioContext: AudioContext;
  private inputHandler: InputHandler;
  /** True when this loop created its InputHandler (and therefore owns its lifecycle). */
  private readonly ownsInputHandler: boolean;
  private callbacks: GameLoopCallbacks;
  private playbackRate: number;
  private startOffset: number;

  // State (Stage 3 — discriminated union; the legacy 4 booleans are derived getters)
  private _phase: GamePhase = PHASE_READY;
  private _lastState: GameLoopState | null = null;

  // NextNotes cache for 0ms keysound playback
  private nextNotesCache: Map<string, NextNotePayload> = new Map();

  // Timing for getCurrentTime() on Main Thread
  private contextStartTime: number = 0;
  private pauseTime: number = 0;
  private firstTickDone: boolean = false;

  // Ready promise
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;

  constructor(config: WorkerGameLoopConfig, callbacks: GameLoopCallbacks = {}) {
    this.worker = config.worker;
    this.keysoundPlayer = config.keysoundPlayer;
    this.audioContext = config.audioContext;
    this.callbacks = callbacks;
    this.playbackRate = Math.max(0.1, Math.min(4, config.playbackRate ?? 1));
    this.startOffset = config.startOffset ?? 0;

    // Input handler
    this.ownsInputHandler = !config.inputHandler;
    this.inputHandler = config.inputHandler ?? new InputHandler();
    this.inputHandler.onKeyDown(this.handleKeyDown);
    this.inputHandler.onKeyUp(this.handleKeyUp);

    // Ready promise
    this.readyPromise = new Promise(resolve => {
      this.readyResolve = resolve;
    });

    // Worker message handler
    this.worker.onmessage = this.handleWorkerMessage;
    this.worker.onerror = (err) => {
      console.error('[WorkerGameLoop] Worker error:', err);
    };

    // Serialize notechart and send init
    const serialized = this.serializeNotechart(config.notechart);
    this.postToWorker({
      type: 'init',
      payload: {
        notechart: serialized,
        config: {
          gaugeType: config.gaugeType,
          total: config.total,
          rank: config.rank,
          defexrank: config.defexrank,
          startOffset: config.startOffset,
          playbackRate: config.playbackRate,
          audioLatency: config.audioLatency,
          judgmentOffset: config.judgmentOffset,
          visualOffset: config.visualOffset,
          autoplay: config.autoplay,
        },
      },
    });
  }

  // ==================== Notechart Serialization ====================

  private serializeNotechart(notechart: Notechart): SerializedNotechart {
    // Build beat→seconds lookup table at fine resolution
    const table: Array<{ beat: number; seconds: number }> = [];
    const duration = notechart.duration;
    const maxBeat = notechart.secondsToBeat(duration) + 4; // extra buffer

    // Sample at every 0.25 beats for good interpolation accuracy
    const step = 0.25;
    for (let beat = 0; beat <= maxBeat; beat += step) {
      table.push({ beat, seconds: notechart.beatToSeconds(beat) });
    }
    // Ensure last point
    table.push({ beat: maxBeat, seconds: notechart.beatToSeconds(maxBeat) });

    return {
      notes: notechart.notes ?? [],
      autos: notechart.autos ?? [],
      landmines: notechart.landmines ?? [],
      beatToSecondsTable: table,
      duration,
    };
  }

  // ==================== Lifecycle ====================

  async start(): Promise<void> {
    if (this._phase.kind === 'playing' || this._phase.kind === 'paused') return;

    // Wait for worker to be ready
    await this.readyPromise;

    // Resume AudioContext if needed
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.warn('WorkerGameLoop: Failed to resume AudioContext:', e);
      }
    }

    if (this.audioContext.state === 'closed') {
      console.error('WorkerGameLoop: AudioContext is closed, cannot start');
      return;
    }

    this._phase = PHASE_PLAYING;
    this.contextStartTime = this.audioContext.currentTime;
    this.firstTickDone = false;

    this.inputHandler.setEnabled(true);
    this.postToWorker({ type: 'start' });
  }

  pause(): void {
    if (this._phase.kind !== 'playing') return;
    this._phase = PHASE_PAUSED;
    this.pauseTime = this.getCurrentTime();
    this.inputHandler.setEnabled(false);
    this.keysoundPlayer.stopAll();
    this.postToWorker({ type: 'pause' });
    this.emitPhaseState();
  }

  resume(): void {
    if (this._phase.kind !== 'paused') return;
    this._phase = PHASE_PLAYING;
    const pauseDuration = (this.audioContext.currentTime * 1000) -
      (this.contextStartTime * 1000 + this.pauseTime);
    this.contextStartTime += pauseDuration / 1000;
    this.inputHandler.setEnabled(true);
    this.postToWorker({ type: 'resume' });
    this.emitPhaseState();
  }

  stop(): void {
    const wasActive = this._phase.kind !== 'ready';
    this._phase = PHASE_READY;
    this.inputHandler.setEnabled(false);
    this.keysoundPlayer.stopAll();
    this.postToWorker({ type: 'stop' });
    if (wasActive) this.emitPhaseState();
  }

  dispose(): void {
    this.stop();
    // The InputHandler and the Worker are injected by the caller, which owns
    // their lifecycle: useGamePlayer reuses both across restarts, so
    // terminating the worker here would make every RETRY hang on `init`.
    if (this.ownsInputHandler) {
      this.inputHandler.dispose();
    } else {
      this.inputHandler.setEnabled(false);
    }
    this.postToWorker({ type: 'dispose' });
    this.worker.onmessage = null;
    this.worker.onerror = null;
  }

  /**
   * The worker only emits `update` while ticking, so phase transitions made
   * on the main thread (pause/resume/stop) must be pushed to consumers here.
   */
  private emitPhaseState(): void {
    const flags = gamePhaseToFlags(this._phase);
    const base: GameLoopState = this._lastState ?? {
      phase: this._phase,
      isPlaying: false, isPaused: false, isFailed: false, isCompleted: false,
      currentTime: 0, visualTime: 0, currentBeat: 0, combo: 0, gaugeValue: 0, exScore: 0,
      lastJudgment: null, lastOffset: 0, activeHoldNoteIds: new Set<number>(),
      pgreatCount: 0, greatCount: 0, goodCount: 0, badCount: 0, poorCount: 0, missCount: 0,
      maxCombo: 0, recentOffsets: [],
    };
    const currentTime = this._phase.kind === 'ready' ? 0 : this.getCurrentTime();
    this._lastState = {
      ...base,
      phase: this._phase,
      isPlaying: flags.isPlaying,
      isPaused: flags.isPaused,
      isFailed: flags.isFailed,
      isCompleted: flags.isCompleted,
      currentTime,
      visualTime: this._phase.kind === 'ready' ? 0 : base.visualTime,
      currentBeat: this._phase.kind === 'ready' ? 0 : base.currentBeat,
      activeHoldNoteIds: this._phase.kind === 'ready' ? new Set<number>() : base.activeHoldNoteIds,
    };
    this.callbacks.onUpdate?.(this._lastState);
  }

  // ==================== State ====================

  getCurrentTime(): number {
    if (this._phase.kind !== 'playing' && this._phase.kind !== 'paused') return 0;
    if (this._phase.kind === 'paused') return this.pauseTime;
    const elapsed = (this.audioContext.currentTime - this.contextStartTime) * 1000;
    return (elapsed + this.startOffset) * this.playbackRate;
  }

  getState(): GameLoopState | null {
    return this._lastState;
  }

  /** Stage 3 — exposes the discriminated union as the primary API. */
  get phase(): GamePhase { return this._phase; }
  /** @deprecated Prefer `phase.kind === 'playing' || phase.kind === 'paused'`. */
  get isPlaying(): boolean {
    return this._phase.kind === 'playing' || this._phase.kind === 'paused';
  }
  /** @deprecated Prefer `phase.kind === 'paused'`. */
  get isPaused(): boolean { return this._phase.kind === 'paused'; }
  /** @deprecated Prefer `phase.kind === 'completed'`. */
  get isCompleted(): boolean { return this._phase.kind === 'completed'; }
  /** @deprecated Prefer `phase.kind === 'failed'`. */
  get isFailed(): boolean { return this._phase.kind === 'failed'; }

  // ==================== Key Input (Main Thread) ====================

  private handleKeyDown = (input: { column: KeyColumn }): void => {
    if (this._phase.kind !== 'playing') return;

    const { column } = input;

    // Callback
    this.callbacks.onKeyInput?.(column, true);

    // 0ms keysound: play from nextNotes cache immediately
    const nextNote = this.nextNotesCache.get(column);
    if (nextNote) {
      this.keysoundPlayer.play(nextNote.keysound, nextNote.offset, 0, nextNote.volume);
    }

    // Forward to Worker for judgment (async)
    // Absolute (epoch) timestamp: worker and window have different
    // performance.now() origins, so the worker converts this to game time.
    this.postToWorker({
      type: 'keyDown',
      payload: { column, time: performance.timeOrigin + performance.now() },
    });
  };

  private handleKeyUp = (input: { column: KeyColumn }): void => {
    if (this._phase.kind !== 'playing') return;

    const { column } = input;
    this.callbacks.onKeyInput?.(column, false);

    this.postToWorker({
      type: 'keyUp',
      payload: { column, time: performance.timeOrigin + performance.now() },
    });
  };

  // ==================== Worker Message Handler ====================

  private handleWorkerMessage = (e: MessageEvent<WorkerToMainMessage>): void => {
    const msg = e.data;

    switch (msg.type) {
      case 'ready':
        this.readyResolve?.();
        this.readyResolve = null;
        break;

      case 'playSound': {
        const { keysound, offset, gameTimeMs, volume } = msg.payload;
        let scheduledTime = 0;

        if (gameTimeMs > 0) {
          // Convert game time to absolute AudioContext time (same formula as original GameLoop)
          // Original: targetContextTime = contextStartTime + (gameTimeMs / playbackRate - startOffset) / 1000
          scheduledTime = this.contextStartTime +
            (gameTimeMs / this.playbackRate - this.startOffset) / 1000;
        }

        this.keysoundPlayer.play(keysound, offset, scheduledTime, volume);
        break;
      }

      case 'stopAll':
        this.keysoundPlayer.stopAll();
        break;

      case 'update':
        this._lastState = this.deserializeState(msg.payload);
        this.callbacks.onUpdate?.(this._lastState);
        break;

      case 'judgment':
        this.callbacks.onJudgment?.(msg.payload);
        break;

      case 'landmine':
        this.callbacks.onLandmineTrigger?.(msg.payload);
        break;

      case 'keyInput':
        // Autoplay visual feedback - already handled by callbacks in tick
        break;

      case 'nextNotes':
        this.nextNotesCache.clear();
        for (const [col, info] of Object.entries(msg.payload)) {
          this.nextNotesCache.set(col, info);
        }
        break;

      case 'complete':
        this._phase = PHASE_COMPLETED;
        this.inputHandler.setEnabled(false);
        this.callbacks.onComplete?.(msg.payload);
        break;

      case 'failed':
        this._phase = PHASE_FAILED;
        this.inputHandler.setEnabled(false);
        this.keysoundPlayer.stopAll();
        this.callbacks.onFailed?.(msg.payload);
        break;

      case 'error':
        console.error('[WorkerGameLoop] Worker error:', msg.payload.message);
        break;
    }
  };

  private deserializeState(serialized: SerializedGameState): GameLoopState {
    return {
      ...serialized,
      activeHoldNoteIds: new Set(serialized.activeHoldNoteIds),
    };
  }

  // ==================== Worker Communication ====================

  private postToWorker(msg: MainToWorkerMessage): void {
    this.worker.postMessage(msg);
  }
}

export default WorkerGameLoop;
