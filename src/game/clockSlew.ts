/**
 * Keeps a local clock on an authoritative one.
 *
 * The worker game loop runs on `performance.now()`, the audio (BGM and every
 * scheduled keysound) on the audio device's clock. The two tick at slightly
 * different rates, so over a few minutes the notes on screen and their
 * judgment drift away from the music. The main thread reports the audio
 * clock a few times a second; this turns each report into a small correction.
 *
 * Reports are noisy (the audio clock advances in render quanta), so the error
 * is smoothed and corrected a fraction at a time. Only a large gap (the audio
 * device stalled) is closed in one step.
 */
export class ClockSlew {
  /** Smoothed error, authoritative minus local (ms). */
  private smoothed: number | null = null;

  /** Share of a new report taken into the smoothed error. */
  private static readonly SMOOTHING = 0.3;
  /** Share of the smoothed error corrected per report. */
  private static readonly GAIN = 0.25;
  /** Largest gradual correction per report (ms). */
  private static readonly MAX_STEP_MS = 4;
  /** Beyond this the clocks are re-aligned at once (ms). */
  private static readonly SNAP_MS = 40;
  /** Reports further off than this are from another clock domain (ms). */
  private static readonly IGNORE_MS = 1000;

  reset(): void {
    this.smoothed = null;
  }

  /**
   * @param errorMs authoritative time minus local time, measured at one instant
   * @returns ms to add to the local clock now
   */
  correction(errorMs: number): number {
    if (!Number.isFinite(errorMs) || Math.abs(errorMs) > ClockSlew.IGNORE_MS) return 0;
    this.smoothed = this.smoothed === null
      ? errorMs
      : this.smoothed + (errorMs - this.smoothed) * ClockSlew.SMOOTHING;

    let step: number;
    if (Math.abs(this.smoothed) > ClockSlew.SNAP_MS) {
      step = this.smoothed;
    } else {
      step = Math.max(-ClockSlew.MAX_STEP_MS, Math.min(ClockSlew.MAX_STEP_MS, this.smoothed * ClockSlew.GAIN));
    }
    this.smoothed -= step;
    return step;
  }
}
