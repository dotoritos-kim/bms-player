/**
 * BMS 판정 엔진
 * #RANK, #DEFEXRANK 기반 판정 시스템 구현
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
  offset: number;           // ms (음수=FAST, 양수=SLOW)
  timing: TimingIndicator;
  isComboBreak: boolean;
}

export type JudgmentStyle = 'lr2' | 'beatoraja' | 'iidx';

// LR2 스타일 판정 창 (#RANK 기반)
const LR2_JUDGMENT_WINDOWS: Record<number, JudgmentWindows> = {
  0: { pgreat: 8,  great: 24,  good: 40,   bad: 200 },  // VERY HARD
  1: { pgreat: 15, great: 30,  good: 60,   bad: 200 },  // HARD
  2: { pgreat: 18, great: 40,  good: 100,  bad: 200 },  // NORMAL
  3: { pgreat: 21, great: 60,  good: 120,  bad: 200 },  // EASY
  4: { pgreat: 25, great: 75,  good: 150,  bad: 200 },  // VERY EASY
};

// beatoraja 스타일 판정 창
const BEATORAJA_JUDGMENT_WINDOWS: Record<number, JudgmentWindows> = {
  0: { pgreat: 5,  great: 15,  good: 37,   bad: 200 },  // VERY HARD
  1: { pgreat: 10, great: 30,  good: 75,   bad: 200 },  // HARD
  2: { pgreat: 15, great: 45,  good: 112,  bad: 200 },  // NORMAL
  3: { pgreat: 20, great: 60,  good: 150,  bad: 200 },  // EASY
  4: { pgreat: 25, great: 75,  good: 187,  bad: 200 },  // VERY EASY
};

// IIDX 스타일 판정 창 (고정)
const IIDX_JUDGMENT_WINDOWS: JudgmentWindows = {
  pgreat: 16.67,
  great: 33.33,
  good: 116.67,
  bad: 250,
};

export interface JudgmentEngineConfig {
  rank: number;              // 0-4
  defexrank?: number;        // 커스텀 판정 (100 = NORMAL)
  style: JudgmentStyle;
  exrankMode?: boolean;      // All or Nothing 모드
}

export class JudgmentEngine {
  private windows: JudgmentWindows;
  private exrankMode: boolean = false;

  constructor(config: Partial<JudgmentEngineConfig> = {}) {
    const { rank = 2, defexrank, style = 'lr2', exrankMode = false } = config;

    this.exrankMode = exrankMode;

    if (defexrank !== undefined) {
      // #DEFEXRANK 기반 커스텀 판정
      // #DEFEXRANK 100 기준 PGREAT = ±16ms, ±1 = ±0.16ms
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
      // LR2 스타일 (기본)
      this.windows = { ...(LR2_JUDGMENT_WINDOWS[rank] ?? LR2_JUDGMENT_WINDOWS[2]) };
    }
  }

  /**
   * 입력 시간과 노트 시간을 비교하여 판정
   * @param inputTime 입력 시간 (ms, performance.now 기준)
   * @param noteTime 노트 시간 (ms, 게임 시작 기준)
   */
  judge(inputTime: number, noteTime: number): JudgmentResult {
    const offset = inputTime - noteTime;  // 음수 = FAST, 양수 = SLOW
    const absOffset = Math.abs(offset);

    let judgment: Judgment;

    if (this.exrankMode) {
      // All or Nothing 모드 (#EXRANK)
      // PGREAT 1프레임(~16.67ms) 또는 BAD
      const frameMs = 16.67;
      judgment = absOffset <= frameMs ? 'PGREAT' : 'BAD';
    } else {
      // 일반 판정
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
   * 노트가 판정 창을 완전히 벗어났는지 확인 (MISS 판정용)
   */
  isMissed(currentTime: number, noteTime: number): boolean {
    return currentTime - noteTime > this.windows.bad;
  }

  /**
   * 노트가 판정 가능한 범위 내에 있는지 확인
   */
  isInJudgmentRange(currentTime: number, noteTime: number): boolean {
    const offset = Math.abs(currentTime - noteTime);
    return offset <= this.windows.bad;
  }

  /**
   * 노트가 아직 도달하지 않았는지 확인 (미래 노트)
   */
  isUpcoming(currentTime: number, noteTime: number): boolean {
    return noteTime - currentTime > this.windows.bad;
  }

  /**
   * 콤보 브레이크 여부 확인
   */
  isComboBreak(judgment: Judgment): boolean {
    return judgment === 'BAD' || judgment === 'POOR' || judgment === 'MISS';
  }

  /**
   * FAST/SLOW 타이밍 표시
   */
  private getTimingIndicator(offset: number, judgment: Judgment): TimingIndicator {
    // PGREAT 중앙 2ms 이내는 JUST
    if (judgment === 'PGREAT' && Math.abs(offset) <= 2) {
      return 'JUST';
    }
    return offset < 0 ? 'FAST' : 'SLOW';
  }

  /**
   * 현재 판정 창 설정 반환
   */
  getWindows(): JudgmentWindows {
    return { ...this.windows };
  }

  /**
   * EXRANK 모드 설정
   */
  setExrankMode(enabled: boolean): void {
    this.exrankMode = enabled;
  }

  /**
   * 판정에 따른 EX 스코어 반환
   */
  static getExScore(judgment: Judgment): number {
    switch (judgment) {
      case 'PGREAT': return 2;
      case 'GREAT': return 1;
      default: return 0;
    }
  }

  /**
   * 판정 레이블 반환
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
   * 판정 색상 반환 (CSS 색상)
   */
  static getColor(judgment: Judgment): string {
    switch (judgment) {
      case 'PGREAT': return '#00ffff';  // 시안
      case 'GREAT': return '#ffff00';   // 노랑
      case 'GOOD': return '#00ff00';    // 초록
      case 'BAD': return '#ff6600';     // 주황
      case 'POOR': return '#ff0000';    // 빨강
      case 'MISS': return '#808080';    // 회색
    }
  }
}

export default JudgmentEngine;
