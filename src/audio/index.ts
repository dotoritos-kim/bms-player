/**
 * BMS Audio Module
 *
 * Provides loading and playback of BMS keysounds. Uses Workers and the
 * AudioWorklet API for high-performance audio playback.
 *
 * @example Worker usage (Vite)
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

// Resolve (keysound file resolution)
export {
    resolveKeysoundFiles,
    resolveKeysounds,
    extractStem,
    type ResolveOptions,
    type AudioFileMapFetcher,
} from './loader/resolveKeysoundFiles';

// KeysoundPlayer (concrete class wrapping AudioPreloader)
export {
    KeysoundPlayer,
    createKeysoundPlayer,
    type KeysoundPlayerOptions,
    type KeysoundPlayerResolveConfig,
} from './KeysoundPlayer';

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
