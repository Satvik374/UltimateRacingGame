/**
 * game.js
 * Main game class: scene, renderer, lighting, update loop, state machine.
 */

import * as THREE from 'three';

import { Car } from './car.js';
import { Track } from './track.js';
import { Environment } from './environment.js';
import { CarCamera } from './camera.js';
import { Controls } from './controls.js';
import { AIDriver } from './ai.js';
import { UI, formatTime } from './ui.js';
import { SoundSystem } from './sound.js';
import { PostProcessing } from './postprocessing.js';

// Game states
const STATE = {
    LOADING: 'loading',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    PAUSED: 'paused',
    FINISHED: 'finished',
};

const TOTAL_LAPS_RACE = 3;
const AI_CARS_COUNT = 4;

export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.state = STATE.LOADING;
        this.mode = 'race';    // 'race' or 'freeroam'
        this.settings = {
            quality: 'medium',
            shadows: true,
            postfx: true,
            motionBlur: true,
            volume: 0.6,
        };
        this.carColor = 0xf1c40f;

        // Timing
        this.raceStartTime = 0;
        this.currentLap = 1;
        this.totalLaps = TOTAL_LAPS_RACE;
        this.lapStartTime = 0;
        this.currentLapMs = 0;
        this.bestLapMs = 0;
        this.finishTime = 0;
        this.lapTimes = [];

        // Checkpoint tracking
        this.visitedCheckpoints = new Set();
        this.lastCheckpointT = 0;

        // Countdown
        this.countdownValue = 0;
        this.countdownStartTime = 0;

        // AI / race positions
        this.allCars = [];
        this.aiDrivers = [];
        this.raceFinishedForPlayer = false;

        // Hooks for UI (external callbacks)
        this.onRaceFinish = null;
        this.onPauseRequested = null;

        // Track progress tracking for each car (for lap counting and positions)
        this.carLapInfo = new Map(); // car -> { laps, lastT, visited: Set }

        // Store last safe position for reset (player only)
        this.lastSafePos = null;
        this.lastSafeHeading = 0;
        this.lastSafeTime = 0;
    }

    /**
     * Initialize the whole game. Call once before start.
     */
    async init(onProgress) {
        const progress = onProgress || (() => {});

        progress(0.05, 'Creating renderer...');
        this._setupRenderer();

        progress(0.15, 'Setting up scene...');
        this._setupScene();
        this._setupLights();

        progress(0.3, 'Building race track...');
        this.track = new Track(this.scene);

        progress(0.5, 'Building environment...');
        this.environment = new Environment(this.scene, this.track);

        progress(0.7, 'Creating cars...');
        this._setupCars();

        progress(0.82, 'Setting up camera...');
        this._setupCamera();

        progress(0.88, 'Preparing controls...');
        this.controls = new Controls();

        progress(0.91, 'Initializing UI...');
        this.ui = new UI(this.track);

        progress(0.95, 'Post-processing...');
        this.postFx = new PostProcessing(this.renderer, this.scene, this.camera, {
            quality: this.settings.quality,
            motionBlur: this.settings.motionBlur,
        });

        progress(0.97, 'Setting up audio...');
        this.sound = new SoundSystem();

        // Event listeners
        window.addEventListener('resize', this._onResize.bind(this));

        progress(1.0, 'Ready!');

        // Timing vars
        this.lastFrameTime = performance.now();
        this.fps = 60;
    }

    _setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: false, // we use SMAA pass instead
            powerPreference: 'high-performance',
            stencil: false,
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = this.settings.shadows;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    _setupScene() {
        this.scene = new THREE.Scene();

        // Fog for distance falloff (matches sky bottom color)
        this.scene.fog = new THREE.Fog(0xc6e3ff, 300, 1200);
        this.scene.background = new THREE.Color(0xc6e3ff);

        // Camera
        this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 2500);
        this.camera.position.set(0, 10, 20);
    }

    _setupLights() {
        // Ambient hemisphere light (sky + ground)
        const hemi = new THREE.HemisphereLight(0xbfdfff, 0x6b5a40, 0.55);
        this.scene.add(hemi);

        // Directional sun light
        const sun = new THREE.DirectionalLight(0xfff0d6, 1.8);
        sun.position.set(-200, 300, 150);
        sun.castShadow = this.settings.shadows;

        // Shadow config
        const d = 120;
        sun.shadow.camera.left = -d;
        sun.shadow.camera.right = d;
        sun.shadow.camera.top = d;
        sun.shadow.camera.bottom = -d;
        sun.shadow.camera.near = 50;
        sun.shadow.camera.far = 600;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 0.02;

        this.scene.add(sun);
        this.sun = sun;

        // Soft fill light from opposite side
        const fill = new THREE.DirectionalLight(0x99ccff, 0.4);
        fill.position.set(100, 80, -150);
        this.scene.add(fill);

        // Env map for reflections (simple)
        const pmremGen = new THREE.PMREMGenerator(this.renderer);
        const envScene = new THREE.Scene();
        envScene.background = new THREE.Color(0xc6e3ff);
        const envTexture = pmremGen.fromScene(envScene, 0.04).texture;
        this.scene.environment = envTexture;
        pmremGen.dispose();
    }

    _setupCars() {
        // Player car
        this.playerCar = new Car({
            color: this.carColor,
            isPlayer: true,
            castShadows: true,
        });
        this.scene.add(this.playerCar.group);
        this.allCars.push(this.playerCar);
        this.carLapInfo.set(this.playerCar, { laps: 0, lastT: 0, visited: new Set() });

        // AI cars (different colors)
        const aiColors = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0xff6b35];
        for (let i = 0; i < AI_CARS_COUNT; i++) {
            const color = aiColors[i % aiColors.length];
            const aiCar = new Car({
                color,
                isPlayer: false,
                castShadows: true,
            });
            this.scene.add(aiCar.group);

            const ai = new AIDriver(aiCar, this.track, {
                skill: 0.55 + i * 0.08,
                lateralBias: (i % 2 === 0 ? -0.5 : 0.5) * (0.6 + Math.random() * 0.5),
            });
            this.aiDrivers.push(ai);
            this.allCars.push(aiCar);
            this.carLapInfo.set(aiCar, { laps: 0, lastT: 0, visited: new Set() });
        }
    }

    _setupCamera() {
        this.carCamera = new CarCamera(this.camera, this.playerCar);
    }

    _onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        if (this.postFx) this.postFx.setSize(w, h);
    }

    /**
     * Start a new session with the chosen mode.
     * @param {'race'|'freeroam'} mode
     * @param {number|string} carColor
     */
    start(mode, carColor) {
        this.mode = mode;
        if (carColor) {
            this.carColor = carColor;
            this.playerCar.setColor(carColor);
        }

        // Reset all cars to grid
        this._resetGridPositions();

        // Reset timing
        this.currentLap = 1;
        this.lapStartTime = 0;
        this.currentLapMs = 0;
        this.lapTimes = [];
        this.raceFinishedForPlayer = false;
        this.raceStartTime = 0;
        this.finishTime = 0;
        this.visitedCheckpoints.clear();
        this.lastCheckpointT = 0;
        for (const info of this.carLapInfo.values()) {
            info.laps = 0;
            info.lastT = 0;
            info.visited.clear();
        }

        // Load best time
        this.bestLapMs = this._loadBestTime(mode);

        // Configure UI for mode
        if (mode === 'race') {
            this.totalLaps = TOTAL_LAPS_RACE;
            this.ui.setRaceMode(this.totalLaps, true);
        } else {
            this.totalLaps = 99;
            this.ui.setRaceMode(this.totalLaps, false);
        }
        this.ui.setVisible(true);

        // Snap camera to car
        this.carCamera.setMode('chase');
        this.carCamera.snapToCar();

        // Initialize sound
        if (!this.sound.enabled) this.sound.init();
        this.sound.setVolume(this.settings.volume);

        // Start countdown for race mode, skip for freeroam
        if (mode === 'race') {
            this._startCountdown();
        } else {
            // Free roam: immediately playing
            this.state = STATE.PLAYING;
            this.lapStartTime = performance.now();
            this.raceStartTime = performance.now();
        }
    }

    _resetGridPositions() {
        // Player goes in pole position
        if (this.track.spawnPoints.length > 0) {
            this.playerCar.resetTo(
                this.track.spawnPoints[0].position,
                this.track.spawnPoints[0].heading,
            );
        }
        // AI cars take remaining spawns
        for (let i = 0; i < this.aiDrivers.length; i++) {
            const spawn = this.track.spawnPoints[i + 1] || this.track.spawnPoints[0];
            this.aiDrivers[i].initAtT(0);
            // Override with actual spawn
            this.aiDrivers[i].car.resetTo(spawn.position, spawn.heading);
        }
        this.lastSafePos = this.playerCar.position.clone();
        this.lastSafeHeading = this.playerCar.heading;
    }

    _startCountdown() {
        this.state = STATE.COUNTDOWN;
        this.countdownStartTime = performance.now();
        this.countdownValue = 4; // so the first tick will show "3"
        this.controls.setEnabled(false);
    }

    _updateCountdown() {
        const elapsed = (performance.now() - this.countdownStartTime) / 1000;
        const value = Math.max(0, 3 - Math.floor(elapsed));

        if (value !== this.countdownValue) {
            this.countdownValue = value;
            if (value > 0) {
                this.ui.showCountdown(String(value));
                this.sound.playCountdown(false);
            } else {
                this.ui.showCountdown('GO!');
                this.sound.playCountdown(true);
                setTimeout(() => this.ui.hideCountdown(), 600);
            }
        }

        if (elapsed >= 3.2) {
            this.ui.hideCountdown();
            this.state = STATE.PLAYING;
            this.controls.setEnabled(true);
            this.raceStartTime = performance.now();
            this.lapStartTime = performance.now();
        }
    }

    /**
     * Update track progress + lap counting for a car.
     */
    _updateTrackProgress(car, isPlayer) {
        const info = this.carLapInfo.get(car);
        const t = this.track.getTrackProgress(car.position);

        // Detect wrap-around (crossing t=0)
        const prevT = info.lastT;
        info.lastT = t;

        // Find checkpoint that matches current t (must visit all in order)
        const checkpoints = this.track.checkpoints;
        const checkpointThreshold = 1 / checkpoints.length / 2; // must be within half a segment

        for (const cp of checkpoints) {
            const dist = Math.min(Math.abs(cp.t - t), 1 - Math.abs(cp.t - t));
            if (dist < 0.02) {
                if (!info.visited.has(cp.index)) {
                    info.visited.add(cp.index);
                    if (isPlayer && cp.index > 0) {
                        this.ui.showNotification(`CP ${cp.index}/${checkpoints.length - 1}`, 700);
                        this.sound.playBeep(660 + cp.index * 80, 0.08);
                    }
                    // Update safe position for reset
                    if (isPlayer) {
                        this.lastSafePos = car.position.clone();
                        this.lastSafeHeading = car.heading;
                    }
                }
            }
        }

        // Lap detection: crossing t=0 with visited majority of checkpoints
        const justCrossedFinish = (prevT > 0.9 && t < 0.1);
        if (justCrossedFinish) {
            const requiredCheckpoints = Math.max(1, checkpoints.length - 2); // a bit forgiving
            if (info.visited.size >= requiredCheckpoints) {
                // Valid lap
                info.laps++;
                info.visited.clear();

                if (isPlayer) {
                    const now = performance.now();
                    const lapMs = now - this.lapStartTime;
                    this.lapStartTime = now;
                    this.lapTimes.push(lapMs);
                    this.currentLap++;
                    this.currentLapMs = 0;

                    // Best time
                    if (lapMs < this.bestLapMs || this.bestLapMs <= 0) {
                        this.bestLapMs = lapMs;
                        this._saveBestTime(this.mode, lapMs);
                        this.ui.showNotification('NEW BEST! ' + formatTime(lapMs), 2000);
                        this.sound.playBeep(1320, 0.3);
                    } else {
                        this.ui.showNotification(
                            this.mode === 'race' ? `LAP ${this.currentLap}/${this.totalLaps}` : `LAP ${info.laps} ${formatTime(lapMs)}`,
                            1500
                        );
                        this.sound.playBeep(880, 0.15);
                    }

                    // Check race finish
                    if (this.mode === 'race' && info.laps >= this.totalLaps) {
                        this._finishRace();
                    }
                }
            }
        }
    }

    _finishRace() {
        if (this.raceFinishedForPlayer) return;
        this.raceFinishedForPlayer = true;
        this.finishTime = performance.now();

        // Determine position
        const finalPos = this._computeRacePosition(this.playerCar);
        const totalTime = this.finishTime - this.raceStartTime;

        this.state = STATE.FINISHED;
        this.controls.setEnabled(false);

        if (this.onRaceFinish) {
            this.onRaceFinish({
                position: finalPos,
                totalCars: this.allCars.length,
                lapTimes: this.lapTimes.slice(),
                bestLap: this.bestLapMs,
                totalTime,
            });
        }
    }

    _computeRacePosition(targetCar) {
        // Sort cars by (laps desc, t desc)
        const sorted = [...this.allCars].sort((a, b) => {
            const ia = this.carLapInfo.get(a);
            const ib = this.carLapInfo.get(b);
            if (ib.laps !== ia.laps) return ib.laps - ia.laps;
            return ib.lastT - ia.lastT;
        });
        return sorted.indexOf(targetCar) + 1;
    }

    _checkBarrierCollisions() {
        // Use the Track's distance-from-centerline collision method.
        const playerHit = this.track.checkBarrierCollision(this.playerCar);
        if (playerHit) {
            this.carCamera.shake(0.3, 0.2);
            // Rate-limit collision sound to avoid spam
            if (!this._lastCollisionTime || performance.now() - this._lastCollisionTime > 180) {
                if (this.sound) this.sound.playCollision(Math.min(1, Math.abs(this.playerCar.speed) / 40));
                this._lastCollisionTime = performance.now();
            }
        }

        // Also check AI cars
        for (const ai of this.aiDrivers) {
            this.track.checkBarrierCollision(ai.car);
        }
    }

    _checkCarToCarCollisions() {
        // Simple circle-based collision between all cars
        const radius = 2.2;
        const cars = this.allCars;
        for (let i = 0; i < cars.length; i++) {
            for (let j = i + 1; j < cars.length; j++) {
                const a = cars[i], b = cars[j];
                const dx = a.position.x - b.position.x;
                const dz = a.position.z - b.position.z;
                const d2 = dx * dx + dz * dz;
                const minD = radius * 2;
                if (d2 < minD * minD && d2 > 0.01) {
                    const d = Math.sqrt(d2);
                    const overlap = minD - d;
                    const nx = dx / d;
                    const nz = dz / d;
                    // Push apart
                    a.position.x += nx * overlap * 0.5;
                    a.position.z += nz * overlap * 0.5;
                    b.position.x -= nx * overlap * 0.5;
                    b.position.z -= nz * overlap * 0.5;
                    // Bleed speed
                    a.velocity.multiplyScalar(0.85);
                    b.velocity.multiplyScalar(0.85);

                    if ((a === this.playerCar || b === this.playerCar) && this.sound) {
                        const relV = a.velocity.distanceTo(b.velocity);
                        if (relV > 8) {
                            this.sound.playCollision(Math.min(1, relV / 30));
                            this.carCamera.shake(0.25, 0.2);
                        }
                    }
                }
            }
        }
    }

    _loadBestTime(mode) {
        try {
            const v = localStorage.getItem(`urg.bestLap.${mode}`);
            return v ? parseFloat(v) : 0;
        } catch (e) {
            return 0;
        }
    }

    _saveBestTime(mode, ms) {
        try {
            localStorage.setItem(`urg.bestLap.${mode}`, String(ms));
        } catch (e) {}
    }

    pause() {
        if (this.state === STATE.PLAYING) {
            this.state = STATE.PAUSED;
            this.controls.setEnabled(false);
        }
    }

    resume() {
        if (this.state === STATE.PAUSED) {
            this.state = STATE.PLAYING;
            this.controls.setEnabled(true);
            this.lastFrameTime = performance.now();
            // Adjust lap timer to account for pause duration
            // (simplest: we skip tracking pause time in currentLapMs until next lap boundary)
        }
    }

    restart() {
        this.start(this.mode, this.carColor);
    }

    quitToMenu() {
        this.ui.setVisible(false);
        this.state = STATE.LOADING;
        this.controls.setEnabled(false);
    }

    /**
     * Apply settings changes at runtime.
     */
    applySettings(settings) {
        Object.assign(this.settings, settings);
        if (this.postFx) this.postFx.applyQuality(this.settings.quality);
        if (this.sound) this.sound.setVolume(this.settings.volume);
        if (this.renderer) this.renderer.shadowMap.enabled = this.settings.shadows;
        if (this.postFx) {
            this.postFx.setMotionBlurEnabled(this.settings.motionBlur);
            this.postFx.enabled = this.settings.postfx;
        }
    }

    /**
     * Main update step (called every frame).
     */
    update(now) {
        const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
        this.lastFrameTime = now;

        // FPS smoothing
        this.fps = this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;

        // Always update controls
        this.controls.update();

        // Handle global input
        if (this.controls.state.pause && this.state === STATE.PLAYING && this.onPauseRequested) {
            this.onPauseRequested();
        }

        if (this.controls.state.hudToggle) {
            this.ui.toggleVisible();
        }

        if (this.controls.state.cameraToggle) {
            this.carCamera.cycleMode();
        }

        if (this.controls.state.reset && this.state === STATE.PLAYING) {
            if (this.lastSafePos) {
                this.playerCar.resetTo(this.lastSafePos, this.lastSafeHeading);
                this.carCamera.snapToCar();
            }
        }

        // State-specific updates
        if (this.state === STATE.COUNTDOWN) {
            this._updateCountdown();
            // Still render scene with frozen cars
            this._updateVisuals(dt, 0);
        } else if (this.state === STATE.PLAYING) {
            // Physics step for all cars
            this.playerCar.update(dt, this.controls.state, this.track);

            // AI grace period: ramp up aggression over first 1.5s of the race
            // so they don't immediately overtake and bump the player at the start
            const raceElapsed = (performance.now() - this.raceStartTime) / 1000;
            const aiAggression = Math.min(1, Math.max(0.5, raceElapsed / 1.5));

            for (const ai of this.aiDrivers) {
                ai.aggression = aiAggression;
                ai.update(dt, null, this.track);
            }

            // Collisions
            this._checkBarrierCollisions();
            this._checkCarToCarCollisions();

            // Update lap progress
            for (const car of this.allCars) {
                this._updateTrackProgress(car, car === this.playerCar);
            }

            // Update lap timer
            this.currentLapMs = performance.now() - this.lapStartTime;

            // Update visuals
            this._updateVisuals(dt, 1);
        } else if (this.state === STATE.PAUSED || this.state === STATE.FINISHED) {
            // Still render but don't advance physics
            this._updateVisuals(dt, 0);
        }

        // Render
        this.postFx.render(dt);
    }

    _updateVisuals(dt, simSpeed) {
        // Environment update
        this.environment.update(dt * simSpeed);

        // Camera
        this.carCamera.update(dt);

        // UI
        this.ui.updateSpeedometer(
            this.playerCar.getSpeedKmh(),
            this.playerCar.getRpmRatio(),
            this.playerCar.gear,
            this.playerCar.boost / 100,
        );

        this.ui.updateLap(this.currentLap, this.totalLaps, this.currentLapMs, this.bestLapMs);

        if (this.mode === 'race' && this.state === STATE.PLAYING) {
            const pos = this._computeRacePosition(this.playerCar);
            this.ui.updatePosition(pos, this.allCars.length);
        }

        this.ui.updateMinimap(this.allCars, this.playerCar);

        // Sound
        if (this.sound && this.sound.enabled) {
            this.sound.updateEngine(
                this.playerCar.getRpmRatio(),
                Math.abs(this.playerCar.speed),
                this.playerCar.boostActive,
            );

            // Tire squeal when drifting
            if (this.playerCar.drifting && this.playerCar.getSpeedKmh() > 30) {
                if (!this._squealTimer || performance.now() - this._squealTimer > 120) {
                    this.sound.playTireSqueal(this.playerCar.driftAmount);
                    this._squealTimer = performance.now();
                }
            }
        }

        // Motion blur based on speed
        if (this.postFx) {
            this.postFx.setMotionBlurFromSpeed(this.playerCar.getSpeedKmh(), this.playerCar.boostActive);
        }
    }
}

export { STATE };
