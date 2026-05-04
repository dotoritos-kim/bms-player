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
  /** Release all resources */
  dispose(): void;
  /**
   * 내부 `AudioPreloader` 참조 (GameLoop 등 일부 콜러가 AudioContext 접근을 위해 사용).
   *
   * @deprecated 직접 참조 대신 `getAudioContext()` 를 사용하세요. 다음 메이저에서 제거 예정.
   */
  readonly preloader?: AudioPreloader;
  /**
   * 내부 `AudioContext` 를 안전하게 노출한다 (preloader 캡슐화 우회용 cast 제거 목적).
   * 외부 구현체에서는 선택적으로 구현 가능 — 미구현 시 호출자는 `preloader?.context` 로
   * 폴백한다.
   */
  getAudioContext?(): AudioContext | null;
}
