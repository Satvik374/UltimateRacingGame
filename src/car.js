/**
 * car.js
 * Procedural 3D car model + arcade-style physics.
 *
 * Physics model: simplified bicycle model with arcade feel.
 * Not true simulation, but tuned to feel responsive and fun.
 */

import * as THREE from 'three';

const PI = Math.PI;
const TWO_PI = Math.PI * 2;

// Physics constants (tuned for fun, not realism)
const PHYS = {
    mass: 1200,                 // kg
    maxSpeed: 75,               // m/s (~270 km/h)
    maxSpeedBoost: 95,          // m/s (~342 km/h) with boost
    maxReverseSpeed: 20,        // m/s
    enginePower: 9000,          // base forward force (arcade units)
    brakePower: 18000,          // braking force
    dragCoeff: 0.42,            // air drag
    rollingResist: 0.015,       // rolling resistance
    turnSpeed: 1.9,             // max yaw rate (rad/s) at full lock
    turnGripLossAt: 30,         // speed at which turning starts losing grip
    lateralGrip: 12.0,          // sideways friction
    lateralGripHandbrake: 2.0,  // reduced grip during handbrake (drift)
    wheelbase: 2.5,             // m
    boostAccelMult: 1.8,        // boost multiplier on accel
    boostMax: 100,              // boost capacity
    boostRegen: 20,             // boost regen per second when off throttle
    boostDrain: 60,             // boost drain per second when active
    resetHeight: 1.5,           // spawn / reset Y
};

export class Car {
    /**
     * @param {object} opts
     * @param {number|string} opts.color - body hex color
     * @param {boolean} opts.isPlayer - whether this is the player car
     * @param {boolean} opts.castShadows - enable shadow casting
     */
    constructor(opts = {}) {
        this.color = opts.color || 0xf1c40f;
        this.isPlayer = !!opts.isPlayer;
        this.castShadows = opts.castShadows !== false;

        // State
        this.position = new THREE.Vector3(0, PHYS.resetHeight, 0);
        this.velocity = new THREE.Vector3();      // world-space velocity
        this.heading = 0;                         // yaw in radians
        this.rollAngle = 0;                       // body roll during turns
        this.pitchAngle = 0;                      // body pitch during accel/brake
        this.speed = 0;                           // signed forward speed
        this.steering = 0;                        // current steering angle smoothed
        this.steerTarget = 0;
        this.wheelSpin = 0;                       // rotation accumulator for wheels
        this.boost = PHYS.boostMax;
        this.boostActive = false;
        this.drifting = false;
        this.driftAmount = 0;                     // 0..1 for effects
        this.gear = 'N';                          // display gear

        // Build the 3D model
        this.group = new THREE.Group();
        this._buildMesh();

        // Lights (for headlights)
        this._addLights();

        // Contact state
        this.onGround = true;
        this.collisionCooldown = 0;

        // Temp vectors to avoid allocations
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
    }

    _buildMesh() {
        const bodyColor = new THREE.Color(this.color);
        const darkColor = new THREE.Color(this.color).multiplyScalar(0.5);

        // Body materials
        const bodyMat = new THREE.MeshPhysicalMaterial({
            color: bodyColor,
            metalness: 0.6,
            roughness: 0.25,
            clearcoat: 1.0,
            clearcoatRoughness: 0.08,
            envMapIntensity: 1.2,
        });

        const darkMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            metalness: 0.4,
            roughness: 0.6,
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 1.0,
            roughness: 0.15,
        });

        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0x222233,
            metalness: 0.0,
            roughness: 0.02,
            transmission: 0.8,
            transparent: true,
            opacity: 0.55,
            envMapIntensity: 1.5,
        });

        const headlightMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffcc,
            emissiveIntensity: 0.4,
            metalness: 0.1,
            roughness: 0.2,
        });

        const taillightMat = new THREE.MeshStandardMaterial({
            color: 0x660000,
            emissive: 0xff2222,
            emissiveIntensity: 0.5,
            metalness: 0.1,
            roughness: 0.3,
        });

        this._bodyMat = bodyMat;
        this._taillightMat = taillightMat;

        // ---- Chassis (main body) ----
        // Use a slightly tapered box for body
        const chassis = new THREE.Group();
        chassis.position.y = 0.55;

        // Lower body (main)
        const lowerBodyGeom = new THREE.BoxGeometry(1.85, 0.55, 4.2, 2, 1, 4);
        this._bevelBox(lowerBodyGeom, 0.12);
        const lowerBody = new THREE.Mesh(lowerBodyGeom, bodyMat);
        lowerBody.position.y = 0.0;
        chassis.add(lowerBody);

        // Upper body (cabin) -- narrower and shorter
        const upperBodyGeom = new THREE.BoxGeometry(1.65, 0.55, 2.1, 1, 1, 1);
        this._bevelBox(upperBodyGeom, 0.1);
        // Slight windshield slope
        const pos = upperBodyGeom.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            if (y > 0.1) {
                // Taper top
                const newX = x * 0.82;
                pos.setX(i, newX);
                // Slope windshield (front) and rear
                if (z > 0.8) pos.setZ(i, z - 0.35);
                if (z < -0.8) pos.setZ(i, z + 0.25);
            }
        }
        upperBodyGeom.computeVertexNormals();
        const upperBody = new THREE.Mesh(upperBodyGeom, bodyMat);
        upperBody.position.y = 0.55;
        upperBody.position.z = -0.15;
        chassis.add(upperBody);

        // Hood (flat top on front)
        const hoodGeom = new THREE.BoxGeometry(1.75, 0.06, 1.3);
        const hood = new THREE.Mesh(hoodGeom, bodyMat);
        hood.position.set(0, 0.28, 1.2);
        chassis.add(hood);

        // Trunk (flat top on rear)
        const trunkGeom = new THREE.BoxGeometry(1.75, 0.06, 0.9);
        const trunk = new THREE.Mesh(trunkGeom, bodyMat);
        trunk.position.set(0, 0.28, -1.4);
        chassis.add(trunk);

        // Rear spoiler
        const spoilerGeom = new THREE.BoxGeometry(1.7, 0.08, 0.25);
        const spoiler = new THREE.Mesh(spoilerGeom, bodyMat);
        spoiler.position.set(0, 0.45, -1.8);
        chassis.add(spoiler);
        // Spoiler supports
        const supportGeom = new THREE.BoxGeometry(0.06, 0.15, 0.15);
        const supportL = new THREE.Mesh(supportGeom, darkMat);
        supportL.position.set(-0.7, 0.37, -1.8);
        chassis.add(supportL);
        const supportR = supportL.clone();
        supportR.position.x = 0.7;
        chassis.add(supportR);

        // Front grille
        const grilleGeom = new THREE.BoxGeometry(1.2, 0.25, 0.08);
        const grille = new THREE.Mesh(grilleGeom, darkMat);
        grille.position.set(0, 0.0, 2.05);
        chassis.add(grille);

        // Chrome bumper accents
        const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.06), chromeMat);
        bumperF.position.set(0, -0.12, 2.08);
        chassis.add(bumperF);
        const bumperR = bumperF.clone();
        bumperR.position.z = -2.08;
        chassis.add(bumperR);

        // Headlights (left/right)
        const hlGeom = new THREE.BoxGeometry(0.35, 0.14, 0.1);
        const headlightL = new THREE.Mesh(hlGeom, headlightMat);
        headlightL.position.set(-0.6, 0.12, 2.05);
        chassis.add(headlightL);
        const headlightR = headlightL.clone();
        headlightR.position.x = 0.6;
        chassis.add(headlightR);
        this._headlightMeshes = [headlightL, headlightR];

        // Taillights
        const tlGeom = new THREE.BoxGeometry(0.4, 0.14, 0.08);
        const taillightL = new THREE.Mesh(tlGeom, taillightMat);
        taillightL.position.set(-0.55, 0.12, -2.08);
        chassis.add(taillightL);
        const taillightR = taillightL.clone();
        taillightR.position.x = 0.55;
        chassis.add(taillightR);
        this._taillightMeshes = [taillightL, taillightR];

        // Windows
        // Windshield (sloped front)
        const windshieldGeom = new THREE.BoxGeometry(1.45, 0.5, 0.05);
        const windshield = new THREE.Mesh(windshieldGeom, glassMat);
        windshield.position.set(0, 0.85, 0.55);
        windshield.rotation.x = -0.35;
        chassis.add(windshield);

        // Rear window
        const rearWinGeom = new THREE.BoxGeometry(1.45, 0.45, 0.05);
        const rearWin = new THREE.Mesh(rearWinGeom, glassMat);
        rearWin.position.set(0, 0.85, -0.9);
        rearWin.rotation.x = 0.35;
        chassis.add(rearWin);

        // Side windows
        const sideWinGeom = new THREE.BoxGeometry(0.05, 0.35, 1.4);
        const sideWinL = new THREE.Mesh(sideWinGeom, glassMat);
        sideWinL.position.set(-0.83, 0.85, -0.15);
        chassis.add(sideWinL);
        const sideWinR = sideWinL.clone();
        sideWinR.position.x = 0.83;
        chassis.add(sideWinR);

        // Side mirrors
        const mirrorGeom = new THREE.BoxGeometry(0.15, 0.1, 0.08);
        const mirrorL = new THREE.Mesh(mirrorGeom, bodyMat);
        mirrorL.position.set(-0.95, 0.7, 0.3);
        chassis.add(mirrorL);
        const mirrorR = mirrorL.clone();
        mirrorR.position.x = 0.95;
        chassis.add(mirrorR);

        // Side skirts
        const skirtGeom = new THREE.BoxGeometry(0.08, 0.12, 3.2);
        const skirtL = new THREE.Mesh(skirtGeom, darkMat);
        skirtL.position.set(-0.92, -0.25, 0);
        chassis.add(skirtL);
        const skirtR = skirtL.clone();
        skirtR.position.x = 0.92;
        chassis.add(skirtR);

        this.group.add(chassis);
        this.chassis = chassis;

        // ---- Wheels ----
        this.wheels = [];
        this.wheelTargets = [
            { x: -0.85, y: 0.35, z: 1.3, steer: true },
            { x:  0.85, y: 0.35, z: 1.3, steer: true },
            { x: -0.85, y: 0.35, z: -1.3, steer: false },
            { x:  0.85, y: 0.35, z: -1.3, steer: false },
        ];

        const tireGeom = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 20);
        tireGeom.rotateZ(PI / 2);
        const tireMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            roughness: 0.95,
            metalness: 0.05,
        });

        const rimGeom = new THREE.CylinderGeometry(0.26, 0.26, 0.32, 8);
        rimGeom.rotateZ(PI / 2);
        const rimMat = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            metalness: 0.9,
            roughness: 0.2,
        });

        for (const wt of this.wheelTargets) {
            const wheelGroup = new THREE.Group();
            wheelGroup.position.set(wt.x, wt.y, wt.z);

            const tire = new THREE.Mesh(tireGeom, tireMat);
            const rim = new THREE.Mesh(rimGeom, rimMat);

            if (this.castShadows) {
                tire.castShadow = true;
                tire.receiveShadow = true;
            }

            wheelGroup.add(tire);
            wheelGroup.add(rim);
            wheelGroup.userData = { steer: wt.steer, tire, rim };

            this.group.add(wheelGroup);
            this.wheels.push(wheelGroup);
        }

        // Apply shadow flags to body meshes
        if (this.castShadows) {
            this.group.traverse(obj => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            });
        }

        // Car-wide shadow cast under it (simple blob shadow fallback)
        this.group.position.copy(this.position);
    }

    /**
     * Slightly round the corners of a box geometry for a more organic look.
     */
    _bevelBox(geom, amount) {
        const pos = geom.attributes.position;
        const v = new THREE.Vector3();
        // Find bounding box
        geom.computeBoundingBox();
        const bb = geom.boundingBox;
        const cx = (bb.max.x + bb.min.x) * 0.5;
        const cy = (bb.max.y + bb.min.y) * 0.5;
        const cz = (bb.max.z + bb.min.z) * 0.5;
        const sx = (bb.max.x - bb.min.x) * 0.5;
        const sy = (bb.max.y - bb.min.y) * 0.5;
        const sz = (bb.max.z - bb.min.z) * 0.5;
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            // Corners get slightly pulled in
            if (Math.abs(v.x - cx) > sx - amount * 2) v.x += (cx - v.x > 0 ? amount : -amount) * 0.2;
            if (Math.abs(v.y - cy) > sy - amount * 2) v.y += (cy - v.y > 0 ? amount : -amount) * 0.2;
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        geom.computeVertexNormals();
    }

    _addLights() {
        // Headlight spotlights (only for player or visible cars)
        // For performance, only player gets real lights
        if (this.isPlayer) {
            const hlL = new THREE.SpotLight(0xfff5cc, 1.5, 45, 0.55, 0.5, 1.2);
            hlL.position.set(-0.6, 0.75, 2.05);
            hlL.target.position.set(-0.6, 0, 10);
            hlL.castShadow = false;
            this.group.add(hlL);
            this.group.add(hlL.target);

            const hlR = hlL.clone();
            hlR.position.x = 0.6;
            hlR.target.position.x = 0.6;
            this.group.add(hlR);
            this.group.add(hlR.target);

            this._headlights = [hlL, hlR];
        }
    }

    /**
     * Set body color dynamically.
     */
    setColor(hex) {
        this.color = hex;
        if (this._bodyMat) {
            this._bodyMat.color.set(hex);
        }
    }

    /**
     * Reset car to a given position/heading (e.g., spawn, after falling off track).
     */
    resetTo(position, heading = 0) {
        this.position.copy(position);
        this.position.y = PHYS.resetHeight;
        this.velocity.set(0, 0, 0);
        this.heading = heading;
        this.speed = 0;
        this.steering = 0;
        this.steerTarget = 0;
        this.rollAngle = 0;
        this.pitchAngle = 0;
        this.drifting = false;
        this.driftAmount = 0;
        this.onGround = true;
    }

    /**
     * Step physics.
     * @param {number} dt - delta time in seconds
     * @param {object} input - {throttle, brake, steer, handbrake, boost}
     * @param {object} track - track with getGroundHeight(x,z), isOnRoad(x,z)
     */
    update(dt, input, track) {
        dt = Math.min(dt, 0.05); // cap to prevent physics explosions

        // ---- Compute forward/right from heading ----
        this._forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
        this._right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));

        // Current forward speed (signed)
        const forwardSpeed = this.velocity.dot(this._forward);
        this.speed = forwardSpeed;

        const absSpeed = Math.abs(forwardSpeed);
        const speedKmh = absSpeed * 3.6;

        // ---- Boost logic ----
        this.boostActive = input.boost && this.boost > 0 && input.throttle > 0;
        if (this.boostActive) {
            this.boost = Math.max(0, this.boost - PHYS.boostDrain * dt);
        } else if (input.throttle < 0.1) {
            this.boost = Math.min(PHYS.boostMax, this.boost + PHYS.boostRegen * dt);
        } else {
            this.boost = Math.min(PHYS.boostMax, this.boost + PHYS.boostRegen * 0.3 * dt);
        }

        // ---- Surface handling: check if on road ----
        let gripMult = 1.0;
        let frictionMult = 1.0;
        if (track && track.isOnRoad) {
            const onRoad = track.isOnRoad(this.position.x, this.position.z);
            if (!onRoad) {
                gripMult = 0.55;
                frictionMult = 2.2; // grass slows you down
            }
        }

        // ---- Throttle / Brake ----
        let accelForce = 0;
        const maxSpeed = this.boostActive ? PHYS.maxSpeedBoost : PHYS.maxSpeed;

        if (input.throttle > 0) {
            // Engine power falls off as we approach max speed
            const speedRatio = Math.max(0, forwardSpeed) / maxSpeed;
            const powerCurve = 1 - speedRatio * speedRatio;
            let power = PHYS.enginePower * input.throttle * powerCurve;
            if (this.boostActive) power *= PHYS.boostAccelMult;
            accelForce += power;
        }
        if (input.brake > 0) {
            if (forwardSpeed > 0.5) {
                // Braking
                accelForce -= PHYS.brakePower * input.brake;
            } else {
                // Reverse
                const revRatio = Math.max(0, -forwardSpeed) / PHYS.maxReverseSpeed;
                accelForce -= PHYS.enginePower * 0.45 * (1 - revRatio * revRatio) * input.brake;
            }
        }

        // Convert force to acceleration (a = F/m)
        const accelMag = accelForce / PHYS.mass;

        // Apply longitudinal acceleration along forward
        this.velocity.addScaledVector(this._forward, accelMag * dt);

        // ---- Drag and rolling resistance ----
        const v = this.velocity.length();
        if (v > 0.01) {
            const drag = PHYS.dragCoeff * v * v / PHYS.mass;
            const rolling = PHYS.rollingResist * v * frictionMult;
            const totalResist = drag + rolling;
            const resistVec = this._tmp.copy(this.velocity).normalize().multiplyScalar(-totalResist * dt);
            this.velocity.add(resistVec);
        }

        // ---- Steering ----
        // Target steering angle (how hard we're turning)
        const steerInput = input.steer || 0;
        // Smooth steering: prevent snap steering at high speed
        const steerSmooth = 8.0 * dt;
        this.steerTarget = steerInput;
        this.steering += (this.steerTarget - this.steering) * Math.min(1, steerSmooth);

        // Effective steering falls off at high speed (less wobbly at top speed)
        const speedFactor = Math.min(1, absSpeed / PHYS.turnGripLossAt);
        const turnReduction = 1 - 0.55 * speedFactor;
        const effectiveSteer = this.steering * turnReduction;

        // Compute yaw rate based on speed (you only turn when moving)
        // yaw_rate = (speed / wheelbase) * tan(steer_angle) -- bicycle model, simplified
        const minTurnSpeed = 0.8;
        if (absSpeed > minTurnSpeed) {
            const yawRate = (forwardSpeed / PHYS.wheelbase) * Math.tan(effectiveSteer * 0.6) * PHYS.turnSpeed * 0.5;
            this.heading += yawRate * dt;
            // Keep heading in [-PI, PI]
            if (this.heading > PI) this.heading -= TWO_PI;
            if (this.heading < -PI) this.heading += TWO_PI;
        }

        // ---- Lateral grip / sideways friction ----
        // Project velocity into forward/right components
        const vForward = this.velocity.dot(this._forward);
        const vRight = this.velocity.dot(this._right);

        // Grip removes lateral velocity over time
        const handbrake = input.handbrake;
        const gripBase = handbrake ? PHYS.lateralGripHandbrake : PHYS.lateralGrip;
        const grip = gripBase * gripMult;

        // Apply friction: reduce lateral velocity
        const gripFactor = 1 - Math.exp(-grip * dt);
        const newVRight = vRight * (1 - gripFactor);
        const lostLateral = vRight - newVRight;

        // Drift detection
        this.drifting = handbrake || Math.abs(vRight) > 5;
        this.driftAmount = Math.min(1, Math.abs(vRight) / 15);

        // Reconstruct velocity with reduced lateral component
        this.velocity
            .copy(this._forward).multiplyScalar(vForward)
            .add(this._right.clone().multiplyScalar(newVRight));

        // ---- Integrate position ----
        this.position.addScaledVector(this.velocity, dt);

        // ---- Ground handling ----
        let groundY = 0;
        if (track && track.getGroundHeight) {
            groundY = track.getGroundHeight(this.position.x, this.position.z) || 0;
        }
        const targetY = groundY + 0.45; // wheel radius offset

        // Simple "stick to ground" (no real suspension sim)
        this.position.y += (targetY - this.position.y) * Math.min(1, 10 * dt);
        if (this.position.y < targetY) this.position.y = targetY;

        // ---- Body roll and pitch for visual feedback ----
        const targetRoll = -this.steering * Math.min(0.8, absSpeed / 30) * 0.25;
        this.rollAngle += (targetRoll - this.rollAngle) * Math.min(1, 6 * dt);

        const targetPitch = -(accelMag / PHYS.enginePower) * 0.05;
        this.pitchAngle += (targetPitch - this.pitchAngle) * Math.min(1, 8 * dt);

        // ---- Wheel animation ----
        // Wheel spin: rotate based on forward speed
        this.wheelSpin += (forwardSpeed / 0.42) * dt; // radius = 0.42
        for (const wheel of this.wheels) {
            // Spin around local Z axis (since we rotated cylinder)
            // Actually rotate wheel's tire and rim around their local X
            const tire = wheel.userData.tire;
            const rim = wheel.userData.rim;
            tire.rotation.x = this.wheelSpin;
            rim.rotation.x = this.wheelSpin;

            // Steering wheels turn with input
            if (wheel.userData.steer) {
                wheel.rotation.y = this.steering * 0.5;
            }
        }

        // ---- Gear display (for HUD) ----
        if (Math.abs(forwardSpeed) < 0.5) this.gear = 'N';
        else if (forwardSpeed < 0) this.gear = 'R';
        else {
            // Fake gears by speed
            if (speedKmh < 40) this.gear = '1';
            else if (speedKmh < 80) this.gear = '2';
            else if (speedKmh < 130) this.gear = '3';
            else if (speedKmh < 180) this.gear = '4';
            else if (speedKmh < 230) this.gear = '5';
            else this.gear = '6';
        }

        // ---- Update transform ----
        this.group.position.copy(this.position);
        this.group.rotation.set(this.pitchAngle, this.heading, this.rollAngle, 'YXZ');

        // ---- Taillight brightness (brake indication) ----
        if (this._taillightMat) {
            const brakeGlow = input.brake > 0 && forwardSpeed > 0.5 ? 1.5 : 0.5;
            this._taillightMat.emissiveIntensity += (brakeGlow - this._taillightMat.emissiveIntensity) * Math.min(1, 10 * dt);
        }

        // ---- Collision cooldown ----
        if (this.collisionCooldown > 0) this.collisionCooldown -= dt;
    }

    getSpeedKmh() {
        return Math.abs(this.speed) * 3.6;
    }

    getRpmRatio() {
        // Fake RPM: 0 at idle, max near max speed per gear
        const speedKmh = this.getSpeedKmh();
        const gearMap = { 'N': [0, 5], 'R': [5, 25], '1': [15, 40], '2': [30, 80], '3': [55, 130], '4': [90, 180], '5': [130, 230], '6': [175, 290] };
        const [lo, hi] = gearMap[this.gear] || [0, 270];
        const ratio = Math.max(0, Math.min(1, (speedKmh - lo) / (hi - lo)));
        // Add idle floor
        return Math.max(0.15, ratio);
    }

    dispose() {
        this.group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
    }
}
