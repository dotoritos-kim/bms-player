/**
 * AudioFetchPipeline.ts
 *
 * Worker 통신 + IndexedDB 캐시 체크로 ArrayBuffer 를 수집하는 파이프라인.
 * - IndexedDB에서 먼저 히트 조회
 * - 미스된 키는 Worker(LOAD_AUDIO)로 fetch
 * - 수집된 ArrayBuffer를 audioDataMap 에 저장
 * - 콜백(`onWorkerMessage`, `onLoaded`)으로 상위(AudioPreloader) 에 알림
 */

import type { LoaderOutbound, FileMap } from '../loader/messages';
import { audioIndexedDBCache } from '../cache';
import type { AudioDecoder } from './AudioDecoder';

function makeIndexedDBKey(baseUrl: string, filename: string): string {
    return `${baseUrl}/${filename}`;
}

export class AudioFetchPipeline {
    readonly audioDataMap = new Map<string, ArrayBuffer>();

    private loadingProgress = 0;
    private loadedCount = 0;
    private totalCount = 0;
    private _isWorkerDone = false;
    private _abortResolve: (() => void) | undefined;

    constructor(
        private readonly baseUrl: string,
        private readonly fileMap: FileMap,
        private readonly worker: Worker,
        private readonly useIndexedDBCache: boolean,
        /** 점진적 디코딩을 위한 콜백 */
        private readonly onLoaded: (key: string, buf: ArrayBuffer) => void,
        /** 외부 onWorkerMessage 콜백 (KeysoundPlayer 등) */
        private readonly onWorkerMessage?: (type: string, payload: unknown) => void,
    ) {
        this.worker.onmessage = (e: MessageEvent<LoaderOutbound>) => {
            const msg = e.data;
            if (this.onWorkerMessage) this.onWorkerMessage(msg.type, msg.payload);

            switch (msg.type) {
                case 'PROGRESS': {
                    const p = msg.payload;
                    this.loadedCount = p.loadedCount;
                    this.totalCount = p.total;
                    this.loadingProgress = p.loadedCount / p.total;
                    break;
                }
                case 'LOADED': {
                    const p = msg.payload;
                    this.audioDataMap.set(p.key, p.arrayBuffer);
                    if (this.useIndexedDBCache) {
                        const idbKey = makeIndexedDBKey(this.baseUrl, this.fileMap[p.key] || p.key);
                        audioIndexedDBCache.set(idbKey, p.arrayBuffer.slice(0)).catch(() => {});
                    }
                    this.onLoaded(p.key, p.arrayBuffer);
                    break;
                }
                case 'DONE':
                    this._isWorkerDone = true;
                    break;
                case 'ERROR': {
                    const p = msg.payload;
                    console.error(`[AudioFetchPipeline] key=${p.key}, file=${p.fileName}, msg=${p.message}`);
                    break;
                }
            }
        };
    }

    get progress(): number { return this.loadingProgress; }
    get downloaded(): number { return this.loadedCount; }
    get total(): number { return this.totalCount; }
    get isWorkerDone(): boolean { return this._isWorkerDone; }

    abort(): void {
        this._abortResolve?.();
        this._abortResolve = undefined;
    }

    async loadAll(aborted: () => boolean): Promise<void> {
        const allKeys = Object.keys(this.fileMap);
        if (allKeys.length === 0) {
            this._isWorkerDone = true;
            return;
        }

        let uncachedFileMap: FileMap = this.fileMap;
        let cachedCount = 0;

        if (this.useIndexedDBCache) {
            try {
                const cacheKeys = allKeys.map((k) => makeIndexedDBKey(this.baseUrl, this.fileMap[k]));
                const cachedData = await audioIndexedDBCache.getMany(cacheKeys);

                if (cachedData.size > 0) {
                    uncachedFileMap = {};
                    for (const key of allKeys) {
                        const idbKey = makeIndexedDBKey(this.baseUrl, this.fileMap[key]);
                        const cached = cachedData.get(idbKey);
                        if (cached) {
                            const buffer = cached.slice(0);
                            this.audioDataMap.set(key, buffer);
                            cachedCount++;
                            this.onLoaded(key, buffer);
                            if (this.onWorkerMessage) {
                                this.onWorkerMessage('LOADED', { key, arrayBuffer: cached });
                            }
                        } else {
                            uncachedFileMap[key] = this.fileMap[key];
                        }
                    }
                    console.log(`[AudioFetchPipeline] IDB hit: ${cachedCount}/${allKeys.length}`);
                }
            } catch (err: unknown) {
                console.warn('[AudioFetchPipeline] IDB check failed:', err);
                uncachedFileMap = this.fileMap;
            }
        }

        if (aborted()) return;

        const uncachedCount = Object.keys(uncachedFileMap).length;
        if (uncachedCount === 0) {
            this.loadedCount = allKeys.length;
            this.totalCount = allKeys.length;
            this.loadingProgress = 1;
            this._isWorkerDone = true;
            if (this.onWorkerMessage) {
                this.onWorkerMessage('PROGRESS', { loadedCount: allKeys.length, total: allKeys.length });
            }
            return;
        }

        this.loadedCount = cachedCount;
        this.totalCount = allKeys.length;

        return new Promise<void>((resolve) => {
            const cleanup = () => {
                this.worker.removeEventListener('message', onMessage);
                this._abortResolve = undefined;
                resolve();
            };
            this._abortResolve = cleanup;

            this.worker.postMessage({
                type: 'LOAD_AUDIO',
                payload: { baseUrl: this.baseUrl, fileMap: uncachedFileMap },
            });

            const onMessage = (e: MessageEvent) => {
                const { type, payload } = e.data;
                if (type === 'PROGRESS') {
                    this.loadedCount = cachedCount + payload.loadedCount;
                    this.loadingProgress = this.loadedCount / this.totalCount;
                }
                if (type === 'DONE') cleanup();
            };
            this.worker.addEventListener('message', onMessage);
        });
    }

    terminate(): void {
        this.worker.terminate();
        this.audioDataMap.clear();
    }
}
