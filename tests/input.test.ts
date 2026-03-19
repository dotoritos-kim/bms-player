import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEY_MAP,
  ALT_KEY_MAP,
  KEY_MAP_2P,
} from '../src/game/InputHandler';

/**
 * InputHandler relies on DOM APIs (window.addEventListener, KeyboardEvent, performance.now()).
 * We test only the pure data/logic parts: key mappings and exported constants.
 *
 * The InputHandler class itself cannot be instantiated in a Node.js environment
 * because its constructor calls `window.addEventListener`, which requires a DOM.
 */

describe('InputHandler key mappings', () => {
  // ── DEFAULT_KEY_MAP ─────────────────────────────────────────────

  describe('DEFAULT_KEY_MAP', () => {
    it('should map ShiftLeft to SC', () => {
      expect(DEFAULT_KEY_MAP['ShiftLeft']).toBe('SC');
    });

    it('should map KeyZ to SC', () => {
      expect(DEFAULT_KEY_MAP['KeyZ']).toBe('SC');
    });

    it('should map SDFJKL to columns 1-3, 5-7', () => {
      expect(DEFAULT_KEY_MAP['KeyS']).toBe('1');
      expect(DEFAULT_KEY_MAP['KeyD']).toBe('2');
      expect(DEFAULT_KEY_MAP['KeyF']).toBe('3');
      expect(DEFAULT_KEY_MAP['KeyJ']).toBe('5');
      expect(DEFAULT_KEY_MAP['KeyK']).toBe('6');
      expect(DEFAULT_KEY_MAP['KeyL']).toBe('7');
    });

    it('should map Space to column 4', () => {
      expect(DEFAULT_KEY_MAP['Space']).toBe('4');
    });

    it('should have 9 mapped keys total (ShiftLeft and KeyZ both map to SC)', () => {
      expect(Object.keys(DEFAULT_KEY_MAP).length).toBe(9);
    });

    it('should cover all 7K+SC columns', () => {
      const columns = new Set(Object.values(DEFAULT_KEY_MAP));
      expect(columns).toContain('SC');
      for (let i = 1; i <= 7; i++) {
        expect(columns).toContain(String(i));
      }
    });
  });

  // ── ALT_KEY_MAP ─────────────────────────────────────────────────

  describe('ALT_KEY_MAP', () => {
    it('should map KeyA to column 1 (shifted from S)', () => {
      expect(ALT_KEY_MAP['KeyA']).toBe('1');
    });

    it('should still map Space to column 4', () => {
      expect(ALT_KEY_MAP['Space']).toBe('4');
    });

    it('should cover all 7K+SC columns', () => {
      const columns = new Set(Object.values(ALT_KEY_MAP));
      expect(columns).toContain('SC');
      for (let i = 1; i <= 7; i++) {
        expect(columns).toContain(String(i));
      }
    });
  });

  // ── KEY_MAP_2P ──────────────────────────────────────────────────

  describe('KEY_MAP_2P', () => {
    it('should map ShiftRight to SC (2P scratch is on the right)', () => {
      expect(KEY_MAP_2P['ShiftRight']).toBe('SC');
    });

    it('should map Semicolon as alternative SC', () => {
      expect(KEY_MAP_2P['Semicolon']).toBe('SC');
    });

    it('should map main keys to columns 1-7', () => {
      expect(KEY_MAP_2P['KeyS']).toBe('1');
      expect(KEY_MAP_2P['KeyD']).toBe('2');
      expect(KEY_MAP_2P['KeyF']).toBe('3');
      expect(KEY_MAP_2P['Space']).toBe('4');
      expect(KEY_MAP_2P['KeyJ']).toBe('5');
      expect(KEY_MAP_2P['KeyK']).toBe('6');
      expect(KEY_MAP_2P['KeyL']).toBe('7');
    });
  });

  // ── Key map consistency ─────────────────────────────────────────

  describe('key map consistency', () => {
    it('should not have undefined values in any key map', () => {
      for (const val of Object.values(DEFAULT_KEY_MAP)) {
        expect(val).toBeDefined();
        expect(typeof val).toBe('string');
      }
      for (const val of Object.values(ALT_KEY_MAP)) {
        expect(val).toBeDefined();
        expect(typeof val).toBe('string');
      }
      for (const val of Object.values(KEY_MAP_2P)) {
        expect(val).toBeDefined();
        expect(typeof val).toBe('string');
      }
    });

    it('all key maps should use valid BMS column names', () => {
      const validColumns = new Set(['SC', 'SC2', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14']);
      for (const map of [DEFAULT_KEY_MAP, ALT_KEY_MAP, KEY_MAP_2P]) {
        for (const col of Object.values(map)) {
          expect(validColumns.has(col)).toBe(true);
        }
      }
    });
  });
});
