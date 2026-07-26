/**
 * camera.js
 * Multiple camera modes for the racing game.
 * - chase: 3rd-person behind car, smoothly tracks orientation
 * - hood: 1st-person from car hood/driver seat
 * - cinematic: wide pulled-back view, slower to react
 */

import * as THREE from 'three';

const CAMERA_MODES = ['chase', 'hood', 'cinematic'];

export class CarCamera {
    constructor(camera, car) {
        this.camera = camera;
        this.car = car;
        this.mode = 'chase';
        this.modeIndex = 0;

        // Temp vectors to avoid allocations
        this._targetPos = new THREE.Vector3();
        this._targetLook = new THREE.Vector3();
        this._currentPos = new THREE.Vector3();
        this._currentLook = new THREE.Vector3();
        this._offset = new THREE.Vector3();
        this._smoothVel = new THREE.Vector3();

        // Config per mode
        this.configs = {
            chase: {
                distance: 9,
                height: 4,
                lookAhead: 6,
                lookHeight: 1.8,
                positionLerp: 0.12,
                lookLerp: 0.18,
                fovBase: 65,
                fovSpeedFactor: 0.12, // FOV increases with speed for speed feel
            },
            hood: {
                distance: 0,
                height: 1.15,
                offsetZ: 0.5,  // slightly in front of windshield
                lookAhead: 20,
                lookHeight: 1.2,
                positionLerp: 0.6,
                lookLerp: 0.35,
                fovBase: 75,
                fovSpeedFactor: 0.22,
            },
            cinematic: {
                distance: 16,
                height: 6.5,
                lookAhead: 3,
                lookHeight: 1.5,
                positionLerp: 0.06,
                lookLerp: 0.1,
                fovBase: 55,
                fovSpeedFactor: 0.08,
            },
        };

        // Shake state
        this.shakeTime = 0;
        this.shakeStrength = 0;
    }

    setMode(mode) {
        if (!CAMERA_MODES.includes(mode)) return;
        this.mode = mode;
        this.modeIndex = CAMERA_MODES.indexOf(mode);
    }

    cycleMode() {
        this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length;
        this.mode = CAMERA_MODES[this.modeIndex];
    }

    /**
     * Trigger a camera shake (e.g. on collision)
     */
    shake(strength = 0.4, duration = 0.3) {
        this.shakeStrength = Math.max(this.shakeStrength, strength);
        this.shakeTime = Math.max(this.shakeTime, duration);
    }

    /**
     * Snap camera instantly to target (e.g., on race start / reset)
     */
    snapToCar() {
        this._computeTargetPosAndLook();
        this.camera.position.copy(this._targetPos);
        this.camera.lookAt(this._targetLook);
        this._currentPos.copy(this._targetPos);
        this._currentLook.copy(this._targetLook);
    }

    _computeTargetPosAndLook() {
        const car = this.car;
        const config = this.configs[this.mode];

        // Car forward direction (in world space)
        const forward = new THREE.Vector3(
            Math.sin(car.heading),
            0,
            Math.cos(car.heading)
        );

        // For "chase" and "cinematic", position is BEHIND car at some height
        if (this.mode === 'chase' || this.mode === 'cinematic') {
            // Take motion direction into account -- if car is drifting, camera stays behind heading
            // but lightly skews to velocity for drama
            const vDir = car.velocity.length() > 2 ? car.velocity.clone().normalize() : forward.clone();
            const blendedForward = forward.clone().multiplyScalar(0.75).addScaledVector(vDir, 0.25).normalize();

            this._offset.copy(blendedForward).multiplyScalar(-config.distance);
            this._offset.y = config.height;

            this._targetPos.copy(car.position).add(this._offset);

            // Look point: slightly ahead of car
            this._targetLook.copy(car.position).addScaledVector(blendedForward, config.lookAhead);
            this._targetLook.y = car.position.y + config.lookHeight;
        } else if (this.mode === 'hood') {
            // Hood: position at car's dash, look far ahead
            const local = new THREE.Vector3(0, config.height, config.offsetZ);
            // Rotate by heading
            local.applyAxisAngle(new THREE.Vector3(0, 1, 0), car.heading);
            this._targetPos.copy(car.position).add(local);

            this._targetLook.copy(car.position).addScaledVector(forward, config.lookAhead);
            this._targetLook.y = car.position.y + config.lookHeight;
        }
    }

    /**
     * Update camera position and lookAt with smoothing.
     */
    update(dt) {
        this._computeTargetPosAndLook();

        const config = this.configs[this.mode];

        // Smooth position
        const posLerp = Math.min(1, config.positionLerp * 60 * dt);
        this._currentPos.lerp(this._targetPos, posLerp);

        // Smooth look target
        const lookLerp = Math.min(1, config.lookLerp * 60 * dt);
        this._currentLook.lerp(this._targetLook, lookLerp);

        // Apply shake
        if (this.shakeTime > 0) {
            const s = this.shakeStrength * (this.shakeTime / 0.3);
            this.camera.position.set(
                this._currentPos.x + (Math.random() - 0.5) * s,
                this._currentPos.y + (Math.random() - 0.5) * s,
                this._currentPos.z + (Math.random() - 0.5) * s,
            );
            this.shakeTime -= dt;
            if (this.shakeTime <= 0) this.shakeStrength = 0;
        } else {
            this.camera.position.copy(this._currentPos);
        }

        this.camera.lookAt(this._currentLook);

        // Dynamic FOV based on speed (speed feel)
        const speedKmh = this.car.getSpeedKmh();
        const speedRatio = Math.min(1, speedKmh / 300);
        // Extra FOV kick during boost
        const boostFov = this.car.boostActive ? 8 : 0;
        const targetFov = config.fovBase + speedRatio * speedRatio * config.fovSpeedFactor * 80 + boostFov;
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 3 * dt);
        this.camera.updateProjectionMatrix();
    }
}
