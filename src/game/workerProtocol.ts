/**
 * Worker ↔ Main Thread 통신 프로토콜 타입 정의
 */

import type { GameNote, SoundedEvent } from '../audio/judgements';
import type { GamePhase } from '../types/GamePhase';
import type { Judgment } from './JudgmentEngine';
import type { GaugeType } from './GaugeSystem';
import type { ScoreState } from './ScoreManager';
import type { KeyColumn } from './InputHandler';

// ==================== Serializable Notechart Data ====================

/** Worker로 전송 가능한 순수 데이터 형태의 Notechart */
export interface SerializedNotechart {
  notes: GameNote[];
  autos: SoundedEvent[];
  landmines: GameNote[];
  /** Timing 재생성용 — beat→seconds 변환 테이블 (미리 계산) */
  beatToSecondsTable: Array<{ beat: number; seconds: number }>;
  duration: number;
}

// ==================== Main → Worker Messages ====================

export type MainToWorkerMessage =
  | { type: 'init'; payload: WorkerInitPayload }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'keyDown'; payload: { column: KeyColumn; time: number } }
  | { type: 'keyUp'; payload: { column: KeyColumn; time: number } }
  | { type: 'dispose' };

export interface WorkerInitPayload {
  notechart: SerializedNotechart;
  config: {
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
  };
}

// ==================== Worker → Main Messages ====================

export type WorkerToMainMessage =
  | { type: 'playSound'; payload: PlaySoundPayload }
  | { type: 'stopAll' }
  | { type: 'update'; payload: SerializedGameState }
  | { type: 'judgment'; payload: JudgmentPayload }
  | { type: 'landmine'; payload: LandminePayload }
  | { type: 'keyInput'; payload: { column: KeyColumn; held: boolean } }
  | { type: 'nextNotes'; payload: Record<string, NextNotePayload> }
  | { type: 'complete'; payload: ScoreState }
  | { type: 'failed'; payload: ScoreState }
  | { type: 'ready' }
  | { type: 'error'; payload: { message: string } };

export interface PlaySoundPayload {
  keysound: string;
  offset: number;
  gameTimeMs: number;
  volume: number;
}

export interface JudgmentPayload {
  noteId: number;
  column: KeyColumn;
  judgment: Judgment;
  offset: number;
  time: number;
}

export interface LandminePayload {
  mineId: number;
  column: KeyColumn;
  damage: number;
  time: number;
}

export interface NextNotePayload {
  keysound: string;
  offset: number;
  volume: number;
}

/** Serialized version of GameEngineState (Set → Array for postMessage) */
export interface SerializedGameState {
  /** Stage 3 — discriminated union (Worker→Main 직렬화에 안전한 plain object). */
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
  activeHoldNoteIds: number[];
  pgreatCount: number;
  greatCount: number;
  goodCount: number;
  badCount: number;
  poorCount: number;
  missCount: number;
  maxCombo: number;
  recentOffsets: number[];
}
