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
});
