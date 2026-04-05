/**
 * GamePlayer 통합 컴포넌트
 * 게임 캔버스 + UI + 결과 화면을 통합한 완전한 게임 플레이어
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import type { Notechart } from '../audio/judgements';
import type { KeysoundPlayer } from '../types/KeysoundPlayer';
import { GameCanvas, type GameCanvasHandle, getLaneConfigForSide } from './GameCanvas';
import { useGamePlayer, type GamePlayerOptions } from './useGamePlayer';
import { JudgmentEngine } from './JudgmentEngine';
import { GaugeSystem, type GaugeType } from './GaugeSystem';
import type { ScoreState } from './ScoreManager';

// ============ 타입 ============

export interface GamePlayerProps {
  /** 노트 차트 */
  notechart: Notechart | null;
  /** 키사운드 플레이어 */
  keysoundPlayer: KeysoundPlayer | null;
  /** 게임 옵션 */
  options?: GamePlayerOptions;
  /** 캔버스 너비 */
  width?: number;
  /** 캔버스 높이 */
  height?: number;
  /** Sudden+ 커버 (0-500, 상단 가림) */
  suddenPlus?: number;
  /** Lift+ 커버 (0-500, 하단 올림) */
  liftPlus?: number;
  /** 노트 높이 배율 (기본 1.0) */
  noteScale?: number;
  /** 레인 너비 배율 (기본 1.0) */
  laneWidthScale?: number;
  /** 자동 전체화면 (게임 시작 시 자동으로 전체화면 진입) */
  autoFullscreen?: boolean;
  /** 완료 콜백 */
  onComplete?: (score: ScoreState, cleared: boolean) => void;
  /** 종료 콜백 (뒤로가기) */
  onExit?: () => void;
}

// ============ 서브 컴포넌트 ============

/** 로딩 화면 */
const LoadingScreen: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.9)',
      color: '#fff',
      fontSize: 24,
      fontFamily: 'sans-serif',
    }}
  >
    {message}
  </div>
);

/** 시작 대기 화면 */
const ReadyScreen: React.FC<{ onStart: () => void }> = ({ onStart }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.8)',
      color: '#fff',
      fontFamily: 'sans-serif',
    }}
  >
    <div style={{ fontSize: 32, marginBottom: 20 }}>READY</div>
    <button
      onClick={onStart}
      style={{
        padding: '15px 40px',
        fontSize: 20,
        background: '#ff6600',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      START
    </button>
    <div style={{ marginTop: 20, fontSize: 14, color: '#888' }}>
      Press SPACE or click to start
    </div>
  </div>
);

/** 일시정지 화면 */
const PauseScreen: React.FC<{
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}> = ({ onResume, onRestart, onExit }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.9)',
      color: '#fff',
      fontFamily: 'sans-serif',
    }}
  >
    <div style={{ fontSize: 32, marginBottom: 30 }}>PAUSED</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        onClick={onResume}
        style={{
          padding: '12px 30px',
          fontSize: 16,
          background: '#00aa00',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        RESUME
      </button>
      <button
        onClick={onRestart}
        style={{
          padding: '12px 30px',
          fontSize: 16,
          background: '#0066aa',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        RESTART
      </button>
      <button
        onClick={onExit}
        style={{
          padding: '12px 30px',
          fontSize: 16,
          background: '#666',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        EXIT
      </button>
    </div>
  </div>
);

/** 결과 화면 */
const ResultScreen: React.FC<{
  score: ScoreState;
  cleared: boolean;
  gaugeType: GaugeType;
  onRestart: () => void;
  onExit: () => void;
}> = ({ score, cleared, gaugeType: _gaugeType, onRestart, onExit }) => {
  // DJ 레벨 계산
  const exScoreRate = score.totalNotes > 0 ? score.exScore / (score.totalNotes * 2) : 0;
  let djLevel = 'F';
  if (exScoreRate >= 8 / 9) djLevel = 'AAA';
  else if (exScoreRate >= 7 / 9) djLevel = 'AA';
  else if (exScoreRate >= 6 / 9) djLevel = 'A';
  else if (exScoreRate >= 5 / 9) djLevel = 'B';
  else if (exScoreRate >= 4 / 9) djLevel = 'C';
  else if (exScoreRate >= 3 / 9) djLevel = 'D';
  else if (exScoreRate >= 2 / 9) djLevel = 'E';

  const isFullCombo = score.badCount === 0 && score.poorCount === 0 && score.missCount === 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: cleared ? 'rgba(0, 40, 0, 0.95)' : 'rgba(40, 0, 0, 0.95)',
        color: '#fff',
        fontFamily: 'sans-serif',
      }}
    >
      {/* 클리어/실패 표시 */}
      <div
        style={{
          fontSize: 48,
          fontWeight: 'bold',
          marginBottom: 20,
          color: cleared ? '#00ff00' : '#ff0000',
        }}
      >
        {cleared ? 'CLEAR!' : 'FAILED'}
      </div>

      {/* DJ 레벨 */}
      <div
        style={{
          fontSize: 72,
          fontWeight: 'bold',
          marginBottom: 10,
          color: djLevel === 'AAA' ? '#ffff00' : '#fff',
        }}
      >
        {djLevel}
      </div>

      {/* 풀콤보 표시 */}
      {isFullCombo && (
        <div style={{ fontSize: 24, color: '#00ffff', marginBottom: 10 }}>
          FULL COMBO!
        </div>
      )}

      {/* EX 스코어 */}
      <div style={{ fontSize: 32, marginBottom: 20 }}>
        EX SCORE: <span style={{ color: '#ffcc00' }}>{score.exScore}</span>
        <span style={{ fontSize: 18, color: '#888' }}> / {score.totalNotes * 2}</span>
      </div>

      {/* 판정 내역 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          gap: '5px 20px',
          fontSize: 18,
          marginBottom: 20,
        }}
      >
        <div style={{ color: JudgmentEngine.getColor('PGREAT') }}>PGREAT</div>
        <div>{score.pgreatCount}</div>
        <div style={{ color: JudgmentEngine.getColor('GREAT') }}>GREAT</div>
        <div>{score.greatCount}</div>
        <div style={{ color: JudgmentEngine.getColor('GOOD') }}>GOOD</div>
        <div>{score.goodCount}</div>
        <div style={{ color: JudgmentEngine.getColor('BAD') }}>BAD</div>
        <div>{score.badCount}</div>
        <div style={{ color: JudgmentEngine.getColor('POOR') }}>POOR</div>
        <div>{score.poorCount}</div>
        <div style={{ color: JudgmentEngine.getColor('MISS') }}>MISS</div>
        <div>{score.missCount}</div>
      </div>

      {/* 맥스 콤보 */}
      <div style={{ fontSize: 20, marginBottom: 30 }}>
        MAX COMBO: <span style={{ color: '#00ffff' }}>{score.maxCombo}</span>
      </div>

      {/* 버튼 */}
      <div style={{ display: 'flex', gap: 15 }}>
        <button
          onClick={onRestart}
          style={{
            padding: '12px 30px',
            fontSize: 16,
            background: '#0066aa',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          RETRY
        </button>
        <button
          onClick={onExit}
          style={{
            padding: '12px 30px',
            fontSize: 16,
            background: '#666',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          EXIT
        </button>
      </div>
    </div>
  );
};

/** 게이지 바 */
const GaugeBar: React.FC<{ value: number; type: GaugeType }> = ({ value, type }) => {
  const color = GaugeSystem.getColor(type);
  const isDanger = value < 30;

  return (
    <div
      style={{
        position: 'absolute',
        right: 10,
        top: 50,
        bottom: 50,
        width: 20,
        background: '#222',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${value}%`,
          background: color,
          transition: 'height 0.1s ease-out',
          opacity: isDanger ? 0.7 : 1,
          animation: isDanger ? 'blink 0.5s infinite' : undefined,
        }}
      />
      {/* 80% 라인 (클리어 기준) */}
      {(type === 'groove' || type === 'easy') && (
        <div
          style={{
            position: 'absolute',
            bottom: '80%',
            left: 0,
            right: 0,
            height: 2,
            background: '#fff',
          }}
        />
      )}
    </div>
  );
};

// ============ 메인 컴포넌트 ============

export const GamePlayer: React.FC<GamePlayerProps> = ({
  notechart,
  keysoundPlayer,
  options = {},
  width = 400,
  height = 700,
  suddenPlus = 0,
  liftPlus = 0,
  noteScale = 1,
  laneWidthScale = 1,
  autoFullscreen = false,
  onComplete,
  onExit,
}) => {
  const canvasRef = useRef<GameCanvasHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const gaugeType = options.gaugeType ?? 'groove';
  const playSide = options.playSide ?? 'DP';

  // Hi-Speed state (adjustable during gameplay, syncs with external option changes)
  const [currentHiSpeed, setCurrentHiSpeed] = useState(options.hiSpeed ?? 1);
  const prevOptionsHiSpeed = useRef(options.hiSpeed ?? 1);
  if ((options.hiSpeed ?? 1) !== prevOptionsHiSpeed.current) {
    prevOptionsHiSpeed.current = options.hiSpeed ?? 1;
    // Will take effect on next render cycle
    setCurrentHiSpeed(options.hiSpeed ?? 1);
  }
  // Floating Hi-Speed (green number mode) — initialize from options
  const [floatingHiSpeed, setFloatingHiSpeed] = useState(options.floatingHiSpeed ?? false);
  const prevOptionsFloating = useRef(options.floatingHiSpeed ?? false);
  if ((options.floatingHiSpeed ?? false) !== prevOptionsFloating.current) {
    prevOptionsFloating.current = options.floatingHiSpeed ?? false;
    setFloatingHiSpeed(options.floatingHiSpeed ?? false);
  }
  // Green number = visible time in ms at base BPM
  const [greenNumber, setGreenNumber] = useState(0);
  // Show speed info overlay (briefly after adjustment)
  const [showSpeedInfo, setShowSpeedInfo] = useState(false);
  const speedInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { state, actions, canvasProps } = useGamePlayer(notechart, keysoundPlayer, {
    ...options,
    hiSpeed: currentHiSpeed,
  });

  // playSide에 따른 레인 설정 계산
  const laneConfig = useMemo(() => {
    // notechart에서 keyMode 추출
    const keyMode = notechart?.getKeyMode?.('SC') || '7K';
    return getLaneConfigForSide(keyMode, playSide);
  }, [notechart, playSide]);

  // Calculate green number (visible time in ms) from current BPM and hi-speed
  // Green Number = (visible_beats / (BPM / 60)) * 1000 / hiSpeed
  // In IIDX terms: how many ms of notes are visible on screen
  const currentBpm = useMemo(() => {
    if (!notechart?.bpmAtBeat) return 150;
    const beat = canvasProps.gameState.currentBeat;
    if (!Number.isFinite(beat) || beat < 0) return notechart.bpmAtBeat(0) || 150;
    return notechart.bpmAtBeat(beat) || 150;
  }, [notechart, canvasProps.gameState.currentBeat]);

  const baseBpm = useMemo(() => {
    if (!notechart?.bpmAtBeat) return 150;
    return notechart.bpmAtBeat(0) || 150;
  }, [notechart]);

  // Update green number when hi-speed changes (but not from floating auto-adjust)
  const greenNumberRef = useRef(greenNumber);
  const floatingRef = useRef(floatingHiSpeed);
  floatingRef.current = floatingHiSpeed;

  // Compute initial green number from initial BPM and hi-speed
  useEffect(() => {
    if (!notechart) return;
    const bpm = baseBpm;
    // Green number = time(ms) for VISIBLE_BEATS to pass at current effective speed
    // effectiveSpeed = BPM * hiSpeed, time = VISIBLE_BEATS / (effectiveSpeed / 60) * 1000
    const gn = Math.round((8 * 60 * 1000) / (bpm * currentHiSpeed));
    setGreenNumber(gn);
    greenNumberRef.current = gn;
  }, [notechart, baseBpm]); // Only on init / chart change

  // Floating Hi-Speed: auto-adjust hiSpeed when BPM changes to maintain constant green number
  const prevBpmRef = useRef(currentBpm);
  useEffect(() => {
    if (!floatingHiSpeed || !state.isPlaying) return;
    if (prevBpmRef.current === currentBpm) return;
    prevBpmRef.current = currentBpm;

    if (greenNumberRef.current <= 0) return;

    // Calculate new hi-speed to maintain same green number
    // greenNumber = (8 * 60 * 1000) / (bpm * hiSpeed)
    // hiSpeed = (8 * 60 * 1000) / (bpm * greenNumber)
    const newHiSpeed = (8 * 60 * 1000) / (currentBpm * greenNumberRef.current);
    const clamped = Math.max(0.5, Math.min(10, Math.round(newHiSpeed * 100) / 100));
    setCurrentHiSpeed(clamped);
    actions.setHiSpeed(clamped);
  }, [currentBpm, floatingHiSpeed, state.isPlaying, actions]);

  // Show speed info briefly
  const flashSpeedInfo = useCallback(() => {
    setShowSpeedInfo(true);
    if (speedInfoTimerRef.current) clearTimeout(speedInfoTimerRef.current);
    speedInfoTimerRef.current = setTimeout(() => setShowSpeedInfo(false), 1500);
  }, []);

  // 결과 화면 표시 조건
  const showResult = state.isCompleted || state.isFailed;
  const cleared = state.isCompleted && !state.isFailed;

  // Fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err: unknown) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  // Listen for fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 자동 전체화면: 게임 시작 시 전체화면 진입
  useEffect(() => {
    if (autoFullscreen && state.isPlaying && !isFullscreen && containerRef.current) {
      containerRef.current.requestFullscreen().catch((err) => {
        console.warn('Auto fullscreen failed:', err);
      });
    }
  }, [autoFullscreen, state.isPlaying, isFullscreen]);

  // 완료 콜백
  useEffect(() => {
    if (showResult && state.finalScore) {
      onComplete?.(state.finalScore, cleared);
    }
  }, [showResult, state.finalScore, cleared, onComplete]);

  // 게임 플레이 중 페이지 스크롤 방지
  useEffect(() => {
    if (!state.isPlaying && !state.isReady) return;

    const savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // wheel 이벤트도 차단
    const preventWheel = (e: WheelEvent) => { e.preventDefault(); };
    window.addEventListener('wheel', preventWheel, { passive: false });

    return () => {
      document.body.style.overflow = savedOverflow;
      window.removeEventListener('wheel', preventWheel);
    };
  }, [state.isPlaying, state.isReady]);

  // 키보드 이벤트 (ESC: 일시정지, Space: 시작, F11: 전체화면, ↑↓: 배속)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (state.isPlaying && !state.isPaused) {
          actions.pause();
        }
      }
      // 대기 화면에서 Space로 시작
      if (e.code === 'Space' && state.isReady && !state.isPlaying && !showResult) {
        e.preventDefault();
        actions.start();
      }
      // F11로 전체화면 토글
      if (e.code === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
      // Hi-Speed adjustment (↑/↓ or Page Up/Down)
      // ↑↓: ±0.25 step, PageUp/PageDown: ±1.0 step
      if (state.isPlaying && !state.isPaused) {
        let delta = 0;
        if (e.code === 'ArrowUp') delta = 0.25;
        else if (e.code === 'ArrowDown') delta = -0.25;
        else if (e.code === 'PageUp') delta = 1.0;
        else if (e.code === 'PageDown') delta = -1.0;

        if (delta !== 0) {
          e.preventDefault();
          setCurrentHiSpeed(prev => {
            const next = Math.max(0.5, Math.min(10, Math.round((prev + delta) * 100) / 100));
            actions.setHiSpeed(next);
            // Update green number based on current BPM
            const gn = Math.round((8 * 60 * 1000) / (currentBpm * next));
            setGreenNumber(gn);
            greenNumberRef.current = gn;
            return next;
          });
          flashSpeedInfo();
        }

        // Toggle floating hi-speed with ` (Backquote) key — KeyF conflicts with game column 3
        if (e.code === 'Backquote') {
          e.preventDefault();
          setFloatingHiSpeed(prev => !prev);
          flashSpeedInfo();
        }
      }

      // Ready screen: adjust speed with ↑/↓ too
      if (state.isReady && !state.isPlaying && !showResult) {
        let delta = 0;
        if (e.code === 'ArrowUp') delta = 0.25;
        else if (e.code === 'ArrowDown') delta = -0.25;
        else if (e.code === 'PageUp') delta = 1.0;
        else if (e.code === 'PageDown') delta = -1.0;

        if (delta !== 0) {
          e.preventDefault();
          setCurrentHiSpeed(prev => {
            const next = Math.max(0.5, Math.min(10, Math.round((prev + delta) * 100) / 100));
            actions.setHiSpeed(next);
            const gn = Math.round((8 * 60 * 1000) / (baseBpm * next));
            setGreenNumber(gn);
            greenNumberRef.current = gn;
            return next;
          });
        }

        if (e.code === 'Backquote') {
          e.preventDefault();
          setFloatingHiSpeed(prev => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isPlaying, state.isPaused, state.isReady, showResult, actions, toggleFullscreen, currentBpm, baseBpm, flashSpeedInfo]);

  // 종료 핸들러
  const handleExit = useCallback(() => {
    actions.stop();
    // Exit fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onExit?.();
  }, [actions, onExit]);

  // Dynamic dimensions for fullscreen
  const displayWidth = isFullscreen ? window.innerWidth : width;
  const displayHeight = isFullscreen ? window.innerHeight : height;

  return (
    <div
      ref={containerRef}
      style={{
        position: isFullscreen ? 'fixed' : 'relative',
        inset: isFullscreen ? 0 : undefined,
        width: isFullscreen ? '100%' : width,
        height: isFullscreen ? '100%' : height,
        background: '#000',
        overflow: 'hidden',
        zIndex: isFullscreen ? 9999 : undefined,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* 게임 캔버스 */}
      {notechart && (
        <GameCanvas
          ref={canvasRef}
          {...canvasProps}
          width={displayWidth}
          height={displayHeight}
          suddenPlus={suddenPlus}
          liftPlus={liftPlus}
          noteScale={noteScale}
          laneWidthScale={laneWidthScale}
          laneConfig={laneConfig}
        />
      )}

      {/* Speed info overlay (shown briefly after adjustment or always during play) */}
      {state.isPlaying && !state.isPaused && showSpeedInfo && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.85)',
            border: '1px solid #555',
            borderRadius: 8,
            padding: '12px 24px',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 16,
            textAlign: 'center',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 14, color: '#888', marginBottom: 4 }}>HI-SPEED</div>
          <div style={{ fontSize: 28, fontWeight: 'bold', color: '#ffcc00' }}>
            {currentHiSpeed.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
            BPM {Math.round(currentBpm)} × {currentHiSpeed.toFixed(2)} = {Math.round(currentBpm * currentHiSpeed)}
          </div>
          <div style={{ fontSize: 13, color: '#00ffcc', marginTop: 4 }}>
            GN {greenNumber}
          </div>
          {floatingHiSpeed && (
            <div style={{ fontSize: 11, color: '#ff6600', marginTop: 4 }}>
              FLOATING ON
            </div>
          )}
        </div>
      )}

      {/* Persistent speed indicator (small, always visible during play) */}
      {state.isPlaying && !state.isPaused && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            color: '#666',
            fontFamily: 'monospace',
            fontSize: 10,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          HS {currentHiSpeed.toFixed(2)} | GN {greenNumber}
          {floatingHiSpeed && <span style={{ color: '#ff6600' }}> F</span>}
        </div>
      )}

      {/* 전체화면 토글 버튼 - 좌측 상단 (게임 통계 위) */}
      <button
        onClick={toggleFullscreen}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          padding: '4px 8px',
          fontSize: 11,
          background: 'rgba(0, 0, 0, 0.7)',
          color: '#888',
          border: '1px solid #333',
          borderRadius: 3,
          cursor: 'pointer',
          zIndex: 10,
        }}
      >
        {isFullscreen ? '⮌' : '⛶'}
      </button>

      {/* 게이지 바 */}
      {state.isPlaying && !state.isPaused && (
        <GaugeBar value={state.gaugeValue} type={gaugeType} />
      )}

      {/* 로딩 화면 */}
      {state.isLoading && <LoadingScreen />}

      {/* 시작 대기 화면 (with speed settings) */}
      {state.isReady && !state.isPlaying && !showResult && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 20 }}>READY</div>

          {/* Speed settings */}
          <div
            style={{
              background: 'rgba(30, 30, 50, 0.9)',
              border: '1px solid #444',
              borderRadius: 8,
              padding: '16px 28px',
              marginBottom: 20,
              minWidth: 240,
              textAlign: 'center',
              fontFamily: 'monospace',
            }}
          >
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>HI-SPEED (↑↓ adjust)</div>
            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#ffcc00' }}>
              {currentHiSpeed.toFixed(2)}
            </div>
            <div style={{ fontSize: 13, color: '#aaa', marginTop: 6 }}>
              BPM {Math.round(baseBpm)} × {currentHiSpeed.toFixed(2)} = {Math.round(baseBpm * currentHiSpeed)}
            </div>
            <div style={{ fontSize: 14, color: '#00ffcc', marginTop: 4 }}>
              GREEN NUMBER: {greenNumber}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: floatingHiSpeed ? '#ff6600' : '#555',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => setFloatingHiSpeed(prev => !prev)}
            >
              {floatingHiSpeed ? '● FLOATING HI-SPEED ON' : '○ FLOATING HI-SPEED OFF'}
              <span style={{ fontSize: 10, color: '#666', marginLeft: 6 }}>(` key)</span>
            </div>
          </div>

          <button
            onClick={actions.start}
            style={{
              padding: '15px 40px',
              fontSize: 20,
              background: '#ff6600',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            START
          </button>
          <div style={{ marginTop: 20, fontSize: 14, color: '#888' }}>
            Press SPACE or click to start
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#555' }}>
            ↑↓ Hi-Speed ±0.25 | PgUp/PgDn ±1.0 | ` Floating
          </div>
        </div>
      )}

      {/* 일시정지 화면 */}
      {state.isPaused && (
        <PauseScreen
          onResume={actions.resume}
          onRestart={actions.restart}
          onExit={handleExit}
        />
      )}

      {/* 결과 화면 */}
      {showResult && state.finalScore && (
        <ResultScreen
          score={state.finalScore}
          cleared={cleared}
          gaugeType={gaugeType}
          onRestart={actions.restart}
          onExit={handleExit}
        />
      )}

      {/* CSS 애니메이션 */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default GamePlayer;
