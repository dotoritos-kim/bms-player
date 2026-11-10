/**
 * The worker loop runs on performance.now(), the music on the audio clock.
 * Without correction a 0.05 % rate difference is 90 ms after three minutes,
 * more than the whole GREAT window. The main thread reports the audio clock;
 * the worker follows it.
 */
import { ClockSlew } from '../src/game/clockSlew';
import { WorkerGameLoop } from '../src/game/WorkerGameLoop';
import { GameEngine } from '../src/game/GameEngine';
import type { InputHandler } from '../src/game/InputHandler';
import type { KeysoundPlayer } from '../src/types/KeysoundPlayer';
import type { GameNote, INotechart, Notechart } from '../src/audio/judgements';

/** Runs `seconds` of reports every 500 ms; returns the largest |error| in the last 10 s. */
function follow(seconds: number, audioRate: number, noiseMs = 0): number {
  const slew = new ClockSlew();
  let local = 0;
  let worst = 0;
  for (let t = 500; t <= seconds * 1000; t += 500) {
    local += 500;
    const audio = t * audioRate;
    // Audio time is read in render quanta: it lags the true value by 0..noiseMs.
    const reported = audio - (noiseMs ? ((t / 500) % 4) * (noiseMs / 3) : 0);
    local += slew.correction(reported - local);
    if (t > (seconds - 10) * 1000) worst = Math.max(worst, Math.abs(audio - local));
  }
  return worst;
}

describe('ClockSlew', () => {
  it('holds a drifting clock within a few ms over three minutes (uncorrected: 90 ms)', () => {
    expect(follow(180, 1.0005)).toBeLessThan(3);
    expect(follow(180, 0.9995)).toBeLessThan(3);
  });

  it('is not thrown about by quantised audio-clock reads', () => {
    expect(follow(60, 1, 6)).toBeLessThan(7);
  });

  it('removes a start offset gradually, never more than 4 ms per report', () => {
    const slew = new ClockSlew();
    let error = 20;
    for (let i = 0; i < 40; i++) {
      const step = slew.correction(error);
      expect(Math.abs(step)).toBeLessThanOrEqual(4);
      error -= step;
    }
    expect(Math.abs(error)).toBeLessThan(1);
  });

  it('re-aligns at once after a large gap, and ignores reports from another clock domain', () => {
    expect(new ClockSlew().correction(300)).toBe(300);
    expect(new ClockSlew().correction(5000)).toBe(0);
    expect(new ClockSlew().correction(Number.NaN)).toBe(0);
  });
});

describe('WorkerGameLoop clock reports', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  it('reports the audio-clock game time while playing, not while paused or stopped', async () => {
    const posted: Array<{ type: string; payload?: { gameTimeMs?: number } }> = [];
    const worker = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(msg: { type: string }) {
        posted.push(msg);
        if (msg.type === 'init') queueMicrotask(() => worker.onmessage?.({ data: { type: 'ready' } }));
      },
    };
    const audioContext = { currentTime: 10, state: 'running', resume: async () => {} };
    const loop = new WorkerGameLoop({
      notechart: { notes: [], autos: [], landmines: [], duration: 60, secondsToBeat: (s: number) => s, beatToSeconds: (b: number) => b } as unknown as Notechart,
      keysoundPlayer: { isReady: true, play: () => {}, stopAll: () => {}, dispose: () => {} } as KeysoundPlayer,
      audioContext: audioContext as unknown as AudioContext,
      worker: worker as unknown as Worker,
      inputHandler: { onKeyDown: () => {}, onKeyUp: () => {}, setEnabled: () => {}, releaseAll: () => {}, dispose: () => {} } as unknown as InputHandler,
    });
    const syncs = () => posted.filter((m) => m.type === 'clockSync');

    await loop.start();
    audioContext.currentTime = 12.5; // 2.5 s of audio since the start
    vi.advanceTimersByTime(500);
    expect(syncs()).toHaveLength(1);
    expect(syncs()[0].payload!.gameTimeMs).toBeCloseTo(2500, 5);

    loop.pause();
    vi.advanceTimersByTime(2000);
    expect(syncs()).toHaveLength(1);

    loop.resume();
    vi.advanceTimersByTime(500);
    expect(syncs()).toHaveLength(2);

    loop.stop();
    vi.advanceTimersByTime(2000);
    expect(syncs()).toHaveLength(2);
    loop.dispose();
  });
});

describe('GameEngine.setAutoplay', () => {
  const note = (id: number, column: string, time: number): GameNote => ({ id, column, time, keysound: 'k' }) as GameNote;
  const chart = (notes: GameNote[]): INotechart => ({
    notes, autos: [], landmines: [], duration: 60,
    secondsToBeat: (s: number) => s, beatToSeconds: (b: number) => b,
  });

  it('turned on mid-song, autoplay hits the notes from there on', () => {
    const engine = new GameEngine({ notechart: chart([note(1, '1', 1), note(2, '1', 2)]) });
    engine.start();
    expect(engine.tick(1000).judgments).toHaveLength(0); // waiting for the player
    engine.setAutoplay(true);
    const hits = [...engine.tick(1005).judgments, ...engine.tick(2000).judgments];
    expect(hits.map((j) => j.judgment)).toEqual(['PGREAT', 'PGREAT']);
  });

  it('turned off mid-song, the player\'s keys judge again and held keys are known', () => {
    const engine = new GameEngine({ notechart: chart([note(1, '1', 1), note(2, '2', 2)]), autoplay: true });
    engine.start();
    engine.handleKeyDown('2', 500); // pressed under autoplay: not judged, but tracked
    expect(engine.isKeyHeld('2')).toBe(true);
    engine.handleKeyUp('2', 600);
    expect(engine.isKeyHeld('2')).toBe(false);
    engine.tick(1000);
    engine.setAutoplay(false);
    const result = engine.handleKeyDown('2', 2005);
    expect(result.judgments.map((j) => j.judgment)).toEqual(['PGREAT']);
  });
});
