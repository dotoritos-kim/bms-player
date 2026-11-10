/**
 * Pause must not cut the audio for good. A BMS BGM is often one long sample
 * started once; the loops used to `stopAll()` on pause and nothing restarted
 * it, so the rest of the song was silent after resuming. They now freeze the
 * player (`pauseAll`) and continue it (`resumeAll`); players without those
 * methods keep the old cut.
 */
import { WorkerGameLoop } from '../src/game/WorkerGameLoop';
import { GameLoop } from '../src/game/GameLoop';
import type { InputHandler } from '../src/game/InputHandler';
import type { KeysoundPlayer } from '../src/types/KeysoundPlayer';
import type { Notechart } from '../src/audio/judgements';

const notechart = {
  notes: [],
  autos: [{ time: 0, keysound: 'bgm' }],
  landmines: [],
  duration: 60,
  secondsToBeat: (s: number) => s * 2,
  beatToSeconds: (b: number) => b / 2,
} as unknown as Notechart;

const inputHandler = () => ({
  onKeyDown: () => {},
  onKeyUp: () => {},
  setEnabled: () => {},
  releaseAll: () => {},
  dispose: () => {},
}) as unknown as InputHandler;

const audioContext = () => ({ currentTime: 0, state: 'running', resume: async () => {} }) as unknown as AudioContext;

function player(withPause: boolean) {
  const calls: string[] = [];
  const p: KeysoundPlayer = {
    isReady: true,
    play: () => { calls.push('play'); },
    stopAll: () => { calls.push('stopAll'); },
    dispose: () => {},
    ...(withPause ? { pauseAll: () => { calls.push('pauseAll'); }, resumeAll: () => { calls.push('resumeAll'); } } : {}),
  };
  return { p, calls };
}

function workerLoop(p: KeysoundPlayer) {
  // Fake worker: answers `init` with `ready`, ignores the rest.
  const worker = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onerror: null,
    postMessage(msg: { type: string }) {
      if (msg.type === 'init') queueMicrotask(() => worker.onmessage?.({ data: { type: 'ready' } }));
    },
  };
  return new WorkerGameLoop({
    notechart, keysoundPlayer: p, audioContext: audioContext(), worker: worker as unknown as Worker, inputHandler: inputHandler(),
  });
}

function mainLoop(p: KeysoundPlayer) {
  return new GameLoop({ notechart, keysoundPlayer: p, audioContext: audioContext(), inputHandler: inputHandler() });
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['WorkerGameLoop', workerLoop],
  ['GameLoop', mainLoop],
])('%s pause / resume audio', (_name, make) => {
  it('freezes and continues the audio instead of stopping it', async () => {
    const { p, calls } = player(true);
    const loop = make(p);
    await loop.start();
    calls.length = 0;

    loop.pause();
    expect(calls).toEqual(['pauseAll']);

    loop.resume();
    expect(calls).toEqual(['pauseAll', 'resumeAll']);
    loop.dispose();
  });

  it('stop from the pause menu drops the frozen audio and unfreezes the player', async () => {
    const { p, calls } = player(true);
    const loop = make(p);
    await loop.start();
    loop.pause();
    calls.length = 0;

    loop.stop();
    expect(calls.slice(0, 2)).toEqual(['stopAll', 'resumeAll']);
    loop.dispose();
  });

  it('falls back to stopAll for a player without pauseAll', async () => {
    const { p, calls } = player(false);
    const loop = make(p);
    await loop.start();
    calls.length = 0;

    loop.pause();
    expect(calls).toEqual(['stopAll']);
    loop.resume();
    loop.dispose();
  });
});
