/**
 * useBmsPreview Hook
 *
 * 하이브리드 방식의 BMS 미리듣기 재생 훅
 * 1. preview.ogg/mp3가 존재하면 단순 재생
 * 2. 없으면 BGM 채널 키음을 실시간 재생
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
    /** BMS 파일이 위치한 디렉토리 경로 */
    dir: string;
    /** 오디오 파일 매핑을 가져오는 fetcher */
    fetcher: AudioFileMapFetcher;
}

export interface BmsPreviewOptions {
    /** 파일들이 위치한 기본 URL */
    baseUrl: string;
    /** BMS 파일 경로 (baseUrl 기준 상대 경로) */
    bmsPath?: string;
    /** 미리듣기 파일 경로들 (우선순위 순) */
    previewPaths?: string[];
    /** 볼륨 (0-1) */
    volume?: number;
    /** 진행 상황 콜백 */
    onProgress?: (progress: number) => void;
    /** 에러 콜백 */
    onError?: (error: Error) => void;
    /**
     * Worker factory function for AudioLoader.
     * Consumers must provide this since Worker instantiation is bundler-specific.
     */
    workerFactory?: () => Worker;
    /** stem 기반 파일 해석 설정 (없으면 원본 파일명 사용) */
    resolve?: BmsPreviewResolveConfig;
    /** Audio scheduler Worker factory (제공 시 Worker 기반 스케줄링, 백그라운드 재생 지원) */
    audioSchedulerWorkerFactory?: () => Worker;
}

export interface BmsPreviewState {
    /** 현재 상태 */
    status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';
    /** 로딩 진행률 (0-1) */
    loadProgress: number;
    /** 재생 진행률 (0-1) */
    playProgress: number;
    /** 현재 재생 시간 (초) */
    currentTime: number;
    /** 총 재생 시간 (초) */
    duration: number;
    /** 재생 모드 */
    mode: 'preview-file' | 'bgm-channel' | null;
    /** 에러 메시지 */
    error: string | null;
}

export interface BmsPreviewControls {
    /** 미리듣기 로드 */
    load: () => Promise<void>;
    /** 재생 */
    play: () => void;
    /** 일시정지 */
    pause: () => void;
    /** 정지 (처음으로) */
    stop: () => void;
    /** 시간 이동 */
    seek: (time: number) => void;
    /** 볼륨 조절 */
    setVolume: (volume: number) => void;
    /** 리소스 해제 */
    dispose: () => void;
}

const DEFAULT_PREVIEW_PATHS = [
    'preview.ogg',
    'preview.mp3',
    'preview.wav',
];

/**
 * BGM 채널(01)의 노트만 필터링
 */
function filterBgmNotes(notes: BMSNote[]): BMSNote[] {
    // column이 undefined인 것이 BGM 채널 (채널 01은 column 매핑이 없음)
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
     * 미리듣기 파일 존재 여부 확인
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
                // 파일 없음, 다음 확인
            }
        }
        return null;
    }, [baseUrl, previewPaths]);

    /**
     * 미리듣기 파일로 로드
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
     * BGM 채널로 로드 (BMS 파싱 + 키음 로드)
     */
    const loadBgmChannel = useCallback(async () => {
        if (!bmsPath) {
            throw new Error('BMS path is required for BGM channel playback');
        }

        // 1. BMS 파일 파싱
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

        // 2. BGM 채널 노트만 필터링
        const bgmNotes = filterBgmNotes(notes.all());
        if (bgmNotes.length === 0) {
            throw new Error('No BGM notes found in BMS file');
        }

        // 3. 필요한 키음 파일 목록 생성
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

        // 4. stem 기반 파일 해석 (resolve 설정이 있는 경우)
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

        // 5. 키음 로드
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
                    setState(prev => ({ ...prev, loadProgress: progress * 0.8 })); // 80%까지
                    onProgress?.(progress * 0.8);
                }
            }
        );

        await preloaderRef.current.loadAll();
        setState(prev => ({ ...prev, loadProgress: 0.9 }));

        await preloaderRef.current.decodeAll();
        setState(prev => ({ ...prev, loadProgress: 0.95 }));

        await preloaderRef.current.initAudioWorklet();

        // 5. 총 재생 시간 계산
        const sortedNotes = [...bgmNotes].sort((a, b) => a.beat - b.beat);
        const lastNote = sortedNotes[sortedNotes.length - 1];
        const duration = timing.beatToSeconds(lastNote.beat) + 3; // 마지막 노트 + 3초 여유

        // BGM 데이터 저장
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
     * 로드
     */
    const load = useCallback(async () => {
        try {
            setState(prev => ({ ...prev, status: 'loading', loadProgress: 0, error: null }));

            // 1. 미리듣기 파일 확인
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
     * BGM 스케줄러 - 타이밍에 맞춰 키음 재생
     * ref를 사용하여 클로저 문제 방지
     */
    const runBgmScheduler = useCallback(() => {
        if (!bgmDataRef.current || !preloaderRef.current || !isPlayingRef.current) return;

        const { notes, timing, startTime } = bgmDataRef.current;
        const preloader = preloaderRef.current;
        const currentTime = (performance.now() - startTime) / 1000;
        const duration = durationRef.current;

        // Update ref for sync with other functions
        currentTimeRef.current = currentTime;

        // 현재 시간에 해당하는 노트들 재생
        while (bgmDataRef.current.currentIndex < notes.length) {
            const note = notes[bgmDataRef.current.currentIndex];
            const noteTime = timing.beatToSeconds(note.beat);

            if (noteTime <= currentTime + 0.05) { // 50ms 버퍼
                if (note.keysound) {
                    // playAudioSync 사용 (비동기 대기 없이 즉시 재생)
                    preloader.playAudioSync(note.keysound);
                }
                bgmDataRef.current.currentIndex++;
            } else {
                break;
            }
        }

        // 상태 업데이트
        setState(prev => ({
            ...prev,
            currentTime,
            playProgress: duration > 0 ? Math.min(currentTime / duration, 1) : 0,
        }));

        // 종료 체크
        if (currentTime >= duration) {
            // stop 호출 대신 직접 상태 변경 (클로저 문제 방지)
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

        // 다음 프레임 예약
        schedulerRef.current = requestAnimationFrame(runBgmScheduler);
    }, []);

    /**
     * 재생
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
     * 일시정지
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
     * 정지
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
     * 시간 이동
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
     * 볼륨 조절
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
     * 리소스 해제
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

    // 컴포넌트 언마운트 시 정리
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
