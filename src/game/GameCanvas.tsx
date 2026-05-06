/**
 * BMS 게임 캔버스 — WebGL 기반 실시간 게임 렌더링
 *
 * S10 (REFACTOR-PLAN §9): Composite 패턴으로 레이어 분리.
 * - canvas/laneConfig.ts  — 레인 설정 상수 + 헬퍼 (순수 데이터)
 * - canvas/LaneLayer.tsx  — 배경 · 구분선 · 판정선 · 키빔
 * - canvas/NoteLayer.tsx  — 일반 노트 · 롱노트 · 지뢰 (InstancedMesh)
 * - canvas/EffectLayer.tsx — 히트 이펙트 · 커버 · Early/Late HUD
 *
 * GameCanvas 자체는 Facade: props 유효성 검사 + 레이어 합성 + Canvas 루트만 담당.
 */

import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';

import type { Notechart } from '../audio/judgements';
import type { KeyColumn, Judgment, GameLoopState, JudgmentEvent } from './index';
import { JudgmentEngine } from './JudgmentEngine';

// canvas 서브모듈 (S10 분리)
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
      lastJudgmentEvent = null,
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

    // 판정된 노트 ID 추적 (ref으로 관리하여 불필요한 리렌더 방지)
    const judgedNoteIdsRef = useRef<Set<number>>(new Set());
    const [judgedNoteIds, setJudgedNoteIds] = useState<Set<number>>(new Set());

    // 트리거된 지뢰 노트 ID 추적
    const [internalTriggeredMineIds, setTriggeredMineIds] = useState<Set<number>>(new Set());
    const activeMineIds = externalTriggeredMineIds ?? internalTriggeredMineIds;

    // 레인 위치 및 색상 계산 (레인 설정 변경 시만 재계산)
    const lanePositions = useMemo(() => calculateLanePositions(laneConfig, laneWidthScale), [laneConfig, laneWidthScale]);
    const laneColorMap = useMemo(() => getLaneColorMap(laneConfig), [laneConfig]);
    const totalWidth = useMemo(
      () => laneConfig.reduce((sum, lane) => sum + lane.width * laneWidthScale, 0),
      [laneConfig, laneWidthScale],
    );

    // 현재 위치 계산 (NaN/Infinity 안전 가드)
    const currentPosition = useMemo(() => {
      if (!notechart?.beatToPosition) return 0;
      const beat = gameState.currentBeat;
      if (!Number.isFinite(beat) || beat < 0) return 0;
      const position = notechart.beatToPosition(beat);
      return Number.isFinite(position) ? position : 0;
    }, [notechart, gameState.currentBeat]);

    // 히트 이펙트 트리거 (ref 기반 — 리렌더 없음)
    const triggerHitEffect = useCallback((column: KeyColumn, judgment: Judgment) => {
      hitEffectsRef.current?.trigger(column, judgment);
    }, []);

    React.useImperativeHandle(ref, () => ({ triggerHitEffect }), [triggerHitEffect]);

    // 판정 이벤트 처리 (큐 기반 — 동시 판정 지원)
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

    // 큐 리셋 시 카운터도 리셋
    useEffect(() => {
      if (judgmentQueue.length === 0) {
        processedQueueLenRef.current = 0;
      }
    }, [judgmentQueue.length]);

    // 게임 상태 리셋 감지 (새 게임 시작 시 정리)
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
          {/* 카메라 */}
          <CameraController height={height} totalWidth={totalWidth} />

          {/* L1: 레인 배경 레이어 */}
          <LaneLayer
            heldKeys={heldKeys}
            laneConfig={laneConfig}
            lanePositions={lanePositions}
            totalWidth={totalWidth}
          />

          {/* 판정선 */}
          <JudgmentLine totalWidth={totalWidth} />

          {/* L2: 노트 레이어 */}
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

          {/* L3: 이펙트 레이어 */}
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

        {/* UI 오버레이 — 좌측 (콤보/스코어/게이지) */}
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

        {/* UI 오버레이 — 우측 (판정 통계) */}
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

        {/* 커버 값 표시 */}
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

        {/* 마지막 판정 표시 */}
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

        {/* Early/Late 플로팅 텍스트 */}
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

        {/* Early/Late 타이밍 표시기 */}
        <TimingIndicator offsets={gameState.recentOffsets} lastOffset={gameState.lastOffset} />
      </div>
    );
  },
);

export default GameCanvas;
