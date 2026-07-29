/**
 * AudioProcessor.worklet.ts
 *
 * AudioWorklet processor - multi-track stereo audio playback.
 * AudioWorklet runs on a separate thread, so external imports are unavailable.
 * The type definitions are therefore inlined and the code is loaded through a Blob URL.
 *
 * v2: stereo support, concurrent playback, simplified effects.
 */

// The AudioWorklet code, defined as a string.
const workletCode = `
/**
 * Stereo track structure.
 * - leftData, rightData: Float32Array for each channel.
 * - readIndex: current read position (fractional - used for interpolation).
 * - isPlaying: whether the track is playing.
 * - loop: whether the track loops.
 * - volume: per-track volume (0-1).
 */
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Track management: Map<trackId, Track>.
        this.tracks = new Map();
        this.masterVolume = 0.5;
        this.playbackRate = 1.0; // Global playback rate.

        // Per-track volume: Map<trackId, number>.
        this.trackVolumes = new Map();

        // Counter used to clean up completed tracks.
        this.cleanupCounter = 0;

        this.port.onmessage = (e) => {
            const { type, key, data } = e.data;
            switch (type) {
                case 'play':
                    if (data && (data.buffer || data.bufferLeft)) {
                        // Handle stereo or mono data.
                        // Sent as Transferable Objects, so it already arrives as Float32Array (no copy needed).
                        let leftData, rightData;

                        if (data.bufferLeft && data.bufferRight) {
                            // Stereo: already delivered as Float32Array.
                            leftData = data.bufferLeft;
                            rightData = data.bufferRight;
                        } else if (data.buffer) {
                            // Mono: same data on both channels.
                            leftData = data.buffer;
                            rightData = leftData;
                        } else {
                            break;
                        }

                        // offset support: convert the offset in seconds to a sample index.
                        // sampleRate is provided by the AudioWorkletGlobalScope.
                        const offsetSeconds = data.offset || 0;
                        const startIndex = offsetSeconds * sampleRate;

                        // Do not play when the offset exceeds the data length.
                        if (startIndex >= leftData.length) {
                            break;
                        }

                        // scheduledTime support: compute the exact playback point in AudioContext time.
                        let delaySamples = 0;
                        if (data.scheduledTime > 0) {
                            delaySamples = Math.max(0, Math.round((data.scheduledTime - currentTime) * sampleRate));
                        }

                        this.tracks.set(key, {
                            leftData,
                            rightData,
                            readIndex: startIndex, // Start from the offset.
                            isPlaying: true,
                            loop: data.loop || false,
                            delaySamples,
                        });
                        // Apply the #VOLWAV volume (0-1, default 1.0).
                        const trackVol = typeof data.volume === 'number' ? Math.max(0, Math.min(1, data.volume)) : 1.0;
                        this.trackVolumes.set(key, trackVol);
                    }
                    break;

                case 'stop':
                    if (this.tracks.has(key)) {
                        this.tracks.get(key).isPlaying = false;
                    }
                    break;

                case 'stopAll':
                    for (const track of this.tracks.values()) {
                        track.isPlaying = false;
                    }
                    break;

                case 'clear':
                    this.tracks.delete(key);
                    this.trackVolumes.delete(key);
                    break;

                case 'clearAll':
                    this.tracks.clear();
                    this.trackVolumes.clear();
                    break;

                case 'setVolume':
                    if (typeof data === 'number') {
                        this.masterVolume = Math.max(0, Math.min(1, data));
                    }
                    break;

                case 'adjustVolume':
                    if (typeof data === 'number' && this.trackVolumes.has(key)) {
                        this.trackVolumes.set(key, Math.max(0, Math.min(1, data)));
                    }
                    break;

                case 'setPlaybackRate':
                    if (typeof data === 'number') {
                        this.playbackRate = Math.max(0.25, Math.min(4.0, data));
                    }
                    break;
            }
        };
    }

    // Linear interpolation helper (for rate-adjusted playback).
    interpolate(data, index) {
        const idx0 = Math.floor(index);
        const idx1 = idx0 + 1;
        const frac = index - idx0;

        if (idx1 >= data.length) {
            return data[idx0] || 0;
        }

        // Linear interpolation: (1-frac)*data[idx0] + frac*data[idx1]
        return data[idx0] * (1 - frac) + data[idx1] * frac;
    }

    process(inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const left = output[0];
        const right = output[1] || left;
        const blockSize = left.length;
        const rate = this.playbackRate;

        // Clear the output buffer.
        for (let i = 0; i < blockSize; i++) {
            left[i] = 0;
            right[i] = 0;
        }

        // Tracks that have finished.
        const completedTracks = [];

        // Process each track.
        for (const [trackKey, track] of this.tracks.entries()) {
            if (!track.isPlaying) {
                completedTracks.push(trackKey);
                continue;
            }

            const trackVolume = this.trackVolumes.get(trackKey) || 1.0;
            const dataLength = track.leftData.length;

            for (let i = 0; i < blockSize; i++) {
                // Scheduled delay: skip while playback has not started yet.
                if (track.delaySamples > 0) {
                    track.delaySamples--;
                    continue;
                }

                if (track.readIndex >= dataLength - 1) {
                    if (track.loop) {
                        track.readIndex = 0;
                    } else {
                        track.isPlaying = false;
                        completedTracks.push(trackKey);
                        break;
                    }
                }

                // Read samples with linear interpolation (supports rate change).
                const leftSample = this.interpolate(track.leftData, track.readIndex);
                const rightSample = this.interpolate(track.rightData, track.readIndex);

                left[i] += leftSample * trackVolume;
                right[i] += rightSample * trackVolume;

                // Advance the index by playbackRate (1.5x advances by 1.5).
                track.readIndex += rate;
            }
        }

        // Apply master volume and prevent clipping.
        for (let i = 0; i < blockSize; i++) {
            left[i] = Math.max(-1, Math.min(1, left[i] * this.masterVolume));
            right[i] = Math.max(-1, Math.min(1, right[i] * this.masterVolume));
        }

        // Periodically clean up completed tracks (every 100 blocks).
        this.cleanupCounter++;
        if (this.cleanupCounter >= 100) {
            this.cleanupCounter = 0;
            for (const trackKey of completedTracks) {
                this.tracks.delete(trackKey);
                this.trackVolumes.delete(trackKey);
            }
        }

        return true;
    }
}

registerProcessor('audio-worklet-processor', AudioProcessor);
`;

// Create the Blob URL.
const blob = new Blob([workletCode], { type: 'application/javascript' });
export const AudioProcessorWorkletUrl = URL.createObjectURL(blob);

export default AudioProcessorWorkletUrl;
