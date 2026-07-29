/**
 * BMS game loop — rAF-based Main Thread execution environment.
 *
 * Synchronization strategy:
 * 1. Use AudioContext.currentTime as the master clock.
 * 2. Record contextStartTime when the game starts.
 * 3. All game time = (AudioContext.currentTime - contextStartTime) * 1000.
 * 4. Render via requestAnimationFrame; input is event driven.
 *
 * S7 (REFACTOR-PLAN): game logic delegated to GameEngine (H2 dedup).
 * GameLoop now focuses solely on timing, input, rAF scheduling, and side-effect execution.
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
import { InputHandler, type KeyInput, type KeyColumn } from './InputHandler';
import { type GaugeType } from './GaugeSystem';
import { type ScoreState } from './ScoreManager';
import { type Judgment } from './JudgmentEngine';
import { GameEngine, type GameEngineConfig } from './GameEngine';

// ── Re-export types so callers don't break ─────────────────────────────────

export interface GameLoopConfig {
  /** Notechart */
  notechart: Notechart;
  /** Keysound player */
  keysoundPlayer: KeysoundPlayer;
  /** Audio context (for synchronization) */
  audioContext: AudioContext;
  /** Gauge type */
  gaugeType?: GaugeType;
  /** TOTAL value (#TOTAL) */
  total?: number;
  /** Judgment RANK (#RANK) */
  rank?: number;
  /** Custom judgment (#DEFEXRANK) */
  defexrank?: number;
  /** Input handler (can be injected externally) */
  inputHandler?: InputHandler;
  /** Start offset (ms) */
  startOffset?: number;
  /** Playback rate */
  playbackRate?: number;
  /** Audio latency compensation (ms) - positive: audio is heard late, so play audio earlier */
  audioLatency?: number;
  /** Judgment latency compensation (ms) - positive: process judgments later */
  judgmentOffset?: number;
  /** Visual latency compensation (ms) - positive: display notes earlier */
  visualOffset?: number;
  /** Autoplay mode */
  autoplay?: boolean;
}

export interface GameLoopState {
  /**
   * Unified game state (Stage 3, REFACTOR-PLAN §6.2). New consumers should
   * prefer this field. The legacy 4 booleans (`isPlaying`/`isPaused`/`isFailed`/
   * `isCompleted`) are kept for compatibility and derived from `phase`
   * (`gamePhaseToFlags`).
   */
  phase: GamePhase;
  /** @deprecated Prefer `phase.kind`. Derived from `phase` (`playing`/`paused`). */
  isPlaying: boolean;
  /** @deprecated Prefer `phase.kind === 'paused'`. */
  isPaused: boolean;
  /** @deprecated Prefer `phase.kind === 'failed'`. */
  isFailed: boolean;
  /** @deprecated Prefer `phase.kind === 'completed'`. */
  isCompleted: boolean;
  /** Current game time (ms) */
  currentTime: number;
  /** Rendering time (visual offset applied, ms) */
  visualTime: number;
  /** Current beat */
  currentBeat: number;
  /** Current combo */
  combo: number;
  /** Gauge value (%) */
  gaugeValue: number;
  /** EX score */
  exScore: number;
  /** Last judgment */
  lastJudgment: Judgment | null;
  /** Last judgment offset (ms) */
  lastOffset: number;
  /** IDs of long notes currently being held */
  activeHoldNoteIds: Set<number>;
  /** Judgment counts */
  pgreatCount: number;
  greatCount: number;
  goodCount: number;
  badCount: number;
  poorCount: number;
  missCount: number;
  /** Max combo */
  maxCombo: number;
  /** Recent timing offset history (for the Early/Late display) */
  recentOffsets: number[];
}

export interface JudgmentEvent {
  noteId: number;
  column: KeyColumn;
  judgment: Judgment;
  offset: number;
  time: number;
}

export interface LandmineEvent {
  mineId: number;
  column: KeyColumn;
  damage: number;
  time: number;
}

export interface GameLoopCallbacks {
  /** State update (every frame) */
  onUpdate?: (state: GameLoopState) => void;
  /** When a judgment occurs */
  onJudgment?: (event: JudgmentEvent) => void;
  /** When a landmine note is triggered */
  onLandmineTrigger?: (event: LandmineEvent) => void;
  /** When the game completes */
  onComplete?: (score: ScoreState) => void;
  /** When the game fails */
  onFailed?: (score: ScoreState) => void;
  /** On key input */
  onKeyInput?: (column: KeyColumn, held: boolean) => void;
}

// ── GameLoop ────────────────────────────────────────────────────────────────

export class GameLoop {
  // S7: all game logic is delegated to GameEngine
  private readonly engine: GameEngine;

  private readonly keysoundPlayer: KeysoundPlayer;
  private readonly audioContext: AudioContext;
  private readonly inputHandler: InputHandler;
  private readonly callbacks: GameLoopCallbacks;

  // Timing (GameLoop specific: AudioContext-based clock)
  private contextStartTime: number = 0;
  private readonly startOffset: number;
  private readonly playbackRate: number;
  private pauseTime: number = 0;

  // State (phase is read via the engine, but GameLoop keeps its own phase cache too)
  private _phase: GamePhase = PHASE_READY;
  private animationFrameId: number = 0;
  private firstTickDone: boolean = false;

  // setTimeout handle for autoplay key-release simulation (M7)
  private autoplayReleaseTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(config: GameLoopConfig, callbacks: GameLoopCallbacks = {}) {
    if (!config.notechart) throw new Error('GameLoop: notechart is required');
    if (!config.keysoundPlayer) throw new Error('GameLoop: keysoundPlayer is required');
    if (!config.audioContext) throw new Error('GameLoop: audioContext is required');

    this.keysoundPlayer = config.keysoundPlayer;
    this.audioContext = config.audioContext;
    this.callbacks = callbacks;
    this.startOffset = config.startOffset ?? 0;
    this.playbackRate = Math.max(0.1, Math.min(4, config.playbackRate ?? 1));

    // Input handler
    this.inputHandler = config.inputHandler ?? new InputHandler();
    this.inputHandler.onKeyDown(this.handleKeyDown);
    this.inputHandler.onKeyUp(this.handleKeyUp);

    // S7: delegate all game logic to GameEngine
    const engineConfig: GameEngineConfig = {
      notechart: config.notechart,
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
    };
    this.engine = new GameEngine(engineConfig);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._phase.kind === 'playing' || this._phase.kind === 'paused') return;

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e: unknown) {
        console.warn('GameLoop: Failed to resume AudioContext:', e);
      }
    }

    if (this.audioContext.state === 'closed') {
      console.error('GameLoop: AudioContext is closed, cannot start');
      return;
    }

    this._phase = PHASE_PLAYING;
    this.engine.start();

    this.contextStartTime = this.audioContext.currentTime;
    this.pauseTime = 0;
    this.firstTickDone = false;

    this.inputHandler.setEnabled(true);
    this.tick();
  }

  pause(): void {
    if (this._phase.kind !== 'playing') return;

    this._phase = PHASE_PAUSED;
    this.engine.pause(this.getCurrentTime());
    this.pauseTime = this.getCurrentTime();
    this.inputHandler.setEnabled(false);
    cancelAnimationFrame(this.animationFrameId);
    this.keysoundPlayer.stopAll();
  }

  resume(): void {
    if (this._phase.kind !== 'paused') return;

    this._phase = PHASE_PLAYING;
    this.engine.resume();

    // Adjust the start time by the paused duration
    const pauseDuration = (this.audioContext.currentTime * 1000) -
      (this.contextStartTime * 1000 + this.pauseTime);
    this.contextStartTime += pauseDuration / 1000;

    this.inputHandler.setEnabled(true);
    this.tick();
  }

  stop(): void {
    this._phase = PHASE_READY;
    this.engine.stop();
    cancelAnimationFrame(this.animationFrameId);
    this.inputHandler.setEnabled(false);
    this.keysoundPlayer.stopAll();
    this.clearAutoplayTimers();
  }

  // ── Phase / derived getters (external API compatibility) ─────────────────

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

  // ── Timing ───────────────────────────────────────────────────────────────

  getCurrentTime(): number {
    if (this._phase.kind !== 'playing' && this._phase.kind !== 'paused') return 0;
    if (this._phase.kind === 'paused') return this.pauseTime;
    const elapsed = (this.audioContext.currentTime - this.contextStartTime) * 1000;
    return (elapsed + this.startOffset) * this.playbackRate;
  }

  // ── Public state ─────────────────────────────────────────────────────────

  getState(): GameLoopState {
    const currentTime = this.getCurrentTime();
    const engineState = this.engine.buildState(currentTime);
    const flags = gamePhaseToFlags(this._phase);
    return {
      phase: this._phase,
      isPlaying: flags.isPlaying,
      isPaused: flags.isPaused,
      isFailed: flags.isFailed,
      isCompleted: flags.isCompleted,
      currentTime,
      visualTime: engineState.visualTime,
      currentBeat: engineState.currentBeat,
      combo: engineState.combo,
      gaugeValue: engineState.gaugeValue,
      exScore: engineState.exScore,
      lastJudgment: engineState.lastJudgment,
      lastOffset: engineState.lastOffset,
      activeHoldNoteIds: engineState.activeHoldNoteIds,
      pgreatCount: engineState.pgreatCount,
      greatCount: engineState.greatCount,
      goodCount: engineState.goodCount,
      badCount: engineState.badCount,
      poorCount: engineState.poorCount,
      missCount: engineState.missCount,
      maxCombo: engineState.maxCombo,
      recentOffsets: engineState.recentOffsets,
    };
  }

  getScoreState(): ScoreState {
    return this.engine.getScoreState();
  }

  // ── Main tick ─────────────────────────────────────────────────────────────

  private tick = (): void => {
    if (this._phase.kind !== 'playing') return;

    // First frame: reset contextStartTime (prevents a timing jump)
    if (!this.firstTickDone) {
      this.contextStartTime = this.audioContext.currentTime;
      this.firstTickDone = true;
    }

    const currentTime = this.getCurrentTime();

    // Delegate the tick to GameEngine → receive commands
    const result = this.engine.tick(currentTime);

    // ── Execute side effects ────────────────────────────────────────────────

    // 1. Play sounds
    for (const cmd of result.sounds) {
      if (cmd.type === 'playSound') {
        let targetContextTime = 0;
        if (cmd.gameTimeMs > 0) {
          // Scheduled BGM: convert to absolute AudioContext time
          targetContextTime = this.contextStartTime +
            (cmd.gameTimeMs / this.playbackRate - this.startOffset) / 1000;
        }
        this.keysoundPlayer.play(cmd.keysound, cmd.offset, targetContextTime, cmd.volume);
      }
    }

    // 2. Judgment callbacks
    for (const ev of result.judgments) {
      this.callbacks.onJudgment?.(ev);
    }

    // 3. Landmine callbacks
    for (const ev of result.landmines) {
      this.callbacks.onLandmineTrigger?.(ev);
    }

    // 4. Key input callbacks (autoplay key-press)
    for (const ki of result.keyInputs) {
      this.callbacks.onKeyInput?.(ki.column, ki.held);
      // Autoplay: simulate a release shortly after the press
      if (ki.held) {
        const timer = setTimeout(() => {
          this.callbacks.onKeyInput?.(ki.column, false);
        }, 50);
        this.autoplayReleaseTimers.push(timer);
      }
    }

    // 5. State update
    if (result.state) {
      const flags = gamePhaseToFlags(this._phase);
      const loopState: GameLoopState = {
        phase: this._phase,
        isPlaying: flags.isPlaying,
        isPaused: flags.isPaused,
        isFailed: flags.isFailed,
        isCompleted: flags.isCompleted,
        currentTime,
        visualTime: result.state.visualTime,
        currentBeat: result.state.currentBeat,
        combo: result.state.combo,
        gaugeValue: result.state.gaugeValue,
        exScore: result.state.exScore,
        lastJudgment: result.state.lastJudgment,
        lastOffset: result.state.lastOffset,
        activeHoldNoteIds: result.state.activeHoldNoteIds,
        pgreatCount: result.state.pgreatCount,
        greatCount: result.state.greatCount,
        goodCount: result.state.goodCount,
        badCount: result.state.badCount,
        poorCount: result.state.poorCount,
        missCount: result.state.missCount,
        maxCombo: result.state.maxCombo,
        recentOffsets: result.state.recentOffsets,
      };
      this.callbacks.onUpdate?.(loopState);
    }

    // 6. Handle completion / failure
    if (result.completed) {
      this.handleComplete(result.completed, currentTime);
      return;
    }
    if (result.failed) {
      this.handleFailed(result.failed, currentTime);
      return;
    }

    // Schedule the next frame
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  // ── Input handlers ────────────────────────────────────────────────────────

  private handleKeyDown = (input: KeyInput): void => {
    const currentTime = this.getCurrentTime();
    const result = this.engine.handleKeyDown(input.column, currentTime);

    // Execute side effects
    for (const cmd of result.sounds) {
      if (cmd.type === 'playSound') {
        this.keysoundPlayer.play(cmd.keysound, cmd.offset, 0, cmd.volume);
      }
    }
    for (const ev of result.judgments) {
      this.callbacks.onJudgment?.(ev);
    }
    for (const ev of result.landmines) {
      this.callbacks.onLandmineTrigger?.(ev);
    }
    for (const ki of result.keyInputs) {
      this.callbacks.onKeyInput?.(ki.column, ki.held);
    }
  };

  private handleKeyUp = (input: KeyInput): void => {
    const currentTime = this.getCurrentTime();
    const result = this.engine.handleKeyUp(input.column, currentTime);

    for (const ev of result.judgments) {
      this.callbacks.onJudgment?.(ev);
    }
    for (const ki of result.keyInputs) {
      this.callbacks.onKeyInput?.(ki.column, ki.held);
    }
  };

  // ── Terminal states ───────────────────────────────────────────────────────

  private handleComplete(score: ScoreState, finalTime: number): void {
    this._phase = PHASE_COMPLETED;
    cancelAnimationFrame(this.animationFrameId);
    this.inputHandler.setEnabled(false);
    this.clearAutoplayTimers();

    // Deliver the final state
    const engineState = this.engine.buildState(finalTime);
    const flags = gamePhaseToFlags(this._phase);
    this.callbacks.onUpdate?.({
      phase: this._phase,
      isPlaying: flags.isPlaying,
      isPaused: flags.isPaused,
      isFailed: flags.isFailed,
      isCompleted: flags.isCompleted,
      currentTime: finalTime,
      visualTime: engineState.visualTime,
      currentBeat: engineState.currentBeat,
      combo: engineState.combo,
      gaugeValue: engineState.gaugeValue,
      exScore: engineState.exScore,
      lastJudgment: engineState.lastJudgment,
      lastOffset: engineState.lastOffset,
      activeHoldNoteIds: engineState.activeHoldNoteIds,
      pgreatCount: engineState.pgreatCount,
      greatCount: engineState.greatCount,
      goodCount: engineState.goodCount,
      badCount: engineState.badCount,
      poorCount: engineState.poorCount,
      missCount: engineState.missCount,
      maxCombo: engineState.maxCombo,
      recentOffsets: engineState.recentOffsets,
    });
    this.callbacks.onComplete?.(score);
  }

  private handleFailed(score: ScoreState, finalTime: number): void {
    this._phase = PHASE_FAILED;
    cancelAnimationFrame(this.animationFrameId);
    this.inputHandler.setEnabled(false);
    this.keysoundPlayer.stopAll();
    this.clearAutoplayTimers();

    const engineState = this.engine.buildState(finalTime);
    const flags = gamePhaseToFlags(this._phase);
    this.callbacks.onUpdate?.({
      phase: this._phase,
      isPlaying: flags.isPlaying,
      isPaused: flags.isPaused,
      isFailed: flags.isFailed,
      isCompleted: flags.isCompleted,
      currentTime: finalTime,
      visualTime: engineState.visualTime,
      currentBeat: engineState.currentBeat,
      combo: engineState.combo,
      gaugeValue: engineState.gaugeValue,
      exScore: engineState.exScore,
      lastJudgment: engineState.lastJudgment,
      lastOffset: engineState.lastOffset,
      activeHoldNoteIds: engineState.activeHoldNoteIds,
      pgreatCount: engineState.pgreatCount,
      greatCount: engineState.greatCount,
      goodCount: engineState.goodCount,
      badCount: engineState.badCount,
      poorCount: engineState.poorCount,
      missCount: engineState.missCount,
      maxCombo: engineState.maxCombo,
      recentOffsets: engineState.recentOffsets,
    });
    this.callbacks.onFailed?.(score);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private clearAutoplayTimers(): void {
    for (const t of this.autoplayReleaseTimers) {
      clearTimeout(t);
    }
    this.autoplayReleaseTimers = [];
  }

  dispose(): void {
    this.stop();
    this.inputHandler.dispose();
  }
}

export default GameLoop;
