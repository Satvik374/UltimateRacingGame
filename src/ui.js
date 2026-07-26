/**
 * ui.js
 * HUD elements: speedometer, minimap, lap timer, notifications, RPM.
 */

const TICK_COUNT = 13;
const SPEED_MAX = 300; // km/h, needle range

export class UI {
    constructor(track) {
        this.track = track;

        // Cached DOM elements
        this.el = {
            hud: document.getElementById('hud'),
            speed: document.getElementById('hud-speed'),
            gear: document.getElementById('hud-gear'),
            boost: document.getElementById('hud-boost'),
            lapCur: document.getElementById('hud-lap-current'),
            lapTot: document.getElementById('hud-lap-total'),
            lapTime: document.getElementById('hud-lap-time'),
            bestTime: document.getElementById('hud-best-time'),
            position: document.getElementById('hud-position'),
            positionPanel: document.getElementById('hud-position-panel'),
            notification: document.getElementById('hud-notification'),
            countdown: document.getElementById('hud-countdown'),
            needle: document.getElementById('speedo-needle'),
            rpmArc: document.getElementById('rpm-arc'),
            ticks: document.getElementById('speedo-ticks'),
            minimap: document.getElementById('minimap'),
        };

        this.minimapCtx = this.el.minimap.getContext('2d');

        // Notification queue
        this.notifQueue = [];
        this.notifTimer = 0;

        // HUD visible?
        this.visible = true;

        // Precompute minimap transforms
        this._computeMinimapBounds();

        // Draw static tick marks on speedometer
        this._drawTicks();
    }

    setVisible(v) {
        this.visible = v;
        if (v) this.el.hud.classList.remove('hidden');
        else this.el.hud.classList.add('hidden');
    }

    toggleVisible() {
        this.setVisible(!this.visible);
    }

    setRaceMode(totalLaps, showPosition = true) {
        this.el.lapTot.textContent = totalLaps;
        if (showPosition) {
            this.el.positionPanel.classList.remove('hidden');
        } else {
            this.el.positionPanel.classList.add('hidden');
        }
    }

    _computeMinimapBounds() {
        // Get track bounding box
        const samples = this.track._samples;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const s of samples) {
            if (s.x < minX) minX = s.x;
            if (s.x > maxX) maxX = s.x;
            if (s.z < minZ) minZ = s.z;
            if (s.z > maxZ) maxZ = s.z;
        }
        const pad = 40;
        minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
        this.minimapBounds = { minX, maxX, minZ, maxZ };
    }

    _worldToMinimap(x, z) {
        const b = this.minimapBounds;
        const w = this.el.minimap.width;
        const h = this.el.minimap.height;
        const u = (x - b.minX) / (b.maxX - b.minX);
        const v = (z - b.minZ) / (b.maxZ - b.minZ);
        return { x: u * w, y: v * h };
    }

    _drawTicks() {
        const svg = this.el.ticks;
        svg.innerHTML = '';
        const cx = 100, cy = 100, rOuter = 88, rInner = 78, rText = 68;
        const startA = Math.PI * 0.75;  // bottom-left
        const endA = Math.PI * 2.25;    // bottom-right (sweep 270deg)
        for (let i = 0; i < TICK_COUNT; i++) {
            const f = i / (TICK_COUNT - 1);
            const a = startA + (endA - startA) * f;
            const x1 = cx + Math.cos(a) * rInner;
            const y1 = cy + Math.sin(a) * rInner;
            const x2 = cx + Math.cos(a) * rOuter;
            const y2 = cy + Math.sin(a) * rOuter;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('stroke', f > 0.75 ? '#e74c3c' : '#ffffff');
            line.setAttribute('stroke-width', i % 2 === 0 ? '2' : '1');
            svg.appendChild(line);

            // Label every other tick
            if (i % 2 === 0) {
                const val = Math.round(SPEED_MAX * f);
                const tx = cx + Math.cos(a) * rText;
                const ty = cy + Math.sin(a) * rText + 4;
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', tx);
                text.setAttribute('y', ty);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', f > 0.75 ? '#e74c3c' : '#aaa');
                text.setAttribute('font-size', '11');
                text.setAttribute('font-family', 'Consolas, monospace');
                text.setAttribute('font-weight', '700');
                text.textContent = val;
                svg.appendChild(text);
            }
        }
    }

    /**
     * Update speedometer needle based on speed (km/h).
     */
    updateSpeedometer(speedKmh, rpmRatio, gear, boostRatio) {
        // Needle rotation: 0 km/h = 135deg, 300 km/h = 45deg (sweep 270deg)
        const speed = Math.min(SPEED_MAX, Math.max(0, speedKmh));
        const f = speed / SPEED_MAX;
        const angle = -90 + (135 + f * 270); // in deg
        this.el.needle.setAttribute('transform', `rotate(${angle} 100 100)`);

        // Digital speed
        this.el.speed.textContent = Math.round(speed);

        // Gear
        this.el.gear.textContent = gear;

        // Boost bar
        this.el.boost.style.width = `${Math.round(boostRatio * 100)}%`;

        // RPM arc (dashed red as RPM increases)
        const r = 70;
        const startA = Math.PI * 0.75;
        const endA = startA + rpmRatio * Math.PI * 1.5;
        const x1 = 100 + Math.cos(startA) * r;
        const y1 = 100 + Math.sin(startA) * r;
        const x2 = 100 + Math.cos(endA) * r;
        const y2 = 100 + Math.sin(endA) * r;
        const largeArc = rpmRatio * 1.5 > 1 ? 1 : 0;
        const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
        this.el.rpmArc.setAttribute('d', d);
    }

    /**
     * Update lap info.
     */
    updateLap(currentLap, totalLaps, currentLapMs, bestLapMs) {
        this.el.lapCur.textContent = Math.max(1, Math.min(totalLaps, currentLap));
        this.el.lapTime.textContent = formatTime(currentLapMs);
        this.el.bestTime.textContent = bestLapMs > 0 ? formatTime(bestLapMs) : '--:--.--';
    }

    updatePosition(pos, total) {
        this.el.position.textContent = `${pos}/${total}`;
    }

    /**
     * Show a transient notification (e.g. "CHECKPOINT", "LAP 2/3", "NEW BEST!")
     */
    showNotification(text, durationMs = 1500) {
        this.el.notification.textContent = text;
        this.el.notification.classList.remove('show');
        // Force reflow to restart animation
        void this.el.notification.offsetWidth;
        this.el.notification.classList.add('show');

        setTimeout(() => {
            this.el.notification.classList.remove('show');
        }, durationMs);
    }

    showCountdown(text) {
        this.el.countdown.textContent = text;
        this.el.countdown.classList.remove('hidden');
        // Re-trigger animation
        this.el.countdown.style.animation = 'none';
        void this.el.countdown.offsetWidth;
        this.el.countdown.style.animation = '';
    }

    hideCountdown() {
        this.el.countdown.classList.add('hidden');
    }

    /**
     * Draw minimap: track outline + car dots.
     */
    updateMinimap(cars, playerCar) {
        const ctx = this.minimapCtx;
        const w = this.el.minimap.width;
        const h = this.el.minimap.height;
        ctx.clearRect(0, 0, w, h);

        // Background (circular clip)
        ctx.save();
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(20, 25, 40, 0.6)';
        ctx.fillRect(0, 0, w, h);

        // Draw track
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const samples = this.track._samples;
        for (let i = 0; i < samples.length; i++) {
            const p = samples[i];
            const m = this._worldToMinimap(p.x, p.z);
            if (i === 0) ctx.moveTo(m.x, m.y);
            else ctx.lineTo(m.x, m.y);
        }
        ctx.stroke();

        // Inner track line
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Finish line
        const fp = samples[0];
        const fm = this._worldToMinimap(fp.x, fp.z);
        ctx.fillStyle = '#ffdd00';
        ctx.beginPath();
        ctx.arc(fm.x, fm.y, 5, 0, Math.PI * 2);
        ctx.fill();

        // Cars
        for (const c of cars) {
            const m = this._worldToMinimap(c.position.x, c.position.z);
            ctx.fillStyle = c === playerCar ? '#f1c40f' : '#e74c3c';
            ctx.beginPath();
            ctx.arc(m.x, m.y, c === playerCar ? 5 : 3.5, 0, Math.PI * 2);
            ctx.fill();

            if (c === playerCar) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Direction arrow
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(m.x, m.y);
                const headX = m.x + Math.sin(c.heading) * 8;
                const headY = m.y + Math.cos(c.heading) * 8;
                ctx.lineTo(headX, headY);
                ctx.stroke();
            }
        }

        ctx.restore();

        // Outer ring border
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
        ctx.stroke();
    }
}

export function formatTime(ms) {
    if (!isFinite(ms) || ms < 0) return '--:--.--';
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = Math.floor(totalSec % 60);
    const cs = Math.floor((totalSec * 100) % 100);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
