/**
 * NoteLayer — Note rendering layer (regular notes, long notes, landmines).
 * S10 (REFACTOR-PLAN §9): split out of GameCanvas.tsx via the Composite pattern.
 *
 * Responsibilities: InstancedMesh-based note rendering (useFrame optimized).
 */

import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { GameNote } from '../../audio/judgements';
import type { KeyColumn } from '../InputHandler';
import { JUDGMENT_LINE_Y } from './LaneLayer';
import type { LaneConfig } from './laneConfig';

// ── Constants ────────────────────────────────────────────────────────────

const NOTE_HEIGHT = 8;
const VISIBLE_BEATS = 8;
const MAX_VISIBLE_NOTES = 1000;
const MAX_VISIBLE_LANDMINES = 200;
const MAX_VISIBLE_LONG_NOTES = 100;
const LANDMINE_COLOR = 0xff0033;
const DEFAULT_COLOR = 0xffffff;

// Reusable Three.js objects (reduces GC pressure)
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

// ── Regular notes ────────────────────────────────────────────────────────

export const NotesRenderer: React.FC<{
  notes: GameNote[];
  currentPosition: number;
  hiSpeed: number;
  judgedNoteIds: Set<number>;
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  laneColorMap: Map<KeyColumn, number>;
  noteScale: number;
}> = React.memo(({ notes, currentPosition, hiSpeed, judgedNoteIds, lanePositions, laneColorMap, noteScale }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    _color.setHex(DEFAULT_COLOR);
    for (let i = 0; i < MAX_VISIBLE_NOTES; i++) mesh.setColorAt(i, _color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    const minPos = currentPosition - 0.5;
    const maxPos = currentPosition + VISIBLE_BEATS / hiSpeed;
    let count = 0;

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

      const colorHex = laneColorMap.get(column) ?? DEFAULT_COLOR;
      _color.setHex(colorHex);
      mesh.setColorAt(count, _color);
      count++;
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_VISIBLE_NOTES]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
});
NotesRenderer.displayName = 'NotesRenderer';

// ── Landmine notes ───────────────────────────────────────────────────────

export const LandmineRenderer: React.FC<{
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
    for (let i = 0; i < MAX_VISIBLE_LANDMINES; i++) mesh.setColorAt(i, _color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    const minPos = currentPosition - 0.5;
    const maxPos = currentPosition + VISIBLE_BEATS / hiSpeed;
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

// ── Long notes ───────────────────────────────────────────────────────────

export const LongNotesRenderer: React.FC<{
  notes: GameNote[];
  currentPosition: number;
  hiSpeed: number;
  judgedNoteIds: Set<number>;
  activeHoldNoteIds: Set<number>;
  lanePositions: Map<KeyColumn, { x: number; width: number }>;
  laneConfig: LaneConfig[];
  noteScale: number;
}> = React.memo(({ notes, currentPosition, hiSpeed, judgedNoteIds, activeHoldNoteIds, lanePositions, laneConfig, noteScale }) => {
  const headTailRef = useRef<THREE.InstancedMesh>(null);
  const bodyRef = useRef<THREE.InstancedMesh>(null);

  const colorMapHex = useMemo(() => {
    const map = new Map<KeyColumn, number>();
    for (const lane of laneConfig) {
      map.set(lane.column, parseInt(lane.color.replace('#', ''), 16));
    }
    return map;
  }, [laneConfig]);

  const longNotes = useMemo(() => notes.filter((n) => n.end), [notes]);

  useFrame(() => {
    if (!headTailRef.current || !bodyRef.current) return;
    const headTailMesh = headTailRef.current;
    const bodyMesh = bodyRef.current;
    const minPos = currentPosition - 0.5;
    const maxPos = currentPosition + VISIBLE_BEATS / hiSpeed + 10;
    let headTailCount = 0;
    let bodyCount = 0;

    for (const note of longNotes) {
      if (headTailCount >= MAX_VISIBLE_LONG_NOTES * 2) break;
      if (bodyCount >= MAX_VISIBLE_LONG_NOTES) break;
      if (!note.end) continue;

      const isActiveHold = activeHoldNoteIds.has(note.id);
      if (judgedNoteIds.has(note.id) && !isActiveHold) continue;

      const originalStartPos = note.position;
      const endPos = note.end.position;
      if (endPos < minPos || originalStartPos > maxPos) continue;

      const column = note.column as KeyColumn;
      const lanePos = lanePositions.get(column);
      if (!lanePos) continue;

      const startPos = isActiveHold ? Math.max(originalStartPos, currentPosition) : originalStartPos;
      const startY = JUDGMENT_LINE_Y + (startPos - currentPosition) * 100 * hiSpeed;
      const endY = JUDGMENT_LINE_Y + (endPos - currentPosition) * 100 * hiSpeed;
      const height = Math.max(0, endY - startY);
      if (height <= 0) continue;

      const colorHex = colorMapHex.get(column) ?? DEFAULT_COLOR;
      _color.setHex(colorHex);

      // Head (skipped while the long note is being held)
      if (!isActiveHold) {
        _dummy.position.set(lanePos.x, startY, 1);
        _dummy.scale.set(lanePos.width - 4, NOTE_HEIGHT * noteScale, 1);
        _dummy.updateMatrix();
        headTailMesh.setMatrixAt(headTailCount, _dummy.matrix);
        headTailMesh.setColorAt(headTailCount, _color);
        headTailCount++;
      }

      // Tail
      _dummy.position.set(lanePos.x, endY, 1);
      _dummy.scale.set(lanePos.width - 4, NOTE_HEIGHT * noteScale, 1);
      _dummy.updateMatrix();
      headTailMesh.setMatrixAt(headTailCount, _dummy.matrix);
      headTailMesh.setColorAt(headTailCount, _color);
      headTailCount++;

      // Body
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
    if (headTailMesh.instanceColor) headTailMesh.instanceColor.needsUpdate = true;

    bodyMesh.count = bodyCount;
    bodyMesh.instanceMatrix.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  });

  useEffect(() => {
    if (headTailRef.current) {
      _color.setHex(DEFAULT_COLOR);
      for (let i = 0; i < MAX_VISIBLE_LONG_NOTES * 2; i++) headTailRef.current.setColorAt(i, _color);
      if (headTailRef.current.instanceColor) headTailRef.current.instanceColor.needsUpdate = true;
    }
    if (bodyRef.current) {
      for (let i = 0; i < MAX_VISIBLE_LONG_NOTES; i++) bodyRef.current.setColorAt(i, _color);
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
    }
  }, []);

  return (
    <group>
      <instancedMesh ref={headTailRef} args={[undefined, undefined, MAX_VISIBLE_LONG_NOTES * 2]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial />
      </instancedMesh>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, MAX_VISIBLE_LONG_NOTES]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.5} />
      </instancedMesh>
    </group>
  );
});
LongNotesRenderer.displayName = 'LongNotesRenderer';
