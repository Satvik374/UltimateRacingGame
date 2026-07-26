/**
 * environment.js
 * Skybox, terrain, trees (instanced), rocks, mountains, ambient details.
 */

import * as THREE from 'three';

const TERRAIN_SIZE = 2000;
const TERRAIN_SEGMENTS = 120;

export class Environment {
    constructor(scene, track, opts = {}) {
        this.scene = scene;
        this.track = track;
        this.opts = opts;

        this.trees = null;      // InstancedMesh
        this.rocks = null;
        this.mountains = null;

        // Build components
        this._buildSky();
        this._buildTerrain();
        this._buildMountains();
        this._buildTrees();
        this._buildRocks();
        this._buildClouds();
    }

    _buildSky() {
        // Procedural sky using a large sphere shader
        const skyGeom = new THREE.SphereGeometry(1500, 32, 16);
        // Flip inside-out
        skyGeom.scale(-1, 1, 1);

        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x6fb8ff) },
                midColor: { value: new THREE.Color(0xc6e3ff) },
                bottomColor: { value: new THREE.Color(0xffd8a8) },
                offset: { value: 30 },
                exponent: { value: 0.7 },
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 midColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    float t = max(pow(max(h, 0.0), exponent), 0.0);
                    float b = max(pow(max(-h + 0.1, 0.0), 0.4), 0.0);
                    vec3 color = mix(midColor, topColor, t);
                    color = mix(color, bottomColor, b * 0.6);
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
        });

        this.skyMesh = new THREE.Mesh(skyGeom, skyMat);
        this.skyMesh.renderOrder = -1;
        this.scene.add(this.skyMesh);

        // Distant sun disc
        const sunGeom = new THREE.SphereGeometry(30, 16, 12);
        const sunMat = new THREE.MeshBasicMaterial({
            color: 0xfff4c2,
            fog: false,
        });
        this.sunMesh = new THREE.Mesh(sunGeom, sunMat);
        this.sunMesh.position.set(-400, 350, 800);
        this.scene.add(this.sunMesh);
    }

    _buildTerrain() {
        // Large ground plane with hills via noise
        const geom = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
        geom.rotateX(-Math.PI / 2);

        // Displace vertices with procedural noise, BUT flatten near the track
        const pos = geom.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);

            // Distance to track
            const nearest = this.track._findNearestSample(x, z);
            const distToRoad = nearest.distance;
            const roadY = this.track._samples[nearest.index].y;

            // Terrain noise (multi-octave)
            let n = 0;
            n += this._noise(x * 0.003, z * 0.003) * 25;
            n += this._noise(x * 0.009, z * 0.009) * 7;
            n += this._noise(x * 0.03, z * 0.03) * 2;

            // Flatten near track: 0-20m = flat at roadY-0.5, 20-80m = blend, >80m = full noise
            const roadInfluence = this.track.roadWidth / 2 + 1.5;
            const blendStart = roadInfluence + 2;
            const blendEnd = roadInfluence + 50;
            let terrainY;
            if (distToRoad < blendStart) {
                terrainY = roadY - 0.3;
            } else if (distToRoad < blendEnd) {
                const blend = (distToRoad - blendStart) / (blendEnd - blendStart);
                terrainY = (roadY - 0.3) * (1 - blend) + (roadY + n) * blend;
            } else {
                terrainY = roadY + n;
            }

            pos.setY(i, terrainY);
        }
        pos.needsUpdate = true;
        geom.computeVertexNormals();

        // Vertex colors for grass/dirt variation
        const colors = new Float32Array(pos.count * 3);
        const colGrass = new THREE.Color(0x4a7c3c);
        const colDarkGrass = new THREE.Color(0x3d6632);
        const colDirt = new THREE.Color(0x6b5030);
        const colRock = new THREE.Color(0x5a5650);
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const n = this._noise(x * 0.01, z * 0.01);

            let c;
            if (y > 45) c = colRock;
            else if (y > 15) c = colGrass.clone().lerp(colRock, (y - 15) / 30);
            else if (n > 0.3) c = colDarkGrass;
            else if (n < -0.4) c = colGrass.clone().lerp(colDirt, 0.3);
            else c = colGrass;

            // Slight random variation
            const variation = 0.92 + Math.random() * 0.16;
            colors[i * 3] = c.r * variation;
            colors[i * 3 + 1] = c.g * variation;
            colors[i * 3 + 2] = c.b * variation;
        }
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.95,
            metalness: 0.0,
            flatShading: false,
            side: THREE.DoubleSide,  // safety: render from both sides in case camera clips under
        });

        this.terrainMesh = new THREE.Mesh(geom, mat);
        this.terrainMesh.receiveShadow = true;
        this.terrainMesh.name = 'terrain';
        this.scene.add(this.terrainMesh);
    }

    _buildMountains() {
        // Distant mountain ring for parallax horizon
        const mountainGroup = new THREE.Group();
        const count = 24;
        const radius = 700;

        const mountainMat = new THREE.MeshStandardMaterial({
            color: 0x6c7a8a,
            roughness: 0.95,
            metalness: 0.0,
            flatShading: true,
        });
        const snowMat = new THREE.MeshStandardMaterial({
            color: 0xeeeeff,
            roughness: 0.7,
            metalness: 0.0,
            flatShading: true,
        });

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.1;
            const r = radius + Math.random() * 150;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const h = 80 + Math.random() * 120;
            const w = 100 + Math.random() * 150;

            const geom = new THREE.ConeGeometry(w, h, 5 + Math.floor(Math.random() * 3));
            // Deform vertices for more organic shape
            const p = geom.attributes.position;
            for (let j = 0; j < p.count; j++) {
                p.setX(j, p.getX(j) + (Math.random() - 0.5) * 8);
                p.setY(j, p.getY(j) + (Math.random() - 0.5) * 4);
                p.setZ(j, p.getZ(j) + (Math.random() - 0.5) * 8);
            }
            geom.computeVertexNormals();

            const mountain = new THREE.Mesh(geom, mountainMat);
            mountain.position.set(x, h / 2 - 10, z);
            mountain.rotation.y = Math.random() * Math.PI * 2;
            mountainGroup.add(mountain);

            // Snow cap
            if (h > 120 && Math.random() > 0.3) {
                const capGeom = new THREE.ConeGeometry(w * 0.4, h * 0.25, 6);
                const cap = new THREE.Mesh(capGeom, snowMat);
                cap.position.set(x, h / 2 - 10 + h * 0.35, z);
                cap.rotation.y = mountain.rotation.y;
                mountainGroup.add(cap);
            }
        }

        this.mountains = mountainGroup;
        this.scene.add(mountainGroup);
    }

    _buildTrees() {
        // Generate tree positions scattered outside the track
        const positions = [];
        const NUM_TREES = 1200;
        const AREA = 800;

        let attempts = 0;
        while (positions.length < NUM_TREES && attempts < NUM_TREES * 8) {
            attempts++;
            const x = (Math.random() - 0.5) * AREA * 2;
            const z = (Math.random() - 0.5) * AREA * 2;

            // Must be far from track
            const nearest = this.track._findNearestSample(x, z);
            if (nearest.distance < this.track.roadWidth / 2 + 6) continue;

            // Must be inside terrain bounds
            if (Math.abs(x) > TERRAIN_SIZE / 2 - 20) continue;
            if (Math.abs(z) > TERRAIN_SIZE / 2 - 20) continue;

            // Approximate Y from terrain generation
            const baseY = this.track._samples[nearest.index].y;
            let n = 0;
            n += this._noise(x * 0.003, z * 0.003) * 25;
            n += this._noise(x * 0.009, z * 0.009) * 7;
            const distToRoad = nearest.distance;
            const blendStart = this.track.roadWidth / 2 + 3.5;
            const blendEnd = this.track.roadWidth / 2 + 51.5;
            let terrainY;
            if (distToRoad < blendStart) terrainY = baseY - 0.3;
            else if (distToRoad < blendEnd) {
                const b = (distToRoad - blendStart) / (blendEnd - blendStart);
                terrainY = (baseY - 0.3) * (1 - b) + (baseY + n) * b;
            } else terrainY = baseY + n;

            // Skip mountains
            if (terrainY > 40) continue;

            positions.push({ x, y: terrainY, z });
        }

        // Create instanced tree geometry (trunk + foliage cones)
        // We'll combine them into a single geometry for one InstancedMesh each
        const trunkGeom = new THREE.CylinderGeometry(0.25, 0.4, 3.5, 6);
        trunkGeom.translate(0, 1.75, 0);
        const trunkMat = new THREE.MeshStandardMaterial({
            color: 0x4a3322,
            roughness: 0.9,
            metalness: 0.0,
        });

        // Foliage: layered cones for pine trees
        const foliageGeom = new THREE.BufferGeometry();
        const fp = [];
        const fn = [];
        const fi = [];

        function addCone(y, r, h, sides = 8) {
            const base = fp.length / 3;
            // Apex
            fp.push(0, y + h, 0);
            for (let i = 0; i < sides; i++) {
                const a = (i / sides) * Math.PI * 2;
                fp.push(Math.cos(a) * r, y, Math.sin(a) * r);
            }
            // Bottom center
            const bottomCenter = fp.length / 3;
            fp.push(0, y, 0);

            // Side triangles
            for (let i = 0; i < sides; i++) {
                const i1 = base + 1 + i;
                const i2 = base + 1 + ((i + 1) % sides);
                fi.push(base, i1, i2);
                // Bottom triangles
                fi.push(bottomCenter, i2, i1);
            }
        }

        // Three stacked foliage cones
        addCone(2.5, 1.8, 2.0);
        addCone(3.8, 1.4, 1.8);
        addCone(5.0, 1.0, 1.5);

        foliageGeom.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
        foliageGeom.setIndex(fi);
        foliageGeom.computeVertexNormals();

        const foliageMat = new THREE.MeshStandardMaterial({
            color: 0x2d5a2a,
            roughness: 0.95,
            metalness: 0.0,
            flatShading: false,
        });

        const count = positions.length;
        this.trunkInst = new THREE.InstancedMesh(trunkGeom, trunkMat, count);
        this.foliageInst = new THREE.InstancedMesh(foliageGeom, foliageMat, count);
        this.trunkInst.castShadow = true;
        this.trunkInst.receiveShadow = true;
        this.foliageInst.castShadow = true;
        this.foliageInst.receiveShadow = true;

        const dummy = new THREE.Object3D();
        // Multiple foliage colors for variety
        const colors = [
            new THREE.Color(0x2d5a2a),
            new THREE.Color(0x3a6a3a),
            new THREE.Color(0x234522),
            new THREE.Color(0x3f7235),
            new THREE.Color(0x2c563f),
        ];

        // Use per-instance color via InstancedBufferAttribute
        const trunkColors = new Float32Array(count * 3);
        const foliageColors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const p = positions[i];
            const scale = 0.8 + Math.random() * 1.2;
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.scale.set(scale * 0.9, scale, scale * 0.9);
            dummy.updateMatrix();

            this.trunkInst.setMatrixAt(i, dummy.matrix);
            this.foliageInst.setMatrixAt(i, dummy.matrix);

            // Trunk color (brownish)
            const trunkBase = 0.3 + Math.random() * 0.15;
            trunkColors[i * 3] = trunkBase;
            trunkColors[i * 3 + 1] = trunkBase * 0.7;
            trunkColors[i * 3 + 2] = trunkBase * 0.4;

            // Foliage color
            const fc = colors[Math.floor(Math.random() * colors.length)];
            foliageColors[i * 3] = fc.r;
            foliageColors[i * 3 + 1] = fc.g;
            foliageColors[i * 3 + 2] = fc.b;
        }

        this.trunkInst.instanceMatrix.needsUpdate = true;
        this.foliageInst.instanceMatrix.needsUpdate = true;

        // Apply per-instance colors
        this.trunkInst.instanceColor = new THREE.InstancedBufferAttribute(trunkColors, 3);
        this.foliageInst.instanceColor = new THREE.InstancedBufferAttribute(foliageColors, 3);

        this.scene.add(this.trunkInst);
        this.scene.add(this.foliageInst);
        this.trees = { trunkInst: this.trunkInst, foliageInst: this.foliageInst };
    }

    _buildRocks() {
        // Scattered rocks
        const NUM_ROCKS = 80;
        const rockGeom = new THREE.DodecahedronGeometry(1, 1);
        // Deform vertices for irregular shape
        const p = rockGeom.attributes.position;
        for (let i = 0; i < p.count; i++) {
            p.setX(i, p.getX(i) + (Math.random() - 0.5) * 0.3);
            p.setY(i, p.getY(i) + (Math.random() - 0.5) * 0.3);
            p.setZ(i, p.getZ(i) + (Math.random() - 0.5) * 0.3);
        }
        rockGeom.computeVertexNormals();

        const rockMat = new THREE.MeshStandardMaterial({
            color: 0x7a7570,
            roughness: 0.9,
            metalness: 0.0,
            flatShading: true,
        });

        const inst = new THREE.InstancedMesh(rockGeom, rockMat, NUM_ROCKS);
        inst.castShadow = true;
        inst.receiveShadow = true;

        const dummy = new THREE.Object3D();
        let placed = 0;
        let attempts = 0;
        while (placed < NUM_ROCKS && attempts < NUM_ROCKS * 10) {
            attempts++;
            const x = (Math.random() - 0.5) * 1200;
            const z = (Math.random() - 0.5) * 1200;
            const nearest = this.track._findNearestSample(x, z);
            if (nearest.distance < this.track.roadWidth / 2 + 4) continue;
            if (Math.abs(x) > TERRAIN_SIZE / 2 - 30) continue;
            if (Math.abs(z) > TERRAIN_SIZE / 2 - 30) continue;

            // Estimate terrain Y
            const baseY = this.track._samples[nearest.index].y;
            let n = 0;
            n += this._noise(x * 0.003, z * 0.003) * 25;
            n += this._noise(x * 0.009, z * 0.009) * 7;
            const distToRoad = nearest.distance;
            const blendStart = this.track.roadWidth / 2 + 3.5;
            const blendEnd = this.track.roadWidth / 2 + 51.5;
            let terrainY;
            if (distToRoad < blendStart) terrainY = baseY - 0.3;
            else if (distToRoad < blendEnd) {
                const b = (distToRoad - blendStart) / (blendEnd - blendStart);
                terrainY = (baseY - 0.3) * (1 - b) + (baseY + n) * b;
            } else terrainY = baseY + n;

            const scale = 0.5 + Math.random() * 2.5;
            dummy.position.set(x, terrainY - 0.2, z);
            dummy.rotation.set(Math.random() * 0.3, Math.random() * Math.PI * 2, Math.random() * 0.3);
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            inst.setMatrixAt(placed, dummy.matrix);
            placed++;
        }
        inst.count = placed;
        inst.instanceMatrix.needsUpdate = true;

        this.rocks = inst;
        this.scene.add(inst);
    }

    _buildClouds() {
        // Simple flat cloud sprites orbiting high
        const NUM_CLOUDS = 20;
        const cloudMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            fog: false,
        });

        this.cloudGroup = new THREE.Group();
        for (let i = 0; i < NUM_CLOUDS; i++) {
            const sprite = new THREE.Group();
            const numPuffs = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < numPuffs; j++) {
                const r = 8 + Math.random() * 12;
                const geom = new THREE.SphereGeometry(r, 8, 6);
                const puff = new THREE.Mesh(geom, cloudMat);
                puff.position.set((j - numPuffs / 2) * r * 0.7, Math.random() * 3, 0);
                sprite.add(puff);
            }
            const angle = Math.random() * Math.PI * 2;
            const radius = 400 + Math.random() * 400;
            sprite.position.set(
                Math.cos(angle) * radius,
                180 + Math.random() * 70,
                Math.sin(angle) * radius
            );
            sprite.userData.angle = angle;
            sprite.userData.radius = radius;
            sprite.userData.speed = 0.0005 + Math.random() * 0.001;
            this.cloudGroup.add(sprite);
        }
        this.scene.add(this.cloudGroup);
    }

    /**
     * Animate clouds and other time-based effects.
     */
    update(dt) {
        if (this.cloudGroup) {
            for (const c of this.cloudGroup.children) {
                c.userData.angle += c.userData.speed * dt * 60;
                c.position.x = Math.cos(c.userData.angle) * c.userData.radius;
                c.position.z = Math.sin(c.userData.angle) * c.userData.radius;
            }
        }
    }

    /**
     * 2D pseudo-noise function (value noise).
     * Not a real Perlin, but good enough for terrain shaping.
     */
    _noise(x, y) {
        // Simple hash-based value noise
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;

        const v00 = this._hash(ix, iy);
        const v10 = this._hash(ix + 1, iy);
        const v01 = this._hash(ix, iy + 1);
        const v11 = this._hash(ix + 1, iy + 1);

        // Smoothstep
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);

        const a = v00 + (v10 - v00) * sx;
        const b = v01 + (v11 - v01) * sx;
        return a + (b - a) * sy;
    }

    _hash(x, y) {
        let h = x * 374761393 + y * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        h = h ^ (h >> 16);
        return ((h >>> 0) / 4294967295) * 2 - 1; // -1..1
    }
}
