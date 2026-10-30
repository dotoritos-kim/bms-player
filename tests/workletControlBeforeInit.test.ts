/**
 * Control calls made while the worklet module is still loading: stop / clear
 * are no-ops without an error, master volume and playback rate are applied
 * once the node exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkletPlayback } from '../src/audio/pipeline/WorkletPlayback';
import { AudioBufferStore } from '../src/audio/pipeline/AudioBufferStore';

describe('WorkletPlayback before initWorklet', () => {
    const posted: Array<{ type: string; data: unknown }> = [];
    let OriginalNode: unknown;

    beforeEach(() => {
        posted.length = 0;
        OriginalNode = (globalThis as Record<string, unknown>).AudioWorkletNode;
        (globalThis as Record<string, unknown>).AudioWorkletNode = class {
            port = { postMessage: (m: { type: string; data: unknown }) => posted.push(m) };
            disconnect() {}
        };
    });
    afterEach(() => {
        (globalThis as Record<string, unknown>).AudioWorkletNode = OriginalNode;
        vi.restoreAllMocks();
    });

    it('skips stop / clear and keeps volume and rate for later', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ctx = { audioWorklet: { addModule: vi.fn(async () => {}) } } as unknown as AudioContext;
        const playback = new WorkletPlayback(ctx, new AudioBufferStore('ctl', false), { build: vi.fn() } as never);

        playback.stopAllAudio();
        playback.clearAllAudio();
        playback.stopAudio('t1');
        playback.setMasterVolume(0.3);
        playback.setPlaybackRate(1.5);
        playback.dispose();
        expect(error).not.toHaveBeenCalled();
        expect(posted).toEqual([]);

        await playback.initWorklet('blob:x');
        expect(posted).toEqual([
            { type: 'setVolume', key: '', data: 0.3 },
            { type: 'setPlaybackRate', key: '', data: 1.5 },
        ]);
    });
});
