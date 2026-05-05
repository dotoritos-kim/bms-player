/**
 * Game lifecycle state machine.
 *
 * Stage 3 (REFACTOR-PLAN §6.2 / §9 S6): replaces the 4 separate boolean flags
 * (`isPlaying` / `isPaused` / `isFailed` / `isCompleted`) — duplicated across
 * `GameLoop`, `WorkerGameLoop`, `GameEngine`, `useGamePlayer`, `GamePlayer`,
 * `workerProtocol` — with a single discriminated union. Impossible states
 * (e.g. `isPlaying && isCompleted`) become unrepresentable.
 *
 * **Compatibility policy**: external API surface (`GameLoopState`/`GameEngineState`/
 * `SerializedGameState`/`GamePlayerState`) keeps the 4 booleans as **derived**
 * fields populated via {@link gamePhaseToFlags}. Internal classes prefer the
 * `phase` field; existing `isPlaying`/`isPaused`/`isCompleted`/`isFailed`
 * getters remain as derived accessors so that bms-editor / bms-electron-app
 * are not affected.
 */
export type GamePhase =
  | { readonly kind: 'ready' }
  | { readonly kind: 'playing' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed' };

export type GamePhaseKind = GamePhase['kind'];

/** Sentinel — initial state for every loop/engine instance. */
export const PHASE_READY: GamePhase = Object.freeze({ kind: 'ready' });
export const PHASE_PLAYING: GamePhase = Object.freeze({ kind: 'playing' });
export const PHASE_PAUSED: GamePhase = Object.freeze({ kind: 'paused' });
export const PHASE_COMPLETED: GamePhase = Object.freeze({ kind: 'completed' });
export const PHASE_FAILED: GamePhase = Object.freeze({ kind: 'failed' });

/**
 * Allowed transition table.
 *
 * - `ready → playing` (start)
 * - `playing → paused` (pause)
 * - `paused → playing` (resume)
 * - `playing → completed` (chart end)
 * - `playing → failed` (gauge empty)
 * - `playing → ready` (stop)
 * - `paused → ready` (stop)
 * - `completed → ready` / `failed → ready` (restart)
 * - any → ready (defensive — `stop()` is always allowed)
 */
const ALLOWED: ReadonlyMap<GamePhaseKind, ReadonlySet<GamePhaseKind>> = new Map([
  ['ready', new Set<GamePhaseKind>(['ready', 'playing'])],
  ['playing', new Set<GamePhaseKind>(['playing', 'paused', 'completed', 'failed', 'ready'])],
  ['paused', new Set<GamePhaseKind>(['paused', 'playing', 'ready', 'completed', 'failed'])],
  ['completed', new Set<GamePhaseKind>(['completed', 'ready'])],
  ['failed', new Set<GamePhaseKind>(['failed', 'ready'])],
]);

/** Returns true if the transition `from → to` is permitted. */
export function canTransition(from: GamePhaseKind, to: GamePhaseKind): boolean {
  return ALLOWED.get(from)?.has(to) ?? false;
}

/**
 * Derive the legacy 4-boolean view from a phase. Used to populate
 * `GameLoopState` / `GameEngineState` / `SerializedGameState` for
 * external consumers without breaking their shape.
 *
 * Mapping:
 * - `ready` → all false
 * - `playing` → isPlaying=true
 * - `paused` → isPlaying=true, isPaused=true (matches legacy behavior — pause
 *   does not clear `_isPlaying` in the prior implementation)
 * - `completed` → isCompleted=true
 * - `failed` → isFailed=true
 */
export function gamePhaseToFlags(phase: GamePhase): {
  isPlaying: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  isFailed: boolean;
} {
  switch (phase.kind) {
    case 'ready':
      return { isPlaying: false, isPaused: false, isCompleted: false, isFailed: false };
    case 'playing':
      return { isPlaying: true, isPaused: false, isCompleted: false, isFailed: false };
    case 'paused':
      return { isPlaying: true, isPaused: true, isCompleted: false, isFailed: false };
    case 'completed':
      return { isPlaying: false, isPaused: false, isCompleted: true, isFailed: false };
    case 'failed':
      return { isPlaying: false, isPaused: false, isCompleted: false, isFailed: true };
  }
}

/** Active = phase represents an ongoing run (whether paused or not). */
export function isActivePhase(phase: GamePhase): boolean {
  return phase.kind === 'playing' || phase.kind === 'paused';
}

/** Terminal = run has ended (cleared/failed); start() is a no-op until restart. */
export function isTerminalPhase(phase: GamePhase): boolean {
  return phase.kind === 'completed' || phase.kind === 'failed';
}
