/**
 * AudioDecoder.ts
 *
 * Solely responsible for ArrayBuffer → AudioBuffer decoding.
 * - Wraps decodeAudioData + falls back to a silent buffer on error.
 * - Abort support (aborted flag injected from outside).
 */

import type { AudioBufferStore } from './AudioBufferStore';

export class AudioDecoder {
    private decodedCount = 0;

    constructor(
        private readonly audioContext: AudioContext,
        private readonly store: AudioBufferStore,
        private readonly getAborted: () => boolean,
    ) {}

    get count(): number {
        return this.decodedCount;
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
     * Returns immediately when already in the store or aborted.
     */
    async decodeOne(key: string, arrayBuffer: ArrayBuffer): Promise<void> {
        if (this.getAborted()) return;
        if (this.store.has(key)) return;

        // Handle detached ArrayBuffers.
        if (arrayBuffer.byteLength === 0) {
            this.store.set(key, this.createSilent());
            this.decodedCount++;
            return;
        }

        try {
            const audioBuf = await this.audioContext.decodeAudioData(arrayBuffer);
            if (this.getAborted()) return;
            this.store.set(key, audioBuf);
            this.decodedCount++;
        } catch (err: unknown) {
            if (this.getAborted()) return;
            console.error(`[AudioDecoder] decodeOne fail key=${key}`, err);
            this.store.set(key, this.createSilent());
            this.decodedCount++;
        }
    }

    /**
     * Batch decoding. Races against the abort promise so it can be interrupted.
     */
    async decodeAll(
        entries: Iterable<[string, ArrayBuffer]>,
        abortPromise: Promise<void>,
    ): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const [key, arrayBuf] of entries) {
            if (this.store.has(key)) continue;

            if (arrayBuf.byteLength === 0) {
                this.store.set(key, this.createSilent());
                this.decodedCount++;
                continue;
            }

            const p = this.audioContext
                .decodeAudioData(arrayBuf)
                .then((audioBuf) => {
                    if (this.getAborted()) return;
                    this.store.set(key, audioBuf);
                    this.decodedCount++;
                })
                .catch((err: unknown) => {
                    if (this.getAborted()) return;
                    console.error(`[AudioDecoder] decodeAll fail key=${key}`, err);
                    this.store.set(key, this.createSilent());
                    this.decodedCount++;
                });
            promises.push(p);
        }

        await Promise.race([Promise.all(promises), abortPromise]);
    }

    /**
     * Waits for progressive decoding to finish (waitForDecoding).
     * storeSize: total key count; timeout in ms.
     */
    async waitForAll(storeSize: () => number, timeout = 30_000): Promise<void> {
        const start = Date.now();
        while (this.decodedCount < storeSize()) {
            if (Date.now() - start > timeout) {
                console.warn(`[AudioDecoder] waitForAll timeout: ${this.decodedCount}/${storeSize()}`);
                break;
            }
            await new Promise<void>((r) => setTimeout(r, 50));
        }
    }
}
