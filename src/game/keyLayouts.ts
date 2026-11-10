/**
 * Default keyboard layout per key mode.
 *
 * The saved bindings (`loadKeyBindings`) describe one side: SC and keys 1-7.
 * Charts in other modes have lanes those bindings never named (9K keys 8-9,
 * the 2P side of 10K / 14K, ...), so those lanes had no key at all and their
 * notes could only be missed. Every mode gets a key for each lane here.
 */

import { loadKeyBindings, type KeyBindings } from './KeyBindingSettings';
import { LANE_CONFIG_MAP } from './canvas/laneConfig';

const STORAGE_PREFIX = 'bms_key_bindings_';

/** Lanes covered by the single-side bindings the settings dialog edits. */
const SINGLE_SIDE_COLUMNS = new Set(['SC', '1', '2', '3', '4', '5', '6', '7']);

// Double play, LR2-style: left hand on the Z row, right hand on the M row.
const DP_1P_KEYS = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyF', 'KeyV'];
const DP_2P_KEYS = ['KeyM', 'KeyK', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];

// Rows used to fill the wide keyboard modes from left to right.
const ROW_DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
const ROW_Q = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'];
const ROW_A = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const ROW_Z = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];

function numbered(keys: string[], firstColumn = 1): KeyBindings {
  const bindings: KeyBindings = {};
  keys.forEach((code, i) => { bindings[String(firstColumn + i)] = code; });
  return bindings;
}

const MODE_DEFAULTS: Record<string, KeyBindings> = {
  '9K': numbered(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']),
  '10K': {
    SC: 'ShiftLeft', ...numbered(DP_1P_KEYS.slice(0, 5)),
    ...numbered(DP_2P_KEYS.slice(0, 5), 8), SC2: 'ShiftRight',
  },
  '12K': { ...numbered(DP_1P_KEYS.slice(0, 6)), ...numbered(DP_2P_KEYS.slice(0, 6), 7) },
  '14K': {
    SC: 'ShiftLeft', ...numbered(DP_1P_KEYS),
    ...numbered(DP_2P_KEYS, 8), SC2: 'ShiftRight',
  },
  '18K': { ...numbered(ROW_A.slice(0, 9)), ...numbered(ROW_Q.slice(0, 9), 10) },
  '24K': { ...numbered(ROW_DIGITS), ...numbered(ROW_Q, 13) },
  // More lanes than keys on four rows: the last three stay unbound.
  '48K': numbered([...ROW_DIGITS, ...ROW_Q, ...ROW_A, ...ROW_Z]),
};
// The upper turntables have no key left either.
MODE_DEFAULTS['48K+4SC'] = { ...MODE_DEFAULTS['48K'], SC: 'ShiftLeft', SC2: 'ShiftRight' };

/** '7K+SC' / '7K+SC DP' style names → the lane-config names used here. */
function normalizeKeyMode(keyMode: string | undefined): string {
  if (!keyMode) return '7K';
  if (keyMode === '7K+SC DP') return '14K';
  if (keyMode === '5K+SC DP') return '10K';
  return keyMode.replace(/\+SC$/, '');
}

/** Whether every lane of the mode is one the single-side bindings name. */
function isSingleSideMode(mode: string): boolean {
  const lanes = LANE_CONFIG_MAP[mode];
  return !lanes || lanes.every((lane) => SINGLE_SIDE_COLUMNS.has(lane.column));
}

/**
 * Key bindings (column → `KeyboardEvent.code`) to play `keyMode` with.
 * 4K-8K use the player's saved single-side bindings; the other modes use
 * their own saved bindings when present, else the mode's default layout.
 */
export function loadKeyBindingsFor(keyMode: string | undefined): KeyBindings {
  const mode = normalizeKeyMode(keyMode);
  if (isSingleSideMode(mode)) return loadKeyBindings();
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + mode);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') return parsed as KeyBindings;
    }
  } catch {
    // Unreadable storage: fall through to the defaults.
  }
  return { ...(MODE_DEFAULTS[mode] ?? loadKeyBindings()) };
}

/** Saves the bindings of a mode that does not use the single-side bindings. */
export function saveKeyBindingsFor(keyMode: string, bindings: KeyBindings): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + normalizeKeyMode(keyMode), JSON.stringify(bindings));
  } catch {
    // Ignore
  }
}
