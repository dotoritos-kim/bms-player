/**
 * UploadedBuffer.ts
 *
 * Main-thread stand-in for an AudioBuffer whose samples were moved into the
 * AudioWorklet. It keeps what the main thread still needs (duration, length,
 * channel count, a compact peak envelope for waveform views) so the decoded
 * PCM is not held twice — with thousands of keysounds that is gigabytes.
 */

/** Samples per peak value kept for waveform views (~2.7 ms at 48 kHz). */
export const PEAK_BLOCK = 128;

export class UploadedBuffer {
    readonly duration: number;
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    /** max |sample| of channel 0 per PEAK_BLOCK samples */
    readonly peaks: Float32Array;

    constructor(source: AudioBuffer) {
        this.duration = source.duration;
        this.length = source.length;
        this.numberOfChannels = source.numberOfChannels;
        this.sampleRate = source.sampleRate;
        const data = source.getChannelData(0);
        const peaks = new Float32Array(Math.ceil(data.length / PEAK_BLOCK));
        for (let p = 0; p < peaks.length; p++) {
            let max = 0;
            const end = Math.min(data.length, (p + 1) * PEAK_BLOCK);
            for (let i = p * PEAK_BLOCK; i < end; i++) {
                const a = Math.abs(data[i]);
                if (a > max) max = a;
            }
            peaks[p] = max;
        }
        this.peaks = peaks;
    }

    getChannelData(): Float32Array {
        throw new Error('[UploadedBuffer] sample data lives in the AudioWorklet');
    }
}

export function isUploadedBuffer(b: unknown): b is UploadedBuffer {
    return b instanceof UploadedBuffer;
}
