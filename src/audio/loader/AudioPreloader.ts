/**
 * AudioPreloader.ts — Facade (S9 refactor).
 *
 * The internal implementation is split into four classes; AudioPreloader
 * is a thin facade that wires them together.
 *
 *   AudioFetchPipeline  — Worker communication + IndexedDB cache lookup.
 *   AudioBufferStore    — LRU in-memory cache for decoded buffers.
 *   AudioDecoder        — wraps `decodeAudioData` with error fallback.
 *   EffectChain         — EQ/Compressor/Reverb/Stereo nodes.
 *   WorkletPlayback     — AudioWorkletNode init + playback messaging.
 *
 * **The externally-public API is unchanged from the previous version.**
 *
 * @example
 * ```typescript
 * const preloader = new AudioPreloader(baseUrl, fileMap, worker);
 * await preloader.loadAll();
 * await preloader.decodeAll();
 * await preloader.initAudioWorklet();
 * preloader.playAudio('key');
 * ```
 */

import type { FileMap } from './messages';
import { AudioBufferStore } from '../pipeline/AudioBufferStore';
import { AudioDecoder } from '../pipeline/AudioDecoder';
import { EffectChain } from '../pipeline/EffectChain';
import { WorkletPlayback } from '../pipeline/WorkletPlayback';
import { AudioFetchPipeline } from '../pipeline/AudioFetchPipeline';

// ---- Public re-exports (backward compatibility) ----
export type { FileMap } from './messages';
export { EQ_FREQUENCIES, EQ_PRESETS } from '../pipeline/EffectChain';
export type { EffectSettings } from '../pipeline/EffectChain';

export interface AudioPreloaderOptions {
    /** Decode files progressively while they download (default: true). */
    progressiveDecode?: boolean;
    /** Use the simplified effect chain (default: false). */
    simplifiedEffects?: boolean;
    /** Use the global in-memory cache (default: true). */
    useCache?: boolean;
    /** Use the persistent IndexedDB cache (default: true). */
    useIndexedDBCache?: boolean;
    /** AudioContext latencyHint. */
    latencyHint?: AudioContextLatencyCategory | number;
}

export type WorkerFactory = () => Worker;

export class AudioPreloader {
    // ---- Internal subsystems ----
    private readonly store: AudioBufferStore;
    private readonly decoder: AudioDecoder;
    private readonly effects: EffectChain;
    private readonly playback: WorkletPlayback;
    private readonly fetchPipeline: AudioFetchPipeline;

    private readonly audioContext: AudioContext;
    private readonly progressiveDecode: boolean;

    // Abort state
    private aborted = false;
    private _abortResolve: (() => void) | undefined;

    constructor(
        private readonly baseUrl: string,
        private readonly fileMap: FileMap,
        worker: Worker,
        private readonly onWorkerMessage?: (type: string, payload: unknown) => void,
        options?: AudioPreloaderOptions,
    ) {
        const useCache = options?.useCache ?? true;
        const useIndexedDBCache = options?.useIndexedDBCache ?? true;
        this.progressiveDecode = options?.progressiveDecode ?? true;

        this.audioContext = new AudioContext({
            latencyHint: options?.latencyHint ?? 'interactive',
        });

        // Subsystem initialisation
        this.store = new AudioBufferStore(baseUrl, useCache);
        this.decoder = new AudioDecoder(
            this.audioContext,
            this.store,
            () => this.aborted,
        );
        this.effects = new EffectChain(this.audioContext, options?.simplifiedEffects ?? false);
        this.playback = new WorkletPlayback(this.audioContext, this.store, this.effects);

        this.fetchPipeline = new AudioFetchPipeline(
            baseUrl,
            fileMap,
            worker,
            useIndexedDBCache,
            // Progressive-decode callback
            (key, buf) => {
                if (this.progressiveDecode) {
                    void this.decoder.decodeOne(key, buf);
                }
            },
            onWorkerMessage,
        );
    }

    // ---- Loading ----

    public async loadAll(): Promise<void> {
        await this.fetchPipeline.loadAll(() => this.aborted);
    }

    public async decodeAll(): Promise<void> {
        if (this.aborted) return;
        const abortPromise = new Promise<void>((resolve) => {
            this._abortResolve = resolve;
        });
        await this.decoder.decodeAll(this.fetchPipeline.audioDataMap.entries(), abortPromise);
        this._abortResolve = undefined;
    }

    public async loadAndInitParallel(workletUrl?: string, effectSettings?: import('../pipeline/EffectChain').EffectSettings): Promise<void> {
        const initPromise = this.initAudioWorklet(workletUrl, effectSettings);
        const loadPromise = this.loadAll();
        await Promise.all([initPromise, loadPromise]);

        if (!this.progressiveDecode) {
            await this.decodeAll();
        } else {
            await this.decoder.waitForAll(
                () => this.fetchPipeline.audioDataMap.size,
            );
        }
    }

    // ---- AudioWorklet initialisation ----

    public async initAudioWorklet(
        workletUrl?: string,
        effectSettings?: import('../pipeline/EffectChain').EffectSettings,
    ): Promise<void> {
        await this.playback.initWorklet(workletUrl, effectSettings);
    }

    // ---- Effects ----

    public applyEffectSettings(settings: import('../pipeline/EffectChain').EffectSettings): void {
        this.effects.apply(settings);
    }

    // EQ
    public setEqualizerEnabled(enabled: boolean): void { this.effects.setEqualizerEnabled(enabled); }
    public setEqualizerBand(bandIndex: number, gain: number): void { this.effects.setEqualizerBand(bandIndex, gain); }
    public setEqualizerPreset(preset: string): void { this.effects.setEqualizerPreset(preset); }
    public getEqualizerBands(): number[] { return this.effects.getEqualizerBands(); }

    // Compressor
    public setCompressorEnabled(enabled: boolean): void { this.effects.setCompressorEnabled(enabled); }
    public setCompressorSettings(threshold: number, ratio: number, attack: number, release: number): void {
        this.effects.setCompressorSettings(threshold, ratio, attack, release);
    }

    // Reverb
    public setReverbEnabled(enabled: boolean): void { this.effects.setReverbEnabled(enabled); }
    public setReverbMix(mix: number): void { this.effects.setReverbMix(mix); }
    public setReverbDecay(decay: number): void { this.effects.setReverbDecay(decay); }

    // Stereo
    public setStereoEnabled(enabled: boolean): void { this.effects.setStereoEnabled(enabled); }
    public setStereoWidth(width: number): void { this.effects.setStereoWidth(width); }

    // ---- Playback ----

    public async playAudio(key: string, loop = false, uniquePlay = true, offset = 0): Promise<string | null> {
        return this.playback.playAudio(key, loop, uniquePlay, offset);
    }

    public playAudioSync(
        key: string,
        loop = false,
        uniquePlay = true,
        offset = 0,
        scheduledTime = 0,
        volume = 1,
    ): string | null {
        return this.playback.playAudioSync(key, loop, uniquePlay, offset, scheduledTime, volume);
    }

    public stopAudio(trackId: string): void { this.playback.stopAudio(trackId); }
    public stopAllAudio(): void { this.playback.stopAllAudio(); }
    public clearAudio(trackId: string): void { this.playback.clearAudio(trackId); }
    public clearAllAudio(): void { this.playback.clearAllAudio(); }
    public setMasterVolume(volume: number): void { this.playback.setMasterVolume(volume); }
    public adjustVolume(trackId: string, volume: number): void { this.playback.adjustVolume(trackId, volume); }
    public setPlaybackRate(rate: number): void { this.playback.setPlaybackRate(rate); }

    // ---- Utilities ----

    public getAudioDuration(key: string): number {
        return this.store.get(key)?.duration ?? 0;
    }

    public hasAudioBuffer(key: string): boolean {
        return this.store.has(key);
    }

    public getWaveformData(key: string, samplesPerBeat = 32, bpm = 130): Float32Array | null {
        const buffer = this.store.get(key);
        if (!buffer) return null;
        const channelData = buffer.getChannelData(0);
        const durationSec = buffer.duration;
        const durationBeats = (durationSec * bpm) / 60;
        const totalSamples = Math.ceil(durationBeats * samplesPerBeat);
        if (totalSamples <= 0) return null;
        const result = new Float32Array(totalSamples);
        const samplesPerChunk = Math.floor(channelData.length / totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            const start = i * samplesPerChunk;
            const end = Math.min(start + samplesPerChunk, channelData.length);
            let maxAmp = 0;
            for (let j = start; j < end; j++) {
                const abs = Math.abs(channelData[j]);
                if (abs > maxAmp) maxAmp = abs;
            }
            result[i] = maxAmp;
        }
        return result;
    }

    // ---- Abort / Release ----

    public abort(): void {
        this.aborted = true;
        this._abortResolve?.();
        this._abortResolve = undefined;
        this.fetchPipeline.abort();
    }

    public releaseAllResources(): void {
        this.playback.dispose();
        this.effects.dispose();
        this.fetchPipeline.terminate();
        this.store.clear();

        if (this.audioContext.state !== 'closed') {
            void this.audioContext.close();
        }
    }

    // ---- Properties ----

    public get isWorkerDone(): boolean { return this.fetchPipeline.isWorkerDone; }
    public get progress(): number { return this.fetchPipeline.progress; }
    public get downloadedCount(): number { return this.fetchPipeline.downloaded; }
    public get downloadedTotal(): number { return this.fetchPipeline.total; }
    public get loaded(): boolean { return this.fetchPipeline.isWorkerDone; }
    public get context(): AudioContext { return this.audioContext; }
    public get stereoEnabled(): boolean { return this.effects.stereoEnabled; }
}
