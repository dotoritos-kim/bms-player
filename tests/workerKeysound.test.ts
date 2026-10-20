/**
 * Worker-mode keysound dedup (hybrid keysound).
 *
 * WorkerGameLoop plays the keysound for a press instantly from the nextNotes
 * cache; the worker must then only judge. Before the fix the worker's
 * GameEngine also emitted an immediate playSound for the hit, so every hit
 * keysound played twice.
 *
 * The real GameLoopWorker module is wired to WorkerGameLoop through a
 * synchronous fake Worker so the whole round trip is exercised.
 */
import { GameEngine } from '../src/game/GameEngine';
import { WorkerGameLoop } from '../src/game/WorkerGameLoop';
import type { InputHandler, KeyInput } from '../src/game/InputHandler';
import type { KeysoundPlayer } from '../src/types/KeysoundPlayer';
import type { GameNote, INotechart, SoundedEvent } from '../src/audio/judgements';
import type { Notechart } from '../src/audio/judgements';

type WorkerScope = {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: { data: unknown }) => void) | null;
};

const scope: WorkerScope = { postMessage: () => {}, onmessage: null };

beforeAll(async () => {
  (globalThis as unknown as { self: WorkerScope }).self = scope;
  await import('../src/game/GameLoopWorker');
});

afterAll(() => {
  delete (globalThis as unknown as { self?: WorkerScope }).self;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function note(id: number, column: string, time: number, keysound?: string): GameNote {
  return { id, column, time, keysound } as GameNote;
}

function makeNotechart(notes: GameNote[], autos: SoundedEvent[] = []): INotechart {
  return {
    notes,
    autos,
    landmines: [],
    duration: 60,
    secondsToBeat: (s: number) => s * 2,
    beatToSeconds: (b: number) => b / 2,
  };
}

function setup(notes: GameNote[], opts: { autos?: SoundedEvent[]; autoplay?: boolean } = {}) {
  const play = vi.fn();
  const keysoundPlayer = { play, stopAll: vi.fn() } as unknown as KeysoundPlayer;

  let keyDown: ((i: KeyInput) => void) | undefined;
  let keyUp: ((i: KeyInput) => void) | undefined;
  const inputHandler = {
    onKeyDown: (cb: (i: KeyInput) => void) => { keyDown = cb; },
    onKeyUp: (cb: (i: KeyInput) => void) => { keyUp = cb; },
    setEnabled: () => {},
    dispose: () => {},
  } as unknown as InputHandler;

  // Synchronous fake Worker: main → worker via scope.onmessage,
  // worker → main via worker.onmessage.
  const worker = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onerror: null,
    postMessage: (msg: unknown) => scope.onmessage?.({ data: msg }),
  };
  scope.postMessage = (msg: unknown) => worker.onmessage?.({ data: msg });

  const audioContext = { currentTime: 0, state: 'running', resume: async () => {} };
  const loop = new WorkerGameLoop({
    notechart: makeNotechart(notes, opts.autos) as unknown as Notechart,
    keysoundPlayer,
    audioContext: audioContext as unknown as AudioContext,
    worker: worker as unknown as Worker,
    inputHandler,
    autoplay: opts.autoplay,
  });

  const press = (column: string) => {
    keyDown!({ column, time: 0, type: 'down' } as KeyInput);
    keyUp!({ column, time: 0, type: 'up' } as KeyInput);
  };
  const playedKeysounds = () => play.mock.calls.map((c) => c[0]);
  return { loop, play, press, playedKeysounds };
}

describe('WorkerGameLoop — one keysound per press', () => {
  it('plays a cached hit keysound exactly once', async () => {
    const t = setup([note(1, '1', 0, 'k1'), note(2, '1', 10, 'k3')]);
    await t.loop.start();
    vi.advanceTimersByTime(5); // one worker tick fills the nextNotes cache

    t.press('1');

    expect(t.playedKeysounds()).toEqual(['k1']);
    t.loop.dispose();
  });

  it('falls back to the worker sound exactly once when the cache has no entry', async () => {
    const t = setup([note(1, '2', 0, 'k2')]);
    await t.loop.start();
    // No tick yet → nextNotes cache is empty.

    t.press('2');

    expect(t.playedKeysounds()).toEqual(['k2']);
    t.loop.dispose();
  });

  it('rapid repeated presses on one column each sound once', async () => {
    const t = setup([note(1, '1', 0, 'k1'), note(2, '1', 10, 'k3')]);
    await t.loop.start();
    vi.advanceTimersByTime(5);

    t.press('1'); // hits k1; worker refreshes cache to k3
    t.press('1'); // empty press: main plays the next note's sound, worker judges nothing

    expect(t.playedKeysounds()).toEqual(['k1', 'k3']);
    t.loop.dispose();
  });

  it('sounds the judged note when the cache still holds an earlier unjudged note', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const t = setup([note(1, '1', 0, 'kA'), note(2, '1', 0.1, 'kB')]);
    await t.loop.start();
    vi.advanceTimersByTime(5); // cache: column 1 → kA
    vi.advanceTimersByTime(95); // A not missed yet, B is exactly on time

    t.press('1');

    // Main plays the cached kA; the worker judges B and must still play kB.
    expect(t.playedKeysounds()).toEqual(['kA', 'kB']);
    t.loop.dispose();
  });

  it('autoplay and BGM sounds emitted by the worker still play once', async () => {
    const t = setup(
      [note(1, '1', 0, 'k1')],
      { autos: [{ time: 0.02, keysound: 'bgm' } as SoundedEvent], autoplay: true },
    );
    await t.loop.start();
    vi.advanceTimersByTime(5);

    expect(t.playedKeysounds().sort()).toEqual(['bgm', 'k1']);
    const bgmCall = t.play.mock.calls.find((c) => c[0] === 'bgm')!;
    expect(bgmCall[2]).toBeGreaterThan(0); // scheduled, not immediate
    t.loop.dispose();
  });
});

describe('GameEngine.handleKeyDown — playedKeysound', () => {
  it('emits the hit sound by default (non-worker GameLoop path)', () => {
    const engine = new GameEngine({ notechart: makeNotechart([note(1, '1', 0, 'k1')]) });
    engine.start();
    const r = engine.handleKeyDown('1', 0);
    expect(r.sounds.map((s) => s.keysound)).toEqual(['k1']);
    expect(r.judgments).toHaveLength(1);
  });

  it('judges but skips the hit sound when the caller already played it', () => {
    const engine = new GameEngine({ notechart: makeNotechart([note(1, '1', 0, 'k1')]) });
    engine.start();
    const r = engine.handleKeyDown('1', 0, { keysound: 'k1', offset: 0 });
    expect(r.sounds).toEqual([]);
    expect(r.judgments.map((j) => j.judgment)).toEqual(['PGREAT']);
  });

  it('still sounds the judged note when the caller played a different (cached) note', () => {
    // A (t=0) is still inside its miss window, so the main-thread cache holds A,
    // but the press at t=100ms is judged against B.
    const engine = new GameEngine({
      notechart: makeNotechart([note(1, '1', 0, 'kA'), note(2, '1', 0.1, 'kB')]),
    });
    engine.start();
    const r = engine.handleKeyDown('1', 100, { keysound: 'kA', offset: 0 });
    expect(r.sounds.map((s) => s.keysound)).toEqual(['kB']);
    expect(r.judgments.map((j) => j.judgment)).toEqual(['PGREAT']);
  });
});

describe('GameEngine — pre-played keysound is not repeated on MISS', () => {
  it('an empty press that pre-played the next note keeps its MISS silent', () => {
    // Note at 1s; press at 0ms is outside the 200ms window → empty press,
    // but the main thread already played k1 from the nextNotes cache.
    const engine = new GameEngine({ notechart: makeNotechart([note(1, '1', 1, 'k1')]) });
    engine.start();
    const press = engine.handleKeyDown('1', 0, { keysound: 'k1', offset: 0 });
    expect(press.judgments).toHaveLength(0);
    expect(press.sounds).toEqual([]);

    const miss = engine.tick(1500);
    expect(miss.judgments.map((j) => j.judgment)).toEqual(['MISS']);
    expect(miss.sounds.map((s) => s.keysound)).toEqual([]);
  });

  it('a MISS without a prior press still sounds (existing behaviour)', () => {
    const engine = new GameEngine({ notechart: makeNotechart([note(1, '1', 1, 'k1')]) });
    engine.start();
    const miss = engine.tick(1500);
    expect(miss.sounds.map((s) => s.keysound)).toEqual(['k1']);
  });

  it('pre-playing a different sound than the pending note does not silence it', () => {
    const engine = new GameEngine({ notechart: makeNotechart([note(1, '1', 1, 'k1')]) });
    engine.start();
    engine.handleKeyDown('1', 0, { keysound: 'other', offset: 0 });
    expect(engine.tick(1500).sounds.map((s) => s.keysound)).toEqual(['k1']);
  });

  it('a press judged against a later note marks the cached earlier note', () => {
    // Cache holds kA (t=0, still inside its miss window); press at 100ms judges kB.
    const engine = new GameEngine({
      notechart: makeNotechart([note(1, '1', 0, 'kA'), note(2, '1', 0.1, 'kB')]),
    });
    engine.start();
    const r = engine.handleKeyDown('1', 100, { keysound: 'kA', offset: 0 });
    expect(r.sounds.map((s) => s.keysound)).toEqual(['kB']);
    const miss = engine.tick(500);
    expect(miss.judgments.map((j) => j.judgment)).toEqual(['MISS']);
    expect(miss.sounds).toEqual([]);
  });
});

describe('GameEngine — landmine damage and #TOTAL', () => {
  function mineChart(damage: number | undefined): INotechart {
    const mine = { id: 9, column: '1', time: 0, damage } as GameNote;
    return { ...makeNotechart([note(1, '2', 5, 'k')]), landmines: [mine] };
  }

  it('a mine with damage 0 (#xxxD1:00-equivalent) is harmless', () => {
    const engine = new GameEngine({ notechart: mineChart(0) });
    engine.start();
    const before = engine.buildState(0).gaugeValue;
    const r = engine.handleKeyDown('1', 0);
    expect(r.landmines.map((m) => m.damage)).toEqual([0]);
    expect(engine.buildState(0).gaugeValue).toBe(before);
  });

  it('a mine with chart damage uses it; a mine without damage keeps the 5% fallback', () => {
    const e1 = new GameEngine({ notechart: mineChart(10) });
    e1.start();
    expect(e1.handleKeyDown('1', 0).landmines[0].damage).toBe(10);
    const e2 = new GameEngine({ notechart: mineChart(undefined) });
    e2.start();
    expect(e2.handleKeyDown('1', 0).landmines[0].damage).toBe(5);
  });

  it('#TOTAL below 100 is used as-is (not clamped to 100)', () => {
    const notes = Array.from({ length: 10 }, (_, i) => note(i + 1, '1', 1 + i, 'k'));
    const gaugeAfterOneHit = (total: number) => {
      const engine = new GameEngine({ notechart: makeNotechart(notes), total });
      engine.start();
      const start = engine.buildState(1000).gaugeValue;
      engine.handleKeyDown('1', 1000);
      return engine.buildState(1000).gaugeValue - start;
    };
    // groove: PGREAT adds TOTAL / notes
    expect(gaugeAfterOneHit(50)).toBeCloseTo(5, 5);
    expect(gaugeAfterOneHit(200)).toBeCloseTo(20, 5);
  });
});
