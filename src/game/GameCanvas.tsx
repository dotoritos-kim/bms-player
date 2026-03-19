/**
 * BMS 게임 캔버스
 * WebGL 기반 실시간 게임 렌더링
 */

import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { Notechart, GameNote } from '../audio/judgements';
import type { KeyColumn, Judgment, GameLoopState, JudgmentEvent } from './index';
import { JudgmentEngine } from './JudgmentEngine';

// ============ 상수 ============

const NOTE_HEIGHT = 8;
const JUDGMENT_LINE_Y = 100;  // 하단에서의 판정선 위치
const VISIBLE_BEATS = 8;      // 화면에 표시할 비트 수
const MAX_VISIBLE_NOTES = 1000; // 인스턴스 메쉬 최대 크기
const MAX_LANES = 52;         // 최대 지원 레인 수 (48K + 4SC)

// ============ 레인 설정 타입 ============

export interface LaneConfig {
  column: KeyColumn;
  width: number;
  color: string;
  pressedColor: string;
}

// 기본 7K+SC (IIDX SP 1P) 레인 설정 - 스크래치 왼쪽
export const DEFAULT_LANE_CONFIG: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4', width: 40, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6', width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 7K+SC (IIDX SP 2P) 레인 설정 - 스크래치 오른쪽
export const LANE_CONFIG_7K_2P: LaneConfig[] = [
  { column: '1', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4', width: 40, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6', width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7', width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
];

// 5K (beatmania 1P) 레인 설정 - 스크래치 왼쪽
export const LANE_CONFIG_5K: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1', width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 44, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '4', width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5', width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 5K (beatmania 2P) 레인 설정 - 스크래치 오른쪽
export const LANE_CONFIG_5K_2P: LaneConfig[] = [
  { column: '1', width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 44, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '4', width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5', width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
];

// 9K (pop'n) 레인 설정
export const LANE_CONFIG_9K: LaneConfig[] = [
  { column: '1', width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 36, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '3', width: 36, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '4', width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5', width: 36, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '6', width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7', width: 36, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '8', width: 36, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '9', width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 14K+2SC (IIDX DP) 레인 설정
export const LANE_CONFIG_14K: LaneConfig[] = [
  { column: 'SC', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4', width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '8', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '9', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '10', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '11', width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '12', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '13', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '14', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC2', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
];

// 4K+SC 레인 설정
export const LANE_CONFIG_4K: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1', width: 50, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 50, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 50, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '4', width: 50, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 6K+SC 레인 설정
export const LANE_CONFIG_6K: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1', width: 42, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 42, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 42, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4', width: 42, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5', width: 42, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6', width: 42, color: '#3399ff', pressedColor: '#66bbff' },
];

// 8K (without SC) 레인 설정
export const LANE_CONFIG_8K: LaneConfig[] = [
  { column: '1', width: 38, color: '#ff6b6b', pressedColor: '#ff9999' },
  { column: '2', width: 38, color: '#ffd93d', pressedColor: '#ffee88' },
  { column: '3', width: 38, color: '#6bcb77', pressedColor: '#99dd99' },
  { column: '4', width: 38, color: '#4d96ff', pressedColor: '#88bbff' },
  { column: '5', width: 38, color: '#4d96ff', pressedColor: '#88bbff' },
  { column: '6', width: 38, color: '#6bcb77', pressedColor: '#99dd99' },
  { column: '7', width: 38, color: '#ffd93d', pressedColor: '#ffee88' },
  { column: '8', width: 38, color: '#ff6b6b', pressedColor: '#ff9999' },
];

// 10K (5K+SC DP) - 1P만
export const LANE_CONFIG_10K_1P: LaneConfig[] = [
  { column: 'SC', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1', width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 36, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '4', width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5', width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 10K (5K+SC DP) - 2P만
export const LANE_CONFIG_10K_2P: LaneConfig[] = [
  { column: '6', width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '7', width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '8', width: 36, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '9', width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '10', width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC2', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
];

// 10K+2SC (5K+SC DP) 레인 설정
export const LANE_CONFIG_10K: LaneConfig[] = [
  ...LANE_CONFIG_10K_1P,
  ...LANE_CONFIG_10K_2P,
];

// 14K+2SC (7K+SC DP) - 1P만
export const LANE_CONFIG_14K_1P: LaneConfig[] = [
  { column: 'SC', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4', width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 14K+2SC (7K+SC DP) - 2P만
export const LANE_CONFIG_14K_2P: LaneConfig[] = [
  { column: '8', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '9', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '10', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '11', width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '12', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '13', width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '14', width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC2', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
];

// 18K (9K DP) 레인 설정
export const LANE_CONFIG_18K: LaneConfig[] = [
  { column: '1', width: 30, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2', width: 30, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '3', width: 30, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '4', width: 30, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5', width: 30, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '6', width: 30, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7', width: 30, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '8', width: 30, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '9', width: 30, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '10', width: 30, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '11', width: 30, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '12', width: 30, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '13', width: 30, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '14', width: 30, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '15', width: 30, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '16', width: 30, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '17', width: 30, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '18', width: 30, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 24K 레인 설정
export const LANE_CONFIG_24K: LaneConfig[] = Array.from({ length: 24 }, (_, i) => ({
  column: String(i + 1),
  width: 22,
  color: i % 2 === 0 ? '#ffffff' : '#3399ff',
  pressedColor: i % 2 === 0 ? '#aaaaaa' : '#66bbff',
}));

// 48K (24K DP) 레인 설정
export const LANE_CONFIG_48K: LaneConfig[] = Array.from({ length: 48 }, (_, i) => ({
  column: String(i + 1),
  width: 14,
  color: i % 2 === 0 ? '#ffffff' : '#3399ff',
  pressedColor: i % 2 === 0 ? '#aaaaaa' : '#66bbff',
}));

// 48K+4SC (24K+2SC DP) 레인 설정
export const LANE_CONFIG_48K_SC: LaneConfig[] = [
  { column: 'SC', width: 30, color: '#ff3366', pressedColor: '#ff6699' },
  { column: 'SC_UP', width: 30, color: '#ff9933', pressedColor: '#ffbb66' },
  ...LANE_CONFIG_48K.slice(0, 24).map(l => ({ ...l, width: 12 })),
  ...LANE_CONFIG_48K.slice(24).map(l => ({ ...l, width: 12 })),
  { column: 'SC2_UP', width: 30, color: '#ff9933', pressedColor: '#ffbb66' },
  { column: 'SC2', width: 30, color: '#ff3366', pressedColor: '#ff6699' },
];

// 키 모드에 따른 레인 설정 맵
export const LANE_CONFIG_MAP: Record<string, LaneConfig[]> = {
  '4K': LANE_CONFIG_4K,
  '5K': LANE_CONFIG_5K,
  '6K': LANE_CONFIG_6K,
  '7K': DEFAULT_LANE_CONFIG,
  '8K': LANE_CONFIG_8K,
  '9K': LANE_CONFIG_9K,
  '10K': LANE_CONFIG_10K,
  '14K': LANE_CONFIG_14K,
  '18K': LANE_CONFIG_18K,
  '24K': LANE_CONFIG_24K,
  '48K': LANE_CONFIG_48K,
  '48K+4SC': LANE_CONFIG_48K_SC,
};

// 플레이 사이드에 따른 레인 필터링
export type PlaySide = '1P' | '2P' | 'DP';

export function getLaneConfigForSide(keyMode: string, side: PlaySide): LaneConfig[] {
  if (side === 'DP') {
    return LANE_CONFIG_MAP[keyMode] ?? DEFAULT_LANE_CONFIG;
  }

  // DP 모드 (14K, 10K 등)에서 1P/2P 사이드 선택
  if (keyMode === '14K' || keyMode === '7K+SC DP') {
    return side === '1P' ? LANE_CONFIG_14K_1P : LANE_CONFIG_14K_2P;
  }
  if (keyMode === '10K' || keyMode === '5K+SC DP') {
    return side === '1P' ? LANE_CONFIG_10K_1P : LANE_CONFIG_10K_2P;
  }

  // SP 모드에서 2P 레이아웃 선택 (스크래치 위치만 변경)
  if (side === '2P') {
    if (keyMode === '7K' || keyMode === '7K+SC') {
      return LANE_CONFIG_7K_2P;
    }
    if (keyMode === '5K' || keyMode === '5K+SC') {
      return LANE_CONFIG_5K_2P;
    }
  }

  // 기본값
  return LANE_CONFIG_MAP[keyMode] ?? DEFAULT_LANE_CONFIG;
}

// 1P/2P 노트 컬럼 정의
export const COLUMN_1P = new Set(['SC', '1', '2', '3', '4', '5', '6', '7']);
export const COLUMN_2P = new Set(['SC2', '8', '9', '10', '11', '12', '13', '14']);

// 레인 설정 헬퍼 함수들
function calculateLanePositions(config: LaneConfig[], scale: number = 1): Map<KeyColumn, { x: number; width: number }> {
  const positions = new Map<KeyColumn, { x: number; width: number }>();
  const totalWidth = config.reduce((sum, lane) => sum + lane.width * scale, 0);

  let x = -totalWidth / 2;
  for (const lane of config) {
    const scaledWidth = lane.width * scale;
    positions.set(lane.column, { x: x + scaledWidth / 2, width: scaledWidth });
    x += scaledWidth;
  }

  return positions;
}

function getLaneColorMap(config: LaneConfig[]): Map<KeyColumn, number> {
  const map = new Map<KeyColumn, number>();
  for (const lane of config) {
    map.set(lane.column, parseInt(lane.color.replace('#', ''), 16));
  }
  return map;
}

// ============ 타입 ============

export interface GameCanvasProps {
  /** 노트 차트 */
  notechart: Notechart;
  /** 게임 상태 (GameLoop에서 제공) */
  gameState: GameLoopState;
  /** Hi-Speed (노트 속도 배율) */
  hiSpeed?: number;
  /** 현재 눌린 키 */
  heldKeys?: Set<KeyColumn>;
  /** 판정 이벤트 (이펙트 표시용) */
  lastJudgmentEvent?: JudgmentEvent | null;
  /** 캔버스 너비 */
  width?: number;
  /** 캔버스 높이 */
  height?: number;
  /** Sudden+ 커버 (0-1000, 상단 가림) */
  suddenPlus?: number;
  /** Lift+ 커버 (0-1000, 하단 올림) */
  liftPlus?: number;
  /** 레인 설정 (기본값: 7K+SC) */
  laneConfig?: LaneConfig[];
  /** 진행 중인 롱노트 ID 세트 (activeHolds) */
  activeHoldNoteIds?: Set<number>;
  /** 노트 높이 배율 (기본 1.0) */
  noteScale?: number;
  /** 레인 너비 배율 (기본 1.0) */
  laneWidthScale?: number;
  /** 트리거된 지뢰 노트 ID */
  triggeredMineIds?: Set<number>;
}

export interface GameCanvasHandle {
  /** 히트 이펙트 트리거 */
  triggerHitEffect: (column: KeyColumn, judgment: Judgment) => void;
}

// ============ 컴포넌트 ============

// 키빔 높이 (판정선에서 위로 뻗는 높이)
const KEY_BEAM_HEIGHT = 120;

/** 정적 레인 배경 (키 입력에 따라 재렌더링되지 않음) */
const StaticLanesBackground: React.FC<{
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  totalWidth: number;
}> = React.memo(({ laneConfig, lanePositions, totalWidth }) => (
  <>
    {/* 전체 배경 */}
    <mesh position={[0, 300, 0]}>
      <planeGeometry args={[totalWidth + 20, 800]} />
      <meshBasicMaterial color="#1a1a2e" transparent opacity={0.9} />
    </mesh>

    {/* 각 레인 배경 */}
    {laneConfig.map((lane) => {
      const pos = lanePositions.get(lane.column);
      if (!pos) return null;
      return (
        <mesh key={lane.column} position={[pos.x, 300, 0]}>
          <planeGeometry args={[pos.width - 2, 800]} />
          <meshBasicMaterial color="#2a2a4e" transparent opacity={0.2} />
        </mesh>
      );
    })}

    {/* 레인 구분선 */}
    {laneConfig.slice(0, -1).map((lane, i) => {
      const pos = lanePositions.get(lane.column);
      if (!pos) return null;
      const lineX = pos.x + pos.width / 2;
      return (
        <mesh key={`divider-${i}`} position={[lineX, 300, 0.1]}>
          <planeGeometry args={[1, 800]} />
          <meshBasicMaterial color="#444466" />
        </mesh>
      );
    })}
  </>
));

StaticLanesBackground.displayName = 'StaticLanesBackground';

/** 키빔 (눌린 키에 따라 동적 렌더링) */
const KeyBeams: React.FC<{
  heldKeys: Set<KeyColumn>;
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
}> = React.memo(({ heldKeys, laneConfig, lanePositions }) => (
  <>
    {laneConfig.map((lane) => {
      const pos = lanePositions.get(lane.column);
      if (!pos) return null;
      if (!heldKeys.has(lane.column)) return null;
      return (
        <mesh key={`beam-${lane.column}`} position={[pos.x, JUDGMENT_LINE_Y + KEY_BEAM_HEIGHT / 2, 0.5]}>
          <planeGeometry args={[pos.width - 4, KEY_BEAM_HEIGHT]} />
          <meshBasicMaterial color={lane.pressedColor} transparent opacity={0.6} />
        </mesh>
      );
    })}
  </>
));

KeyBeams.displayName = 'KeyBeams';

/** 레인 배경 (동적 레인 설정 지원) */
const LanesBackground: React.FC<{
  heldKeys: Set<KeyColumn>;
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  totalWidth: number;
}> = React.memo(({ heldKeys, laneConfig, lanePositions, totalWidth }) => (
  <group position={[0, 0, -1]}>
    <StaticLanesBackground laneConfig={laneConfig} lanePositions={lanePositions} totalWidth={totalWidth} />
    <KeyBeams heldKeys={heldKeys} laneConfig={laneConfig} lanePositions={lanePositions} />
  </group>
));

LanesBackground.displayName = 'LanesBackground';

/** 판정선 (동적 너비) */
const JudgmentLine: React.FC<{ totalWidth: number }> = React.memo(({ totalWidth }) => {

  return (
    <mesh position={[0, JUDGMENT_LINE_Y, 2]}>
      <planeGeometry args={[totalWidth, 4]} />
      <meshBasicMaterial color="#ff6600" />
    </mesh>
  );
});

JudgmentLine.displayName = 'JudgmentLine';

// 재사용 가능한 오브젝트 (GC 압력 감소)
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const DEFAULT_COLOR = 0xffffff;

/** 노트 렌더러 (동적 레인 설정) - useFrame 기반 최적화 */
const NotesRenderer: React.FC<{
  notes: GameNote[];
  currentPosition: number;
  hiSpeed: number;
  judgedNoteIds: Set<number>;
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  laneColorMap: Map<KeyColumn, number>;
  noteScale: number;
}> = React.memo(({ notes, currentPosition, hiSpeed, judgedNoteIds, lanePositions, laneColorMap, noteScale }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colorInitialized = useRef(false);

  // 프레임 간 비교를 위한 ref (불필요한 업데이트 방지)
  const lastPositionRef = useRef(currentPosition);
  const lastJudgedCountRef = useRef(judgedNoteIds.size);

  // 초기 색상 버퍼 설정 (한 번만)
  useEffect(() => {
    if (!meshRef.current || colorInitialized.current) return;
    const mesh = meshRef.current;
    _color.setHex(DEFAULT_COLOR);
    for (let i = 0; i < MAX_VISIBLE_NOTES; i++) {
      mesh.setColorAt(i, _color);
    }
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    colorInitialized.current = true;
  }, []);

  // useFrame으로 매 프레임 인스턴스 업데이트 (React 리렌더 없음)
  useFrame(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;
    const minPos = currentPosition - 0.5;
    const maxPos = currentPosition + VISIBLE_BEATS * hiSpeed;

    let count = 0;

    // 노트 순회 및 인스턴스 업데이트
    for (const note of notes) {
      if (count >= MAX_VISIBLE_NOTES) break;
      if (judgedNoteIds.has(note.id)) continue;

      const notePos = note.position;
      if (notePos < minPos || notePos > maxPos) continue;

      const column = note.column as KeyColumn;
      const lanePos = lanePositions.get(column);
      if (!lanePos) continue;

      const y = JUDGMENT_LINE_Y + (notePos - currentPosition) * 100 * hiSpeed;

      _dummy.position.set(lanePos.x, y, 1);
      _dummy.scale.set(lanePos.width - 4, NOTE_HEIGHT * noteScale, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(count, _dummy.matrix);

      // 색상은 판정 시에만 변경되므로 조건부 업데이트
      if (lastJudgedCountRef.current !== judgedNoteIds.size) {
        const colorHex = laneColorMap.get(column) ?? DEFAULT_COLOR;
        _color.setHex(colorHex);
        mesh.setColorAt(count, _color);
      }

      count++;
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;

    // 판정 수가 변경된 경우에만 색상 업데이트
    if (lastJudgedCountRef.current !== judgedNoteIds.size) {
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      lastJudgedCountRef.current = judgedNoteIds.size;
    }

    lastPositionRef.current = currentPosition;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_VISIBLE_NOTES]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
});

NotesRenderer.displayName = 'NotesRenderer';

const MAX_VISIBLE_LANDMINES = 200;
const LANDMINE_COLOR = 0xff0033;

/** 지뢰 노트 렌더러 - 빨간색으로 구분 */
const LandmineRenderer: React.FC<{
  landmines: GameNote[];
  currentPosition: number;
  hiSpeed: number;
  triggeredMineIds: Set<number>;
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  noteScale: number;
}> = React.memo(({ landmines, currentPosition, hiSpeed, triggeredMineIds, lanePositions, noteScale }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    _color.setHex(LANDMINE_COLOR);
    for (let i = 0; i < MAX_VISIBLE_LANDMINES; i++) {
      mesh.setColorAt(i, _color);
    }
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    const minPos = currentPosition - 0.5;
    const maxPos = currentPosition + VISIBLE_BEATS * hiSpeed;

    let count = 0;
    for (const mine of landmines) {
      if (count >= MAX_VISIBLE_LANDMINES) break;
      if (triggeredMineIds.has(mine.id)) continue;

      const minePos = mine.position;
      if (minePos < minPos || minePos > maxPos) continue;

      const column = mine.column as KeyColumn;
      const lanePos = lanePositions.get(column);
      if (!lanePos) continue;

      const y = JUDGMENT_LINE_Y + (minePos - currentPosition) * 100 * hiSpeed;

      _dummy.position.set(lanePos.x, y, 1.5);
      _dummy.scale.set((lanePos.width - 4) * 0.7, NOTE_HEIGHT * noteScale * 0.7, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(count, _dummy.matrix);
      count++;
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_VISIBLE_LANDMINES]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent opacity={0.85} />
    </instancedMesh>
  );
});

LandmineRenderer.displayName = 'LandmineRenderer';

/** 롱노트 렌더러 - useFrame 기반 최적화 (InstancedMesh 사용) */
const MAX_VISIBLE_LONG_NOTES = 100;

const LongNotesRenderer: React.FC<{
  notes: GameNote[];
  currentPosition: number;
  hiSpeed: number;
  judgedNoteIds: Set<number>;
  activeHoldNoteIds: Set<number>;
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  laneConfig: LaneConfig[];
  noteScale: number;
}> = React.memo(({ notes, currentPosition, hiSpeed, judgedNoteIds, activeHoldNoteIds, lanePositions, laneConfig, noteScale }) => {
  // 헤드/테일용 InstancedMesh ref
  const headTailRef = useRef<THREE.InstancedMesh>(null);
  // 바디용 InstancedMesh ref (별도 - 반투명)
  const bodyRef = useRef<THREE.InstancedMesh>(null);

  // 레인별 색상 맵 (hex number)
  const colorMapHex = useMemo(() => {
    const map = new Map<KeyColumn, number>();
    for (const lane of laneConfig) {
      map.set(lane.column, parseInt(lane.color.replace('#', ''), 16));
    }
    return map;
  }, [laneConfig]);

  // 롱노트만 필터링 (한 번만 - 노트 목록이 변경될 때만)
  const longNotes = useMemo(() => {
    return notes.filter((note) => note.end);
  }, [notes]);

  // useFrame으로 매 프레임 업데이트
  useFrame(() => {
    if (!headTailRef.current || !bodyRef.current) return;

    const headTailMesh = headTailRef.current;
    const bodyMesh = bodyRef.current;
    const minPos = currentPosition - 0.5;
    const maxPos = currentPosition + VISIBLE_BEATS * hiSpeed + 10; // 롱노트는 더 넓은 범위

    let headTailCount = 0;
    let bodyCount = 0;

    for (const note of longNotes) {
      if (headTailCount >= MAX_VISIBLE_LONG_NOTES * 2) break;
      if (bodyCount >= MAX_VISIBLE_LONG_NOTES) break;
      if (!note.end) continue;

      const isActiveHold = activeHoldNoteIds.has(note.id);

      // 이미 판정된 노트는 스킵 (단, 진행 중인 롱노트는 제외)
      if (judgedNoteIds.has(note.id) && !isActiveHold) continue;

      // 범위 체크 (시작 또는 끝이 보이는 경우)
      const originalStartPos = note.position;
      const endPos = note.end.position;
      if (endPos < minPos || originalStartPos > maxPos) continue;

      const column = note.column as KeyColumn;
      const lanePos = lanePositions.get(column);
      if (!lanePos) continue;

      // 진행 중인 롱노트는 시작점을 현재 위치로 클램프 (바디가 줄어듦)
      const startPos = isActiveHold ? Math.max(originalStartPos, currentPosition) : originalStartPos;

      const startY = JUDGMENT_LINE_Y + (startPos - currentPosition) * 100 * hiSpeed;
      const endY = JUDGMENT_LINE_Y + (endPos - currentPosition) * 100 * hiSpeed;
      const height = Math.max(0, endY - startY);

      if (height <= 0) continue;

      const colorHex = colorMapHex.get(column) ?? DEFAULT_COLOR;
      _color.setHex(colorHex);

      // 헤드 (진행 중인 롱노트면 판정선에 고정)
      if (!isActiveHold) {
        _dummy.position.set(lanePos.x, startY, 1);
        _dummy.scale.set(lanePos.width - 4, NOTE_HEIGHT * noteScale, 1);
        _dummy.updateMatrix();
        headTailMesh.setMatrixAt(headTailCount, _dummy.matrix);
        headTailMesh.setColorAt(headTailCount, _color);
        headTailCount++;
      }

      // 테일
      _dummy.position.set(lanePos.x, endY, 1);
      _dummy.scale.set(lanePos.width - 4, NOTE_HEIGHT * noteScale, 1);
      _dummy.updateMatrix();
      headTailMesh.setMatrixAt(headTailCount, _dummy.matrix);
      headTailMesh.setColorAt(headTailCount, _color);
      headTailCount++;

      // 바디 (중앙)
      const centerY = startY + height / 2;
      _dummy.position.set(lanePos.x, centerY, 0.5);
      _dummy.scale.set(lanePos.width - 8, height, 1);
      _dummy.updateMatrix();
      bodyMesh.setMatrixAt(bodyCount, _dummy.matrix);
      bodyMesh.setColorAt(bodyCount, _color);
      bodyCount++;
    }

    headTailMesh.count = headTailCount;
    headTailMesh.instanceMatrix.needsUpdate = true;
    if (headTailMesh.instanceColor) {
      headTailMesh.instanceColor.needsUpdate = true;
    }

    bodyMesh.count = bodyCount;
    bodyMesh.instanceMatrix.needsUpdate = true;
    if (bodyMesh.instanceColor) {
      bodyMesh.instanceColor.needsUpdate = true;
    }
  });

  // 초기 색상 버퍼 설정
  useEffect(() => {
    if (headTailRef.current) {
      _color.setHex(DEFAULT_COLOR);
      for (let i = 0; i < MAX_VISIBLE_LONG_NOTES * 2; i++) {
        headTailRef.current.setColorAt(i, _color);
      }
      if (headTailRef.current.instanceColor) {
        headTailRef.current.instanceColor.needsUpdate = true;
      }
    }
    if (bodyRef.current) {
      for (let i = 0; i < MAX_VISIBLE_LONG_NOTES; i++) {
        bodyRef.current.setColorAt(i, _color);
      }
      if (bodyRef.current.instanceColor) {
        bodyRef.current.instanceColor.needsUpdate = true;
      }
    }
  }, []);

  return (
    <group>
      {/* 헤드/테일 (불투명) */}
      <instancedMesh ref={headTailRef} args={[undefined, undefined, MAX_VISIBLE_LONG_NOTES * 2]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial />
      </instancedMesh>

      {/* 바디 (반투명) */}
      <instancedMesh ref={bodyRef} args={[undefined, undefined, MAX_VISIBLE_LONG_NOTES]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.5} />
      </instancedMesh>
    </group>
  );
});

LongNotesRenderer.displayName = 'LongNotesRenderer';

/** 히트 이펙트 상태 (레인당 1개) */
interface LaneEffectState {
  active: boolean;
  startTime: number;
  judgment: Judgment;
}

/** 히트 이펙트 매니저 핸들 */
export interface HitEffectsManagerHandle {
  trigger: (column: KeyColumn, judgment: Judgment) => void;
  reset: () => void;
}

// 판정별 색상 (미리 계산)
const JUDGMENT_COLORS: Record<Judgment, number> = {
  'PGREAT': 0x00ffff,
  'GREAT': 0xffff00,
  'GOOD': 0x00ff00,
  'BAD': 0xff00ff,
  'POOR': 0xff0000,
  'MISS': 0x888888,
};

/** 히트 이펙트 매니저 props */
interface HitEffectsManagerProps {
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
}

/** 히트 이펙트 매니저 (완전 ref 기반 - React 리렌더 없음, 동적 레인 지원) */
const HitEffectsManager = React.forwardRef<HitEffectsManagerHandle, HitEffectsManagerProps>(
  function HitEffectsManager({ laneConfig, lanePositions }, ref) {
    const laneCount = laneConfig.length;

    // 컬럼 → 인덱스 매핑 (빠른 조회용)
    const columnIndexMap = useMemo(() => {
      const map = new Map<KeyColumn, number>();
      laneConfig.forEach((lane, i) => map.set(lane.column, i));
      return map;
    }, [laneConfig]);

    // 각 레인별 메쉬 ref (최대 레인 수만큼 미리 할당)
    const meshRefs = useRef<(THREE.Mesh | null)[]>(new Array(MAX_LANES).fill(null));
    const materialRefs = useRef<(THREE.MeshBasicMaterial | null)[]>(new Array(MAX_LANES).fill(null));

    // 각 레인별 이펙트 상태 (ref로 관리 - 리렌더 없음)
    const effectStates = useRef<LaneEffectState[]>(
      new Array(MAX_LANES).fill(null).map(() => ({ active: false, startTime: 0, judgment: 'MISS' as Judgment }))
    );

    // 레인별 X 위치 배열
    const positionXArray = useMemo(() => {
      return laneConfig.map(lane => {
        const pos = lanePositions.get(lane.column);
        return pos?.x ?? 0;
      });
    }, [laneConfig, lanePositions]);

    // 외부에서 이펙트 트리거
    React.useImperativeHandle(ref, () => ({
      trigger: (column: KeyColumn, judgment: Judgment) => {
        const index = columnIndexMap.get(column);
        if (index === undefined) return;

        const state = effectStates.current[index];
        state.active = true;
        state.startTime = performance.now();
        state.judgment = judgment;

        // 즉시 색상 업데이트
        const material = materialRefs.current[index];
        if (material) {
          material.color.setHex(JUDGMENT_COLORS[judgment]);
          material.opacity = 0.6;
        }

        // 즉시 스케일 리셋
        const mesh = meshRefs.current[index];
        if (mesh) {
          mesh.scale.setScalar(1);
          mesh.visible = true;
        }
      },
      reset: () => {
        for (let i = 0; i < laneCount; i++) {
          effectStates.current[i].active = false;
          const mesh = meshRefs.current[i];
          if (mesh) mesh.visible = false;
        }
      },
    }), [columnIndexMap, laneCount]);

    // 매 프레임 모든 이펙트 업데이트 (단일 useFrame)
    useFrame(() => {
      const now = performance.now();
      const duration = 200; // ms

      for (let i = 0; i < laneCount; i++) {
        const state = effectStates.current[i];
        const mesh = meshRefs.current[i];
        const material = materialRefs.current[i];

        if (!state.active || !mesh || !material) {
          if (mesh) mesh.visible = false;
          continue;
        }

        const elapsed = now - state.startTime;

        if (elapsed >= duration) {
          state.active = false;
          mesh.visible = false;
          continue;
        }

        const progress = elapsed / duration;
        mesh.scale.setScalar(1 + progress * 0.5);
        material.opacity = (1 - progress) * 0.6;
        mesh.visible = true;
      }
    });

    return (
      <group>
        {laneConfig.map((lane, i) => (
          <mesh
            key={lane.column}
            ref={(el) => { meshRefs.current[i] = el; }}
            position={[positionXArray[i], JUDGMENT_LINE_Y, 3]}
            visible={false}
          >
            <circleGeometry args={[20, 16]} />
            <meshBasicMaterial
              ref={(el) => { materialRefs.current[i] = el; }}
              color={0xffffff}
              transparent
              opacity={0}
            />
          </mesh>
        ))}
      </group>
    );
  }
);

HitEffectsManager.displayName = 'HitEffectsManager';

/** Sudden+ / Lift+ 커버 (동적 너비) */
const LaneCover: React.FC<{
  suddenPlus: number;  // 0-1000
  liftPlus: number;    // 0-1000
  height: number;
  totalWidth: number;
}> = React.memo(({ suddenPlus, liftPlus, height, totalWidth }) => {
  const coverWidth = totalWidth + 40;

  // 커버 높이 계산 (0-1000 → 실제 픽셀)
  // 1000 = 전체 노트 영역의 ~80% 정도
  const maxCoverHeight = height - JUDGMENT_LINE_Y - 50;
  const suddenHeight = (suddenPlus / 1000) * maxCoverHeight;
  const liftHeight = (liftPlus / 1000) * (JUDGMENT_LINE_Y - 20);

  return (
    <group position={[0, 0, 5]}>
      {/* Sudden+ 커버 (상단) */}
      {suddenPlus > 0 && (
        <mesh position={[0, height - suddenHeight / 2, 0]}>
          <planeGeometry args={[coverWidth, suddenHeight]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
      )}

      {/* Sudden+ 커버 하단 라인 */}
      {suddenPlus > 0 && (
        <mesh position={[0, height - suddenHeight, 0.1]}>
          <planeGeometry args={[coverWidth, 3]} />
          <meshBasicMaterial color="#00ff00" />
        </mesh>
      )}

      {/* Lift+ 커버 (하단) */}
      {liftPlus > 0 && (
        <mesh position={[0, liftHeight / 2, 0]}>
          <planeGeometry args={[coverWidth, liftHeight]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
      )}

      {/* Lift+ 커버 상단 라인 */}
      {liftPlus > 0 && (
        <mesh position={[0, liftHeight, 0.1]}>
          <planeGeometry args={[coverWidth, 3]} />
          <meshBasicMaterial color="#ff0000" />
        </mesh>
      )}
    </group>
  );
});

LaneCover.displayName = 'LaneCover';

/** Early/Late 타이밍 표시기 (EZ2ON 스타일) */
const TimingIndicator: React.FC<{
  offsets: number[];
  lastOffset: number;
}> = React.memo(({ offsets, lastOffset }) => {
  // 타이밍 범위 설정 (ms) - ±150ms를 표시 범위로 사용
  const MAX_OFFSET = 150;
  const INDICATOR_WIDTH = 240;
  const INDICATOR_HEIGHT = 36;

  // 마지막 오프셋의 위치 계산 (중앙이 0ms)
  const lastOffsetPosition = lastOffset
    ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, lastOffset))
    : 0;
  const lastOffsetX = (lastOffsetPosition / MAX_OFFSET) * (INDICATOR_WIDTH / 2);

  // 최근 오프셋들의 분포 계산 (히스토그램)
  const bucketCount = 31; // -15 ~ 0 ~ 15 (31개 버킷)
  const buckets = new Array(bucketCount).fill(0);

  offsets.forEach((offset) => {
    const clamped = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offset));
    const normalized = (clamped + MAX_OFFSET) / (MAX_OFFSET * 2); // 0~1
    const bucketIndex = Math.floor(normalized * (bucketCount - 1));
    buckets[bucketIndex]++;
  });

  const maxBucket = Math.max(...buckets, 1);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* EARLY / LATE 라벨 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          width: INDICATOR_WIDTH + 60,
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          marginBottom: 4,
          textShadow: '0 0 4px rgba(0,0,0,0.8)',
        }}
      >
        <span style={{ color: '#00aaff' }}>EARLY</span>
        <span style={{ color: '#ff6600' }}>LATE</span>
      </div>

      {/* 타이밍 히스토그램 */}
      <div
        style={{
          position: 'relative',
          width: INDICATOR_WIDTH,
          height: INDICATOR_HEIGHT,
          background: 'rgba(0, 0, 0, 0.75)',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        {/* 히스토그램 바 */}
        <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', padding: '2px 0' }}>
          {buckets.map((count, i) => {
            const height = (count / maxBucket) * (INDICATOR_HEIGHT - 4);
            const isCenter = i === Math.floor(bucketCount / 2);
            const isEarly = i < Math.floor(bucketCount / 2);

            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: count > 0 ? Math.max(2, height) : 0,
                  background: isCenter
                    ? '#ffffff'
                    : isEarly
                      ? '#00aaff'
                      : '#ff6600',
                  opacity: 0.8,
                  margin: '0 0.5px',
                  borderRadius: '1px 1px 0 0',
                }}
              />
            );
          })}
        </div>

        {/* 중앙선 (Perfect 라인) */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 2,
            background: '#fff',
            transform: 'translateX(-50%)',
          }}
        />

        {/* 마지막 타이밍 마커 */}
        {lastOffset !== 0 && (
          <div
            style={{
              position: 'absolute',
              left: `calc(50% + ${lastOffsetX}px)`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '8px solid #fff',
            }}
          />
        )}
      </div>

      {/* 마지막 오프셋 수치 */}
      {lastOffset !== 0 && (
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            color: lastOffset < 0 ? '#00aaff' : '#ff6600',
            textShadow: '0 0 4px currentColor',
          }}
        >
          {lastOffset > 0 ? '+' : ''}{lastOffset.toFixed(0)}ms
        </div>
      )}
    </div>
  );
});

TimingIndicator.displayName = 'TimingIndicator';

/** 카메라 컨트롤러 (동적 너비) */
const CameraController: React.FC<{ height: number; totalWidth: number }> = ({ height, totalWidth }) => {
  const { camera } = useThree();

  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;

    ortho.left = -totalWidth / 2 - 50;
    ortho.right = totalWidth / 2 + 50;
    ortho.top = height;
    ortho.bottom = 0;
    ortho.near = -100;
    ortho.far = 100;
    ortho.position.set(0, 0, 10);
    ortho.updateProjectionMatrix();
  }, [camera, height, totalWidth]);

  return null;
};

/** 메인 게임 캔버스 */
export const GameCanvas = React.forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    {
      notechart,
      gameState,
      hiSpeed = 1,
      heldKeys = new Set(),
      lastJudgmentEvent = null,
      width = 400,
      height = 700,
      suddenPlus = 0,
      liftPlus = 0,
      laneConfig = DEFAULT_LANE_CONFIG,
      noteScale = 1,
      laneWidthScale = 1,
      triggeredMineIds: externalTriggeredMineIds,
    },
    ref
  ) {
    // 히트 이펙트 매니저 ref (완전 ref 기반 - 리렌더 없음)
    const hitEffectsRef = useRef<HitEffectsManagerHandle>(null);

    // 판정된 노트 ID 추적 (ref로 관리하여 불필요한 리렌더 방지)
    const judgedNoteIdsRef = useRef<Set<number>>(new Set());
    const [judgedNoteIds, setJudgedNoteIds] = useState<Set<number>>(new Set());

    // 트리거된 지뢰 노트 ID 추적 (외부에서 주입되거나 내부 관리)
    const [internalTriggeredMineIds, setTriggeredMineIds] = useState<Set<number>>(new Set());
    const activeMineIds = externalTriggeredMineIds ?? internalTriggeredMineIds;

    // 레인 위치 및 색상 계산 (레인 설정 변경 시만 재계산)
    const lanePositions = useMemo(() => calculateLanePositions(laneConfig, laneWidthScale), [laneConfig, laneWidthScale]);
    const laneColorMap = useMemo(() => getLaneColorMap(laneConfig), [laneConfig]);
    const totalWidth = useMemo(() => laneConfig.reduce((sum, lane) => sum + lane.width * laneWidthScale, 0), [laneConfig, laneWidthScale]);

    // 현재 위치 계산 (안전 가드 포함 - scroll jump 방지)
    const currentPosition = useMemo(() => {
      if (!notechart?.beatToPosition) return 0;
      const beat = gameState.currentBeat;
      // NaN 또는 Infinity 방지
      if (!Number.isFinite(beat) || beat < 0) return 0;
      const position = notechart.beatToPosition(beat);
      // 결과값도 검증
      if (!Number.isFinite(position)) return 0;
      return position;
    }, [notechart, gameState.currentBeat]);

    // 히트 이펙트 트리거 (ref 기반 - 리렌더 없음)
    const triggerHitEffect = useCallback((column: KeyColumn, judgment: Judgment) => {
      hitEffectsRef.current?.trigger(column, judgment);
    }, []);

    // ref로 메서드 노출
    React.useImperativeHandle(ref, () => ({
      triggerHitEffect,
    }), [triggerHitEffect]);

    // 판정 이벤트 처리
    useEffect(() => {
      if (lastJudgmentEvent) {
        triggerHitEffect(lastJudgmentEvent.column, lastJudgmentEvent.judgment);

        // ref와 state 모두 업데이트
        judgedNoteIdsRef.current.add(lastJudgmentEvent.noteId);
        setJudgedNoteIds(new Set(judgedNoteIdsRef.current));
      }
    }, [lastJudgmentEvent, triggerHitEffect]);

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
          <CameraController height={height} totalWidth={totalWidth} />

          {/* 레인 배경 */}
          <LanesBackground heldKeys={heldKeys} laneConfig={laneConfig} lanePositions={lanePositions} totalWidth={totalWidth} />

          {/* 판정선 */}
          <JudgmentLine totalWidth={totalWidth} />

          {/* 노트 */}
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

          {/* 롱노트 */}
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

          {/* 지뢰 노트 */}
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

          {/* 히트 이펙트 (ref 기반 매니저 - 초당 100+ 히트에도 리렌더 없음) */}
          <HitEffectsManager ref={hitEffectsRef} laneConfig={laneConfig} lanePositions={lanePositions} />

          {/* Sudden+ / Lift+ 커버 */}
          {(suddenPlus > 0 || liftPlus > 0) && (
            <LaneCover
              suddenPlus={suddenPlus}
              liftPlus={liftPlus}
              height={height}
              totalWidth={totalWidth}
            />
          )}
        </Canvas>

        {/* UI 오버레이 - 좌측 (콤보/스코어) */}
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

        {/* UI 오버레이 - 우측 (판정 통계) */}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#00ffff' }}>PG</span>
            <span>{gameState.pgreatCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#ffff00' }}>GR</span>
            <span>{gameState.greatCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#00ff00' }}>GD</span>
            <span>{gameState.goodCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#ff00ff' }}>BD</span>
            <span>{gameState.badCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#ff0000' }}>PR</span>
            <span>{gameState.poorCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#888888' }}>MS</span>
            <span>{gameState.missCount}</span>
          </div>
        </div>

        {/* 커버 값 표시 */}
        {suddenPlus > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              color: '#00ff00',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            SUD+ {suddenPlus}
          </div>
        )}
        {liftPlus > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              color: '#ff0000',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
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
            {gameState.lastOffset < 0 ? 'EARLY' : 'LATE'} {gameState.lastOffset > 0 ? '+' : ''}{gameState.lastOffset.toFixed(0)}ms
          </div>
        )}

        {/* Early/Late 타이밍 표시기 */}
        <TimingIndicator offsets={gameState.recentOffsets} lastOffset={gameState.lastOffset} />
      </div>
    );
  }
);

export default GameCanvas;
