/**
 * useBmsPreview Hook
 *
 * Hybrid BMS preview playback hook.
 * 1. If preview.ogg/mp3 exists, plays it directly.
 * 2. Otherwise, plays the BGM channel keysounds in real time.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { BMSParser, KeySounds, Timing } from '@rhythm-archive/bms-core';
import type { BMSNote } from '@rhythm-archive/bms-core';
import { AudioPreloader, FileMap, resolveKeysoundFiles, type ResolveOptions, type AudioFileMapFetcher } from '../audio';
import { WorkerAudioScheduler } from '../game/WorkerAudioScheduler';
import type { SchedulerNote } from '../game/AudioSchedulerWorker';

export interface BmsPreviewResolveConfig {
    /** Repository slug */
    slug: string;
    /** Branch, tag, or commit SHA */
    ref: string;
    /** Directory path where the BMS file is located */
    dir: string;
    /** Fetcher that retrieves the audio file mapping */
    fetcher: AudioFileMapFetcher;
}

export interface BmsPreviewOptions {
    /** Base URL where the files are located */
    baseUrl: string;
    /** BMS file path (relative to baseUrl) */
    bmsPath?: string;
    /** Preview file paths (in priority order) */
    previewPaths?: string[];
    /** Volume (0-1) */
    volume?: number;
    /** Progress callback */
    onProgress?: (progress: number) => void;
    /** Error callback */
    onError?: (error: Error) => void;
    /**
     * Worker factory function for AudioLoader.
     * Consumers must provide this since Worker instantiation is bundler-specific.
     */
    workerFactory?: () => Worker;
    /** Stem-based file resolution config (uses original filenames when absent) */
    resolve?: BmsPreviewResolveConfig;
    /** Audio scheduler Worker factory (when provided, uses Worker-based scheduling and supports background playback) */
    audioSchedulerWorkerFactory?: () => Worker;
}

export interface BmsPreviewState {
    /** Current status */
    status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';
    /** Loading progress (0-1) */
    loadProgress: number;
    /** Playback progress (0-1) */
    playProgress: number;
    /** Current playback time (seconds) */
    currentTime: number;
    /** Total playback duration (seconds) */
    duration: number;
    /** Playback mode */
    mode: 'preview-file' | 'bgm-channel' | null;
    /** Error message */
    error: string | null;
}

export interface BmsPreviewControls {
    /** Load the preview */
    load: () => Promise<void>;
    /** Play */
    play: () => void;
    /** Pause */
    pause: () => void;
    /** Stop (back to the beginning) */
    stop: () => void;
    /** Seek */
    seek: (time: number) => void;
    /** Adjust the volume */
    setVolume: (volume: number) => void;
    /** Release resources */
    dispose: () => void;
}

const DEFAULT_PREVIEW_PATHS = [
    'preview.ogg',
    'preview.mp3',
    'preview.wav',
];

/**
 * Filters only the notes on the BGM channel (01).
 */
function filterBgmNotes(notes: BMSNote[]): BMSNote[] {
    // Notes with an undefined column are the BGM channel (channel 01 has no column mapping)
    return notes.filter(note => note.column === undefined);
}

export function useBmsPreview(options: BmsPreviewOptions): [BmsPreviewState, BmsPreviewControls] {
    const {
        baseUrl,
        bmsPath,
        previewPaths = DEFAULT_PREVIEW_PATHS,
        volume: initialVolume = 0.8,
        onProgress,
        onError,
        workerFactory,
        resolve: resolveConfig,
    } = options;

    const [state, setState] = useState<BmsPreviewState>({
        status: 'idle',
        loadProgress: 0,
        playProgress: 0,
        currentTime: 0,
        duration: 0,
        mode: null,
        error: null,
    });

    // Refs for audio resources
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const preloaderRef = useRef<AudioPreloader | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const schedulerRef = useRef<number | null>(null);
    const volumeRef = useRef(initialVolume);
    const isPlayingRef = useRef(false);
    const durationRef = useRef(0);

    // BGM playback state
    const bgmDataRef = useRef<{
        notes: BMSNote[];
        timing: Timing;
        keysounds: KeySounds;
        startTime: number;
        currentIndex: number;
    } | null>(null);

    // Track current time in ref to avoid stale closure issues
    const currentTimeRef = useRef(0);

    // Worker-based audio scheduler (optional)
    const audioSchedulerRef = useRef<WorkerAudioScheduler | null>(null);
    const { audioSchedulerWorkerFactory } = options;

    /**
     * Checks whether a preview file exists.
     */
    const checkPreviewFile = useCallback(async (): Promise<string | null> => {
        for (const path of previewPaths) {
            try {
                // Use query parameter for files with special characters to avoid reverse proxy issues
                const hasSpecialChars = /[#[\]%]/.test(path);
                const url = hasSpecialChars
                    ? `${baseUrl}?path=${encodeURIComponent(path)}`
                    : `${baseUrl}/${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
                const response = await fetch(url, { method: 'HEAD' });
                if (response.ok) {
                    return url;
                }
            } catch {
                // File not found, check the next one
            }
        }
        return null;
    }, [baseUrl, previewPaths]);

    /**
     * Loads via the preview file.
     */
    const loadPreviewFile = useCallback(async (url: string) => {
        return new Promise<void>((resolve, reject) => {
            const audio = new Audio();
            audio.volume = volumeRef.current;
            audio.preload = 'auto';

            audio.onloadedmetadata = () => {
                setState(prev => ({
                    ...prev,
                    duration: audio.duration,
                    loadProgress: 1,
                    status: 'ready',
                    mode: 'preview-file',
                }));
                resolve();
            };

            audio.onerror = () => {
                reject(new Error('Failed to load preview audio'));
            };

            audio.ontimeupdate = () => {
                currentTimeRef.current = audio.currentTime;
                setState(prev => ({
                    ...prev,
                    currentTime: audio.currentTime,
                    playProgress: audio.duration > 0 ? audio.currentTime / audio.duration : 0,
                }));
            };

            audio.onended = () => {
                currentTimeRef.current = 0;
                setState(prev => ({ ...prev, status: 'ready', playProgress: 0, currentTime: 0 }));
            };

            audio.src = url;
            audioRef.current = audio;
        });
    }, []);

    /**
     * Loads via the BGM channel (BMS parsing + keysound loading).
     */
    const loadBgmChannel = useCallback(async () => {
        if (!bmsPath) {
            throw new Error('BMS path is required for BGM channel playback');
        }

        // 1. Parse the BMS file
        const parser = new BMSParser();
        // Use query parameter for files with special characters to avoid reverse proxy issues
        const hasSpecialChars = /[#[\]%]/.test(bmsPath);
        const bmsUrl = hasSpecialChars
            ? `${baseUrl}?path=${encodeURIComponent(bmsPath)}`
            : `${baseUrl}/${bmsPath.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
        const bmsContent = await parser.fetchFromUrl(bmsUrl);
        parser.compileString(bmsContent);

        const notes = parser.getNotes();
        const timing = parser.getTiming();
        const keysounds = parser.getKeySounds();

        if (!notes || !timing || !keysounds) {
            throw new Error('Failed to parse BMS file');
        }

        // 2. Filter only the BGM channel notes
        const bgmNotes = filterBgmNotes(notes.all());
        if (bgmNotes.length === 0) {
            throw new Error('No BGM notes found in BMS file');
        }

        // 3. Build the list of required keysound files
        const fileMap: FileMap = {};
        const usedKeysounds = new Set<string>();

        for (const note of bgmNotes) {
            if (note.keysound && !usedKeysounds.has(note.keysound)) {
                usedKeysounds.add(note.keysound);
                const filename = keysounds.get(note.keysound);
                if (filename) {
                    fileMap[note.keysound] = filename;
                }
            }
        }

        // 4. Stem-based file resolution (when the resolve config is present)
        let resolvedFileMap = fileMap;
        if (resolveConfig) {
            const resolveOptions: ResolveOptions = {
                slug: resolveConfig.slug,
                ref: resolveConfig.ref,
                dir: resolveConfig.dir,
            };
            const { resolved } = await resolveKeysoundFiles(
                Object.fromEntries(
                    Object.entries(fileMap).map(([id, filename]) => [id, filename])
                ),
                resolveOptions,
                resolveConfig.fetcher,
            );
            if (Object.keys(resolved).length > 0) {
                resolvedFileMap = resolved;
            }
        }

        // 5. Load the keysounds
        if (!workerFactory) {
            throw new Error('workerFactory is required for BGM channel playback');
        }
        workerRef.current = workerFactory();
        preloaderRef.current = new AudioPreloader(
            baseUrl,
            resolvedFileMap,
            workerRef.current,
            (type, payload) => {
                if (type === 'PROGRESS') {
                    const p = payload as { loadedCount: number; total: number };
                    const progress = p.total > 0 ? p.loadedCount / p.total : 0;
                    setState(prev => ({ ...prev, loadProgress: progress * 0.8 })); // Up to 80%
                    onProgress?.(progress * 0.8);
                }
            }
        );

        await preloaderRef.current.loadAll();
        setState(prev => ({ ...prev, loadProgress: 0.9 }));

        await preloaderRef.current.decodeAll();
        setState(prev => ({ ...prev, loadProgress: 0.95 }));

        await preloaderRef.current.initAudioWorklet();

        // 5. Compute the total playback duration
        const sortedNotes = [...bgmNotes].sort((a, b) => a.beat - b.beat);
        const lastNote = sortedNotes[sortedNotes.length - 1];
        const duration = timing.beatToSeconds(lastNote.beat) + 3; // Last note + 3 seconds of headroom

        // Store the BGM data
        bgmDataRef.current = {
            notes: sortedNotes,
            timing,
            keysounds,
            startTime: 0,
            currentIndex: 0,
        };

        // Worker-based scheduler (optional, for background playback)
        if (audioSchedulerWorkerFactory && preloaderRef.current) {
            audioSchedulerRef.current?.dispose();
            const schedulerNotes: SchedulerNote[] = sortedNotes
                .filter(n => n.keysound)
                .map(n => ({
                    sec: timing.beatToSeconds(n.beat),
                    keysound: keysounds.get(n.keysound)
                        ? n.keysound.toLowerCase()
                        : n.keysound.toLowerCase(),
                    offset: 0,
                    volume: volumeRef.current,
                }));
            const schedulerWorker = audioSchedulerWorkerFactory();
            audioSchedulerRef.current = new WorkerAudioScheduler({
                worker: schedulerWorker,
                preloader: preloaderRef.current,
                notes: schedulerNotes,
            });
            audioSchedulerRef.current.setOnTick((currentSec: number) => {
                currentTimeRef.current = currentSec;
                setState(prev => ({
                    ...prev,
                    currentTime: currentSec,
                    playProgress: durationRef.current > 0 ? Math.min(currentSec / durationRef.current, 1) : 0,
                }));
            });
            audioSchedulerRef.current.setOnEnd(() => {
                isPlayingRef.current = false;
                currentTimeRef.current = 0;
                setState(prev => ({
                    ...prev,
                    status: 'ready',
                    currentTime: 0,
                    playProgress: 0,
                }));
            });
        }

        durationRef.current = duration;
        setState(prev => ({
            ...prev,
            duration,
            loadProgress: 1,
            status: 'ready',
            mode: 'bgm-channel',
        }));
    }, [baseUrl, bmsPath, onProgress, workerFactory, resolveConfig]);

    /**
     * Load.
     */
    const load = useCallback(async () => {
        try {
            setState(prev => ({ ...prev, status: 'loading', loadProgress: 0, error: null }));

            // 1. Check for a preview file
            const previewUrl = await checkPreviewFile();

            if (previewUrl) {
                await loadPreviewFile(previewUrl);
            } else if (bmsPath) {
                await loadBgmChannel();
            } else {
                throw new Error('No preview file or BMS path available');
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setState(prev => ({ ...prev, status: 'error', error: err.message }));
            onError?.(err);
        }
    }, [checkPreviewFile, loadPreviewFile, loadBgmChannel, bmsPath, onError]);

    /**
     * BGM scheduler - plays keysounds according to timing.
     * Uses refs to avoid stale closure issues.
     */
    const runBgmScheduler = useCallback(() => {
        if (!bgmDataRef.current || !preloaderRef.current || !isPlayingRef.current) return;

        const { notes, timing, startTime } = bgmDataRef.current;
        const preloader = preloaderRef.current;
        const currentTime = (performance.now() - startTime) / 1000;
        const duration = durationRef.current;

        // Update ref for sync with other functions
        currentTimeRef.current = currentTime;

        // Play the notes due at the current time
        while (bgmDataRef.current.currentIndex < notes.length) {
            const note = notes[bgmDataRef.current.currentIndex];
            const noteTime = timing.beatToSeconds(note.beat);

            if (noteTime <= currentTime + 0.05) { // 50ms buffer
                if (note.keysound) {
                    // Use playAudioSync (plays immediately without async waiting)
                    preloader.playAudioSync(note.keysound);
                }
                bgmDataRef.current.currentIndex++;
            } else {
                break;
            }
        }

        // Update state
        setState(prev => ({
            ...prev,
            currentTime,
            playProgress: duration > 0 ? Math.min(currentTime / duration, 1) : 0,
        }));

        // End check
        if (currentTime >= duration) {
            // Change state directly instead of calling stop (avoids stale closure issues)
            isPlayingRef.current = false;
            currentTimeRef.current = 0;
            if (schedulerRef.current) {
                cancelAnimationFrame(schedulerRef.current);
                schedulerRef.current = null;
            }
            if (bgmDataRef.current) {
                bgmDataRef.current.currentIndex = 0;
                bgmDataRef.current.startTime = 0;
            }
            setState(prev => ({
                ...prev,
                status: 'ready',
                currentTime: 0,
                playProgress: 0,
            }));
            return;
        }

        // Schedule the next frame
        schedulerRef.current = requestAnimationFrame(runBgmScheduler);
    }, []);

    /**
     * Play.
     */
    const play = useCallback(() => {
        if (state.status !== 'ready' && state.status !== 'paused') return;

        if (state.mode === 'preview-file' && audioRef.current) {
            audioRef.current.play();
            setState(prev => ({ ...prev, status: 'playing' }));
        } else if (state.mode === 'bgm-channel' && bgmDataRef.current) {
            isPlayingRef.current = true;
            setState(prev => ({ ...prev, status: 'playing' }));

            if (audioSchedulerRef.current) {
                // Worker-based scheduling (background-safe)
                if (state.status === 'paused') {
                    audioSchedulerRef.current.resume(currentTimeRef.current, 1);
                } else {
                    audioSchedulerRef.current.play(currentTimeRef.current, 1);
                }
            } else {
                // Fallback: rAF-based scheduling
                bgmDataRef.current.startTime = performance.now() - (currentTimeRef.current * 1000);
                schedulerRef.current = requestAnimationFrame(runBgmScheduler);
            }
        }
    }, [state.status, state.mode, runBgmScheduler]);

    /**
     * Pause.
     */
    const pause = useCallback(() => {
        if (state.status !== 'playing') return;

        isPlayingRef.current = false;

        if (state.mode === 'preview-file' && audioRef.current) {
            audioRef.current.pause();
        } else if (state.mode === 'bgm-channel') {
            if (audioSchedulerRef.current) {
                audioSchedulerRef.current.pause();
            } else if (schedulerRef.current) {
                cancelAnimationFrame(schedulerRef.current);
                schedulerRef.current = null;
            }
        }

        setState(prev => ({ ...prev, status: 'paused' }));
    }, [state.status, state.mode]);

    /**
     * Stop.
     */
    const stop = useCallback(() => {
        isPlayingRef.current = false;
        currentTimeRef.current = 0;

        if (state.mode === 'preview-file' && audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        } else if (state.mode === 'bgm-channel') {
            if (audioSchedulerRef.current) {
                audioSchedulerRef.current.stop();
            } else {
                if (schedulerRef.current) {
                    cancelAnimationFrame(schedulerRef.current);
                    schedulerRef.current = null;
                }
                if (preloaderRef.current) {
                    preloaderRef.current.stopAllAudio();
                }
            }
            if (bgmDataRef.current) {
                bgmDataRef.current.currentIndex = 0;
                bgmDataRef.current.startTime = 0;
            }
        }

        setState(prev => ({
            ...prev,
            status: 'ready',
            currentTime: 0,
            playProgress: 0,
        }));
    }, [state.mode]);

    /**
     * Seek.
     */
    const seek = useCallback((time: number) => {
        const clampedTime = Math.max(0, Math.min(time, durationRef.current));

        // Update ref immediately to avoid stale closure issues
        currentTimeRef.current = clampedTime;

        if (state.mode === 'preview-file' && audioRef.current) {
            audioRef.current.currentTime = clampedTime;
        } else if (state.mode === 'bgm-channel' && bgmDataRef.current) {
            if (audioSchedulerRef.current) {
                // Worker-based seek
                audioSchedulerRef.current.seek(clampedTime, 1);
            } else {
                // Fallback: rAF-based seek
                const { notes, timing } = bgmDataRef.current;
                const wasPlaying = isPlayingRef.current;

                if (wasPlaying && schedulerRef.current) {
                    cancelAnimationFrame(schedulerRef.current);
                    schedulerRef.current = null;
                }

                if (preloaderRef.current) {
                    preloaderRef.current.stopAllAudio();
                }

                let newIndex = 0;
                for (let i = 0; i < notes.length; i++) {
                    if (timing.beatToSeconds(notes[i].beat) >= clampedTime) {
                        newIndex = i;
                        break;
                    }
                    newIndex = i + 1;
                }

                // Catch-up: play keysounds that started before clampedTime but are still audible
                if (preloaderRef.current) {
                    for (let i = newIndex - 1; i >= 0; i--) {
                        const note = notes[i];
                        if (!note.keysound) continue;
                        const noteTime = timing.beatToSeconds(note.beat);
                        const key = note.keysound.toLowerCase();
                        const duration = preloaderRef.current.getAudioDuration(key);
                        if (duration <= 0) continue;
                        const offset = clampedTime - noteTime;
                        if (offset < duration) {
                            preloaderRef.current.playAudioSync(key, false, true, offset);
                        }
                    }
                }

                bgmDataRef.current.currentIndex = newIndex;
                bgmDataRef.current.startTime = performance.now() - (clampedTime * 1000);

                if (wasPlaying) {
                    schedulerRef.current = requestAnimationFrame(runBgmScheduler);
                }
            }
        }

        setState(prev => ({
            ...prev,
            currentTime: clampedTime,
            playProgress: durationRef.current > 0 ? clampedTime / durationRef.current : 0,
        }));
    }, [state.mode, runBgmScheduler]);

    /**
     * Adjusts the volume.
     */
    const setVolume = useCallback((volume: number) => {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        volumeRef.current = clampedVolume;

        if (audioRef.current) {
            audioRef.current.volume = clampedVolume;
        }
        if (preloaderRef.current) {
            preloaderRef.current.setMasterVolume(clampedVolume);
        }
    }, []);

    /**
     * Releases resources.
     */
    const dispose = useCallback(() => {
        isPlayingRef.current = false;
        currentTimeRef.current = 0;

        if (audioSchedulerRef.current) {
            audioSchedulerRef.current.dispose();
            audioSchedulerRef.current = null;
        }
        if (schedulerRef.current) {
            cancelAnimationFrame(schedulerRef.current);
            schedulerRef.current = null;
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
            audioRef.current = null;
        }
        if (preloaderRef.current) {
            preloaderRef.current.releaseAllResources();
            preloaderRef.current = null;
        }
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }
        bgmDataRef.current = null;

        setState({
            status: 'idle',
            loadProgress: 0,
            playProgress: 0,
            currentTime: 0,
            duration: 0,
            mode: null,
            error: null,
        });
    }, []);

    // Cleanup on component unmount
    useEffect(() => {
        return () => {
            dispose();
        };
    }, [dispose]);

    const controls: BmsPreviewControls = useMemo(() => ({
        load,
        play,
        pause,
        stop,
        seek,
        setVolume,
        dispose,
    }), [load, play, pause, stop, seek, setVolume, dispose]);

    return [state, controls];
}
