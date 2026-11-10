/**
 * KeysoundPlayer interface
 *
 * Defines the contract for keysound playback that the game engine depends on.
 * Consumers of this library must provide an implementation of this interface.
 */

import type { AudioPreloader } from '../audio/loader/AudioPreloader';

export interface KeysoundPlayer {
  /** Whether the player has finished loading and is ready to play */
  readonly isReady: boolean;
  /** Play a keysound by its ID, optionally starting at an offset (seconds), scheduled AudioContext time, and volume (0-1) */
  play(keysoundId: string, offset?: number, scheduledTime?: number, volume?: number): void;
  /** Stop all currently playing keysounds */
  stopAll(): void;
  /**
   * Freeze every keysound (sounding or scheduled) where it is; `resumeAll()`
   * continues them. The game loops use this for pause so long BGM samples
   * survive it. Optional: without it a pause falls back to `stopAll()`.
   */
  pauseAll?(): void;
  /** Continue the keysounds frozen by `pauseAll()` (no-op when not paused). */
  resumeAll?(): void;
  /** Release all resources */
  dispose(): void;
  /**
   * Internal `AudioPreloader` reference (used by some callers such as GameLoop to access the AudioContext).
   *
   * @deprecated Use `getAudioContext()` instead of referencing this directly. Scheduled for removal in the next major version.
   */
  readonly preloader?: AudioPreloader;
  /**
   * Safely exposes the internal `AudioContext` (removes casts that bypassed preloader encapsulation).
   * Optional for external implementations — when not implemented, callers fall back
   * to `preloader?.context`.
   */
  getAudioContext?(): AudioContext | null;
}
