import { describe, it, expect } from 'vitest';
import { JudgmentEngine } from '../src/game/JudgmentEngine';
import { ScoreManager } from '../src/game/ScoreManager';
import { GaugeSystem } from '../src/game/GaugeSystem';

/**
 * GameLoop depends on AudioContext, requestAnimationFrame, and window.
 * We cannot instantiate it in a Node.js test environment.
 *
 * Instead, we test the interaction between the subsystems that GameLoop
 * orchestrates: JudgmentEngine + ScoreManager + GaugeSystem working together.
 * This validates the same logic flow that GameLoop.onNoteJudgment() performs.
 */

describe('GameLoop subsystem integration', () => {
  /**
   * Simulate the onNoteJudgment flow:
   * 1. JudgmentEngine judges the timing
   * 2. ScoreManager records the judgment
   * 3. GaugeSystem updates the gauge
   */
  function simulateJudgment(
    engine: JudgmentEngine,
    score: ScoreManager,
    gauge: GaugeSystem,
    inputTime: number,
    noteTime: number,
  ) {
    const result = engine.judge(inputTime, noteTime);
    score.onJudgment(result.judgment, result.offset);
    gauge.onJudgment(result.judgment);
    return result;
  }

  it('should process a sequence of notes through all subsystems', () => {
    const engine = new JudgmentEngine({ rank: 2 });
    const score = new ScoreManager({ totalNotes: 5 });
    const gauge = new GaugeSystem('groove', 200, 5); // increase = 40

    // Perfect hit
    const r1 = simulateJudgment(engine, score, gauge, 1000, 1000);
    expect(r1.judgment).toBe('PGREAT');
    expect(score.exScore).toBe(2);
    expect(score.currentCombo).toBe(1);

    // Slightly off hit
    const r2 = simulateJudgment(engine, score, gauge, 2030, 2000);
    expect(r2.judgment).toBe('GREAT');
    expect(score.exScore).toBe(3);
    expect(score.currentCombo).toBe(2);

    // Bad hit - combo break
    const r3 = simulateJudgment(engine, score, gauge, 3150, 3000);
    expect(r3.judgment).toBe('BAD');
    expect(score.exScore).toBe(3);
    expect(score.currentCombo).toBe(0);
    expect(score.maxCombo).toBe(2);
  });

  it('should handle complete play-through with gauge clearing', () => {
    const engine = new JudgmentEngine();
    const totalNotes = 20;
    const score = new ScoreManager({ totalNotes });
    const gauge = new GaugeSystem('groove', 300, totalNotes); // increase = 15

    // Play 20 notes with PGREAT
    for (let i = 0; i < totalNotes; i++) {
      const noteTime = i * 1000;
      simulateJudgment(engine, score, gauge, noteTime, noteTime);
    }

    expect(score.isPerfect).toBe(true);
    expect(score.maxCombo).toBe(totalNotes);
    expect(gauge.isCleared()).toBe(true);
    expect(gauge.getValue()).toBe(100); // capped at 100
  });

  it('should handle hard gauge failure during play', () => {
    const engine = new JudgmentEngine();
    const score = new ScoreManager({ totalNotes: 50 });
    const gauge = new GaugeSystem('hard', 200, 50);

    // All misses / POORs -> hard gauge should fail
    for (let i = 0; i < 50; i++) {
      const noteTime = i * 1000;
      // Hit very late -> POOR
      simulateJudgment(engine, score, gauge, noteTime + 500, noteTime);
    }

    expect(gauge.isFailed()).toBe(true);
  });

  it('should track miss notes correctly', () => {
    const engine = new JudgmentEngine(); // bad window = 200ms

    // Note at time 1000ms (1 second), current time is 1201ms -> missed
    expect(engine.isMissed(1201, 1000)).toBe(true);

    // Score records the miss
    const score = new ScoreManager({ totalNotes: 1 });
    score.onJudgment('MISS');
    expect(score.missCount).toBe(1);
    expect(score.currentCombo).toBe(0);
  });

  describe('note processing order', () => {
    it('should find closest note in judgment range', () => {
      const engine = new JudgmentEngine(); // bad window = 200ms

      // Simulate finding closest note: two notes at 1000ms and 1100ms
      // Input at 1080ms -> should judge against 1100ms (closer)
      const r1 = engine.judge(1080, 1000); // offset = 80ms
      const r2 = engine.judge(1080, 1100); // offset = -20ms

      // r2 is the closer one
      expect(Math.abs(r2.offset)).toBeLessThan(Math.abs(r1.offset));
      expect(r2.judgment).toBe('GREAT'); // 20ms off, within great window
    });
  });

  describe('state machine transitions', () => {
    it('should transition from playing to completed via score tracking', () => {
      const totalNotes = 3;
      const score = new ScoreManager({ totalNotes });

      expect(score.progress).toBe(0);

      score.onJudgment('PGREAT');
      expect(score.progress).toBeCloseTo(1 / 3);

      score.onJudgment('GREAT');
      expect(score.progress).toBeCloseTo(2 / 3);

      score.onJudgment('GOOD');
      expect(score.progress).toBe(1); // all notes judged
    });
  });

  describe('landmine interaction with gauge', () => {
    it('should apply fixed 5% damage for landmine on groove gauge', () => {
      const gauge = new GaugeSystem('groove', 200, 100);
      const before = gauge.getValue();
      gauge.applyDamage(5);
      expect(gauge.getValue()).toBe(before - 5);
    });

    it('should cause failure on hard gauge with multiple landmine hits', () => {
      const gauge = new GaugeSystem('hard', 200, 100);
      // 100% -> need 20 landmine hits (5% each) to reach 0
      for (let i = 0; i < 20; i++) {
        gauge.applyDamage(5);
      }
      expect(gauge.isFailed()).toBe(true);
    });
  });
});
