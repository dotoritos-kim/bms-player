/**
 * WorkletPlayback.ts
 *
 * Dedicated to AudioWorkletNode initialization and play/stop messaging.
 * - initWorklet(): loads the AudioWorklet module, creates the AudioWorkletNode, and wires the EffectChain.
 * - playAudio / playAudioSync / stopAudio / stopAllAudio / clear / volume / rate
 */

import { AudioProcessorWorkletUrl } from '../loader/AudioProcessor.worklet';
import type { AudioProcessorPostMessage } from '../loader/types';
import type { AudioBufferStore } from './AudioBufferStore';
import { UploadedBuffer, isUploadedBuffer } from './UploadedBuffer';
import type { EffectChain, EffectSettings } from './EffectChain';

export interface PlayOptions {
    /** Voices sharing a choke group cut each other (BMS: re-triggering a WAV slot restarts it). */
    chokeGroup?: string;
    /** When the play arrives after `scheduledTime`, skip the elapsed part instead of starting late. */
    catchUp?: boolean;
}

export class WorkletPlayback {
    private audioWorkletNode: AudioWorkletNode | null = null;
    private trackIdCounter = 0;
    /** Buffer currently registered in the worklet per key. */
    private readonly registered = new Map<string, AudioBuffer>();

    constructor(
        private readonly ctx: AudioContext,
        private readonly store: AudioBufferStore,
        private readonly effects: EffectChain,
        /** Drop main-thread PCM once uploaded (keeps an UploadedBuffer stand-in). */
        private readonly releaseAfterUpload = false,
    ) {}

    async initWorklet(workletUrl?: string, effectSettings?: EffectSettings): Promise<void> {
        const url = workletUrl ?? AudioProcessorWorkletUrl;
        await this.ctx.audioWorklet.addModule(url);
        this.audioWorkletNode = new AudioWorkletNode(this.ctx, 'audio-worklet-processor');

        // Pass the source (worklet) to the EffectChain to build the nodes.
        this.effects.build(this.audioWorkletNode, effectSettings);

        this.registered.clear();
    }

    get isReady(): boolean {
        return this.audioWorkletNode !== null;
    }

    // ---- Playback (async) ----

    async playAudio(
        key: string,
        loop = false,
        uniquePlay = true,
        offset = 0,
    ): Promise<string | null> {
        if (!this.audioWorkletNode) {
            console.error('[WorkletPlayback] AudioWorkletNode not initialized.');
            return null;
        }
        const audioBuffer = this.store.get(key);
        if (!audioBuffer) {
            console.warn(`[WorkletPlayback] No AudioBuffer for key=${key}`);
            return null;
        }
        if (offset >= audioBuffer.duration) return null;

        if (this.ctx.state === 'suspended') await this.ctx.resume();

        return this._play(key, audioBuffer, loop, uniquePlay, offset, 0, 1);
    }

    // ---- Playback (sync, legacy compatible) ----

    playAudioSync(
        key: string,
        loop = false,
        uniquePlay = true,
        offset = 0,
        scheduledTime = 0,
        volume = 1,
        options?: PlayOptions,
    ): string | null {
        if (!this.audioWorkletNode) {
            console.warn('[WorkletPlayback] playAudioSync: AudioWorkletNode not initialized');
            return null;
        }
        const audioBuffer = this.store.get(key);
        if (!audioBuffer) return null;
        if (offset >= audioBuffer.duration) return null;

        if (this.ctx.state === 'suspended') void this.ctx.resume();

        return this._play(key, audioBuffer, loop, uniquePlay, offset, scheduledTime, volume, options);
    }

    /**
     * Uploads every decoded buffer to the worklet ahead of playback, yielding
     * between chunks so the UI stays responsive. Without this, the first play
     * of each key pays the copy cost on the spot.
     */
    async prime(keys: Iterable<string>, chunkBytes = 16 * 1024 * 1024): Promise<void> {
        let sent = 0;
        for (const key of keys) {
            if (!this.audioWorkletNode) return;
            const buffer = this.store.get(key);
            if (!buffer || this.registered.get(key) === buffer) continue;
            this._ensureRegistered(key, buffer);
            sent += buffer.length * buffer.numberOfChannels * 4;
            if (sent >= chunkBytes) {
                sent = 0;
                await new Promise<void>((r) => setTimeout(r, 0));
            }
        }
    }

    private _play(
        key: string,
        audioBuffer: AudioBuffer,
        loop: boolean,
        uniquePlay: boolean,
        offset: number,
        scheduledTime: number,
        volume: number,
        options?: PlayOptions,
    ): string {
        this._ensureRegistered(key, audioBuffer);
        const trackId = uniquePlay ? `${key}_${this.trackIdCounter++}` : key;
        this._post<AudioProcessorPostMessage>({
            type: 'play',
            key: trackId,
            data: {
                bufferKey: key,
                loop,
                offset,
                scheduledTime,
                volume,
                chokeGroup: options?.chokeGroup,
                catchUp: options?.catchUp,
            },
        });
        return trackId;
    }

    /**
     * Sends the sample data for `key` to the worklet once. Re-sends when the
     * store holds a different buffer for the key (e.g. a silent placeholder
     * later replaced by the real decode).
     */
    private _ensureRegistered(key: string, audioBuffer: AudioBuffer): void {
        if (this.registered.get(key) === audioBuffer) return;
        if (isUploadedBuffer(audioBuffer)) {
            // Already in the worklet (registered under this key earlier).
            this.registered.set(key, audioBuffer);
            return;
        }
        const left = audioBuffer.getChannelData(0).slice(0);
        const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1).slice(0) : undefined;
        this._post<AudioProcessorPostMessage>(
            { type: 'register', key, data: { bufferLeft: left, bufferRight: right } },
            { transfer: right ? [left.buffer, right.buffer] : [left.buffer] },
        );
        if (this.releaseAfterUpload) {
            // The worklet owns the samples now; keep only metadata + peaks here.
            const stub = new UploadedBuffer(audioBuffer) as unknown as AudioBuffer;
            this.store.replaceLocal(key, stub);
            this.registered.set(key, stub);
        } else {
            this.registered.set(key, audioBuffer);
        }
    }

    // ---- Control ----

    stopAudio(trackId: string): void {
        this._post({ type: 'stop', key: trackId, data: null });
    }

    stopAllAudio(): void {
        this._post({ type: 'stopAll', key: '', data: null });
    }

    clearAudio(trackId: string): void {
        this._post({ type: 'clear', key: trackId, data: null });
    }

    clearAllAudio(): void {
        this._post({ type: 'clearAll', key: '', data: null });
    }

    setMasterVolume(volume: number): void {
        this._post({ type: 'setVolume', key: '', data: Math.max(0, Math.min(1, volume)) });
    }

    adjustVolume(trackId: string, volume: number): void {
        this._post({ type: 'adjustVolume', key: trackId, data: Math.max(0, Math.min(1, volume)) });
    }

    setPlaybackRate(rate: number): void {
        this._post({ type: 'setPlaybackRate', key: '', data: Math.max(0.25, Math.min(4.0, rate)) });
    }

    // ---- Disposal ----

    dispose(): void {
        try {
            this.stopAllAudio();
            this.clearAllAudio();
            this._post({ type: 'unregisterAll', key: '', data: null });
        } catch {
            // Ignore an already-closed port.
        }
        try {
            this.audioWorkletNode?.disconnect();
        } catch {
            // Ignore.
        }
        this.audioWorkletNode = null;
        this.registered.clear();
    }

    // ---- Internal ----

    private _post<T>(message: T, options?: StructuredSerializeOptions): void {
        if (!this.audioWorkletNode) {
            console.error('[WorkletPlayback] AudioWorkletNode not initialized.');
            return;
        }
        this.audioWorkletNode.port.postMessage(message, options);
    }
}
