import { describe, it, expect } from 'vitest';
import { fallbackTranslate, defaultMessages } from '../../src/i18n';

describe('bms-player fallback translator', () => {
  it('resolves a judgment key', () => {
    expect(fallbackTranslate('judgment.pgreat')).toBe('PGREAT');
    expect(fallbackTranslate('judgment.miss')).toBe('MISS');
  });

  it('resolves an HUD key', () => {
    expect(fallbackTranslate('hud.bpm')).toBe('BPM');
  });

  it('returns the raw key when missing', () => {
    // @ts-expect-error -- intentional unknown key
    expect(fallbackTranslate('not.a.real.key')).toBe('not.a.real.key');
  });

  it('every key in defaultMessages resolves to a non-empty string', () => {
    const walk = (obj: Record<string, unknown>, prefix = ''): void => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') {
          expect(v).toBeTruthy();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect(fallbackTranslate(key as any)).toBe(v);
        } else if (v && typeof v === 'object') {
          walk(v as Record<string, unknown>, key);
        }
      }
    };
    walk(defaultMessages as unknown as Record<string, unknown>);
  });
});
