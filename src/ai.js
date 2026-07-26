/**
 * ai.js
 * AI driver that follows the track with lookahead steering.
 *
 * Strategy:
 * - Each AI keeps a "target t" on the track curve, always a few meters ahead
 * - Compute steering to aim at target
 * - Throttle/brake based on corner sharpness ahead (slow down for sharp turns)
 * - Each AI has a skill level and a lateral preference (racing line variation)
 */

import * as THREE from 'three';
import { Car } from './car.js';

export class AIDriver {
    /**
     * @param {Car} car - the AI-controlled car
     * @param {Track} track
     * @param {object} opts - {skill: 0..1, lateralBias: -1..1}
     */
    constructor(car, track, opts = {}) {
        this.car = car;
        this.track = track;
        this.skill = opts.skill !== undefined ? opts.skill : 0.7; // 0..1
        this.lateralBias = opts.lateralBias !== undefined ? opts.lateralBias : 0;

        this.currentT = 0;
        this.lookaheadDistance = 15; // meters ahead of car to aim
        this.targetSpeed = 50; // m/s target
        this.stuckTimer = 0;
        this.aggression = 1.0; // multiplier on throttle (set by game during grace period)
        this.lastPos = new THREE.Vector3();
    }

    /**
     * Initial setup: align to the track at a given t.
     */
    initAtT(t) {
        this.currentT = t;
        const pos = this.track.getPathPoint(t, this.lateralBias * 3);
        const tan = this.track.getPathTangent(t);
        const heading = Math.atan2(tan.x, tan.z);
        this.car.resetTo(pos, heading);
        this.lastPos.copy(pos);
    }

    /**
     * Compute AI's current progress along track.
     */
    _updateCurrentT() {
        const pos = this.car.position;
        const nearest = this.track._findNearestSample(pos.x, pos.z);
        this.currentT = nearest.t;
    }

    /**
     * Compute desired steering to aim at lookahead point on racing line.
     */
    _computeSteer() {
        // Lookahead scales with speed for stability
        const speed = Math.max(5, Math.abs(this.car.speed));
        const lookT = this._addDistT(this.currentT, this.lookaheadDistance + speed * 0.35);
        // Offset slightly for racing line variation
        const target = this.track.getPathPoint(lookT, this.lateralBias * 3.5);

        // Direction from car to target
        const toTarget = new THREE.Vector3().subVectors(target, this.car.position);
        const targetAngle = Math.atan2(toTarget.x, toTarget.z);

        // Current heading
        let diff = targetAngle - this.car.heading;
        // Normalize diff to [-PI, PI]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Map to steer input in [-1, 1]
        // Higher skill -> tighter control
        const gain = 1.5 + this.skill * 1.0;
        let steer = Math.max(-1, Math.min(1, diff * gain));
        return steer;
    }

    /**
     * Compute desired throttle/brake based on corner ahead.
     */
    _computeThrottle() {
        // Look further ahead for braking decisions
        const t1 = this._addDistT(this.currentT, 20);
        const t2 = this._addDistT(this.currentT, 50);
        const t3 = this._addDistT(this.currentT, 90);

        const p0 = this.track.getPathPoint(this.currentT);
        const p1 = this.track.getPathPoint(t1);
        const p2 = this.track.getPathPoint(t2);
        const p3 = this.track.getPathPoint(t3);

        // Compute angle change over the lookahead -- sharper = more slowdown
        const d1 = new THREE.Vector3().subVectors(p1, p0).normalize();
        const d2 = new THREE.Vector3().subVectors(p2, p1).normalize();
        const d3 = new THREE.Vector3().subVectors(p3, p2).normalize();
        const dot1 = d1.dot(d2);
        const dot2 = d2.dot(d3);
        const sharpness = Math.max(0, 1 - Math.min(dot1, dot2));
        // sharpness=0 means straight, 1 means 90deg turn

        // Elevation change (slopes)
        const elevDiff = Math.abs(p2.y - p0.y);
        const slopeFactor = Math.max(0, 1 - elevDiff / 20);

        // Target speed: faster on straights, slower in turns
        const maxSpeedMs = 60 + this.skill * 18;
        const minCornerSpeed = 18 + this.skill * 5;

        const cornerFactor = 1 - sharpness * 0.75;
        this.targetSpeed = Math.max(minCornerSpeed, maxSpeedMs * cornerFactor * (0.85 + slopeFactor * 0.15));

        const curSpeed = Math.max(0, this.car.speed);
        const delta = this.targetSpeed - curSpeed;

        let throttle = 0, brake = 0;
        if (delta > 2) {
            throttle = Math.min(1, delta / 5);
        } else if (delta < -2) {
            brake = Math.min(1, -delta / 10);
        } else {
            throttle = 0.5; // hold speed
        }

        return { throttle, brake };
    }

    /**
     * Advance a t value by a given arc-length distance (approximate).
     */
    _addDistT(t, dist) {
        // Rough: totalLength * dt = dist -> dt = dist / totalLength
        return (t + dist / this.track.totalLength + 1) % 1;
    }

    update(dt, _input, track) {
        // Skip if car doesn't exist
        if (!this.car) return;

        this._updateCurrentT();

        // Stuck detection: if car hasn't moved much in 2s, teleport back to track
        const distMoved = this.car.position.distanceTo(this.lastPos);
        if (distMoved < 1.5) {
            this.stuckTimer += dt;
            if (this.stuckTimer > 2.5) {
                // Respawn on track
                const pos = this.track.getPathPoint(this.currentT, this.lateralBias * 2);
                const tan = this.track.getPathTangent(this.currentT);
                this.car.resetTo(pos, Math.atan2(tan.x, tan.z));
                this.stuckTimer = 0;
            }
        } else {
            this.stuckTimer = 0;
            this.lastPos.copy(this.car.position);
        }

        const steer = this._computeSteer();
        const { throttle, brake } = this._computeThrottle();

        // Build input object (apply aggression multiplier from game's grace period)
        const input = {
            throttle: throttle * this.aggression,
            brake,
            steer,
            handbrake: false,
            boost: this.skill > 0.75 && throttle > 0.8 && this.aggression >= 1 && Math.random() < 0.02,
        };

        // Step car with AI input
        this.car.update(dt, input, track);
    }

    getProgress() {
        return this.currentT;
    }
}
