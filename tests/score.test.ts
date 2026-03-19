import { describe, it, expect, beforeEach } from 'vitest';
import { ScoreManager } from '../src/game/ScoreManager';

describe('ScoreManager', () => {
  let score: ScoreManager;

  beforeEach(() => {
    score = new ScoreManager({ totalNotes: 100 });
  });

  // ── Initial state ─────────────────────────────────────────────────

  describe('initial state', () => {
    it('should start with zero score', () => {
      expect(score.exScore).toBe(0);
    });

    it('should start with zero combo', () => {
      expect(score.currentCombo).toBe(0);
      expect(score.maxCombo).toBe(0);
    });

    it('should start with zero judgment counts', () => {
      expect(score.pgreatCount).toBe(0);
      expect(score.greatCount).toBe(0);
      expect(score.goodCount).toBe(0);
      expect(score.badCount).toBe(0);
      expect(score.poorCount).toBe(0);
      expect(score.missCount).toBe(0);
    });

    it('should have no last judgment', () => {
      expect(score.lastJudgment).toBeNull();
    });

    it('should have 100% accuracy with no notes judged', () => {
      expect(score.accuracy).toBe(100);
    });

    it('should have zero judged notes', () => {
      expect(score.judgedNotes).toBe(0);
    });
  });

  // ── EX-SCORE ──────────────────────────────────────────────────────

  describe('EX-SCORE calculation', () => {
    it('should add 2 for PGREAT', () => {
      score.onJudgment('PGREAT');
      expect(score.exScore).toBe(2);
    });

    it('should add 1 for GREAT', () => {
      score.onJudgment('GREAT');
      expect(score.exScore).toBe(1);
    });

    it('should add 0 for GOOD', () => {
      score.onJudgment('GOOD');
      expect(score.exScore).toBe(0);
    });

    it('should add 0 for BAD', () => {
      score.onJudgment('BAD');
      expect(score.exScore).toBe(0);
    });

    it('should add 0 for POOR', () => {
      score.onJudgment('POOR');
      expect(score.exScore).toBe(0);
    });

    it('should add 0 for MISS', () => {
      score.onJudgment('MISS');
      expect(score.exScore).toBe(0);
    });

    it('should calculate cumulative EX-SCORE', () => {
      score.onJudgment('PGREAT');  // +2 = 2
      score.onJudgment('GREAT');   // +1 = 3
      score.onJudgment('PGREAT');  // +2 = 5
      score.onJudgment('GOOD');    // +0 = 5
      expect(score.exScore).toBe(5);
    });
  });

  // ── Combo tracking ────────────────────────────────────────────────

  describe('combo tracking', () => {
    it('should increment combo on PGREAT', () => {
      score.onJudgment('PGREAT');
      expect(score.currentCombo).toBe(1);
    });

    it('should increment combo on GREAT', () => {
      score.onJudgment('GREAT');
      expect(score.currentCombo).toBe(1);
    });

    it('should increment combo on GOOD', () => {
      score.onJudgment('GOOD');
      expect(score.currentCombo).toBe(1);
    });

    it('should reset combo on BAD', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('PGREAT');
      score.onJudgment('BAD');
      expect(score.currentCombo).toBe(0);
    });

    it('should reset combo on POOR', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('POOR');
      expect(score.currentCombo).toBe(0);
    });

    it('should reset combo on MISS', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('MISS');
      expect(score.currentCombo).toBe(0);
    });

    it('should track max combo', () => {
      score.onJudgment('PGREAT'); // combo 1
      score.onJudgment('PGREAT'); // combo 2
      score.onJudgment('PGREAT'); // combo 3
      score.onJudgment('BAD');    // combo 0, maxCombo 3
      score.onJudgment('PGREAT'); // combo 1
      score.onJudgment('PGREAT'); // combo 2
      expect(score.maxCombo).toBe(3);
      expect(score.currentCombo).toBe(2);
    });

    it('should update max combo when current exceeds it', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('PGREAT');
      score.onJudgment('BAD');
      score.onJudgment('PGREAT');
      score.onJudgment('PGREAT');
      score.onJudgment('PGREAT');
      expect(score.maxCombo).toBe(3);
    });
  });

  // ── Accuracy ──────────────────────────────────────────────────────

  describe('accuracy', () => {
    it('should be 100 for all PGREAT', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('PGREAT');
      expect(score.accuracy).toBe(100);
    });

    it('should be 80 for all GREAT', () => {
      score.onJudgment('GREAT');
      score.onJudgment('GREAT');
      expect(score.accuracy).toBe(80);
    });

    it('should be 50 for all GOOD', () => {
      score.onJudgment('GOOD');
      score.onJudgment('GOOD');
      expect(score.accuracy).toBe(50);
    });

    it('should be 0 for all BAD/POOR/MISS', () => {
      score.onJudgment('BAD');
      expect(score.accuracy).toBe(0);
    });

    it('should calculate weighted average', () => {
      score.onJudgment('PGREAT'); // 100
      score.onJudgment('GREAT');  // 80
      // average = (100 + 80) / 2 = 90
      expect(score.accuracy).toBe(90);
    });
  });

  // ── EX Score Rate ─────────────────────────────────────────────────

  describe('exScoreRate', () => {
    it('should be 0 with zero total notes', () => {
      const s = new ScoreManager({ totalNotes: 0 });
      expect(s.exScoreRate).toBe(0);
    });

    it('should calculate rate correctly', () => {
      // totalNotes = 100, maxExScore = 200
      score.onJudgment('PGREAT'); // exScore = 2
      expect(score.exScoreRate).toBe(2 / 200);
    });
  });

  // ── DJ Level ──────────────────────────────────────────────────────

  describe('DJ Level', () => {
    it('should return F for zero score', () => {
      expect(score.djLevel).toBe('F');
    });

    it('should return AAA for near-perfect score', () => {
      // Need exScoreRate >= 8/9 ~ 0.889
      // totalNotes=100, maxEx=200, need exScore >= 178
      // 89 PGREAT = 178 exScore -> 178/200 = 0.89 >= 8/9
      const s = new ScoreManager({ totalNotes: 100 });
      for (let i = 0; i < 89; i++) s.onJudgment('PGREAT');
      expect(s.djLevel).toBe('AAA');
    });

    it('should return AA for good score', () => {
      // Need exScoreRate >= 7/9 ~ 0.778 but < 8/9
      // 80 PGREAT = 160 exScore -> 160/200 = 0.8
      const s = new ScoreManager({ totalNotes: 100 });
      for (let i = 0; i < 80; i++) s.onJudgment('PGREAT');
      expect(s.djLevel).toBe('AA');
    });

    it('should return correct levels across thresholds', () => {
      // Test boundary: exactly at each threshold
      const thresholds: [number, string][] = [
        [8 / 9, 'AAA'],
        [7 / 9, 'AA'],
        [6 / 9, 'A'],
        [5 / 9, 'B'],
        [4 / 9, 'C'],
        [3 / 9, 'D'],
        [2 / 9, 'E'],
      ];
      for (const [rate, level] of thresholds) {
        const s = new ScoreManager({ totalNotes: 9 });
        // maxEx = 18, need exScore = ceil(rate * 18)
        const needed = Math.ceil(rate * 18);
        // Use PGREATs (each worth 2)
        const pgreats = Math.floor(needed / 2);
        const greats = needed % 2;
        for (let i = 0; i < pgreats; i++) s.onJudgment('PGREAT');
        for (let i = 0; i < greats; i++) s.onJudgment('GREAT');
        expect(s.djLevel).toBe(level);
      }
    });
  });

  // ── Full combo / Perfect ──────────────────────────────────────────

  describe('full combo and perfect', () => {
    it('should be full combo with only PGREAT/GREAT/GOOD', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('GREAT');
      score.onJudgment('GOOD');
      expect(score.isFullCombo).toBe(true);
    });

    it('should not be full combo with BAD', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('BAD');
      expect(score.isFullCombo).toBe(false);
    });

    it('should be perfect with only PGREAT', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('PGREAT');
      expect(score.isPerfect).toBe(true);
    });

    it('should not be perfect with GREAT', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('GREAT');
      expect(score.isPerfect).toBe(false);
    });
  });

  // ── Progress ──────────────────────────────────────────────────────

  describe('progress', () => {
    it('should be 0 with no judged notes', () => {
      expect(score.progress).toBe(0);
    });

    it('should be 0.5 when half notes judged', () => {
      for (let i = 0; i < 50; i++) score.onJudgment('PGREAT');
      expect(score.progress).toBe(0.5);
    });

    it('should handle zero total notes', () => {
      const s = new ScoreManager({ totalNotes: 0 });
      expect(s.progress).toBe(0);
    });
  });

  // ── getState ──────────────────────────────────────────────────────

  describe('getState', () => {
    it('should return complete state snapshot', () => {
      score.onJudgment('PGREAT', 5);
      score.onJudgment('GREAT', -3);

      const state = score.getState();
      expect(state.pgreatCount).toBe(1);
      expect(state.greatCount).toBe(1);
      expect(state.exScore).toBe(3);
      expect(state.currentCombo).toBe(2);
      expect(state.maxCombo).toBe(2);
      expect(state.totalNotes).toBe(100);
      expect(state.lastJudgment).toBe('GREAT');
      expect(state.lastOffset).toBe(-3);
    });
  });

  // ── Change tracking ───────────────────────────────────────────────

  describe('change tracking', () => {
    it('should track combo changes', () => {
      expect(score.consumeComboChange()).toBe(false);
      score.onJudgment('PGREAT');
      expect(score.consumeComboChange()).toBe(true);
      expect(score.consumeComboChange()).toBe(false); // consumed
    });

    it('should track score changes', () => {
      expect(score.consumeScoreChange()).toBe(false);
      score.onJudgment('PGREAT');
      expect(score.consumeScoreChange()).toBe(true);
      expect(score.consumeScoreChange()).toBe(false); // consumed
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset all state to initial', () => {
      score.onJudgment('PGREAT');
      score.onJudgment('BAD');
      score.onJudgment('PGREAT');
      score.reset();

      expect(score.exScore).toBe(0);
      expect(score.currentCombo).toBe(0);
      expect(score.maxCombo).toBe(0);
      expect(score.pgreatCount).toBe(0);
      expect(score.badCount).toBe(0);
      expect(score.lastJudgment).toBeNull();
      expect(score.lastOffset).toBe(0);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle 100% PGREAT (perfect score)', () => {
      const s = new ScoreManager({ totalNotes: 10 });
      for (let i = 0; i < 10; i++) s.onJudgment('PGREAT');
      expect(s.exScore).toBe(20);
      expect(s.exScoreRate).toBe(1);
      expect(s.accuracy).toBe(100);
      expect(s.isPerfect).toBe(true);
      expect(s.djLevel).toBe('AAA');
    });

    it('should handle 100% MISS (worst score)', () => {
      const s = new ScoreManager({ totalNotes: 10 });
      for (let i = 0; i < 10; i++) s.onJudgment('MISS');
      expect(s.exScore).toBe(0);
      expect(s.exScoreRate).toBe(0);
      expect(s.accuracy).toBe(0);
      expect(s.djLevel).toBe('F');
      expect(s.currentCombo).toBe(0);
    });

    it('should handle zero total notes', () => {
      const s = new ScoreManager({ totalNotes: 0 });
      expect(s.maxExScore).toBe(0);
      expect(s.exScoreRate).toBe(0);
      expect(s.progress).toBe(0);
    });

    it('should handle last judgment and offset tracking', () => {
      score.onJudgment('PGREAT', 5.5);
      expect(score.lastJudgment).toBe('PGREAT');
      expect(score.lastOffset).toBe(5.5);

      score.onJudgment('MISS', -10);
      expect(score.lastJudgment).toBe('MISS');
      expect(score.lastOffset).toBe(-10);
    });
  });
});
