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

        // Visual controls (Kurisu Cubism 4 model overrides)
        this.armChangeActive = false;
        this.blushLevel = 0; // 0 = none, 1 = blush 1 (0.5), 2 = blush 2 (1.0)

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

        // Proximity awareness: how close the cursor is to Kurisu's face (0..1).
        // Drives blush, breathing intensity, and how much she glances around.
        this._proximity = 0;
        this._cursorNX = 1.5; // init far away so she starts neutral
        this._cursorNY = 1.5;

        // Ambient moods: rare, subtle smile/blush moments that fade in/out.
        this._ambientMood = { type: 'none', value: 0, expireAt: undefined, timer: null };

        // Pause flag set by pause()/resume() so timers can be gated
        this._paused = false;

        // Stage spotlight tint (updated from proximity, throttled)
        this._auraEl = null;
        this._lastAuraP = -1;
        this._lastAuraColor = '';

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

        // Idle power-saving mode (set from wallpaper.js when system is silent)
        this._idleMode = false;
        this._idleFrameSkip = 0;

        // Emotion engine — derives a live emotional state from real context
        // (audio energy, speech, proximity, click surprises, long quiet spells)
        // so the procedural face/body subsystems have something to respond to.
        this._audioEnergy = 0;            // bass energy fed by wallpaper.js (0..1)
        this._lastAudioTime = 0;          // last time real audio was heard
        this._lastActivityTime = performance.now(); // audio or mouse activity
        this._surpriseUntil = 0;          // end of current surprised reaction
        this._lastSurprise = 0;           // cooldown guard for triggerSurprise()
        this._lastEmotionCheck = 0;       // throttle for the mood evaluator
        this._lastExpression = undefined; // last expression asset applied
    }

    /**
     * Toggle idle power-saving mode: slows the Pixi ticker and the lifelike
     * parameter subsystems so the model keeps breathing/blinking but at a
     * fraction of the GPU cost.
     */
    setIdleMode(idle) {
        if (this._idleMode === idle) return;
        this._idleMode = !!idle;
        if (this.app && this.app.ticker) {
            // speed only slows animation time, not draw frequency — maxFPS
            // actually caps how often Pixi renders the model while idle.
            this.app.ticker.speed = idle ? 0.2 : 1.0;
            if (typeof this.app.ticker.maxFPS === 'number') {
                this.app.ticker.maxFPS = idle ? 10 : 0;
            }
        }
        if (idle) {
            this._idleFrameSkip = 0;
        }
    }

    /**
     * Feed the current bass/audio energy so the mood engine can react to the
     * soundtrack in real time (0..1). Called from wallpaper.js per audio frame.
     */
    setAudioEnergy(level) {
        this._audioEnergy = Math.max(0, Math.min(1, level || 0));
        if (this._audioEnergy > 0.2) {
            this._lastAudioTime = performance.now();
            this._lastActivityTime = performance.now();
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
        this.setEmotion('surprised');
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
        this.currentEmotion = target;
        if (holdMs && holdMs > 0) {
            this._emotionHoldUntil = performance.now() + holdMs;
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
            case 'content':
            case 'calm':
                return 'Blush 1'; // gentle blush — satisfied but subdued
            case 'curious':
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
                this._lastExpression = expName;
                this.model.expression(expName);
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
        } else if (this._proximity > 0.55) {
            label = 'happy'; // she notices you hovering near her face
        } else {
            const quiet = now - this._lastActivityTime;
            if (quiet > 90000) {
                label = 'tired';
            } else if (quiet > 20000) {
                label = 'content'; // relaxed, soft smile while things are calm
            }
        }

        if (label && label !== this.currentEmotion) {
            this.setEmotion(label);
        }
    }

    /**
     * Set a parameter value dynamically, supporting both Cubism 2 and Cubism 4 names.
     */
    setParameter(id2, id3, value) {
        if (!this.model || !this.model.internalModel) return;
        const coreModel = this.model.internalModel.coreModel;
        if (!coreModel) return;

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
            this.app = new PIXI.Application({
                view: canvas,
                autoStart: true,
                backgroundAlpha: 0,
                antialias: true,
                transparent: true,
                // Cap backing resolution to keep the GPU cost reasonable on hi-DPI screens
                resolution: Math.min(window.devicePixelRatio || 1, 1.5),
            });

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

            // Start idle motion loop
            const idleMotionGroup = this._isCubism4 ? 'Idle' : 'idle';
            this.model.motion(idleMotionGroup);

            // Setup mouse tracking
            this._setupMouseTracking();

            // Start ambient motion system
            this._startAmbientSystem();

            // Start rare ambient moods (soft smile / blush moments)
            this._startAmbientMoods();

            // Start lifelike animation loop
            this._startLifelikeAnimations();

            this._ready = true;
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
        this._blink.nextBlinkTime = now + this._randomRange(1000, 3000); // first blink soon
        this._idleEyes.nextChangeTime = now + 1000;
        this._brows.nextChangeTime = now + 3000;

        const animate = (timestamp) => {
            this._rafHandle = requestAnimationFrame(animate);

            if (!this._ready || !this.model || !this.model.internalModel) return;
            const coreModel = this.model.internalModel.coreModel;
            if (!coreModel) return;

            // Idle power saving: run lifelike subsystems at ~1/6 rate
            if (this._idleMode) {
                if (++this._idleFrameSkip % 6 !== 0) return;
                this._idleFrameSkip = 0;
            }

            const dt = timestamp - this._lastFrameTime;
            this._lastFrameTime = timestamp;

            // Clamp delta to avoid huge jumps after tab switch
            const clampedDt = Math.min(dt, 100);

            // Update all subsystems
            this._updateProximity();
            this._updateAmbientMood(clampedDt);
            this._updateBlink(timestamp, clampedDt, coreModel);
            this._updateBreathing(clampedDt, coreModel);
            this._updateBodySway(clampedDt, coreModel);
            this._updateHeadSway(clampedDt, coreModel);
            this._updateIdleEyes(timestamp, clampedDt, coreModel);
            this._updateBrows(timestamp, clampedDt, coreModel);

            // Emotion engine (throttled internally to ~2.5Hz)
            this._updateEmotion(timestamp);

            // Apply custom manual overrides (like crossed arms and blushing cheeks)
            this._applyManualOverrides(coreModel);
        };

        this._rafHandle = requestAnimationFrame(animate);
    }

    /**
     * Apply manual overrides like arm pose, blushing level, and mouth shape in the frame tick.
     */
    _applyManualOverrides(coreModel) {
        if (this._isCubism4) {
            if (coreModel.setParameterValueById) {
                // Arm Change: sets "HandChange" parameter to 1.0 (crossed) or 0.0 (normal)
                coreModel.setParameterValueById('HandChange', this.armChangeActive ? 1.0 : 0.0);
                
                // Blush: sets "ParamCheek" parameter to 0.5 (Mild), 1.0 (Heavy), or 0.0 (None).
                // Proximity adds a smooth blush when the cursor is close to her face,
                // and the ambient mood can add a slow blush moment.
                const cheekVal = this.blushLevel === 1 ? 0.5 : (this.blushLevel === 2 ? 1.0 : 0.0);
                let cheek = Math.max(cheekVal, this._proximity * 0.7);
                if (this._ambientMood.type === 'blush') {
                    cheek = Math.max(cheek, this._ambientMood.value * 0.55);
                }
                coreModel.setParameterValueById('ParamCheek', cheek);

                // Mouth Form: sets "ParamMouthForm" to 1.0 (smile), -1.0 (frown), or 0.0 (neutral)
                const label = this.currentEmotion;
                const smileEmotions = ['happy', 'excited', 'content', 'good', 'positive', 'calm'];
                const frownEmotions = ['sad', 'bitter', 'tired', 'negative', 'annoyed', 'angry', 'frustrated', 'stress', 'confused'];
                
                let mouthForm = 0.0;
                if (smileEmotions.includes(label)) mouthForm = 1.0;
                else if (frownEmotions.includes(label)) mouthForm = -1.0;

                // Ambient mood: a soft, fleeting smile that fades in/out
                if (this._ambientMood.type === 'smile') {
                    mouthForm = Math.max(mouthForm, this._ambientMood.value * 0.7);
                }
                
                coreModel.setParameterValueById('ParamMouthForm', mouthForm);
            }
        } else {
            // Cubism 2 fallback mouth form
            const label = this.currentEmotion;
            const smileEmotions = ['happy', 'excited', 'content', 'good', 'positive', 'calm'];
            const frownEmotions = ['sad', 'bitter', 'tired', 'negative', 'annoyed', 'angry', 'frustrated', 'stress', 'confused'];
            
            let mouthForm = 0.0;
            if (smileEmotions.includes(label)) mouthForm = 1.0;
            else if (frownEmotions.includes(label)) mouthForm = -1.0;
            
            this.setParameter('PARAM_MOUTH_FORM', 'PARAM_MOUTH_FORM', mouthForm);
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
                        b.nextBlinkTime = now + this._randomRange(b.minInterval, b.maxInterval);
                    }
                }
                break;
            }
        }

        // Apply blink openness to left/right eyes.
        // While she's asleep the eyes stay shut — the blink state machine is
        // bypassed until she wakes and the emotion returns to a wakeful one.
        const sleeping = this.currentEmotion === 'sleepy' || this.currentEmotion === 'sleeping';
        const openness = sleeping ? 0 : b.value;
        this.setParameter('PARAM_EYE_L_OPEN', 'ParamEyeLOpen', openness);
        this.setParameter('PARAM_EYE_R_OPEN', 'ParamEyeROpen', openness);
    }

    /**
     * Proximity: recompute from the last known cursor position each frame.
     * dist 0 (cursor on her face) -> proximity 1, screen edge -> ~0.
     */
    _updateProximity() {
        const dnx = (this._cursorNX - 0.5) * 2;
        const dny = (this._cursorNY - 0.5) * 2;
        const dist = Math.sqrt(dnx * dnx + dny * dny);
        this._proximity = Math.max(0, Math.min(1, 1 - dist));
        this._updateAura();
    }

    /**
     * Stage spotlight: cool cyan when alone, warming to rose as the cursor
     * approaches her face. Throttled so style writes stay sparse.
     */
    _updateAura() {
        if (!this._auraEl) {
            this._auraEl = document.getElementById('l2d-aura');
            if (!this._auraEl) return;
        }
        const p = this._proximity;
        if (Math.abs(p - this._lastAuraP) < 0.03) return;
        this._lastAuraP = p;

        const r = Math.round(126 + (255 - 126) * p);
        const g = Math.round(211 - (211 - 77) * p);
        const b = Math.round(250 - (250 - 109) * p);
        const inner = `rgba(${r}, ${g}, ${b}, ${(0.10 + 0.10 * p).toFixed(3)})`;
        const mid = `rgba(${r}, ${g}, ${b}, ${(0.05 + 0.05 * p).toFixed(3)})`;
        const color = inner;
        if (color !== this._lastAuraColor) {
            this._lastAuraColor = color;
            this._auraEl.style.background =
                `radial-gradient(ellipse 55% 42% at 50% 46%, ${inner} 0%, ${mid} 45%, transparent 75%)`;
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
        }

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

        this.setParameter('PARAM_BROW_L_Y', 'ParamBrowLY', bw.currentL + verticalOffset);
        this.setParameter('PARAM_BROW_R_Y', 'ParamBrowRY', bw.currentR + verticalOffset);

        // Apply angles (if supported by model settings)
        this.setParameter('PARAM_BROW_L_ANGLE', 'ParamBrowLAngle', browAngle);
        this.setParameter('PARAM_BROW_R_ANGLE', 'ParamBrowRAngle', browAngle);
    }

    _randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Handle hit area interactions.
     */
    _onHit(hitAreas) {
        const isC4 = this._isCubism4;
        const headName = isC4 ? 'Head' : 'head';
        const bodyName = isC4 ? 'Body' : 'body';

        if (hitAreas.includes(headName)) {
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
        } else if (hitAreas.includes('mouth')) {
            this._randomExpression();
            const tapMotion = isC4 ? 'TapBody' : 'tap_body';
            this.model.motion(tapMotion);
        }
    }

    /**
     * Ambient motion system — makes the character feel alive.
     */
    _startAmbientSystem() {
        const scheduleNext = () => {
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
        
        const isPetMode = document.body.classList.contains('pet-mode');
        const shiftX = 0;
        if (this.model.anchor) {
            this.model.anchor.set(0.5, 0.5);
            this.model.x = cw / 2 - shiftX;
            this.model.y = ch / 2;
        } else {
            this.model.x = (cw - mw * scale) / 2 - shiftX;
            this.model.y = (ch - mh * scale) / 2;
        }

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

        const syncGroundShadow = () => {
            const shadowEl = document.getElementById('l2d-shadow');
            if (!shadowEl) return;
            const pct = Math.min(95, Math.max(5, (this.model.x / view.width) * 100));
            shadowEl.style.left = pct + '%';
        };

        view.addEventListener('pointerdown', (e) => {
            const p = canvasToWorld(e.clientX, e.clientY);
            dragStart.x = p.x;
            dragStart.y = p.y;
            dragStart.modelX = this.model.x;
            dragStart.modelY = this.model.y;
            dragging = true;
            dragMode = 'tap';
            if (view.setPointerCapture) {
                try { view.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            }
        });

        view.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const p = canvasToWorld(e.clientX, e.clientY);
            const dx = p.x - dragStart.x;
            const dy = p.y - dragStart.y;
            if (dragMode === 'tap' && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                dragMode = 'drag';
                this._dragged = true;
                this.triggerSurprise(); // she notices being picked up
            }
            if (dragMode === 'drag') {
                this.model.x = Math.min(view.width * 0.88, Math.max(view.width * 0.12, dragStart.modelX + dx));
                this.model.y = Math.min(view.height * 0.98, Math.max(view.height * 0.3, dragStart.modelY + dy));
                syncGroundShadow();
                this.app.renderer.render(this.app.stage);
            }
        });

        const finishPointer = (e) => {
            if (!dragging) return;
            dragging = false;
            if (dragMode === 'tap') {
                // A real tap: let the model react to what was hit
                const p = canvasToWorld(e.clientX, e.clientY);
                this.model.tap(p.x, p.y);
            }
        };
        view.addEventListener('pointerup', finishPointer);
        view.addEventListener('pointercancel', finishPointer);

        // Double-click: put her back on center stage
        view.addEventListener('dblclick', () => {
            this._dragged = false;
            this._fitModel();
            syncGroundShadow();
            this.triggerSurprise();
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
     * Clean up timers, animation frame, and optionally PIXI application.
     */
    destroy(complete = false) {
        if (this._ambientTimer) clearTimeout(this._ambientTimer);
        if (this._idleTimer) clearTimeout(this._idleTimer);
        if (this._ambientMood && this._ambientMood.timer) clearTimeout(this._ambientMood.timer);
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
