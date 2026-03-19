/**
 * BmsPreviewPlayer Component
 *
 * BMS 미리듣기 재생을 위한 UI 컴포넌트
 */

import { useEffect, useCallback, useRef } from 'react';
import { useBmsPreview, BmsPreviewOptions } from './useBmsPreview';
import { cn } from '../utils/cn';

// Simple inline SVG icon components (replaces lucide-react dependency)
const IconPlay = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><polygon points="5,3 19,12 5,21" /></svg>
);
const IconPause = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
);
const IconSquare = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16"><rect x="3" y="3" width="18" height="18" /></svg>
);
const IconVolume = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
);
const IconVolumeMute = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
);
const IconLoader = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>
);
const IconAlert = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
);
const IconMusic = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
);

export interface BmsPreviewPlayerProps extends Omit<BmsPreviewOptions, 'onProgress' | 'onError'> {
    /** 자동 로드 여부 */
    autoLoad?: boolean;
    /** 컴팩트 모드 (작은 플레이어) */
    compact?: boolean;
    /** 추가 클래스명 */
    className?: string;
}

/**
 * 시간을 MM:SS 형식으로 포맷
 */
function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function BmsPreviewPlayer({
    baseUrl,
    bmsPath,
    previewPaths,
    volume = 0.8,
    autoLoad = false,
    compact = false,
    className,
}: BmsPreviewPlayerProps) {
    const [state, controls] = useBmsPreview({
        baseUrl,
        bmsPath,
        previewPaths,
        volume,
    });

    const pendingPlayRef = useRef(false);

    // 자동 로드
    useEffect(() => {
        if (autoLoad && state.status === 'idle') {
            controls.load();
        }
    }, [autoLoad, state.status, controls]);

    // Auto-play when load completes (triggered by handlePlayPause)
    useEffect(() => {
        if (pendingPlayRef.current && state.status === 'ready') {
            pendingPlayRef.current = false;
            controls.play();
        }
    }, [state.status, controls]);

    const handlePlayPause = useCallback(() => {
        if (state.status === 'idle') {
            pendingPlayRef.current = true;
            controls.load();
        } else if (state.status === 'playing') {
            controls.pause();
        } else if (state.status === 'ready' || state.status === 'paused') {
            controls.play();
        }
    }, [state.status, controls]);

    const handleProgressClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (state.status === 'idle' || state.status === 'loading') return;

            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = x / rect.width;
            const time = percentage * state.duration;
            controls.seek(time);
        },
        [state.status, state.duration, controls]
    );

    // 컴팩트 모드
    if (compact) {
        return (
            <div
                className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50',
                    className
                )}
            >
                <button
                    onClick={handlePlayPause}
                    disabled={state.status === 'loading' || state.status === 'error'}
                    className="p-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {state.status === 'loading' ? (
                        <IconLoader className="w-4 h-4 animate-spin" />
                    ) : state.status === 'playing' ? (
                        <IconPause className="w-4 h-4" />
                    ) : (
                        <IconPlay className="w-4 h-4 ml-0.5" />
                    )}
                </button>

                <div className="flex-1 min-w-0">
                    <div
                        className="h-1 bg-muted rounded-full cursor-pointer overflow-hidden"
                        onClick={handleProgressClick}
                    >
                        <div
                            className="h-full bg-primary transition-all duration-100"
                            style={{ width: `${state.playProgress * 100}%` }}
                        />
                    </div>
                </div>

                <span className="text-xs text-muted-foreground tabular-nums">
                    {formatTime(state.currentTime)}
                </span>
            </div>
        );
    }

    // 풀 플레이어
    return (
        <div
            className={cn(
                'rounded-xl border bg-card p-4 shadow-sm',
                className
            )}
        >
            {/* 헤더 */}
            <div className="flex items-center gap-2 mb-3">
                <IconMusic className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Preview</span>
                {state.mode && (
                    <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
                        {state.mode === 'preview-file' ? 'Audio File' : 'BGM Channel'}
                    </span>
                )}
            </div>

            {/* 에러 상태 */}
            {state.status === 'error' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-3">
                    <IconAlert className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{state.error || 'Failed to load preview'}</span>
                </div>
            )}

            {/* 로딩 진행률 */}
            {state.status === 'loading' && (
                <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Loading...</span>
                        <span>{Math.round(state.loadProgress * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-200"
                            style={{ width: `${state.loadProgress * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* 재생 진행률 */}
            <div className="mb-3">
                <div
                    className="h-2 bg-muted rounded-full cursor-pointer overflow-hidden group"
                    onClick={handleProgressClick}
                >
                    <div
                        className={cn(
                            'h-full bg-primary transition-all duration-100',
                            state.status === 'idle' || state.status === 'loading'
                                ? 'opacity-50'
                                : ''
                        )}
                        style={{ width: `${state.playProgress * 100}%` }}
                    />
                </div>
                <div className="flex justify-between mt-1 text-xs text-muted-foreground tabular-nums">
                    <span>{formatTime(state.currentTime)}</span>
                    <span>{formatTime(state.duration)}</span>
                </div>
            </div>

            {/* 컨트롤 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {/* 재생/일시정지 버튼 */}
                    <button
                        onClick={handlePlayPause}
                        disabled={state.status === 'loading' || state.status === 'error'}
                        className="p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {state.status === 'loading' ? (
                            <IconLoader className="w-5 h-5 animate-spin" />
                        ) : state.status === 'playing' ? (
                            <IconPause className="w-5 h-5" />
                        ) : (
                            <IconPlay className="w-5 h-5 ml-0.5" />
                        )}
                    </button>

                    {/* 정지 버튼 */}
                    <button
                        onClick={controls.stop}
                        disabled={
                            state.status === 'idle' ||
                            state.status === 'loading' ||
                            state.status === 'error'
                        }
                        className="p-2 rounded-full hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <IconSquare className="w-4 h-4" />
                    </button>
                </div>

                {/* 볼륨 컨트롤 */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => controls.setVolume(volume > 0 ? 0 : 0.8)}
                        className="p-2 rounded-full hover:bg-muted transition-colors"
                    >
                        {volume > 0 ? (
                            <IconVolume className="w-4 h-4" />
                        ) : (
                            <IconVolumeMute className="w-4 h-4" />
                        )}
                    </button>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        defaultValue={volume}
                        onChange={(e) => controls.setVolume(parseFloat(e.target.value))}
                        className="w-20 h-1 accent-primary cursor-pointer"
                    />
                </div>
            </div>
        </div>
    );
}
