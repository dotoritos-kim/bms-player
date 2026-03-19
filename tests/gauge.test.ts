import { describe, it, expect, beforeEach } from 'vitest';
import { GaugeSystem } from '../src/game/GaugeSystem';
import type { GaugeType } from '../src/game/GaugeSystem';

describe('GaugeSystem', () => {
  // Helper: TOTAL=200, noteCount=100 -> increase = 2 per note
  const TOTAL = 200;
  const NOTE_COUNT = 100;

  // ── GROOVE gauge ──────────────────────────────────────────────────

  describe('GROOVE gauge', () => {
    let gauge: GaugeSystem;

    beforeEach(() => {
      gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
    });

    it('should start at 22%', () => {
      expect(gauge.getValue()).toBe(22);
    });

    it('should increase on PGREAT', () => {
      const before = gauge.getValue();
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBeGreaterThan(before);
    });

    it('should increase on GREAT (same as PGREAT)', () => {
      const g1 = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      const g2 = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      g1.onJudgment('PGREAT');
      g2.onJudgment('GREAT');
      expect(g1.getValue()).toBe(g2.getValue());
    });

    it('should increase less on GOOD (half increase)', () => {
      const g1 = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      const g2 = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      g1.onJudgment('PGREAT');
      g2.onJudgment('GOOD');
      const pgreatIncrease = g1.getValue() - 22;
      const goodIncrease = g2.getValue() - 22;
      expect(goodIncrease).toBeCloseTo(pgreatIncrease * 0.5, 5);
    });

    it('should decrease on BAD (-2)', () => {
      gauge.onJudgment('BAD');
      expect(gauge.getValue()).toBe(20);
    });

    it('should decrease on POOR (-6)', () => {
      gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBe(16);
    });

    it('should decrease on MISS (-2)', () => {
      gauge.onJudgment('MISS');
      expect(gauge.getValue()).toBe(20);
    });

    it('should not go below 2% for GROOVE', () => {
      // Force gauge down with many POORs
      for (let i = 0; i < 100; i++) gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBe(2);
    });

    it('should clear at 80% for GROOVE', () => {
      // Fill gauge with PGREATs (increase=2 per note)
      for (let i = 0; i < 50; i++) gauge.onJudgment('PGREAT');
      expect(gauge.isCleared()).toBe(true);
      expect(gauge.getValue()).toBeGreaterThanOrEqual(80);
    });

    it('should not exceed 100%', () => {
      for (let i = 0; i < 200; i++) gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBeLessThanOrEqual(100);
    });

    it('should never report failed', () => {
      for (let i = 0; i < 100; i++) gauge.onJudgment('POOR');
      expect(gauge.isFailed()).toBe(false);
    });
  });

  // ── HARD gauge ────────────────────────────────────────────────────

  describe('HARD gauge', () => {
    let gauge: GaugeSystem;

    beforeEach(() => {
      gauge = new GaugeSystem('hard', TOTAL, NOTE_COUNT);
    });

    it('should start at 100%', () => {
      expect(gauge.getValue()).toBe(100);
    });

    it('should increase very slowly on PGREAT (+0.16)', () => {
      gauge.onJudgment('POOR'); // bring down first
      const before = gauge.getValue();
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue() - before).toBeCloseTo(0.16, 5);
    });

    it('should not change on GOOD', () => {
      gauge.onJudgment('POOR'); // bring down first
      const before = gauge.getValue();
      gauge.onJudgment('GOOD');
      expect(gauge.getValue()).toBe(before);
    });

    it('should decrease on BAD (-5)', () => {
      gauge.onJudgment('BAD');
      expect(gauge.getValue()).toBe(95);
    });

    it('should decrease on POOR (-9)', () => {
      gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBe(91);
    });

    it('should fail when reaching 0', () => {
      // 100 / 9 ~ 12 POORs to reach 0 (with low-HP adjustment)
      for (let i = 0; i < 50; i++) gauge.onJudgment('POOR');
      expect(gauge.isFailed()).toBe(true);
      expect(gauge.getValue()).toBe(0);
    });

    it('should not process further judgments after failure', () => {
      for (let i = 0; i < 50; i++) gauge.onJudgment('POOR');
      expect(gauge.isFailed()).toBe(true);
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBe(0); // unchanged
    });

    it('should apply low-HP adjustment below 30%', () => {
      // Bring gauge below 30%
      // 100 -> 100 - 9 = 91, ... need about 8 POORs to get to ~28
      for (let i = 0; i < 8; i++) gauge.onJudgment('POOR'); // 100 - 72 = 28
      expect(gauge.getValue()).toBeLessThanOrEqual(30);

      // Now further POOR should have halved damage (0.5 multiplier)
      const before = gauge.getValue();
      gauge.onJudgment('POOR');
      const delta = before - gauge.getValue();
      // Below 30%, damage = -9 * 0.5 = -4.5
      expect(delta).toBeCloseTo(4.5, 5);
    });

    it('should be cleared when gauge is above 0.01%', () => {
      expect(gauge.isCleared()).toBe(true); // starts at 100%
      // Even at 1% it should be cleared
      gauge.onJudgment('POOR');
      expect(gauge.isCleared()).toBe(true);
    });
  });

  // ── EX-HARD gauge ─────────────────────────────────────────────────

  describe('EX-HARD gauge', () => {
    let gauge: GaugeSystem;

    beforeEach(() => {
      gauge = new GaugeSystem('exhard', TOTAL, NOTE_COUNT);
    });

    it('should start at 100%', () => {
      expect(gauge.getValue()).toBe(100);
    });

    it('should have doubled damage compared to HARD', () => {
      // HARD BAD = -5, EX-HARD BAD = -5 * 2 = -10
      gauge.onJudgment('BAD');
      expect(gauge.getValue()).toBe(90);

      // HARD POOR = -9, EX-HARD POOR = -9 * 2 = -18
      const g2 = new GaugeSystem('exhard', TOTAL, NOTE_COUNT);
      g2.onJudgment('POOR');
      expect(g2.getValue()).toBe(82);
    });

    it('should not have low-HP adjustment (goes straight to 0)', () => {
      // EX-HARD has lowHpThreshold=0 and lowHpMultiplier=1
      // So no adjustment at low HP
      for (let i = 0; i < 4; i++) gauge.onJudgment('POOR'); // -18*4 = -72, gauge=28
      expect(gauge.getValue()).toBeLessThanOrEqual(30);

      const before = gauge.getValue();
      gauge.onJudgment('POOR');
      const delta = before - gauge.getValue();
      // No low-HP adjustment, so full -18
      expect(delta).toBe(18);
    });

    it('should fail faster than HARD', () => {
      let poorsToFail = 0;
      while (!gauge.isFailed() && poorsToFail < 100) {
        gauge.onJudgment('POOR');
        poorsToFail++;
      }

      const hardGauge = new GaugeSystem('hard', TOTAL, NOTE_COUNT);
      let hardPoorsToFail = 0;
      while (!hardGauge.isFailed() && hardPoorsToFail < 100) {
        hardGauge.onJudgment('POOR');
        hardPoorsToFail++;
      }

      expect(poorsToFail).toBeLessThan(hardPoorsToFail);
    });
  });

  // ── EASY gauge ────────────────────────────────────────────────────

  describe('EASY gauge', () => {
    let gauge: GaugeSystem;

    beforeEach(() => {
      gauge = new GaugeSystem('easy', TOTAL, NOTE_COUNT);
    });

    it('should start at 22%', () => {
      expect(gauge.getValue()).toBe(22);
    });

    it('should have reduced damage (0.5x on all decreases)', () => {
      // GROOVE BAD = -2, EASY BAD = -2 * 0.5 = -1
      gauge.onJudgment('BAD');
      expect(gauge.getValue()).toBe(21);
    });

    it('should have reduced POOR damage', () => {
      // GROOVE POOR = -6, EASY POOR = -6 * 0.5 = -3
      gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBe(19);
    });

    it('should clear at 80%', () => {
      for (let i = 0; i < 50; i++) gauge.onJudgment('PGREAT');
      expect(gauge.isCleared()).toBe(true);
    });

    it('should never fail (failOnZero=false)', () => {
      for (let i = 0; i < 200; i++) gauge.onJudgment('POOR');
      expect(gauge.isFailed()).toBe(false);
    });
  });

  // ── ASSIST-EASY gauge ─────────────────────────────────────────────

  describe('ASSIST-EASY gauge', () => {
    it('should clear at 60% (lower threshold)', () => {
      const gauge = new GaugeSystem('assist-easy', TOTAL, NOTE_COUNT);
      // Fill up to 60%
      for (let i = 0; i < 25; i++) gauge.onJudgment('PGREAT');
      // 22 + 25*2 = 72 (capped at 100 by min/max)
      expect(gauge.isCleared()).toBe(true);
    });

    it('should have same reduced damage as EASY', () => {
      const easy = new GaugeSystem('easy', TOTAL, NOTE_COUNT);
      const assist = new GaugeSystem('assist-easy', TOTAL, NOTE_COUNT);
      easy.onJudgment('POOR');
      assist.onJudgment('POOR');
      expect(easy.getValue()).toBe(assist.getValue());
    });
  });

  // ── Landmine damage ───────────────────────────────────────────────

  describe('applyDamage (landmine)', () => {
    it('should apply fixed damage amount', () => {
      const gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      gauge.applyDamage(5);
      expect(gauge.getValue()).toBe(17);
    });

    it('should respect minValue', () => {
      const gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      gauge.applyDamage(99);
      expect(gauge.getValue()).toBe(2); // groove minValue
    });

    it('should cause failure on hard gauge at 0', () => {
      const gauge = new GaugeSystem('hard', TOTAL, NOTE_COUNT);
      gauge.applyDamage(100);
      expect(gauge.isFailed()).toBe(true);
    });

    it('should not process damage after failure', () => {
      const gauge = new GaugeSystem('hard', TOTAL, NOTE_COUNT);
      gauge.applyDamage(100);
      expect(gauge.isFailed()).toBe(true);
      gauge.applyDamage(50); // should be ignored
      expect(gauge.getValue()).toBe(0);
    });
  });

  // ── TOTAL parameter ───────────────────────────────────────────────

  describe('TOTAL parameter for gauge increase', () => {
    it('should scale increase with TOTAL', () => {
      // TOTAL=300, noteCount=100 -> increase=3
      const g1 = new GaugeSystem('groove', 300, 100);
      g1.onJudgment('PGREAT');
      expect(g1.getValue()).toBe(25); // 22 + 3

      // TOTAL=100, noteCount=100 -> increase=1
      const g2 = new GaugeSystem('groove', 100, 100);
      g2.onJudgment('PGREAT');
      expect(g2.getValue()).toBe(23); // 22 + 1
    });

    it('should handle zero notes gracefully', () => {
      // noteCount=0 -> increase=1 (default)
      const gauge = new GaugeSystem('groove', 200, 0);
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBe(23); // 22 + 1
    });
  });

  // ── State and metadata ────────────────────────────────────────────

  describe('getState', () => {
    it('should return complete state', () => {
      const gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      gauge.onJudgment('PGREAT');
      const state = gauge.getState();
      expect(state.type).toBe('groove');
      expect(state.value).toBe(24);
      expect(state.isFailed).toBe(false);
      expect(state.isCleared).toBe(false);
    });
  });

  describe('isDanger', () => {
    it('should be danger for hard gauge at 30% or below', () => {
      const gauge = new GaugeSystem('hard', TOTAL, NOTE_COUNT);
      // Bring gauge below 30%: need 100 - 30 = 70 damage
      // POOR = -9 per hit, ~8 hits = 72
      for (let i = 0; i < 8; i++) gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBeLessThanOrEqual(30);
      expect(gauge.isDanger()).toBe(true);
    });

    it('should not be danger for groove gauge at 50%', () => {
      const gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      for (let i = 0; i < 20; i++) gauge.onJudgment('PGREAT');
      expect(gauge.isDanger()).toBe(false);
    });
  });

  describe('lastDelta and lastJudgment tracking', () => {
    it('should track last delta and judgment', () => {
      const gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      gauge.onJudgment('PGREAT');
      expect(gauge.getLastDelta()).toBe(2); // increase = 200/100 = 2
      expect(gauge.getLastJudgment()).toBe('PGREAT');
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset gauge to start value', () => {
      const gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      gauge.onJudgment('PGREAT');
      gauge.reset();
      expect(gauge.getValue()).toBe(22);
      expect(gauge.isFailed()).toBe(false);
    });

    it('should allow changing gauge type on reset', () => {
      const gauge = new GaugeSystem('groove', TOTAL, NOTE_COUNT);
      gauge.reset('hard');
      expect(gauge.getValue()).toBe(100);
      expect(gauge.getState().type).toBe('hard');
    });

    it('should reset failed state', () => {
      const gauge = new GaugeSystem('hard', TOTAL, NOTE_COUNT);
      for (let i = 0; i < 50; i++) gauge.onJudgment('POOR');
      expect(gauge.isFailed()).toBe(true);
      gauge.reset();
      expect(gauge.isFailed()).toBe(false);
      expect(gauge.getValue()).toBe(100);
    });
  });

  // ── Static methods ────────────────────────────────────────────────

  describe('static methods', () => {
    it('should return colors for all gauge types', () => {
      const types: GaugeType[] = ['groove', 'easy', 'assist-easy', 'hard', 'exhard'];
      for (const t of types) {
        expect(GaugeSystem.getColor(t)).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('should return labels for all gauge types', () => {
      expect(GaugeSystem.getLabel('groove')).toBe('GROOVE');
      expect(GaugeSystem.getLabel('easy')).toBe('EASY');
      expect(GaugeSystem.getLabel('assist-easy')).toBe('ASSIST');
      expect(GaugeSystem.getLabel('hard')).toBe('HARD');
      expect(GaugeSystem.getLabel('exhard')).toBe('EX-HARD');
    });
  });
});
