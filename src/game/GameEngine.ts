/**
 * GameEngine - 순수 게임 로직 (환경 무관)
 *
 * GameLoop(Main Thread rAF)과 WorkerGameLoop(Worker) 모두에서 사용.
 * 사이드 이펙트 없이 커맨드를 반환하여 호출자가 실행.
 */

import type { INotechart, GameNote, SoundedEvent } from '../audio/judgements';
import {
  type GamePhase,
  PHASE_READY,
  PHASE_PLAYING,
  PHASE_PAUSED,
  PHASE_COMPLETED,
  PHASE_FAILED,
  gamePhaseToFlags,
} from '../types/GamePhase';
import { JudgmentEngine, type Judgment } from './JudgmentEngine';
import { GaugeSystem, type GaugeType } from './GaugeSystem';
import { ScoreManager, type ScoreState } from './ScoreManager';
import type { KeyColumn } from './InputHandler';

// ==================== Config & State Types ====================

export interface GameEngineConfig {
  notechart: INotechart;
  gaugeType?: GaugeType;
  total?: number;
  rank?: number;
  defexrank?: number;
  startOffset?: number;
  playbackRate?: number;
  audioLatency?: number;
  judgmentOffset?: number;
  visualOffset?: number;
  autoplay?: boolean;
}

export interface GameEngineState {
  /** 통합 게임 상태(Stage 3, REFACTOR-PLAN §6.2). 신규 컨슈머는 이 필드를 우선 사용. */
  phase: GamePhase;
  /** @deprecated `phase`로부터 derive. */
  isPlaying: boolean;
  /** @deprecated `phase.kind === 'paused'` 사용 권장. */
  isPaused: boolean;
  /** @deprecated `phase.kind === 'failed'` 사용 권장. */
  isFailed: boolean;
  /** @deprecated `phase.kind === 'completed'` 사용 권장. */
  isCompleted: boolean;
  currentTime: number;
  visualTime: number;
  currentBeat: number;
  combo: number;
  gaugeValue: number;
  exScore: number;
  lastJudgment: Judgment | null;
  lastOffset: number;
  activeHoldNoteIds: Set<number>;
  pgreatCount: number;
  greatCount: number;
  goodCount: number;
  badCount: number;
  poorCount: number;
  missCount: number;
  maxCombo: number;
  recentOffsets: number[];
}

// ==================== Command Types ====================

export interface PlaySoundCommand {
  type: 'playSound';
  keysound: string;
  offset: number;
  gameTimeMs: number;
  volume: number;
}

export interface StopAllCommand {
  type: 'stopAll';
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

export interface KeyInputEvent {
  column: KeyColumn;
  held: boolean;
}

export interface TickResult {
  sounds: PlaySoundCommand[];
  judgments: JudgmentEvent[];
  landmines: LandmineEvent[];
  keyInputs: KeyInputEvent[];
  state: GameEngineState | null;
  completed: ScoreState | null;
  failed: ScoreState | null;
  nextNotes: Map<string, { keysound: string; offset: number; volume: number }>;
}

// ==================== NextNotes Cache ====================

export interface NextNoteInfo {
  keysound: string;
  offset: number;
  volume: number;
}

// ==================== GameEngine ====================

export class GameEngine {
  private notechart: INotechart;
  private judgment: JudgmentEngine;
  private gauge: GaugeSystem;
  private score: ScoreManager;

  // Timing
  private startOffset: number;
  private playbackRate: number;
  private audioLatency: number;
  private judgmentOffset: number;
  private visualOffset: number;

  // State (Stage 3 — discriminated union; legacy 4-boolean은 derived getter)
  private _phase: GamePhase = PHASE_READY;

  // Note tracking
  private pendingNotes: GameNote[];
  private pendingLandmines: GameNote[];
  private activeHolds: Map<string, GameNote>; // KeyColumn → GameNote
  private autoIndex: number = 0;
  private sortedAutos: SoundedEvent[];

  // Autoplay
  private _autoplay: boolean;

  // Update throttling
  private lastUpdateTime: number = 0;
  private readonly UPDATE_INTERVAL = 4; // ~240fps

  // Recent offsets
  private recentOffsets: number[] = [];
  private recentOffsetsSnapshot: number[] = [];
  private recentOffsetsDirty = false;
  private readonly MAX_RECENT_OFFSETS = 50;

  // Held keys (for Worker mode where InputHandler isn't available)
  private heldKeys: Set<string> = new Set();

  constructor(config: GameEngineConfig) {
    if (!config.notechart) {
      throw new Error('GameEngine: notechart is required');
    }

    this.notechart = config.notechart;
    this.startOffset = config.startOffset ?? 0;
    this.playbackRate = Math.max(0.1, Math.min(4, config.playbackRate ?? 1));
    this.audioLatency = Math.max(-500, Math.min(500, config.audioLatency ?? 0));
    this.judgmentOffset = Math.max(-500, Math.min(500, config.judgmentOffset ?? 0));
    this.visualOffset = Math.max(-500, Math.min(500, config.visualOffset ?? 0));
    this._autoplay = config.autoplay ?? false;

    // Judgment engine
    this.judgment = new JudgmentEngine({
      rank: config.rank ?? 2,
      defexrank: config.defexrank,
      style: 'lr2',
    });

    // Notes
    const notes = this.notechart.notes ?? [];
    const autos = this.notechart.autos ?? [];

    const totalNotes = Math.max(1, notes.reduce((sum, note) => {
      return sum + (note.end ? 2 : 1);
    }, 0));

    // Gauge
    const total = Math.max(100, config.total ?? 200);
    this.gauge = new GaugeSystem(
      config.gaugeType ?? 'groove',
      total,
      totalNotes,
    );

    // Score
    this.score = new ScoreManager({ totalNotes });

    // Prepare notes
    this.pendingNotes = [...notes]
      .filter((note) => !isNaN(note.time) && isFinite(note.time))
      .sort((a, b) => a.time - b.time);
    this.activeHolds = new Map();

    // Landmines
    const landmines = this.notechart.landmines ?? [];
    this.pendingLandmines = [...landmines]
      .filter((mine) => !isNaN(mine.time) && isFinite(mine.time))
      .sort((a, b) => a.time - b.time);

    // Auto sounds
    this.sortedAutos = [...autos]
      .filter((auto) => !isNaN(auto.time) && isFinite(auto.time))
      .sort((a, b) => a.time - b.time);
  }

  // ==================== Lifecycle ====================

  start(): void {
    this._phase = PHASE_PLAYING;
    this.autoIndex = 0;
    this.lastUpdateTime = 0;
  }

  pause(_currentTime: number): void {
    if (this._phase.kind !== 'playing') return;
    this._phase = PHASE_PAUSED;
  }

  resume(): void {
    if (this._phase.kind !== 'paused') return;
    this._phase = PHASE_PLAYING;
  }

  stop(): void {
    this._phase = PHASE_READY;
  }

  /** Stage 3 — discriminated union 우선 노출. */
  get phase(): GamePhase { return this._phase; }
  /** @deprecated `phase.kind === 'playing' || phase.kind === 'paused'` 사용 권장. */
  get isPlaying(): boolean {
    return this._phase.kind === 'playing' || this._phase.kind === 'paused';
  }
  /** @deprecated `phase.kind === 'paused'` 사용 권장. */
  get isPaused(): boolean { return this._phase.kind === 'paused'; }
  /** @deprecated `phase.kind === 'completed'` 사용 권장. */
  get isCompleted(): boolean { return this._phase.kind === 'completed'; }
  /** @deprecated `phase.kind === 'failed'` 사용 권장. */
  get isFailed(): boolean { return this._phase.kind === 'failed'; }

  // ==================== Main Tick ====================

  /**
   * Process one game tick. Returns commands for the caller to execute.
   * @param currentTime Game time in ms
   */
  tick(currentTime: number): TickResult {
    const result: TickResult = {
      sounds: [],
      judgments: [],
      landmines: [],
      keyInputs: [],
      state: null,
      completed: null,
      failed: null,
      nextNotes: new Map(),
    };

    if (this._phase.kind !== 'playing') return result;

    // 1. Auto BGM sounds
    this.processAutoSounds(currentTime, result);

    // 2. Autoplay
    if (this._autoplay) {
      this.processAutoplayNotes(currentTime, result);
    }

    // 3. Miss check
    this.checkMissedNotes(currentTime, result);

    // 4. Long note holds
    this.checkActiveHolds(currentTime, result);

    // 5. Cleanup passed landmines
    this.cleanupPassedLandmines(currentTime);

    // 6. State update (throttled)
    if (currentTime - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      result.state = this.buildState(currentTime);
      this.lastUpdateTime = currentTime;
    }

    // 7. Build nextNotes for each column
    this.buildNextNotes(result);

    // 8. Completion check
    if (this.pendingNotes.length === 0 && this.activeHolds.size === 0) {
      if (this.autoIndex >= this.sortedAutos.length) {
        this._phase = PHASE_COMPLETED;
        result.state = this.buildState(currentTime);
        result.completed = this.score.getState();
        return result;
      }
    }

    // 9. Failure check
    if (this.gauge.isFailed()) {
      this._phase = PHASE_FAILED;
      result.state = this.buildState(currentTime);
      result.failed = this.score.getState();
      return result;
    }

    return result;
  }

  // ==================== Key Input ====================

  /**
   * Handle key down. Returns commands for sound and judgment.
   */
  handleKeyDown(column: KeyColumn, currentTime: number): TickResult {
    const result: TickResult = {
      sounds: [],
      judgments: [],
      landmines: [],
      keyInputs: [{ column, held: true }],
      state: null,
      completed: null,
      failed: null,
      nextNotes: new Map(),
    };

    if (this._phase.kind !== 'playing' || this._autoplay) return result;

    this.heldKeys.add(column);

    // Find closest note
    const noteIndex = this.findClosestNote(column, currentTime);
    if (noteIndex === -1) {
      this.checkLandmine(column, currentTime, result);
      return result;
    }

    const note = this.pendingNotes[noteIndex];

    // Judge
    const adjustedGameTime = currentTime + this.judgmentOffset;
    const judgeResult = this.judgment.judge(adjustedGameTime, note.time * 1000);

    // Remove note
    this.pendingNotes.splice(noteIndex, 1);

    // Keysound
    if (note.keysound) {
      result.sounds.push({
        type: 'playSound',
        keysound: note.keysound,
        offset: note.keysoundStart ?? 0,
        gameTimeMs: 0, // immediate
        volume: note.volume ?? 1,
      });
    }

    // Long note
    if (note.end) {
      if (judgeResult.judgment !== 'BAD' && judgeResult.judgment !== 'POOR') {
        this.activeHolds.set(column, note);
      } else {
        this.onNoteJudgment(note, judgeResult.judgment, judgeResult.offset, currentTime, result);
        this.onNoteJudgment(note, 'MISS', 0, currentTime, result);
        this.buildNextNotes(result);
        return result;
      }
    }

    this.onNoteJudgment(note, judgeResult.judgment, judgeResult.offset, currentTime, result);
    this.buildNextNotes(result);
    return result;
  }

  /**
   * Handle key up.
   */
  handleKeyUp(column: KeyColumn, currentTime: number): TickResult {
    const result: TickResult = {
      sounds: [],
      judgments: [],
      landmines: [],
      keyInputs: [{ column, held: false }],
      state: null,
      completed: null,
      failed: null,
      nextNotes: new Map(),
    };

    if (this._phase.kind !== 'playing' || this._autoplay) return result;

    this.heldKeys.delete(column);

    const note = this.activeHolds.get(column);
    if (!note || !note.end) return result;

    const endTime = note.end.time * 1000;
    const adjustedGameTime = currentTime + this.judgmentOffset;
    const judgeResult = this.judgment.judge(adjustedGameTime, endTime);

    this.activeHolds.delete(column);
    this.onNoteJudgment(note, judgeResult.judgment, judgeResult.offset, currentTime, result);
    return result;
  }

  /**
   * Check if a column key is currently held
   */
  isKeyHeld(column: KeyColumn): boolean {
    return this.heldKeys.has(column);
  }

  // ==================== Next Notes Cache ====================

  /**
   * Get the next note for each column (for Main Thread keysound cache)
   */
  private buildNextNotes(result: TickResult): void {
    const seen = new Set<string>();
    for (const note of this.pendingNotes) {
      const col = note.column;
      if (seen.has(col)) continue;
      if (note.keysound) {
        seen.add(col);
        result.nextNotes.set(col, {
          keysound: note.keysound,
          offset: note.keysoundStart ?? 0,
          volume: note.volume ?? 1,
        });
      }
    }
  }

  // ==================== Internal Processing ====================

  private processAutoSounds(currentTime: number, result: TickResult): void {
    const adjustedTime = currentTime + this.audioLatency;
    const timeInSeconds = adjustedTime / 1000;
    const LOOKAHEAD = 0.050; // 50ms

    while (this.autoIndex < this.sortedAutos.length) {
      const auto = this.sortedAutos[this.autoIndex];
      if (auto.time > timeInSeconds + LOOKAHEAD) break;

      if (auto.keysound) {
        result.sounds.push({
          type: 'playSound',
          keysound: auto.keysound,
          offset: auto.keysoundStart ?? 0,
          gameTimeMs: auto.time * 1000,
          volume: auto.volume ?? 1,
        });
      }

      this.autoIndex++;
    }
  }

  private processAutoplayNotes(currentTime: number, result: TickResult): void {
    while (this.pendingNotes.length > 0) {
      const note = this.pendingNotes[0];
      const noteTimeMs = note.time * 1000;

      if (currentTime < noteTimeMs) break;

      this.pendingNotes.shift();

      if (note.keysound) {
        result.sounds.push({
          type: 'playSound',
          keysound: note.keysound,
          offset: note.keysoundStart ?? 0,
          gameTimeMs: 0, // immediate
          volume: note.volume ?? 1,
        });
      }

      result.keyInputs.push({ column: note.column as KeyColumn, held: true });

      if (note.end) {
        this.activeHolds.set(note.column as KeyColumn, note);
      }

      this.onNoteJudgment(note, 'PGREAT', 0, currentTime, result);
    }
  }

  private checkMissedNotes(currentTime: number, result: TickResult): void {
    const adjustedTime = currentTime + this.judgmentOffset;

    while (this.pendingNotes.length > 0) {
      const note = this.pendingNotes[0];

      if (!this.judgment.isMissed(adjustedTime, note.time * 1000)) {
        break;
      }

      this.pendingNotes.shift();
      if (note.keysound) {
        result.sounds.push({
          type: 'playSound',
          keysound: note.keysound,
          offset: note.keysoundStart ?? 0,
          gameTimeMs: 0,
          volume: note.volume ?? 1,
        });
      }
      this.onNoteJudgment(note, 'MISS', 0, currentTime, result);

      if (note.end) {
        this.onNoteJudgment(note, 'MISS', 0, currentTime, result);
      }
    }
  }

  private checkActiveHolds(currentTime: number, result: TickResult): void {
    const adjustedTime = currentTime + this.judgmentOffset;

    for (const [column, note] of this.activeHolds) {
      if (!note.end) continue;

      if (!this._autoplay && !this.heldKeys.has(column)) {
        this.activeHolds.delete(column);
        this.onNoteJudgment(note, 'POOR', 0, currentTime, result);
        continue;
      }

      if (adjustedTime >= note.end.time * 1000 - this.judgment.getWindows().great) {
        this.activeHolds.delete(column);
        this.onNoteJudgment(note, 'GREAT', 0, currentTime, result);
      }
    }
  }

  private cleanupPassedLandmines(currentTime: number): void {
    const adjustedTime = currentTime + this.judgmentOffset;
    const mineWindow = this.judgment.getWindows().bad;

    while (this.pendingLandmines.length > 0) {
      const mine = this.pendingLandmines[0];
      if (adjustedTime - mine.time * 1000 > mineWindow) {
        this.pendingLandmines.shift();
      } else {
        break;
      }
    }
  }

  private findClosestNote(column: KeyColumn, currentTime: number): number {
    let closestIndex = -1;
    let closestDistance = Infinity;
    const adjustedTime = currentTime + this.judgmentOffset;

    for (let i = 0; i < this.pendingNotes.length; i++) {
      const note = this.pendingNotes[i];
      if (note.column !== column) continue;

      const noteTime = note.time * 1000;
      const distance = Math.abs(adjustedTime - noteTime);

      if (!this.judgment.isInJudgmentRange(adjustedTime, noteTime)) continue;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  private checkLandmine(column: KeyColumn, currentTime: number, result: TickResult): void {
    const adjustedTime = currentTime + this.judgmentOffset;
    const mineWindow = this.judgment.getWindows().bad;

    for (let i = 0; i < this.pendingLandmines.length; i++) {
      const mine = this.pendingLandmines[i];
      if (mine.column !== column) continue;

      const mineTime = mine.time * 1000;
      const distance = Math.abs(adjustedTime - mineTime);

      if (distance <= mineWindow) {
        this.pendingLandmines.splice(i, 1);
        const damage = 5;
        this.gauge.applyDamage(damage);

        result.landmines.push({
          mineId: mine.id,
          column,
          damage,
          time: currentTime,
        });
        return;
      }

      if (mineTime < adjustedTime - mineWindow) continue;
      if (mineTime > adjustedTime + mineWindow) break;
    }
  }

  private onNoteJudgment(
    note: GameNote,
    judgment: Judgment,
    offset: number,
    currentTime: number,
    result: TickResult,
  ): void {
    this.score.onJudgment(judgment, offset);
    this.gauge.onJudgment(judgment);

    if (judgment !== 'MISS' && offset !== 0) {
      this.recentOffsets.push(offset);
      if (this.recentOffsets.length > this.MAX_RECENT_OFFSETS) {
        this.recentOffsets.shift();
      }
      this.recentOffsetsDirty = true;
    }

    result.judgments.push({
      noteId: note.id,
      column: note.column as KeyColumn,
      judgment,
      offset,
      time: currentTime,
    });
  }

  // ==================== State ====================

  buildState(currentTime: number): GameEngineState {
    const activeHoldNoteIds = new Set<number>();
    for (const note of this.activeHolds.values()) {
      activeHoldNoteIds.add(note.id);
    }

    const currentBeat = this.notechart.secondsToBeat(currentTime / 1000);

    const flags = gamePhaseToFlags(this._phase);
    return {
      phase: this._phase,
      isPlaying: flags.isPlaying,
      isPaused: flags.isPaused,
      isFailed: flags.isFailed,
      isCompleted: flags.isCompleted,
      currentTime,
      visualTime: currentTime + this.visualOffset,
      currentBeat,
      combo: this.score.currentCombo,
      gaugeValue: this.gauge.getValue(),
      exScore: this.score.exScore,
      lastJudgment: this.score.lastJudgment,
      lastOffset: this.score.lastOffset,
      activeHoldNoteIds,
      pgreatCount: this.score.pgreatCount,
      greatCount: this.score.greatCount,
      goodCount: this.score.goodCount,
      badCount: this.score.badCount,
      poorCount: this.score.poorCount,
      missCount: this.score.missCount,
      maxCombo: this.score.maxCombo,
      recentOffsets: this.getRecentOffsetsSnapshot(),
    };
  }

  private getRecentOffsetsSnapshot(): number[] {
    if (this.recentOffsetsDirty) {
      this.recentOffsetsSnapshot = [...this.recentOffsets];
      this.recentOffsetsDirty = false;
    }
    return this.recentOffsetsSnapshot;
  }

  getScoreState(): ScoreState {
    return this.score.getState();
  }

  getJudgmentWindows() {
    return this.judgment.getWindows();
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  getStartOffset(): number {
    return this.startOffset;
  }
}

export default GameEngine;
