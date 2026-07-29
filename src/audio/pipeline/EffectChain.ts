/**
 * EffectChain.ts
 *
 * Dedicated to creating, wiring, and controlling Web Audio API effect nodes (EQ/Compressor/Reverb/Stereo).
 *
 * Layout:
 *   source → [EQ*10] → Compressor → [ReverbDry+ReverbWet→Mixer] → StereoPanner → MasterGain → destination
 *
 * Simplified mode (simplified=true) connects only MasterGain → destination.
 */

export const EQ_FREQUENCIES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_PRESETS: Record<string, number[]> = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'bass-boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    'treble-boost': [0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
    vocal: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2],
    electronic: [4, 3, 0, -2, -1, 0, 2, 4, 3, 4],
    rock: [4, 3, 1, 0, -1, 0, 1, 3, 4, 3],
    pop: [-1, 0, 2, 3, 2, 0, -1, 1, 2, 1],
    jazz: [2, 1, 0, 1, -1, 0, 1, 2, 3, 2],
};

export interface EffectSettings {
    equalizer?: {
        enabled: boolean;
        bands: number[]; // Gains for the 10 bands (-12 to +12 dB).
    };
    compressor?: {
        enabled: boolean;
        threshold: number;
        ratio: number;
        attack: number;
        release: number;
    };
    reverb?: {
        enabled: boolean;
        mix: number;
        decay: number;
    };
    stereo?: {
        enabled: boolean;
        width: number;
    };
}

export class EffectChain {
    // EQ
    private equalizerNodes: BiquadFilterNode[] = [];
    private equalizerEnabled = false;

    // Compressor
    private compressorNode: DynamicsCompressorNode | null = null;
    private compressorEnabled = false;

    // Reverb
    private reverbConvolverNode: ConvolverNode | null = null;
    private reverbDryGain: GainNode | null = null;
    private reverbWetGain: GainNode | null = null;
    private reverbMixerNode: GainNode | null = null;
    private reverbEnabled = false;
    private impulseCache = new Map<number, AudioBuffer>();
    private currentReverbDecay = 1.5;

    // Stereo
    private stereoEnhancerNode: StereoPannerNode | null = null;
    private _stereoEnabled = false;

    // Master
    private masterGainNode: GainNode | null = null;

    constructor(
        private readonly ctx: AudioContext,
        private readonly simplified: boolean,
    ) {}

    /**
     * Creates the nodes and connects them to the source (called at initAudioWorklet time).
     */
    build(source: AudioNode, initialSettings?: EffectSettings): void {
        if (this.simplified) {
            this.buildSimplified(source);
        } else {
            this.buildFull(source);
            if (initialSettings) this.apply(initialSettings);
        }
    }

    private buildSimplified(source: AudioNode): void {
        this.masterGainNode = this.ctx.createGain();
        this.masterGainNode.gain.value = 1;
        source.connect(this.masterGainNode);
        this.masterGainNode.connect(this.ctx.destination);
    }

    private buildFull(source: AudioNode): void {
        const ctx = this.ctx;

        // 1. EQ (10 bands).
        this.equalizerNodes = EQ_FREQUENCIES.map((freq, idx) => {
            const f = ctx.createBiquadFilter();
            if (idx === 0) f.type = 'lowshelf';
            else if (idx === EQ_FREQUENCIES.length - 1) f.type = 'highshelf';
            else { f.type = 'peaking'; f.Q.value = 1.4; }
            f.frequency.value = freq;
            f.gain.value = 0;
            return f;
        });

        // 2. Compressor
        this.compressorNode = ctx.createDynamicsCompressor();
        this.compressorNode.threshold.value = -24;
        this.compressorNode.ratio.value = 4;
        this.compressorNode.attack.value = 0.003;
        this.compressorNode.release.value = 0.25;

        // 3. Reverb
        this.reverbConvolverNode = ctx.createConvolver();
        this.reverbDryGain = ctx.createGain();
        this.reverbWetGain = ctx.createGain();
        this.reverbMixerNode = ctx.createGain();
        this.reverbDryGain.gain.value = 1;
        this.reverbWetGain.gain.value = 0;
        this._createImpulse(1.5);

        // 4. Stereo
        this.stereoEnhancerNode = ctx.createStereoPanner();
        this.stereoEnhancerNode.pan.value = 0;

        // 5. MasterGain
        this.masterGainNode = ctx.createGain();
        this.masterGainNode.gain.value = 1;

        // --- Wiring ---
        source.disconnect();
        let cur: AudioNode = source;

        for (const eq of this.equalizerNodes) { cur.connect(eq); cur = eq; }
        cur.connect(this.compressorNode); cur = this.compressorNode;

        // Reverb dry/wet split.
        cur.connect(this.reverbDryGain);
        this.reverbDryGain.connect(this.reverbMixerNode);
        cur.connect(this.reverbConvolverNode);
        this.reverbConvolverNode.connect(this.reverbWetGain);
        this.reverbWetGain.connect(this.reverbMixerNode);
        cur = this.reverbMixerNode;

        cur.connect(this.stereoEnhancerNode); cur = this.stereoEnhancerNode;
        cur.connect(this.masterGainNode);
        this.masterGainNode.connect(ctx.destination);
    }

    private _createImpulse(decay: number): void {
        if (decay === this.currentReverbDecay && this.reverbConvolverNode?.buffer) return;
        let impulse = this.impulseCache.get(decay);
        if (!impulse) {
            const { sampleRate } = this.ctx;
            const length = Math.floor(sampleRate * decay);
            impulse = this.ctx.createBuffer(2, length, sampleRate);
            for (let ch = 0; ch < 2; ch++) {
                const d = impulse.getChannelData(ch);
                for (let i = 0; i < length; i++) {
                    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
                }
            }
            if (this.impulseCache.size >= 5) {
                const oldest = this.impulseCache.keys().next().value;
                if (oldest !== undefined) this.impulseCache.delete(oldest);
            }
            this.impulseCache.set(decay, impulse);
        }
        if (this.reverbConvolverNode) {
            this.reverbConvolverNode.buffer = impulse;
            this.currentReverbDecay = decay;
        }
    }

    // ---- Bulk apply ----

    apply(settings: EffectSettings): void {
        if (settings.equalizer) {
            this.setEqualizerEnabled(settings.equalizer.enabled);
            settings.equalizer.bands?.forEach((g, i) => this.setEqualizerBand(i, g));
        }
        if (settings.compressor) {
            this.setCompressorEnabled(settings.compressor.enabled);
            this.setCompressorSettings(
                settings.compressor.threshold,
                settings.compressor.ratio,
                settings.compressor.attack,
                settings.compressor.release,
            );
        }
        if (settings.reverb) {
            this.setReverbEnabled(settings.reverb.enabled);
            this.setReverbMix(settings.reverb.mix);
            this.setReverbDecay(settings.reverb.decay);
        }
        if (settings.stereo) {
            this.setStereoEnabled(settings.stereo.enabled);
            this.setStereoWidth(settings.stereo.width);
        }
    }

    // ---- EQ ----

    setEqualizerEnabled(enabled: boolean): void {
        this.equalizerEnabled = enabled;
        if (!enabled) this.equalizerNodes.forEach((n) => (n.gain.value = 0));
    }

    setEqualizerBand(idx: number, gain: number): void {
        if (idx < 0 || idx >= this.equalizerNodes.length) return;
        const g = Math.max(-12, Math.min(12, gain));
        this.equalizerNodes[idx].gain.value = this.equalizerEnabled ? g : 0;
    }

    setEqualizerPreset(preset: string): void {
        const gains = EQ_PRESETS[preset];
        if (!gains) return;
        gains.forEach((g, i) => this.setEqualizerBand(i, g));
    }

    getEqualizerBands(): number[] {
        return this.equalizerNodes.map((n) => n.gain.value);
    }

    // ---- Compressor ----

    setCompressorEnabled(enabled: boolean): void {
        this.compressorEnabled = enabled;
        if (this.compressorNode) this.compressorNode.ratio.value = enabled ? 4 : 1;
    }

    setCompressorSettings(threshold: number, ratio: number, attack: number, release: number): void {
        if (!this.compressorNode) return;
        this.compressorNode.threshold.value = Math.max(-100, Math.min(0, threshold));
        this.compressorNode.ratio.value = this.compressorEnabled ? Math.max(1, Math.min(20, ratio)) : 1;
        this.compressorNode.attack.value = Math.max(0, Math.min(1, attack));
        this.compressorNode.release.value = Math.max(0, Math.min(1, release));
    }

    // ---- Reverb ----

    setReverbEnabled(enabled: boolean): void {
        this.reverbEnabled = enabled;
        if (this.reverbDryGain && this.reverbWetGain) {
            this.reverbWetGain.gain.value = enabled ? (this.reverbWetGain.gain.value || 0.3) : 0;
            this.reverbDryGain.gain.value = enabled ? 1 - this.reverbWetGain.gain.value : 1;
        }
    }

    setReverbMix(mix: number): void {
        if (!this.reverbDryGain || !this.reverbWetGain) return;
        const m = Math.max(0, Math.min(1, mix));
        if (this.reverbEnabled) {
            this.reverbWetGain.gain.value = m;
            this.reverbDryGain.gain.value = 1 - m;
        }
    }

    setReverbDecay(decay: number): void {
        this._createImpulse(Math.max(0.1, Math.min(10, decay)));
    }

    // ---- Stereo ----

    setStereoEnabled(enabled: boolean): void {
        this._stereoEnabled = enabled;
        if (this.stereoEnhancerNode) this.stereoEnhancerNode.pan.value = 0;
    }

    setStereoWidth(_width: number): void {
        if (this.stereoEnhancerNode) this.stereoEnhancerNode.pan.value = 0;
    }

    get stereoEnabled(): boolean {
        return this._stereoEnabled;
    }

    // ---- Disposal ----

    dispose(): void {
        try {
            this.equalizerNodes.forEach((n) => n.disconnect());
            this.equalizerNodes = [];
            this.compressorNode?.disconnect(); this.compressorNode = null;
            this.reverbConvolverNode?.disconnect(); this.reverbConvolverNode = null;
            this.reverbDryGain?.disconnect(); this.reverbDryGain = null;
            this.reverbWetGain?.disconnect(); this.reverbWetGain = null;
            this.reverbMixerNode?.disconnect(); this.reverbMixerNode = null;
            this.stereoEnhancerNode?.disconnect(); this.stereoEnhancerNode = null;
            this.masterGainNode?.disconnect(); this.masterGainNode = null;
        } catch {
            // Ignore an already-closed context.
        }
    }
}
