/**
 * WorkletPlayback.ts
 *
 * AudioWorkletNode 초기화 및 재생/정지 메시지 전담.
 * - initWorklet() : AudioWorklet 모듈 로드 + AudioWorkletNode 생성 + EffectChain 연결
 * - playAudio / playAudioSync / stopAudio / stopAllAudio / clear / volume / rate
 */

import { AudioProcessorWorkletUrl } from '../loader/AudioProcessor.worklet';
import type { AudioProcessorPostMessage } from '../loader/types';
import type { AudioBufferStore } from './AudioBufferStore';
import type { EffectChain, EffectSettings } from './EffectChain';

export class WorkletPlayback {
    private audioWorkletNode: AudioWorkletNode | null = null;
    private trackIdCounter = 0;

    constructor(
        private readonly ctx: AudioContext,
        private readonly store: AudioBufferStore,
        private readonly effects: EffectChain,
    ) {}

    async initWorklet(workletUrl?: string, effectSettings?: EffectSettings): Promise<void> {
        const url = workletUrl ?? AudioProcessorWorkletUrl;
        await this.ctx.audioWorklet.addModule(url);
        this.audioWorkletNode = new AudioWorkletNode(this.ctx, 'audio-worklet-processor');

        // EffectChain 에 source(worklet) 를 전달해서 노드 빌드
        this.effects.build(this.audioWorkletNode, effectSettings);

        this.audioWorkletNode.port.onmessage = (event) => {
            const { type, key, data } = event.data;
            if (type === 'latencyReport') {
                console.log(`[Latency Report] Track=${key}, Latency=${data?.latency ?? 'Unknown'}`);
            }
        };
    }

    get isReady(): boolean {
        return this.audioWorkletNode !== null;
    }

    // ---- 재생 (async) ----

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

        const { trackId, leftData, rightData, transferList, isStereo } =
            this._preparePlayData(key, audioBuffer, uniquePlay);

        this._post<AudioProcessorPostMessage>(
            { type: 'play', key: trackId, data: { bufferLeft: leftData, bufferRight: rightData, loop, offset } },
            { transfer: transferList },
        );
        return trackId;
    }

    // ---- 재생 (동기, 기존 호환) ----

    playAudioSync(
        key: string,
        loop = false,
        uniquePlay = true,
        offset = 0,
        scheduledTime = 0,
        volume = 1,
    ): string | null {
        if (!this.audioWorkletNode) {
            console.warn('[WorkletPlayback] playAudioSync: AudioWorkletNode not initialized');
            return null;
        }
        const audioBuffer = this.store.get(key);
        if (!audioBuffer) return null;
        if (offset >= audioBuffer.duration) return null;

        if (this.ctx.state === 'suspended') void this.ctx.resume();

        const { trackId, leftData, rightData, transferList, isStereo } =
            this._preparePlayData(key, audioBuffer, uniquePlay);

        this._post<AudioProcessorPostMessage>(
            { type: 'play', key: trackId, data: { bufferLeft: leftData, bufferRight: rightData, loop, offset, scheduledTime, volume } },
            { transfer: transferList },
        );
        return trackId;
    }

    private _preparePlayData(
        key: string,
        audioBuffer: AudioBuffer,
        uniquePlay: boolean,
    ): { trackId: string; leftData: Float32Array; rightData: Float32Array; transferList: ArrayBuffer[]; isStereo: boolean } {
        const leftData = audioBuffer.getChannelData(0).slice(0);
        const isStereo = audioBuffer.numberOfChannels > 1;
        const rightData = isStereo ? audioBuffer.getChannelData(1).slice(0) : leftData;
        const trackId = uniquePlay ? `${key}_${this.trackIdCounter++}` : key;
        const transferList: ArrayBuffer[] = isStereo
            ? [leftData.buffer, rightData.buffer]
            : [leftData.buffer];
        return { trackId, leftData, rightData, transferList, isStereo };
    }

    // ---- 제어 ----

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

    // ---- 해제 ----

    dispose(): void {
        try {
            this.stopAllAudio();
            this.clearAllAudio();
        } catch {
            // 이미 닫힌 포트 무시
        }
        try {
            this.audioWorkletNode?.disconnect();
        } catch {
            // 무시
        }
        this.audioWorkletNode = null;
    }

    // ---- 내부 ----

    private _post<T>(message: T, options?: StructuredSerializeOptions): void {
        if (!this.audioWorkletNode) {
            console.error('[WorkletPlayback] AudioWorkletNode not initialized.');
            return;
        }
        this.audioWorkletNode.port.postMessage(message, options);
    }
}
