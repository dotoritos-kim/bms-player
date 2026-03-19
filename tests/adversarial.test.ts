import { describe, it, expect } from 'vitest';
import { JudgmentEngine } from '../src/game/JudgmentEngine';
import { ScoreManager } from '../src/game/ScoreManager';
import { GaugeSystem } from '../src/game/GaugeSystem';

describe('Adversarial Game Scenarios', () => {
  // ── Rapid inputs ──────────────────────────────────────────────────

  describe('rapid key presses (ScoreManager stress)', () => {
    it('should handle 1000 rapid PGREAT judgments without error', () => {
      const score = new ScoreManager({ totalNotes: 1000 });
      for (let i = 0; i < 1000; i++) {
        score.onJudgment('PGREAT', 0);
      }
      expect(score.exScore).toBe(2000);
      expect(score.currentCombo).toBe(1000);
      expect(score.maxCombo).toBe(1000);
    });

    it('should handle alternating combo break/build 1000 times', () => {
      const score = new ScoreManager({ totalNotes: 2000 });
      for (let i = 0; i < 1000; i++) {
        score.onJudgment('PGREAT');
        score.onJudgment('POOR');
      }
      expect(score.maxCombo).toBe(1);
      expect(score.currentCombo).toBe(0);
      expect(score.pgreatCount).toBe(1000);
      expect(score.poorCount).toBe(1000);
    });
  });

  // ── Gauge stress ──────────────────────────────────────────────────

  describe('gauge stress', () => {
    it('should handle gauge bouncing between min and max', () => {
      const gauge = new GaugeSystem('groove', 200, 100);
      // Drain to minimum
      for (let i = 0; i < 50; i++) gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBe(2);

      // Fill back up
      for (let i = 0; i < 100; i++) gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBe(100);

      // Drain again
      for (let i = 0; i < 50; i++) gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBe(2);
    });

    it('should handle many judgments after hard gauge failure', () => {
      const gauge = new GaugeSystem('hard', 200, 100);
      // Fail the gauge
      for (let i = 0; i < 50; i++) gauge.onJudgment('POOR');
      expect(gauge.isFailed()).toBe(true);

      // Continue feeding judgments (should all be ignored)
      for (let i = 0; i < 1000; i++) gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBe(0);
      expect(gauge.isFailed()).toBe(true);
    });
  });

  // ── Negative and extreme time values ──────────────────────────────

  describe('negative and extreme time values', () => {
    it('should handle negative time values in judgment', () => {
      const engine = new JudgmentEngine();
      // Input at -100, note at -100 -> offset 0 -> PGREAT
      const r = engine.judge(-100, -100);
      expect(r.judgment).toBe('PGREAT');
      expect(r.offset).toBe(0);
    });

    it('should handle very large time values', () => {
      const engine = new JudgmentEngine();
      const r = engine.judge(1e12, 1e12);
      expect(r.judgment).toBe('PGREAT');
    });

    it('should handle extremely large offset', () => {
      const engine = new JudgmentEngine();
      const r = engine.judge(1e12, 0);
      expect(r.judgment).toBe('POOR');
    });
  });

  // ── NaN / Infinity handling ───────────────────────────────────────

  describe('NaN and Infinity in timing', () => {
    it('should handle NaN input time', () => {
      const engine = new JudgmentEngine();
      const r = engine.judge(NaN, 1000);
      // NaN math: NaN - 1000 = NaN, Math.abs(NaN) = NaN
      // NaN <= anything is false, so it falls through to POOR
      expect(r.judgment).toBe('POOR');
    });

    it('should handle NaN note time', () => {
      const engine = new JudgmentEngine();
      const r = engine.judge(1000, NaN);
      expect(r.judgment).toBe('POOR');
    });

    it('should handle Infinity input time', () => {
      const engine = new JudgmentEngine();
      const r = engine.judge(Infinity, 1000);
      expect(r.judgment).toBe('POOR');
    });

    it('should handle -Infinity input time', () => {
      const engine = new JudgmentEngine();
      const r = engine.judge(-Infinity, 1000);
      expect(r.judgment).toBe('POOR');
    });

    it('should handle both times as Infinity', () => {
      const engine = new JudgmentEngine();
      // Infinity - Infinity = NaN
      const r = engine.judge(Infinity, Infinity);
      expect(r.judgment).toBe('POOR');
    });

    it('should handle NaN in score manager without crashing', () => {
      const score = new ScoreManager({ totalNotes: 10 });
      score.onJudgment('PGREAT', NaN);
      expect(score.lastOffset).toBeNaN();
      expect(score.pgreatCount).toBe(1);
    });
  });

  // ── Zero-note and single-note charts ──────────────────────────────

  describe('zero-note and single-note charts', () => {
    it('should handle zero-note chart in ScoreManager', () => {
      const score = new ScoreManager({ totalNotes: 0 });
      expect(score.exScoreRate).toBe(0);
      expect(score.progress).toBe(0);
      expect(score.accuracy).toBe(100);
      expect(score.djLevel).toBe('F'); // exScoreRate = 0
    });

    it('should handle zero-note chart in GaugeSystem', () => {
      // noteCount=0 -> increase=1
      const gauge = new GaugeSystem('groove', 200, 0);
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBe(23); // 22 + 1
    });

    it('should handle single-note chart', () => {
      const score = new ScoreManager({ totalNotes: 1 });
      score.onJudgment('PGREAT');
      expect(score.exScore).toBe(2);
      expect(score.exScoreRate).toBe(1);
      expect(score.progress).toBe(1);
      expect(score.djLevel).toBe('AAA');
    });
  });

  // ── Notes at time 0 ──────────────────────────────────────────────

  describe('notes at time 0', () => {
    it('should judge notes at time 0 correctly', () => {
      const engine = new JudgmentEngine();
      const r = engine.judge(0, 0);
      expect(r.judgment).toBe('PGREAT');
      expect(r.offset).toBe(0);
      expect(r.timing).toBe('JUST');
    });

    it('should handle isMissed for note at time 0', () => {
      const engine = new JudgmentEngine();
      expect(engine.isMissed(0, 0)).toBe(false);
      expect(engine.isMissed(201, 0)).toBe(true);
    });
  });

  // ── Overlapping notes ─────────────────────────────────────────────

  describe('overlapping notes on same column', () => {
    it('should judge each note independently', () => {
      const engine = new JudgmentEngine();
      // Two notes at the same time
      const r1 = engine.judge(1000, 1000);
      const r2 = engine.judge(1000, 1000);
      expect(r1.judgment).toBe('PGREAT');
      expect(r2.judgment).toBe('PGREAT');
    });

    it('should handle notes very close together (1ms apart)', () => {
      const engine = new JudgmentEngine();
      const r1 = engine.judge(1000, 1000);
      const r2 = engine.judge(1001, 1001);
      expect(r1.judgment).toBe('PGREAT');
      expect(r2.judgment).toBe('PGREAT');
    });
  });

  // ── Extremely fast BPM ────────────────────────────────────────────

  describe('extremely fast BPM simulation', () => {
    it('should handle notes spaced 10ms apart', () => {
      const engine = new JudgmentEngine({ rank: 0 }); // VERY HARD, pgreat=8ms
      const score = new ScoreManager({ totalNotes: 100 });

      // 100 notes spaced 10ms apart, all hit perfectly
      for (let i = 0; i < 100; i++) {
        const noteTime = i * 10;
        const result = engine.judge(noteTime, noteTime);
        score.onJudgment(result.judgment, result.offset);
      }

      expect(score.pgreatCount).toBe(100);
      expect(score.maxCombo).toBe(100);
    });

    it('should handle notes spaced 1ms apart with slightly off timing', () => {
      const engine = new JudgmentEngine();
      // With notes 1ms apart, hitting even 5ms off could judge against wrong note
      // But JudgmentEngine.judge() doesn't know about other notes - it just
      // compares inputTime vs noteTime. So each call is independent.
      const r1 = engine.judge(1005, 1000); // 5ms off -> PGREAT (within 18ms)
      const r2 = engine.judge(1006, 1001); // 5ms off -> PGREAT
      expect(r1.judgment).toBe('PGREAT');
      expect(r2.judgment).toBe('PGREAT');
    });
  });

  // ── Score integrity under adversarial conditions ──────────────────

  describe('score integrity', () => {
    it('should maintain correct counts after many mixed judgments', () => {
      const score = new ScoreManager({ totalNotes: 600 });

      for (let i = 0; i < 100; i++) score.onJudgment('PGREAT');
      for (let i = 0; i < 100; i++) score.onJudgment('GREAT');
      for (let i = 0; i < 100; i++) score.onJudgment('GOOD');
      for (let i = 0; i < 100; i++) score.onJudgment('BAD');
      for (let i = 0; i < 100; i++) score.onJudgment('POOR');
      for (let i = 0; i < 100; i++) score.onJudgment('MISS');

      expect(score.pgreatCount).toBe(100);
      expect(score.greatCount).toBe(100);
      expect(score.goodCount).toBe(100);
      expect(score.badCount).toBe(100);
      expect(score.poorCount).toBe(100);
      expect(score.missCount).toBe(100);
      expect(score.judgedNotes).toBe(600);
      expect(score.exScore).toBe(300); // 100*2 + 100*1
    });

    it('should maintain correct state after reset and replay', () => {
      const score = new ScoreManager({ totalNotes: 10 });

      for (let i = 0; i < 10; i++) score.onJudgment('PGREAT');
      expect(score.exScore).toBe(20);

      score.reset();
      expect(score.exScore).toBe(0);
      expect(score.judgedNotes).toBe(0);

      for (let i = 0; i < 10; i++) score.onJudgment('GREAT');
      expect(score.exScore).toBe(10);
    });
  });

  // ── Gauge edge cases ──────────────────────────────────────────────

  describe('gauge precision and edge cases', () => {
    it('should not have floating point errors cause gauge to exceed 100%', () => {
      const gauge = new GaugeSystem('groove', 300, 1); // increase = 300
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBeLessThanOrEqual(100);
    });

    it('should not have floating point errors cause gauge to go below min', () => {
      const gauge = new GaugeSystem('groove', 200, 100);
      for (let i = 0; i < 1000; i++) gauge.onJudgment('POOR');
      expect(gauge.getValue()).toBe(2);
    });

    it('should handle very small TOTAL value', () => {
      // TOTAL=1, noteCount=100 -> increase = 0.01
      const gauge = new GaugeSystem('groove', 1, 100);
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBeCloseTo(22.01);
    });

    it('should handle very large TOTAL value', () => {
      const gauge = new GaugeSystem('groove', 1e6, 100);
      gauge.onJudgment('PGREAT');
      expect(gauge.getValue()).toBe(100); // capped
    });
  });

  // ── EXRANK mode edge cases ────────────────────────────────────────

  describe('EXRANK mode edge cases', () => {
    it('should handle toggling EXRANK mid-session', () => {
      const engine = new JudgmentEngine();
      const score = new ScoreManager({ totalNotes: 4 });

      // Normal mode
      const r1 = engine.judge(1030, 1000);
      score.onJudgment(r1.judgment);
      expect(r1.judgment).toBe('GREAT');

      // Toggle EXRANK on
      engine.setExrankMode(true);
      const r2 = engine.judge(2030, 2000);
      score.onJudgment(r2.judgment);
      expect(r2.judgment).toBe('BAD'); // 30ms > 16.67ms frame

      // Toggle EXRANK off
      engine.setExrankMode(false);
      const r3 = engine.judge(3030, 3000);
      score.onJudgment(r3.judgment);
      expect(r3.judgment).toBe('GREAT');
    });

    it('should handle boundary at exactly 16.67ms in EXRANK', () => {
      const engine = new JudgmentEngine({ exrankMode: true });
      // Exactly at boundary
      const r = engine.judge(1016.67, 1000);
      expect(r.judgment).toBe('PGREAT'); // 16.67 <= 16.67

      const r2 = engine.judge(1016.68, 1000);
      expect(r2.judgment).toBe('BAD'); // 16.68 > 16.67
    });
  });

  // ── Judgment window boundaries ────────────────────────────────────

  describe('judgment window boundaries', () => {
    it('should handle exact boundary between PGREAT and GREAT', () => {
      const engine = new JudgmentEngine({ rank: 2 }); // pgreat=18
      // Exactly at 18ms -> PGREAT (<=)
      expect(engine.judge(1018, 1000).judgment).toBe('PGREAT');
      // 18.001ms -> GREAT
      expect(engine.judge(1018.001, 1000).judgment).toBe('GREAT');
    });

    it('should handle exact boundary between GREAT and GOOD', () => {
      const engine = new JudgmentEngine({ rank: 2 }); // great=40
      expect(engine.judge(1040, 1000).judgment).toBe('GREAT');
      expect(engine.judge(1040.001, 1000).judgment).toBe('GOOD');
    });

    it('should handle exact boundary between GOOD and BAD', () => {
      const engine = new JudgmentEngine({ rank: 2 }); // good=100
      expect(engine.judge(1100, 1000).judgment).toBe('GOOD');
      expect(engine.judge(1100.001, 1000).judgment).toBe('BAD');
    });

    it('should handle exact boundary between BAD and POOR', () => {
      const engine = new JudgmentEngine({ rank: 2 }); // bad=200
      expect(engine.judge(1200, 1000).judgment).toBe('BAD');
      expect(engine.judge(1200.001, 1000).judgment).toBe('POOR');
    });
  });
});
