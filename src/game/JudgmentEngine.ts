/**
 * BMS judgment engine.
 * Implements the judgment system based on #RANK and #DEFEXRANK.
 */

export type Judgment = 'PGREAT' | 'GREAT' | 'GOOD' | 'BAD' | 'POOR' | 'MISS';
export type TimingIndicator = 'FAST' | 'SLOW' | 'JUST';

export interface JudgmentWindows {
  pgreat: number;  // ms
  great: number;
  good: number;
  bad: number;
}

export interface JudgmentResult {
  judgment: Judgment;
  offset: number;           // ms (negative=FAST, positive=SLOW)
  timing: TimingIndicator;
  isComboBreak: boolean;
}

export type JudgmentStyle = 'lr2' | 'beatoraja' | 'iidx';

// LR2-style judgment windows (based on #RANK)
const LR2_JUDGMENT_WINDOWS: Record<number, JudgmentWindows> = {
  0: { pgreat: 8,  great: 24,  good: 40,   bad: 200 },  // VERY HARD
  1: { pgreat: 15, great: 30,  good: 60,   bad: 200 },  // HARD
  2: { pgreat: 18, great: 40,  good: 100,  bad: 200 },  // NORMAL
  3: { pgreat: 21, great: 60,  good: 120,  bad: 200 },  // EASY
  4: { pgreat: 25, great: 75,  good: 150,  bad: 200 },  // VERY EASY
};

// beatoraja-style judgment windows
const BEATORAJA_JUDGMENT_WINDOWS: Record<number, JudgmentWindows> = {
  0: { pgreat: 5,  great: 15,  good: 37,   bad: 200 },  // VERY HARD
  1: { pgreat: 10, great: 30,  good: 75,   bad: 200 },  // HARD
  2: { pgreat: 15, great: 45,  good: 112,  bad: 200 },  // NORMAL
  3: { pgreat: 20, great: 60,  good: 150,  bad: 200 },  // EASY
  4: { pgreat: 25, great: 75,  good: 187,  bad: 200 },  // VERY EASY
};

// IIDX-style judgment windows (fixed)
const IIDX_JUDGMENT_WINDOWS: JudgmentWindows = {
  pgreat: 16.67,
  great: 33.33,
  good: 116.67,
  bad: 250,
};

export interface JudgmentEngineConfig {
  rank: number;              // 0-4
  defexrank?: number;        // Custom judgment (100 = NORMAL)
  style: JudgmentStyle;
  exrankMode?: boolean;      // All or Nothing mode
}

export class JudgmentEngine {
  private windows: JudgmentWindows;
  private exrankMode: boolean = false;

  constructor(config: Partial<JudgmentEngineConfig> = {}) {
    const { rank = 2, defexrank, style = 'lr2', exrankMode = false } = config;

    this.exrankMode = exrankMode;

    if (defexrank !== undefined) {
      // Custom judgment based on #DEFEXRANK
      // At #DEFEXRANK 100, PGREAT = ±16ms; ±1 = ±0.16ms
      const pgreatMs = defexrank * 0.16;
      this.windows = {
        pgreat: pgreatMs,
        great: pgreatMs * 2,
        good: pgreatMs * 4,
        bad: 200,
      };
    } else if (style === 'iidx') {
      this.windows = { ...IIDX_JUDGMENT_WINDOWS };
    } else if (style === 'beatoraja') {
      this.windows = { ...(BEATORAJA_JUDGMENT_WINDOWS[rank] ?? BEATORAJA_JUDGMENT_WINDOWS[2]) };
    } else {
      // LR2 style (default)
      this.windows = { ...(LR2_JUDGMENT_WINDOWS[rank] ?? LR2_JUDGMENT_WINDOWS[2]) };
    }
  }

  /**
   * Judges by comparing the input time against the note time.
   * @param inputTime Input time (ms, based on performance.now)
   * @param noteTime Note time (ms, relative to game start)
   */
  judge(inputTime: number, noteTime: number): JudgmentResult {
    const offset = inputTime - noteTime;  // negative = FAST, positive = SLOW
    const absOffset = Math.abs(offset);

    let judgment: Judgment;

    if (this.exrankMode) {
      // All or Nothing mode (#EXRANK)
      // PGREAT within 1 frame (~16.67ms), otherwise BAD
      const frameMs = 16.67;
      judgment = absOffset <= frameMs ? 'PGREAT' : 'BAD';
    } else {
      // Normal judgment
      if (absOffset <= this.windows.pgreat) {
        judgment = 'PGREAT';
      } else if (absOffset <= this.windows.great) {
        judgment = 'GREAT';
      } else if (absOffset <= this.windows.good) {
        judgment = 'GOOD';
      } else if (absOffset <= this.windows.bad) {
        judgment = 'BAD';
      } else {
        judgment = 'POOR';
      }
    }

    return {
      judgment,
      offset,
      timing: this.getTimingIndicator(offset, judgment),
      isComboBreak: this.isComboBreak(judgment),
    };
  }

  /**
   * Checks whether the note has fully left the judgment window (for MISS judgment).
   */
  isMissed(currentTime: number, noteTime: number): boolean {
    return currentTime - noteTime > this.windows.bad;
  }

  /**
   * Checks whether the note is within the judgeable range.
   */
  isInJudgmentRange(currentTime: number, noteTime: number): boolean {
    const offset = Math.abs(currentTime - noteTime);
    return offset <= this.windows.bad;
  }

  /**
   * Checks whether the note has not arrived yet (future note).
   */
  isUpcoming(currentTime: number, noteTime: number): boolean {
    return noteTime - currentTime > this.windows.bad;
  }

  /**
   * Checks whether the judgment breaks the combo.
   */
  isComboBreak(judgment: Judgment): boolean {
    return judgment === 'BAD' || judgment === 'POOR' || judgment === 'MISS';
  }

  /**
   * FAST/SLOW timing indicator.
   */
  private getTimingIndicator(offset: number, judgment: Judgment): TimingIndicator {
    // Within 2ms of PGREAT center counts as JUST
    if (judgment === 'PGREAT' && Math.abs(offset) <= 2) {
      return 'JUST';
    }
    return offset < 0 ? 'FAST' : 'SLOW';
  }

  /**
   * Returns the current judgment window settings.
   */
  getWindows(): JudgmentWindows {
    return { ...this.windows };
  }

  /**
   * Sets EXRANK mode.
   */
  setExrankMode(enabled: boolean): void {
    this.exrankMode = enabled;
  }

  /**
   * Returns the EX score for a judgment.
   */
  static getExScore(judgment: Judgment): number {
    switch (judgment) {
      case 'PGREAT': return 2;
      case 'GREAT': return 1;
      default: return 0;
    }
  }

  /**
   * Returns the judgment label.
   */
  static getLabel(judgment: Judgment): string {
    switch (judgment) {
      case 'PGREAT': return 'PERFECT';
      case 'GREAT': return 'GREAT';
      case 'GOOD': return 'GOOD';
      case 'BAD': return 'BAD';
      case 'POOR': return 'POOR';
      case 'MISS': return 'MISS';
    }
  }

  /**
   * Returns the judgment color (CSS color).
   */
  static getColor(judgment: Judgment): string {
    switch (judgment) {
      case 'PGREAT': return '#00ffff';  // Cyan
      case 'GREAT': return '#ffff00';   // Yellow
      case 'GOOD': return '#00ff00';    // Green
      case 'BAD': return '#ff6600';     // Orange
      case 'POOR': return '#ff0000';    // Red
      case 'MISS': return '#808080';    // Gray
    }
  }
}

export default JudgmentEngine;
