/**
 * Audio latency compensation system.
 * Measures and compensates for per-system audio delay.
 */

export interface LatencyConfig {
  /** Audio output latency (ms) - speaker/headphone delay */
  audioLatency: number;
  /** Input latency (ms) - keyboard delay */
  inputLatency: number;
  /** Visual latency (ms) - monitor delay */
  visualLatency: number;
}

export interface CalibrationResult {
  /** Measured average latency */
  measuredLatency: number;
  /** Number of samples */
  sampleCount: number;
  /** Standard deviation */
  standardDeviation: number;
  /** Confidence (0-1) */
  confidence: number;
}

const STORAGE_KEY = 'bms_latency_config';

const DEFAULT_LATENCY: LatencyConfig = {
  audioLatency: 0,
  inputLatency: 0,
  visualLatency: 0,
};

/**
 * Latency calibration class.
 */
export class LatencyCalibration {
  private config: LatencyConfig;
  private audioContext: AudioContext | null = null;
  private calibrationSamples: number[] = [];
  private isCalibrating: boolean = false;

  constructor(config?: Partial<LatencyConfig>) {
    // Load saved config or use defaults
    const saved = this.loadConfig();
    this.config = {
      ...DEFAULT_LATENCY,
      ...saved,
      ...config,
    };
  }

  /**
   * Loads the saved config.
   */
  private loadConfig(): Partial<LatencyConfig> {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // Ignore load failures
    }
    return {};
  }

  /**
   * Saves the config.
   */
  saveConfig(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // Ignore save failures
    }
  }

  /**
   * Returns the current config.
   */
  getConfig(): LatencyConfig {
    return { ...this.config };
  }

  /**
   * Updates the config.
   */
  setConfig(config: Partial<LatencyConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * Total compensation value (ms).
   * Used to adjust audio playback timing.
   */
  getTotalAudioOffset(): number {
    return this.config.audioLatency;
  }

  /**
   * Judgment compensation value (ms).
   * Used to adjust input judgment timing.
   */
  getJudgmentOffset(): number {
    return this.config.inputLatency;
  }

  /**
   * Visual compensation value (ms).
   * Used to adjust note display timing.
   */
  getVisualOffset(): number {
    return this.config.visualLatency;
  }

  /**
   * Starts automatic calibration.
   * Plays click sounds and measures latency as the user presses a key in time.
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
    const INTERVAL = 1000; // Beep every 1 second

    return new Promise((resolve) => {
      let sampleIndex = 0;
      let expectedTime = 0;

      // Key input handler
      const handleKeyDown = (e: KeyboardEvent) => {
        if (!this.isCalibrating || expectedTime === 0) return;
        if (e.repeat) return;

        const inputTime = performance.now();
        const offset = inputTime - expectedTime;

        // Collect only inputs within a reasonable range (-500ms to +500ms)
        if (Math.abs(offset) < 500) {
          this.calibrationSamples.push(offset);
          onProgress?.(this.calibrationSamples.length, TOTAL_SAMPLES);
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      // Play the beep
      const playBeep = () => {
        if (!this.audioContext || sampleIndex >= TOTAL_SAMPLES) {
          // Calibration complete
          window.removeEventListener('keydown', handleKeyDown);
          this.isCalibrating = false;
          resolve(this.calculateResult());
          return;
        }

        // Generate the beep
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = 880; // A5
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        // Record the expected input time (based on the audio context time)
        expectedTime = performance.now();

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.1);

        sampleIndex++;

        // Schedule the next beep
        setTimeout(playBeep, INTERVAL);
      };

      // Start after 1 second
      setTimeout(playBeep, 1000);
    });
  }

  /**
   * Computes the calibration result.
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

    // Compute the mean
    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = sum / samples.length;

    // Compute the standard deviation
    const squaredDiffs = samples.map((s) => Math.pow(s - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    // Confidence (based on sample count and standard deviation)
    const confidence = Math.min(1, (samples.length / 10) * Math.max(0, 1 - stdDev / 100));

    return {
      measuredLatency: Math.round(mean),
      sampleCount: samples.length,
      standardDeviation: Math.round(stdDev * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Cancels calibration.
   */
  cancelCalibration(): void {
    this.isCalibrating = false;
    this.calibrationSamples = [];
  }

  /**
   * Applies the calibration result to the config.
   */
  applyCalibrationResult(result: CalibrationResult): void {
    if (result.confidence >= 0.5) {
      this.config.audioLatency = result.measuredLatency;
      this.saveConfig();
    }
  }

  /**
   * Resets the config.
   */
  reset(): void {
    this.config = { ...DEFAULT_LATENCY };
    this.saveConfig();
  }
}

export default LatencyCalibration;
