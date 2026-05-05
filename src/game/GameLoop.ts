/**
 * BMS 게임 루프
 * 오디오-시각-입력 동기화의 핵심
 *
 * 동기화 전략:
 * 1. AudioContext.currentTime을 마스터 클럭으로 사용
 * 2. 게임 시작 시 contextStartTime 기록
 * 3. 모든 게임 시간 = (AudioContext.currentTime - contextStartTime) * 1000
 * 4. requestAnimationFrame으로 렌더링, 입력은 이벤트 기반
 */

import type { Notechart, GameNote, SoundedEvent } from '../audio/judgements';
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
import { JudgmentEngine, type Judgment } from './JudgmentEngine';
import { GaugeSystem, type GaugeType } from './GaugeSystem';
import { ScoreManager, type ScoreState } from './ScoreManager';

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

export class GameLoop {
  private notechart: Notechart;
  private keysoundPlayer: KeysoundPlayer;
  private audioContext: AudioContext;
  private inputHandler: InputHandler;
  private judgment: JudgmentEngine;
  private gauge: GaugeSystem;
  private score: ScoreManager;
  private callbacks: GameLoopCallbacks;

  // 타이밍
  private contextStartTime: number = 0;  // AudioContext 시작 시간
  private startOffset: number = 0;       // 시작 오프셋 (ms)
  private playbackRate: number = 1;
  private pauseTime: number = 0;

  // 레이턴시 보정
  private audioLatency: number = 0;      // 오디오 레이턴시 (ms)
  private judgmentOffset: number = 0;    // 판정 오프셋 (ms)
  private visualOffset: number = 0;      // 비주얼 오프셋 (ms)

  // 상태 (Stage 3 — discriminated union; 4-boolean 호환은 derived getter)
  private _phase: GamePhase = PHASE_READY;
  private animationFrameId: number = 0;
  private firstTickDone: boolean = false;

  // 노트 추적
  private pendingNotes: GameNote[];      // 아직 판정되지 않은 노트
  private pendingLandmines: GameNote[];  // 아직 트리거되지 않은 지뢰 노트
  private activeHolds: Map<KeyColumn, GameNote>; // 진행 중인 롱노트
  private autoIndex: number = 0;         // 다음 자동 재생할 BGM 인덱스
  private sortedAutos: SoundedEvent[];   // 시간순 정렬된 자동 사운드

  // 오토플레이
  private _autoplay: boolean = false;

  // 마지막 상태 (렌더링 최적화)
  private lastUpdateTime: number = 0;
  private readonly UPDATE_INTERVAL = 4; // ~240fps 지원 (rAF가 자연 스로틀 역할)

  // 최근 타이밍 오프셋 기록 (Early/Late 표시용)
  private recentOffsets: number[] = [];
  private recentOffsetsSnapshot: number[] = []; // React에 전달할 스냅샷 (변경 시에만 갱신)
  private recentOffsetsDirty = false;
  private readonly MAX_RECENT_OFFSETS = 50; // 최근 50개 기록

  constructor(config: GameLoopConfig, callbacks: GameLoopCallbacks = {}) {
    // 필수 파라미터 검증
    if (!config.notechart) {
      throw new Error('GameLoop: notechart is required');
    }
    if (!config.keysoundPlayer) {
      throw new Error('GameLoop: keysoundPlayer is required');
    }
    if (!config.audioContext) {
      throw new Error('GameLoop: audioContext is required');
    }

    this.notechart = config.notechart;
    this.keysoundPlayer = config.keysoundPlayer;
    this.audioContext = config.audioContext;
    this.callbacks = callbacks;
    this.startOffset = config.startOffset ?? 0;
    this.playbackRate = Math.max(0.1, Math.min(4, config.playbackRate ?? 1)); // 0.1x ~ 4x 제한

    // 레이턴시 보정 설정 (범위 제한)
    this.audioLatency = Math.max(-500, Math.min(500, config.audioLatency ?? 0));
    this.judgmentOffset = Math.max(-500, Math.min(500, config.judgmentOffset ?? 0));
    this.visualOffset = Math.max(-500, Math.min(500, config.visualOffset ?? 0));

    // 입력 핸들러
    this.inputHandler = config.inputHandler ?? new InputHandler();
    this.inputHandler.onKeyDown(this.handleKeyDown);
    this.inputHandler.onKeyUp(this.handleKeyUp);

    // 판정 엔진
    this.judgment = new JudgmentEngine({
      rank: config.rank ?? 2,
      defexrank: config.defexrank,
      style: 'lr2',
    });

    // 노트 배열 안전 처리
    const notes = this.notechart.notes ?? [];
    const autos = this.notechart.autos ?? [];

    // 노트 수 계산 (롱노트는 시작+끝 = 2, 최소 1로 보장)
    const totalNotes = Math.max(1, notes.reduce((sum, note) => {
      return sum + (note.end ? 2 : 1);
    }, 0));

    // 게이지 (TOTAL 최소값 보장)
    const total = Math.max(100, config.total ?? 200);
    this.gauge = new GaugeSystem(
      config.gaugeType ?? 'groove',
      total,
      totalNotes
    );

    // 스코어
    this.score = new ScoreManager({ totalNotes });

    // 오토플레이 모드
    this._autoplay = config.autoplay ?? false;

    // 노트 준비 (시간순 정렬, NaN 시간 필터링)
    this.pendingNotes = [...notes]
      .filter((note) => !isNaN(note.time) && isFinite(note.time))
      .sort((a, b) => a.time - b.time);
    this.activeHolds = new Map();

    // 지뢰 노트 준비
    const landmines = this.notechart.landmines ?? [];
    this.pendingLandmines = [...landmines]
      .filter((mine) => !isNaN(mine.time) && isFinite(mine.time))
      .sort((a, b) => a.time - b.time);

    // 자동 사운드 정렬 (NaN 시간 필터링)
    this.sortedAutos = [...autos]
      .filter((auto) => !isNaN(auto.time) && isFinite(auto.time))
      .sort((a, b) => a.time - b.time);
  }

  /**
   * 게임 시작
   */
  async start(): Promise<void> {
    // 이미 진행 중이면 무시 (playing 또는 paused 모두 active로 간주)
    if (this._phase.kind === 'playing' || this._phase.kind === 'paused') return;

    // AudioContext가 suspended 상태면 resume
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e: unknown) {
        console.warn('GameLoop: Failed to resume AudioContext:', e);
      }
    }

    // AudioContext가 closed 상태면 시작 불가
    if (this.audioContext.state === 'closed') {
      console.error('GameLoop: AudioContext is closed, cannot start');
      return;
    }

    this._phase = PHASE_PLAYING;

    // AudioContext 시작 시간 기록
    this.contextStartTime = this.audioContext.currentTime;
    this.autoIndex = 0;
    this.lastUpdateTime = 0;
    this.firstTickDone = false;

    // 입력 활성화
    this.inputHandler.setEnabled(true);

    // 게임 루프 시작
    this.tick();
  }

  /**
   * 일시정지
   */
  pause(): void {
    if (this._phase.kind !== 'playing') return;

    this._phase = PHASE_PAUSED;
    this.pauseTime = this.getCurrentTime();
    this.inputHandler.setEnabled(false);
    cancelAnimationFrame(this.animationFrameId);
    this.keysoundPlayer.stopAll();
  }

  /**
   * 재개
   */
  resume(): void {
    if (this._phase.kind !== 'paused') return;

    this._phase = PHASE_PLAYING;
    // 일시정지된 시간만큼 시작 시간 조정
    const pauseDuration = (this.audioContext.currentTime * 1000) -
      (this.contextStartTime * 1000 + this.pauseTime);
    this.contextStartTime += pauseDuration / 1000;

    this.inputHandler.setEnabled(true);
    this.tick();
  }

  /**
   * 정지
   */
  stop(): void {
    this._phase = PHASE_READY;
    cancelAnimationFrame(this.animationFrameId);
    this.inputHandler.setEnabled(false);
    this.keysoundPlayer.stopAll();
  }

  /**
   * 현재 게임 상태 (Stage 3 — discriminated union).
   * 외부 API의 4-boolean 호환은 `getState()`/`emitUpdate()`의 derived 필드 참고.
   */
  get phase(): GamePhase {
    return this._phase;
  }

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

  /**
   * 현재 게임 시간 (ms)
   * AudioContext.currentTime 기반으로 정확한 시간 계산
   */
  getCurrentTime(): number {
    if (this._phase.kind !== 'playing' && this._phase.kind !== 'paused') return 0;
    if (this._phase.kind === 'paused') return this.pauseTime;

    const elapsed = (this.audioContext.currentTime - this.contextStartTime) * 1000;
    return (elapsed + this.startOffset) * this.playbackRate;
  }

  /**
   * 현재 비트
   */
  getCurrentBeat(): number {
    const time = this.getCurrentTime() / 1000;  // 초로 변환
    return this.notechart.secondsToBeat(time);
  }

  /**
   * 게임 루프 메인 틱
   */
  private tick = (): void => {
    if (this._phase.kind !== 'playing') return;

    // 첫 프레임에서 contextStartTime 재설정 (타이밍 점프 방지)
    // AudioContext.resume() async 완료와 tick() 호출 사이의 시간 차이를 보정
    // 주의: boolean 플래그 사용 — lastUpdateTime === 0 체크 시 매 프레임 리셋되는 버그 방지
    if (!this.firstTickDone) {
      this.contextStartTime = this.audioContext.currentTime;
      this.firstTickDone = true;
    }

    const currentTime = this.getCurrentTime();

    // 1. 자동 BGM 재생
    this.processAutoSounds(currentTime);

    // 2. 오토플레이: 노트를 자동 판정
    if (this._autoplay) {
      this.processAutoplayNotes(currentTime);
    }

    // 3. 미스 체크 (판정 창을 벗어난 노트 — 오토플레이 시에는 이미 처리됨)
    this.checkMissedNotes(currentTime);

    // 4. 롱노트 홀드 체크
    this.checkActiveHolds(currentTime);

    // 5. 지나간 지뢰 노트 정리
    this.cleanupPassedLandmines(currentTime);

    // 6. 상태 업데이트 콜백 (프레임 제한)
    if (currentTime - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      this.emitUpdate(currentTime);
      this.lastUpdateTime = currentTime;
    }

    // 7. 완료 체크
    if (this.pendingNotes.length === 0 && this.activeHolds.size === 0) {
      // 모든 자동 사운드가 재생될 때까지 대기
      if (this.autoIndex >= this.sortedAutos.length) {
        this.complete();
        return;
      }
    }

    // 실패 체크
    if (this.gauge.isFailed()) {
      this.fail();
      return;
    }

    // 다음 프레임 예약
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  /**
   * 자동 BGM 재생
   * 오디오 레이턴시 보정: 양수면 오디오가 늦게 들리므로 일찍 재생
   * lookahead 스케줄링: 50ms 앞의 사운드를 미리 AudioWorklet에 전달하여
   * 샘플 단위 정확한 타이밍으로 재생
   */
  private processAutoSounds(currentTime: number): void {
    // 오디오 레이턴시 보정 적용 (양수면 일찍 재생)
    const adjustedTime = currentTime + this.audioLatency;
    const timeInSeconds = adjustedTime / 1000;
    // rAF 간격(~17ms)보다 넉넉한 lookahead로 사운드 사전 스케줄링
    const LOOKAHEAD = 0.050; // 50ms

    while (this.autoIndex < this.sortedAutos.length) {
      const auto = this.sortedAutos[this.autoIndex];
      if (auto.time > timeInSeconds + LOOKAHEAD) break;

      // 키사운드 재생
      if (auto.keysound) {
        const offset = auto.keysoundStart ?? 0;
        // AudioContext 시간 기준으로 정확한 재생 시점 계산
        // getCurrentTime() = ((acTime - csTime) * 1000 + startOffset) * playbackRate
        // → acTime = csTime + (gameTimeMs / playbackRate - startOffset) / 1000
        const gameTimeMs = auto.time * 1000;
        const targetContextTime = this.contextStartTime +
          (gameTimeMs / this.playbackRate - this.startOffset) / 1000;
        this.keysoundPlayer.play(auto.keysound, offset, targetContextTime, auto.volume);
      }

      this.autoIndex++;
    }
  }

  /**
   * 오토플레이: 노트 시간에 도달하면 자동으로 PGREAT 판정
   */
  private processAutoplayNotes(currentTime: number): void {
    while (this.pendingNotes.length > 0) {
      const note = this.pendingNotes[0];
      const noteTimeMs = note.time * 1000;

      // 아직 노트 시간에 도달하지 않은 경우 중단
      if (currentTime < noteTimeMs) break;

      this.pendingNotes.shift();

      // 키사운드 재생
      if (note.keysound) {
        this.keysoundPlayer.play(note.keysound, note.keysoundStart ?? 0, 0, note.volume);
      }

      // 키 입력 시각 효과 콜백
      this.callbacks.onKeyInput?.(note.column as KeyColumn, true);
      // 짧은 딜레이 후 키 릴리즈 (시각적 피드백용)
      setTimeout(() => {
        this.callbacks.onKeyInput?.(note.column as KeyColumn, false);
      }, 50);

      // 롱노트는 활성화 (끝점은 checkActiveHolds에서 자동 처리)
      if (note.end) {
        this.activeHolds.set(note.column as KeyColumn, note);
      }

      // PGREAT 판정 (오프셋 0)
      this.onNoteJudgment(note, 'PGREAT', 0);
    }
  }

  /**
   * 미스된 노트 체크
   */
  private checkMissedNotes(currentTime: number): void {
    // 판정 오프셋 적용
    const adjustedTime = currentTime + this.judgmentOffset;

    while (this.pendingNotes.length > 0) {
      const note = this.pendingNotes[0];

      // 아직 판정 가능한 노트면 중단
      if (!this.judgment.isMissed(adjustedTime, note.time * 1000)) {
        break;
      }

      // 미스 처리 - BMS 표준: 미스된 노트의 키음도 자동 재생
      this.pendingNotes.shift();
      if (note.keysound) {
        this.keysoundPlayer.play(note.keysound, note.keysoundStart ?? 0, 0, note.volume);
      }
      this.onNoteJudgment(note, 'MISS', 0);

      // 롱노트인 경우 끝점도 미스
      if (note.end) {
        this.onNoteJudgment(note, 'MISS', 0);
      }
    }
  }

  /**
   * 활성 롱노트 홀드 체크
   */
  private checkActiveHolds(currentTime: number): void {
    // 판정 오프셋 적용
    const adjustedTime = currentTime + this.judgmentOffset;

    for (const [column, note] of this.activeHolds) {
      if (!note.end) continue;

      // 오토플레이가 아닌 경우: 키를 떼고 있으면 POOR
      if (!this._autoplay && !this.inputHandler.isHeld(column)) {
        this.activeHolds.delete(column);
        this.onNoteJudgment(note, 'POOR', 0);
        continue;
      }

      // 끝점 시간 도달
      if (adjustedTime >= note.end.time * 1000 - this.judgment.getWindows().great) {
        this.activeHolds.delete(column);
        // 끝점은 홀드 성공 시 GREAT 보장
        this.onNoteJudgment(note, 'GREAT', 0);
      }
    }
  }

  /**
   * 키다운 핸들러
   */
  private handleKeyDown = (input: KeyInput): void => {
    if (this._phase.kind !== 'playing' || this._autoplay) return;

    const { column } = input;

    // 콜백
    this.callbacks.onKeyInput?.(column, true);

    // 게임 시간 계산
    const gameTime = this.getCurrentTime();

    // 해당 컬럼의 가장 가까운 노트 찾기
    const noteIndex = this.findClosestNote(column, gameTime);
    if (noteIndex === -1) {
      // 빈타 - 노트가 없으면 지뢰 체크
      this.checkLandmine(column, gameTime);
      return;
    }

    const note = this.pendingNotes[noteIndex];

    // 판정 (판정 오프셋 적용)
    const adjustedGameTime = gameTime + this.judgmentOffset;
    const result = this.judgment.judge(adjustedGameTime, note.time * 1000);

    // 노트 제거
    this.pendingNotes.splice(noteIndex, 1);

    // 키사운드 재생 (볼륨 적용)
    if (note.keysound) {
      this.keysoundPlayer.play(note.keysound, note.keysoundStart ?? 0, 0, note.volume);
    }

    // 롱노트 시작이면 활성화
    if (note.end) {
      if (result.judgment !== 'BAD' && result.judgment !== 'POOR') {
        this.activeHolds.set(column, note);
      } else {
        // 롱노트 시작을 놓치면 끝점도 실패
        this.onNoteJudgment(note, result.judgment, result.offset);
        this.onNoteJudgment(note, 'MISS', 0);
        return;
      }
    }

    this.onNoteJudgment(note, result.judgment, result.offset);
  };

  /**
   * 키업 핸들러
   */
  private handleKeyUp = (input: KeyInput): void => {
    if (this._phase.kind !== 'playing' || this._autoplay) return;

    const { column } = input;

    // 콜백
    this.callbacks.onKeyInput?.(column, false);

    // 활성 롱노트 확인
    const note = this.activeHolds.get(column);
    if (!note || !note.end) return;

    const gameTime = this.getCurrentTime();
    const endTime = note.end.time * 1000;

    // 끝점 판정 (판정 오프셋 적용)
    const adjustedGameTime = gameTime + this.judgmentOffset;
    const result = this.judgment.judge(adjustedGameTime, endTime);

    this.activeHolds.delete(column);
    this.onNoteJudgment(note, result.judgment, result.offset);
  };

  /**
   * 가장 가까운 노트 찾기
   */
  private findClosestNote(column: KeyColumn, currentTime: number): number {
    let closestIndex = -1;
    let closestDistance = Infinity;

    // 판정 오프셋 적용
    const adjustedTime = currentTime + this.judgmentOffset;

    for (let i = 0; i < this.pendingNotes.length; i++) {
      const note = this.pendingNotes[i];
      if (note.column !== column) continue;

      const noteTime = note.time * 1000;
      const distance = Math.abs(adjustedTime - noteTime);

      // 판정 범위 내인지 확인
      if (!this.judgment.isInJudgmentRange(adjustedTime, noteTime)) continue;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  /**
   * 지뢰 노트 체크 - 키 입력 시 근처 지뢰가 있으면 트리거
   * 지뢰 판정 윈도우는 BAD 윈도우와 동일 (약 200ms)
   */
  private checkLandmine(column: KeyColumn, currentTime: number): void {
    const adjustedTime = currentTime + this.judgmentOffset;
    const mineWindow = this.judgment.getWindows().bad;

    for (let i = 0; i < this.pendingLandmines.length; i++) {
      const mine = this.pendingLandmines[i];
      if (mine.column !== column) continue;

      const mineTime = mine.time * 1000;
      const distance = Math.abs(adjustedTime - mineTime);

      if (distance <= mineWindow) {
        // 지뢰 트리거!
        this.pendingLandmines.splice(i, 1);

        // 고정 데미지 5% (BMSNote.damage가 GameNote에 전파되지 않으므로)
        const damage = 5;
        this.gauge.applyDamage(damage);

        // 콜백
        this.callbacks.onLandmineTrigger?.({
          mineId: mine.id,
          column,
          damage,
          time: currentTime,
        });
        return;
      }

      // 이미 지나간 지뢰는 건너뛰기 (시간순 정렬이므로)
      if (mineTime < adjustedTime - mineWindow) continue;
      // 아직 도달하지 않은 지뢰도 윈도우 밖이면 종료
      if (mineTime > adjustedTime + mineWindow) break;
    }
  }

  /**
   * 지나간 지뢰 노트 정리 (판정선을 지나면 안전하게 제거)
   */
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

  /**
   * 노트 판정 처리
   */
  private onNoteJudgment(note: GameNote, judgment: Judgment, offset: number): void {
    // 스코어/게이지 업데이트
    this.score.onJudgment(judgment, offset);
    this.gauge.onJudgment(judgment);

    // 타이밍 오프셋 기록 (MISS 제외 - 실제 입력이 아님)
    if (judgment !== 'MISS' && offset !== 0) {
      this.recentOffsets.push(offset);
      if (this.recentOffsets.length > this.MAX_RECENT_OFFSETS) {
        this.recentOffsets.shift();
      }
      this.recentOffsetsDirty = true;
    }

    // 콜백
    this.callbacks.onJudgment?.({
      noteId: note.id,
      column: note.column as KeyColumn,
      judgment,
      offset,
      time: this.getCurrentTime(),
    });
  }

  /**
   * 상태 업데이트 이벤트 발생
   */
  private emitUpdate(currentTime: number): void {
    // 진행 중인 롱노트 ID 세트 생성
    const activeHoldNoteIds = new Set<number>();
    for (const note of this.activeHolds.values()) {
      activeHoldNoteIds.add(note.id);
    }

    // currentTime 파라미터에서 직접 비트 계산 (getCurrentBeat()는 phase 의존)
    const currentBeat = this.notechart.secondsToBeat(currentTime / 1000);

    const flags = gamePhaseToFlags(this._phase);
    const state: GameLoopState = {
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
      // 판정 카운트
      pgreatCount: this.score.pgreatCount,
      greatCount: this.score.greatCount,
      goodCount: this.score.goodCount,
      badCount: this.score.badCount,
      poorCount: this.score.poorCount,
      missCount: this.score.missCount,
      maxCombo: this.score.maxCombo,
      // 타이밍 오프셋 기록 (변경 시에만 새 배열 생성)
      recentOffsets: this.getRecentOffsetsSnapshot(),
    };

    this.callbacks.onUpdate?.(state);
  }

  /**
   * recentOffsets 스냅샷 반환 (변경 시에만 새 배열 생성)
   */
  private getRecentOffsetsSnapshot(): number[] {
    if (this.recentOffsetsDirty) {
      this.recentOffsetsSnapshot = [...this.recentOffsets];
      this.recentOffsetsDirty = false;
    }
    return this.recentOffsetsSnapshot;
  }

  /**
   * 게임 완료
   */
  private complete(): void {
    // 상태 변경 전에 현재 시간 캡처 (phase=completed 이후 getCurrentTime()이 0 반환)
    const finalTime = this.getCurrentTime();

    this._phase = PHASE_COMPLETED;
    cancelAnimationFrame(this.animationFrameId);
    this.inputHandler.setEnabled(false);

    // React에 최종 상태 전달 (phase=completed)
    this.emitUpdate(finalTime);

    this.callbacks.onComplete?.(this.score.getState());
  }

  /**
   * 게임 실패
   */
  private fail(): void {
    // 상태 변경 전에 현재 시간 캡처 (phase=failed 이후 getCurrentTime()이 0 반환)
    const finalTime = this.getCurrentTime();

    this._phase = PHASE_FAILED;
    cancelAnimationFrame(this.animationFrameId);
    this.inputHandler.setEnabled(false);
    this.keysoundPlayer.stopAll();

    // React에 최종 상태 전달 (phase=failed)
    this.emitUpdate(finalTime);

    this.callbacks.onFailed?.(this.score.getState());
  }

  /**
   * 현재 상태 반환
   */
  getState(): GameLoopState {
    const currentTime = this.getCurrentTime();

    // 진행 중인 롱노트 ID 세트 생성
    const activeHoldNoteIds = new Set<number>();
    for (const note of this.activeHolds.values()) {
      activeHoldNoteIds.add(note.id);
    }

    const flags = gamePhaseToFlags(this._phase);
    return {
      phase: this._phase,
      isPlaying: flags.isPlaying,
      isPaused: flags.isPaused,
      isFailed: flags.isFailed,
      isCompleted: flags.isCompleted,
      currentTime,
      visualTime: currentTime + this.visualOffset,
      currentBeat: this.getCurrentBeat(),
      combo: this.score.currentCombo,
      gaugeValue: this.gauge.getValue(),
      exScore: this.score.exScore,
      lastJudgment: this.score.lastJudgment,
      lastOffset: this.score.lastOffset,
      activeHoldNoteIds,
      // 판정 카운트
      pgreatCount: this.score.pgreatCount,
      greatCount: this.score.greatCount,
      goodCount: this.score.goodCount,
      badCount: this.score.badCount,
      poorCount: this.score.poorCount,
      missCount: this.score.missCount,
      maxCombo: this.score.maxCombo,
      // 타이밍 오프셋 기록
      recentOffsets: this.getRecentOffsetsSnapshot(),
    };
  }

  /**
   * 스코어 상태 반환
   */
  getScoreState(): ScoreState {
    return this.score.getState();
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    this.stop();
    this.inputHandler.dispose();
  }
}

export default GameLoop;
