/**
 * AudioDecoder.ts
 *
 * ArrayBuffer → AudioBuffer 디코딩 책임만 담당한다.
 * - decodeAudioData 래핑 + 에러 시 무음 버퍼 폴백
 * - abort 지원 (외부에서 aborted 플래그 주입)
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

    /** 무음(1초) AudioBuffer 생성 헬퍼 */
    private createSilent(): AudioBuffer {
        return this.audioContext.createBuffer(
            1,
            this.audioContext.sampleRate,
            this.audioContext.sampleRate,
        );
    }

    /**
     * 단일 키 디코딩.
     * 이미 스토어에 있거나 abort되면 즉시 반환.
     */
    async decodeOne(key: string, arrayBuffer: ArrayBuffer): Promise<void> {
        if (this.getAborted()) return;
        if (this.store.has(key)) return;

        // detach된 ArrayBuffer 처리
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
     * 배치 디코딩. abort promise와 race해서 중단 지원.
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
     * 점진적 디코딩 완료 대기 (waitForDecoding).
     * storeSize: 전체 키 수, timeout ms.
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
