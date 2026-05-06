/**
 * EffectLayer — 히트 이펙트 · 커버 · UI 오버레이
 * S10 (REFACTOR-PLAN §9): GameCanvas.tsx Composite 패턴 분리
 *
 * 책임: 히트 이펙트(ref 기반), Sudden+/Lift+ 커버, Early/Late HUD
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { KeyColumn } from '../InputHandler';
import type { Judgment } from '../JudgmentEngine';
import { JUDGMENT_LINE_Y } from './LaneLayer';
import type { LaneConfig } from './laneConfig';

// ── 상수 ─────────────────────────────────────────────────────────────────

const MAX_LANES = 52;

const JUDGMENT_COLORS: Record<Judgment, number> = {
  PGREAT: 0x00ffff,
  GREAT:  0xffff00,
  GOOD:   0x00ff00,
  BAD:    0xff00ff,
  POOR:   0xff0000,
  MISS:   0x888888,
};

// ── 히트 이펙트 ───────────────────────────────────────────────────────────

interface LaneEffectState {
  active: boolean;
  startTime: number;
  judgment: Judgment;
}

export interface HitEffectsManagerHandle {
  trigger: (column: KeyColumn, judgment: Judgment) => void;
  reset: () => void;
}

interface HitEffectsManagerProps {
  laneConfig: LaneConfig[];
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
}

export const HitEffectsManager = React.forwardRef<HitEffectsManagerHandle, HitEffectsManagerProps>(
  function HitEffectsManager({ laneConfig, lanePositions }, ref) {
    const laneCount = laneConfig.length;

    const columnIndexMap = useMemo(() => {
      const map = new Map<KeyColumn, number>();
      laneConfig.forEach((lane, i) => map.set(lane.column, i));
      return map;
    }, [laneConfig]);

    const meshRefs = useRef<(THREE.Mesh | null)[]>(new Array(MAX_LANES).fill(null));
    const materialRefs = useRef<(THREE.MeshBasicMaterial | null)[]>(new Array(MAX_LANES).fill(null));

    const effectStates = useRef<LaneEffectState[]>(
      new Array(MAX_LANES).fill(null).map(() => ({ active: false, startTime: 0, judgment: 'MISS' as Judgment })),
    );

    const positionXArray = useMemo(
      () => laneConfig.map(lane => lanePositions.get(lane.column)?.x ?? 0),
      [laneConfig, lanePositions],
    );

    React.useImperativeHandle(ref, () => ({
      trigger: (column: KeyColumn, judgment: Judgment) => {
        const index = columnIndexMap.get(column);
        if (index === undefined) return;
        const state = effectStates.current[index];
        state.active = true;
        state.startTime = performance.now();
        state.judgment = judgment;

        const material = materialRefs.current[index];
        if (material) {
          material.color.setHex(JUDGMENT_COLORS[judgment]);
          material.opacity = 0.6;
        }
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

    useFrame(() => {
      const now = performance.now();
      const duration = 200;

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
  },
);
HitEffectsManager.displayName = 'HitEffectsManager';

// ── Sudden+ / Lift+ 커버 ─────────────────────────────────────────────────

export const LaneCover: React.FC<{
  suddenPlus: number;
  liftPlus: number;
  height: number;
  totalWidth: number;
}> = React.memo(({ suddenPlus, liftPlus, height, totalWidth }) => {
  const coverWidth = totalWidth + 40;
  const maxCoverHeight = height - JUDGMENT_LINE_Y - 50;
  const suddenHeight = (suddenPlus / 1000) * maxCoverHeight;
  const liftHeight = (liftPlus / 1000) * (JUDGMENT_LINE_Y - 20);

  return (
    <group position={[0, 0, 5]}>
      {suddenPlus > 0 && (
        <mesh position={[0, height - suddenHeight / 2, 0]}>
          <planeGeometry args={[coverWidth, suddenHeight]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
      )}
      {suddenPlus > 0 && (
        <mesh position={[0, height - suddenHeight, 0.1]}>
          <planeGeometry args={[coverWidth, 3]} />
          <meshBasicMaterial color="#00ff00" />
        </mesh>
      )}
      {liftPlus > 0 && (
        <mesh position={[0, liftHeight / 2, 0]}>
          <planeGeometry args={[coverWidth, liftHeight]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
      )}
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

// ── Early/Late タイミング表示 ─────────────────────────────────────────────

export const TimingIndicator: React.FC<{
  offsets: number[];
  lastOffset: number;
}> = React.memo(({ offsets, lastOffset }) => {
  const MAX_OFFSET = 150;
  const INDICATOR_WIDTH = 240;
  const INDICATOR_HEIGHT = 36;
  const bucketCount = 31;

  const lastOffsetX = lastOffset
    ? (Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, lastOffset)) / MAX_OFFSET) * (INDICATOR_WIDTH / 2)
    : 0;

  const buckets = new Array(bucketCount).fill(0);
  offsets.forEach((offset) => {
    const clamped = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offset));
    const normalized = (clamped + MAX_OFFSET) / (MAX_OFFSET * 2);
    const idx = Math.floor(normalized * (bucketCount - 1));
    buckets[idx]++;
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

      <div
        style={{
          position: 'relative',
          width: INDICATOR_WIDTH,
          height: INDICATOR_HEIGHT,
          background: 'rgba(0,0,0,0.75)',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', padding: '2px 0' }}>
          {buckets.map((count, i) => {
            const barHeight = (count / maxBucket) * (INDICATOR_HEIGHT - 4);
            const isCenter = i === Math.floor(bucketCount / 2);
            const isEarly = i < Math.floor(bucketCount / 2);
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: count > 0 ? Math.max(2, barHeight) : 0,
                  background: isCenter ? '#ffffff' : isEarly ? '#00aaff' : '#ff6600',
                  opacity: 0.8,
                  margin: '0 0.5px',
                  borderRadius: '1px 1px 0 0',
                }}
              />
            );
          })}
        </div>
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
