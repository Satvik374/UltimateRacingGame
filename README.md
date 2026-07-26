# Ultimate Racing — 3D Car Racing Game

A browser-based 3D arcade racing game built with **Three.js**. Features two game modes, realistic car physics, AI opponents, dynamic lighting, and post-processing effects.

## Quick Start (Windows)

1. **Double-click `serve.bat`** — it will:
   - Start a local web server on port 8000
   - Automatically open your browser at `http://localhost:8000`
2. **Click a game mode** from the menu to begin.

That's it! The script tries Python first, then falls back to Node.js.

## Alternative Ways to Run

### Python (any OS)
```bash
cd UltimateRacingGame
python -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

### Node.js (any OS)
```bash
cd UltimateRacingGame
npx serve -l 8000 .
```

### VS Code
Install the **Live Server** extension, right-click `index.html`, select *"Open with Live Server"*.

> **Why a local server?** Browsers block ES modules from the `file://` protocol for security. Any simple HTTP server will work.

## Game Modes

### Race Mode
- 3 laps against 4 AI opponents
- Position tracking, overtaking, finish line
- Countdown before start

### Free Roam + Time Trial
- Drive freely around the environment
- Lap timer tracks your best time
- Best lap is saved to browser `localStorage`

## Controls

| Key | Action |
|-----|--------|
| **W** / **&uarr;** | Accelerate |
| **S** / **&darr;** | Brake / Reverse |
| **A** / **&larr;** | Steer Left |
| **D** / **&rarr;** | Steer Right |
| **Space** | Handbrake (Drift) |
| **Shift** | Turbo Boost |
| **C** | Cycle Camera (Chase / Hood / Cinematic) |
| **R** | Reset to Last Checkpoint |
| **Esc** | Pause / Menu |
| **H** | Toggle HUD |

## Graphics Settings

Click **SETTINGS** from the main menu to adjust:

- **Quality Preset**: Low / Medium / High / Ultra
- **Shadows**: Dynamic shadow casting
- **Post-Processing**: Bloom + SSAO effects
- **Motion Blur**: Radial speed blur
- **Master Volume**: Engine and SFX volume

If you experience lag, try **Low** or **Medium** quality first.

## Technical Stack

- **Three.js r160** — WebGL 2.0 rendering (loaded via CDN import maps)
- **Web Audio API** — Synthesized engine sound (no audio files)
- **Vanilla JavaScript ES6 modules** — No build step, no bundler needed
- **CSS3** — HUD, menus, animations

## System Requirements

- Any modern browser with WebGL 2.0 (Chrome, Edge, Firefox, Safari 15+)
- Decent GPU for smooth 60 FPS at High/Ultra settings
- First load downloads ~600 KB of Three.js from CDN

## File Structure

```
UltimateRacingGame/
├── index.html                   # Entry with import maps
├── style.css                    # HUD + menu styling
├── serve.bat                    # One-click server launcher
├── README.md                    # This file
└── src/
    ├── main.js                  # Bootstrap + menu logic
    ├── game.js                  # Game loop + state machine
    ├── car.js                   # Procedural car + physics
    ├── track.js                 # Spline-based race track
    ├── environment.js           # Terrain, trees, skybox, mountains
    ├── camera.js                # Chase/hood/cinematic cameras
    ├── controls.js              # Keyboard input
    ├── ai.js                    # AI opponent drivers
    ├── ui.js                    # Speedometer, minimap, lap timer
    ├── sound.js                 # Web Audio engine sound
    └── postprocessing.js        # Bloom, motion blur, SMAA, vignette
```

## Tips & Tricks

- **Drift through corners** by tapping Space during turns — you'll slide but keep momentum.
- **Save boost for straights** — it replenishes faster when off throttle.
- **Cycle cameras** with C — hood cam gives the best speed feel, cinematic is best for screenshots.
- **Press R** if you fall off track or get stuck.
- **Time Trial**: your best lap is saved per mode. Try to beat it!

## Known Limitations

This is a browser-based arcade game built in a single session. It does **not** match AAA titles like Forza Horizon in:

- Photorealism (cars are stylized procedural geometry)
- World size (one track vs. 2400 km&sup2; open world)
- Physics depth (arcade-style vs. full simulation)
- Vehicle variety (one procedural car with color options)

But it should still be fun to play!

## License

MIT — use freely for personal or educational purposes.
