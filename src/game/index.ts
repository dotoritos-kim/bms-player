/**
 * BMS 게임 모듈
 * 구동기(플레이어) 핵심 기능 제공
 */

export { InputHandler, DEFAULT_KEY_MAP, ALT_KEY_MAP, KEY_MAP_2P } from './InputHandler';
export type { KeyColumn, KeyInput, InputHandlerConfig } from './InputHandler';

export { JudgmentEngine } from './JudgmentEngine';
export type {
  Judgment,
  TimingIndicator,
  JudgmentWindows,
  JudgmentResult,
  JudgmentStyle,
  JudgmentEngineConfig,
} from './JudgmentEngine';

export { GaugeSystem } from './GaugeSystem';
export type { GaugeType, GaugeConfig, GaugeSystemState } from './GaugeSystem';

export { ScoreManager } from './ScoreManager';
export type { ScoreState, ScoreManagerConfig } from './ScoreManager';

export { GameLoop } from './GameLoop';
export type {
  GameLoopConfig,
  GameLoopState,
  GameLoopCallbacks,
  JudgmentEvent,
  LandmineEvent,
} from './GameLoop';

export { GameEngine } from './GameEngine';
export type {
  GameEngineConfig,
  GameEngineState,
  PlaySoundCommand,
  TickResult,
  NextNoteInfo,
} from './GameEngine';

export { WorkerGameLoop } from './WorkerGameLoop';
export type { WorkerGameLoopConfig } from './WorkerGameLoop';

export { WorkerAudioScheduler } from './WorkerAudioScheduler';
export type {
  WorkerAudioSchedulerConfig,
  SchedulerTickCallback,
  SchedulerEndCallback,
} from './WorkerAudioScheduler';

export type {
  SerializedNotechart,
  MainToWorkerMessage,
  WorkerToMainMessage,
} from './workerProtocol';

export type {
  SchedulerMainToWorker as AudioSchedulerMainToWorker,
  SchedulerWorkerToMain as AudioSchedulerWorkerToMain,
  SchedulerNote,
} from './AudioSchedulerWorker';

export { GameCanvas } from './GameCanvas';
export type { GameCanvasProps, GameCanvasHandle, LaneConfig } from './GameCanvas';
export {
  getLaneConfigForSide,
  LANE_CONFIG_MAP,
  COLUMN_1P,
  COLUMN_2P,
  DEFAULT_LANE_CONFIG,
  LANE_CONFIG_5K,
  LANE_CONFIG_5K_2P,
  LANE_CONFIG_7K_2P,
  LANE_CONFIG_9K,
  LANE_CONFIG_14K,
  LANE_CONFIG_14K_1P,
  LANE_CONFIG_14K_2P,
} from './GameCanvas';
export type { PlaySide } from './GameCanvas';

export { useGamePlayer } from './useGamePlayer';
export type {
  GamePlayerOptions,
  GamePlayerState,
  GamePlayerActions,
  UseGamePlayerResult,
} from './useGamePlayer';

export { GamePlayer } from './GamePlayer';
export type { GamePlayerProps } from './GamePlayer';

export { GameOptions, DEFAULT_GAME_OPTIONS } from './GameOptions';
export type { GameOptionsState, GameOptionsProps } from './GameOptions';

export { LatencyCalibration } from './LatencyCalibration';
export type { LatencyConfig, CalibrationResult } from './LatencyCalibration';

export {
  KeyBindingSettings,
  loadKeyBindings,
  saveKeyBindings,
  bindingsToKeyMap,
} from './KeyBindingSettings';
export type { KeyBindings, KeyBindingSettingsProps } from './KeyBindingSettings';
