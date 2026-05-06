/**
 * AudioBufferStore.ts
 *
 * AudioBuffer 의 메모리 캐시(LRU) 관리를 담당한다.
 * - 글로벌 LRU Map(globalAudioBufferCache) 래핑
 * - 인스턴스별 prefix 격리
 * - AudioBuffer 저장/조회/해제
 */

// ---- 글로벌 LRU 캐시 (인스턴스 간 공유, 선택적 사용) ----
const globalAudioBufferCache = new Map<string, AudioBuffer>();
const CACHE_MAX_SIZE = 500;

function addToGlobalCache(key: string, buffer: AudioBuffer): void {
    if (globalAudioBufferCache.size >= CACHE_MAX_SIZE) {
        const firstKey = globalAudioBufferCache.keys().next().value;
        if (firstKey) globalAudioBufferCache.delete(firstKey);
    }
    globalAudioBufferCache.set(key, buffer);
}

function getFromGlobalCache(key: string): AudioBuffer | undefined {
    const buffer = globalAudioBufferCache.get(key);
    if (buffer) {
        // LRU: 최근 사용된 항목을 끝으로 이동
        globalAudioBufferCache.delete(key);
        globalAudioBufferCache.set(key, buffer);
    }
    return buffer;
}

// ---- AudioBufferStore 클래스 ----

export class AudioBufferStore {
    /** 로컬(인스턴스) 버퍼 맵 */
    private readonly localBuffers = new Map<string, AudioBuffer>();
    private readonly cachePrefix: string;
    private readonly useGlobalCache: boolean;

    constructor(cachePrefix: string, useGlobalCache = true) {
        this.cachePrefix = cachePrefix;
        this.useGlobalCache = useGlobalCache;
    }

    private globalKey(key: string): string {
        return `${this.cachePrefix}:${key}`;
    }

    /** 버퍼 저장 (로컬 + 글로벌 캐시) */
    set(key: string, buffer: AudioBuffer): void {
        this.localBuffers.set(key, buffer);
        if (this.useGlobalCache) {
            addToGlobalCache(this.globalKey(key), buffer);
        }
    }

    /** 버퍼 조회. 로컬 → 글로벌 캐시 순서 */
    get(key: string): AudioBuffer | undefined {
        const local = this.localBuffers.get(key);
        if (local) return local;
        if (this.useGlobalCache) {
            const cached = getFromGlobalCache(this.globalKey(key));
            if (cached) {
                // 로컬에도 올려둠
                this.localBuffers.set(key, cached);
                return cached;
            }
        }
        return undefined;
    }

    has(key: string): boolean {
        return this.localBuffers.has(key) ||
            (this.useGlobalCache && getFromGlobalCache(this.globalKey(key)) !== undefined);
    }

    size(): number {
        return this.localBuffers.size;
    }

    /** 인스턴스 소유 캐시 전체 해제 */
    clear(): void {
        if (this.useGlobalCache) {
            const prefix = `${this.cachePrefix}:`;
            for (const k of globalAudioBufferCache.keys()) {
                if (k.startsWith(prefix)) globalAudioBufferCache.delete(k);
            }
        }
        this.localBuffers.clear();
    }

    /** 저장된 모든 키 순회 */
    keys(): IterableIterator<string> {
        return this.localBuffers.keys();
    }
}
