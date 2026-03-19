/**
 * BMS 스코어 관리
 * EX-SCORE, 콤보, 정확도 계산
 */

import type { Judgment } from './JudgmentEngine';

export interface ScoreState {
  // 판정 카운트
  pgreatCount: number;
  greatCount: number;
  goodCount: number;
  badCount: number;
  poorCount: number;
  missCount: number;

  // 콤보
  currentCombo: number;
  maxCombo: number;

  // 점수
  exScore: number;

  // 비율
  totalNotes: number;
  accuracy: number;
  exScoreRate: number;

  // 마지막 판정
  lastJudgment: Judgment | null;
  lastOffset: number;
}

export interface ScoreManagerConfig {
  totalNotes: number;  // 전체 노트 수 (클리어 비율 계산용)
}

export class ScoreManager {
  // 판정 카운트
  private _pgreatCount: number = 0;
  private _greatCount: number = 0;
  private _goodCount: number = 0;
  private _badCount: number = 0;
  private _poorCount: number = 0;
  private _missCount: number = 0;

  // 콤보
  private _currentCombo: number = 0;
  private _maxCombo: number = 0;

  // 설정
  private _totalNotes: number;

  // 마지막 판정 정보
  private _lastJudgment: Judgment | null = null;
  private _lastOffset: number = 0;

  // 변화 추적 (애니메이션용)
  private _comboChanged: boolean = false;
  private _scoreChanged: boolean = false;

  constructor(config: ScoreManagerConfig) {
    this._totalNotes = config.totalNotes;
  }

  /**
   * 판정 기록
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

    // 최대 콤보 갱신
    if (this._currentCombo > this._maxCombo) {
      this._maxCombo = this._currentCombo;
    }
  }

  /**
   * EX 스코어 (PGREAT×2 + GREAT×1)
   */
  get exScore(): number {
    return this._pgreatCount * 2 + this._greatCount;
  }

  /**
   * 최대 가능 EX 스코어
   */
  get maxExScore(): number {
    return this._totalNotes * 2;
  }

  /**
   * 처리된 노트 수
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
   * 정확도 (0-100)
   * PGREAT=100%, GREAT=80%, GOOD=50%, 나머지=0%
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
   * EX 스코어 비율 (0-1)
   */
  get exScoreRate(): number {
    const maxEx = this._totalNotes * 2;
    if (maxEx === 0) return 0;
    return this.exScore / maxEx;
  }

  /**
   * 현재 진행률 (0-1)
   */
  get progress(): number {
    if (this._totalNotes === 0) return 0;
    return this.judgedNotes / this._totalNotes;
  }

  /**
   * DJ 레벨 계산 (AAA, AA, A, ...)
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
   * 풀콤보 여부
   */
  get isFullCombo(): boolean {
    return this._badCount === 0 && this._poorCount === 0 && this._missCount === 0;
  }

  /**
   * 퍼펙트 여부 (PGREAT만)
   */
  get isPerfect(): boolean {
    return this.isFullCombo && this._greatCount === 0 && this._goodCount === 0;
  }

  /**
   * 현재 상태 반환
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
   * Getter들
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
   * 콤보 변화 확인 및 리셋 (애니메이션용)
   */
  consumeComboChange(): boolean {
    const changed = this._comboChanged;
    this._comboChanged = false;
    return changed;
  }

  /**
   * 스코어 변화 확인 및 리셋 (애니메이션용)
   */
  consumeScoreChange(): boolean {
    const changed = this._scoreChanged;
    this._scoreChanged = false;
    return changed;
  }

  /**
   * 리셋
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
