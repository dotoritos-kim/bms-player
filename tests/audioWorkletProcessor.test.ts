/**
 * AudioProcessor worklet tests — runs the worklet source against a minimal
 * AudioWorkletGlobalScope stub (sampleRate / currentTime / registerProcessor).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { workletCode } from '../src/audio/loader/AudioProcessor.worklet';

const SR = 1000; // tiny sample rate keeps the numbers readable
const BLOCK = 128;

interface Processor {
    handleMessage(msg: { type: string; key: string; data?: unknown }): void;
    process(inputs: unknown[], outputs: Float32Array[][]): boolean;
    tracks: Map<string, unknown>;
}

function createProcessor(scope: { currentTime: number }): Processor {
    let Ctor: (new () => Processor) | null = null;
    class AudioWorkletProcessorStub {
        port = { onmessage: null as unknown, postMessage: () => {} };
    }
    // Sloppy-mode Function so `with` can expose a live `currentTime`.
    const run = new Function(
        'scope',
        `with (scope) { ${workletCode}\n }`,
    );
    run(new Proxy({
        AudioWorkletProcessor: AudioWorkletProcessorStub,
        registerProcessor: (_name: string, c: new () => Processor) => { Ctor = c; },
        sampleRate: SR,
    } as Record<string, unknown>, {
        has: (t, k) => k in t || k === 'currentTime',
        get: (t, k) => (k === 'currentTime' ? scope.currentTime : t[k as string]),
    }));
    if (!Ctor) throw new Error('processor not registered');
    return new (Ctor as new () => Processor)();
}

function render(p: Processor, blocks = 1, scope?: { currentTime: number }): Float32Array[] {
    const out: Float32Array[] = [];
    for (let b = 0; b < blocks; b++) {
        const left = new Float32Array(BLOCK);
        const right = new Float32Array(BLOCK);
        p.process([], [[left, right]]);
        out.push(left);
        if (scope) scope.currentTime += BLOCK / SR;
    }
    return out;
}

const constant = (value: number, length: number) => new Float32Array(length).fill(value);

describe('AudioProcessor worklet', () => {
    let scope: { currentTime: number };
    let p: Processor;

    beforeEach(() => {
        scope = { currentTime: 1 };
        p = createProcessor(scope);
        p.handleMessage({ type: 'setVolume', key: '', data: 1 });
    });

    it('plays registered buffers by key without resending sample data', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.25, 4000) } });
        p.handleMessage({ type: 'play', key: 'a', data: { bufferKey: '01', loop: false } });
        p.handleMessage({ type: 'play', key: 'b', data: { bufferKey: '01', loop: false } });
        const [block] = render(p);
        expect(block[10]).toBeCloseTo(0.5, 5);
    });

    it('treats volume 0 as silent (not as the default 1.0)', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.5, 4000) } });
        p.handleMessage({ type: 'play', key: 'a', data: { bufferKey: '01', loop: false, volume: 0 } });
        const [block] = render(p);
        expect(Math.max(...block.map(Math.abs))).toBe(0);
    });

    it('limits the summed output instead of hard clipping', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.6, 4000) } });
        for (let i = 0; i < 20; i++) {
            p.handleMessage({ type: 'play', key: `t${i}`, data: { bufferKey: '01', loop: false } });
        }
        const blocks = render(p, 4);
        for (const b of blocks) {
            for (const v of b) expect(Math.abs(v)).toBeLessThanOrEqual(0.98 + 1e-6);
        }
        // Steady state sits at the ceiling, not at a clipped 1.0.
        expect(blocks[3][64]).toBeCloseTo(0.98, 3);
    });

    it('chokes the previous voice of the same group when a new one starts', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.3, 4000) } });
        p.handleMessage({ type: 'play', key: 'a', data: { bufferKey: '01', loop: false, chokeGroup: '01' } });
        render(p, 1, scope);
        p.handleMessage({ type: 'play', key: 'b', data: { bufferKey: '01', loop: false, chokeGroup: '01' } });
        render(p, 3, scope); // fade (128 samples) completes
        const [block] = render(p, 1, scope);
        expect(block[50]).toBeCloseTo(0.3, 5); // one voice, not two stacked
        expect(p.tracks.size).toBe(1);
    });

    it('starts a scheduled voice at its sample offset inside the block', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.4, 4000) } });
        p.handleMessage({
            type: 'play', key: 'a',
            data: { bufferKey: '01', loop: false, scheduledTime: scope.currentTime + 0.05 },
        });
        const [block] = render(p);
        expect(block[49]).toBe(0);
        expect(block[50]).toBeCloseTo(0.4, 5);
    });

    it('skips the elapsed part of a late play when catchUp is set', () => {
        const ramp = new Float32Array(4000);
        for (let i = 0; i < ramp.length; i++) ramp[i] = i / 10000;
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: ramp } });
        p.handleMessage({
            type: 'play', key: 'a',
            data: { bufferKey: '01', loop: false, scheduledTime: scope.currentTime - 0.1, catchUp: true },
        });
        const [block] = render(p);
        // 0.1 s late at 1000 Hz → starts reading at sample 100
        expect(block[0]).toBeCloseTo(100 / 10000, 5);
    });

    it('fades out on stop instead of cutting (no click) and then drops the track', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.5, 4000) } });
        p.handleMessage({ type: 'play', key: 'a', data: { bufferKey: '01', loop: false } });
        render(p);
        p.handleMessage({ type: 'stop', key: 'a' });
        const [block] = render(p);
        expect(block[0]).toBeGreaterThan(0.45);
        expect(block[0]).toBeGreaterThan(block[100]);
        render(p);
        expect(p.tracks.size).toBe(0);
    });

    it('pauseAll freezes a sounding voice and resumeAll continues it from the same sample', () => {
        const ramp = new Float32Array(4000);
        for (let i = 0; i < ramp.length; i++) ramp[i] = i / 10000;
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: ramp } });
        p.handleMessage({ type: 'play', key: 'a', data: { bufferKey: '01', loop: false } });
        render(p, 2, scope); // samples 0..255
        p.handleMessage({ type: 'pauseAll', key: '' });
        const [fade] = render(p, 1, scope); // fades out over this block (256..383)
        expect(Math.abs(fade[127])).toBe(0);
        const silent = render(p, 20, scope); // a long pause
        for (const b of silent) expect(Math.max(...b.map(Math.abs))).toBe(0);
        expect(p.tracks.size).toBe(1);
        p.handleMessage({ type: 'resumeAll', key: '' });
        render(p, 1, scope); // fades back in (384..511)
        const [block] = render(p, 1, scope);
        expect(block[0]).toBeCloseTo(512 / 10000, 5); // not restarted, not skipped ahead
    });

    it('keeps the remaining delay of a scheduled voice across a pause', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.4, 4000) } });
        p.handleMessage({
            type: 'play', key: 'a',
            data: { bufferKey: '01', loop: false, scheduledTime: scope.currentTime + 0.2 }, // 200 samples ahead
        });
        p.handleMessage({ type: 'pauseAll', key: '' });
        render(p, 1, scope); // fade-out block still counts 128 samples of the delay
        render(p, 30, scope); // paused far past the scheduled time
        p.handleMessage({ type: 'resumeAll', key: '' });
        const [block] = render(p, 1, scope);
        expect(block[71]).toBe(0);
        expect(block[72]).toBeGreaterThan(0); // 200 - 128 samples after the resume
        const [next] = render(p, 1, scope);
        expect(next[0]).toBeCloseTo(0.4, 5);
    });

    it('stopAll while paused drops the frozen voices (nothing sounds after resume)', () => {
        p.handleMessage({ type: 'register', key: '01', data: { bufferLeft: constant(0.5, 4000) } });
        p.handleMessage({ type: 'play', key: 'a', data: { bufferKey: '01', loop: false } });
        render(p, 1, scope);
        p.handleMessage({ type: 'pauseAll', key: '' });
        render(p, 2, scope);
        p.handleMessage({ type: 'stopAll', key: '' });
        expect(p.tracks.size).toBe(0);
        p.handleMessage({ type: 'resumeAll', key: '' });
        const blocks = render(p, 2, scope);
        for (const b of blocks) expect(Math.max(...b.map(Math.abs))).toBe(0);
    });
});
