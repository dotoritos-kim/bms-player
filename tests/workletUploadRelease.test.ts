/**
 * releaseAfterUpload — once a buffer is uploaded to the AudioWorklet, the
 * main thread keeps only an UploadedBuffer stand-in (metadata + peaks), so
 * keysound-heavy charts don't hold their PCM twice.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkletPlayback } from '../src/audio/pipeline/WorkletPlayback';
import { AudioBufferStore } from '../src/audio/pipeline/AudioBufferStore';
import { UploadedBuffer } from '../src/audio/pipeline/UploadedBuffer';

function fakeBuffer(samples: number[], channels = 1): AudioBuffer {
    const data = Float32Array.from(samples);
    return {
        duration: samples.length / 1000,
        length: samples.length,
        numberOfChannels: channels,
        sampleRate: 1000,
        getChannelData: () => data,
    } as unknown as AudioBuffer;
}

describe('WorkletPlayback releaseAfterUpload', () => {
    const posted: Array<{ type: string; key: string }> = [];
    let OriginalNode: unknown;

    beforeEach(() => {
        posted.length = 0;
        OriginalNode = (globalThis as Record<string, unknown>).AudioWorkletNode;
        (globalThis as Record<string, unknown>).AudioWorkletNode = class {
            port = { postMessage: (m: { type: string; key: string }) => posted.push(m) };
            disconnect() {}
        };
    });
    afterEach(() => {
        (globalThis as Record<string, unknown>).AudioWorkletNode = OriginalNode;
    });

    async function setup(release: boolean) {
        const ctx = { state: 'running', resume: vi.fn(), audioWorklet: { addModule: vi.fn(async () => {}) } } as unknown as AudioContext;
        const store = new AudioBufferStore('upload-test', false);
        const effects = { build: vi.fn() } as never;
        const playback = new WorkletPlayback(ctx, store, effects, release);
        await playback.initWorklet('blob:x');
        return { store, playback };
    }

    it('swaps the decoded buffer for a stand-in and registers once', async () => {
        const { store, playback } = await setup(true);
        const samples = Array.from({ length: 300 }, (_, i) => (i === 200 ? -0.9 : 0.1));
        store.set('01', fakeBuffer(samples));

        expect(playback.playAudioSync('01')).toBeTruthy();
        expect(playback.playAudioSync('01')).toBeTruthy();

        expect(posted.filter((m) => m.type === 'register')).toHaveLength(1);
        expect(posted.filter((m) => m.type === 'play')).toHaveLength(2);
        const stored = store.get('01');
        expect(stored).toBeInstanceOf(UploadedBuffer);
        expect(stored!.duration).toBeCloseTo(0.3, 6);
        // peak envelope: blocks of 128 samples; block 1 holds the 0.9 spike
        expect(Array.from((stored as unknown as UploadedBuffer).peaks).map((v) => +v.toFixed(2))).toEqual([0.1, 0.9, 0.1]);
    });

    it('keeps the decoded buffer when release is off', async () => {
        const { store, playback } = await setup(false);
        const buf = fakeBuffer([0.5, 0.5, 0.5]);
        store.set('01', buf);
        playback.playAudioSync('01');
        expect(store.get('01')).toBe(buf);
    });
});
