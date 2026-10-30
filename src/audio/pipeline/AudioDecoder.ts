/**
 * AudioDecoder.ts
 *
 * Solely responsible for ArrayBuffer → AudioBuffer decoding.
 * - Wraps decodeAudioData + falls back to a silent buffer on error.
 * - Abort support (aborted flag injected from outside).
 */

import type { AudioBufferStore } from './AudioBufferStore';

export class AudioDecoder {
    /**
     * Keys that have a buffer, decoded here or found in the store. A Set, not
     * a counter: a key found in the shared cache (another player for the same
     * folder decoded it) never got counted, so waitForAll() waited out its
     * 30 s timeout; and a key decoded progressively and again in a batch must
     * count once.
     */
    private readonly decoded = new Set<string>();
    /** Decodes in flight per key (progressive + batch share them). */
    private readonly inFlight = new Map<string, Promise<void>>();

    constructor(
        private readonly audioContext: AudioContext,
        private readonly store: AudioBufferStore,
        private readonly getAborted: () => boolean,
    ) {}

    get count(): number {
        return this.decoded.size;
    }

    /** Helper that creates a silent (1 s) AudioBuffer. */
    private createSilent(): AudioBuffer {
        return this.audioContext.createBuffer(
            1,
            this.audioContext.sampleRate,
            this.audioContext.sampleRate,
        );
    }

    /**
     * Decodes a single key.
     * Returns immediately when already in the store or aborted; joins the
     * in-flight decode when one is already running for the key.
     */
    decodeOne(key: string, arrayBuffer: ArrayBuffer): Promise<void> {
        if (this.getAborted()) return Promise.resolve();
        const pending = this.inFlight.get(key);
        if (pending) return pending;
        if (this.store.has(key)) {
            this.decoded.add(key);
            return Promise.resolve();
        }

        // A detached ArrayBuffer here means nobody is decoding it any more.
        if (arrayBuffer.byteLength === 0) {
            this.store.set(key, this.createSilent());
            this.decoded.add(key);
            return Promise.resolve();
        }

        const p = this.audioContext
            .decodeAudioData(arrayBuffer)
            .then((audioBuf) => {
                if (this.getAborted()) return;
                this.store.set(key, audioBuf);
                this.decoded.add(key);
            })
            .catch((err: unknown) => {
                if (this.getAborted()) return;
                console.error(`[AudioDecoder] decode fail key=${key}`, err);
                this.store.set(key, this.createSilent());
                this.decoded.add(key);
            })
            .finally(() => {
                this.inFlight.delete(key);
            });
        this.inFlight.set(key, p);
        return p;
    }

    /**
     * Batch decoding. Races against the abort promise so it can be interrupted.
     * Waits for progressive decodes already running for the same keys instead of
     * treating their (detached) ArrayBuffers as empty files.
     */
    async decodeAll(
        entries: Iterable<[string, ArrayBuffer]>,
        abortPromise: Promise<void>,
    ): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [key, arrayBuf] of entries) {
            promises.push(this.decodeOne(key, arrayBuf));
        }
        await Promise.race([Promise.all(promises), abortPromise]);
    }

    /**
     * Waits for progressive decoding to finish (waitForDecoding).
     * storeSize: total key count; timeout in ms.
     */
    async waitForAll(storeSize: () => number, timeout = 30_000): Promise<void> {
        const start = Date.now();
        while (this.decoded.size < storeSize()) {
            if (Date.now() - start > timeout) {
                console.warn(`[AudioDecoder] waitForAll timeout: ${this.decoded.size}/${storeSize()}`);
                break;
            }
            await new Promise<void>((r) => setTimeout(r, 50));
        }
    }
}
