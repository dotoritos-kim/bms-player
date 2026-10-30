/**
 * AudioDecoder — progressive decodes and decodeAll must share in-flight work.
 * decodeAudioData detaches its ArrayBuffer; decodeAll used to see the detached
 * (0-byte) buffer of a still-running progressive decode and store silence.
 */

import { describe, it, expect } from 'vitest';
import { AudioDecoder } from '../src/audio/pipeline/AudioDecoder';
import { AudioBufferStore } from '../src/audio/pipeline/AudioBufferStore';

function fakeContext() {
    const pending: Array<() => void> = [];
    const ctx = {
        sampleRate: 44100,
        createBuffer: (_c: number, length: number) => ({ duration: length / 44100, silent: true }),
        decodeAudioData: (buf: ArrayBuffer) => {
            const size = buf.byteLength;
            // Simulate detaching like the real API
            structuredClone(buf, { transfer: [buf] });
            return new Promise((resolve) => {
                pending.push(() => resolve({ duration: size, silent: false }));
            });
        },
    };
    return { ctx: ctx as unknown as AudioContext, flush: () => pending.splice(0).forEach((f) => f()) };
}

describe('AudioDecoder', () => {
    it('decodeAll waits for a running progressive decode instead of storing silence', async () => {
        const { ctx, flush } = fakeContext();
        const store = new AudioBufferStore('dec-test', false);
        const decoder = new AudioDecoder(ctx, store, () => false);
        const buf = new ArrayBuffer(16);

        const progressive = decoder.decodeOne('01', buf);
        expect(buf.byteLength).toBe(0); // detached by decodeAudioData

        const all = decoder.decodeAll([['01', buf]], new Promise(() => {}));
        flush();
        await Promise.all([progressive, all]);

        const stored = store.get('01') as unknown as { silent: boolean; duration: number };
        expect(stored.silent).toBe(false);
        expect(stored.duration).toBe(16);
        expect(decoder.count).toBe(1);
    });

    it('counts keys already in the shared cache, so waitForAll returns', async () => {
        const { ctx, flush } = fakeContext();
        // a first player for the folder decodes into the global cache
        const first = new AudioDecoder(ctx, new AudioBufferStore('shared-folder', true), () => false);
        const p = first.decodeOne('01', new ArrayBuffer(8));
        flush();
        await p;

        // a second player for the same folder finds it there
        const second = new AudioDecoder(ctx, new AudioBufferStore('shared-folder', true), () => false);
        await second.decodeOne('01', new ArrayBuffer(8));
        expect(second.count).toBe(1);
        const t0 = Date.now();
        await second.waitForAll(() => 1, 2_000);
        expect(Date.now() - t0).toBeLessThan(200);
    });

    it('counts a key decoded progressively and again in a batch once', async () => {
        const { ctx, flush } = fakeContext();
        const decoder = new AudioDecoder(ctx, new AudioBufferStore('once', false), () => false);
        const p = decoder.decodeOne('01', new ArrayBuffer(4));
        flush();
        await p;
        await decoder.decodeAll([['01', new ArrayBuffer(4)]], new Promise(() => {}));
        expect(decoder.count).toBe(1);
    });
});
