/**
 * BMS 게이지 시스템
 * GROOVE, HARD, EX-HARD, EASY, ASSIST EASY 게이지 구현
 */

import type { Judgment } from './JudgmentEngine';

export type GaugeType = 'groove' | 'easy' | 'assist-easy' | 'hard' | 'exhard';

export interface GaugeConfig {
  startValue: number;       // 시작 게이지 (%)
  clearTarget: number;      // 클리어 기준 (%)
  minValue: number;         // 최소 게이지 (%)
  failOnZero: boolean;      // 0%에서 즉시 실패 여부
  lowHpThreshold: number;   // 저생명치 보정 기준 (%)
  lowHpMultiplier: number;  // 저생명치 보정 배율
}

const GAUGE_CONFIGS: Record<GaugeType, GaugeConfig> = {
  'groove': {
    startValue: 22,
    clearTarget: 80,
    minValue: 2,
    failOnZero: false,
    lowHpThreshold: 0,
    lowHpMultiplier: 1,
  },
  'easy': {
    startValue: 22,
    clearTarget: 80,
    minValue: 2,
    failOnZero: false,
    lowHpThreshold: 0,
    lowHpMultiplier: 0.5,  // 감소량 절반
  },
  'assist-easy': {
    startValue: 22,
    clearTarget: 60,  // 낮은 클리어 기준
    minValue: 2,
    failOnZero: false,
    lowHpThreshold: 0,
    lowHpMultiplier: 0.5,
  },
  'hard': {
    startValue: 100,
    clearTarget: 0.01,  // 0% 초과
    minValue: 0,
    failOnZero: true,
    lowHpThreshold: 30,  // 30% 이하 보정
    lowHpMultiplier: 0.5,
  },
  'exhard': {
    startValue: 100,
    clearTarget: 0.01,
    minValue: 0,
    failOnZero: true,
    lowHpThreshold: 0,  // 보정 없음
    lowHpMultiplier: 1,
  },
};

export interface GaugeSystemState {
  type: GaugeType;
  value: number;
  isFailed: boolean;
  isCleared: boolean;
}

export class GaugeSystem {
  private type: GaugeType;
  private config: GaugeConfig;
  private value: number;
  private increase: number;  // TOTAL 기반 증가량
  private failed: boolean = false;

  // 변화 추적 (애니메이션용)
  private lastDelta: number = 0;
  private lastJudgment: Judgment | null = null;

  constructor(type: GaugeType, total: number, noteCount: number) {
    this.type = type;
    this.config = { ...GAUGE_CONFIGS[type] };
    this.value = this.config.startValue;

    // #TOTAL 기반 증가량 계산
    // 증가량 = TOTAL / 총 노트 수
    this.increase = noteCount > 0 ? total / noteCount : 1;
  }

  /**
   * 판정에 따른 게이지 업데이트
   */
  onJudgment(judgment: Judgment): void {
    if (this.failed) return;

    let delta = 0;

    // 게이지 타입에 따른 기본 증감량 계산
    switch (this.type) {
      case 'groove':
      case 'easy':
      case 'assist-easy':
        delta = this.calculateGrooveDelta(judgment);
        break;
      case 'hard':
      case 'exhard':
        delta = this.calculateHardDelta(judgment);
        break;
    }

    // 감소 시 보정 적용
    if (delta < 0) {
      // 저생명치 보정
      if (this.config.lowHpThreshold > 0 && this.value <= this.config.lowHpThreshold) {
        delta *= this.config.lowHpMultiplier;
      }

      // Easy/Assist Easy 전체 감소 보정
      if (this.type === 'easy' || this.type === 'assist-easy') {
        delta *= 0.5;
      }

      // EX-Hard 2배 감소
      if (this.type === 'exhard') {
        delta *= 2;
      }
    }

    // 게이지 값 업데이트
    this.value = Math.max(
      this.config.minValue,
      Math.min(100, this.value + delta)
    );

    // 상태 추적
    this.lastDelta = delta;
    this.lastJudgment = judgment;

    // 실패 체크 (0% 도달 시)
    if (this.config.failOnZero && this.value <= 0) {
      this.failed = true;
    }
  }

  /**
   * GROOVE/EASY/ASSIST-EASY 게이지 증감량
   */
  private calculateGrooveDelta(judgment: Judgment): number {
    switch (judgment) {
      case 'PGREAT':
      case 'GREAT':
        return this.increase;
      case 'GOOD':
        return this.increase * 0.5;
      case 'BAD':
        return -2;
      case 'POOR':
        return -6;
      case 'MISS':
        return -2;
      default:
        return 0;
    }
  }

  /**
   * HARD/EX-HARD 게이지 증감량
   */
  private calculateHardDelta(judgment: Judgment): number {
    switch (judgment) {
      case 'PGREAT':
      case 'GREAT':
        return 0.16;  // 고정 증가량
      case 'GOOD':
        return 0;     // 변화 없음
      case 'BAD':
        return -5;
      case 'POOR':
        return -9;
      case 'MISS':
        return -5;
      default:
        return 0;
    }
  }

  /**
   * 직접 데미지 적용 (지뢰 노트용)
   * @param damage 데미지량 (0-100%)
   */
  applyDamage(damage: number): void {
    if (this.failed) return;

    this.value = Math.max(this.config.minValue, this.value - damage);
    this.lastDelta = -damage;

    if (this.config.failOnZero && this.value <= 0) {
      this.failed = true;
    }
  }

  /**
   * 현재 상태 반환
   */
  getState(): GaugeSystemState {
    return {
      type: this.type,
      value: this.value,
      isFailed: this.failed,
      isCleared: this.isCleared(),
    };
  }

  /**
   * 현재 게이지 값 (%)
   */
  getValue(): number {
    return this.value;
  }

  /**
   * 클리어 여부
   */
  isCleared(): boolean {
    return !this.failed && this.value >= this.config.clearTarget;
  }

  /**
   * 실패 여부
   */
  isFailed(): boolean {
    return this.failed;
  }

  /**
   * 위험 상태 여부 (깜빡임 등 UI 효과용)
   */
  isDanger(): boolean {
    if (this.type === 'hard' || this.type === 'exhard') {
      return this.value <= 30;
    }
    return this.value < this.config.clearTarget && this.value <= 30;
  }

  /**
   * 마지막 변화량 (애니메이션용)
   */
  getLastDelta(): number {
    return this.lastDelta;
  }

  /**
   * 마지막 판정 (애니메이션용)
   */
  getLastJudgment(): Judgment | null {
    return this.lastJudgment;
  }

  /**
   * 게이지 타입 변경 (재시작 시)
   */
  reset(type?: GaugeType): void {
    if (type) {
      this.type = type;
      this.config = { ...GAUGE_CONFIGS[type] };
    }
    this.value = this.config.startValue;
    this.failed = false;
    this.lastDelta = 0;
    this.lastJudgment = null;
  }

  /**
   * 게이지 색상 반환
   */
  static getColor(type: GaugeType): string {
    switch (type) {
      case 'groove': return '#00ff00';    // 초록
      case 'easy': return '#00ff88';      // 민트
      case 'assist-easy': return '#88ff88'; // 연초록
      case 'hard': return '#ff0000';      // 빨강
      case 'exhard': return '#ff00ff';    // 마젠타
    }
  }

  /**
   * 게이지 타입 레이블 반환
   */
  static getLabel(type: GaugeType): string {
    switch (type) {
      case 'groove': return 'GROOVE';
      case 'easy': return 'EASY';
      case 'assist-easy': return 'ASSIST';
      case 'hard': return 'HARD';
      case 'exhard': return 'EX-HARD';
    }
  }
}

export default GaugeSystem;
