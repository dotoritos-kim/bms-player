/**
 * LaneLayer — Lane background rendering layer.
 * S10 (REFACTOR-PLAN §9): split out of GameCanvas.tsx via the Composite pattern.
 *
 * Responsibilities: background fill, lane dividers, judgment line, key beams.
 */

import React from 'react';
import type { KeyColumn } from '../InputHandler';
import type { LaneConfig } from './laneConfig';

// ── Constants ────────────────────────────────────────────────────────────

export const JUDGMENT_LINE_Y = 100;
const KEY_BEAM_HEIGHT = 120;

// ── Static background (independent of key state) ─────────────────────────

const StaticLanesBackground: React.FC<{
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  totalWidth: number;
}> = React.memo(({ laneConfig, lanePositions, totalWidth }) => (
  <>
    <mesh position={[0, 300, 0]}>
      <planeGeometry args={[totalWidth + 20, 800]} />
      <meshBasicMaterial color="#1a1a2e" transparent opacity={0.9} />
    </mesh>

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

// ── Key beams ────────────────────────────────────────────────────────────

const KeyBeams: React.FC<{
  heldKeys: Set<KeyColumn>;
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
}> = React.memo(({ heldKeys, laneConfig, lanePositions }) => (
  <>
    {laneConfig.map((lane) => {
      const pos = lanePositions.get(lane.column);
      if (!pos || !heldKeys.has(lane.column)) return null;
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

// ── Judgment line ────────────────────────────────────────────────────────

export const JudgmentLine: React.FC<{ totalWidth: number }> = React.memo(({ totalWidth }) => (
  <mesh position={[0, JUDGMENT_LINE_Y, 2]}>
    <planeGeometry args={[totalWidth, 4]} />
    <meshBasicMaterial color="#ff6600" />
  </mesh>
));
JudgmentLine.displayName = 'JudgmentLine';

// ── Combined LaneLayer ───────────────────────────────────────────────────

export interface LaneLayerProps {
  heldKeys: Set<KeyColumn>;
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  totalWidth: number;
}

export const LaneLayer: React.FC<LaneLayerProps> = React.memo(
  ({ heldKeys, laneConfig, lanePositions, totalWidth }) => (
    <group position={[0, 0, -1]}>
      <StaticLanesBackground
        laneConfig={laneConfig}
        lanePositions={lanePositions}
        totalWidth={totalWidth}
      />
      <KeyBeams
        heldKeys={heldKeys}
        laneConfig={laneConfig}
        lanePositions={lanePositions}
      />
    </group>
  ),
);
LaneLayer.displayName = 'LaneLayer';

// ── CameraController ─────────────────────────────────────────────────────

import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEffect } from 'react';

export const CameraController: React.FC<{ height: number; totalWidth: number }> = ({
  height,
  totalWidth,
}) => {
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
