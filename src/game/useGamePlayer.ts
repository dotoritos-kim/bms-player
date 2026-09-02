/**
 * useGamePlayer hook.
 * React custom hook for BMS gameplay.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Notechart } from '../audio/judgements';
import type { KeysoundPlayer } from '../types/KeysoundPlayer';
import { PHASE_READY } from '../types/GamePhase';
import {
  GameLoop,
  WorkerGameLoop,
  InputHandler,
  type GameLoopState,
  type GameLoopCallbacks,
  type JudgmentEvent,
  type LandmineEvent,
  type GaugeType,
  type KeyColumn,
  type ScoreState,
  loadKeyBindings,
  bindingsToKeyMap,
  type KeyBindings,
  KEY_MAP_2P,
} from './index';

/** Max judgment events kept in the React-visible queue. */
const JUDGMENT_QUEUE_MAX = 64;

export interface GamePlayerOptions {
  /** Gauge type */
  gaugeType?: GaugeType;
  /** TOTAL value */
  total?: number;
  /** Judgment RANK (0-4) */
  rank?: number;
  /** Custom judgment (#DEFEXRANK) */
  defexrank?: number;
  /** Hi-Speed */
  hiSpeed?: number;
  /** Playback rate */
  playbackRate?: number;
  /** Start offset (ms) */
  startOffset?: number;
  /** Judgment offset (ms, positive = early input counts as accurate) */
  judgmentOffset?: number;
  /** Visual offset (ms, positive = notes displayed later) */
  visualOffset?: number;
  /** Audio output latency compensation in ms (applied to keysound scheduling / judgment timing). */
  audioLatency?: number;
  /** Auto start */
  autoStart?: boolean;
  /** Autoplay mode */
  autoplay?: boolean;
  /** Custom key bindings */
  keyBindings?: KeyBindings;
  /** Play side (1P, 2P, DP) */
  playSide?: '1P' | '2P' | 'DP';
  /** Floating Hi-Speed (keeps the Green Number constant across BPM changes) */
  floatingHiSpeed?: boolean;
  /** Worker instance (when provided, uses WorkerGameLoop and supports background playback) */
  worker?: Worker;
}

export interface GamePlayerState {
  /** Loading state */
  isLoading: boolean;
  /** Ready */
  isReady: boolean;
  /**
   * Unified game phase (Stage 3, REFACTOR-PLAN §6.2). New consumers should
   * prefer this field. The 4 booleans below (`isPlaying`/`isPaused`/
   * `isCompleted`/`isFailed`) are kept for compatibility and derived from `phase`.
   */
  phase: import('../types/GamePhase').GamePhase;
  /** @deprecated Prefer `phase.kind === 'playing' || phase.kind === 'paused'`. */
  isPlaying: boolean;
  /** @deprecated Prefer `phase.kind === 'paused'`. */
  isPaused: boolean;
  /** @deprecated Prefer `phase.kind === 'completed'`. */
  isCompleted: boolean;
  /** @deprecated Prefer `phase.kind === 'failed'`. */
  isFailed: boolean;
  /** Current game time (ms) */
  currentTime: number;
  /** Current beat */
  currentBeat: number;
  /** Current combo */
  combo: number;
  /** Gauge value (%) */
  gaugeValue: number;
  /** EX score */
  exScore: number;
  /** Last judgment */
  lastJudgment: JudgmentEvent | null;
  /** Held keys */
  heldKeys: Set<KeyColumn>;
  /** Final score (on completion/failure) */
  finalScore: ScoreState | null;
}

export interface GamePlayerActions {
  /** Start the game */
  start: () => void;
  /** Pause */
  pause: () => void;
  /** Resume */
  resume: () => void;
  /** Stop */
  stop: () => void;
  /** Restart */
  restart: () => void;
  /** Change Hi-Speed */
  setHiSpeed: (speed: number) => void;
}

export interface UseGamePlayerResult {
  state: GamePlayerState;
  actions: GamePlayerActions;
  /** Props to pass to GameCanvas */
  canvasProps: {
    notechart: Notechart;
    gameState: GameLoopState;
    hiSpeed: number;
    heldKeys: Set<KeyColumn>;
    lastJudgmentEvent: JudgmentEvent | null;
    judgmentQueue: JudgmentEvent[];
    triggeredMineIds: Set<number>;
  };
}

export function useGamePlayer(
  notechart: Notechart | null,
  keysoundPlayer: KeysoundPlayer | null,
  options: GamePlayerOptions = {}
): UseGamePlayerResult {
  // Options (prevents re-creation)
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [gameState, setGameState] = useState<GameLoopState>({
    phase: PHASE_READY,
    isPlaying: false,
    isPaused: false,
    isFailed: false,
    isCompleted: false,
    currentTime: 0,
    visualTime: 0,
    currentBeat: 0,
    combo: 0,
    gaugeValue: 22,
    exScore: 0,
    lastJudgment: null,
    lastOffset: 0,
    activeHoldNoteIds: new Set(),
    pgreatCount: 0,
    greatCount: 0,
    goodCount: 0,
    badCount: 0,
    poorCount: 0,
    missCount: 0,
    maxCombo: 0,
    recentOffsets: [],
  });
  const [heldKeys, setHeldKeys] = useState<Set<KeyColumn>>(new Set());
  const [lastJudgment, setLastJudgment] = useState<JudgmentEvent | null>(null);
  const [judgmentQueue, setJudgmentQueue] = useState<JudgmentEvent[]>([]);
  const [finalScore, setFinalScore] = useState<ScoreState | null>(null);
  const [hiSpeed, setHiSpeed] = useState(options.hiSpeed ?? 1);
  const [triggeredMineIds, setTriggeredMineIds] = useState<Set<number>>(new Set());

  // Refs
  const gameLoopRef = useRef<GameLoop | WorkerGameLoop | null>(null);
  const inputHandlerRef = useRef<InputHandler | null>(null);

  // Initialization
  useEffect(() => {
    if (!notechart || !keysoundPlayer) {
      setIsLoading(true);
      setIsReady(false);
      return;
    }

    // Check whether the keysound player is ready
    if (!keysoundPlayer.isReady) {
      setIsLoading(true);
      setIsReady(false);
      return;
    }

    setIsLoading(false);
    setIsReady(true);

    // Create the InputHandler (applies custom key bindings and playSide)
    const playSide = optionsRef.current.playSide ?? 'DP';

    // 2P mode uses a dedicated key mapping (since SC is on the right)
    let keyMap: Record<string, KeyColumn>;
    if (playSide === '2P') {
      keyMap = KEY_MAP_2P;
    } else {
      // 1P or DP mode uses the saved key bindings or defaults
      const keyBindings = optionsRef.current.keyBindings ?? loadKeyBindings();
      keyMap = bindingsToKeyMap(keyBindings);
    }

    if (!inputHandlerRef.current) {
      inputHandlerRef.current = new InputHandler({ keyMap });
      // Key state tracking is managed by GameLoop's onKeyInput callback
    } else {
      // Update the existing handler's key map
      inputHandlerRef.current.setKeyMap(keyMap);
    }

    // Cleanup
    return () => {
      if (gameLoopRef.current) {
        gameLoopRef.current.dispose();
        gameLoopRef.current = null;
      }
      // The shared InputHandler is owned here; drop its window listeners so a
      // mount/unmount without START does not leak capture-phase key handlers.
      if (inputHandlerRef.current) {
        inputHandlerRef.current.dispose();
        inputHandlerRef.current = null;
      }
    };
  }, [notechart, keysoundPlayer, options.playSide]);

  // GameLoop callbacks
  const callbacks: GameLoopCallbacks = useMemo(() => ({
    onUpdate: (state) => {
      setGameState(state);
    },
    onJudgment: (event) => {
      setLastJudgment(event);
      // Bounded: consumers only need the events they have not seen yet, and
      // an unbounded array meant an O(n) clone per note for the whole song.
      setJudgmentQueue(prev => (prev.length >= JUDGMENT_QUEUE_MAX ? [...prev.slice(-(JUDGMENT_QUEUE_MAX - 1)), event] : [...prev, event]));
    },
    onLandmineTrigger: (event: LandmineEvent) => {
      setTriggeredMineIds((prev) => {
        const next = new Set(prev);
        next.add(event.mineId);
        return next;
      });
    },
    onComplete: (score) => {
      setFinalScore(score);
    },
    onFailed: (score) => {
      setFinalScore(score);
    },
    // Key input callback - GameLoop manages the InputHandler callbacks, so heldKeys state is managed here
    onKeyInput: (column, held) => {
      setHeldKeys((prev) => {
        const next = new Set(prev);
        if (held) {
          next.add(column);
        } else {
          next.delete(column);
        }
        return next;
      });
    },
  }), []);

  // GameLoop factory (uses WorkerGameLoop when a Worker is provided)
  const createGameLoop = useCallback((): GameLoop | WorkerGameLoop | null => {
    if (!notechart || !keysoundPlayer || !keysoundPlayer.isReady) {
      return null;
    }

    // Prefer the KeysoundPlayer interface's `getAudioContext()`; implementations
    // without it fall back to the legacy `preloader.context` (deprecated compatibility).
    const audioContext =
      keysoundPlayer.getAudioContext?.() ?? keysoundPlayer.preloader?.context ?? null;

    if (!audioContext) {
      console.error('AudioContext not available');
      return null;
    }

    const opts = optionsRef.current;
    const commonConfig = {
      notechart,
      keysoundPlayer,
      audioContext,
      gaugeType: opts.gaugeType ?? 'groove',
      total: opts.total ?? 200,
      rank: opts.rank ?? 2,
      defexrank: opts.defexrank,
      inputHandler: inputHandlerRef.current ?? undefined,
      startOffset: opts.startOffset ?? 0,
      playbackRate: opts.playbackRate ?? 1,
      judgmentOffset: opts.judgmentOffset ?? 0,
      visualOffset: opts.visualOffset ?? 0,
      audioLatency: opts.audioLatency ?? 0,
      autoplay: opts.autoplay ?? false,
    };

    if (opts.worker) {
      return new WorkerGameLoop(
        { ...commonConfig, worker: opts.worker },
        callbacks,
      );
    }

    return new GameLoop(commonConfig, callbacks);
  }, [notechart, keysoundPlayer, callbacks]);

  // Action: start
  const start = useCallback(async () => {
    if (!isReady) return;

    // Clean up the existing game loop
    if (gameLoopRef.current) {
      gameLoopRef.current.dispose();
    }

    // Create a new game loop
    const gameLoop = createGameLoop();
    if (!gameLoop) return;

    gameLoopRef.current = gameLoop;
    setFinalScore(null);
    setLastJudgment(null);
    setJudgmentQueue([]);
    setTriggeredMineIds(new Set());
    await gameLoop.start();
  }, [isReady, createGameLoop]);

  // Action: pause
  const pause = useCallback(() => {
    gameLoopRef.current?.pause();
  }, []);

  // Action: resume
  const resume = useCallback(() => {
    gameLoopRef.current?.resume();
  }, []);

  // Action: stop
  const stop = useCallback(() => {
    gameLoopRef.current?.stop();
  }, []);

  // Action: restart
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restart = useCallback(() => {
    stop();
    // Start after a short delay
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      start();
    }, 100);
  }, [stop, start]);
  useEffect(() => () => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
  }, []);

  // Action: change Hi-Speed
  const setHiSpeedAction = useCallback((speed: number) => {
    setHiSpeed(Math.max(0.5, Math.min(10, speed)));
  }, []);

  // Auto start
  useEffect(() => {
    if (isReady && options.autoStart && !gameLoopRef.current) {
      start();
    }
  }, [isReady, options.autoStart, start]);

  // Compose the result
  const state: GamePlayerState = useMemo(() => ({
    isLoading,
    isReady,
    phase: gameState.phase,
    isPlaying: gameState.isPlaying,
    isPaused: gameState.isPaused,
    isCompleted: gameState.isCompleted,
    isFailed: gameState.isFailed,
    currentTime: gameState.currentTime,
    currentBeat: gameState.currentBeat,
    combo: gameState.combo,
    gaugeValue: gameState.gaugeValue,
    exScore: gameState.exScore,
    lastJudgment,
    heldKeys,
    finalScore,
  }), [isLoading, isReady, gameState, lastJudgment, heldKeys, finalScore]);

  const actions: GamePlayerActions = useMemo(() => ({
    start,
    pause,
    resume,
    stop,
    restart,
    setHiSpeed: setHiSpeedAction,
  }), [start, pause, resume, stop, restart, setHiSpeedAction]);

  const canvasProps = useMemo(() => ({
    notechart: notechart!,
    gameState,
    hiSpeed,
    heldKeys,
    lastJudgmentEvent: lastJudgment,
    judgmentQueue,
    triggeredMineIds,
  }), [notechart, gameState, hiSpeed, heldKeys, lastJudgment, judgmentQueue, triggeredMineIds]);

  return { state, actions, canvasProps };
}

export default useGamePlayer;
