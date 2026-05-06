import * as BMS from '@rhythm-archive/bms-core';
import { invariant } from '@epic-web/invariant';
import {
    NotechartInput,
    PlayerOptions,
    GameEvent,
    GameNote,
    SoundedEvent,
    NoteInfo,
    NotechartImages,
    GameLandmine,
} from './types';

export * from './types';

/**
 * Notechart manages all information about a single player's notechart and
 * exposes the data the game runtime needs to drive playback.
 */
export class Notechart {
    private _timing: BMS.Timing;
    private _keysounds: BMS.KeySounds;
    private _positioning: BMS.Positioning;
    private _spacing: BMS.Spacing;

    private _duration: number;
    private _notes: GameNote[];
    private _autos: SoundedEvent[];
    private _landmines: GameNote[];
    private _barLines: GameEvent[];
    private _samples: string[];
    private _infos: Map<GameNote, NoteInfo>;
    private _songInfo: BMS.SongInfo;
    private _images: NotechartImages | undefined;

    expertJudgmentWindow: [number, number];

    constructor(data: NotechartInput, playerOptions: Partial<PlayerOptions> = {}) {
        const {
            notes,
            timing,
            keysounds,
            songInfo,
            positioning,
            spacing,
            barLines,
            images,
            expertJudgmentWindow,
            landmineNotes = [],
        } = data;
        let bmsNotes = notes;

        invariant(bmsNotes, 'Expected "data.notes"');
        invariant(timing, 'Expected "data.timing"');
        invariant(keysounds, 'Expected "data.keysounds"');
        invariant(songInfo, 'Expected "data.songInfo"');
        invariant(positioning, 'Expected "data.positioning"');
        invariant(spacing, 'Expected "data.spacing"');
        invariant(barLines, 'Expected "data.barLines"');

        this.expertJudgmentWindow = expertJudgmentWindow;

        bmsNotes = this._preTransform(bmsNotes, playerOptions);

        this._timing = timing;
        this._positioning = positioning;
        this._spacing = spacing;
        this._keysounds = keysounds;
        this._duration = 0;
        this._notes = this._generatePlayableNotesFromBMS(bmsNotes);
        this._landmines = this._generatePlayableNotesFromBMS(landmineNotes);
        this._autos = this._generateAutoKeysoundEventsFromBMS(bmsNotes);
        this._barLines = this._generateBarLineEvents(barLines);
        this._samples = this._generateKeysoundFiles(keysounds);
        this._infos = new Map<GameNote, NoteInfo>(this._notes.map((note) => [note, this._getNoteInfo(note)] as [GameNote, NoteInfo]));
        this._songInfo = songInfo;
        this._images = images;
    }

    /**
     * Returns the array of note events.
     */
    get notes() {
        return this._notes;
    }

    /**
     * Returns the array of landmine events.
     */
    get landmines() {
        return this._landmines;
    }

    /**
     * Returns the array of auto-keysound events.
     */
    get autos() {
        return this._autos;
    }

    /**
     * Returns the array of every sample file the chart uses.
     */
    get samples() {
        return this._samples;
    }

    /**
     * Returns the keysound-ID-to-filename mapping.
     */
    get keysounds() {
        return this._keysounds.all();
    }

    /**
     * Returns the bar-line event collection.
     */
    get barLines() {
        return this._barLines;
    }

    /**
     * Returns every column name of this notechart as an array.
     */
    get columns() {
        return ['SC', '1', '2', '3', '4', '5', '6', '7'];
    }

    /**
     * Returns the total duration of the notechart (the time of the last event).
     */
    get duration() {
        return this._duration;
    }

    /**
     * Returns the song metadata for this notechart.
     */
    get songInfo() {
        return this._songInfo;
    }

    /**
     * Returns the eyecatch image filename.
     */
    get eyecatchImage() {
        return (this._images && this._images.eyecatch) || 'eyecatch_image.png';
    }

    /**
     * Returns the background image filename.
     */
    get backgroundImage() {
        return (this._images && this._images.background) || 'back_image.png';
    }

    /**
     * Returns the info object for a specific note.
     */
    info(note: GameNote): NoteInfo | undefined {
        return this._infos.get(note);
    }

    /**
     * Converts a beat count to a position in seconds within the song.
     */
    beatToSeconds(beat: number) {
        return this._timing.beatToSeconds(beat);
    }

    /**
     * Converts a beat count to its in-game position.
     */
    beatToPosition(beat: number) {
        return this._positioning.position(beat);
    }

    /**
     * Converts a measure number to a beat count.
     */
    measureToBeat(measure: number) {
        return (this._barLines[measure] || this._barLines[this._barLines.length - 1]).beat;
    }

    /**
     * Converts a position in seconds to a beat count.
     */
    secondsToBeat(seconds: number) {
        return this._timing.secondsToBeat(seconds);
    }

    /**
     * Converts a position in seconds to an in-game position.
     */
    secondsToPosition(seconds: number) {
        return this.beatToPosition(this.secondsToBeat(seconds));
    }

    /**
     * Returns the BPM at a given beat.
     */
    bpmAtBeat(beat: number) {
        return this._timing.bpmAtBeat(beat);
    }

    /**
     * Returns the scroll speed at a given beat.
     */
    scrollSpeedAtBeat(beat: number) {
        return this._positioning.speed(beat);
    }

    /**
     * Returns the note-spacing factor at a given beat.
     */
    spacingAtBeat(beat: number) {
        return this._spacing.factor(beat);
    }

    /**
     * Detects the key mode from the note columns.
     * @param scratch retained for backward compatibility — unused by the
     *   actual key-mode detection.
     * @returns {string} key mode ('4K' through '48K').
     */
    getKeyMode(scratch?: string): string {
        return detectKeyModeFromColumns(this.notes.map(n => n.column));
    }

    _preTransform(bmsNotes: BMS.BMSNote[], playerOptions: Partial<PlayerOptions>) {
        let result = [...bmsNotes];
        const keys = getKeys(bmsNotes);
        if (playerOptions.scratch === 'off') {
            result = result.map((note: BMS.BMSNote) => {
                if (note.column && note.column === 'SC') {
                    return Object.assign({}, note, { column: null });
                } else {
                    return note;
                }
            });
        }
        if (keys === '5K') {
            const columnsToShift = ['1', '2', '3', '4', '5', '6', '7'];
            const shiftNote = (amount: number) => (note: BMS.BMSNote) => {
                if (note.column) {
                    const index = columnsToShift.indexOf(note.column);
                    if (index > -1) {
                        const newIndex = index + amount;
                        invariant(newIndex < columnsToShift.length, 'Unexpected: column shift exceeds the available column count.');
                        const newColumn = columnsToShift[newIndex];
                        return Object.assign({}, note, { column: newColumn });
                    }
                }
                return note;
            };
            if (playerOptions.scratch === 'off') {
                result = result.map(shiftNote(1));
            } else if (playerOptions.scratch === 'right') {
                result = result.map(shiftNote(2));
            }
        }
        return result;
    }

    _generatePlayableNotesFromBMS(bmsNotes: BMS.BMSNote[]) {
        let nextId = 1;
        return bmsNotes
            .filter((note) => note.column)
            .map((note) => {
                const spec = this._generateEvent(note.beat) as GameNote;
                spec.id = nextId++;
                spec.column = note.column!;
                spec.keysound = note.keysound;
                spec.keysoundStart = note.keysoundStart;
                spec.keysoundEnd = note.keysoundEnd;
                spec.volume = this._keysounds.getVolume(note.keysound) / 100;
                this._updateDuration(spec);
                if (note.endBeat !== undefined) {
                    spec.end = this._generateEvent(note.endBeat);
                    this._updateDuration(spec.end);
                } else {
                    spec.end = undefined;
                }
                return spec;
            });
    }

    _generateLandminesFromBMS(bmsNotes: BMS.BMSNote[]) {
        let nextId = 1;
        return bmsNotes
            .filter((note) => note.column)
            .map((note) => {
                const spec = this._generateEvent(note.beat) as GameLandmine;
                spec.id = nextId++;
                spec.column = note.column!;
                this._updateDuration(spec);
                return spec;
            });
    }

    _updateDuration(event: GameEvent) {
        if (event.time > this._duration) this._duration = event.time;
    }

    _generateAutoKeysoundEventsFromBMS(bmsNotes: BMS.BMSNote[]) {
        return bmsNotes
            .filter((note) => !note.column)
            .map((note) => {
                const spec = this._generateEvent(note.beat) as SoundedEvent;
                spec.keysound = note.keysound;
                spec.keysoundStart = note.keysoundStart;
                spec.keysoundEnd = note.keysoundEnd;
                spec.volume = this._keysounds.getVolume(note.keysound) / 100;
                return spec;
            });
    }

    _generateKeysoundFiles(keysounds: BMS.KeySounds): string[] {
        const set = new Set<string>();
        for (const array of [this.notes, this.autos]) {
            for (const event_ of array) {
                const file = keysounds.get(event_.keysound);
                if (file) set.add(file);
            }
        }
        return Array.from(set);
    }

    _generateBarLineEvents(beats: number[]) {
        return beats.map((beat) => this._generateEvent(beat));
    }

    _generateEvent(beat: number): GameEvent {
        return {
            beat: beat,
            time: this.beatToSeconds(beat),
            position: this.beatToPosition(beat),
        };
    }

    _getNoteInfo(note: GameNote): NoteInfo {
        return { combos: note.end ? 2 : 1 };
    }
}

export default Notechart;

function getKeys(bmsNotes: BMS.BMSNote[]) {
    for (const note of bmsNotes) {
        if (note.column === '6' || note.column === '7') {
            return '7K';
        }
    }
    return '5K';
}

/**
 * Detects the key mode from the list of note columns.
 * Analyses the column names mapped by bms-core ('1'-'48', 'SC', 'SC2',
 * 'FZ', 'FZ2').
 */
function detectKeyModeFromColumns(columns: string[]): string {
    const usedColumns = new Set<string>();
    for (const col of columns) {
        if (col) usedColumns.add(col);
    }
    if (usedColumns.size === 0) return '7K';

    const maxNumericColumn = Array.from(usedColumns)
        .filter(col => /^\d+$/.test(col))
        .map(col => parseInt(col, 10))
        .reduce((max, num) => Math.max(max, num), 0);

    const hasSC = usedColumns.has('SC');
    const hasSC2 = usedColumns.has('SC2');
    const hasFZ = usedColumns.has('FZ');
    const hasFZ2 = usedColumns.has('FZ2');
    const hasIIDXSpecial = hasSC || hasSC2 || hasFZ || hasFZ2;

    // DP detection
    const iidxDP2P = ['10', '11', '12', '13', '14', 'SC2', 'FZ2'];
    const hasIIDX2P = iidxDP2P.some(col => usedColumns.has(col));

    if (hasIIDX2P || maxNumericColumn >= 10) {
        if (hasIIDXSpecial) {
            if (usedColumns.has('6') || usedColumns.has('7') || usedColumns.has('13') || usedColumns.has('14')) {
                return '14K';
            }
            return '10K';
        }
        if (maxNumericColumn >= 24) return '48K';
        if (maxNumericColumn >= 18) return '24K';
        if (maxNumericColumn >= 10) return '18K';
        return '12K';
    }

    // SP with IIDX special lanes
    if (hasIIDXSpecial) {
        const keyColumns = ['1', '2', '3', '4', '5', '6', '7'];
        const usedKeyCount = keyColumns.filter(col => usedColumns.has(col)).length;
        if (usedKeyCount >= 7) return '7K';
        if (usedKeyCount === 6) return '6K';
        if (usedKeyCount === 5) return '5K';
        return '4K';
    }

    // Keyboard SP (no scratch)
    if (maxNumericColumn >= 24) return '48K';
    if (maxNumericColumn >= 12) return '24K';
    if (maxNumericColumn >= 9) return '9K';
    if (maxNumericColumn >= 8) return '8K';
    if (maxNumericColumn >= 7) return '7K';
    if (maxNumericColumn >= 6) return '6K';
    if (maxNumericColumn >= 5) return '5K';
    return '4K';
}
