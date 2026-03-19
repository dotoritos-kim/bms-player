import { describe, it, expect } from 'vitest';
import { JudgmentEngine } from '../src/game/JudgmentEngine';
import type { Judgment } from '../src/game/JudgmentEngine';

describe('JudgmentEngine', () => {
  // ── Default (LR2, rank 2 = NORMAL) ────────────────────────────────
  // Windows: pgreat=18, great=40, good=100, bad=200

  describe('judgment types with default config (LR2 NORMAL)', () => {
    const engine = new JudgmentEngine();

    it('should return PGREAT for perfectly timed hits (offset 0)', () => {
      const result = engine.judge(1000, 1000);
      expect(result.judgment).toBe('PGREAT');
      expect(result.offset).toBe(0);
    });

    it('should return PGREAT within pgreat window (18ms)', () => {
      expect(engine.judge(1018, 1000).judgment).toBe('PGREAT');
      expect(engine.judge(982, 1000).judgment).toBe('PGREAT');
    });

    it('should return GREAT for slightly off-timing (19-40ms)', () => {
      expect(engine.judge(1019, 1000).judgment).toBe('GREAT');
      expect(engine.judge(1040, 1000).judgment).toBe('GREAT');
      expect(engine.judge(960, 1000).judgment).toBe('GREAT');
    });

    it('should return GOOD for moderately off-timing (41-100ms)', () => {
      expect(engine.judge(1041, 1000).judgment).toBe('GOOD');
      expect(engine.judge(1100, 1000).judgment).toBe('GOOD');
      expect(engine.judge(900, 1000).judgment).toBe('GOOD');
    });

    it('should return BAD for very off-timing (101-200ms)', () => {
      expect(engine.judge(1101, 1000).judgment).toBe('BAD');
      expect(engine.judge(1200, 1000).judgment).toBe('BAD');
      expect(engine.judge(800, 1000).judgment).toBe('BAD');
    });

    it('should return POOR for way off-timing (>200ms)', () => {
      expect(engine.judge(1201, 1000).judgment).toBe('POOR');
      expect(engine.judge(1500, 1000).judgment).toBe('POOR');
      expect(engine.judge(799, 1000).judgment).toBe('POOR');
    });
  });

  // ── Rank settings ─────────────────────────────────────────────────

  describe('rank settings', () => {
    it('should have tighter windows for rank 0 (VERY HARD)', () => {
      const engine = new JudgmentEngine({ rank: 0 });
      const windows = engine.getWindows();
      expect(windows.pgreat).toBe(8);
      expect(windows.great).toBe(24);
      expect(windows.good).toBe(40);
      expect(windows.bad).toBe(200);

      // 10ms should be GREAT in VERY HARD (pgreat is only 8ms)
      expect(engine.judge(1010, 1000).judgment).toBe('GREAT');
    });

    it('should have looser windows for rank 4 (VERY EASY)', () => {
      const engine = new JudgmentEngine({ rank: 4 });
      const windows = engine.getWindows();
      expect(windows.pgreat).toBe(25);
      expect(windows.great).toBe(75);
      expect(windows.good).toBe(150);
      expect(windows.bad).toBe(200);

      // 20ms should still be PGREAT in VERY EASY
      expect(engine.judge(1020, 1000).judgment).toBe('PGREAT');
    });

    it('should fallback to rank 2 (NORMAL) for invalid rank', () => {
      const engine = new JudgmentEngine({ rank: 99 });
      const windows = engine.getWindows();
      expect(windows.pgreat).toBe(18);
    });
  });

  // ── Style variations ──────────────────────────────────────────────

  describe('beatoraja style', () => {
    it('should use beatoraja windows', () => {
      const engine = new JudgmentEngine({ style: 'beatoraja', rank: 2 });
      const windows = engine.getWindows();
      expect(windows.pgreat).toBe(15);
      expect(windows.great).toBe(45);
      expect(windows.good).toBe(112);
      expect(windows.bad).toBe(200);
    });
  });

  describe('IIDX style', () => {
    it('should use fixed IIDX windows regardless of rank', () => {
      const engine = new JudgmentEngine({ style: 'iidx', rank: 0 });
      const windows = engine.getWindows();
      expect(windows.pgreat).toBeCloseTo(16.67, 1);
      expect(windows.great).toBeCloseTo(33.33, 1);
      expect(windows.good).toBeCloseTo(116.67, 1);
      expect(windows.bad).toBe(250);
    });
  });

  // ── DEFEXRANK custom windows ──────────────────────────────────────

  describe('DEFEXRANK', () => {
    it('should scale windows with DEFEXRANK (100 = 16ms pgreat)', () => {
      const engine = new JudgmentEngine({ defexrank: 100 });
      const windows = engine.getWindows();
      expect(windows.pgreat).toBeCloseTo(16, 1);
      expect(windows.great).toBeCloseTo(32, 1);
      expect(windows.good).toBeCloseTo(64, 1);
      expect(windows.bad).toBe(200);
    });

    it('should scale down with small DEFEXRANK (50 = 8ms pgreat)', () => {
      const engine = new JudgmentEngine({ defexrank: 50 });
      const windows = engine.getWindows();
      expect(windows.pgreat).toBeCloseTo(8, 1);
      expect(windows.great).toBeCloseTo(16, 1);
      expect(windows.good).toBeCloseTo(32, 1);
    });

    it('should override rank when defexrank is set', () => {
      const engine = new JudgmentEngine({ rank: 0, defexrank: 200 });
      const windows = engine.getWindows();
      // DEFEXRANK takes priority: 200 * 0.16 = 32ms pgreat
      expect(windows.pgreat).toBeCloseTo(32, 1);
    });
  });

  // ── EXRANK mode (All or Nothing) ──────────────────────────────────

  describe('EXRANK mode (All or Nothing)', () => {
    it('should only give PGREAT or BAD', () => {
      const engine = new JudgmentEngine({ exrankMode: true });

      // Within 1 frame (~16.67ms) -> PGREAT
      expect(engine.judge(1016, 1000).judgment).toBe('PGREAT');
      // Beyond 1 frame -> BAD
      expect(engine.judge(1017, 1000).judgment).toBe('BAD');
      expect(engine.judge(1050, 1000).judgment).toBe('BAD');
    });

    it('should be toggleable via setExrankMode', () => {
      const engine = new JudgmentEngine();

      // Normal mode first
      expect(engine.judge(1030, 1000).judgment).toBe('GREAT');

      // Enable EXRANK
      engine.setExrankMode(true);
      expect(engine.judge(1030, 1000).judgment).toBe('BAD');

      // Disable EXRANK
      engine.setExrankMode(false);
      expect(engine.judge(1030, 1000).judgment).toBe('GREAT');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    const engine = new JudgmentEngine();

    it('should handle zero offset', () => {
      const result = engine.judge(1000, 1000);
      expect(result.judgment).toBe('PGREAT');
      expect(result.offset).toBe(0);
    });

    it('should handle negative offset (FAST)', () => {
      const result = engine.judge(990, 1000);
      expect(result.offset).toBe(-10);
      expect(result.timing).toBe('FAST');
    });

    it('should handle positive offset (SLOW)', () => {
      const result = engine.judge(1010, 1000);
      expect(result.offset).toBe(10);
      expect(result.timing).toBe('SLOW');
    });

    it('should handle extremely large offsets', () => {
      const result = engine.judge(100000, 1000);
      expect(result.judgment).toBe('POOR');
    });

    it('should handle very small times', () => {
      const result = engine.judge(0, 0);
      expect(result.judgment).toBe('PGREAT');
    });
  });

  // ── Timing indicator ─────────────────────────────────────────────

  describe('timing indicator (FAST/SLOW/JUST)', () => {
    const engine = new JudgmentEngine();

    it('should return JUST for PGREAT within 2ms of center', () => {
      expect(engine.judge(1000, 1000).timing).toBe('JUST');
      expect(engine.judge(1001, 1000).timing).toBe('JUST');
      expect(engine.judge(999, 1000).timing).toBe('JUST');
      expect(engine.judge(1002, 1000).timing).toBe('JUST');
      expect(engine.judge(998, 1000).timing).toBe('JUST');
    });

    it('should return FAST for PGREAT with negative offset > 2ms', () => {
      expect(engine.judge(997, 1000).timing).toBe('FAST');
    });

    it('should return SLOW for PGREAT with positive offset > 2ms', () => {
      expect(engine.judge(1003, 1000).timing).toBe('SLOW');
    });

    it('should return FAST for early non-PGREAT judgments', () => {
      expect(engine.judge(970, 1000).timing).toBe('FAST');
    });

    it('should return SLOW for late non-PGREAT judgments', () => {
      expect(engine.judge(1030, 1000).timing).toBe('SLOW');
    });
  });

  // ── Combo break ───────────────────────────────────────────────────

  describe('combo break', () => {
    const engine = new JudgmentEngine();

    it('should not break combo on PGREAT', () => {
      expect(engine.isComboBreak('PGREAT')).toBe(false);
    });

    it('should not break combo on GREAT', () => {
      expect(engine.isComboBreak('GREAT')).toBe(false);
    });

    it('should not break combo on GOOD', () => {
      expect(engine.isComboBreak('GOOD')).toBe(false);
    });

    it('should break combo on BAD', () => {
      expect(engine.isComboBreak('BAD')).toBe(true);
    });

    it('should break combo on POOR', () => {
      expect(engine.isComboBreak('POOR')).toBe(true);
    });

    it('should break combo on MISS', () => {
      expect(engine.isComboBreak('MISS')).toBe(true);
    });
  });

  // ── Miss / Range / Upcoming checks ────────────────────────────────

  describe('isMissed', () => {
    const engine = new JudgmentEngine(); // bad window = 200ms

    it('should not be missed within bad window', () => {
      expect(engine.isMissed(1200, 1000)).toBe(false);
    });

    it('should be missed beyond bad window', () => {
      expect(engine.isMissed(1201, 1000)).toBe(true);
    });
  });

  describe('isInJudgmentRange', () => {
    const engine = new JudgmentEngine();

    it('should be in range within bad window', () => {
      expect(engine.isInJudgmentRange(1100, 1000)).toBe(true);
      expect(engine.isInJudgmentRange(900, 1000)).toBe(true);
    });

    it('should not be in range beyond bad window', () => {
      expect(engine.isInJudgmentRange(1201, 1000)).toBe(false);
    });
  });

  describe('isUpcoming', () => {
    const engine = new JudgmentEngine();

    it('should be upcoming when note is far in the future', () => {
      expect(engine.isUpcoming(1000, 1201)).toBe(true);
    });

    it('should not be upcoming when note is within bad window', () => {
      expect(engine.isUpcoming(1000, 1200)).toBe(false);
    });
  });

  // ── Static methods ────────────────────────────────────────────────

  describe('static getExScore', () => {
    it('should return 2 for PGREAT', () => {
      expect(JudgmentEngine.getExScore('PGREAT')).toBe(2);
    });

    it('should return 1 for GREAT', () => {
      expect(JudgmentEngine.getExScore('GREAT')).toBe(1);
    });

    it('should return 0 for other judgments', () => {
      expect(JudgmentEngine.getExScore('GOOD')).toBe(0);
      expect(JudgmentEngine.getExScore('BAD')).toBe(0);
      expect(JudgmentEngine.getExScore('POOR')).toBe(0);
      expect(JudgmentEngine.getExScore('MISS')).toBe(0);
    });
  });

  describe('static getLabel', () => {
    it('should return correct labels', () => {
      expect(JudgmentEngine.getLabel('PGREAT')).toBe('PERFECT');
      expect(JudgmentEngine.getLabel('GREAT')).toBe('GREAT');
      expect(JudgmentEngine.getLabel('GOOD')).toBe('GOOD');
      expect(JudgmentEngine.getLabel('BAD')).toBe('BAD');
      expect(JudgmentEngine.getLabel('POOR')).toBe('POOR');
      expect(JudgmentEngine.getLabel('MISS')).toBe('MISS');
    });
  });

  describe('static getColor', () => {
    it('should return a color string for each judgment', () => {
      const judgments: Judgment[] = ['PGREAT', 'GREAT', 'GOOD', 'BAD', 'POOR', 'MISS'];
      for (const j of judgments) {
        expect(JudgmentEngine.getColor(j)).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  // ── getWindows returns a copy ─────────────────────────────────────

  describe('getWindows immutability', () => {
    it('should return a copy of windows, not the internal reference', () => {
      const engine = new JudgmentEngine();
      const w1 = engine.getWindows();
      w1.pgreat = 999;
      const w2 = engine.getWindows();
      expect(w2.pgreat).toBe(18); // unchanged
    });
  });
});
