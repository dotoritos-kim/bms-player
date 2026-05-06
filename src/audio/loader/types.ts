/**
 * AudioWorklet type definitions.
 *
 * A simplified type system for stereo audio playback.
 */

/**
 * Stereo-track structure.
 */
export interface StereoTrack {
    leftData: Float32Array;
    rightData: Float32Array;
    readIndex: number;
    isPlaying: boolean;
    loop: boolean;
}

/**
 * Mono-track structure (kept for backward compatibility).
 */
export interface Track {
    data: Float32Array;
    readIndex: number;
    isPlaying: boolean;
    loop: boolean;
}

/**
 * Playback payload — stereo variant.
 */
export interface StereoPlayData {
    bufferLeft: Float32Array;
    bufferRight: Float32Array;
    loop: boolean;
    /** Playback offset in seconds — used when seeking. */
    offset?: number;
    /** Scheduled AudioContext time (0 = play immediately). */
    scheduledTime?: number;
    /** Volume (0-1). */
    volume?: number;
}

/**
 * Playback payload — mono variant (kept for backward compatibility).
 */
export interface MonoPlayData {
    buffer: Float32Array;
    loop: boolean;
    /** Playback offset in seconds — used when seeking. */
    offset?: number;
    /** Scheduled AudioContext time (0 = play immediately). */
    scheduledTime?: number;
    /** Volume (0-1). */
    volume?: number;
}

/**
 * Message types sent into the AudioWorklet.
 */
export type AudioProcessorMessageType =
    | 'play'
    | 'stop'
    | 'stopAll'
    | 'clear'
    | 'clearAll'
    | 'setVolume'
    | 'adjustVolume'
    | 'setPlaybackRate';

/**
 * Envelope for messages posted into the AudioWorklet.
 */
export interface AudioProcessorPostMessage {
    type: AudioProcessorMessageType;
    key: string;
    data?:
        | null // 'stop' | 'clear' | 'stopAll' | 'clearAll'
        | number // 'setVolume' | 'adjustVolume'
        | StereoPlayData
        | MonoPlayData;
}

/**
 * Message type received from the worker.
 */
export type WorkerMessageType = 'LOAD_AUDIO';

/**
 * Response types sent back to the worker.
 */
export type WorkerResponseType = 'PROGRESS' | 'LOADED' | 'DONE' | 'ERROR';

/**
 * Worker progress payload.
 */
export interface WorkerProgressPayload {
    key: string;
    fileName: string;
    loadedCount: number;
    total: number;
}

/**
 * Worker load-completed payload.
 */
export interface WorkerLoadedPayload {
    key: string;
    fileName: string;
    arrayBuffer: ArrayBuffer;
}

/**
 * Worker done payload.
 */
export interface WorkerDonePayload {
    total: number;
    loaded: number;
}

/**
 * Worker error payload.
 */
export interface WorkerErrorPayload {
    key: string;
    fileName: string;
    message: string;
}
