/**
 * track.js
 * Race track: spline-based road, curbs, barriers, checkpoints, start/finish line.
 *
 * The track is a closed loop defined by a CatmullRomCurve3. We sample the curve
 * to generate a ribbon mesh for the road, thin boxes for curbs, and taller
 * barriers on each side.
 */

import * as THREE from 'three';

const ROAD_WIDTH = 14;
const CURB_WIDTH = 0.6;
const BARRIER_HEIGHT = 1.2;
const BARRIER_WIDTH = 0.4;
const ROAD_SEGMENTS = 600;  // resolution of road mesh

/**
 * A hand-designed track with varied turns and elevation.
 * Returns array of control points for CatmullRom.
 */
function createTrackControlPoints() {
    // Track roughly 500m wide, 700m long
    // Points are in order of travel. Last point != first (curve closes itself)
    return [
        new THREE.Vector3(0,    0,  0),        // 0: start/finish
        new THREE.Vector3(120,  0,  10),       // 1: straight
        new THREE.Vector3(220,  2,  30),       // 2: begin right sweep
        new THREE.Vector3(300,  5,  90),       // 3: rising into turn
        new THREE.Vector3(330,  8,  180),      // 4: apex of right turn
        new THREE.Vector3(300,  10, 270),      // 5: exit right turn
        new THREE.Vector3(240,  8,  340),      // 6: left kink
        new THREE.Vector3(150,  5,  390),      // 7: descending
        new THREE.Vector3(50,   3,  410),      // 8: still descending
        new THREE.Vector3(-60,  2,  400),      // 9: wide left
        new THREE.Vector3(-160, 1,  370),      // 10: continue left
        new THREE.Vector3(-240, 0,  310),      // 11
        new THREE.Vector3(-290, -1, 230),      // 12: far corner
        new THREE.Vector3(-310, 0,  140),      // 13: hairpin approach
        new THREE.Vector3(-260, 2,  70),       // 14: hairpin apex
        new THREE.Vector3(-200, 4,  40),       // 15: exit hairpin
        new THREE.Vector3(-140, 6, -10),       // 16: uphill straight
        new THREE.Vector3(-60,  8, -40),       // 17: continue up
        new THREE.Vector3(20,   6, -50),       // 18: starting descent
        new THREE.Vector3(80,   3, -40),       // 19: short straight
        new THREE.Vector3(120,  1, -20),       // 20: final turn in
        // Returns to 0 via closed curve
    ];
}

export class Track {
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.opts = opts;
        this.roadWidth = ROAD_WIDTH;

        // Build curve
        this.controlPoints = createTrackControlPoints();
        this.curve = new THREE.CatmullRomCurve3(this.controlPoints, true, 'catmullrom', 0.5);
        this.totalLength = this.curve.getLength();

        // Precompute frames for fast lookup
        this._frames = this.curve.computeFrenetFrames(ROAD_SEGMENTS, true);

        // Precompute sample points for fast "nearest point" queries
        this._samples = [];
        this._sampleTangents = [];
        for (let i = 0; i <= ROAD_SEGMENTS; i++) {
            const t = i / ROAD_SEGMENTS;
            const p = this.curve.getPointAt(t);
            const tan = this.curve.getTangentAt(t).normalize();
            this._samples.push(p);
            this._sampleTangents.push(tan);
        }

        // Build meshes
        this._buildRoad();
        this._buildCurbs();
        this._buildBarriers();
        this._buildStartLine();
        this._buildCheckpoints();

        // Pre-compute spawn positions on grid (row of 5 side-by-side, 4 rows)
        this.spawnPoints = this._computeSpawnPoints();
    }

    _buildRoad() {
        // Create ribbon along the curve
        const geom = new THREE.BufferGeometry();
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        const up = new THREE.Vector3(0, 1, 0);
        const halfW = this.roadWidth / 2;

        for (let i = 0; i <= ROAD_SEGMENTS; i++) {
            const t = i / ROAD_SEGMENTS;
            const p = this.curve.getPointAt(t);
            const tan = this.curve.getTangentAt(t).normalize();
            // Use world-up to define the "horizontal" right vector
            const right = new THREE.Vector3().crossVectors(tan, up).normalize();

            // Two vertices per slice: left and right edge of road
            const left = p.clone().addScaledVector(right, -halfW);
            const rght = p.clone().addScaledVector(right, halfW);

            positions.push(left.x, left.y + 0.02, left.z);
            positions.push(rght.x, rght.y + 0.02, rght.z);

            normals.push(0, 1, 0);
            normals.push(0, 1, 0);

            // UVs: U across road, V along road (repeat for tire marks texture)
            const v = i * 0.5;
            uvs.push(0, v);
            uvs.push(1, v);
        }

        // Indices for ribbon triangles
        for (let i = 0; i < ROAD_SEGMENTS; i++) {
            const a = i * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, c, b);
            indices.push(b, c, d);
        }

        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);
        geom.computeBoundingSphere();

        // Road material: dark asphalt with subtle procedural texture
        const roadTexture = this._createAsphaltTexture();
        const roadMat = new THREE.MeshStandardMaterial({
            map: roadTexture,
            color: 0x333338,
            roughness: 0.85,
            metalness: 0.05,
        });

        this.roadMesh = new THREE.Mesh(geom, roadMat);
        this.roadMesh.receiveShadow = true;
        this.roadMesh.name = 'track_road';
        this.scene.add(this.roadMesh);

        // Add a white center line and edge lines
        this._buildRoadMarkings();
    }

    _createAsphaltTexture() {
        // Procedural noise texture for asphalt
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(size, size);
        for (let i = 0; i < img.data.length; i += 4) {
            const n = 30 + Math.random() * 25;
            img.data[i] = n;
            img.data[i + 1] = n;
            img.data[i + 2] = n + 2;
            img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);

        // Add occasional darker streaks
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            ctx.fillRect(x, y, 1 + Math.random() * 2, 20 + Math.random() * 60);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(3, 60);
        tex.anisotropy = 8;
        return tex;
    }

    _buildRoadMarkings() {
        // Center dashed line
        const dashGeom = new THREE.BufferGeometry();
        const dashPos = [];
        const up = new THREE.Vector3(0, 1, 0);

        const dashLengthT = 0.002;   // in curve-t units
        const dashGapT = 0.004;
        let t = 0;
        while (t < 1) {
            const tEnd = Math.min(1, t + dashLengthT);
            // Subdivide dash into small segments
            const segs = 3;
            for (let i = 0; i < segs; i++) {
                const t1 = t + (tEnd - t) * (i / segs);
                const t2 = t + (tEnd - t) * ((i + 1) / segs);
                const p1 = this.curve.getPointAt(t1);
                const p2 = this.curve.getPointAt(t2);
                const tan = this.curve.getTangentAt(t1).normalize();
                const right = new THREE.Vector3().crossVectors(tan, up).normalize();

                const w = 0.15;
                const a = p1.clone().addScaledVector(right, -w);
                const b = p1.clone().addScaledVector(right, w);
                const c = p2.clone().addScaledVector(right, -w);
                const d = p2.clone().addScaledVector(right, w);
                a.y += 0.04; b.y += 0.04; c.y += 0.04; d.y += 0.04;
                dashPos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
                dashPos.push(b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
            }
            t += dashLengthT + dashGapT;
        }
        dashGeom.setAttribute('position', new THREE.Float32BufferAttribute(dashPos, 3));
        dashGeom.computeVertexNormals();

        const dashMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0x444444,
            roughness: 0.6,
            metalness: 0.0,
        });
        const dashMesh = new THREE.Mesh(dashGeom, dashMat);
        dashMesh.receiveShadow = true;
        this.scene.add(dashMesh);

        // Edge lines (solid white on each side)
        this._buildEdgeLine(-1);
        this._buildEdgeLine(1);
    }

    _buildEdgeLine(side) {
        const geom = new THREE.BufferGeometry();
        const positions = [];
        const indices = [];
        const up = new THREE.Vector3(0, 1, 0);
        const halfW = this.roadWidth / 2;
        const lineW = 0.15;

        for (let i = 0; i <= ROAD_SEGMENTS; i++) {
            const t = i / ROAD_SEGMENTS;
            const p = this.curve.getPointAt(t);
            const tan = this.curve.getTangentAt(t).normalize();
            const right = new THREE.Vector3().crossVectors(tan, up).normalize();

            const inner = p.clone().addScaledVector(right, side * (halfW - lineW));
            const outer = p.clone().addScaledVector(right, side * halfW);
            inner.y += 0.04;
            outer.y += 0.04;
            positions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z);

            if (i < ROAD_SEGMENTS) {
                const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
                if (side < 0) {
                    indices.push(a, c, b, b, c, d);
                } else {
                    indices.push(a, b, c, b, d, c);
                }
            }
        }

        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.5,
            metalness: 0.0,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
    }

    _buildCurbs() {
        // Red-white checker curbs on both sides
        const positions = [];
        const indices = [];
        const colors = [];
        const up = new THREE.Vector3(0, 1, 0);
        const halfW = this.roadWidth / 2;

        for (let i = 0; i <= ROAD_SEGMENTS; i++) {
            const t = i / ROAD_SEGMENTS;
            const p = this.curve.getPointAt(t);
            const tan = this.curve.getTangentAt(t).normalize();
            const right = new THREE.Vector3().crossVectors(tan, up).normalize();

            for (const side of [-1, 1]) {
                const inner = p.clone().addScaledVector(right, side * halfW);
                const outer = p.clone().addScaledVector(right, side * (halfW + CURB_WIDTH));

                // Alternating red/white every ~2m
                const pattern = Math.floor(i / 3) % 2;
                const c = pattern === 0 ? [0.88, 0.12, 0.12] : [0.95, 0.95, 0.95];

                positions.push(inner.x, inner.y + 0.05, inner.z);
                positions.push(outer.x, outer.y + 0.1, outer.z);
                colors.push(...c, ...c);
            }
        }

        // Build indices for each side
        // Left curb: vertices 0, 1 ; 4, 5 ; 8, 9 ...  (stride = 4)
        // Right curb: vertices 2, 3 ; 6, 7 ; 10, 11 ...
        const stride = 4;
        for (let i = 0; i < ROAD_SEGMENTS; i++) {
            const base = i * stride;
            const nextBase = (i + 1) * stride;
            // Left
            indices.push(base, base + 1, nextBase);
            indices.push(base + 1, nextBase + 1, nextBase);
            // Right
            indices.push(base + 2, nextBase + 2, base + 3);
            indices.push(base + 3, nextBase + 2, nextBase + 3);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.6,
            metalness: 0.0,
        });
        const curbMesh = new THREE.Mesh(geom, mat);
        curbMesh.receiveShadow = true;
        this.scene.add(curbMesh);
    }

    _buildBarriers() {
        // Crash barriers outside the curbs
        const positions = [];
        const indices = [];
        const up = new THREE.Vector3(0, 1, 0);
        const halfW = this.roadWidth / 2 + CURB_WIDTH + 0.3;

        const barrierMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.5,
            metalness: 0.8,
        });

        this.barrierBoxes = []; // for collision

        // We build barriers as a series of short box segments for collision
        const barrierStep = 8; // every N samples, a new barrier box
        for (let side of [-1, 1]) {
            let box = null;
            for (let i = 0; i <= ROAD_SEGMENTS; i++) {
                const t = i / ROAD_SEGMENTS;
                const p = this.curve.getPointAt(t);
                const tan = this.curve.getTangentAt(t).normalize();
                const right = new THREE.Vector3().crossVectors(tan, up).normalize();

                // Two vertices: bottom and top of barrier (at distance halfW from center, side direction)
                const basePos = p.clone().addScaledVector(right, side * halfW);
                const bottom = basePos.clone();
                const top = basePos.clone(); top.y += BARRIER_HEIGHT;

                positions.push(bottom.x, bottom.y, bottom.z);
                positions.push(top.x, top.y, top.z);
            }
        }

        // Indices -- two strips (left & right)
        const stripLen = ROAD_SEGMENTS + 1;
        for (let i = 0; i < ROAD_SEGMENTS; i++) {
            // Left strip (starts at 0)
            {
                const base = i * 2;
                const next = base + 2;
                indices.push(base, base + 1, next);
                indices.push(base + 1, next + 1, next);
            }
            // Right strip (starts at stripLen*2)
            {
                const off = stripLen * 2;
                const base = off + i * 2;
                const next = base + 2;
                indices.push(base, next, base + 1);
                indices.push(base + 1, next, next + 1);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        const mesh = new THREE.Mesh(geom, barrierMat);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.scene.add(mesh);

        // Collision radius (distance from track centerline beyond which barriers are hit)
        // This replaces the old AABB approach which had false positives on curves.
        this.barrierDistance = this.roadWidth / 2 + CURB_WIDTH + 0.3;
        this.barrierBoxes = []; // kept for API compatibility but unused

        // Add vertical posts on barriers (visual detail)
        const postGeom = new THREE.CylinderGeometry(0.08, 0.08, BARRIER_HEIGHT + 0.3, 6);
        const postMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.6,
            metalness: 0.7,
        });
        const postInst = new THREE.InstancedMesh(postGeom, postMat, 2 * Math.floor(ROAD_SEGMENTS / 5));
        const dummy = new THREE.Object3D();
        let instIdx = 0;
        for (let side of [-1, 1]) {
            for (let i = 0; i < ROAD_SEGMENTS; i += 5) {
                if (instIdx >= postInst.count) break;
                const t = i / ROAD_SEGMENTS;
                const p = this.curve.getPointAt(t);
                const tan = this.curve.getTangentAt(t).normalize();
                const right = new THREE.Vector3().crossVectors(tan, up).normalize();
                const pos = p.clone().addScaledVector(right, side * halfW);
                dummy.position.set(pos.x, pos.y + BARRIER_HEIGHT / 2, pos.z);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                postInst.setMatrixAt(instIdx++, dummy.matrix);
            }
        }
        postInst.count = instIdx;
        postInst.instanceMatrix.needsUpdate = true;
        postInst.castShadow = true;
        this.scene.add(postInst);
    }

    _buildStartLine() {
        // Black & white checker rectangle across road at t=0
        const p = this.curve.getPointAt(0);
        const tan = this.curve.getTangentAt(0).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();

        const groupPos = p.clone();
        const lineGroup = new THREE.Group();

        // Checker pattern
        const cols = 14;
        const rows = 2;
        const cellW = this.roadWidth / cols;
        const cellD = 1.2;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const isBlack = (r + c) % 2 === 0;
                const mat = new THREE.MeshStandardMaterial({
                    color: isBlack ? 0x111111 : 0xffffff,
                    roughness: 0.5,
                    metalness: 0.0,
                });
                const geom = new THREE.BoxGeometry(cellW, 0.02, cellD);
                const mesh = new THREE.Mesh(geom, mat);
                mesh.receiveShadow = true;
                const xOff = (c - cols / 2 + 0.5) * cellW;
                const zOff = (r - rows / 2 + 0.5) * cellD;

                // Position: groupPos + right * xOff + forward * zOff
                const localX = right.clone().multiplyScalar(xOff);
                const localZ = tan.clone().multiplyScalar(zOff);
                const finalPos = groupPos.clone().add(localX).add(localZ);
                finalPos.y += 0.05;
                mesh.position.copy(finalPos);

                // Rotate to face along track
                mesh.rotation.y = Math.atan2(tan.x, tan.z);
                lineGroup.add(mesh);
            }
        }

        // Start gantry arch
        const archMat = new THREE.MeshStandardMaterial({
            color: 0xe63946,
            roughness: 0.5,
            metalness: 0.3,
        });
        const columnGeom = new THREE.BoxGeometry(0.5, 6, 0.5);
        const columnL = new THREE.Mesh(columnGeom, archMat);
        const columnR = new THREE.Mesh(columnGeom, archMat);
        const archTop = new THREE.Mesh(new THREE.BoxGeometry(this.roadWidth + 2, 0.8, 0.8), archMat);

        const archPos = groupPos.clone();
        const leftCol = archPos.clone().add(right.clone().multiplyScalar(-this.roadWidth / 2 - 1));
        leftCol.y += 3;
        columnL.position.copy(leftCol);

        const rightCol = archPos.clone().add(right.clone().multiplyScalar(this.roadWidth / 2 + 1));
        rightCol.y += 3;
        columnR.position.copy(rightCol);

        const topPos = archPos.clone();
        topPos.y += 6;
        archTop.position.copy(topPos);
        archTop.rotation.y = Math.atan2(tan.x, tan.z);

        columnL.castShadow = columnL.receiveShadow = true;
        columnR.castShadow = columnR.receiveShadow = true;
        archTop.castShadow = archTop.receiveShadow = true;

        lineGroup.add(columnL);
        lineGroup.add(columnR);
        lineGroup.add(archTop);

        // "FINISH" sign (using canvas texture)
        const signTex = this._createTextTexture('FINISH', 1024, 256, '#ffdd00', '#000000');
        const signMat = new THREE.MeshStandardMaterial({
            map: signTex,
            emissive: 0xffdd00,
            emissiveMap: signTex,
            emissiveIntensity: 0.3,
            roughness: 0.6,
        });
        const signGeom = new THREE.BoxGeometry(this.roadWidth + 1, 1.5, 0.2);
        const sign = new THREE.Mesh(signGeom, signMat);
        const signPos = topPos.clone(); signPos.y -= 1;
        sign.position.copy(signPos);
        sign.rotation.y = Math.atan2(tan.x, tan.z);
        lineGroup.add(sign);

        this.scene.add(lineGroup);
    }

    _createTextTexture(text, w, h, bg, fg) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = fg;
        ctx.font = `900 ${h * 0.7}px 'Impact', 'Arial Black', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 8;
        return tex;
    }

    _buildCheckpoints() {
        // Create invisible checkpoint triggers (not rendered)
        // They're placed at equal intervals along the curve
        const NUM_CHECKPOINTS = 8;
        this.checkpoints = [];
        for (let i = 0; i < NUM_CHECKPOINTS; i++) {
            const t = i / NUM_CHECKPOINTS;
            const p = this.curve.getPointAt(t);
            const tan = this.curve.getTangentAt(t).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(tan, up).normalize();
            this.checkpoints.push({
                index: i,
                t,
                position: p.clone(),
                tangent: tan.clone(),
                right: right.clone(),
                width: this.roadWidth,
            });
        }
    }

    /**
     * Get ground height at world (x, z). Returns the road surface if on track,
     * else returns a terrain height from the environment.
     */
    getGroundHeight(x, z) {
        // Find nearest sample on track
        let nearest = this._findNearestSample(x, z);
        if (nearest.distance < this.roadWidth * 0.55) {
            // On road, use road Y
            return this._samples[nearest.index].y;
        }
        // Off road: blend road Y with terrain (for now just return road Y slightly lower)
        return this._samples[nearest.index].y - 0.3;
    }

    /**
     * Returns true if the point (x, z) is on the road.
     */
    isOnRoad(x, z) {
        const n = this._findNearestSample(x, z);
        return n.distance < (this.roadWidth / 2 + 0.3);
    }

    /**
     * Find nearest sample on track to (x, z). Used for road queries.
     * Returns {index, distance, t}.
     */
    _findNearestSample(x, z) {
        let best = { index: 0, distance: Infinity, t: 0 };
        const n = this._samples.length;
        // Coarse search
        for (let i = 0; i < n; i += 4) {
            const s = this._samples[i];
            const dx = s.x - x;
            const dz = s.z - z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < best.distance) {
                best.distance = d;
                best.index = i;
            }
        }
        // Refine search in neighborhood
        const start = Math.max(0, best.index - 4);
        const end = Math.min(n - 1, best.index + 4);
        for (let i = start; i <= end; i++) {
            const s = this._samples[i];
            const dx = s.x - x;
            const dz = s.z - z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < best.distance) {
                best.distance = d;
                best.index = i;
            }
        }
        best.t = best.index / (n - 1);
        return best;
    }

    /**
     * Return the world-position of a point on the track at a given t and offset.
     * @param {number} t - curve parameter [0,1]
     * @param {number} lateralOffset - meters from center (+ = right)
     */
    getPathPoint(t, lateralOffset = 0) {
        t = ((t % 1) + 1) % 1;
        const p = this.curve.getPointAt(t);
        const tan = this.curve.getTangentAt(t).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();
        return p.clone().addScaledVector(right, lateralOffset);
    }

    getPathTangent(t) {
        t = ((t % 1) + 1) % 1;
        return this.curve.getTangentAt(t).normalize();
    }

    /**
     * Get t (progress 0..1) of a world position (for racing progress).
     */
    getTrackProgress(position) {
        const n = this._findNearestSample(position.x, position.z);
        return n.t;
    }

    _computeSpawnPoints() {
        // Grid: player in pole (front-left), AI cars staggered behind with ample spacing
        // so AI cannot bump player during initial acceleration.
        const spawns = [];
        const tan = this.curve.getTangentAt(0).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();
        const startP = this.curve.getPointAt(0);

        // Generous spacing: 8m between rows (collision radius sum = 4.4m)
        const carGap = 8;
        const sideOffset = 3.5;
        const heading = Math.atan2(tan.x, tan.z);

        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 2; col++) {
                const backZ = -(row * carGap + 8);
                const lateralX = (col === 0 ? -1 : 1) * sideOffset;

                const local = right.clone().multiplyScalar(lateralX)
                    .add(tan.clone().multiplyScalar(backZ));

                const pos = startP.clone().add(local);
                pos.y += 0.5;
                spawns.push({ position: pos, heading });
            }
        }
        return spawns;
    }

    getTotalLength() {
        return this.totalLength;
    }

    /**
     * Returns the finish/start line's t value (0 for this track).
     */
    getFinishLineT() {
        return 0;
    }

    /**
     * Check and resolve barrier collision for a car.
     * Uses distance from track centerline rather than AABBs.
     * @param {Car} car - the car to check
     * @returns {boolean} true if collision occurred this frame
     */
    checkBarrierCollision(car) {
        const p = car.position;
        const nearest = this._findNearestSample(p.x, p.z);
        const centerline = this._samples[nearest.index];
        const tangent = this._sampleTangents[nearest.index];

        // Distance from car to centerline, and direction (perpendicular)
        const dx = p.x - centerline.x;
        const dz = p.z - centerline.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < this.barrierDistance) return false; // inside track + some margin, no collision

        // Car is past the barrier -- compute collision normal (pointing from car back toward road)
        const nx = -dx / dist;
        const nz = -dz / dist;

        // Push car back to the barrier boundary + tiny epsilon
        const correction = dist - this.barrierDistance + 0.05;
        p.x += nx * correction;
        p.z += nz * correction;

        // Reflect velocity against the barrier wall (component perpendicular to barrier)
        // nx/nz points from barrier inward (toward road center). Velocity component along -n is the into-wall component.
        const vDotN = car.velocity.x * nx + car.velocity.z * nz;
        if (vDotN < 0) {
            // Velocity has component going into the wall; remove + bounce
            const bounce = -0.4; // 40% bounce
            car.velocity.x -= vDotN * (1 + bounce) * nx;
            car.velocity.z -= vDotN * (1 + bounce) * nz;
        }

        // Apply damping to overall speed (scraping along wall slows you down)
        car.velocity.multiplyScalar(0.92);

        return true;
    }
}
