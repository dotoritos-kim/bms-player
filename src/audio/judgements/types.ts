import * as BMS from '@rhythm-archive/bms-core';

/**
 * NotechartInput defines all the input data required to construct a notechart.
 */
export interface NotechartInput {
    notes: BMS.BMSNote[]; // Every playable note in the game.
    landmineNotes?: BMS.BMSNote[]; // Landmine notes (optional).
    timing: BMS.Timing; // Timing-information container.
    keysounds: BMS.KeySounds; // Keysound data.
    songInfo: BMS.SongInfo; // Song metadata.
    positioning: BMS.Positioning; // Note positioning information.
    spacing: BMS.Spacing; // Note-spacing information.

    /** Beat positions of the bar lines. */
    barLines: number[];

    /** Image references. */
    images?: NotechartImages;

    /**
     * Judgment window used to compute expert score (IIDX-style EX-score).
     * A two-tuple: the first element is the maximum offset for a +2 score
     * (PGREAT); the second is the maximum offset for a +1 score (GREAT).
     */
    expertJudgmentWindow: ExpertJudgmentWindow;
}

/** Defines the offset thresholds. */
export type ExpertJudgmentWindow = [number, number];

/** References the images a Notechart can display. */
export interface NotechartImages {
    eyecatch?: string; // Eyecatch image.
    background?: string; // Background image.
}

/** Player configuration options. */
export interface PlayerOptions {
    scratch: 'off' | 'left' | 'right'; // Scratch placement option.
    double?: boolean; // Whether double mode is active.
}

/** Base interface for any in-game event. */
export interface GameEvent {
    beat: number; // Beat position of the event.
    time: number; // Time position of the event.
    position: number; // In-game position.
}

/** Event that carries an associated keysound. */
export interface SoundedEvent extends GameEvent {
    used?: boolean;
    get?: boolean;
    keysound: string; // Keysound for this event.
    keysoundStart?: number; // Optional keysound start offset.
    keysoundEnd?: number; // Optional keysound end offset.
    volume?: number; // Keysound volume (0-1, derived from #VOLWAV).
}

/** A note that can be played by the user. */
export interface GameNote extends SoundedEvent {
    id: number; // Note ID.
    end?: GameEvent; // For long notes, the end event (optional).
    column: string; // Column the note sits in.
    /** Landmine damage (% of gauge) from the chart's #xxxD1 value; undefined for regular notes. */
    damage?: number;
}

/** A landmine note in the game. */
export interface GameLandmine extends GameEvent {
    id: number; // Landmine ID.
    column: string; // Column the landmine sits in.
}

/**
 * Per-note metadata.
 * - Defines the maximum number of judgments this note can produce.
 * - Plain notes use 1, long notes use 2.
 */
export interface NoteInfo {
    combos: 2 | 1;
}

/**
 * `INotechart` is the minimal surface the game engine
 * (`GameEngine` / `GameLoop`) needs to consume chart data.
 *
 * - On the main thread the `Notechart` class satisfies this interface.
 * - On a worker thread an implementation backed by a serialised copy
 *   (e.g. `NotechartProxy`) can be injected into `GameEngine` as long as
 *   it satisfies this interface.
 *
 * This interface exists purely as a *broadening* hook for external
 * compatibility; it does not affect the public signature of the
 * `Notechart` class. Add new methods sparingly.
 */
export interface INotechart {
    readonly notes: GameNote[];
    readonly autos: SoundedEvent[];
    readonly landmines: GameNote[];
    readonly duration: number;
    secondsToBeat(seconds: number): number;
    beatToSeconds(beat: number): number;
}
