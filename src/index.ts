/**
 * @rhythm-archive/bms-player
 *
 * BMS rhythm game player engine with WebGL rendering, judgment system, and audio playback.
 * Supports all key modes from 4K to 48K+4SC.
 */

// ============ Audio ============
export {
    AudioPreloader,
    AudioProcessorWorkletUrl,
    PlayerAudio,
    createClosestNoteFinder,
    audioIndexedDBCache,
    useKeysoundPlayerStore,
    hashKeysounds,
    Notechart,
    KeysoundPlayer,
    createKeysoundPlayer,
    resolveKeysoundFiles,
    resolveKeysounds,
    extractStem,
} from './audio';

export type {
    FileMap,
    WorkerFactory,
    AudioPreloaderOptions,
    Track,
    StereoTrack,
    StereoPlayData,
    MonoPlayData,
    AudioProcessorPostMessage,
    NotechartInput,
    ExpertJudgmentWindow,
    NotechartImages,
    PlayerOptions,
    GameEvent,
    SoundedEvent,
    GameNote,
    GameLandmine,
    NoteInfo,
    CachedAudioEntry,
    CacheMetadata,
    KeysoundPlayerOptions,
    KeysoundPlayerResolveConfig,
    ResolveOptions,
    AudioFileMapFetcher,
} from './audio';

// ============ Game ============
export {
    InputHandler,
    DEFAULT_KEY_MAP,
    ALT_KEY_MAP,
    KEY_MAP_2P,
    JudgmentEngine,
    GaugeSystem,
    ScoreManager,
    GameLoop,
    GameEngine,
    WorkerGameLoop,
    WorkerAudioScheduler,
    GameCanvas,
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
    useGamePlayer,
    GamePlayer,
    GameOptions,
    DEFAULT_GAME_OPTIONS,
    LatencyCalibration,
    KeyBindingSettings,
    loadKeyBindings,
    saveKeyBindings,
    bindingsToKeyMap,
} from './game';

export type {
    KeyColumn,
    KeyInput,
    InputHandlerConfig,
    Judgment,
    TimingIndicator,
    JudgmentWindows,
    JudgmentResult,
    JudgmentStyle,
    JudgmentEngineConfig,
    GaugeType,
    GaugeConfig,
    GaugeSystemState,
    ScoreState,
    ScoreManagerConfig,
    GameLoopConfig,
    GameLoopState,
    GameLoopCallbacks,
    JudgmentEvent,
    LandmineEvent,
    GameEngineConfig,
    GameEngineState,
    PlaySoundCommand,
    TickResult,
    WorkerGameLoopConfig,
    WorkerAudioSchedulerConfig,
    SchedulerTickCallback,
    SchedulerEndCallback,
    SchedulerNote,
    GameCanvasProps,
    GameCanvasHandle,
    LaneConfig,
    PlaySide,
    GamePlayerOptions,
    GamePlayerState,
    GamePlayerActions,
    UseGamePlayerResult,
    GamePlayerProps,
    GameOptionsState,
    GameOptionsProps,
    LatencyConfig,
    CalibrationResult,
    KeyBindings,
    KeyBindingSettingsProps,
} from './game';

// ============ Preview ============
export { useBmsPreview, BmsPreviewPlayer } from './preview';
export type {
    BmsPreviewOptions,
    BmsPreviewState,
    BmsPreviewControls,
    BmsPreviewPlayerProps,
} from './preview';

// ============ Types ============
// KeysoundPlayer interface kept for backward compatibility (consumers may reference it)
export type { KeysoundPlayer as KeysoundPlayerInterface } from './types/KeysoundPlayer';

// ============ i18n ============
export { I18nProvider, useI18n, fallbackTranslate, defaultMessages } from './i18n';
export type { BmsPlayerMessages, BmsPlayerI18nKey, I18nProviderValue, Translator } from './i18n';

// Stage 3 — GamePhase 통합 상태 (REFACTOR-PLAN §6.2). 신규 컨슈머용 노출.
export type { GamePhase, GamePhaseKind } from './types/GamePhase';
export {
    PHASE_READY,
    PHASE_PLAYING,
    PHASE_PAUSED,
    PHASE_COMPLETED,
    PHASE_FAILED,
    canTransition,
    gamePhaseToFlags,
    isActivePhase,
    isTerminalPhase,
} from './types/GamePhase';
