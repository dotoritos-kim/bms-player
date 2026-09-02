/**
 * GamePlayer combined component.
 * A complete game player integrating the game canvas, UI, and result screen.
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import type { Notechart } from '../audio/judgements';
import type { KeysoundPlayer } from '../types/KeysoundPlayer';
import { GameCanvas, type GameCanvasHandle, getLaneConfigForSide } from './GameCanvas';
import { useGamePlayer, type GamePlayerOptions } from './useGamePlayer';
import { JudgmentEngine } from './JudgmentEngine';
import { GaugeSystem, type GaugeType, getGaugeClearTarget } from './GaugeSystem';
import type { ScoreState } from './ScoreManager';
import { useI18n } from '../i18n';

// ============ Types ============

export interface GamePlayerProps {
  /** Notechart */
  notechart: Notechart | null;
  /** Keysound player */
  keysoundPlayer: KeysoundPlayer | null;
  /** Game options */
  options?: GamePlayerOptions;
  /** Canvas width */
  width?: number;
  /** Canvas height */
  height?: number;
  /** Sudden+ cover (0-500, covers the top) */
  suddenPlus?: number;
  /** Lift+ cover (0-500, raises the bottom) */
  liftPlus?: number;
  /** Note height scale (default 1.0) */
  noteScale?: number;
  /** Lane width scale (default 1.0) */
  laneWidthScale?: number;
  /** Auto fullscreen (enters fullscreen automatically when the game starts) */
  autoFullscreen?: boolean;
  /** Completion callback */
  onComplete?: (score: ScoreState, cleared: boolean) => void;
  /** Exit callback (back navigation) */
  onExit?: () => void;
}

// ============ Subcomponents ============

/** Loading screen */
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

/** Pause screen */
const PauseScreen: React.FC<{
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}> = ({ onResume, onRestart, onExit }) => {
  const { t } = useI18n();
  return (
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
    <div style={{ fontSize: 32, marginBottom: 30 }}>{t('screens.pause.title')}</div>
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
        {t('screens.pause.resume')}
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
        {t('screens.pause.restart')}
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
        {t('screens.pause.exit')}
      </button>
    </div>
  </div>
  );
};

/** Result screen */
const ResultScreen: React.FC<{
  score: ScoreState;
  cleared: boolean;
  gaugeType: GaugeType;
  onRestart: () => void;
  onExit: () => void;
}> = ({ score, cleared, gaugeType: _gaugeType, onRestart, onExit }) => {
  const { t } = useI18n();
  // Compute DJ level
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
      {/* Clear/failed indicator */}
      <div
        style={{
          fontSize: 48,
          fontWeight: 'bold',
          marginBottom: 20,
          color: cleared ? '#00ff00' : '#ff0000',
        }}
      >
        {cleared ? t('screens.result.clear') : t('screens.result.failed')}
      </div>

      {/* DJ level */}
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

      {/* Full combo indicator */}
      {isFullCombo && (
        <div style={{ fontSize: 24, color: '#00ffff', marginBottom: 10 }}>
          {t('screens.result.fullCombo')}
        </div>
      )}

      {/* EX score */}
      <div style={{ fontSize: 32, marginBottom: 20 }}>
        {t('screens.result.exScore')} <span style={{ color: '#ffcc00' }}>{score.exScore}</span>
        <span style={{ fontSize: 18, color: '#888' }}> / {score.totalNotes * 2}</span>
      </div>

      {/* Judgment breakdown */}
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

      {/* Max combo */}
      <div style={{ fontSize: 20, marginBottom: 30 }}>
        {t('screens.result.maxCombo')} <span style={{ color: '#00ffff' }}>{score.maxCombo}</span>
      </div>

      {/* Buttons */}
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
          {t('screens.result.retry')}
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
          {t('screens.result.exit')}
        </button>
      </div>
    </div>
  );
};

/** Gauge bar */
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
      {/* Clear-threshold line (80% groove/easy, 60% assist-easy) */}
      {getGaugeClearTarget(type) >= 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: `${getGaugeClearTarget(type)}%`,
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

// ============ Main component ============

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
  const { t } = useI18n();
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

  // Compute lane config based on playSide
  const laneConfig = useMemo(() => {
    // Extract keyMode from the notechart
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

  // Result screen display condition
  const showResult = state.isCompleted || state.isFailed;
  // A run only clears when the gauge finished at or above the gauge's clear
  // target (80% groove/easy, 60% assist-easy); survival gauges clear on any
  // non-failed finish. Previously any non-failed finish showed CLEAR.
  const cleared = state.isCompleted && !state.isFailed
    && state.gaugeValue >= getGaugeClearTarget(gaugeType);

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

  // Auto fullscreen: enter fullscreen when the game starts
  useEffect(() => {
    if (autoFullscreen && state.isPlaying && !isFullscreen && containerRef.current) {
      containerRef.current.requestFullscreen().catch((err) => {
        console.warn('Auto fullscreen failed:', err);
      });
    }
  }, [autoFullscreen, state.isPlaying, isFullscreen]);

  // Completion callback
  useEffect(() => {
    if (showResult && state.finalScore) {
      onComplete?.(state.finalScore, cleared);
    }
  }, [showResult, state.finalScore, cleared, onComplete]);

  // Prevent page scrolling during gameplay
  useEffect(() => {
    if (!state.isPlaying && !state.isReady) return;

    const savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Block wheel events too
    const preventWheel = (e: WheelEvent) => { e.preventDefault(); };
    window.addEventListener('wheel', preventWheel, { passive: false });

    return () => {
      document.body.style.overflow = savedOverflow;
      window.removeEventListener('wheel', preventWheel);
    };
  }, [state.isPlaying, state.isReady]);

  // Keyboard events (ESC: pause, Space: start, F11: fullscreen, arrows: speed)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (state.isPlaying && !state.isPaused) {
          actions.pause();
        }
      }
      // Start with Space from the ready screen
      if (e.code === 'Space' && state.isReady && !state.isPlaying && !showResult) {
        e.preventDefault();
        actions.start();
      }
      // Toggle fullscreen with F11
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

  // Exit handler
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
      {/* Game canvas */}
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

      {/* Fullscreen toggle button - top left (above the game stats) */}
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

      {/* Gauge bar */}
      {state.isPlaying && !state.isPaused && (
        <GaugeBar value={state.gaugeValue} type={gaugeType} />
      )}

      {/* Loading screen */}
      {state.isLoading && <LoadingScreen />}

      {/* Ready screen (with speed settings) */}
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
          <div style={{ fontSize: 32, marginBottom: 20 }}>{t('screens.ready.title')}</div>

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
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{t('screens.ready.hiSpeedLabel')}</div>
            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#ffcc00' }}>
              {currentHiSpeed.toFixed(2)}
            </div>
            <div style={{ fontSize: 13, color: '#aaa', marginTop: 6 }}>
              {t('screens.ready.bpmFormula', { bpm: Math.round(baseBpm), hiSpeed: currentHiSpeed.toFixed(2), effective: Math.round(baseBpm * currentHiSpeed) })}
            </div>
            <div style={{ fontSize: 14, color: '#00ffcc', marginTop: 4 }}>
              {t('screens.ready.greenNumber', { value: greenNumber })}
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
              {floatingHiSpeed ? t('screens.ready.floatingOn') : t('screens.ready.floatingOff')}
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
            {t('screens.ready.start')}
          </button>
          <div style={{ marginTop: 20, fontSize: 14, color: '#888' }}>
            {t('screens.ready.pressToStart')}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#555' }}>
            {t('screens.ready.keyHint')}
          </div>
        </div>
      )}

      {/* Pause screen */}
      {state.isPaused && (
        <PauseScreen
          onResume={actions.resume}
          onRestart={actions.restart}
          onExit={handleExit}
        />
      )}

      {/* Result screen */}
      {showResult && state.finalScore && (
        <ResultScreen
          score={state.finalScore}
          cleared={cleared}
          gaugeType={gaugeType}
          onRestart={actions.restart}
          onExit={handleExit}
        />
      )}

      {/* CSS animations */}
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
