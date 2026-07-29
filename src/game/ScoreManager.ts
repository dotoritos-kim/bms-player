/**
 * BMS score management.
 * Computes EX-SCORE, combo, and accuracy.
 */

import type { Judgment } from './JudgmentEngine';

export interface ScoreState {
  // Judgment counts
  pgreatCount: number;
  greatCount: number;
  goodCount: number;
  badCount: number;
  poorCount: number;
  missCount: number;

  // Combo
  currentCombo: number;
  maxCombo: number;

  // Score
  exScore: number;

  // Rates
  totalNotes: number;
  accuracy: number;
  exScoreRate: number;

  // Last judgment
  lastJudgment: Judgment | null;
  lastOffset: number;
}

export interface ScoreManagerConfig {
  totalNotes: number;  // Total note count (for clear rate calculation)
}

export class ScoreManager {
  // Judgment counts
  private _pgreatCount: number = 0;
  private _greatCount: number = 0;
  private _goodCount: number = 0;
  private _badCount: number = 0;
  private _poorCount: number = 0;
  private _missCount: number = 0;

  // Combo
  private _currentCombo: number = 0;
  private _maxCombo: number = 0;

  // Config
  private _totalNotes: number;

  // Last judgment info
  private _lastJudgment: Judgment | null = null;
  private _lastOffset: number = 0;

  // Change tracking (for animations)
  private _comboChanged: boolean = false;
  private _scoreChanged: boolean = false;

  constructor(config: ScoreManagerConfig) {
    this._totalNotes = config.totalNotes;
  }

  /**
   * Records a judgment.
   */
  onJudgment(judgment: Judgment, offset: number = 0): void {
    this._lastJudgment = judgment;
    this._lastOffset = offset;
    this._scoreChanged = true;

    switch (judgment) {
      case 'PGREAT':
        this._pgreatCount++;
        this._currentCombo++;
        this._comboChanged = true;
        break;
      case 'GREAT':
        this._greatCount++;
        this._currentCombo++;
        this._comboChanged = true;
        break;
      case 'GOOD':
        this._goodCount++;
        this._currentCombo++;
        this._comboChanged = true;
        break;
      case 'BAD':
        this._badCount++;
        this._currentCombo = 0;
        this._comboChanged = true;
        break;
      case 'POOR':
        this._poorCount++;
        this._currentCombo = 0;
        this._comboChanged = true;
        break;
      case 'MISS':
        this._missCount++;
        this._currentCombo = 0;
        this._comboChanged = true;
        break;
    }

    // Update the max combo
    if (this._currentCombo > this._maxCombo) {
      this._maxCombo = this._currentCombo;
    }
  }

  /**
   * EX score (PGREAT×2 + GREAT×1).
   */
  get exScore(): number {
    return this._pgreatCount * 2 + this._greatCount;
  }

  /**
   * Maximum possible EX score.
   */
  get maxExScore(): number {
    return this._totalNotes * 2;
  }

  /**
   * Number of judged notes.
   */
  get judgedNotes(): number {
    return (
      this._pgreatCount +
      this._greatCount +
      this._goodCount +
      this._badCount +
      this._poorCount +
      this._missCount
    );
  }

  /**
   * Accuracy (0-100).
   * PGREAT=100%, GREAT=80%, GOOD=50%, others=0%
   */
  get accuracy(): number {
    const judged = this.judgedNotes;
    if (judged === 0) return 100;

    const points =
      this._pgreatCount * 100 +
      this._greatCount * 80 +
      this._goodCount * 50;

    return points / judged;
  }

  /**
   * EX score rate (0-1).
   */
  get exScoreRate(): number {
    const maxEx = this._totalNotes * 2;
    if (maxEx === 0) return 0;
    return this.exScore / maxEx;
  }

  /**
   * Current progress (0-1).
   */
  get progress(): number {
    if (this._totalNotes === 0) return 0;
    return this.judgedNotes / this._totalNotes;
  }

  /**
   * Computes the DJ level (AAA, AA, A, ...).
   */
  get djLevel(): string {
    const rate = this.exScoreRate;

    if (rate >= 8 / 9) return 'AAA';
    if (rate >= 7 / 9) return 'AA';
    if (rate >= 6 / 9) return 'A';
    if (rate >= 5 / 9) return 'B';
    if (rate >= 4 / 9) return 'C';
    if (rate >= 3 / 9) return 'D';
    if (rate >= 2 / 9) return 'E';
    return 'F';
  }

  /**
   * Whether it is a full combo.
   */
  get isFullCombo(): boolean {
    return this._badCount === 0 && this._poorCount === 0 && this._missCount === 0;
  }

  /**
   * Whether it is perfect (PGREAT only).
   */
  get isPerfect(): boolean {
    return this.isFullCombo && this._greatCount === 0 && this._goodCount === 0;
  }

  /**
   * Returns the current state.
   */
  getState(): ScoreState {
    return {
      pgreatCount: this._pgreatCount,
      greatCount: this._greatCount,
      goodCount: this._goodCount,
      badCount: this._badCount,
      poorCount: this._poorCount,
      missCount: this._missCount,
      currentCombo: this._currentCombo,
      maxCombo: this._maxCombo,
      exScore: this.exScore,
      totalNotes: this._totalNotes,
      accuracy: this.accuracy,
      exScoreRate: this.exScoreRate,
      lastJudgment: this._lastJudgment,
      lastOffset: this._lastOffset,
    };
  }

  /**
   * Getters
   */
  get pgreatCount(): number { return this._pgreatCount; }
  get greatCount(): number { return this._greatCount; }
  get goodCount(): number { return this._goodCount; }
  get badCount(): number { return this._badCount; }
  get poorCount(): number { return this._poorCount; }
  get missCount(): number { return this._missCount; }
  get currentCombo(): number { return this._currentCombo; }
  get maxCombo(): number { return this._maxCombo; }
  get totalNotes(): number { return this._totalNotes; }
  get lastJudgment(): Judgment | null { return this._lastJudgment; }
  get lastOffset(): number { return this._lastOffset; }

  /**
   * Checks and resets the combo change flag (for animations).
   */
  consumeComboChange(): boolean {
    const changed = this._comboChanged;
    this._comboChanged = false;
    return changed;
  }

  /**
   * Checks and resets the score change flag (for animations).
   */
  consumeScoreChange(): boolean {
    const changed = this._scoreChanged;
    this._scoreChanged = false;
    return changed;
  }

  /**
   * Resets everything.
   */
  reset(): void {
    this._pgreatCount = 0;
    this._greatCount = 0;
    this._goodCount = 0;
    this._badCount = 0;
    this._poorCount = 0;
    this._missCount = 0;
    this._currentCombo = 0;
    this._maxCombo = 0;
    this._lastJudgment = null;
    this._lastOffset = 0;
    this._comboChanged = false;
    this._scoreChanged = false;
  }
}

export default ScoreManager;
