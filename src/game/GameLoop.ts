/**
 * BMS 게임 루프 — rAF 기반 Main Thread 실행 환경
 *
 * 동기화 전략:
 * 1. AudioContext.currentTime을 마스터 클럭으로 사용
 * 2. 게임 시작 시 contextStartTime 기록
 * 3. 모든 게임 시간 = (AudioContext.currentTime - contextStartTime) * 1000
 * 4. requestAnimationFrame으로 렌더링, 입력은 이벤트 기반
 *
 * S7 (REFACTOR-PLAN): GameEngine에 게임 로직 위임(H2 중복 제거).
 * GameLoop는 이제 타이밍·입력·rAF 스케줄링·사이드 이펙트 실행에만 집중.
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
  /** 노트 차트 */
  notechart: Notechart;
  /** 키사운드 플레이어 */
  keysoundPlayer: KeysoundPlayer;
  /** 오디오 컨텍스트 (동기화용) */
  audioContext: AudioContext;
  /** 게이지 타입 */
  gaugeType?: GaugeType;
  /** TOTAL 값 (#TOTAL) */
  total?: number;
  /** 판정 RANK (#RANK) */
  rank?: number;
  /** 커스텀 판정 (#DEFEXRANK) */
  defexrank?: number;
  /** 입력 핸들러 (외부에서 주입 가능) */
  inputHandler?: InputHandler;
  /** 시작 오프셋 (ms) */
  startOffset?: number;
  /** 배속 */
  playbackRate?: number;
  /** 오디오 레이턴시 보정 (ms) - 양수: 오디오가 늦게 들림, 오디오를 일찍 재생 */
  audioLatency?: number;
  /** 판정 레이턴시 보정 (ms) - 양수: 판정을 늦게 처리 */
  judgmentOffset?: number;
  /** 비주얼 레이턴시 보정 (ms) - 양수: 노트를 일찍 표시 */
  visualOffset?: number;
  /** 오토플레이 모드 */
  autoplay?: boolean;
}

export interface GameLoopState {
  /**
   * 통합 게임 상태(Stage 3, REFACTOR-PLAN §6.2). 신규 컨슈머는 이 필드를
   * 우선 사용한다. 기존 4-boolean(`isPlaying`/`isPaused`/`isFailed`/`isCompleted`)
   * 도 호환을 위해 유지되며, `phase`로부터 derive된다(`gamePhaseToFlags`).
   */
  phase: GamePhase;
  /** @deprecated `phase.kind` 사용 권장. `phase`에서 derive (`playing`/`paused`). */
  isPlaying: boolean;
  /** @deprecated `phase.kind === 'paused'` 사용 권장. */
  isPaused: boolean;
  /** @deprecated `phase.kind === 'failed'` 사용 권장. */
  isFailed: boolean;
  /** @deprecated `phase.kind === 'completed'` 사용 권장. */
  isCompleted: boolean;
  /** 현재 게임 시간 (ms) */
  currentTime: number;
  /** 렌더링용 시간 (비주얼 오프셋 적용, ms) */
  visualTime: number;
  /** 현재 비트 */
  currentBeat: number;
  /** 현재 콤보 */
  combo: number;
  /** 게이지 값 (%) */
  gaugeValue: number;
  /** EX 스코어 */
  exScore: number;
  /** 마지막 판정 */
  lastJudgment: Judgment | null;
  /** 마지막 판정 오프셋 (ms) */
  lastOffset: number;
  /** 진행 중인 롱노트 ID 목록 */
  activeHoldNoteIds: Set<number>;
  /** 판정 카운트 */
  pgreatCount: number;
  greatCount: number;
  goodCount: number;
  badCount: number;
  poorCount: number;
  missCount: number;
  /** 최대 콤보 */
  maxCombo: number;
  /** 최근 타이밍 오프셋 기록 (Early/Late 표시용) */
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
  /** 상태 업데이트 (매 프레임) */
  onUpdate?: (state: GameLoopState) => void;
  /** 판정 발생 시 */
  onJudgment?: (event: JudgmentEvent) => void;
  /** 지뢰 노트 트리거 시 */
  onLandmineTrigger?: (event: LandmineEvent) => void;
  /** 게임 완료 시 */
  onComplete?: (score: ScoreState) => void;
  /** 게임 실패 시 */
  onFailed?: (score: ScoreState) => void;
  /** 키 입력 시 */
  onKeyInput?: (column: KeyColumn, held: boolean) => void;
}

// ── GameLoop ────────────────────────────────────────────────────────────────

export class GameLoop {
  // S7: 모든 게임 로직은 GameEngine에 위임
  private readonly engine: GameEngine;

  private readonly keysoundPlayer: KeysoundPlayer;
  private readonly audioContext: AudioContext;
  private readonly inputHandler: InputHandler;
  private readonly callbacks: GameLoopCallbacks;

  // 타이밍 (GameLoop 전용: AudioContext 기반 클럭)
  private contextStartTime: number = 0;
  private readonly startOffset: number;
  private readonly playbackRate: number;
  private pauseTime: number = 0;

  // 상태 (phase는 engine을 통해 읽되, GameLoop 자체도 phase 캐시 유지)
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

    // 입력 핸들러
    this.inputHandler = config.inputHandler ?? new InputHandler();
    this.inputHandler.onKeyDown(this.handleKeyDown);
    this.inputHandler.onKeyUp(this.handleKeyUp);

    // S7: 게임 로직 전량을 GameEngine에 위임
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

    // 일시정지된 시간만큼 시작 시간 조정
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

  // ── Phase / derived getters (external API 호환) ───────────────────────────

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

    // 첫 프레임: contextStartTime 재설정 (타이밍 점프 방지)
    if (!this.firstTickDone) {
      this.contextStartTime = this.audioContext.currentTime;
      this.firstTickDone = true;
    }

    const currentTime = this.getCurrentTime();

    // GameEngine에 틱 위임 → 커맨드 수신
    const result = this.engine.tick(currentTime);

    // ── 사이드 이펙트 실행 ──────────────────────────────────────────────────

    // 1. 사운드 재생
    for (const cmd of result.sounds) {
      if (cmd.type === 'playSound') {
        let targetContextTime = 0;
        if (cmd.gameTimeMs > 0) {
          // 스케줄링된 BGM: AudioContext 절대 시간으로 변환
          targetContextTime = this.contextStartTime +
            (cmd.gameTimeMs / this.playbackRate - this.startOffset) / 1000;
        }
        this.keysoundPlayer.play(cmd.keysound, cmd.offset, targetContextTime, cmd.volume);
      }
    }

    // 2. 판정 콜백
    for (const ev of result.judgments) {
      this.callbacks.onJudgment?.(ev);
    }

    // 3. 지뢰 콜백
    for (const ev of result.landmines) {
      this.callbacks.onLandmineTrigger?.(ev);
    }

    // 4. 키 입력 콜백 (오토플레이 key-press)
    for (const ki of result.keyInputs) {
      this.callbacks.onKeyInput?.(ki.column, ki.held);
      // 오토플레이: press 이후 짧은 시간 후 release 시뮬레이션
      if (ki.held) {
        const timer = setTimeout(() => {
          this.callbacks.onKeyInput?.(ki.column, false);
        }, 50);
        this.autoplayReleaseTimers.push(timer);
      }
    }

    // 5. 상태 업데이트
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

    // 6. 완료 / 실패 처리
    if (result.completed) {
      this.handleComplete(result.completed, currentTime);
      return;
    }
    if (result.failed) {
      this.handleFailed(result.failed, currentTime);
      return;
    }

    // 다음 프레임 예약
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  // ── Input handlers ────────────────────────────────────────────────────────

  private handleKeyDown = (input: KeyInput): void => {
    const currentTime = this.getCurrentTime();
    const result = this.engine.handleKeyDown(input.column, currentTime);

    // 사이드 이펙트 실행
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

    // 최종 상태 전달
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
