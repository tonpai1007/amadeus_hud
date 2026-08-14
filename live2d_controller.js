/**
 * Live2D Controller — AMADEUS Kurisu Avatar (v3.1 — Multi-SDK support)
 * Full motion utilization: Cubism 2 and Cubism 3/4 support.
 * Ambient motion system, lifelike idle cycling, click interaction, and manual controls.
 *
 * v3.2 additions:
 *   - Auto-detect Cubism 2 (.moc) vs Cubism 3/4 (.moc3)
 *   - Dynamic parameter name mapping (set/add abstraction helpers)
 *   - Visual Controls support (arm pose change, cheek blushing)
 *   - Proximity awareness: cursor near the face drives blush/breathing/gaze
 *
 * Uses pixi-live2d-display (Cubism 2/4 bundle) + PixiJS.
 */

// Emotional stage-light palette. Each of her moods shifts the aura hue and
// brightness; `flash` marks strong emotions that fire a brief light surge via
// setEmotion(). Cool cyan is the neutral Amadeus look.
const EMOTION_AURA = {
    neutral:       { r: 204, g:  50, b:  53, glow: 0.06 },
    calm:          { r: 255, g: 110, b: 120, glow: 0.05 },
    content:       { r: 255, g: 170, b: 180, glow: 0.07 },
    amused:        { r: 255, g: 175, b: 200, glow: 0.11 },
    smug:          { r: 255, g: 200, b: 120, glow: 0.09, flash: true },
    proud:         { r: 255, g: 130, b: 110, glow: 0.13, flash: true },
    jealous:       { r: 255, g:  60, b: 160, glow: 0.18, flash: true },
    happy:         { r: 255, g: 120, b: 170, glow: 0.11 },
    excited:       { r: 255, g:  95, b: 150, glow: 0.16, flash: true },
    surprised:     { r: 255, g: 180, b: 200, glow: 0.14, flash: true },
    curious:       { r: 235, g: 120, b: 140, glow: 0.08 },
    focused:       { r: 230, g:  90, b: 110, glow: 0.07 },
    confused:      { r: 240, g: 150, b: 170, glow: 0.09 },
    thinking:      { r: 230, g:  80, b: 100, glow: 0.07 },
    angry:         { r: 255, g:  65, b:  70, glow: 0.20, flash: true },
    annoyed:       { r: 255, g: 130, b:  75, glow: 0.10 },
    frustrated:    { r: 255, g: 100, b:  65, glow: 0.14 },
    sad:           { r: 160, g:  70, b: 110, glow: 0.03 },
    bitter:        { r: 140, g:  60, b:  90, glow: 0.03 },
    tired:         { r: 170, g: 100, b: 120, glow: 0.04 },
    sleepy:        { r: 150, g:  85, b: 110, glow: 0.03 },
    sleeping:      { r: 120, g:  60, b:  90, glow: 0.025 },
};

class Live2DController {
    constructor(canvasId, modelPath) {
        this.canvasId = canvasId;
        this.modelPath = modelPath;
        this.app = null;
        this.model = null;
        this.currentEmotion = 'neutral';
        this.isSpeaking = false;
        this.isThinking = false;
        this.isTyping = false;
        this.attachmentState = {};
        this.emotionState = {};
        this._ambientTimer = null;
        this._idleTimer = null;
        this._ready = false;
        this._isCubism4 = false;
        this._emotionHoldUntil = 0; // explicit emotions hold this long before the mood evaluator resumes

        // Parameter smoothing: store target values for smooth interpolation
        this._paramTargets = {};     // { paramId: targetValue }
        this._paramCurrent = {};     // { paramId: currentValue }
        this._paramSpeed = {};       // { paramId: lerpFactor }
        this._smoothedParams = new Set();

        // Physics tuning: audio-reactive physics scaling
        this._physicsScale = 1.0;    // global physics intensity multiplier
        this._physicsScaleTarget = 1.0;
        this._physicsAudioBoost = 0.3; // extra physics intensity during audio peaks
        this._basePhysicsScale = 1.0;  // base physics scale when idle

        // Visual controls (Kurisu Cubism 4 model overrides)
        this.armChangeActive = false;
        this.blushLevel = 0; // 0 = none, 1 = blush 1 (0.5), 2 = blush 2 (1.0)

        // Pet mode: freely draggable mini-Kurisu (toggled from the HUD button)
        this._petMode = false;
        this._petPendingPos = null; // position queued while the model is still loading
        this._petDragCount = 0;      // total drag interactions for reactions
        this._petReactionActive = false; // prevents overlapping pet reactions
        this._lastPetInteraction = 0; // timestamp of last drag interaction

        // "Peek" reaction: brief glance toward the side the user returned from.
        this._peek = { active: false, dir: 1, started: 0, until: 0 };
        this._peekEnv = 0;          // eased envelope (0..1) set by _updatePeek
        this._userAway = false;     // true while the user is away (focus loss / pause)

        // Hold-to-pet: press and hold on the model without dragging.
        this._holdTimer = null;     // pending "hold" timer from pointerdown
        this._holding = false;      // true once the hold has fired

        // Head sway system (Phase 15/Alive enhancements)
        this._headSway = {
            phaseX: 0,
            phaseY: Math.PI * 0.33,
            phaseZ: Math.PI * 0.66,
            speedX: 0.0007,
            speedY: 0.0005,
            speedZ: 0.0006,
            amplitudeX: 1.5,
            amplitudeY: 1.0,
            amplitudeZ: 2.0,
            valueX: 0,
            valueY: 0,
            valueZ: 0,
        };

        // Conversational gaze aversion
        this._gazeAversion = {
            active: false,
            targetX: 0,
            targetY: 0,
            nextTriggerTime: 0,
            endTime: 0,
        };

        // Default configurations for Cubism 2 (fallback)
        this._ambientMotions = ['pinch_in', 'pinch_out', 'flick_head', 'tap_body'];
        this._allExpressions = ['f01', 'f02', 'f03', 'f04', 'f05'];

        // ═══════════════════════════════════════════════════════════════
        // v3.0 — Lifelike Animation State (AIRI-inspired)
        // ═══════════════════════════════════════════════════════════════

        // Auto-blink system
        this._blink = {
            nextBlinkTime: 0,          // timestamp for next blink
            phase: 'open',             // 'open' | 'closing' | 'closed' | 'opening'
            phaseStart: 0,             // when current phase started
            closeDuration: 80,         // ms to close eyes
            closedDuration: 50,        // ms eyes stay closed
            openDuration: 120,         // ms to open eyes
            minInterval: 2000,         // min ms between blinks
            maxInterval: 6000,         // max ms between blinks
            doubleBlink: false,        // whether to do a double-blink
            doubleBlinkChance: 0.15,   // 15% chance of double-blink
            value: 1.0,                // current eye openness (1 = fully open)
        };

        // Breathing system
        this._breath = {
            phase: 0,                  // sinusoidal phase
            speed: 0.0015,             // radians per ms (~4.2s per cycle)
            amplitude: 0.5,            // max breath value
            value: 0,                  // current breath value
        };

        // Body sway system
        this._sway = {
            phaseZ: 0,                 // body angle Z phase
            phaseX: Math.PI * 0.5,     // body angle X phase (offset so they don't sync)
            speedZ: 0.0008,            // ~7.8s cycle for Z sway
            speedX: 0.0005,            // ~12.6s cycle for X sway
            amplitudeZ: 1.5,           // max degrees Z tilt
            amplitudeX: 0.8,           // max degrees X lean
            valueZ: 0,
            valueX: 0,
        };

        // Idle eye micro-movements
        this._idleEyes = {
            currentX: 0,               // current eye ball X (-1 to 1)
            currentY: 0,               // current eye ball Y (-1 to 1)
            targetX: 0,                // target eye ball X
            targetY: 0,                // target eye ball Y
            nextChangeTime: 0,         // when to pick new target
            minInterval: 3000,         // min ms between eye shifts
            maxInterval: 8000,         // max ms between eye shifts
            lerpSpeed: 0.003,          // interpolation speed per ms
            amplitude: 0.3,            // max offset from center
            active: true,              // disabled when mouse is actively moving
        };

        // Mouse activity tracking (to suppress idle eyes during active mouse)
        this._mouseActivity = {
            lastMoveTime: 0,
            idleThreshold: 2000,       // ms of mouse inactivity before idle eyes activate
        };
        // Cursor-velocity tracking for the fast-flick glance reaction
        this._lastMoveAt = 0;
        this._lastMoveX = 0;
        this._lastMoveY = 0;
        this._cursorVelocity = 0;
        this._flinchAt = 0;            // cooldown guard for flick glances

        // Startle breath-hold: a short pause in breathing right after surprise
        this._breathHoldUntil = 0;

        // Cold-night shiver: subtle periodic tremor when her mood is cold
        this._shiver = { active: false, until: 0, nextAt: performance.now() + 15000 };

        // Proximity awareness: how close the cursor is to Kurisu's face (0..1).
        // Drives blush, breathing intensity, and how much she glances around.
        this._proximity = 0;
        this._cursorNX = 1.5; // init far away so she starts neutral
        this._cursorNY = 1.5;

        // Ambient moods: rare, subtle smile/blush moments that fade in/out.
        this._ambientMood = { type: 'none', value: 0, expireAt: undefined, timer: null };

        // Pause flag set by pause()/resume() so timers can be gated
        this._paused = false;

        // Stage spotlight tint (updated from proximity + emotion, throttled)
        this._auraEl = null;
        this._lastAuraP = -1;
        this._lastAuraColor = '';
        this._lastEmo = '';
        this._lastFlash = 0;
        this._auraFlashUntil = 0;

        // Eyebrow micro-expressions
        this._brows = {
            currentL: 0,               // current left brow offset
            currentR: 0,               // current right brow offset
            targetL: 0,
            targetR: 0,
            nextChangeTime: 0,
            minInterval: 5000,
            maxInterval: 15000,
            lerpSpeed: 0.002,
            amplitude: 0.15,           // subtle brow movement
        };

        // RAF handle for cleanup
        this._rafHandle = null;
        this._lastFrameTime = 0;
        this._lastAnimTick = 0;        // frame gate for the parameter pipeline
        this._animInterval = 1000 / 30; // param updates capped to render rate
        this._activeMaxFps = 30;        // active render cap (governor may lower it)

        // Idle power-saving mode (set from wallpaper.js when system is silent)
        this._idleMode = false;

        // Feature toggles (mirrors the settings panel via wallpaper.js) so
        // users can switch off the cosmetic/mood systems individually.
        this._features = {
            idleGestures: true,
            ambientMotions: true,
            easterEggs: true,
            musicMood: true,
            postureFatigue: true,
        };

        // Emotion engine — derives a live emotional state from real context
        // (audio energy, speech, proximity, click surprises, long quiet spells)
        // so the procedural face/body subsystems have something to respond to.
        this._audioEnergy = 0;            // bass energy fed by wallpaper.js (0..1)
        this._musicEnergy = 0;            // smoothed overall track energy (0..1)
        this._musicEnergyTarget = 0;      // feed target from setMusicEnergy()
        this._lastAudioTime = 0;          // last time real audio was heard
        this._lastActivityTime = performance.now(); // audio or mouse activity
        this._surpriseUntil = 0;          // end of current surprised reaction
        this._lastSurprise = 0;           // cooldown guard for triggerSurprise()
        this._lastEmotionCheck = 0;       // throttle for the mood evaluator
        this._lastExpression = undefined; // last expression asset applied

        // Pupil dilation: live "Eyeball Size" layer driven by emotion + proximity
        this._pupilTarget = 1.0;

        // Rare expression easter eggs (blep / tears / rage / yandere moments)
        this._egg = { type: null, until: 0, nextAt: performance.now() + 20000 + Math.random() * 15000 };

        // Stage & camera polish: entrance fade, mouse parallax, proximity zoom
        this._baseX = 0;
        this._baseY = 0;
        this._baseScale = 1;
        this._parallaxX = 0;
        this._parallaxY = 0;
        this._camZoom = 1;
        this._draggingNow = false;
        this._entrance = { active: false, start: 0, duration: 1100 };

        // Beat-reactive body bob (fed by triggerBeat from wallpaper.js)
        this._beatBob = { pulse: 0, phase: 0 };

        // Cheek pokes: spatial face hit detection + recoil state
        this._lastPoke = 0;
        this._lastTap = null;
        this._pokeRecoilUntil = 0;

        // Persistent mood (0 cold .. 100 warm), pushed in from wallpaper.js
        this._mood = 55;

        // Desk-session fatigue (0..1): ramps with how long the user has been at
        // the desk without an idle/sleep reset. Feeds posture sag and makes her
        // stretch more often on long sessions.
        this._sessionFatigue = 0;

        // Time-of-day awareness: drowsier after dark, brighter by day
        this._hour = new Date().getHours();
        this._night = this._hour < 6 || this._hour >= 19;
        this._lastTodCheck = 0;

        // Self-initiated idle gestures (arms cross / clock glance / stretch)
        this._gestureArm = false;
        this._gestureArmUntil = 0;
        this._gestureTimer = null;
        this._stretchUntil = 0;

        // Sleep/wake choreography: slow doze-off close, stretch on waking
        this._wasSleeping = false;
        this._sleepChoreo = { dozing: false, start: 0, dur: 1400 };

        // Dirty-check caches for direct (non-smoothed) per-frame parameter
        // writes, so steady-state frames don't re-write identical values.
        this._lastDirectParam = {};
        this._lastEyeOpen = -1;
        this._lastHands = -1;
        this._lastEggType = null;

        // Speech/lip-sync state
        this._speechOffTimer = null;      // delayed isSpeaking=false timer
    }

    /**
     * Toggle idle power-saving mode: slows the Pixi ticker and the lifelike
     * parameter subsystems so the model keeps breathing/blinking but at a
     * fraction of the GPU cost.
     */
    setIdleMode(idle) {
        if (this._idleMode === idle) return;
        this._idleMode = !!idle;
        this._setAnimRate();
        if (this.app && this.app.ticker) {
            // speed only slows animation time, not draw frequency — maxFPS
            // actually caps how often Pixi renders the model while idle.
            this.app.ticker.speed = idle ? 0.2 : 1.0;
            if (typeof this.app.ticker.maxFPS === 'number') {
                this.app.ticker.maxFPS = idle ? 6 : this._activeMaxFps;
            }
        }
    }

    /**
     * Adjust physics and animation intensity based on performance level.
     * Called from wallpaper.js performance governor.
     * perfLevel: 0 = lowest, 2 = highest
     */
    setPerfLevel(level) {
        const levels = [
            { physicsScale: 0.5, animationSpeed: 0.5, maxFPS: 15 },
            { physicsScale: 0.75, animationSpeed: 0.75, maxFPS: 20 },
            { physicsScale: 1.0, animationSpeed: 1.0, maxFPS: 30 },
        ];
        const cfg = levels[Math.max(0, Math.min(levels.length - 1, level))];
        this._basePhysicsScale = cfg.physicsScale;
        this._activeMaxFps = cfg.maxFPS;
        this._setAnimRate();

        if (this.app && this.app.ticker) {
            this.app.ticker.speed = cfg.animationSpeed;
            if (typeof this.app.ticker.maxFPS === 'number') {
                this.app.ticker.maxFPS = cfg.maxFPS;
            }
        }
    }

    /**
     * Keep the parameter pipeline's update rate tied to the actual render cap
     * (idle 6fps, active 15/20/30fps) instead of rAF's 60fps.
     */
    _setAnimRate() {
        this._animInterval = 1000 / (this._idleMode ? 6 : this._activeMaxFps);
    }

    /**
     * Feed the current bass/audio energy so the mood engine can react to the
     * soundtrack in real time (0..1). Called from wallpaper.js per audio frame.
     * Also updates the audio-reactive physics scaling for cloth/hair dynamics.
     */
    setAudioEnergy(level) {
        this._audioEnergy = Math.max(0, Math.min(1, level || 0));
        if (this._audioEnergy > 0.2) {
            this._lastAudioTime = performance.now();
            this._lastActivityTime = performance.now();
        }
        // Audio-reactive physics: more intense during strong beats
        this._updatePhysicsScale();
    }

    /**
     * Feature toggle from the settings panel (wallpaper.js mirrors them).
     * Disabling a feature drops its runtime work entirely, not just its
     * visual output.
     */
    setFeature(name, enabled) {
        if (name in this._features) this._features[name] = !!enabled;
    }

    /**
     * Music-aware mood feed: overall track loudness (not just bass), pushed in
     * per audio frame. The loop smooths it with a quick attack and slow release
     * so her energy follows the song's overall shape rather than every kick.
     */
    setMusicEnergy(level) {
        this._musicEnergyTarget = Math.max(0, Math.min(1, level || 0));
    }

    /**
     * Desk-session feed: how many minutes the user has been at the desk since
     * the last idle/sleep reset (wallpaper.js pushes it on its watchdog tick).
     * Ramps fatigue toward 1 over ~3 hours of continuous desk time.
     */
    setSessionMinutes(minutes) {
        // Disabled: fatigue stays pinned at zero so no posture sag happens
        if (!this._features.postureFatigue) return;
        this._sessionFatigue = Math.max(0, Math.min(1, (minutes || 0) / 180));
    }

    /**
     * Slow envelope for the music-aware mood: ~0.25s to rise with the music,
     * ~3s to fall back after the track ends or goes quiet.
     */
    _updateMusicEnergy(dt) {
        // Disabled: hold at zero so no music-mood effects apply
        if (!this._features.musicMood) {
            this._musicEnergy = 0;
            this._musicEnergyTarget = 0;
            return;
        }
        const t = this._musicEnergyTarget || 0;
        if (this._musicEnergy < t) {
            this._musicEnergy += (t - this._musicEnergy) * Math.min(1, dt * 0.01);
        } else {
            this._musicEnergy += (t - this._musicEnergy) * Math.min(1, dt * 0.002);
        }
        if (this._musicEnergy < 0.001) this._musicEnergy = 0;
    }

    /**
     * Lip-sync: feed vocal frequency bands to drive Kurisu's mouth animation.
     * Called from wallpaper.js per audio frame with FFT bins.
     * Uses smoothing for natural mouth opening and closing.
     */
    setLipSync(vocalsAvg, audioArray, bassVal) {
        if (!this._ready || !this.model || !this.model.internalModel) return;

        // Amplify vocals amplitude to open her mouth clearly
        let openness = Math.min(1.0, (vocalsAvg || 0) * 3.5);
        if (openness < 0.08) openness = 0;

        // Track speech state
        if (openness > 0) {
            this.isSpeaking = true;
        } else if (this.isSpeaking) {
            // Delay turning off speaking to let the mouth close naturally
            this._speechOffTimer = setTimeout(() => {
                this.isSpeaking = false;
            }, 150);
        }

        // Frequency-aware mouth form: bass = wider smile, treble = tighter
        let mouthForm = 0;
        if (openness > 0.4) {
            const hasTreble = audioArray && audioArray.slice(8, 16).some(v => v > 0.3);
            mouthForm = hasTreble ? 0.7 : 1.0; // slight smile for speech
        }

        // Apply via smoothed parameters for natural transitions
        this.setParameter('ParamMouthOpenY', 'ParamMouthOpenY', openness, true);
        if (this._isCubism4) {
            this.setParameter('ParamMouthForm', 'ParamMouthForm', mouthForm, true);
        }
    }

    /**
     * Brief surprised reaction — world-line shifts, head taps, sharp clicks.
     * Cooldown prevents click spam from making her perpetually startled.
     */
    triggerSurprise() {
        const now = performance.now();
        if (now - this._lastSurprise < 2500) return;
        this._lastSurprise = now;
        this._surpriseUntil = now + 1500;
        this._breathHoldUntil = now + 1000; // startle breath-hold ~1s
        this.setEmotion('surprised');
    }

    /**
     * Brain-dictated movement: the reply's hidden <action> tag lands here and
     * maps to a whitelisted choreography built from existing primitives
     * (peek, stretch, surprise, shiver, beat bob). Names come from the
     * KURISU_ACTION_TAGS whitelist in wallpaper.js — never raw params.
     */
    playChoreo(name, emotionLabel) {
        if (!this._ready || this._paused) return;
        const now = performance.now();
        switch (name) {
            case 'stretch':
                // Cross arms briefly with a soft body wiggle
                this._gestureArm = true;
                this._gestureArmUntil = now + 3200;
                this._stretchUntil = now + 1400;
                if (this._beatBob) this._beatBob.pulse = Math.max(this._beatBob.pulse || 0, 0.45);
                break;
            case 'brood':
                // Cross her arms and hold the pose a few seconds
                this._gestureArm = true;
                this._gestureArmUntil = now + 5000;
                break;
            case 'turnaway':
                // Dismissive glance away (left) held a beat longer
                this._peek.active = true;
                this._peek.dir = -1;
                this._peek.started = now;
                this._peek.until = now + 1600;
                this._peekEnv = 0;
                break;
            case 'glance_up':
                // Curious glance toward a random side
                this._peek.active = true;
                this._peek.dir = Math.random() < 0.5 ? -1 : 1;
                this._peek.started = now;
                this._peek.until = now + 1200;
                this._peekEnv = 0;
                break;
            case 'excited_leap':
                // Startled hop + excited face + a beat pulse
                this.triggerSurprise();
                this.setEmotion('excited', 5000);
                if (this._beatBob) this._beatBob.pulse = Math.max(this._beatBob.pulse || 0, 0.9);
                break;
            case 'shiver':
                // Force a cold shiver regardless of mood/time
                this._shiver.active = true;
                this._shiver.until = now + 700;
                break;
        }
    }

    /**
     * User switched away (window focus loss, Lively pause, lock/screensaver).
     * She relaxes into a low-energy state while they're gone. If the model is
     * paused by Lively the reaction just doesn't render — harmless.
     */
    onUserAway() {
        this._userAway = true;
        if (this._ready && !this._paused && this.model) {
            this.setEmotion('tired');
        }
    }

    /**
     * "Peek" reaction on user return: a quick glance toward the side they came
     * back from (random left/right), eyes tracking up, with a curious face.
     * The _peek state drives head/eye offsets until `until` passes.
     */
    triggerPeek() {
        this._userAway = false;
        if (!this._ready || !this.model) return;
        const now = performance.now();
        this._peek.active = true;
        this._peek.dir = Math.random() < 0.5 ? -1 : 1;
        this._peek.started = now;
        this._peek.until = now + 2400;
        this._peekEnv = 0;
        this.setEmotion('curious', 2600);
    }

    /**
     * Persistent mood (0 cold .. 100 warm), pushed in from wallpaper.js after
     * chat or interactions. Drives ambient smile/neutral choice, stage light
     * tint, and how often she volunteers canned chatter.
     */
    setMood(m) {
        this._mood = Math.max(5, Math.min(95, typeof m === 'number' ? m : 55));
    }

    /**
     * Time-of-day awareness: refreshes the current local hour about once a
     * minute and flips the "night" flag (drowsier blinks, tighter pupils,
     * dimmer stage light, shorter idle fuse).
     */
    _updateTimeOfDay(now) {
        if (now - this._lastTodCheck < 60000) return;
        this._lastTodCheck = now;
        this._hour = new Date().getHours();
        this._night = this._hour < 6 || this._hour >= 19;
    }

    /**
     * Self-initiated idle gestures: when the desktop has been quiet for a
     * while, she crosses her arms, glances up at the clock, or stretches.
     * Gated the same way as the ambient motions — never during speech, pets,
     * holds, or the easter-egg moments.
     */
    _startIdleGestures() {
        if (this._isCubism4 !== true) return;
        // Skip cosmetic idle gestures for reduced-motion users or if disabled
        if (!this._features.idleGestures) return;
        if (this._reducedMotion()) return;
        const schedule = () => {
            const delay = 70000 + Math.random() * 50000;
            this._gestureTimer = setTimeout(() => {
                this._gestureTimer = null;
                if (!this._ready || this._paused || this._idleMode || this.isSpeaking || this._petMode ||
                    this._holdTimer || this._egg.type || this._gestureArm ||
                    (this.currentEmotion === 'angry' || this.currentEmotion === 'annoyed' ||
                     this.currentEmotion === 'frustrated' || this.currentEmotion === 'stress' ||
                     this.currentEmotion === 'scared' || this.currentEmotion === 'sad' ||
                     this.currentEmotion === 'bitter' || this.currentEmotion === 'sleepy' ||
                     this.currentEmotion === 'sleeping' || this.currentEmotion === 'surprised')) {
                    schedule();
                    return;
                }
                // Only when the cursor has been still for a while
                const still = performance.now() - (this._mouseActivity ? (this._mouseActivity.lastMoveTime || 0) : 0);
                if (still < 30000) {
                    schedule();
                    return;
                }
                this._playIdleGesture();
                schedule();
            }, delay);
        };
        schedule();
    }

    _playIdleGesture() {
        const now = performance.now();
        // Fatigue bias: the longer the desk session, the more she reaches for a
        // stretch and the less she just broods with her arms crossed.
        const stretchW = 0.20 + this._sessionFatigue * 0.30; // 0.20 → 0.50
        const peekW = 0.30;
        const armsW = 1 - stretchW - peekW;                  // 0.50 → 0.20
        const roll = Math.random();
        if (roll < armsW) {
            // Brood: cross her arms and hold the pose for a few seconds
            this._gestureArm = true;
            this._gestureArmUntil = now + 6000 + Math.random() * 5000;
        } else if (roll < armsW + peekW) {
            // Glance up at the clock — a brief peek in a random direction
            this._peek.active = true;
            this._peek.dir = Math.random() < 0.5 ? -1 : 1;
            this._peek.started = now;
            this._peek.until = now + 1500;
            this._peekEnv = 0;
        } else {
            // Stretch: cross arms briefly with a soft body wiggle
            this._gestureArm = true;
            this._gestureArmUntil = now + 3200;
            this._stretchUntil = now + 1400;
            if (this._beatBob) this._beatBob.pulse = Math.max(this._beatBob.pulse || 0, 0.45);
        }
    }

    _updateIdleGestures(now) {
        if (this._gestureArm && this._gestureArmUntil && now >= this._gestureArmUntil) {
            this._gestureArm = false;
            this._gestureArmUntil = 0;
        }
        if (this._stretchUntil && now >= this._stretchUntil) this._stretchUntil = 0;
    }

    /**
     * Shadow tap: clicking her feet/grounding shadow is its own interaction —
     * a startled hop, occasionally with a line. Called from wallpaper.js.
     */
    interactShadow() {
        if (!this._ready || !this.model) return;
        const now = performance.now();
        this.triggerSurprise();
        if (this.model.motion && this._isCubism4) {
            try { this.model.motion('TapBody'); } catch (e) { /* optional */ }
        }
        if (typeof this.onInteract === 'function' && now - (this._lastShadowLine || 0) > 15000 && Math.random() < 0.5) {
            this._lastShadowLine = now;
            const line = this._petLine();
            if (line) this.onInteract(line);
        }
        if (typeof this.onMood === 'function') this.onMood(2);
    }

    /**
     * Hold-to-pet: press and hold on the model without dragging. Reactions get
     * progressively happier the more you pet her, with a shy blush and a soft
     * body motion. Only one hold reaction at a time.
     */
    _petOnHold() {
        if (!this._ready || !this.model) return;
        this._petDragCount = (this._petDragCount || 0) + 1;
        this._lastPetInteraction = performance.now();
        if (this._petReactionActive) return;
        this._petReactionActive = true;

        const deep = this._petDragCount > 2;
        this.setEmotion(deep ? 'happy' : 'content', 2500);
        if (typeof this.onMood === 'function') this.onMood(deep ? 6 : 4);
        if (this.blushLevel < 1) this.blushLevel = 1;
        if (this.model.motion) {
            try { this.model.motion(this._isCubism4 ? 'TapBody' : 'tap_body'); } catch (e) { /* optional */ }
        }
        const now = performance.now();
        if (typeof this.onInteract === 'function' && now - (this._lastHoldLine || 0) > 12000 && Math.random() < 0.55) {
            this._lastHoldLine = now;
            const line = this._petLine();
            if (line) this.onInteract(line);
        }
        setTimeout(() => { this._petReactionActive = false; }, 2500);
    }

    _petLine() {
        // KURISU_PET_LINES lives in wallpaper.js's global scope (const, so not
        // on window) — resolve by name at call time.
        const lines = (typeof KURISU_PET_LINES !== 'undefined') ? KURISU_PET_LINES : null;
        if (lines && lines.length) {
            return lines[Math.floor(Math.random() * lines.length)];
        }
        return null;
    }

    /**
     * Cheek poke reaction: puffed, annoyed — blush, a RageSign flicker (reused
     * easter-egg layer), a sharp recoil bob, and occasionally a sassy line.
     */
    _pokeCheek() {
        if (!this._ready) return;
        this._lastPoke = performance.now();
        this.setEmotion('annoyed', 2600);
        if (this.blushLevel < 1) this.blushLevel = 1;
        // RageSign flicker via the easter-egg layer
        this._egg.type = 'rage';
        this._egg.until = performance.now() + 700;
        this._egg.nextAt = performance.now() + 60000;
        // Sharp recoil bob, decayed in _updatePokeRecoil
        this._pokeRecoilUntil = performance.now() + 350;
        if (typeof this.onInteract === 'function' && Math.random() < 0.6) {
            const line = this._pokeLine();
            if (line) this.onInteract(line);
        }
        if (typeof this.onMood === 'function') this.onMood(-6);
    }

    _pokeLine() {
        const lines = (typeof KURISU_POKE_LINES !== 'undefined') ? KURISU_POKE_LINES : null;
        if (lines && lines.length) {
            return lines[Math.floor(Math.random() * lines.length)];
        }
        return null;
    }

    /**
     * Toggle pet mode: a smaller, freely draggable Kurisu. Position persists
     * via wallpaper.js (localStorage); disabling re-centers her on stage.
     */
    setPetMode(enabled) {
        enabled = !!enabled;
        if (this._petMode === enabled) return;
        this._petMode = enabled;
        document.body.classList.toggle('pet-mode', enabled);
        if (!enabled) {
            this._dragged = false;
            this._petDragCount = 0;
            this._petReactionActive = false;
            this._fitModel(); // full size, back to center stage
            // Return to neutral expression when exiting pet mode
            if (this.model && this._ready) {
                this.setEmotion('neutral');
            }
        } else if (this.model) {
            this._applyPetScale(); // shrink without moving her
            // Playful reaction when entering pet mode
            if (this._ready) {
                this.setEmotion('amused', 5000);
            }
        }
        if (this.app && this.app.renderer) this.app.renderer.render(this.app.stage);
    }

    /**
     * Pet interaction: called when the user drags Kurisu around in pet mode.
     * Triggers reaction animations based on drag distance and duration.
     */
    _petInteraction(dragDistance) {
        if (!this._petMode || !this._ready || !this.model) return;

        // Count drags for cumulative petting reaction
        this._petDragCount = (this._petDragCount || 0) + 1;
        this._lastPetInteraction = performance.now();

        if (dragDistance > 100 && !this._petReactionActive) {
            // Long drag: she's being carried around
            this._petReactionActive = true;
            this.setEmotion('surprised', 2000);
            setTimeout(() => {
                this._petReactionActive = false;
                if (this._petMode) this.setEmotion('content', 3000);
            }, 2000);
        } else if (this._petDragCount > 3 && !this._petReactionActive) {
            // After petting her several times, she gets playful/happy
            this._petReactionActive = true;
            this.setEmotion('happy', 4000);
            setTimeout(() => {
                this._petReactionActive = false;
            }, 4000);
        }
        }

    /**
     * Place Kurisu at normalized stage coords (0..1). Queued while the model
     * is still loading and applied once the avatar is ready.
     */
    setPetPosition(nx, ny) {
        this._petPendingPos = { nx: nx, ny: ny };
        if (!this.model || !this.app) return;
        const view = this.app.view;
        this.model.x = nx * view.width;
        this.model.y = ny * view.height;
        this._dragged = true; // keep her there on resize
        this._recordBasePose();
        this._syncGroundShadow();
        if (this.app.renderer) this.app.renderer.render(this.app.stage);
    }

    // Shrink the model to pet size at its current position.
    _applyPetScale() {
        if (!this.model) return;
        const s = this.model.scale.x;
        this.model.scale.set(s * 0.8, s * 0.8);
        this._syncGroundShadow();
    }

    // Keep the grounding shadow under her feet wherever she is dragged.
    _syncGroundShadow() {
        const shadowEl = document.getElementById('l2d-shadow');
        if (!shadowEl || !this.model || !this.app) return;
        const view = this.app.view;
        const pct = Math.min(95, Math.max(5, (this.model.x / view.width) * 100));
        shadowEl.style.left = pct + '%';
        // Track her vertical position too: the model's feet sit just under its
        // center point (anchor 0.5, full-height fit), so map feet onto height %.
        const feetY = this.model.y + this.model.height * this.model.scale.y * 0.5;
        const bottomPct = Math.min(98, Math.max(0, ((view.height - feetY) / view.height) * 100));
        shadowEl.style.bottom = bottomPct + '%';
    }

    /**
     * Set an emotion directly. Writes currentEmotion (which the lifelike
     * subsystems read every frame) and applies the matching expression asset
     * only when the face actually changes, so we don't spam expression swaps.
     *
     * `holdMs` (optional) pins the emotion for that long so the ambient mood
     * evaluator doesn't immediately overwrite a chat reaction.
     */
    setEmotion(label, holdMs) {
        const target = (label || 'neutral').toLowerCase();
        const changed = target !== this.currentEmotion;
        const now = performance.now();

        // Sleep/wake choreography on the sleepy<->wakeful transition edges.
        const wasSleeping = this._wasSleeping;
        const isSleeping = target === 'sleepy' || target === 'sleeping';
        this._wasSleeping = isSleeping;
        if (isSleeping && !wasSleeping && this._ready) {
            // Doze-off: close her eyes gradually instead of snapping shut.
            this._sleepChoreo.dozing = true;
            this._sleepChoreo.start = now;
            this._sleepChoreo.dur = 1400;
        }
        if (!isSleeping && wasSleeping && this._ready) {
            // Waking: a gentle stretch motion; the greeting line is handled by
            // wallpaper.js's wake flow so we don't double-speak.
            this._sleepChoreo.dozing = false;
            try {
                if (this.model && this.model.motion && this._isCubism4) this.model.motion('Special');
            } catch (e) { /* optional */ }
        }

        this.currentEmotion = target;
        if (holdMs && holdMs > 0) {
            this._emotionHoldUntil = now + holdMs;
        }
        // Strong emotions fire a short stage-light surge
        const seat = EMOTION_AURA[target];
        if (changed && seat && seat.flash) {
            this._auraFlashUntil = now + 650;
        }
        if (changed) {
            this._applyExpression(this._expressionForEmotion(target));
        }
    }

    _expressionForEmotion(label) {
        switch (label) {
            case 'happy':
            case 'excited':
                return 'Stanby Smile';
            case 'amused':
                return 'Blush 2'; // soft smile + visible blush — playful, not full happy
            case 'smug':
                return 'Blush 2'; // smug uses Blush 2 with extra cheek via override
            case 'proud':
                return 'Stanby Smile'; // proud uses Smile with special aura
            case 'jealous':
                return 'Stanby Angry'; // jealous uses Angry expression with different tint
            case 'content':
            case 'calm':
                return 'Blush 1'; // gentle blush — satisfied but subdued
            case 'curious':
            case 'confused':
            case 'surprised':
                return 'Stanby Surprised';
            case 'sad':
            case 'tired':
            case 'bitter':
            case 'sleepy':
            case 'sleeping':
                return 'Stanby Sad';
            case 'angry':
            case 'annoyed':
            case 'frustrated':
            case 'stress':
                return 'Stanby Angry';
            case 'scared':
                return 'Stanby Scared';
            default:
                return null; // neutral / calm / thinking — model's default face
        }
    }

    _applyExpression(expName) {
        if (!this._ready || !this.model) return;
        try {
            if (expName && typeof this.model.expression === 'function') {
                // Smooth transition: fade expression over 0.4s by leveraging
                // pixi-live2d-display's built-in fade. The fade time is per-call.
                this._lastExpression = expName;
                this.model.expression(expName, 0, 400);
            } else if (this._lastExpression && typeof this.model.resetExpression === 'function') {
                this._lastExpression = undefined;
                this.model.resetExpression();
            }
        } catch (e) {
            // expression assets are optional — never let a missing one break the loop
        }
    }

    /**
     * Lightweight mood evaluator. Runs on a 400ms cadence inside the master
     * loop and only *overrides* the emotion when there is a real reason to —
     * otherwise ambient expressions are left alone.
     */
    _updateEmotion(now) {
        if (now - this._lastEmotionCheck < 400) return;
        this._lastEmotionCheck = now;

        // An explicit emotion (chat reaction, greeting) is being held — don't
        // override it with ambient mood until the hold expires.
        if (now < this._emotionHoldUntil) return;

        let label = null;

        if (this._surpriseUntil && now < this._surpriseUntil) {
            label = 'surprised';
        } else if (this.isThinking) {
            label = 'thinking';
        } else if (this.isSpeaking) {
            const e = this._audioEnergy || 0;
            label = e > 0.6 ? 'excited' : (e > 0.25 ? 'happy' : 'content');
        } else if (this._petMode && this._petReactionActive) {
            // During pet interaction, emotion is set by _petInteraction()
            return;
        } else if (this._proximity > 0.55) {
            // Near her face: check for smug/pride if recently interacted
            if (this._petDragCount > 2 && (now - this._lastPetInteraction) < 8000) {
                label = 'smug';
            } else {
                label = 'happy'; // she notices you hovering near her face
            }
        } else {
            const quiet = now - this._lastActivityTime;
            // At night she runs out of steam sooner; on a warm mood she keeps a
            // soft smile while idle, on a cold one she sits neutral and distant.
            // Energetic music keeps her on her feet longer before drifting tired.
            const quietLimit = (this._night ? 60000 : 90000) + this._musicEnergy * 30000;
            if (quiet > quietLimit) {
                label = 'tired';
            } else if (quiet > 20000) {
                // A warm mood or a lively soundtrack keeps a soft smile on her face
                label = (this._mood >= 60 || this._musicEnergy > 0.5) ? 'content' : 'neutral';
            }
        }

        if (label && label !== this.currentEmotion) {
            this.setEmotion(label);
        }
    }

    /**
     * Set a parameter value directly, supporting both Cubism 2 and Cubism 4 names.
     * Supports smooth interpolation when smooth=true is passed.
     */
    setParameter(id2, id3, value, smooth) {
        if (!this.model || !this.model.internalModel) return;
        const coreModel = this.model.internalModel.coreModel;
        if (!coreModel) return;

        const paramId = this._isCubism4 ? id3 : id2;

        if (smooth && paramId) {
            const cur = this._paramCurrent[paramId];
            // Skip redundant updates: if the value is already rendered at (or
            // easing toward) this exact target, there's nothing new to do —
            // otherwise the per-frame calls (pupils, blend shapes, cheek,
            // mouth) would re-queue and re-write the same value every frame.
            const moving = this._smoothedParams.has(paramId);
            if (cur !== undefined && Math.abs(cur - value) <= 0.001 && !moving) {
                return;
            }
            if (this._paramTargets[paramId] === value && moving) {
                return;
            }
            if (cur === undefined) {
                this._paramCurrent[paramId] = this._readParamValue(paramId);
            }
            // Store target and enable smoothing
            this._paramTargets[paramId] = value;
            this._paramSpeed[paramId] = 0.15; // smooth speed per frame
            this._smoothedParams.add(paramId);
            return; // Don't immediately apply; let the animation loop handle it
        }

        if (this._isCubism4) {
            if (coreModel.setParameterValueById) {
                coreModel.setParameterValueById(id3, value);
            }
        } else {
            if (coreModel.setParamFloat) {
                coreModel.setParamFloat(id2, value);
            }
        }
    }

    /**
     * Add to a parameter value dynamically, supporting both Cubism 2 and Cubism 4 names.
     */
    addToParameter(id2, id3, value) {
        if (!this.model || !this.model.internalModel) return;
        const coreModel = this.model.internalModel.coreModel;
        if (!coreModel) return;

        if (this._isCubism4) {
            if (coreModel.setParameterValueById && coreModel.getParameterValueById) {
                const current = coreModel.getParameterValueById(id3) || 0;
                coreModel.setParameterValueById(id3, current + value);
            }
        } else {
            if (coreModel.addToParamFloat) {
                coreModel.addToParamFloat(id2, value);
            }
        }
    }

    /**
     * Read the current value of a parameter.
     */
    _readParamValue(paramId) {
        if (!this.model || !this.model.internalModel) return 0;
        const coreModel = this.model.internalModel.coreModel;
        if (!coreModel) return 0;

        try {
            if (this._isCubism4) {
                if (coreModel.getParameterValueById) {
                    return coreModel.getParameterValueById(paramId) || 0;
                }
            } else {
                if (coreModel.getParamFloat) {
                    return coreModel.getParamFloat(paramId) || 0;
                }
            }
        } catch (e) {
            return 0;
        }
        return 0;
    }

    /**
     * Apply smoothed parameter values each frame.
     */
    _applySmoothedParams(coreModel) {
        if (this._smoothedParams.size === 0) return;

        for (const paramId of this._smoothedParams) {
            const target = this._paramTargets[paramId];
            const current = this._paramCurrent[paramId];
            const speed = this._paramSpeed[paramId] || 0.1;

            this._paramCurrent[paramId] = current + (target - current) * speed;

            if (Math.abs(target - this._paramCurrent[paramId]) < 0.001) {
                this._paramCurrent[paramId] = target;
            }

            if (this._isCubism4) {
                if (coreModel.setParameterValueById) {
                    coreModel.setParameterValueById(paramId, this._paramCurrent[paramId]);
                }
            } else {
                if (coreModel.setParamFloat) {
                    coreModel.setParamFloat(paramId, this._paramCurrent[paramId]);
                }
            }

            // Remove from smoothing set if we've reached the target
            if (this._paramCurrent[paramId] === target) {
                this._smoothedParams.delete(paramId);
            }
        }
    }

    /**
     * Update audio-reactive physics scaling.
     * Called from wallpaper.js via setAudioEnergy or directly.
     */
    _updatePhysicsScale(audioLevel) {
        if (!audioLevel && audioLevel !== 0) {
            audioLevel = this._audioEnergy || 0;
        }
        
        // Physics responds to audio energy: base scale + boost during peaks
        const boost = audioLevel > 0.3 ? (audioLevel - 0.3) * this._physicsAudioBoost / 0.7 : 0;
        this._physicsScaleTarget = this._basePhysicsScale + boost;
        
        // Smooth the physics scale change
        this._physicsScale += (this._physicsScaleTarget - this._physicsScale) * 0.1;
    }

    /**
     * Initialize the PixiJS app and load the Live2D model.
     */
    async init() {
        const canvas = document.getElementById(this.canvasId);
        if (!canvas) {
            console.error('[L2D] Canvas not found:', this.canvasId);
            return false;
        }

        // Create PixiJS Application only if it doesn't exist
        if (!this.app) {
            try {
                this.app = new PIXI.Application({
                    view: canvas,
                    autoStart: true,
                    backgroundAlpha: 0,
                    antialias: true,
                    transparent: true,
                    // Cap backing resolution to 1.0x to keep GPU/VRAM cost down
                    resolution: 1.0,
                });
            } catch (err) {
                console.error('[L2D] WebGL/Pixi init failed:', err);
                return false;
            }

        // Cap the render loop to 30fps: the HUD visuals redraw at ~30fps, so
        // rendering the Live2D stage any faster just wastes GPU/CPU cycles.
        if (typeof this.app.ticker.maxFPS === 'number') {
            this.app.ticker.maxFPS = 30;
        }

            canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                console.warn('[L2D] WebGL context lost; waiting for browser restore.');
            });
            canvas.addEventListener('webglcontextrestored', () => {
                console.warn('[L2D] WebGL context restored; refitting model.');
                this.resize();
            });

            // Setup ResizeObserver on parent container to automatically refit when switching tabs or resizing
            const parent = canvas.parentElement;
            if (parent) {
                this._resizeObserver = new ResizeObserver((entries) => {
                    for (let entry of entries) {
                        const { width, height } = entry.contentRect;
                        if (width > 0 && height > 0) {
                            this.resize();
                        }
                    }
                });
                this._resizeObserver.observe(parent);
            }

            // Pause/resume when the tab visibility changes
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.pause();
                } else {
                    this.resume();
                }
            });
        }

        try {
            console.log('[L2D] Loading model from path:', this.modelPath);
            // Load the model
            this.model = await PIXI.live2d.Live2DModel.from(this.modelPath);

            // Add to stage first
            this.app.stage.addChild(this.model);

            // Scale & position
            this.resize();

            // Detect model type (Cubism 3/4 uses model3.json or has .moc3 file)
            const isC4 = this.modelPath.toLowerCase().endsWith('.model3.json') || 
                         (this.model.internalModel && this.model.internalModel.settings && 
                          this.model.internalModel.settings.moc && 
                          this.model.internalModel.settings.moc.toLowerCase().endsWith('.moc3'));
            this._isCubism4 = !!isC4;

            // Load appropriate group references
            if (this._isCubism4) {
                this._allExpressions = ['Arm Change', 'Blush 1', 'Blush 2', 'Stanby Angry', 'Stanby Sad', 'Stanby Scared', 'Stanby Smile', 'Stanby Surprised'];
                this._ambientMotions = ['Idle', 'TapBody', 'Special'];
            } else {
                this._allExpressions = ['f01', 'f02', 'f03', 'f04', 'f05'];
                this._ambientMotions = ['pinch_in', 'pinch_out', 'flick_head', 'tap_body'];
            }

            // Enable built-in interaction (tap areas)
            this.model.on('hit', (hitAreas) => {
                this._onHit(hitAreas);
            });

            // Setup mouse tracking (for gaze/head follow + proximity)
            this._setupMouseTracking();

            // Start idle motion loop - use a very light eye-only idle instead of the heavy
            // 58Loop (58s full-body). haru_g_idle only animates eye openness, ~10s.
            const idleMotionGroup = this._isCubism4 ? 'Idle' : 'idle';
            // Don't play the default idle; our procedural system (breathing, head sway,
            // body sway, blinking, idle eyes, brows) handles subtle lifelike motion.
            // this.model.motion(idleMotionGroup);

            // Rare ambient motions: occasionally play a Special-group motion
            // (haru_g_idle, xhiyori_m03) as a brief breath of life. Kept rare
            // and heavily gated so it never stomps on speech, petting, or an
            // active reaction — the lifelike loop still handles idle motion.
            this._startRareAmbientMotions();

            // Self-initiated idle gestures: arms crossed, clock glances, stretches
            this._startIdleGestures();

            // Start rare ambient moods (soft smile / blush moments)
            this._startAmbientMoods();

            // Start lifelike animation loop
            this._startLifelikeAnimations();

            this._ready = true;

            // Entrance: fade her in with a gentle settle right after load
            this._entrance.active = true;
            this._entrance.start = performance.now();
            this.model.alpha = 0;

            // If pet mode was restored before the model finished loading,
            // place her at the saved spot now that we can.
            if (this._petMode && this._petPendingPos) {
                this.setPetPosition(this._petPendingPos.nx, this._petPendingPos.ny);
            }

            console.log('[L2D] Kurisu model loaded. Cubism4:', this._isCubism4, '— lifelike animations active');
            return true;
        } catch (e) {
            console.error('[L2D] Failed to load model:', e);
            return false;
        }
    }

    /**
     * Master animation loop — runs every frame via requestAnimationFrame.
     * Computes and applies all lifelike parameter overrides.
     */
    _startLifelikeAnimations() {
        const now = performance.now();
        this._lastFrameTime = now;
        this._lastAnimTick = 0;
        this._blink.nextBlinkTime = now + this._randomRange(1000, 3000); // first blink soon
        this._idleEyes.nextChangeTime = now + 1000;
        this._brows.nextChangeTime = now + 3000;

        const animate = (timestamp) => {
            this._rafHandle = requestAnimationFrame(animate);

            if (!this._ready || !this.model || !this.model.internalModel) return;
            const coreModel = this.model.internalModel.coreModel;
            if (!coreModel) return;

            // Cap the parameter pipeline to the actual render rate. Pixi draws
            // at maxFPS (30 active / 6 idle), so a 60fps rAF recomputing every
            // subsystem only burns CPU — all subsystems are time-based and the
            // dt clamp absorbs the skipped frames with no visual change.
            if (this._lastAnimTick > 0 && timestamp - this._lastAnimTick < this._animInterval) return;
            this._lastAnimTick = timestamp;

            const dt = timestamp - this._lastFrameTime;
            this._lastFrameTime = timestamp;

            // Clamp delta to avoid huge jumps after tab switch
            const clampedDt = Math.min(dt, 100);

            // Update all subsystems
            this._updateTimeOfDay(timestamp);
            this._updateMusicEnergy(clampedDt);
            this._updateProximity();
            this._updateAmbientMood(clampedDt);
            this._updatePhysicsScale(); // apply audio-reactive physics scaling
            this._updatePeek(timestamp, clampedDt);
            this._updateBeatBob(clampedDt, coreModel);
            this._updatePokeRecoil(timestamp, coreModel);
            this._updateShiver(timestamp, coreModel);
            this._updateBlink(timestamp, clampedDt, coreModel);
            this._updateBreathing(clampedDt, coreModel);
            this._updateBodySway(clampedDt, coreModel);
            this._updateHeadSway(clampedDt, coreModel);
            this._updateIdleEyes(timestamp, clampedDt, coreModel);
            this._updateBrows(timestamp, clampedDt, coreModel);
            this._updateIdleGestures(timestamp);
            this._applySmoothedParams(coreModel); // apply interpolated parameter values

            // Emotion engine (throttled internally to ~2.5Hz)
            this._updateEmotion(timestamp);

            // Emotion-layer parameters: pupil life, blend-shape fidelity, easter eggs
            this._updatePupils(timestamp);
            this._updateEmotionLayers();
            this._updateEasterEggs(timestamp);

            // Apply custom manual overrides (like crossed arms and blushing cheeks)
            this._applyManualOverrides(coreModel);
            this._applyEasterEggLayer(coreModel);

            // Stage camera: entrance fade, parallax drift, and proximity zoom
            this._updateCamera(clampedDt);
        };

        this._rafHandle = requestAnimationFrame(animate);
    }

    /**
     * Apply manual overrides like arm pose, blushing level, and mouth shape in the frame tick.
     */
    _applyManualOverrides(coreModel) {
        if (this._isCubism4) {
            if (coreModel.setParameterValueById) {
                // Arm Change: sets "HandChange" parameter to 1.0 (crossed) or 0.0 (normal).
                // Self-initiated idle gestures also cross her arms (stretch / brood).
                // Dirty-checked: the pose only flips on an edge, not every frame.
                const hands = (this.armChangeActive || this._gestureArm) ? 1.0 : 0.0;
                if (hands !== this._lastHands) {
                    this._lastHands = hands;
                    coreModel.setParameterValueById('HandChange', hands);
                }
                
                // Blush: sets "ParamCheek" parameter to 0.5 (Mild), 1.0 (Heavy), or 0.0 (None).
                // Proximity adds a smooth blush when the cursor is close to her face,
                // and the ambient mood can add a slow blush moment.
                const cheekVal = this.blushLevel === 1 ? 0.5 : (this.blushLevel === 2 ? 1.0 : 0.0);
                let cheek = Math.max(cheekVal, this._proximity * 0.7);
                if (this._ambientMood.type === 'blush') {
                    cheek = Math.max(cheek, this._ambientMood.value * 0.55);
                }
                
                // Extra blush for jealous emotion
                const label = this.currentEmotion;
                if (label === 'jealous') {
                    cheek = Math.max(cheek, 0.8);
                }
                
                // Smooth cheek transitions for natural blush fade
                this.setParameter('ParamCheek', 'ParamCheek', cheek, true);

                // Mouth Form: sets "ParamMouthForm" to 1.0 (smile), -1.0 (frown), or 0.0 (neutral)
                const smileEmotions = ['happy', 'excited', 'content', 'good', 'positive', 'calm', 'smug', 'proud'];
                const frownEmotions = ['sad', 'bitter', 'tired', 'negative', 'annoyed', 'angry', 'frustrated', 'stress', 'confused', 'jealous'];
                
                let mouthForm = 0.0;
                if (smileEmotions.includes(label)) mouthForm = 1.0;
                else if (frownEmotions.includes(label)) mouthForm = -1.0;

                // Ambient mood: a soft, fleeting smile that fades in/out
                if (this._ambientMood.type === 'smile') {
                    mouthForm = Math.max(mouthForm, this._ambientMood.value * 0.7);
                }
                
                // Smooth mouth form transitions
                this.setParameter('ParamMouthForm', 'ParamMouthForm', mouthForm, true);
            }
        } else {
            // Cubism 2 fallback mouth form
            const label = this.currentEmotion;
            const smileEmotions = ['happy', 'excited', 'content', 'good', 'positive', 'calm', 'smug', 'proud'];
            const frownEmotions = ['sad', 'bitter', 'tired', 'negative', 'annoyed', 'angry', 'frustrated', 'stress', 'confused', 'jealous'];
            
            let mouthForm = 0.0;
            if (smileEmotions.includes(label)) mouthForm = 1.0;
            else if (frownEmotions.includes(label)) mouthForm = -1.0;
            
            this.setParameter('PARAM_MOUTH_FORM', 'PARAM_MOUTH_FORM', mouthForm);
        }
    }

    /**
     * Pupil life: drive the unused "Eyeball Size" parameter from emotion,
     * proximity, and a hard startle flash on surprise. Smooths through the
     * shared parameter pipeline so dilation reads as a slow, organic change.
     */
    _updatePupils(now) {
        if (!this._ready || this._isCubism4 !== true) return;
        const label = this.currentEmotion;

        const PUPIL = {
            excited: 1.35, surprised: 1.45, scared: 1.5, curious: 1.2,
            thinking: 1.15, happy: 1.2, amused: 1.1, smug: 1.05, proud: 1.15,
            content: 1.02, calm: 1.0, neutral: 1.0,
            sad: 0.8, tired: 0.75, sleepy: 0.7, sleeping: 0.6, bitter: 0.72,
            angry: 0.6, annoyed: 0.65, frustrated: 0.6, stress: 0.6, jealous: 0.7,
        };
        let target = (PUPIL[label] !== undefined) ? PUPIL[label] : 1.0;

        // She focuses on you when the cursor hovers near her face
        target += this._proximity * 0.15;

        // Music lifts her eyes: lively tracks keep her pupils bright and dilated
        target += this._musicEnergy * 0.08;

        // Startle flash dilates the pupils hard, then the smoothing decays it
        if (now < this._surpriseUntil) target = Math.max(target, 1.45);

        // After dark her pupils sit tighter — drowsier look
        if (this._night) target *= 0.85;

        this._pupilTarget = target;
        this.setParameter('PARAM_EYE_SIZE', 'EyeballSize', target, true);
    }

    /**
     * Emotion fidelity layers: drive the model's Smile/Sad/Angry/Surprissed/
     * Scared blend shapes on top of the expression asset so each mood reads
     * clearly instead of leaning on a single expression swap.
     */
    _updateEmotionLayers() {
        if (!this._ready || this._isCubism4 !== true) return;
        const label = this.currentEmotion;

        let smile = 0, sad = 0, angry = 0, surprised = 0, scared = 0;

        if (['happy', 'excited'].includes(label)) smile = 0.55;
        else if (['amused', 'smug', 'proud'].includes(label)) smile = 0.4;
        else if (['content', 'calm'].includes(label)) smile = 0.3;

        if (['sad', 'tired', 'bitter', 'sleepy', 'sleeping'].includes(label)) sad = 0.5;
        if (['angry', 'annoyed', 'frustrated', 'stress', 'jealous'].includes(label)) angry = 0.5;
        if (['surprised', 'curious', 'confused'].includes(label)) surprised = 0.45;
        if (label === 'scared') scared = 0.6;

        this.setParameter('Smile', 'Smile', smile, true);
        this.setParameter('Sad', 'Sad', sad, true);
        this.setParameter('Angry', 'Angry', angry, true);
        this.setParameter('Surprissed', 'Surprissed', surprised, true);
        this.setParameter('Scared', 'Scared', scared, true);
    }

    /**
     * Rare expression easter eggs: tiny bespoke moments with the model's
     * otherwise-unused parameters — a playful tongue-out "blep", a tear that
     * swells during sad moods, the anger vein, or a blink-and-you-miss-it
     * yandere glint. Self-schedules with long, emotion-tied cooldowns.
     */
    _updateEasterEggs(now) {
        if (!this._ready || this._paused) return;
        // Disabled: clear any lingering egg and never schedule a new one
        if (!this._features.easterEggs) {
            this._egg.type = null;
            return;
        }

        if (this._egg.type) {
            // Speech interrupts playful eggs but lets sad/angry ones linger
            if (this.isSpeaking && this._egg.type !== 'tears' && this._egg.type !== 'rage') {
                this._egg.type = null;
                this._egg.until = 0;
                return;
            }
            if (now >= this._egg.until) {
                this._egg.type = null;
            }
            return;
        }
        if (now < this._egg.nextAt) return;

        const label = this.currentEmotion;
        const calm = !this.isSpeaking && !this._petMode;
        const wakeful = !['sleepy', 'sleeping', 'sad', 'tired', 'bitter'].includes(label);
        const options = [];

        // Playful blep — only during calm, wakeful moments
        if (calm && wakeful && !['angry', 'annoyed', 'frustrated', 'stress', 'scared'].includes(label)) {
            options.push('blep');
        }
        // A tear that swells during sad/low moods
        if (['sad', 'tired', 'bitter', 'sleepy', 'sleeping'].includes(label)) {
            options.push('tears');
        }
        // The anger vein pops when she's genuinely annoyed
        if (['angry', 'annoyed', 'frustrated', 'stress', 'jealous'].includes(label)) {
            options.push('rage');
        }
        // Hidden yandere glint — extra rare
        if (calm && wakeful && Math.random() < 0.25) {
            options.push('yandere');
        }

        if (!options.length) {
            this._egg.nextAt = now + 40000 + Math.random() * 30000;
            return;
        }

        const type = options[Math.floor(Math.random() * options.length)];
        this._egg.type = type;
        this._egg.until = now + (type === 'yandere' ? 1400 : 1500 + Math.random() * 1000);
        this._egg.nextAt = now + (type === 'yandere' ? 150000 : 50000 + Math.random() * 40000);
    }

    /**
     * Write the active easter egg to the model's rare parameters. Snap-on,
     * short-lived (1–2.5s), then the smoothed emotion layers take over.
     */
    _applyEasterEggLayer(coreModel) {
        if (this._isCubism4 !== true || !coreModel || !coreModel.setParameterValueById) return;
        const type = this._egg.type || '';
        // Dirty-checked: the egg layer only changes on a start/stop edge, so
        // steady-state frames skip all four model writes.
        if (type === this._lastEggType) return;
        this._lastEggType = type;
        coreModel.setParameterValueById('TongueOut', type === 'blep' ? 1.0 : 0.0);
        coreModel.setParameterValueById('Tears', type === 'tears' ? 1.0 : 0.0);
        coreModel.setParameterValueById('RageSign', type === 'rage' ? 1.0 : 0.0);
        coreModel.setParameterValueById('Yandere', type === 'yandere' ? 1.0 : 0.0);
    }

    /**
     * Remember the model's "resting" pose (position + scale). The camera
     * subsystem re-applies parallax/zoom offsets on top of this base every
     * frame, so it must be refreshed whenever something explicitly moves her
     * (fit, drag, pet placement).
     */
    _recordBasePose() {
        if (!this.model) return;
        this._baseX = this.model.x;
        this._baseY = this.model.y;
        this._baseScale = this.model.scale.x;
    }

    /**
     * Stage camera: entrance fade-in, a soft cursor parallax drift, and a
     * gentle zoom when the cursor hovers near her face. Position/scale writes
     * are skipped while she's being dragged or in pet mode so she isn't
     * yanked out of the player's hands.
     */
    _updateCamera(dt) {
        if (!this.model) return;

        // Entrance: fade in + a barely-there settle of the scale, once on load
        const en = this._entrance;
        let entT = 0;
        if (en.active) {
            entT = Math.min(1, (performance.now() - en.start) / en.duration);
            const ease = 1 - Math.pow(1 - entT, 3);
            this.model.alpha = ease;
            if (entT >= 1) {
                en.active = false;
                this.model.alpha = 1;
            }
        }

        // Parallax: subtle drift with the cursor (only while it's on-stage)
        const nx = this._cursorNX;
        const ny = this._cursorNY;
        const inView = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
        const k = Math.min(1, dt * 0.003);
        const parTargetX = (!inView || this._draggingNow) ? 0 : (nx - 0.5) * 2 * 10;
        const parTargetY = (!inView || this._draggingNow) ? 0 : (ny - 0.5) * 2 * 7;
        this._parallaxX += (parTargetX - this._parallaxX) * k;
        this._parallaxY += (parTargetY - this._parallaxY) * k;

        // Proximity zoom: she leans closer when you hover her face
        const zoomTarget = (this._draggingNow || this._petMode) ? 1 : 1 + this._proximity * 0.045;
        this._camZoom += (zoomTarget - this._camZoom) * Math.min(1, dt * 0.002);

        let scale = this._baseScale * this._camZoom;
        if (en.active) {
            scale *= (1.025 - 0.025 * (1 - Math.pow(1 - entT, 3)));
        }

        if (!this._draggingNow && !this._petMode) {
            this.model.x = this._baseX + this._parallaxX;
            this.model.y = this._baseY + this._parallaxY;
            this.model.scale.set(scale);
        }
    }

    /**
     * Beat-reactive body bob: each bass kick (fed by wallpaper.js via
     * triggerBeat) throws a quick, decaying lean + lift into the body angles
     * so she dances along with the audio ring and the dust field.
     */
    triggerBeat() {
        if (!this._ready || this._paused || this._petMode) return;
        this._beatBob.pulse = 1;
        this._beatBob.phase = 0;
    }

    _updateBeatBob(dt, coreModel) {
        const bb = this._beatBob;
        if (bb.pulse <= 0.01) return;
        bb.phase += dt * 0.006;
        const env = bb.pulse * Math.exp(-bb.phase * 1.6);
        bb.pulse = Math.max(0, bb.pulse - dt * 0.0035);

        const lean = Math.sin(bb.phase * 6) * env * 1.6;                       // side-to-side sway per kick
        const nod = Math.sin(bb.phase * 6 + Math.PI * 0.5) * env * 0.9;        // forward/back bob
        this.addToParameter('PARAM_BODY_ANGLE_Z', 'ParamBodyAngleZ', lean);
        this.addToParameter('PARAM_BODY_ANGLE_X', 'ParamBodyAngleX', nod);
    }

    /**
     * Cheek-poke recoil: a single sharp forward/back body bob right after a
     * cheek poke, decaying over ~350ms.
     */
    _updatePokeRecoil(now, coreModel) {
        if (this._pokeRecoilUntil && now < this._pokeRecoilUntil) {
            const t = (this._pokeRecoilUntil - now) / 350; // 1 → 0
            const kick = Math.sin(t * Math.PI) * t * 3.5;
            this.addToParameter('PARAM_BODY_ANGLE_X', 'ParamBodyAngleX', kick);
        } else {
            this._pokeRecoilUntil = 0;
        }
    }

    /**
     * Cold-night shiver: when her persistent mood is cold (distant) and it's
     * after dark, she occasionally trembles for ~700ms — a quick, decaying
     * oscillation on the body and head. Self-scheduled with a long cooldown.
     */
    _updateShiver(now, coreModel) {
        const s = this._shiver;
        const coldNight = this._mood < 45 && this._night;
        if (s.active) {
            if (now >= s.until) {
                s.active = false;
                return;
            }
            const t = (s.until - now) / 700; // 1 → 0
            const shiver = Math.sin(now * 0.045) * 0.7 * t;
            this.addToParameter('PARAM_BODY_ANGLE_X', 'ParamBodyAngleX', shiver);
            this.addToParameter('PARAM_ANGLE_Z', 'ParamAngleZ', shiver * 0.6);
            return;
        }
        if (!coldNight || this.isSpeaking || this._petMode || this._paused || !this._ready ||
            ['sleepy', 'sleeping'].includes(this.currentEmotion)) {
            s.nextAt = now + 15000;
            return;
        }
        if (now >= s.nextAt) {
            s.active = true;
            s.until = now + 700;
            s.nextAt = now + 12000 + Math.random() * 8000;
        }
    }

    /**
     * Peek envelope: while the peek reaction is active, advance a smooth
     * ease-in / hold / ease-out envelope that _updateHeadSway and
     * _updateIdleEyes read to aim her glance.
     */
    _updatePeek(now, dt) {
        const pk = this._peek;
        if (!pk.active) return;
        if (now >= pk.until) {
            pk.active = false;
            this._peekEnv = 0;
            return;
        }
        const t = (now - pk.started) / (pk.until - pk.started);
        if (t < 0.35) {
            this._peekEnv = t / 0.35;          // look up
        } else if (t > 0.75) {
            this._peekEnv = 1 - (t - 0.75) / 0.25; // ease back down
        } else {
            this._peekEnv = 1;                 // hold the glance
        }
    }

    /**
     * Auto-blink: natural randomized blink intervals with occasional double-blinks.
     */
    _updateBlink(now, dt, coreModel) {
        const b = this._blink;

        switch (b.phase) {
            case 'open':
                b.value = 1.0;
                if (now >= b.nextBlinkTime) {
                    b.phase = 'closing';
                    b.phaseStart = now;
                    b.doubleBlink = Math.random() < b.doubleBlinkChance;
                }
                break;

            case 'closing': {
                const elapsed = now - b.phaseStart;
                const t = Math.min(1.0, elapsed / b.closeDuration);
                b.value = 1.0 - (t * t);
                if (t >= 1.0) {
                    b.phase = 'closed';
                    b.phaseStart = now;
                }
                break;
            }

            case 'closed': {
                b.value = 0.0;
                const elapsed = now - b.phaseStart;
                if (elapsed >= b.closedDuration) {
                    b.phase = 'opening';
                    b.phaseStart = now;
                }
                break;
            }

            case 'opening': {
                const elapsed = now - b.phaseStart;
                const t = Math.min(1.0, elapsed / b.openDuration);
                b.value = t * (2.0 - t);
                if (t >= 1.0) {
                    if (b.doubleBlink) {
                        b.doubleBlink = false;
                        b.phase = 'closing';
                        b.phaseStart = now + 80;
                    } else {
                        b.phase = 'open';
                        const nightSlow = this._night ? 1.4 : 1;
                        b.nextBlinkTime = now + this._randomRange(b.minInterval, b.maxInterval) * nightSlow;
                    }
                }
                break;
            }
        }

        // Apply blink openness to left/right eyes.
        // While she's asleep the eyes stay shut — the blink state machine is
        // bypassed until she wakes and the emotion returns to a wakeful one.
        const sleeping = this.currentEmotion === 'sleepy' || this.currentEmotion === 'sleeping';
        let openness;
        if (sleeping) {
            if (this._sleepChoreo.dozing) {
                // Doze-off choreography: ease the eyelids shut over ~1.4s so
                // falling asleep reads as a slow, natural drop instead of a snap.
                const t = Math.min(1, (now - this._sleepChoreo.start) / this._sleepChoreo.dur);
                openness = 1 - (t * t);
                if (t >= 1) this._sleepChoreo.dozing = false;
            } else {
                openness = 0;
            }
        } else {
            openness = b.value;
        }
        // Only touch the eyes when the value actually moved — during the long
        // "open" phase (and while asleep) the target holds steady, so this
        // skips two redundant model writes per frame.
        if (Math.abs(openness - this._lastEyeOpen) > 0.0005) {
            this._lastEyeOpen = openness;
            this.setParameter('PARAM_EYE_L_OPEN', 'ParamEyeLOpen', openness);
            this.setParameter('PARAM_EYE_R_OPEN', 'ParamEyeROpen', openness);
        }
    }

    /**
     * Proximity: recompute from the last known cursor position each frame.
     * dist 0 (cursor on her face) -> proximity 1, screen edge -> ~0.
     */
    _updateProximity() {
        // Proximity is measured from Kurisu's *actual* on-screen face position,
        // not the canvas center — so hover reactions (blush, pupil focus, the
        // camera zoom, near-face emotion) keep working even when she's been
        // dragged off-center or shrunk down in pet mode.
        if (!this.model || !this.app || !this.app.view) {
            this._proximity = 0;
            return;
        }
        const view = this.app.view;
        const hh = this.model.height * this.model.scale.y;
        const faceNX = this.model.x / view.width;
        const faceNY = (this.model.y - hh * 0.28) / view.height;
        const dnx = (this._cursorNX - faceNX) * 2;
        const dny = (this._cursorNY - faceNY) * 2;
        const dist = Math.sqrt(dnx * dnx + dny * dny);
        this._proximity = Math.max(0, Math.min(1, 1 - dist));
        this._updateAura();
    }

    /**
     * Stage spotlight: the base hue follows her current emotion (see
     * EMOTION_AURA), warming toward rose and brightening as the cursor nears
     * her face. Strong emotions fire a brief light surge. Rewrites are kept
     * sparse by quantizing the gentle breathing shimmer.
     */
    _updateAura() {
        if (!this._auraEl) {
            this._auraEl = document.getElementById('l2d-aura');
            if (!this._auraEl) return;
        }
        const emo = this.currentEmotion || 'neutral';
        const seat = EMOTION_AURA[emo] || EMOTION_AURA.neutral;
        const emoChanged = emo !== this._lastEmo;
        const p = this._proximity;

        const now = performance.now();
        let flash = 0;
        if (this._auraFlashUntil && now < this._auraFlashUntil) {
            flash = Math.min(1, (this._auraFlashUntil - now) / 350);
        }

        // Gate: only rewrite the style when something actually changed.
        if (!emoChanged && flash === this._lastFlash && Math.abs(p - this._lastAuraP) < 0.03) return;
        this._lastEmo = emo;
        this._lastAuraP = p;
        this._lastFlash = flash;

        // Emotion hue
        let r = seat.r;
        let g = seat.g;
        let b = seat.b;
        // Cursor warmth pulls the light toward warm rose and brightens it
        const t = p;
        r += (255 - r) * t * 0.55;
        g += (77 - g) * t * 0.55;
        b += (109 - b) * t * 0.55;
        // Persistent mood tints the stage: warm moods pull toward rose,
        // cold moods push toward cool blue.
        const moodMix = (this._mood - 50) / 50;
        if (moodMix > 0) {
            r += (255 - r) * moodMix * 0.25;
            g += (130 - g) * moodMix * 0.12;
            b += (150 - b) * moodMix * 0.12;
        } else {
            const m = -moodMix;
            r -= r * m * 0.22;
            b += (210 - b) * m * 0.18;
        }
        // Slow breathing so the stage light feels alive even when idle
        const breathe = 0.5 + 0.5 * Math.sin(Math.floor(now / 500) * 0.9);
        let alpha = (seat.glow + flash * 0.10) * (0.45 + 0.55 * breathe) * (0.85 + 0.15 * p);
        // After dark the stage light dims — she's low-key about the hours
        alpha *= this._night ? 0.85 : 1;
        // Music lifts the stage light: energetic tracks warm the glow a touch
        alpha *= 1 + this._musicEnergy * 0.18;
        alpha = Math.max(0.02, Math.min(0.32, alpha));
        const rs = Math.round(r);
        const gs = Math.round(g);
        const bs = Math.round(b);
        const inner = `rgba(${rs}, ${gs}, ${bs}, ${alpha.toFixed(3)})`;
        const mid = `rgba(${rs}, ${gs}, ${bs}, ${(alpha * 0.5).toFixed(3)})`;
        const css = `radial-gradient(ellipse 55% 42% at 50% 46%, ${inner} 0%, ${mid} 45%, transparent 75%)`;
        if (css !== this._lastAuraColor) {
            this._lastAuraColor = css;
            this._auraEl.style.background = css;
        }
    }

    /**
     * Ambient moods: scheduler that occasionally picks a soft smile or blush
     * moment, faded in/out per-frame via _updateAmbientMood.
     */
    _startAmbientMoods() {
        const schedule = () => {
            const delay = 18000 + Math.random() * 22000;
            this._ambientMood.timer = setTimeout(() => {
                this._ambientMood.timer = null;
                if (!this._ready || this.isSpeaking || this._paused || this._ambientMood.type !== 'none') {
                    schedule();
                    return;
                }
                this._ambientMood.type = Math.random() < 0.55 ? 'smile' : 'blush';
                schedule();
            }, delay);
        };
        schedule();
    }

    _updateAmbientMood(dt) {
        const m = this._ambientMood;
        if (m.type === 'none') {
            if (m.value > 0.01) m.value = Math.max(0, m.value - dt * 0.004);
            m.expireAt = undefined;
            return;
        }
        m.value = Math.min(1, m.value + dt * 0.003);
        if (m.value >= 1) {
            if (m.expireAt === undefined) {
                m.expireAt = performance.now() + 3000 + Math.random() * 3500;
            }
            if (performance.now() >= m.expireAt) {
                m.type = 'none';
                m.expireAt = undefined;
            }
        }
    }

    /**
     * Breathing: continuous sinusoidal animation on breathing parameter, adjusted by emotion.
     */
    _updateBreathing(dt, coreModel) {
        const br = this._breath;

        // Startle breath-hold: freeze mid-breath for ~1s after a surprise,
        // then resume the sine where it left off.
        if (performance.now() < this._breathHoldUntil) {
            br.value = 0.15;
            this.setParameter('PARAM_BREATH', 'ParamBreath', br.value);
            return;
        }

        let speedMult = 1.0;
        let ampMult = 1.0;
        
        const label = this.currentEmotion;
        if (label === 'excited' || label === 'happy') {
            speedMult = 1.8;
            ampMult = 1.4;
        } else if (label === 'angry' || label === 'annoyed' || label === 'frustrated' || label === 'stress') {
            speedMult = 1.5;
            ampMult = 1.6; // deeper/heavier breaths
        } else if (label === 'sad' || label === 'tired' || label === 'bitter' ||
                   label === 'sleepy' || label === 'sleeping') {
            speedMult = 0.6;
            ampMult = 0.6; // shallow/slow breaths
        }

        // Music-aware breathing: lively tracks quicken her breath a little
        speedMult *= 1 + this._musicEnergy * 0.2;
        ampMult *= 1 + this._musicEnergy * 0.25;
        
        br.phase += br.speed * speedMult * dt;
        if (br.phase > Math.PI * 2) br.phase -= Math.PI * 2;

        // Proximity: she breathes a bit faster/deeper when someone is close
        const proximityAmp = 1.0 + this._proximity * 0.7;

        br.value = (Math.sin(br.phase) * 0.5 + 0.5) * br.amplitude * ampMult * proximityAmp;

        this.setParameter('PARAM_BREATH', 'ParamBreath', br.value);
    }

    /**
     * Body sway: gentle oscillation on body angle parameters, scaled by emotional intensity.
     */
    _updateBodySway(dt, coreModel) {
        const s = this._sway;
        
        let speedMult = 1.0;
        let ampMult = 1.0;
        
        const label = this.currentEmotion;
        if (label === 'excited' || label === 'happy') {
            speedMult = 1.6;
            ampMult = 1.5;
        } else if (label === 'angry' || label === 'annoyed' || label === 'frustrated' || label === 'stress') {
            speedMult = 0.5; // tensed up, less active sway
            ampMult = 0.6;
        } else if (label === 'sad' || label === 'tired' || label === 'bitter') {
            speedMult = 0.4;
            ampMult = 0.5;
        }
        
        s.phaseZ += s.speedZ * speedMult * dt;
        s.phaseX += s.speedX * speedMult * dt;
        if (s.phaseZ > Math.PI * 2) s.phaseZ -= Math.PI * 2;
        if (s.phaseX > Math.PI * 2) s.phaseX -= Math.PI * 2;

        s.valueZ = Math.sin(s.phaseZ) * s.amplitudeZ * ampMult;
        s.valueX = Math.sin(s.phaseX) * s.amplitudeX * ampMult;

        // Posture fatigue: after a long desk session she slowly sags forward
        // instead of sitting bolt upright.
        s.valueX -= this._sessionFatigue * 0.9;

        // Music groove: on energetic tracks a slow, song-length sway adds to
        // the micro-sway so she visibly rides the track's overall energy.
        const groove = this._musicEnergy * Math.sin(s.phaseZ * 0.13) * 1.6;
        s.valueZ += groove;

        this.addToParameter('PARAM_BODY_ANGLE_Z', 'ParamBodyAngleZ', s.valueZ);
        this.addToParameter('PARAM_BODY_ANGLE_X', 'ParamBodyAngleX', s.valueX);
    }

    /**
     * Head sway: gentle oscillation on head angle parameters layered on top of mouse tracking.
     */
    _updateHeadSway(dt, coreModel) {
        const hs = this._headSway;
        
        let speedMult = 1.0;
        let ampMult = 1.0;
        
        // If typing, lean head slightly down-forward
        if (this.isTyping) {
            const lerpFactor = 1.0 - Math.pow(1.0 - 0.005, dt);
            hs.valueX += (0.0 - hs.valueX) * lerpFactor;
            hs.valueY += (-4.0 - hs.valueY) * lerpFactor; // slightly down
            hs.valueZ += (0.0 - hs.valueZ) * lerpFactor;
        } else {
            const label = this.currentEmotion;
            if (label === 'excited' || label === 'happy') {
                speedMult = 1.5;
                ampMult = 1.4;
            } else if (label === 'sad' || label === 'tired') {
                speedMult = 0.5;
                ampMult = 0.6;
            }
            
            hs.phaseX += hs.speedX * speedMult * dt;
            hs.phaseY += hs.speedY * speedMult * dt;
            hs.phaseZ += hs.speedZ * speedMult * dt;
            
            if (hs.phaseX > Math.PI * 2) hs.phaseX -= Math.PI * 2;
            if (hs.phaseY > Math.PI * 2) hs.phaseY -= Math.PI * 2;
            if (hs.phaseZ > Math.PI * 2) hs.phaseZ -= Math.PI * 2;

            hs.valueX = Math.sin(hs.phaseX) * hs.amplitudeX * ampMult;
            hs.valueY = Math.sin(hs.phaseY) * hs.amplitudeY * ampMult;
            hs.valueZ = Math.sin(hs.phaseZ) * hs.amplitudeZ * ampMult;

            // Music groove: a slow, song-length nod so she's visibly listening
            hs.valueY += this._musicEnergy * Math.sin(hs.phaseY * 0.1) * 2.2;
        }

        // Peek override: on a return greeting she turns her head toward the
        // side the user came back from and lifts it slightly. Blends with the
        // sway so the look-in is smooth rather than a snap.
        const pkEnv = this._peek && this._peek.active ? (this._peekEnv || 0) : 0;
        if (pkEnv > 0) {
            const pkDir = this._peek.dir || 1;
            hs.valueY = hs.valueY * (1 - pkEnv) + pkDir * 13 * pkEnv;
            hs.valueX = hs.valueX * (1 - pkEnv) + 4.5 * pkEnv;
            hs.valueZ = hs.valueZ * (1 - pkEnv);
        }

        // Posture fatigue: her head droops a little more the longer she's been
        // holding the desk, on top of everything else.
        hs.valueX += this._sessionFatigue * 1.6;

        this.addToParameter('PARAM_ANGLE_X', 'ParamAngleX', hs.valueX);
        this.addToParameter('PARAM_ANGLE_Y', 'ParamAngleY', hs.valueY);
        this.addToParameter('PARAM_ANGLE_Z', 'ParamAngleZ', hs.valueZ);
    }

    /**
     * Idle eye micro-movements: subtle random eye position changes when mouse is inactive.
     * Incorporates thinking state and conversational gaze aversion.
     */
    _updateIdleEyes(now, dt, coreModel) {
        const e = this._idleEyes;
        const ma = this._mouseActivity;
        const ga = this._gazeAversion;

        // 0. Peek override: while she glances up at a returning user the eyes
        // track toward the same side — beats thinking/aversion/typing gaze.
        const pkEnv = this._peek && this._peek.active ? (this._peekEnv || 0) : 0;
        if (pkEnv > 0) {
            const lerpFactor = 1.0 - Math.pow(1.0 - 0.006, dt);
            e.currentX += ((this._peek.dir * 0.65) - e.currentX) * lerpFactor;
            e.currentY += (-0.35 - e.currentY) * lerpFactor; // up, where they'd be
            this.addToParameter('PARAM_EYE_BALL_X', 'ParamEyeBallX', e.currentX);
            this.addToParameter('PARAM_EYE_BALL_Y', 'ParamEyeBallY', e.currentY);
            return;
        }

        // 1. Thinking / Memory Retrieval gaze aversion
        if (this.isThinking) {
            if (now >= e.nextChangeTime) {
                // Drift thoughtfully
                e.targetX = -0.4;
                e.targetY = 0.3;
                e.nextChangeTime = now + this._randomRange(3000, 6000);
            }
            const lerpFactor = 1.0 - Math.pow(1.0 - 0.003, dt);
            e.currentX += (e.targetX - e.currentX) * lerpFactor;
            e.currentY += (e.targetY - e.currentY) * lerpFactor;
            
            this.addToParameter('PARAM_EYE_BALL_X', 'ParamEyeBallX', e.currentX);
            this.addToParameter('PARAM_EYE_BALL_Y', 'ParamEyeBallY', e.currentY);
            return;
        }

        // 2. Gaze Aversion (conversational or interactive hover-triggered)
        if (ga.active) {
            if (now >= ga.endTime) {
                ga.active = false;
                ga.nextTriggerTime = now + this._randomRange(4000, 8000);
            }
        } else if (this.isSpeaking) {
            if (now >= ga.nextTriggerTime) {
                ga.active = true;
                ga.targetX = (Math.random() < 0.5 ? -0.4 : 0.4);
                ga.targetY = (Math.random() * 2 - 1) * 0.2;
                ga.endTime = now + this._randomRange(800, 1500);
            }
        }

        if (ga.active) {
            const lerpFactor = 1.0 - Math.pow(1.0 - 0.004, dt);
            e.currentX += (ga.targetX - e.currentX) * lerpFactor;
            e.currentY += (ga.targetY - e.currentY) * lerpFactor;
            
            this.addToParameter('PARAM_EYE_BALL_X', 'ParamEyeBallX', e.currentX);
            this.addToParameter('PARAM_EYE_BALL_Y', 'ParamEyeBallY', e.currentY);
            return;
        }

        // 3. Typing State Gaze focus
        if (this.isTyping) {
            const lerpFactor = 1.0 - Math.pow(1.0 - 0.006, dt);
            e.currentX += (0 - e.currentX) * lerpFactor;
            e.currentY += (-0.15 - e.currentY) * lerpFactor; // focus slightly down at user writing area

            this.addToParameter('PARAM_EYE_BALL_X', 'ParamEyeBallX', e.currentX);
            this.addToParameter('PARAM_EYE_BALL_Y', 'ParamEyeBallY', e.currentY);
            return;
        }

        // 4. Default Idle Eyes or Mouse Tracking
        const mouseIdle = (now - ma.lastMoveTime) > ma.idleThreshold;

        // Alone (low proximity): she glances around more. Close-up: eyes stay on you.
        e.amplitude = this._proximity > 0.45 ? 0.25 : 0.5;

        if (mouseIdle) {
            if (now >= e.nextChangeTime) {
                e.targetX = (Math.random() * 2 - 1) * e.amplitude;
                e.targetY = (Math.random() * 2 - 1) * e.amplitude * 0.6;
                e.nextChangeTime = now + this._randomRange(e.minInterval, e.maxInterval);
            }

            const lerpFactor = 1.0 - Math.pow(1.0 - e.lerpSpeed, dt);
            e.currentX += (e.targetX - e.currentX) * lerpFactor;
            e.currentY += (e.targetY - e.currentY) * lerpFactor;

            this.addToParameter('PARAM_EYE_BALL_X', 'ParamEyeBallX', e.currentX);
            this.addToParameter('PARAM_EYE_BALL_Y', 'ParamEyeBallY', e.currentY);
        } else {
            const lerpFactor = 1.0 - Math.pow(1.0 - 0.005, dt);
            e.currentX += (0 - e.currentX) * lerpFactor;
            e.currentY += (0 - e.currentY) * lerpFactor;
        }
    }

    /**
     * Eyebrow micro-expressions: very subtle brow movements for organic feel.
     * Integrates emotional shape/height scaling and angles.
     */
    _updateBrows(now, dt, coreModel) {
        const bw = this._brows;

        if (now >= bw.nextChangeTime) {
            bw.targetL = (Math.random() * 2 - 1) * bw.amplitude;
            bw.targetR = (Math.random() * 2 - 1) * bw.amplitude;
            if (Math.random() < 0.7) {
                bw.targetR = bw.targetL + (Math.random() * 0.05 - 0.025);
            }
            bw.nextChangeTime = now + this._randomRange(bw.minInterval, bw.maxInterval);
        }

        const lerpFactor = 1.0 - Math.pow(1.0 - bw.lerpSpeed, dt);
        bw.currentL += (bw.targetL - bw.currentL) * lerpFactor;
        bw.currentR += (bw.targetR - bw.currentR) * lerpFactor;

        // Base vertical offsets and angles based on emotions
        let verticalOffset = 0.0;
        let browAngle = 0.0;

        const label = this.currentEmotion;
        if (label === 'angry' || label === 'annoyed' || label === 'frustrated' || label === 'stress') {
            verticalOffset = -0.3; // low eyebrows
            browAngle = -0.5;      // frown angle
        } else if (label === 'sad' || label === 'tired' || label === 'bitter') {
            verticalOffset = -0.1;
            browAngle = 0.4;       // sad angle
        } else if (label === 'surprised' || label === 'excited') {
            verticalOffset = 0.4;  // raised eyebrows
            browAngle = 0.1;
        } else if (label === 'happy') {
            verticalOffset = 0.15;
            browAngle = 0.0;
        }

        // Dirty-checked writes: brow offsets only drift a hair per frame and the
        // angles are emotion constants, so most frames write nothing.
        const browLY = bw.currentL + verticalOffset;
        const browRY = bw.currentR + verticalOffset;
        if (this._shouldWrite('ParamBrowLY', browLY)) {
            this.setParameter('PARAM_BROW_L_Y', 'ParamBrowLY', browLY);
        }
        if (this._shouldWrite('ParamBrowRY', browRY)) {
            this.setParameter('PARAM_BROW_R_Y', 'ParamBrowRY', browRY);
        }
        if (this._shouldWrite('ParamBrowLAngle', browAngle)) {
            this.setParameter('PARAM_BROW_L_ANGLE', 'ParamBrowLAngle', browAngle);
        }
        if (this._shouldWrite('ParamBrowRAngle', browAngle)) {
            this.setParameter('PARAM_BROW_R_ANGLE', 'ParamBrowRAngle', browAngle);
        }
    }

    _randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * OS-level reduced-motion preference: cosmetic body-motion schedulers
     * (ambient Special motions, self-initiated idle gestures) stay dormant so
     * the wallpaper respects the user's accessibility setting. The subtle
     * breathing/blinking/sway loop still runs — those aren't the motion events
     * that trigger vestibular discomfort.
     */
    _reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /**
     * Dirty check for direct (non-smoothed) writes: only pass through when the
     * value moved past a small epsilon since the last write, so steady-state
     * frames skip redundant model writes entirely.
     */
    _shouldWrite(id, value, eps) {
        const last = this._lastDirectParam[id];
        const threshold = eps || 0.0005;
        if (last === undefined || Math.abs(last - value) > threshold) {
            this._lastDirectParam[id] = value;
            return true;
        }
        return false;
    }

    /**
     * Handle hit area interactions.
     */
    _onHit(hitAreas) {
        const isC4 = this._isCubism4;
        const now = performance.now();
        const headName = isC4 ? 'Head' : 'head';
        const bodyName = isC4 ? 'Body' : 'body';
        const handLName = isC4 ? 'HandL' : 'hand_l';
        const handRName = isC4 ? 'HandR' : 'hand_r';

        if (hitAreas.includes(headName)) {
            // Cheek pokes: a head tap on the lower side of the face reads as a
            // poke (puffed cheeks, annoyed, recoil) instead of a startled head tap.
            if (isC4 && this._lastTap && now - this._lastPoke > 2500) {
                const hw = this.model.width * this.model.scale.x;
                const hh = this.model.height * this.model.scale.y;
                const dx = this._lastTap.x - this.model.x;
                const dy = this._lastTap.y - (this.model.y - hh * 0.28);
                const inFaceWidth = Math.abs(dx) < hw * 0.11;
                const inFaceHeight = Math.abs(dy) < hh * 0.10;
                const offCenter = Math.abs(dx) > hw * 0.015;
                const lowerFace = dy > -hh * 0.01;
                if (inFaceWidth && inFaceHeight && offCenter && lowerFace) {
                    this._pokeCheek();
                    return;
                }
            }
            if (isC4) {
                this.model.motion('TapHead');
                this.triggerSurprise(); // head taps get a startled face
            } else {
                const headMotions = ['flick_head', 'pinch_in', 'pinch_out'];
                const pick = headMotions[Math.floor(Math.random() * headMotions.length)];
                this.model.motion(pick);
            }
        } else if (hitAreas.includes(bodyName)) {
            if (isC4) {
                this.model.motion('TapBody');
            } else {
                const bodyMotions = ['tap_body', 'shake', 'pinch_out'];
                const pick = bodyMotions[Math.floor(Math.random() * bodyMotions.length)];
                this.model.motion(pick);
            }
        } else if (hitAreas.includes(handLName) || hitAreas.includes(handRName)) {
            // Hand tap: trigger arm change pose with a shy reaction
            if (isC4) {
                const hand = hitAreas.includes(handRName) ? 'R' : 'L';
                
                // Random reaction: arm change, head tilt, or special idle
                const reactions = [
                    { motion: 'TapBody', emotion: 'amused', blush: 1 },
                    { motion: 'Special', emotion: 'happy', blush: 1 },
                    { motion: 'TapHead', emotion: 'surprised', blush: 1 },
                ];
                const reaction = reactions[Math.floor(Math.random() * reactions.length)];
                
                this.model.motion(reaction.motion);
                // Toggle arm pose on hand tap
                this.armChangeActive = !this.armChangeActive;
                this._applyManualOverrides(this.model.internalModel.coreModel);
                
                // Shy reaction: blush + appropriate emotion
                if (this.blushLevel < reaction.blush) this.blushLevel = reaction.blush;
                this.setEmotion(reaction.emotion, 4000);
            }
        } else if (hitAreas.includes('mouth')) {
            this._randomExpression();
            const tapMotion = isC4 ? 'TapBody' : 'tap_body';
            this.model.motion(tapMotion);
        }
    }

    /**
     * Rare ambient motions: a much lighter successor to _startAmbientSystem.
     * Plays only the Special group (haru_g_idle, xhiyori_m03) and only during
     * calm, wakeful, unoccupied moments — roughly once a minute, never on top
     * of speech, petting, a hold, or an easter egg.
     */
    _startRareAmbientMotions() {
        if (this._isCubism4 !== true) return;
        // Skip full-body motion events for reduced-motion users or if disabled
        if (!this._features.ambientMotions) return;
        if (this._reducedMotion()) return;
        const schedule = () => {
            const delay = 45000 + Math.random() * 45000;
            this._ambientTimer = setTimeout(() => {
                this._ambientTimer = null;
                if (!this._ready || this._paused || this._idleMode || this.isSpeaking ||
                    this._petMode || this._holdTimer || this._egg.type ||
                    !this.model || !this.model.motion) {
                    schedule();
                    return;
                }
                const label = this.currentEmotion;
                if (['angry', 'annoyed', 'frustrated', 'stress', 'scared',
                     'sad', 'bitter', 'sleepy', 'sleeping'].includes(label)) {
                    schedule();
                    return;
                }
                try {
                    this.model.motion('Special');
                } catch (e) { /* optional — never break the loop */ }
                schedule();
            }, delay);
        };
        schedule();
    }

    /**
     * Ambient motion system — makes the character feel alive.
     */
    _startAmbientSystem() {        const scheduleNext = () => {
            const delay = 15000 + Math.random() * 15000;
            this._ambientTimer = setTimeout(() => {
                if (!this._ready) {
                    scheduleNext();
                    return;
                }
                const group = this._ambientMotions[Math.floor(Math.random() * this._ambientMotions.length)];
                this.model.motion(group);

                if (Math.random() < 0.2) {
                    this._randomExpression();
                }

                scheduleNext();
            }, delay);
        };
        scheduleNext();
    }

    /**
     * Set a random expression from available set.
     * Only fires while the mood engine is idle (no active emotional override)
     * and syncs currentEmotion so the procedural face matches the expression.
     */
    _randomExpression() {
        if (!this._ready) return;
        if (!['neutral', 'calm', 'thinking'].includes(this.currentEmotion)) return;
        const exp = this._allExpressions[Math.floor(Math.random() * this._allExpressions.length)];
        this.model.expression(exp);
        const sync = {
            'Stanby Angry': 'angry',
            'Stanby Sad': 'sad',
            'Stanby Scared': 'scared',
            'Stanby Smile': 'happy',
            'Stanby Surprised': 'surprised',
        };
        if (sync[exp]) {
            this.currentEmotion = sync[exp];
            this._lastExpression = exp;
        }
    }

    /**
     * Fit model to container while maintaining aspect ratio.
     */
    _fitModel() {
        if (!this.model || !this.app) return;

        const container = this.app.view.parentElement;
        const cw = container.clientWidth;
        const ch = container.clientHeight;

        if (cw === 0 || ch === 0) return;

        this.model.scale.set(1.0);
        const mw = this.model.width;
        const mh = this.model.height;

        if (mw === 0 || mh === 0) return;

        // Custom fitting scale for actual Kurisu vs old model Shizuku
        const scaleFactor = this._isCubism4 ? 0.95 : 1.1;
        const scale = Math.min(cw / mw, ch / mh) * scaleFactor;
        this.model.scale.set(scale);
        
        const shiftX = 0;
        if (this.model.anchor) {
            this.model.anchor.set(0.5, 0.5);
            this.model.x = cw / 2 - shiftX;
            this.model.y = ch / 2;
        } else {
            this.model.x = (cw - mw * scale) / 2 - shiftX;
            this.model.y = (ch - mh * scale) / 2;
        }

        this._recordBasePose();
        this.app.renderer.render(this.app.stage);
    }

    /**
     * Setup mouse/touch tracking for eye follow + click interaction.
     */
    _setupMouseTracking() {
        if (!this.model) return;

        const view = this.app.view;

        const onMove = (x, y) => {
            const rect = view.getBoundingClientRect();
            const fx = (x - rect.left) / rect.width;
            const fy = (y - rect.top) / rect.height;
            this._cursorNX = fx;
            this._cursorNY = fy;
            this.model.focus(fx * view.width, fy * view.height);

            this._mouseActivity.lastMoveTime = performance.now();
        };

        document.addEventListener('mousemove', (e) => {
            this._mouseActivity.lastMoveTime = performance.now();
            this._lastActivityTime = performance.now();

            // Fast cursor flicks earn a quick glance in the direction of travel
            const now = performance.now();
            const vx = e.clientX - this._lastMoveX;
            const vy = e.clientY - this._lastMoveY;
            const dtm = now - this._lastMoveAt;
            this._lastMoveX = e.clientX;
            this._lastMoveY = e.clientY;
            this._lastMoveAt = now;
            const vel = dtm > 0 ? Math.hypot(vx, vy) / dtm : 0;
            this._cursorVelocity = this._cursorVelocity * 0.6 + vel * 0.4;
            if (now - this._flinchAt > 4000 && this._cursorVelocity > 1.8 && vx !== 0 &&
                !this.isSpeaking && !this._petMode && !this._paused && this._ready &&
                !this._peek.active) {
                this._flinchAt = now;
                this._peek.active = true;
                this._peek.dir = vx > 0 ? 1 : -1;
                this._peek.started = now;
                this._peek.until = now + 700;
                this._peekEnv = 0;
            }

            const rect = view.getBoundingClientRect();
            // Always track raw cursor position (even outside the margin) so
            // proximity can fall to 0 when the mouse leaves her area
            this._cursorNX = (e.clientX - rect.left) / rect.width;
            this._cursorNY = (e.clientY - rect.top) / rect.height;
            const margin = 200;
            if (e.clientX >= rect.left - margin && e.clientX <= rect.right + margin &&
                e.clientY >= rect.top - margin && e.clientY <= rect.bottom + margin) {
                onMove(e.clientX, e.clientY);
            }

            // Interactive shy hover: check if directly over the PIXI canvas
            const isOverCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                                 e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (isOverCanvas) {
                if (this.blushLevel === 0 && !this.isSpeaking) {
                    this.blushLevel = 1; // micro-blush
                    
                    // Trigger dynamic shy gaze aversion
                    if (!this._gazeAversion.active) {
                        this._gazeAversion.active = true;
                        this._gazeAversion.targetX = Math.random() < 0.5 ? -0.3 : 0.3;
                        this._gazeAversion.targetY = 0.1;
                        this._gazeAversion.endTime = performance.now() + 1200;
                    }
                }
            } else {
                if (this.blushLevel === 1 && !this.isSpeaking && (!this.attachmentState.jealousy_level || this.attachmentState.jealousy_level <= 0.15)) {
                    this.blushLevel = 0;
                }
            }
        });

        view.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                onMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        });

        // --- Drag-to-move (pet mode) + tap-to-interact ---
        const DRAG_THRESHOLD = 6; // px before a press becomes a drag
        let dragging = false;
        let dragMode = 'tap'; // becomes 'drag' once moved past threshold
        const dragStart = { x: 0, y: 0, modelX: 0, modelY: 0 };

        const canvasToWorld = (cx, cy) => {
            const rect = view.getBoundingClientRect();
            return {
                x: (cx - rect.left) * (view.width / rect.width),
                y: (cy - rect.top) * (view.height / rect.height),
            };
        };

        view.addEventListener('pointerdown', (e) => {
            const p = canvasToWorld(e.clientX, e.clientY);
            dragStart.x = p.x;
            dragStart.y = p.y;
            dragStart.modelX = this.model.x;
            dragStart.modelY = this.model.y;
            dragging = true;
            dragMode = 'tap';
            // Hold-to-pet: press and hold without dragging counts as petting.
            this._holding = false;
            clearTimeout(this._holdTimer);
            this._holdTimer = setTimeout(() => {
                this._holding = true;
                this._petOnHold();
            }, 650);
            if (view.setPointerCapture) {
                try { view.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            }
        });

        view.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const p = canvasToWorld(e.clientX, e.clientY);
            const dx = p.x - dragStart.x;
            const dy = p.y - dragStart.y;
            // Moving the pointer cancels any pending hold (this is a drag/tap).
            if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                clearTimeout(this._holdTimer);
                this._holdTimer = null;
            }
            if (dragMode === 'tap' && this._petMode && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                dragMode = 'drag';
                this._dragged = true;
                this._draggingNow = true;
                this.triggerSurprise(); // she notices being picked up
            }
            if (dragMode === 'drag') {
                this.model.x = Math.min(view.width * 0.88, Math.max(view.width * 0.12, dragStart.modelX + dx));
                this.model.y = Math.min(view.height * 0.98, Math.max(view.height * 0.3, dragStart.modelY + dy));
                this._recordBasePose();
                this._syncGroundShadow();
                this._petInteraction(Math.hypot(dx, dy));
                this.app.renderer.render(this.app.stage);
            }
        });

        const finishPointer = (e) => {
            if (!dragging) return;
            clearTimeout(this._holdTimer);
            this._holdTimer = null;
            dragging = false;
            this._draggingNow = false;
            if (dragMode === 'tap' && !this._holding) {
                // A real tap: let the model react to what was hit
                const p = canvasToWorld(e.clientX, e.clientY);
                this._lastTap = p;
                this.model.tap(p.x, p.y);
            } else if (this._dragged) {
                // A drag just ended — persist her new spot
                if (typeof this.onPetMoved === 'function') this.onPetMoved();
            }
            this._holding = false;
        };
        view.addEventListener('pointerup', finishPointer);
        view.addEventListener('pointercancel', finishPointer);

        // Double-click: she startles, and occasionally blurts something before
        // snapping back to center stage.
        view.addEventListener('dblclick', () => {
            clearTimeout(this._holdTimer);
            this._holdTimer = null;
            this._dragged = false;
            this._fitModel();
            this._syncGroundShadow();
            this.triggerSurprise();
            const now = performance.now();
            if (typeof this.onInteract === 'function' && now - (this._lastDblClickLine || 0) > 15000 && Math.random() < 0.5) {
                this._lastDblClickLine = now;
                const line = this._petLine();
                if (line) this.onInteract(line);
            }
        });
    }

    resize() {
        if (!this.app || !this.model) return;
        const container = this.app.view.parentElement;
        const cw = container.clientWidth;
        const ch = container.clientHeight;

        if (cw > 0 && ch > 0) {
            this.app.renderer.resize(cw, ch);
            if (!this._dragged) {
                this._fitModel();
            }
            this.app.renderer.render(this.app.stage);
        }
    }

    /**
     * Pause Pixi ticker when tab is hidden.
     */
    pause() {
        this._paused = true;
        if (this.app) {
            this.app.stop();
        }
        if (this._rafHandle) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }
    }

    /**
     * Resume Pixi ticker and resize when tab is shown.
     */
    resume() {
        this._paused = false;
        if (this.app) {
            this.app.start();
            this.resize();
            requestAnimationFrame(() => this.resize());
            setTimeout(() => this.resize(), 50);
            setTimeout(() => this.resize(), 150);
            setTimeout(() => this.resize(), 300);
        }
        if (!this._rafHandle) {
            this._startLifelikeAnimations();
        }
    }

    /**
     * Debug snapshot for the Ctrl+Shift+D overlay: live emotion, mood,
     * time-of-day, pupil target, and raw smoothed parameter values so the
     * blind-tuned constants can be verified against the running model.
     */
    debugState() {
        const b = this._blink;
        const current = this._paramCurrent || {};
        const pick = (ids) => {
            for (const id of ids) {
                if (current[id] !== undefined) return +current[id].toFixed(2);
            }
            return null;
        };
        // Mirror the _onHit cheek-poke pixel math so the overlay can draw the
        // live hit zone over the canvas.
        let cheekZone = null;
        if (this._ready && this.model) {
            const hw = this.model.width * this.model.scale.x;
            const hh = this.model.height * this.model.scale.y;
            cheekZone = {
                x: Math.round(this.model.x + hw * 0.015 - hw * 0.11),
                y: Math.round((this.model.y - hh * 0.28) - hh * 0.10),
                w: Math.round(hw * 0.22),
                h: Math.round(hh * 0.20),
            };
        }
        return {
            emotion: this.currentEmotion,
            mood: Math.round(this._mood),
            music: +this._musicEnergy.toFixed(2),
            fatigue: +this._sessionFatigue.toFixed(2),
            night: this._night,
            hour: this._hour,
            proximity: +this._proximity.toFixed(2),
            pupil: +this._pupilTarget.toFixed(2),
            cheekZone: cheekZone,
            blinkPhase: b ? b.phase : 'open',
            blinkValue: b ? +b.value.toFixed(2) : 1,
            sleep: this._sleepChoreo.dozing ? 'dozing' : (this._wasSleeping ? 'asleep' : 'awake'),
            gestureArm: this._gestureArm,
            egg: this._egg.type || 'none',
            params: {
                pupil: pick(['EyeballSize', 'PARAM_EYE_SIZE']),
                eyeOpen: pick(['ParamEyeLOpen', 'PARAM_EYE_L_OPEN']),
                tongue: pick(['TongueOut']),
                rage: pick(['RageSign']),
                smile: pick(['Smile']),
                sad: pick(['Sad']),
                angry: pick(['Angry']),
                surprised: pick(['Surprissed']),
                scared: pick(['Scared']),
                bodyAngleZ: pick(['ParamBodyAngleZ', 'PARAM_BODY_ANGLE_Z']),
                bodyAngleX: pick(['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X']),
                headAngleZ: pick(['ParamAngleZ', 'PARAM_ANGLE_Z']),
                hands: pick(['HandChange']),
            },
        };
    }

    /**
     * Clean up timers, animation frame, and optionally PIXI application.
     */
    destroy(complete = false) {
        if (this._ambientTimer) clearTimeout(this._ambientTimer);
        if (this._idleTimer) clearTimeout(this._idleTimer);
        if (this._ambientMood && this._ambientMood.timer) clearTimeout(this._ambientMood.timer);
        if (this._gestureTimer) clearTimeout(this._gestureTimer);
        if (this._speechOffTimer) clearTimeout(this._speechOffTimer);
        if (this._holdTimer) clearTimeout(this._holdTimer);
        if (this._rafHandle) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }
        if (this._resizeObserver && this._resizeObserver.disconnect) {
            this._resizeObserver.disconnect();
        }
        if (this.app && this.model) {
            try {
                this.app.stage.removeChild(this.model);
                this.model.destroy();
            } catch (e) {
                console.warn('[L2D] Error removing model during destroy:', e);
            }
            this.model = null;
        }
        if (complete && this.app) {
            try {
                this.app.destroy(true, { children: true, texture: true, baseTexture: true });
            } catch (e) {
                console.warn('[L2D] Error destroying PIXI app:', e);
            }
            this.app = null;
        }
    }
}

// Expose globally
window.Live2DController = Live2DController;
