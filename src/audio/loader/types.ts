/**
 * Audio Worklet 타입 정의
 *
 * 스테레오 오디오 재생을 위한 단순화된 타입 시스템
 */

/**
 * 스테레오 트랙 구조
 */
export interface StereoTrack {
    leftData: Float32Array;
    rightData: Float32Array;
    readIndex: number;
    isPlaying: boolean;
    loop: boolean;
}

/**
 * 모노 트랙 구조 (하위 호환성)
 */
export interface Track {
    data: Float32Array;
    readIndex: number;
    isPlaying: boolean;
    loop: boolean;
}

/**
 * 재생 데이터 - 스테레오 버전
 */
export interface StereoPlayData {
    bufferLeft: Float32Array;
    bufferRight: Float32Array;
    loop: boolean;
    /** 재생 시작 위치 (초 단위) - seek 시 offset 재생용 */
    offset?: number;
    /** AudioContext 예약 시간 (0이면 즉시 재생) */
    scheduledTime?: number;
    /** 볼륨 (0-1) */
    volume?: number;
}

/**
 * 재생 데이터 - 모노 버전 (하위 호환성)
 */
export interface MonoPlayData {
    buffer: Float32Array;
    loop: boolean;
    /** 재생 시작 위치 (초 단위) - seek 시 offset 재생용 */
    offset?: number;
    /** AudioContext 예약 시간 (0이면 즉시 재생) */
    scheduledTime?: number;
    /** 볼륨 (0-1) */
    volume?: number;
}

/**
 * AudioWorklet으로 보내는 메시지 타입
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
 * AudioWorklet 포스트 메시지 인터페이스
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
 * Worker에서 받는 메시지 타입
 */
export type WorkerMessageType = 'LOAD_AUDIO';

/**
 * Worker로 보내는 응답 타입
 */
export type WorkerResponseType = 'PROGRESS' | 'LOADED' | 'DONE' | 'ERROR';

/**
 * Worker 진행 상황 payload
 */
export interface WorkerProgressPayload {
    key: string;
    fileName: string;
    loadedCount: number;
    total: number;
}

/**
 * Worker 로드 완료 payload
 */
export interface WorkerLoadedPayload {
    key: string;
    fileName: string;
    arrayBuffer: ArrayBuffer;
}

/**
 * Worker 완료 payload
 */
export interface WorkerDonePayload {
    total: number;
    loaded: number;
}

/**
 * Worker 에러 payload
 */
export interface WorkerErrorPayload {
    key: string;
    fileName: string;
    message: string;
}
