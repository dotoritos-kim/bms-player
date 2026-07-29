/**
 * レーン設定データ — GameCanvas から分離した純粋定数モジュール
 * S10 (REFACTOR-PLAN §9): GameCanvas.tsx の責任分離
 */

import type { KeyColumn } from '../InputHandler';

// ── 型 ────────────────────────────────────────────────────────────────────

export interface LaneConfig {
  column: KeyColumn;
  width: number;
  color: string;
  pressedColor: string;
}

export type PlaySide = '1P' | '2P' | 'DP';

// ── 定数 ──────────────────────────────────────────────────────────────────

// Default 7K+SC (IIDX SP 1P) lane config — scratch on the left
export const DEFAULT_LANE_CONFIG: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4',  width: 40, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6',  width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 7K+SC (IIDX SP 2P) — scratch on the right
export const LANE_CONFIG_7K_2P: LaneConfig[] = [
  { column: '1',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4',  width: 40, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6',  width: 40, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7',  width: 40, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
];

// 5K (beatmania 1P) — scratch on the left
export const LANE_CONFIG_5K: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1',  width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 44, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '4',  width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5',  width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 5K (beatmania 2P) — scratch on the right
export const LANE_CONFIG_5K_2P: LaneConfig[] = [
  { column: '1',  width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 44, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '4',  width: 44, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5',  width: 44, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
];

// 9K (pop'n)
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

// 14K+2SC (IIDX DP)
export const LANE_CONFIG_14K: LaneConfig[] = [
  { column: 'SC',  width: 50, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1',   width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',   width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',   width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4',   width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5',   width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6',   width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7',   width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '8',   width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '9',   width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '10',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '11',  width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '12',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '13',  width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '14',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC2', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
];

// 4K+SC
export const LANE_CONFIG_4K: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1',  width: 50, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 50, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 50, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '4',  width: 50, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 6K+SC
export const LANE_CONFIG_6K: LaneConfig[] = [
  { column: 'SC', width: 60, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1',  width: 42, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 42, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 42, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4',  width: 42, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5',  width: 42, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6',  width: 42, color: '#3399ff', pressedColor: '#66bbff' },
];

// 8K (no SC)
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

// 10K (5K+SC DP) — 1P
export const LANE_CONFIG_10K_1P: LaneConfig[] = [
  { column: 'SC', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1',  width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 36, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '4',  width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5',  width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 10K (5K+SC DP) — 2P
export const LANE_CONFIG_10K_2P: LaneConfig[] = [
  { column: '6',   width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '7',   width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '8',   width: 36, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '9',   width: 36, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '10',  width: 36, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC2', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
];

// 10K+2SC (5K+SC DP) full set
export const LANE_CONFIG_10K: LaneConfig[] = [
  ...LANE_CONFIG_10K_1P,
  ...LANE_CONFIG_10K_2P,
];

// 14K+2SC (7K+SC DP) — 1P
export const LANE_CONFIG_14K_1P: LaneConfig[] = [
  { column: 'SC', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '1',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '3',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '4',  width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '5',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '6',  width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
];

// 14K+2SC (7K+SC DP) — 2P
export const LANE_CONFIG_14K_2P: LaneConfig[] = [
  { column: '8',   width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '9',   width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '10',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '11',  width: 32, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '12',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '13',  width: 32, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '14',  width: 32, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: 'SC2', width: 50, color: '#ff3366', pressedColor: '#ff6699' },
];

// 18K (9K DP)
export const LANE_CONFIG_18K: LaneConfig[] = [
  { column: '1',  width: 30, color: '#ffffff', pressedColor: '#aaaaaa' },
  { column: '2',  width: 30, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '3',  width: 30, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '4',  width: 30, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '5',  width: 30, color: '#ff3366', pressedColor: '#ff6699' },
  { column: '6',  width: 30, color: '#3399ff', pressedColor: '#66bbff' },
  { column: '7',  width: 30, color: '#00ff00', pressedColor: '#66ff66' },
  { column: '8',  width: 30, color: '#ffcc00', pressedColor: '#ffdd66' },
  { column: '9',  width: 30, color: '#ffffff', pressedColor: '#aaaaaa' },
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

// 24K
export const LANE_CONFIG_24K: LaneConfig[] = Array.from({ length: 24 }, (_, i) => ({
  column: String(i + 1),
  width: 22,
  color: i % 2 === 0 ? '#ffffff' : '#3399ff',
  pressedColor: i % 2 === 0 ? '#aaaaaa' : '#66bbff',
}));

// 48K (24K DP)
export const LANE_CONFIG_48K: LaneConfig[] = Array.from({ length: 48 }, (_, i) => ({
  column: String(i + 1),
  width: 14,
  color: i % 2 === 0 ? '#ffffff' : '#3399ff',
  pressedColor: i % 2 === 0 ? '#aaaaaa' : '#66bbff',
}));

// 48K+4SC (24K+2SC DP)
export const LANE_CONFIG_48K_SC: LaneConfig[] = [
  { column: 'SC',    width: 30, color: '#ff3366', pressedColor: '#ff6699' },
  { column: 'SC_UP', width: 30, color: '#ff9933', pressedColor: '#ffbb66' },
  ...LANE_CONFIG_48K.slice(0, 24).map(l => ({ ...l, width: 12 })),
  ...LANE_CONFIG_48K.slice(24).map(l => ({ ...l, width: 12 })),
  { column: 'SC2_UP', width: 30, color: '#ff9933', pressedColor: '#ffbb66' },
  { column: 'SC2',    width: 30, color: '#ff3366', pressedColor: '#ff6699' },
];

// 12K (6K DP)
export const LANE_CONFIG_12K: LaneConfig[] = Array.from({ length: 12 }, (_, i) => ({
  column: String(i + 1),
  width: 28,
  color: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#ffe66d', '#4ecdc4', '#ff6b6b'][i % 6],
  pressedColor: ['#ff9999', '#88ddd4', '#fff099', '#fff099', '#88ddd4', '#ff9999'][i % 6],
}));

// ── Maps / helpers ───────────────────────────────────────────────────────

export const LANE_CONFIG_MAP: Record<string, LaneConfig[]> = {
  '4K':     LANE_CONFIG_4K,
  '5K':     LANE_CONFIG_5K,
  '6K':     LANE_CONFIG_6K,
  '7K':     DEFAULT_LANE_CONFIG,
  '8K':     LANE_CONFIG_8K,
  '9K':     LANE_CONFIG_9K,
  '10K':    LANE_CONFIG_10K,
  '12K':    LANE_CONFIG_12K,
  '14K':    LANE_CONFIG_14K,
  '18K':    LANE_CONFIG_18K,
  '24K':    LANE_CONFIG_24K,
  '48K':    LANE_CONFIG_48K,
  '48K+4SC': LANE_CONFIG_48K_SC,
};

// 1P/2P note column definitions
export const COLUMN_1P = new Set(['SC', '1', '2', '3', '4', '5', '6', '7']);
export const COLUMN_2P = new Set(['SC2', '8', '9', '10', '11', '12', '13', '14']);

export function getLaneConfigForSide(keyMode: string, side: PlaySide): LaneConfig[] {
  if (side === 'DP') {
    return LANE_CONFIG_MAP[keyMode] ?? DEFAULT_LANE_CONFIG;
  }

  if (keyMode === '14K' || keyMode === '7K+SC DP') {
    return side === '1P' ? LANE_CONFIG_14K_1P : LANE_CONFIG_14K_2P;
  }
  if (keyMode === '10K' || keyMode === '5K+SC DP') {
    return side === '1P' ? LANE_CONFIG_10K_1P : LANE_CONFIG_10K_2P;
  }

  if (side === '2P') {
    if (keyMode === '7K' || keyMode === '7K+SC') return LANE_CONFIG_7K_2P;
    if (keyMode === '5K' || keyMode === '5K+SC') return LANE_CONFIG_5K_2P;
  }

  return LANE_CONFIG_MAP[keyMode] ?? DEFAULT_LANE_CONFIG;
}

// Lane position calculation utility
export function calculateLanePositions(
  config: LaneConfig[],
  scale: number = 1,
): Map<KeyColumn, { x: number; width: number }> {
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

export function getLaneColorMap(config: LaneConfig[]): Map<KeyColumn, number> {
  const map = new Map<KeyColumn, number>();
  for (const lane of config) {
    map.set(lane.column, parseInt(lane.color.replace('#', ''), 16));
  }
  return map;
}
