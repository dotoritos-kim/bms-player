/**
 * Player lane layouts must use the columns bms-core assigns to chart notes,
 * otherwise notes on a missing column are never drawn and always MISS.
 */
import { BMSParser } from '@rhythm-archive/bms-core';
import {
  LANE_CONFIG_MAP,
  getLaneConfigForSide,
} from '../src/game/canvas/laneConfig';

function columnsOf(text: string): Set<string> {
  const parser = new BMSParser();
  parser.compileString(text);
  return new Set(parser.getNotes()!.all().map((n) => n.column).filter((c): c is string => !!c));
}

describe('10K lane layout', () => {
  // IIDX DP 5 keys + scratch on both sides (channels 11-16 / 21-26)
  const TEN_K = [
    '#PLAYER 3', '#BPM 150', '#WAV01 a.wav',
    '#00111:01', '#00112:01', '#00113:01', '#00114:01', '#00115:01', '#00116:01',
    '#00121:01', '#00122:01', '#00123:01', '#00124:01', '#00125:01', '#00126:01',
  ].join('\n');

  it('has a lane for every column of a 10K chart (2P keys = columns 8-12)', () => {
    const lanes = new Set(LANE_CONFIG_MAP['10K'].map((l) => l.column));
    for (const col of columnsOf(TEN_K)) expect(lanes.has(col)).toBe(true);
    expect([...lanes]).toEqual(['SC', '1', '2', '3', '4', '5', '8', '9', '10', '11', '12', 'SC2']);
  });

  it('splits into 1P (SC, 1-5) and 2P (8-12, SC2) sides', () => {
    expect(getLaneConfigForSide('10K', '1P').map((l) => l.column)).toEqual(['SC', '1', '2', '3', '4', '5']);
    expect(getLaneConfigForSide('10K', '2P').map((l) => l.column)).toEqual(['8', '9', '10', '11', '12', 'SC2']);
  });
});
