/**
 * AudioLoader Worker 메시지 타입 (Discriminated Union)
 *
 * Main ↔ Worker 경계의 페이로드를 한 곳에 모아 타입 안전성을 보장한다.
 * - `LoaderInbound`: Main → Worker
 * - `LoaderOutbound`: Worker → Main
 *
 * Worker 내부에서는 `postFromWorker`로 outbound 메시지를 보낼 수 있다.
 * `(self as unknown as { postMessage })` 같은 cast가 더 이상 필요 없다.
 */
import type {
    WorkerProgressPayload,
    WorkerLoadedPayload,
    WorkerDonePayload,
    WorkerErrorPayload,
} from './types';

/**
 * Worker가 메인 스레드로부터 받는 메시지
 */
export interface FileMap {
    [key: string]: string;
}

export interface LoadAudioPayload {
    baseUrl: string;
    fileMap: FileMap;
}

export type LoaderInbound = {
    type: 'LOAD_AUDIO';
    payload: LoadAudioPayload;
};

/**
 * Worker가 메인 스레드로 보내는 메시지
 */
export type LoaderOutbound =
    | { type: 'PROGRESS'; payload: WorkerProgressPayload }
    | { type: 'LOADED'; payload: WorkerLoadedPayload }
    | { type: 'DONE'; payload: WorkerDonePayload }
    | { type: 'ERROR'; payload: WorkerErrorPayload };

/**
 * Worker `self` 협소화 헬퍼
 *
 * `DedicatedWorkerGlobalScope`로 캐스트하여 광범위한 `WorkerGlobalScope.postMessage`
 * 시그니처 대신 union 타입으로 좁힌 postMessage를 사용한다.
 */
export function postFromLoaderWorker(
    msg: LoaderOutbound,
    transfer?: Transferable[],
): void {
    const scope = self as unknown as DedicatedWorkerGlobalScope;
    if (transfer && transfer.length > 0) {
        scope.postMessage(msg, transfer);
    } else {
        scope.postMessage(msg);
    }
}
