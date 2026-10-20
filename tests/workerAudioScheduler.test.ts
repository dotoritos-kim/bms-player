/**
 * WorkerAudioScheduler — note times are placed on the AudioContext clock
 * (independent of worker→main message latency), and starting/seeking
 * mid-song restarts the sounds that are still ringing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkerAudioScheduler } from '../src/game/WorkerAudioScheduler';
import type { SchedulerNote } from '../src/game/AudioSchedulerWorker';

interface PlayCall { key: string; offset: number; when: number; chokeGroup?: string; catchUp?: boolean }

function setup(notes: SchedulerNote[], durations: Record<string, number>) {
    const ctx = { currentTime: 10, state: 'running' };
    const calls: PlayCall[] = [];
    const preloader = {
        context: ctx,
        getAudioDuration: (k: string) => durations[k] ?? 0,
        playAudioSync: (key: string, _loop: boolean, _u: boolean, offset: number, when: number, _v: number,
            opts?: { chokeGroup?: string; catchUp?: boolean }) => {
            calls.push({ key, offset, when, chokeGroup: opts?.chokeGroup, catchUp: opts?.catchUp });
            return key;
        },
        stopAllAudio: () => {},
    };
    const posted: unknown[] = [];
    const worker = {
        onmessage: null as ((e: MessageEvent) => void) | null,
        postMessage: (m: unknown) => posted.push(m),
        terminate: () => {},
    };
    const scheduler = new WorkerAudioScheduler({
        worker: worker as unknown as Worker,
        preloader: preloader as never,
        notes,
    });
    const fromWorker = (data: unknown) => worker.onmessage!({ data } as MessageEvent);
    return { ctx, calls, scheduler, fromWorker };
}

describe('WorkerAudioScheduler', () => {
    let env: ReturnType<typeof setup>;

    beforeEach(() => {
        env = setup([
            { sec: 0, keysound: 'bgm', offset: 0, volume: 1 },
            { sec: 4, keysound: 'kick', offset: 0, volume: 1 },
            { sec: 4.5, keysound: 'kick', offset: 0, volume: 1 },
            { sec: 6, keysound: 'snare', offset: 0, volume: 1 },
        ], { bgm: 30, kick: 1, snare: 0.2 });
    });

    it('places worker notes relative to the audio-clock anchor, not message arrival', () => {
        env.scheduler.play(6, 1);
        env.calls.length = 0;
        // Message arrives 80 ms later than the anchor (busy main thread)
        env.ctx.currentTime += 0.08;
        env.fromWorker({ type: 'playSound', payload: { keysound: 'snare', offset: 0, delaySec: 0, volume: 1, sec: 6.2 } });
        expect(env.calls).toHaveLength(1);
        // anchor = 10 + 0.05 lead; note is 0.2 s after the start position
        expect(env.calls[0].when).toBeCloseTo(10.25, 6);
        expect(env.calls[0].catchUp).toBe(true);
        expect(env.calls[0].chokeGroup).toBe('snare');
    });

    it('starting mid-song restarts still-ringing sounds, latest per keysound only', () => {
        env.scheduler.play(5, 1);
        const keys = env.calls.map((c) => c.key).sort();
        expect(keys).toEqual(['bgm', 'kick']); // snare not started yet; earlier kick choked
        const kick = env.calls.find((c) => c.key === 'kick')!;
        expect(kick.offset).toBeCloseTo(0.5, 6); // from the 4.5 s kick
        const bgm = env.calls.find((c) => c.key === 'bgm')!;
        expect(bgm.offset).toBeCloseTo(5, 6);
    });

    it('ignores late playSound messages after pause', () => {
        env.scheduler.play(0, 1);
        env.scheduler.pause();
        env.calls.length = 0;
        env.fromWorker({ type: 'playSound', payload: { keysound: 'kick', offset: 0, delaySec: 0, volume: 1, sec: 4 } });
        expect(env.calls).toHaveLength(0);
    });

    it('reports the audible position from the audio clock', () => {
        env.scheduler.play(2, 2);
        env.ctx.currentTime += 0.55; // 0.5 s after the 0.05 s lead
        expect(env.scheduler.currentSec()).toBeCloseTo(3, 6);
    });

    it('ends when the longest sample has rung out, not 2 s after the last note', () => {
        // bgm starts at 0 and lasts 30 s; last note (snare) is at 6 s
        expect(env.scheduler.endSec).toBeCloseTo(30.5, 6);
    });
});
