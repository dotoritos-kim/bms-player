/**
 * KeysoundPlayer lifecycle: init() builds the preloader with the default
 * loader worker, `preloader` exposes it (GameLoop reads its AudioContext) and
 * dispose() clears it. AudioPreloader and the worker are faked; there is no
 * Web Audio in the test environment.
 */
import { KeysoundPlayer } from '../src/audio/KeysoundPlayer';

const created: Array<{ baseUrl: string; fileMap: Record<string, string>; worker: unknown }> = [];

vi.mock('../src/audio/loader/AudioPreloader', () => ({
  AudioPreloader: class {
    context = { state: 'running', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    downloadedCount = 0;
    downloadedTotal = 0;
    constructor(baseUrl: string, fileMap: Record<string, string>, worker: unknown) {
      created.push({ baseUrl, fileMap, worker });
    }
    loadAndInitParallel = vi.fn().mockResolvedValue(undefined);
    setMasterVolume = vi.fn();
    releaseAllResources = vi.fn();
    stopAllAudio = vi.fn();
  },
}));

const defaultWorker = { kind: 'default-loader-worker' };
vi.mock('../src/audio/loader/createAudioLoaderWorker', () => ({
  createAudioLoaderWorker: vi.fn(() => defaultWorker),
}));

beforeAll(() => {
  // detectFrameDuration samples requestAnimationFrame
  let t = 0;
  (globalThis as { requestAnimationFrame?: (cb: (ts: number) => void) => number }).requestAnimationFrame = (cb) => {
    t += 16;
    setTimeout(() => cb(t), 0);
    return t;
  };
});

beforeEach(() => {
  created.length = 0;
});

describe('KeysoundPlayer', () => {
  it('uses the default loader worker when no workerFactory is given', async () => {
    const player = new KeysoundPlayer({ baseUrl: 'http://x/song/', keysounds: { '01': 'kick.wav' } });
    await player.init();
    expect(created).toHaveLength(1);
    expect(created[0].worker).toBe(defaultWorker);
    expect(created[0].baseUrl).toBe('http://x/song');
  });

  it('prefers a given workerFactory', async () => {
    const mine = { kind: 'mine' };
    const player = new KeysoundPlayer({
      baseUrl: 'http://x',
      keysounds: { '01': 'kick.wav' },
      workerFactory: () => mine as unknown as Worker,
    });
    await player.init();
    expect(created[0].worker).toBe(mine);
  });

  it('exposes the loaded preloader and clears it on dispose', async () => {
    const player = new KeysoundPlayer({ baseUrl: 'http://x', keysounds: { '01': 'kick.wav' } });
    expect(player.preloader).toBeUndefined();
    await player.load();
    expect(player.isReady).toBe(true);
    expect(player.preloader).toBeDefined();
    expect(player.preloader?.context).toBeDefined();
    player.dispose();
    expect(player.preloader).toBeUndefined();
    expect(player.isReady).toBe(false);
  });
});
