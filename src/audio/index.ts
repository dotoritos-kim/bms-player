/**
 * BMS Audio Module
 *
 * BMS 파일의 키음을 로드하고 재생하는 기능을 제공합니다.
 * Worker와 AudioWorklet을 사용하여 고성능 오디오 재생을 지원합니다.
 *
 * @example Worker 사용 (Vite)
 * ```typescript
 * // Consumers must provide their own Worker instantiation:
 * import AudioLoaderWorkerUrl from '@rhythm-archive/bms-player/audio/loader/AudioLoader.worker?worker';
 * import { AudioPreloader } from '@rhythm-archive/bms-player/audio';
 *
 * const worker = new AudioLoaderWorkerUrl();
 * const preloader = new AudioPreloader(baseUrl, fileMap, worker);
 * await preloader.loadAll();
 * await preloader.decodeAll();
 * await preloader.initAudioWorklet();
 * preloader.playAudio('key');
 * ```
 */

// Cache
export { audioIndexedDBCache, type CachedAudioEntry, type CacheMetadata } from './cache';

// Store (KeysoundPlayer instance caching)
export { useKeysoundPlayerStore, hashKeysounds } from './store';

// Loader
export { AudioPreloader, type FileMap, type WorkerFactory, type AudioPreloaderOptions } from './loader/AudioPreloader';
export { AudioProcessorWorkletUrl } from './loader/AudioProcessor.worklet';
export { PlayerAudio, createClosestNoteFinder } from './loader/AudioPlayer';
export type {
    Track,
    StereoTrack,
    StereoPlayData,
    MonoPlayData,
    AudioProcessorMessageType,
    AudioProcessorPostMessage,
    WorkerMessageType,
    WorkerResponseType,
    WorkerProgressPayload,
    WorkerLoadedPayload,
    WorkerDonePayload,
    WorkerErrorPayload,
} from './loader/types';

// Judgements / Notechart
export { Notechart } from './judgements';
export type {
    NotechartInput,
    ExpertJudgmentWindow,
    NotechartImages,
    PlayerOptions,
    GameEvent,
    SoundedEvent,
    GameNote,
    GameLandmine,
    NoteInfo,
} from './judgements';
