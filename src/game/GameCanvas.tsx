/**
 * BMS game canvas — WebGL-based real-time game rendering.
 *
 * S10 (REFACTOR-PLAN §9): layers split via the Composite pattern.
 * - canvas/laneConfig.ts  — lane config constants + helpers (pure data)
 * - canvas/LaneLayer.tsx  — background, dividers, judgment line, key beams
 * - canvas/NoteLayer.tsx  — regular notes, long notes, landmines (InstancedMesh)
 * - canvas/EffectLayer.tsx — hit effects, covers, Early/Late HUD
 *
 * GameCanvas itself is a Facade: props validation + layer composition + Canvas root only.
 */

import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';

import type { Notechart } from '../audio/judgements';
import type { KeyColumn, Judgment, GameLoopState, JudgmentEvent } from './index';
import { JudgmentEngine } from './JudgmentEngine';

// canvas submodules (split in S10)
import {
  type LaneConfig,
  type PlaySide,
  DEFAULT_LANE_CONFIG,
  LANE_CONFIG_7K_2P,
  LANE_CONFIG_5K,
  LANE_CONFIG_5K_2P,
  LANE_CONFIG_9K,
  LANE_CONFIG_14K,
  LANE_CONFIG_14K_1P,
  LANE_CONFIG_14K_2P,
  LANE_CONFIG_MAP,
  COLUMN_1P,
  COLUMN_2P,
  getLaneConfigForSide,
  calculateLanePositions,
  getLaneColorMap,
} from './canvas/laneConfig';
import { LaneLayer, JudgmentLine, CameraController } from './canvas/LaneLayer';
import { NotesRenderer, LandmineRenderer, LongNotesRenderer } from './canvas/NoteLayer';
import {
  HitEffectsManager,
  type HitEffectsManagerHandle,
  LaneCover,
  TimingIndicator,
} from './canvas/EffectLayer';

// ── Re-export constants/types that external consumers may import from GameCanvas ──

export type { LaneConfig, PlaySide };
export {
  DEFAULT_LANE_CONFIG,
  LANE_CONFIG_7K_2P,
  LANE_CONFIG_5K,
  LANE_CONFIG_5K_2P,
  LANE_CONFIG_9K,
  LANE_CONFIG_14K,
  LANE_CONFIG_14K_1P,
  LANE_CONFIG_14K_2P,
  LANE_CONFIG_MAP,
  COLUMN_1P,
  COLUMN_2P,
  getLaneConfigForSide,
};

// ── Props / Handle ─────────────────────────────────────────────────────────

export interface GameCanvasProps {
  notechart: Notechart;
  gameState: GameLoopState;
  hiSpeed?: number;
  heldKeys?: Set<KeyColumn>;
  lastJudgmentEvent?: JudgmentEvent | null;
  judgmentQueue?: JudgmentEvent[];
  width?: number;
  height?: number;
  suddenPlus?: number;
  liftPlus?: number;
  laneConfig?: LaneConfig[];
  activeHoldNoteIds?: Set<number>;
  noteScale?: number;
  laneWidthScale?: number;
  triggeredMineIds?: Set<number>;
}

export interface GameCanvasHandle {
  triggerHitEffect: (column: KeyColumn, judgment: Judgment) => void;
}

// ── GameCanvas (Facade) ────────────────────────────────────────────────────

export const GameCanvas = React.forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    {
      notechart,
      gameState,
      hiSpeed = 1,
      heldKeys = new Set(),
      lastJudgmentEvent: _lastJudgmentEvent = null,
      judgmentQueue = [],
      width = 400,
      height = 700,
      suddenPlus = 0,
      liftPlus = 0,
      laneConfig = DEFAULT_LANE_CONFIG,
      noteScale = 1,
      laneWidthScale = 1,
      triggeredMineIds: externalTriggeredMineIds,
    },
    ref,
  ) {
    const hitEffectsRef = useRef<HitEffectsManagerHandle>(null);

    // Track judged note IDs (kept in a ref to avoid unnecessary re-renders)
    const judgedNoteIdsRef = useRef<Set<number>>(new Set());
    const [judgedNoteIds, setJudgedNoteIds] = useState<Set<number>>(new Set());

    // Track triggered landmine note IDs
    const [internalTriggeredMineIds, setTriggeredMineIds] = useState<Set<number>>(new Set());
    const activeMineIds = externalTriggeredMineIds ?? internalTriggeredMineIds;

    // Compute lane positions and colors (recomputed only when the lane config changes)
    const lanePositions = useMemo(() => calculateLanePositions(laneConfig, laneWidthScale), [laneConfig, laneWidthScale]);
    const laneColorMap = useMemo(() => getLaneColorMap(laneConfig), [laneConfig]);
    const totalWidth = useMemo(
      () => laneConfig.reduce((sum, lane) => sum + lane.width * laneWidthScale, 0),
      [laneConfig, laneWidthScale],
    );

    // Compute current position (guarded against NaN/Infinity)
    const currentPosition = useMemo(() => {
      if (!notechart?.beatToPosition) return 0;
      const beat = gameState.currentBeat;
      if (!Number.isFinite(beat) || beat < 0) return 0;
      const position = notechart.beatToPosition(beat);
      return Number.isFinite(position) ? position : 0;
    }, [notechart, gameState.currentBeat]);

    // Hit effect trigger (ref based — no re-render)
    const triggerHitEffect = useCallback((column: KeyColumn, judgment: Judgment) => {
      hitEffectsRef.current?.trigger(column, judgment);
    }, []);

    React.useImperativeHandle(ref, () => ({ triggerHitEffect }), [triggerHitEffect]);

    // Handle judgment events (queue based — supports simultaneous judgments)
    const processedQueueLenRef = useRef(0);
    useEffect(() => {
      if (judgmentQueue.length > processedQueueLenRef.current) {
        const newEvents = judgmentQueue.slice(processedQueueLenRef.current);
        for (const event of newEvents) {
          triggerHitEffect(event.column, event.judgment);
          judgedNoteIdsRef.current.add(event.noteId);
        }
        processedQueueLenRef.current = judgmentQueue.length;
        setJudgedNoteIds(new Set(judgedNoteIdsRef.current));
      }
    }, [judgmentQueue, triggerHitEffect]);

    // Reset the counter when the queue is reset
    useEffect(() => {
      if (judgmentQueue.length === 0) {
        processedQueueLenRef.current = 0;
      }
    }, [judgmentQueue.length]);

    // Detect game state reset (cleanup when a new game starts)
    useEffect(() => {
      if (!gameState.isPlaying && gameState.currentTime === 0) {
        judgedNoteIdsRef.current.clear();
        setJudgedNoteIds(new Set());
        setTriggeredMineIds(new Set());
        hitEffectsRef.current?.reset();
      }
    }, [gameState.isPlaying, gameState.currentTime]);

    return (
      <div style={{ width, height, background: '#000', position: 'relative' }}>
        <Canvas
          orthographic
          camera={{ position: [0, 0, 10] }}
          gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
          frameloop="always"
          dpr={[1, 2]}
          style={{ width: '100%', height: '100%' }}
        >
          {/* Camera */}
          <CameraController height={height} totalWidth={totalWidth} />

          {/* L1: lane background layer */}
          <LaneLayer
            heldKeys={heldKeys}
            laneConfig={laneConfig}
            lanePositions={lanePositions}
            totalWidth={totalWidth}
          />

          {/* Judgment line */}
          <JudgmentLine totalWidth={totalWidth} />

          {/* L2: note layer */}
          {notechart?.notes && (
            <NotesRenderer
              notes={notechart.notes}
              currentPosition={currentPosition}
              hiSpeed={hiSpeed}
              judgedNoteIds={judgedNoteIds}
              lanePositions={lanePositions}
              laneColorMap={laneColorMap}
              noteScale={noteScale}
            />
          )}
          {notechart?.notes && (
            <LongNotesRenderer
              notes={notechart.notes}
              currentPosition={currentPosition}
              hiSpeed={hiSpeed}
              judgedNoteIds={judgedNoteIds}
              activeHoldNoteIds={gameState.activeHoldNoteIds ?? new Set()}
              lanePositions={lanePositions}
              laneConfig={laneConfig}
              noteScale={noteScale}
            />
          )}
          {notechart?.landmines && notechart.landmines.length > 0 && (
            <LandmineRenderer
              landmines={notechart.landmines}
              currentPosition={currentPosition}
              hiSpeed={hiSpeed}
              triggeredMineIds={activeMineIds}
              lanePositions={lanePositions}
              noteScale={noteScale}
            />
          )}

          {/* L3: effect layer */}
          <HitEffectsManager
            ref={hitEffectsRef}
            laneConfig={laneConfig}
            lanePositions={lanePositions}
          />
          {(suddenPlus > 0 || liftPlus > 0) && (
            <LaneCover
              suddenPlus={suddenPlus}
              liftPlus={liftPlus}
              height={height}
              totalWidth={totalWidth}
            />
          )}
        </Canvas>

        {/* UI overlay — left (combo/score/gauge) */}
        <div
          style={{
            position: 'absolute',
            top: 50,
            left: 10,
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 14,
            textShadow: '0 0 4px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 12, color: '#888' }}>COMBO</div>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: '#00ffff' }}>{gameState.combo}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>EX</div>
          <div style={{ fontSize: 18, color: '#ffcc00' }}>{gameState.exScore}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: gameState.gaugeValue < 30 ? '#ff6666' : '#66ff66' }}>
            GAUGE: {gameState.gaugeValue.toFixed(1)}%
          </div>
        </div>

        {/* UI overlay — right (judgment stats) */}
        <div
          style={{
            position: 'absolute',
            top: 50,
            right: 40,
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 11,
            textShadow: '0 0 4px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          {(
            [
              ['PG', '#00ffff', gameState.pgreatCount],
              ['GR', '#ffff00', gameState.greatCount],
              ['GD', '#00ff00', gameState.goodCount],
              ['BD', '#ff00ff', gameState.badCount],
              ['PR', '#ff0000', gameState.poorCount],
              ['MS', '#888888', gameState.missCount],
            ] as [string, string, number][]
          ).map(([label, color, count]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color }}>{label}</span>
              <span>{count}</span>
            </div>
          ))}
        </div>

        {/* Cover value display */}
        {suddenPlus > 0 && (
          <div style={{ position: 'absolute', top: 10, right: 10, color: '#00ff00', fontFamily: 'monospace', fontSize: 12 }}>
            SUD+ {suddenPlus}
          </div>
        )}
        {liftPlus > 0 && (
          <div style={{ position: 'absolute', bottom: 10, right: 10, color: '#ff0000', fontFamily: 'monospace', fontSize: 12 }}>
            LIFT {liftPlus}
          </div>
        )}

        {/* Last judgment display */}
        {gameState.lastJudgment && (
          <div
            style={{
              position: 'absolute',
              bottom: 150,
              left: '50%',
              transform: 'translateX(-50%)',
              color: JudgmentEngine.getColor(gameState.lastJudgment),
              fontFamily: 'Impact, sans-serif',
              fontSize: 32,
              textShadow: '0 0 10px currentColor',
              pointerEvents: 'none',
            }}
          >
            {JudgmentEngine.getLabel(gameState.lastJudgment)}
          </div>
        )}

        {/* Early/Late floating text */}
        {gameState.lastJudgment && gameState.lastJudgment !== 'MISS' && gameState.lastOffset !== 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 120,
              left: '50%',
              transform: 'translateX(-50%)',
              color: gameState.lastOffset < 0 ? '#00aaff' : '#ff6600',
              fontFamily: 'monospace',
              fontSize: 14,
              fontWeight: 'bold',
              textShadow: '0 0 6px currentColor',
              pointerEvents: 'none',
              opacity: 0.9,
            }}
          >
            {gameState.lastOffset < 0 ? 'EARLY' : 'LATE'}{' '}
            {gameState.lastOffset > 0 ? '+' : ''}{gameState.lastOffset.toFixed(0)}ms
          </div>
        )}

        {/* Early/Late timing indicator */}
        <TimingIndicator offsets={gameState.recentOffsets} lastOffset={gameState.lastOffset} />
      </div>
    );
  },
);

export default GameCanvas;
