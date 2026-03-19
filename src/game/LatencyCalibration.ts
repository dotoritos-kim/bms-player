/**
 * 오디오 레이턴시 보정 시스템
 * 시스템별 오디오 지연을 측정하고 보정
 */

export interface LatencyConfig {
  /** 오디오 출력 레이턴시 (ms) - 스피커/헤드폰 지연 */
  audioLatency: number;
  /** 입력 레이턴시 (ms) - 키보드 지연 */
  inputLatency: number;
  /** 비주얼 레이턴시 (ms) - 모니터 지연 */
  visualLatency: number;
}

export interface CalibrationResult {
  /** 측정된 평균 레이턴시 */
  measuredLatency: number;
  /** 측정 횟수 */
  sampleCount: number;
  /** 표준편차 */
  standardDeviation: number;
  /** 신뢰도 (0-1) */
  confidence: number;
}

const STORAGE_KEY = 'bms_latency_config';

const DEFAULT_LATENCY: LatencyConfig = {
  audioLatency: 0,
  inputLatency: 0,
  visualLatency: 0,
};

/**
 * 레이턴시 캘리브레이션 클래스
 */
export class LatencyCalibration {
  private config: LatencyConfig;
  private audioContext: AudioContext | null = null;
  private calibrationSamples: number[] = [];
  private isCalibrating: boolean = false;

  constructor(config?: Partial<LatencyConfig>) {
    // 저장된 설정 로드 또는 기본값 사용
    const saved = this.loadConfig();
    this.config = {
      ...DEFAULT_LATENCY,
      ...saved,
      ...config,
    };
  }

  /**
   * 저장된 설정 로드
   */
  private loadConfig(): Partial<LatencyConfig> {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // 로드 실패 시 무시
    }
    return {};
  }

  /**
   * 설정 저장
   */
  saveConfig(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // 저장 실패 시 무시
    }
  }

  /**
   * 현재 설정 반환
   */
  getConfig(): LatencyConfig {
    return { ...this.config };
  }

  /**
   * 설정 업데이트
   */
  setConfig(config: Partial<LatencyConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * 총 보정값 (ms)
   * 오디오 재생 시점 조정에 사용
   */
  getTotalAudioOffset(): number {
    return this.config.audioLatency;
  }

  /**
   * 판정 보정값 (ms)
   * 입력 판정 시점 조정에 사용
   */
  getJudgmentOffset(): number {
    return this.config.inputLatency;
  }

  /**
   * 비주얼 보정값 (ms)
   * 노트 표시 시점 조정에 사용
   */
  getVisualOffset(): number {
    return this.config.visualLatency;
  }

  /**
   * 자동 캘리브레이션 시작
   * 클릭 소리를 들려주고 사용자가 타이밍에 맞춰 키를 누르면 레이턴시 측정
   */
  async startCalibration(
    audioContext: AudioContext,
    onProgress?: (sample: number, total: number) => void
  ): Promise<CalibrationResult> {
    if (this.isCalibrating) {
      throw new Error('Calibration already in progress');
    }

    this.audioContext = audioContext;
    this.calibrationSamples = [];
    this.isCalibrating = true;

    const TOTAL_SAMPLES = 10;
    const INTERVAL = 1000; // 1초 간격으로 비프음

    return new Promise((resolve) => {
      let sampleIndex = 0;
      let expectedTime = 0;

      // 키 입력 핸들러
      const handleKeyDown = (e: KeyboardEvent) => {
        if (!this.isCalibrating || expectedTime === 0) return;
        if (e.repeat) return;

        const inputTime = performance.now();
        const offset = inputTime - expectedTime;

        // 합리적인 범위 내의 입력만 수집 (-500ms ~ +500ms)
        if (Math.abs(offset) < 500) {
          this.calibrationSamples.push(offset);
          onProgress?.(this.calibrationSamples.length, TOTAL_SAMPLES);
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      // 비프음 재생
      const playBeep = () => {
        if (!this.audioContext || sampleIndex >= TOTAL_SAMPLES) {
          // 캘리브레이션 완료
          window.removeEventListener('keydown', handleKeyDown);
          this.isCalibrating = false;
          resolve(this.calculateResult());
          return;
        }

        // 비프음 생성
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = 880; // A5
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        // 예상 입력 시간 기록 (오디오 컨텍스트 시간 기준)
        expectedTime = performance.now();

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.1);

        sampleIndex++;

        // 다음 비프음 예약
        setTimeout(playBeep, INTERVAL);
      };

      // 1초 후 시작
      setTimeout(playBeep, 1000);
    });
  }

  /**
   * 캘리브레이션 결과 계산
   */
  private calculateResult(): CalibrationResult {
    const samples = this.calibrationSamples;

    if (samples.length === 0) {
      return {
        measuredLatency: 0,
        sampleCount: 0,
        standardDeviation: 0,
        confidence: 0,
      };
    }

    // 평균 계산
    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = sum / samples.length;

    // 표준편차 계산
    const squaredDiffs = samples.map((s) => Math.pow(s - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    // 신뢰도 (샘플 수와 표준편차 기반)
    const confidence = Math.min(1, (samples.length / 10) * Math.max(0, 1 - stdDev / 100));

    return {
      measuredLatency: Math.round(mean),
      sampleCount: samples.length,
      standardDeviation: Math.round(stdDev * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * 캘리브레이션 취소
   */
  cancelCalibration(): void {
    this.isCalibrating = false;
    this.calibrationSamples = [];
  }

  /**
   * 캘리브레이션 결과를 설정에 적용
   */
  applyCalibrationResult(result: CalibrationResult): void {
    if (result.confidence >= 0.5) {
      this.config.audioLatency = result.measuredLatency;
      this.saveConfig();
    }
  }

  /**
   * 설정 초기화
   */
  reset(): void {
    this.config = { ...DEFAULT_LATENCY };
    this.saveConfig();
  }
}

export default LatencyCalibration;
