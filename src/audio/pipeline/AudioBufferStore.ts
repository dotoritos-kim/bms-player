/**
 * AudioBufferStore.ts
 *
 * Manages the in-memory (LRU) cache of AudioBuffers.
 * - Wraps the global LRU Map (globalAudioBufferCache).
 * - Per-instance prefix isolation.
 * - AudioBuffer store/lookup/release.
 */

// ---- Global LRU cache (shared across instances, opt-in) ----
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
        // LRU: move the most recently used entry to the end.
        globalAudioBufferCache.delete(key);
        globalAudioBufferCache.set(key, buffer);
    }
    return buffer;
}

// ---- AudioBufferStore class ----

export class AudioBufferStore {
    /** Local (per-instance) buffer map. */
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

    /** Stores a buffer (local + global cache). */
    set(key: string, buffer: AudioBuffer): void {
        this.localBuffers.set(key, buffer);
        if (this.useGlobalCache) {
            addToGlobalCache(this.globalKey(key), buffer);
        }
    }

    /** Looks up a buffer. Local first, then the global cache. */
    get(key: string): AudioBuffer | undefined {
        const local = this.localBuffers.get(key);
        if (local) return local;
        if (this.useGlobalCache) {
            const cached = getFromGlobalCache(this.globalKey(key));
            if (cached) {
                // Promote it to the local map too.
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

    /** Releases every cache entry owned by this instance. */
    clear(): void {
        if (this.useGlobalCache) {
            const prefix = `${this.cachePrefix}:`;
            for (const k of globalAudioBufferCache.keys()) {
                if (k.startsWith(prefix)) globalAudioBufferCache.delete(k);
            }
        }
        this.localBuffers.clear();
    }

    /** Iterates over all stored keys. */
    keys(): IterableIterator<string> {
        return this.localBuffers.keys();
    }
}
