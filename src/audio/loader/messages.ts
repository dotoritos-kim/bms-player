/**
 * AudioLoader worker message types (discriminated union).
 *
 * Gathers the payloads crossing the Main ↔ Worker boundary in one place for type safety.
 * - `LoaderInbound`: Main → Worker
 * - `LoaderOutbound`: Worker → Main
 *
 * Inside the worker, outbound messages can be sent with `postFromWorker`;
 * casts like `(self as unknown as { postMessage })` are no longer needed.
 */
import type {
    WorkerProgressPayload,
    WorkerLoadedPayload,
    WorkerDonePayload,
    WorkerErrorPayload,
} from './types';

/**
 * Messages the worker receives from the main thread.
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
 * Messages the worker sends to the main thread.
 */
export type LoaderOutbound =
    | { type: 'PROGRESS'; payload: WorkerProgressPayload }
    | { type: 'LOADED'; payload: WorkerLoadedPayload }
    | { type: 'DONE'; payload: WorkerDonePayload }
    | { type: 'ERROR'; payload: WorkerErrorPayload };

/**
 * Worker `self` narrowing helper.
 *
 * Casts to `DedicatedWorkerGlobalScope` so that postMessage is narrowed to the
 * union type instead of the broad `WorkerGlobalScope.postMessage` signature.
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
