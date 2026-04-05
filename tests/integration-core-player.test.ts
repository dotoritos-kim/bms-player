/**
 * Integration test: bms-core output → bms-player Notechart
 *
 * Verifies the data flow where bms-core parses a BMS string and the
 * resulting objects (Notes, Timing, KeySounds, Positioning, Spacing, SongInfo)
 * are consumed by bms-player's Notechart class without errors.
 */
import { describe, it, expect } from 'vitest';
import {
    BMSParser,
    Notes,
    Timing,
    KeySounds,
    Positioning,
    Spacing,
    SongInfo,
} from '@rhythm-archive/bms-core';
import { Notechart, NotechartInput } from '../src/audio/judgements';

/**
 * Converts bms-core parsed output into the NotechartInput format
 * that bms-player's Notechart constructor expects.
 * This mirrors the conversion done in the frontend.
 */
function buildNotechartInput(parser: BMSParser): NotechartInput {
    const chart = parser.chart!;
    const timing = parser.getTiming()!;
    const notes = parser.getNotes()!;
    const keysounds = parser.getKeySounds()!;
    const songInfo = parser.getSongInfo()!;
    const positioning = Positioning.fromBMSChart(chart, timing);
    const spacing = Spacing.fromBMSChart(chart);

    // Generate bar lines: collect beat positions for each measure
    const allNotes = notes.all();
    const maxMeasure = allNotes.reduce((max, note) => {
        // Estimate measure from beat (4 beats per measure in 4/4)
        const measure = Math.floor(note.beat / 4);
        return Math.max(max, measure);
    }, 0);
    const barLines: number[] = [];
    for (let m = 0; m <= maxMeasure + 1; m++) {
        barLines.push(chart.measureToBeat(m, 0));
    }

    return {
        notes: allNotes,
        timing,
        keysounds,
        songInfo,
        positioning,
        spacing,
        barLines,
        expertJudgmentWindow: [0.02, 0.06],
    };
}

// Synthetic BMS data: 2 measures, 2 keysounds, notes in channels 11 (1P visible)
const SIMPLE_BMS = [
    '#TITLE Test Song',
    '#ARTIST Test Artist',
    '#BPM 120',
    '#WAV01 kick.wav',
    '#WAV02 snare.wav',
    '#00111:0102',
    '#00211:0201',
].join('\n');

describe('bms-core → bms-player integration', () => {
    it('parses BMS string and creates a valid Notechart', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        // The BMS defines 4 playable notes across 2 measures:
        //   measure 1 channel 11: "0102" → 2 slots, note at pos 0 (wav01) and pos 1 (wav02)
        //   measure 2 channel 11: "0201" → 2 slots, note at pos 0 (wav02) and pos 1 (wav01)
        expect(notechart.notes.length).toBe(4);

        // Every note time should be a finite number
        for (const note of notechart.notes) {
            expect(Number.isFinite(note.time)).toBe(true);
            expect(Number.isFinite(note.beat)).toBe(true);
            expect(Number.isFinite(note.position)).toBe(true);
        }

        // Notes should be ordered by beat/time (non-decreasing)
        for (let i = 1; i < notechart.notes.length; i++) {
            expect(notechart.notes[i].beat).toBeGreaterThanOrEqual(
                notechart.notes[i - 1].beat,
            );
        }
    });

    it('maps keysound IDs to valid filenames', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        // Every note keysound ID should resolve to a filename
        const keysoundMap = notechart.keysounds;
        for (const note of notechart.notes) {
            const filename = keysoundMap[note.keysound];
            expect(filename).toBeDefined();
            expect(typeof filename).toBe('string');
            expect(filename.length).toBeGreaterThan(0);
        }
    });

    it('produces correct sample file list', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        // samples should contain exactly the two WAV files referenced
        expect(notechart.samples).toContain('kick.wav');
        expect(notechart.samples).toContain('snare.wav');
        expect(notechart.samples.length).toBe(2);
    });

    it('converts timing correctly (beat 0 = 0 seconds)', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        // At BPM 120, beat 0 should be at time 0
        expect(notechart.beatToSeconds(0)).toBe(0);

        // At BPM 120, one beat = 0.5 seconds, so beat 4 = 2 seconds
        expect(notechart.beatToSeconds(4)).toBeCloseTo(2.0, 5);
    });

    it('generates bar lines', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        // Should have at least 2 bar lines (measures 0, 1, 2)
        expect(notechart.barLines.length).toBeGreaterThanOrEqual(2);

        // Each bar line should have finite beat, time, position
        for (const barLine of notechart.barLines) {
            expect(Number.isFinite(barLine.beat)).toBe(true);
            expect(Number.isFinite(barLine.time)).toBe(true);
            expect(Number.isFinite(barLine.position)).toBe(true);
        }
    });

    it('preserves song info from bms-core', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        expect(notechart.songInfo.title).toBe('Test Song');
        expect(notechart.songInfo.artist).toBe('Test Artist');
    });

    it('computes positive duration from parsed notes', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        expect(notechart.duration).toBeGreaterThan(0);
        expect(Number.isFinite(notechart.duration)).toBe(true);
    });

    it('assigns unique IDs to all notes', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        const ids = notechart.notes.map((n) => n.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    it('handles BGM-only notes as auto keysounds', () => {
        // BMS with only BGM channel (01) notes — no playable notes
        const bgmBms = [
            '#TITLE BGM Only',
            '#ARTIST Nobody',
            '#BPM 150',
            '#WAV01 bgm.wav',
            '#00101:01',
        ].join('\n');

        const parser = new BMSParser();
        parser.compileString(bgmBms);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        // No playable notes
        expect(notechart.notes.length).toBe(0);

        // But auto keysound events should exist
        expect(notechart.autos.length).toBeGreaterThan(0);
        expect(notechart.autos[0].keysound).toBe('01');
    });

    it('handles note volume from keysound data', () => {
        const parser = new BMSParser();
        parser.compileString(SIMPLE_BMS);

        const input = buildNotechartInput(parser);
        const notechart = new Notechart(input);

        // Default volume is 100, so volume should be 1.0 (100/100)
        for (const note of notechart.notes) {
            expect(note.volume).toBe(1.0);
        }
    });
});
