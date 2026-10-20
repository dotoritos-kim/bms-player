/**
 * AudioProcessor.worklet.ts
 *
 * AudioWorklet processor - multi-track stereo audio playback.
 * AudioWorklet runs on a separate thread, so external imports are unavailable.
 * The type definitions are therefore inlined and the code is loaded through a Blob URL.
 *
 * v3:
 * - Buffer registry: sample data is registered once ('register') and every
 *   'play' references it by `bufferKey`, so dense charts no longer copy and
 *   transfer the whole sample on every note (main-thread stalls → late/dropped sounds).
 * - Choke groups: a voice started with `chokeGroup` fades out the previous voice
 *   of the same group (BMS semantics: re-triggering a WAV slot restarts it).
 * - Late-start compensation (`catchUp`): a play that arrives after its
 *   scheduled time skips the elapsed part instead of starting late.
 * - Peak limiter instead of hard clipping when many voices overlap.
 * - Short fade on stop to avoid clicks.
 */

// The AudioWorklet code, defined as a string.
export const workletCode = `
const FADE_SAMPLES = 128;        // ~3ms fade on stop / choke
const LIMIT_THRESHOLD = 0.98;    // output ceiling
const LIMIT_RELEASE_SEC = 0.15;  // limiter gain recovery time constant

class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Track management: Map<trackId, Track>.
        this.tracks = new Map();
        // Registered sample data: Map<bufferKey, { left, right }>.
        this.buffers = new Map();
        // Latest started voice per choke group: Map<group, Track>.
        this.groups = new Map();

        this.masterVolume = 0.5;
        this.playbackRate = 1.0; // Global playback rate.
        this.limiterGain = 1.0;
        this.limiterRelease = 1 - Math.exp(-1 / (LIMIT_RELEASE_SEC * sampleRate));

        this.port.onmessage = (e) => this.handleMessage(e.data);
    }

    handleMessage(msg) {
        const { type, key, data } = msg;
        switch (type) {
            case 'register':
                if (data && data.bufferLeft) {
                    this.buffers.set(key, {
                        left: data.bufferLeft,
                        right: data.bufferRight || data.bufferLeft,
                    });
                }
                break;

            case 'unregister':
                this.buffers.delete(key);
                break;

            case 'unregisterAll':
                this.buffers.clear();
                break;

            case 'play':
                this.startTrack(key, data);
                break;

            case 'stop': {
                const track = this.tracks.get(key);
                if (track) this.fadeOut(key, track);
                break;
            }

            case 'stopAll':
                for (const [k, track] of this.tracks) this.fadeOut(k, track);
                break;

            case 'clear':
                this.removeTrack(key);
                break;

            case 'clearAll':
                this.tracks.clear();
                this.groups.clear();
                break;

            case 'setVolume':
                if (typeof data === 'number') {
                    this.masterVolume = Math.max(0, Math.min(1, data));
                }
                break;

            case 'adjustVolume': {
                const track = this.tracks.get(key);
                if (track && typeof data === 'number') {
                    track.volume = Math.max(0, Math.min(1, data));
                }
                break;
            }

            case 'setPlaybackRate':
                if (typeof data === 'number') {
                    this.playbackRate = Math.max(0.25, Math.min(4.0, data));
                }
                break;
        }
    }

    startTrack(key, data) {
        if (!data) return;
        let leftData, rightData;
        if (data.bufferKey) {
            const buf = this.buffers.get(data.bufferKey);
            if (!buf) return;
            leftData = buf.left;
            rightData = buf.right;
        } else if (data.bufferLeft) {
            leftData = data.bufferLeft;
            rightData = data.bufferRight || leftData;
        } else if (data.buffer) {
            leftData = data.buffer;
            rightData = leftData;
        } else {
            return;
        }

        // offset (seconds) → sample index. sampleRate/currentTime come from the
        // AudioWorkletGlobalScope (buffers are decoded at the context rate).
        let startIndex = (data.offset || 0) * sampleRate;
        let delaySamples = 0;
        if (data.scheduledTime > 0) {
            const diff = data.scheduledTime - currentTime;
            if (diff >= 0) {
                delaySamples = Math.round(diff * sampleRate);
            } else if (data.catchUp) {
                // Arrived late: skip what should already have been heard.
                startIndex += -diff * sampleRate * this.playbackRate;
            }
        }
        if (startIndex >= leftData.length - 1) return;

        // Replacing an existing id (uniquePlay=false) drops the old voice.
        this.removeTrack(key);

        this.tracks.set(key, {
            leftData,
            rightData,
            readIndex: startIndex,
            loop: data.loop || false,
            // #VOLWAV / per-track volume (0-1, default 1.0). 0 is a valid volume.
            volume: typeof data.volume === 'number' ? Math.max(0, Math.min(1, data.volume)) : 1.0,
            delaySamples,
            started: false,
            done: false,
            fade: -1,
            chokeGroup: data.chokeGroup || null,
        });
    }

    fadeOut(key, track) {
        if (!track.started) {
            // Not audible yet — just drop it.
            this.removeTrack(key);
        } else if (track.fade < 0) {
            track.fade = FADE_SAMPLES;
        }
    }

    removeTrack(key) {
        const track = this.tracks.get(key);
        if (!track) return;
        this.tracks.delete(key);
        if (track.chokeGroup && this.groups.get(track.chokeGroup) === track) {
            this.groups.delete(track.chokeGroup);
        }
    }

    onTrackStart(track) {
        track.started = true;
        const group = track.chokeGroup;
        if (!group) return;
        const prev = this.groups.get(group);
        if (prev && prev !== track && !prev.done && prev.fade < 0) {
            prev.fade = FADE_SAMPLES;
        }
        this.groups.set(group, track);
    }

    process(inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const left = output[0];
        const stereoOut = output.length > 1;
        const right = stereoOut ? output[1] : left;
        const blockSize = left.length;
        const rate = this.playbackRate;

        left.fill(0);
        if (stereoOut) right.fill(0);

        for (const [trackKey, track] of this.tracks) {
            let i = 0;
            if (track.delaySamples > 0) {
                if (track.delaySamples >= blockSize) {
                    track.delaySamples -= blockSize;
                    continue;
                }
                i = track.delaySamples;
                track.delaySamples = 0;
            }
            if (!track.started) this.onTrackStart(track);

            const L = track.leftData;
            const R = track.rightData;
            const len = L.length;
            const vol = track.volume;

            for (; i < blockSize; i++) {
                if (track.readIndex >= len - 1) {
                    if (track.loop) {
                        track.readIndex = 0;
                    } else {
                        track.done = true;
                        break;
                    }
                }
                let g = vol;
                if (track.fade >= 0) {
                    if (track.fade === 0) {
                        track.done = true;
                        break;
                    }
                    g *= track.fade / FADE_SAMPLES;
                    track.fade--;
                }

                // Linear interpolation (supports rate change). readIndex < len - 1 here.
                const idx = Math.floor(track.readIndex);
                const frac = track.readIndex - idx;
                const l0 = L[idx];
                const ls = l0 + (L[idx + 1] - l0) * frac;
                if (stereoOut) {
                    left[i] += ls * g;
                    if (R === L) {
                        right[i] += ls * g;
                    } else {
                        const r0 = R[idx];
                        right[i] += (r0 + (R[idx + 1] - r0) * frac) * g;
                    }
                } else {
                    left[i] += ls * g;
                }

                // Advance the index by playbackRate (1.5x advances by 1.5).
                track.readIndex += rate;
            }

            if (track.done) this.removeTrack(trackKey);
        }

        // Master volume + peak limiter (instant attack, smooth release), then a
        // final clamp as a safety net. Avoids the harsh hard-clip distortion
        // when many keysounds overlap.
        const mv = this.masterVolume;
        const rel = this.limiterRelease;
        let gain = this.limiterGain;
        for (let i = 0; i < blockSize; i++) {
            const l = left[i] * mv;
            const r = stereoOut ? right[i] * mv : l;
            const peak = Math.max(Math.abs(l), Math.abs(r));
            const target = peak > LIMIT_THRESHOLD ? LIMIT_THRESHOLD / peak : 1;
            if (target < gain) gain = target;
            else gain += (target - gain) * rel;
            left[i] = Math.max(-1, Math.min(1, l * gain));
            if (stereoOut) right[i] = Math.max(-1, Math.min(1, r * gain));
        }
        this.limiterGain = gain;

        return true;
    }
}

registerProcessor('audio-worklet-processor', AudioProcessor);
`;

// Create the Blob URL (guarded so the module can be imported in test environments).
export const AudioProcessorWorkletUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined'
        ? URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }))
        : '';

export default AudioProcessorWorkletUrl;
