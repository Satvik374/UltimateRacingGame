/**
 * sound.js
 * Web Audio synthesized engine sound + simple one-shot SFX.
 *
 * Rather than loading audio files (simpler deploy), we synthesize a
 * continuous engine sound using oscillators + a noise source, with
 * pitch/amplitude modulated by RPM.
 */

export class SoundSystem {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.engineNodes = null;
        this.enabled = false;
        this.volume = 0.6;
    }

    /**
     * Must be called from a user gesture (e.g. click) due to browser audio policy.
     */
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.volume;
            this.masterGain.connect(this.ctx.destination);

            this._setupEngine();
            this._setupAmbient();
            this.enabled = true;
        } catch (e) {
            console.warn('Audio init failed:', e);
        }
    }

    setVolume(v) {
        this.volume = v;
        if (this.masterGain) this.masterGain.gain.value = v;
    }

    _setupEngine() {
        const ctx = this.ctx;

        // Two sawtooth oscillators layered for richer tone
        const osc1 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = 80;

        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        osc2.frequency.value = 160;

        const osc3 = ctx.createOscillator();
        osc3.type = 'triangle';
        osc3.frequency.value = 240;

        // Pink noise for engine grit
        const noiseBufferSize = 2 * ctx.sampleRate;
        const noiseBuffer = ctx.createBuffer(1, noiseBufferSize, ctx.sampleRate);
        const out = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < noiseBufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
            b6 = white * 0.115926;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;

        // Filter for engine character
        const engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 800;
        engineFilter.Q.value = 2;

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 600;
        noiseFilter.Q.value = 1;

        // Individual gains
        const g1 = ctx.createGain(); g1.gain.value = 0.15;
        const g2 = ctx.createGain(); g2.gain.value = 0.1;
        const g3 = ctx.createGain(); g3.gain.value = 0.08;
        const gN = ctx.createGain(); gN.gain.value = 0.4;

        osc1.connect(g1); g1.connect(engineFilter);
        osc2.connect(g2); g2.connect(engineFilter);
        osc3.connect(g3); g3.connect(engineFilter);
        noise.connect(gN); gN.connect(noiseFilter);

        // Master engine gain
        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.0; // start silent, fade in based on RPM
        engineFilter.connect(engineGain);
        noiseFilter.connect(engineGain);
        engineGain.connect(this.masterGain);

        osc1.start();
        osc2.start();
        osc3.start();
        noise.start();

        this.engineNodes = {
            osc1, osc2, osc3, noise, engineGain, engineFilter, noiseFilter, gN,
        };
    }

    _setupAmbient() {
        // Ambient wind: filtered noise at low volume
        const ctx = this.ctx;
        const size = 2 * ctx.sampleRate;
        const buf = ctx.createBuffer(1, size, ctx.sampleRate);
        const out = buf.getChannelData(0);
        for (let i = 0; i < size; i++) {
            out[i] = (Math.random() * 2 - 1) * 0.5;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        filter.Q.value = 0.7;

        const g = ctx.createGain();
        g.gain.value = 0.0;

        src.connect(filter); filter.connect(g); g.connect(this.masterGain);
        src.start();
        this.windGain = g;
    }

    /**
     * Update engine sound based on car state.
     * @param {number} rpmRatio - 0..1
     * @param {number} speed - m/s
     * @param {boolean} boostActive
     */
    updateEngine(rpmRatio, speedMs, boostActive = false) {
        if (!this.enabled) return;
        const { osc1, osc2, osc3, engineGain, engineFilter, gN } = this.engineNodes;

        // Frequency: base 80Hz idle, scales by RPM up to ~400Hz
        const baseFreq = 60 + rpmRatio * 280;
        osc1.frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.08);
        osc2.frequency.setTargetAtTime(baseFreq * 2.02, this.ctx.currentTime, 0.08);
        osc3.frequency.setTargetAtTime(baseFreq * 3.01, this.ctx.currentTime, 0.08);

        // Engine filter brightness scales with RPM
        engineFilter.frequency.setTargetAtTime(400 + rpmRatio * 2500, this.ctx.currentTime, 0.1);

        // Engine gain scales with RPM too (more aggressive when revving high)
        let gain = 0.22 + rpmRatio * 0.45;
        if (boostActive) gain *= 1.25;
        engineGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);

        // More noise when boost / high RPM
        gN.gain.setTargetAtTime(0.3 + rpmRatio * 0.8 + (boostActive ? 0.5 : 0), this.ctx.currentTime, 0.1);

        // Wind noise scales with speed
        if (this.windGain) {
            const windVol = Math.min(0.25, Math.max(0, (speedMs - 10) / 80) * 0.3);
            this.windGain.gain.setTargetAtTime(windVol, this.ctx.currentTime, 0.15);
        }
    }

    /**
     * One-shot tire squeal (short noise burst)
     */
    playTireSqueal(intensity = 0.5) {
        if (!this.enabled) return;
        const ctx = this.ctx;
        const buf = ctx.createBuffer(1, 0.3 * ctx.sampleRate, ctx.sampleRate);
        const out = buf.getChannelData(0);
        for (let i = 0; i < out.length; i++) {
            out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (out.length * 0.4));
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1800 + Math.random() * 500;
        filter.Q.value = 5;
        const g = ctx.createGain();
        g.gain.value = intensity * 0.3;
        src.connect(filter); filter.connect(g); g.connect(this.masterGain);
        src.start();
    }

    /**
     * Collision sound (short metallic thud)
     */
    playCollision(intensity = 1.0) {
        if (!this.enabled) return;
        const ctx = this.ctx;
        const now = ctx.currentTime;

        // Low thud
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);

        const g = ctx.createGain();
        g.gain.setValueAtTime(intensity * 0.5, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        osc.connect(g); g.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.25);

        // Metal clang noise
        const buf = ctx.createBuffer(1, 0.15 * ctx.sampleRate, ctx.sampleRate);
        const out = buf.getChannelData(0);
        for (let i = 0; i < out.length; i++) {
            out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (out.length * 0.2));
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2000;
        const g2 = ctx.createGain();
        g2.gain.value = intensity * 0.4;
        src.connect(filter); filter.connect(g2); g2.connect(this.masterGain);
        src.start();
    }

    /**
     * Checkpoint / beep sound
     */
    playBeep(frequency = 880, duration = 0.1) {
        if (!this.enabled) return;
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.25, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.connect(g); g.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration);
    }

    playCountdown(isFinal = false) {
        if (!this.enabled) return;
        this.playBeep(isFinal ? 1320 : 660, 0.2);
    }
}
