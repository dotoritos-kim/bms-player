import { describe, it, expect } from 'vitest';
import {
  PHASE_READY,
  PHASE_PLAYING,
  PHASE_PAUSED,
  PHASE_COMPLETED,
  PHASE_FAILED,
  canTransition,
  gamePhaseToFlags,
  isActivePhase,
  isTerminalPhase,
} from '../src/types/GamePhase';
import { GameEngine } from '../src/game/GameEngine';
import type { INotechart, GameNote, SoundedEvent } from '../src/audio/judgements';

/**
 * Stage 3 — GamePhase state machine verification.
 *
 * Coverage:
 * 1. 4-boolean derivation (legacy compatibility)
 * 2. Allowed/forbidden transitions
 * 3. GameEngine updates phase correctly and ignores invalid calls (no-op)
 */

describe('GamePhase — derived flags (legacy compatibility)', () => {
  it('ready phase → all flags false', () => {
    expect(gamePhaseToFlags(PHASE_READY)).toEqual({
      isPlaying: false,
      isPaused: false,
      isCompleted: false,
      isFailed: false,
    });
  });

  it('playing phase → isPlaying=true only', () => {
    expect(gamePhaseToFlags(PHASE_PLAYING)).toEqual({
      isPlaying: true,
      isPaused: false,
      isCompleted: false,
      isFailed: false,
    });
  });

  it('paused phase → isPlaying=true && isPaused=true (matches legacy semantics)', () => {
    expect(gamePhaseToFlags(PHASE_PAUSED)).toEqual({
      isPlaying: true,
      isPaused: true,
      isCompleted: false,
      isFailed: false,
    });
  });

  it('completed phase → isCompleted=true only', () => {
    expect(gamePhaseToFlags(PHASE_COMPLETED)).toEqual({
      isPlaying: false,
      isPaused: false,
      isCompleted: true,
      isFailed: false,
    });
  });

  it('failed phase → isFailed=true only', () => {
    expect(gamePhaseToFlags(PHASE_FAILED)).toEqual({
      isPlaying: false,
      isPaused: false,
      isCompleted: false,
      isFailed: true,
    });
  });

  it('isActivePhase → true for playing/paused, false otherwise', () => {
    expect(isActivePhase(PHASE_READY)).toBe(false);
    expect(isActivePhase(PHASE_PLAYING)).toBe(true);
    expect(isActivePhase(PHASE_PAUSED)).toBe(true);
    expect(isActivePhase(PHASE_COMPLETED)).toBe(false);
    expect(isActivePhase(PHASE_FAILED)).toBe(false);
  });

  it('isTerminalPhase → true for completed/failed only', () => {
    expect(isTerminalPhase(PHASE_READY)).toBe(false);
    expect(isTerminalPhase(PHASE_PLAYING)).toBe(false);
    expect(isTerminalPhase(PHASE_PAUSED)).toBe(false);
    expect(isTerminalPhase(PHASE_COMPLETED)).toBe(true);
    expect(isTerminalPhase(PHASE_FAILED)).toBe(true);
  });
});

describe('GamePhase — transition table', () => {
  it('ready → playing (start) allowed', () => {
    expect(canTransition('ready', 'playing')).toBe(true);
  });

  it('playing ↔ paused allowed', () => {
    expect(canTransition('playing', 'paused')).toBe(true);
    expect(canTransition('paused', 'playing')).toBe(true);
  });

  it('playing → completed/failed allowed', () => {
    expect(canTransition('playing', 'completed')).toBe(true);
    expect(canTransition('playing', 'failed')).toBe(true);
  });

  it('any → ready (stop/restart) allowed', () => {
    expect(canTransition('playing', 'ready')).toBe(true);
    expect(canTransition('paused', 'ready')).toBe(true);
    expect(canTransition('completed', 'ready')).toBe(true);
    expect(canTransition('failed', 'ready')).toBe(true);
  });

  it('completed → playing (skip restart) NOT allowed', () => {
    expect(canTransition('completed', 'playing')).toBe(false);
  });

  it('failed → playing (skip restart) NOT allowed', () => {
    expect(canTransition('failed', 'playing')).toBe(false);
  });

  it('ready → paused (must start first) NOT allowed', () => {
    expect(canTransition('ready', 'paused')).toBe(false);
  });
});

// ---- Minimal mock notechart ----
function makeNotechart(notes: GameNote[] = [], autos: SoundedEvent[] = []): INotechart {
  return {
    notes,
    autos,
    landmines: [],
    duration: 60,
    secondsToBeat: (s: number) => s * 2,
    beatToSeconds: (b: number) => b / 2,
  };
}

describe('GameEngine — phase machine integration', () => {
  it('starts in ready phase and derived flags are all false', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    expect(engine.phase.kind).toBe('ready');
    expect(engine.isPlaying).toBe(false);
    expect(engine.isPaused).toBe(false);
    expect(engine.isCompleted).toBe(false);
    expect(engine.isFailed).toBe(false);
  });

  it('start() → playing; legacy isPlaying derived true', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    engine.start();
    expect(engine.phase.kind).toBe('playing');
    expect(engine.isPlaying).toBe(true);
    expect(engine.isPaused).toBe(false);
  });

  it('pause() during playing → paused; legacy isPlaying still true (matches old behavior)', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    engine.start();
    engine.pause(0);
    expect(engine.phase.kind).toBe('paused');
    expect(engine.isPlaying).toBe(true);
    expect(engine.isPaused).toBe(true);
  });

  it('resume() from paused → playing', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    engine.start();
    engine.pause(0);
    engine.resume();
    expect(engine.phase.kind).toBe('playing');
  });

  it('stop() → ready; all derived flags false', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    engine.start();
    engine.stop();
    expect(engine.phase.kind).toBe('ready');
    expect(engine.isPlaying).toBe(false);
    expect(engine.isPaused).toBe(false);
  });

  it('pause() before start() is a no-op (impossible state guarded)', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    engine.pause(0);
    expect(engine.phase.kind).toBe('ready');
  });

  it('resume() outside paused is a no-op', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    engine.resume();
    expect(engine.phase.kind).toBe('ready');
    engine.start();
    engine.resume();
    expect(engine.phase.kind).toBe('playing');
  });

  it('tick(t) on empty notechart with no autos → completed; phase=completed and result.completed populated', () => {
    const engine = new GameEngine({ notechart: makeNotechart([], []) });
    engine.start();
    const result = engine.tick(0);
    expect(result.completed).not.toBeNull();
    expect(engine.phase.kind).toBe('completed');
    expect(engine.isCompleted).toBe(true);
    expect(engine.isPlaying).toBe(false);
    // state object built at completion includes phase
    expect(result.state?.phase.kind).toBe('completed');
    expect(result.state?.isCompleted).toBe(true);
  });

  it('buildState exposes phase and derived 4-boolean simultaneously', () => {
    const engine = new GameEngine({ notechart: makeNotechart() });
    engine.start();
    const state = engine.buildState(0);
    expect(state.phase.kind).toBe('playing');
    expect(state.isPlaying).toBe(true);
    expect(state.isPaused).toBe(false);
    expect(state.isCompleted).toBe(false);
    expect(state.isFailed).toBe(false);
  });
});
