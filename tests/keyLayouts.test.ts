/**
 * Every lane of every key mode needs a key. The saved bindings only name SC
 * and keys 1-7, so 9K, 10K, 14K and the wide modes had lanes no key reached.
 */
import { loadKeyBindingsFor, saveKeyBindingsFor } from '../src/game/keyLayouts';
import { bindingsToKeyMap } from '../src/game/KeyBindingSettings';
import { LANE_CONFIG_MAP } from '../src/game/canvas/laneConfig';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('loadKeyBindingsFor', () => {
  // 48K has more lanes than a keyboard has rows for; see the next test.
  it.each(Object.keys(LANE_CONFIG_MAP).filter((m) => !m.startsWith('48K')))('%s: every lane has its own key', (mode) => {
    const bindings = loadKeyBindingsFor(mode);
    const lanes = LANE_CONFIG_MAP[mode].map((l) => l.column);
    for (const column of lanes) expect(bindings[column], `${mode} lane ${column}`).toBeTruthy();
    // No key shared by two lanes of the mode (the key map would keep only one).
    const keys = lanes.map((c) => bindings[c]);
    expect(new Set(keys).size).toBe(keys.length);
    const keyMap = bindingsToKeyMap(bindings);
    for (const column of lanes) expect(Object.values(keyMap)).toContain(column);
  });

  it('48K binds as many lanes as four keyboard rows allow, each to its own key', () => {
    const bindings = loadKeyBindingsFor('48K');
    const keys = Object.values(bindings);
    expect(keys.length).toBe(45);
    expect(new Set(keys).size).toBe(45);
  });

  it('single-side modes keep the saved bindings', () => {
    store.set('bms_key_bindings', JSON.stringify({ SC: 'KeyA', '1': 'KeyQ' }));
    expect(loadKeyBindingsFor('7K')).toEqual({ SC: 'KeyA', '1': 'KeyQ' });
    expect(loadKeyBindingsFor('5K+SC')).toEqual({ SC: 'KeyA', '1': 'KeyQ' });
  });

  it('other modes ignore the single-side bindings and read their own', () => {
    store.set('bms_key_bindings', JSON.stringify({ SC: 'KeyA', '1': 'KeyQ' }));
    expect(loadKeyBindingsFor('14K')['1']).toBe('KeyZ');
    saveKeyBindingsFor('14K', { ...loadKeyBindingsFor('14K'), '1': 'KeyQ' });
    expect(loadKeyBindingsFor('7K+SC DP')['1']).toBe('KeyQ');
  });
});
