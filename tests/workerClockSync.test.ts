/**
 * The real GameLoopWorker module follows the audio clock reported by
 * `clockSync`: a key press is judged against the corrected game time.
 */
import type { GameNote } from '../src/audio/judgements';

type Scope = { postMessage: (msg: unknown) => void; onmessage: ((e: { data: unknown }) => void) | null };
const scope: Scope = { postMessage: () => {}, onmessage: null };
const out: Array<{ type: string; payload?: { offset?: number } }> = [];

beforeAll(async () => {
  (globalThis as unknown as { self: Scope }).self = scope;
  scope.postMessage = (msg) => { out.push(msg as { type: string }); };
  await import('../src/game/GameLoopWorker');
});
afterAll(() => { delete (globalThis as unknown as { self?: Scope }).self; });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  out.length = 0;
});
afterEach(() => {
  scope.onmessage?.({ data: { type: 'dispose' } });
  vi.useRealTimers();
});

const send = (data: unknown) => scope.onmessage!({ data });
const epochNow = () => performance.timeOrigin + performance.now();

function startWithNoteAt(seconds: number) {
  send({
    type: 'init',
    payload: {
      notechart: {
        notes: [{ id: 1, column: '1', time: seconds, keysound: 'k' } as GameNote],
        autos: [], landmines: [], duration: 60,
        beatToSecondsTable: [{ beat: 0, seconds: 0 }, { beat: 120, seconds: 60 }],
      },
      config: {},
    },
  });
  send({ type: 'start' });
}

/** Offset (ms) the worker judges a press with, made `pressAtMs` after the start. */
function judgedOffset(audioLeadMs: number, pressAtMs: number): number {
  startWithNoteAt(2);
  for (let t = 500; t < pressAtMs; t += 500) {
    vi.advanceTimersByTime(500);
    if (audioLeadMs !== 0) send({ type: 'clockSync', payload: { gameTimeMs: t + audioLeadMs, time: epochNow() } });
  }
  vi.advanceTimersByTime(pressAtMs % 500 || 500);
  out.length = 0;
  send({ type: 'keyDown', payload: { column: '1', time: epochNow() } });
  const judgment = out.find((m) => m.type === 'judgment');
  expect(judgment).toBeDefined();
  return judgment!.payload!.offset!;
}

describe('GameLoopWorker clockSync', () => {
  it('without reports a press on the note time is judged at offset 0', () => {
    expect(judgedOffset(0, 2000)).toBeCloseTo(0, 3);
  });

  it('moves towards an audio clock that is ahead: the same press is judged late', () => {
    // Audio 20 ms ahead: by the note time the worker has taken up part of it.
    const offset = judgedOffset(20, 2000);
    expect(offset).toBeGreaterThan(5);
    expect(offset).toBeLessThanOrEqual(20);
  });

  it('moves towards an audio clock that is behind: the same press is judged early', () => {
    const offset = judgedOffset(-20, 2000);
    expect(offset).toBeLessThan(-5);
    expect(offset).toBeGreaterThanOrEqual(-20);
  });
});
