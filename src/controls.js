/**
 * controls.js
 * Keyboard input manager for the racing game.
 * Tracks held keys and exposes a normalized input state.
 */

export class Controls {
    constructor() {
        this.keys = new Set();
        this.pressedThisFrame = new Set();
        this.enabled = true;

        // Normalized input values
        this.state = {
            throttle: 0,     // 0..1
            brake: 0,        // 0..1
            steer: 0,        // -1..1 (left..right)
            handbrake: false,
            boost: false,
            cameraToggle: false,
            reset: false,
            pause: false,
            hudToggle: false,
        };

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onBlur = this._onBlur.bind(this);

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
    }

    _onKeyDown(e) {
        if (!this.enabled) return;

        // Prevent default scrolling for arrow keys and space
        const preventKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
        if (preventKeys.includes(e.code)) e.preventDefault();

        if (!this.keys.has(e.code)) {
            this.pressedThisFrame.add(e.code);
        }
        this.keys.add(e.code);
    }

    _onKeyUp(e) {
        this.keys.delete(e.code);
    }

    _onBlur() {
        // Clear all keys when window loses focus to prevent stuck inputs
        this.keys.clear();
        this.pressedThisFrame.clear();
    }

    /**
     * Check if a key is currently held down.
     * @param {string} code - KeyboardEvent.code value
     */
    isDown(code) {
        return this.keys.has(code);
    }

    /**
     * Check if a key was pressed this frame (transition from up->down).
     * @param {string} code - KeyboardEvent.code value
     */
    wasPressed(code) {
        return this.pressedThisFrame.has(code);
    }

    /**
     * Update normalized input state. Call once per frame BEFORE reading state.
     */
    update() {
        // Throttle (W / ArrowUp)
        this.state.throttle = (this.isDown('KeyW') || this.isDown('ArrowUp')) ? 1 : 0;

        // Brake (S / ArrowDown)
        this.state.brake = (this.isDown('KeyS') || this.isDown('ArrowDown')) ? 1 : 0;

        // Steering (A/D / Left/Right) -- with slight analog feel via ramp
        let steer = 0;
        if (this.isDown('KeyA') || this.isDown('ArrowLeft')) steer -= 1;
        if (this.isDown('KeyD') || this.isDown('ArrowRight')) steer += 1;
        this.state.steer = steer;

        // Handbrake
        this.state.handbrake = this.isDown('Space');

        // Boost
        this.state.boost = this.isDown('ShiftLeft') || this.isDown('ShiftRight');

        // One-shot keys
        this.state.cameraToggle = this.wasPressed('KeyC');
        this.state.reset = this.wasPressed('KeyR');
        this.state.pause = this.wasPressed('Escape');
        this.state.hudToggle = this.wasPressed('KeyH');

        // Clear per-frame pressed set after reading
        this.pressedThisFrame.clear();
    }

    /**
     * Stop listening to input (e.g. when game is paused).
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.keys.clear();
            this.pressedThisFrame.clear();
            // Reset state
            this.state.throttle = 0;
            this.state.brake = 0;
            this.state.steer = 0;
            this.state.handbrake = false;
            this.state.boost = false;
        }
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
    }
}
