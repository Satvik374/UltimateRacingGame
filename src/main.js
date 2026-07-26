/**
 * main.js
 * Application bootstrap: loading screen, menu system, game initialization,
 * and the main animation loop.
 */

import { Game } from './game.js';
import { formatTime } from './ui.js';

// ===== DOM references =====
const $ = (id) => document.getElementById(id);

const els = {
    loadingScreen: $('loading-screen'),
    loadingBar: $('loading-bar'),
    loadingText: $('loading-text'),
    mainMenu: $('main-menu'),
    settingsPanel: $('settings-panel'),
    controlsPanel: $('controls-panel'),
    pauseMenu: $('pause-menu'),
    raceFinish: $('race-finish'),
    finishTitle: $('finish-title'),
    finishStats: $('finish-stats'),
    canvas: $('game-canvas'),
    hud: $('hud'),
    qualitySelect: $('quality-select'),
    shadowsToggle: $('shadows-toggle'),
    postfxToggle: $('postfx-toggle'),
    motionBlurToggle: $('motion-blur-toggle'),
    volumeSlider: $('volume-slider'),
};

let game = null;
let selectedColor = '#f1c40f';

// ===== Loading progress helper =====
function setLoadingProgress(pct, text) {
    if (els.loadingBar) els.loadingBar.style.width = `${Math.round(pct * 100)}%`;
    if (els.loadingText && text) els.loadingText.textContent = text;
}

function showScreen(name) {
    // Hide all overlays
    els.loadingScreen.classList.add('hidden');
    els.mainMenu.classList.add('hidden');
    els.settingsPanel.classList.add('hidden');
    els.controlsPanel.classList.add('hidden');
    els.pauseMenu.classList.add('hidden');
    els.raceFinish.classList.add('hidden');

    // Hide HUD unless in-game
    if (name !== 'ingame' && els.hud) els.hud.classList.add('hidden');

    switch (name) {
        case 'loading': els.loadingScreen.classList.remove('hidden'); break;
        case 'menu': els.mainMenu.classList.remove('hidden'); break;
        case 'settings': els.settingsPanel.classList.remove('hidden'); break;
        case 'controls': els.controlsPanel.classList.remove('hidden'); break;
        case 'pause': els.pauseMenu.classList.remove('hidden'); break;
        case 'finish': els.raceFinish.classList.remove('hidden'); break;
        case 'ingame':
            if (game && game.ui && game.ui.visible) els.hud.classList.remove('hidden');
            break;
    }
}

// ===== Menu event handlers =====
function setupMenuHandlers() {
    // Mode buttons
    document.querySelectorAll('.menu-btn[data-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            startGame(mode);
        });
    });

    // Color swatches
    document.querySelectorAll('.swatch').forEach((s) => {
        s.addEventListener('click', () => {
            document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('selected'));
            s.classList.add('selected');
            selectedColor = s.dataset.color;
            if (game && game.playerCar) {
                game.playerCar.setColor(selectedColor);
            }
        });
    });

    // Settings button
    $('settings-btn').addEventListener('click', () => showScreen('settings'));
    $('controls-btn').addEventListener('click', () => showScreen('controls'));
    $('settings-close').addEventListener('click', () => showScreen('menu'));
    $('controls-close').addEventListener('click', () => showScreen('menu'));

    // Settings changes
    els.qualitySelect.addEventListener('change', (e) => {
        if (game) game.applySettings({ quality: e.target.value });
    });
    els.shadowsToggle.addEventListener('change', (e) => {
        if (game) game.applySettings({ shadows: e.target.checked });
    });
    els.postfxToggle.addEventListener('change', (e) => {
        if (game) game.applySettings({ postfx: e.target.checked });
    });
    els.motionBlurToggle.addEventListener('change', (e) => {
        if (game) game.applySettings({ motionBlur: e.target.checked });
    });
    els.volumeSlider.addEventListener('input', (e) => {
        if (game) game.applySettings({ volume: parseFloat(e.target.value) / 100 });
    });

    // Pause menu
    $('resume-btn').addEventListener('click', () => {
        showScreen('ingame');
        game.resume();
    });
    $('restart-btn').addEventListener('click', () => {
        showScreen('ingame');
        game.restart();
    });
    $('quit-btn').addEventListener('click', () => {
        game.quitToMenu();
        showScreen('menu');
    });

    // Finish screen
    $('finish-again-btn').addEventListener('click', () => {
        showScreen('ingame');
        game.restart();
    });
    $('finish-quit-btn').addEventListener('click', () => {
        game.quitToMenu();
        showScreen('menu');
    });
}

// ===== Start game =====
function startGame(mode) {
    const color = parseInt(selectedColor.replace('#', ''), 16);
    game.start(mode, color);
    showScreen('ingame');
}

// ===== Pause callback =====
function onPauseRequested() {
    if (!game) return;
    if (game.state === 'playing') {
        game.pause();
        showScreen('pause');
    }
}

// ===== Race finish callback =====
function onRaceFinish(result) {
    // Build stats HTML
    let html = '';
    const pos = result.position;
    const suffix = (n) => {
        if (n === 1) return 'st';
        if (n === 2) return 'nd';
        if (n === 3) return 'rd';
        return 'th';
    };
    els.finishTitle.textContent = pos === 1 ? 'VICTORY!' : `${pos}${suffix(pos)} PLACE`;

    html += `<div class="stat-line"><span>Position</span><span class="stat-value">${pos} / ${result.totalCars}</span></div>`;
    html += `<div class="stat-line"><span>Total Time</span><span class="stat-value">${formatTime(result.totalTime)}</span></div>`;
    if (result.bestLap > 0) {
        html += `<div class="stat-line"><span>Best Lap</span><span class="stat-value">${formatTime(result.bestLap)}</span></div>`;
    }
    for (let i = 0; i < result.lapTimes.length; i++) {
        html += `<div class="stat-line"><span>Lap ${i + 1}</span><span class="stat-value">${formatTime(result.lapTimes[i])}</span></div>`;
    }

    els.finishStats.innerHTML = html;
    showScreen('finish');
}

// ===== Main loop =====
function animate(now) {
    requestAnimationFrame(animate);
    if (game) game.update(now);
}

// ===== Error handling =====
function showError(message, details = '') {
    const msg = `
        <div style="text-align:center; padding:2rem; max-width:600px;">
            <h2 style="color:#e74c3c">Game Failed to Load</h2>
            <p style="margin-top:1rem; color:#ddd;">${message}</p>
            ${details ? `<pre style="margin-top:1rem; background:rgba(0,0,0,0.3); padding:1rem; border-radius:6px; font-size:0.75rem; text-align:left; overflow:auto; max-height:200px;">${details}</pre>` : ''}
            <p style="margin-top:2rem; color:#888; font-size:0.85rem;">Make sure you're running this from a local HTTP server (not file://).<br>See README.md for instructions.</p>
        </div>
    `;
    els.loadingScreen.querySelector('.loading-content').innerHTML = msg;
}

// ===== Bootstrap =====
async function main() {
    if (!window.WebGL2RenderingContext || !document.createElement('canvas').getContext('webgl2')) {
        showError('Your browser does not support WebGL 2. Please use an up-to-date browser (Chrome, Edge, Firefox).');
        return;
    }

    try {
        setLoadingProgress(0.02, 'Loading modules...');

        game = new Game(els.canvas);
        game.onPauseRequested = onPauseRequested;
        game.onRaceFinish = onRaceFinish;
        window.game = game; // expose for debugging

        await game.init((pct, text) => setLoadingProgress(pct, text));

        setupMenuHandlers();

        // Hide loading, show menu
        els.loadingScreen.classList.add('fade-out');
        setTimeout(() => {
            showScreen('menu');
        }, 600);

        // Start render loop
        requestAnimationFrame(animate);
    } catch (e) {
        console.error('Game init failed:', e);
        showError('Something went wrong during initialization.', (e.stack || e.message || String(e)));
    }
}

// Wait for DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
