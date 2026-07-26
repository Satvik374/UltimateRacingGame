/**
 * postprocessing.js
 * Effect composer pipeline with bloom, radial motion blur, and SMAA anti-aliasing.
 * Supports runtime quality toggling.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Radial motion blur shader (zoom-blur from screen center).
// Cheap, and intensity scales with player speed for a strong "speed feel"
// especially during boost.
const RadialMotionBlurShader = {
    uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0.0 },   // 0..1 blur strength
        uSamples: { value: 10 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uStrength;
        varying vec2 vUv;

        void main() {
            vec2 center = vec2(0.5);
            vec2 dir = vUv - center;
            vec4 sum = vec4(0.0);
            float total = 0.0;
            const int SAMPLES = 10;
            for (int i = 0; i < SAMPLES; i++) {
                float t = float(i) / float(SAMPLES - 1);
                float scale = 1.0 - uStrength * 0.15 * t;
                vec2 sampleUv = center + dir * scale;
                float weight = 1.0 - t * 0.4;
                sum += texture2D(tDiffuse, sampleUv) * weight;
                total += weight;
            }
            gl_FragColor = sum / total;
        }
    `,
};

// Simple vignette + color grading shader for cinematic look
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: 0.45 },
        uBrightness: { value: 1.02 },
        uSaturation: { value: 1.08 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uVignette;
        uniform float uBrightness;
        uniform float uSaturation;
        varying vec2 vUv;

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            // Brightness
            color.rgb *= uBrightness;
            // Saturation
            float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            color.rgb = mix(vec3(luma), color.rgb, uSaturation);
            // Vignette
            vec2 coord = vUv - 0.5;
            float dist = length(coord);
            float vig = smoothstep(0.4, 0.9, dist) * uVignette;
            color.rgb *= (1.0 - vig);
            gl_FragColor = color;
        }
    `,
};

export class PostProcessing {
    constructor(renderer, scene, camera, opts = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.quality = opts.quality || 'medium';
        this.enabled = opts.enabled !== false;
        this.motionBlurEnabled = opts.motionBlur !== false;

        this.composer = new EffectComposer(renderer);
        this.composer.setSize(window.innerWidth, window.innerHeight);

        // Render pass
        this.renderPass = new RenderPass(scene, camera);
        this.composer.addPass(this.renderPass);

        // Bloom
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.5,    // strength
            0.7,    // radius
            0.82    // threshold
        );
        this.composer.addPass(this.bloomPass);

        // Radial motion blur
        this.motionBlurPass = new ShaderPass(RadialMotionBlurShader);
        this.motionBlurPass.uniforms.uStrength.value = 0.0;
        this.composer.addPass(this.motionBlurPass);

        // Vignette + color grading
        this.vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(this.vignettePass);

        // SMAA anti-aliasing
        const pixelRatio = Math.min(renderer.getPixelRatio(), 2);
        this.smaaPass = new SMAAPass(
            window.innerWidth * pixelRatio,
            window.innerHeight * pixelRatio
        );
        this.composer.addPass(this.smaaPass);

        // Output / tone mapping
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);

        this.applyQuality(this.quality);
    }

    /**
     * Set motion blur strength based on car speed.
     * @param {number} speedKmh - current speed
     * @param {boolean} boostActive
     */
    setMotionBlurFromSpeed(speedKmh, boostActive) {
        if (!this.motionBlurPass) return;
        const maxSpeed = 300;
        let t = Math.max(0, Math.min(1, (speedKmh - 80) / (maxSpeed - 80)));
        t = t * t; // quadratic ramp -- only kicks in at high speed
        let strength = t * 0.6;
        if (boostActive) strength += 0.2;
        this.motionBlurPass.uniforms.uStrength.value = strength;
    }

    /**
     * Apply a quality preset.
     * @param {'low'|'medium'|'high'|'ultra'} preset
     */
    applyQuality(preset) {
        this.quality = preset;
        switch (preset) {
            case 'low':
                this.bloomPass.enabled = false;
                this.motionBlurPass.enabled = false;
                this.vignettePass.enabled = true;
                this.smaaPass.enabled = false;
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 0.75, 1));
                break;
            case 'medium':
                this.bloomPass.enabled = true;
                this.bloomPass.strength = 0.35;
                this.bloomPass.radius = 0.55;
                this.motionBlurPass.enabled = this.motionBlurEnabled;
                this.vignettePass.enabled = true;
                this.smaaPass.enabled = true;
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
                break;
            case 'high':
                this.bloomPass.enabled = true;
                this.bloomPass.strength = 0.5;
                this.bloomPass.radius = 0.7;
                this.motionBlurPass.enabled = this.motionBlurEnabled;
                this.vignettePass.enabled = true;
                this.smaaPass.enabled = true;
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                break;
            case 'ultra':
                this.bloomPass.enabled = true;
                this.bloomPass.strength = 0.7;
                this.bloomPass.radius = 0.85;
                this.motionBlurPass.enabled = this.motionBlurEnabled;
                this.vignettePass.enabled = true;
                this.smaaPass.enabled = true;
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                break;
        }
    }

    setBloomEnabled(enabled) {
        this.bloomPass.enabled = enabled;
    }

    setMotionBlurEnabled(enabled) {
        this.motionBlurEnabled = enabled;
        this.motionBlurPass.enabled = enabled;
    }

    setSize(width, height) {
        this.composer.setSize(width, height);
    }

    /**
     * Render the frame using the composer.
     */
    render(dt) {
        if (!this.enabled) {
            this.renderer.render(this.scene, this.camera);
            return;
        }
        this.composer.render(dt);
    }
}
