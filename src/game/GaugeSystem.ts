/**
 * BMS gauge system.
 * Implements the GROOVE, HARD, EX-HARD, EASY, and ASSIST EASY gauges.
 */

import type { Judgment } from './JudgmentEngine';

export type GaugeType = 'groove' | 'easy' | 'assist-easy' | 'hard' | 'exhard';

export interface GaugeConfig {
  startValue: number;       // Starting gauge (%)
  clearTarget: number;      // Clear threshold (%)
  minValue: number;         // Minimum gauge (%)
  failOnZero: boolean;      // Whether to fail immediately at 0%
  lowHpThreshold: number;   // Low-HP compensation threshold (%)
  lowHpMultiplier: number;  // Low-HP compensation multiplier
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
    lowHpMultiplier: 0.5,  // Damage halved
  },
  'assist-easy': {
    startValue: 22,
    clearTarget: 60,  // Lower clear threshold
    minValue: 2,
    failOnZero: false,
    lowHpThreshold: 0,
    lowHpMultiplier: 0.5,
  },
  'hard': {
    startValue: 100,
    clearTarget: 0.01,  // Above 0%
    minValue: 0,
    failOnZero: true,
    lowHpThreshold: 30,  // Compensation at 30% or below
    lowHpMultiplier: 0.5,
  },
  'exhard': {
    startValue: 100,
    clearTarget: 0.01,
    minValue: 0,
    failOnZero: true,
    lowHpThreshold: 0,  // No compensation
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
  private increase: number;  // TOTAL-based increase amount
  private failed: boolean = false;

  // Change tracking (for animations)
  private lastDelta: number = 0;
  private lastJudgment: Judgment | null = null;

  constructor(type: GaugeType, total: number, noteCount: number) {
    this.type = type;
    this.config = { ...GAUGE_CONFIGS[type] };
    this.value = this.config.startValue;

    // Compute the #TOTAL-based increase amount
    // increase = TOTAL / total note count
    this.increase = noteCount > 0 ? total / noteCount : 1;
  }

  /**
   * Updates the gauge based on a judgment.
   */
  onJudgment(judgment: Judgment): void {
    if (this.failed) return;

    let delta = 0;

    // Compute the base delta according to the gauge type
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

    // Apply compensation on decrease
    if (delta < 0) {
      // Low-HP compensation
      if (this.config.lowHpThreshold > 0 && this.value <= this.config.lowHpThreshold) {
        delta *= this.config.lowHpMultiplier;
      }

      // Easy/Assist Easy global decrease compensation
      if (this.type === 'easy' || this.type === 'assist-easy') {
        delta *= 0.5;
      }

      // EX-Hard doubled decrease
      if (this.type === 'exhard') {
        delta *= 2;
      }
    }

    // Update the gauge value
    this.value = Math.max(
      this.config.minValue,
      Math.min(100, this.value + delta)
    );

    // Track state
    this.lastDelta = delta;
    this.lastJudgment = judgment;

    // Failure check (when reaching 0%)
    if (this.config.failOnZero && this.value <= 0) {
      this.failed = true;
    }
  }

  /**
   * GROOVE/EASY/ASSIST-EASY gauge delta.
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
   * HARD/EX-HARD gauge delta.
   */
  private calculateHardDelta(judgment: Judgment): number {
    switch (judgment) {
      case 'PGREAT':
      case 'GREAT':
        return 0.16;  // Fixed increase
      case 'GOOD':
        return 0;     // No change
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
   * Applies direct damage (for landmine notes).
   * @param damage Damage amount (0-100%)
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
   * Returns the current state.
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
   * Current gauge value (%).
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Whether the gauge is cleared.
   */
  isCleared(): boolean {
    return !this.failed && this.value >= this.config.clearTarget;
  }

  /**
   * Whether the gauge has failed.
   */
  isFailed(): boolean {
    return this.failed;
  }

  /**
   * Whether the gauge is in the danger zone (for UI effects like blinking).
   */
  isDanger(): boolean {
    if (this.type === 'hard' || this.type === 'exhard') {
      return this.value <= 30;
    }
    return this.value < this.config.clearTarget && this.value <= 30;
  }

  /**
   * Last delta (for animations).
   */
  getLastDelta(): number {
    return this.lastDelta;
  }

  /**
   * Last judgment (for animations).
   */
  getLastJudgment(): Judgment | null {
    return this.lastJudgment;
  }

  /**
   * Changes the gauge type (on restart).
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
   * Returns the gauge color.
   */
  static getColor(type: GaugeType): string {
    switch (type) {
      case 'groove': return '#00ff00';    // Green
      case 'easy': return '#00ff88';      // Mint
      case 'assist-easy': return '#88ff88'; // Light green
      case 'hard': return '#ff0000';      // Red
      case 'exhard': return '#ff00ff';    // Magenta
    }
  }

  /**
   * Returns the gauge type label.
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
