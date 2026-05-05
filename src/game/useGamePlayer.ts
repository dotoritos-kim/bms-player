/**
 * useGamePlayer 훅
 * BMS 게임 플레이를 위한 React 커스텀 훅
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

export interface GamePlayerOptions {
  /** 게이지 타입 */
  gaugeType?: GaugeType;
  /** TOTAL 값 */
  total?: number;
  /** 판정 RANK (0-4) */
  rank?: number;
  /** 커스텀 판정 (#DEFEXRANK) */
  defexrank?: number;
  /** Hi-Speed */
  hiSpeed?: number;
  /** 배속 */
  playbackRate?: number;
  /** 시작 오프셋 (ms) */
  startOffset?: number;
  /** 판정 오프셋 (ms, 양수=빠른입력이 정확) */
  judgmentOffset?: number;
  /** 비주얼 오프셋 (ms, 양수=노트가 늦게 표시) */
  visualOffset?: number;
  /** 자동 시작 */
  autoStart?: boolean;
  /** 오토플레이 모드 */
  autoplay?: boolean;
  /** 커스텀 키 바인딩 */
  keyBindings?: KeyBindings;
  /** 플레이 사이드 (1P, 2P, DP) */
  playSide?: '1P' | '2P' | 'DP';
  /** 플로팅 하이스피드 (BPM 변속 시 Green Number 유지) */
  floatingHiSpeed?: boolean;
  /** Worker 인스턴스 (제공 시 WorkerGameLoop 사용, 백그라운드 재생 지원) */
  worker?: Worker;
}

export interface GamePlayerState {
  /** 로딩 상태 */
  isLoading: boolean;
  /** 준비 완료 */
  isReady: boolean;
  /**
   * 통합 게임 단계 (Stage 3, REFACTOR-PLAN §6.2). 신규 컨슈머는 이 필드를
   * 우선 사용한다. 아래 4-boolean(`isPlaying`/`isPaused`/`isCompleted`/
   * `isFailed`)은 호환을 위해 유지되며 `phase`로부터 derive된다.
   */
  phase: import('../types/GamePhase').GamePhase;
  /** @deprecated `phase.kind === 'playing' || phase.kind === 'paused'` 사용 권장. */
  isPlaying: boolean;
  /** @deprecated `phase.kind === 'paused'` 사용 권장. */
  isPaused: boolean;
  /** @deprecated `phase.kind === 'completed'` 사용 권장. */
  isCompleted: boolean;
  /** @deprecated `phase.kind === 'failed'` 사용 권장. */
  isFailed: boolean;
  /** 현재 게임 시간 (ms) */
  currentTime: number;
  /** 현재 비트 */
  currentBeat: number;
  /** 현재 콤보 */
  combo: number;
  /** 게이지 값 (%) */
  gaugeValue: number;
  /** EX 스코어 */
  exScore: number;
  /** 마지막 판정 */
  lastJudgment: JudgmentEvent | null;
  /** 눌린 키 */
  heldKeys: Set<KeyColumn>;
  /** 최종 스코어 (완료/실패 시) */
  finalScore: ScoreState | null;
}

export interface GamePlayerActions {
  /** 게임 시작 */
  start: () => void;
  /** 일시정지 */
  pause: () => void;
  /** 재개 */
  resume: () => void;
  /** 정지 */
  stop: () => void;
  /** 재시작 */
  restart: () => void;
  /** Hi-Speed 변경 */
  setHiSpeed: (speed: number) => void;
}

export interface UseGamePlayerResult {
  state: GamePlayerState;
  actions: GamePlayerActions;
  /** GameCanvas에 전달할 props */
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
  // 옵션 (재생성 방지)
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 상태
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

  // 초기화
  useEffect(() => {
    if (!notechart || !keysoundPlayer) {
      setIsLoading(true);
      setIsReady(false);
      return;
    }

    // 키사운드 플레이어가 준비되었는지 확인
    if (!keysoundPlayer.isReady) {
      setIsLoading(true);
      setIsReady(false);
      return;
    }

    setIsLoading(false);
    setIsReady(true);

    // InputHandler 생성 (커스텀 키 바인딩 및 playSide 적용)
    const playSide = optionsRef.current.playSide ?? 'DP';

    // 2P 모드에서는 전용 키 매핑 사용 (SC가 오른쪽에 있으므로)
    let keyMap: Record<string, KeyColumn>;
    if (playSide === '2P') {
      keyMap = KEY_MAP_2P;
    } else {
      // 1P 또는 DP 모드에서는 저장된 키 바인딩 또는 기본값 사용
      const keyBindings = optionsRef.current.keyBindings ?? loadKeyBindings();
      keyMap = bindingsToKeyMap(keyBindings);
    }

    if (!inputHandlerRef.current) {
      inputHandlerRef.current = new InputHandler({ keyMap });
      // 키 상태 추적은 GameLoop의 onKeyInput 콜백에서 관리
    } else {
      // 기존 핸들러의 키 맵 업데이트
      inputHandlerRef.current.setKeyMap(keyMap);
    }

    // Cleanup
    return () => {
      if (gameLoopRef.current) {
        gameLoopRef.current.dispose();
        gameLoopRef.current = null;
      }
    };
  }, [notechart, keysoundPlayer, options.playSide]);

  // GameLoop 콜백
  const callbacks: GameLoopCallbacks = useMemo(() => ({
    onUpdate: (state) => {
      setGameState(state);
    },
    onJudgment: (event) => {
      setLastJudgment(event);
      setJudgmentQueue(prev => [...prev, event]);
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
    // 키 입력 콜백 - GameLoop이 InputHandler 콜백을 관리하므로 여기서 heldKeys 상태 관리
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

  // GameLoop 생성 함수 (Worker가 제공되면 WorkerGameLoop 사용)
  const createGameLoop = useCallback((): GameLoop | WorkerGameLoop | null => {
    if (!notechart || !keysoundPlayer || !keysoundPlayer.isReady) {
      return null;
    }

    // KeysoundPlayer 인터페이스의 `getAudioContext()` 우선 사용, 미구현 구현체는
    // 기존 `preloader.context` 로 폴백 (deprecated 호환성).
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

  // 액션: 시작
  const start = useCallback(async () => {
    if (!isReady) return;

    // 기존 게임 루프 정리
    if (gameLoopRef.current) {
      gameLoopRef.current.dispose();
    }

    // 새 게임 루프 생성
    const gameLoop = createGameLoop();
    if (!gameLoop) return;

    gameLoopRef.current = gameLoop;
    setFinalScore(null);
    setLastJudgment(null);
    setJudgmentQueue([]);
    setTriggeredMineIds(new Set());
    await gameLoop.start();
  }, [isReady, createGameLoop]);

  // 액션: 일시정지
  const pause = useCallback(() => {
    gameLoopRef.current?.pause();
  }, []);

  // 액션: 재개
  const resume = useCallback(() => {
    gameLoopRef.current?.resume();
  }, []);

  // 액션: 정지
  const stop = useCallback(() => {
    gameLoopRef.current?.stop();
  }, []);

  // 액션: 재시작
  const restart = useCallback(() => {
    stop();
    // 약간의 딜레이 후 시작
    setTimeout(() => {
      start();
    }, 100);
  }, [stop, start]);

  // 액션: Hi-Speed 변경
  const setHiSpeedAction = useCallback((speed: number) => {
    setHiSpeed(Math.max(0.5, Math.min(10, speed)));
  }, []);

  // 자동 시작
  useEffect(() => {
    if (isReady && options.autoStart && !gameLoopRef.current) {
      start();
    }
  }, [isReady, options.autoStart, start]);

  // 결과 조합
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
