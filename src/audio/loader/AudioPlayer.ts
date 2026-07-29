import { GameNote, SoundedEvent } from '../judgements';
import { AudioPreloader } from './AudioPreloader';

/**
 * Binary-search helpers.
 * - lowerBound: in a sorted notes array, finds the first index where
 *   `note.time >= targetTime`.
 * - upperBound: in a sorted notes array, finds the first index where
 *   `note.time >  targetTime`. (upperBound - 1) is the last index whose
 *   time is at most `targetTime`.
 */
function lowerBound<T extends GameNote | SoundedEvent>(notes: T[], targetTime: number): number {
    let left = 0;
    let right = notes.length; // right is the "one past the end" index

    while (left < right) {
        const mid = (left + right) >>> 1;
        if (notes[mid].time < targetTime) {
            // Below target — shrink the search to the right half.
            left = mid + 1;
        } else {
            // notes[mid].time >= targetTime
            right = mid;
        }
    }
    return left;
}

/**************************************
 * 4) createClosestNoteFinder
 *    - sorts the note array by time once
 *    - getClosestNote returns the single nearest note
 **************************************/
export function createClosestNoteFinder<T extends GameNote | SoundedEvent>(originalNotes: T[]) {
    // Sort by time once on construction.
    const notes = [...originalNotes].sort((a, b) => a.time - b.time);

    return {
        /**
         * getClosestNotes
         * - returns notes within `tolerance` of `currentTime`
         * - skips notes that have already been consumed
         */
        getClosestNotes(currentTime: number, tolerance = 0.02): T[] {
            // Consider only notes that have not yet been consumed.
            const availableNotes = notes.filter((n) => !n.used);

            // Use lowerBound to bracket the in-range slice.
            const lowerIdx = lowerBound(availableNotes, currentTime - tolerance);
            const upperIdx = lowerBound(availableNotes, currentTime + tolerance);

            // Return notes that fall within the tolerance window.
            return availableNotes.slice(lowerIdx, upperIdx).filter((note) => {
                const diff = Math.abs(note.time - currentTime);
                return diff <= tolerance;
            });
        },

        /**
         * markNoteAsUsed
         * - flags a specific note as consumed
         */
        markNoteAsUsed(note: T) {
            note.used = true; // Adds the flag dynamically.
        },

        markGetNoteAsUsed(note: T) {
            note.get = true; // Adds the flag dynamically.
        },

        /**
         * resetUsedNotes
         * - clears the consumed flag on every note
         */
        resetUsedNotes() {
            notes.forEach((n) => {
                n.used = undefined; // Removes the flag.
            });
        },
    };
}

export class PlayerAudio {
    private _preloader: AudioPreloader;
    private _notes: {
        getClosestNotes(currentTime: number, tolerance?: number): GameNote[] | null;
        markNoteAsUsed(note: GameNote): void;
        markGetNoteAsUsed(note: GameNote): void;
        resetUsedNotes(): void;
    };
    private _autos: {
        getClosestNotes(currentTime: number, tolerance?: number): SoundedEvent[] | null;
        markNoteAsUsed(note: SoundedEvent): void;
        markGetNoteAsUsed(note: SoundedEvent): void;
        resetUsedNotes(): void;
    };
    constructor(notes: GameNote[], autos: SoundedEvent[], preloader: AudioPreloader) {
        this._notes = createClosestNoteFinder<GameNote>(notes);
        this._autos = createClosestNoteFinder<SoundedEvent>(autos);

        this._preloader = preloader;

        console.log('[PlayerAudio] notes Finder:', this._notes);
        console.log('[PlayerAudio] autos Finder:', this._autos);
    }

    /**
     * playAutoKeySound
     * - flags `matchedNote` as consumed
     * - uses the synchronous variant (`playAudioSync`) to minimise latency
     */
    playAutoKeySound(currentTime: number) {
        const matchedNotes = this._autos.getClosestNotes(currentTime, 0.018); // May return multiple notes.

        // Process every returned note.
        if (matchedNotes && matchedNotes.length > 0) {
            for (const matchedNote of matchedNotes) {
                if (matchedNote.used !== true) {
                    this._preloader.playAudioSync(matchedNote.keysound.toLowerCase());
                    this._autos.markNoteAsUsed(matchedNote);
                }
            }
        }
    }

    playAutoNoteKeySound(currentTime: number) {
        const matchedNotes = this._notes.getClosestNotes(currentTime, 0.018); // May return multiple notes.
        // Process every returned note.
        if (matchedNotes && matchedNotes.length > 0) {
            for (const matchedNote of matchedNotes) {
                if (matchedNote.used !== true) {
                    this._preloader.playAudioSync(matchedNote.keysound.toLowerCase());
                    this._notes.markNoteAsUsed(matchedNote);
                }
            }
        }
    }

    getCurrentNote(currentTime: number) {
        const matchedNotes = this._notes.getClosestNotes(currentTime, 0.2); // May return multiple notes.
        const notes: GameNote[] = [];
        // Process every returned note.
        if (matchedNotes && matchedNotes.length > 0) {
            matchedNotes.forEach((matchedNote) => {
                if (matchedNote.get !== true) {
                    notes.push(matchedNote);
                    this._notes.markGetNoteAsUsed(matchedNote);
                }
            });
            return notes;
        }
        return [];
    }

    /**
     * resetUsedNotes
     * - clears the consumed flag on every note
     */
    resetUsedNotes() {
        this._notes.resetUsedNotes();
        this._autos.resetUsedNotes();
    }
}
