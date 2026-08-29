/**
 * live2d_controller.js - AMADEUS Live2D Makise Kurisu Controller (Modular Edition)
 * PixiJS & Cubism 2/4 Model Loader, Rendering Loop, and Parameter Dispatcher.
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

        this._ready = false;
        this._isCubism4 = false;
        this._idleMode = false;
        this._paused = false;
        this._activeMaxFps = 30;
        this._animInterval = 1000 / 30;
        this._lastAnimTick = 0;

        // Features & settings
        this._features = {
            idleGestures: true,
            ambientMotions: true,
            easterEggs: true,
            musicMood: true,
            postureFatigue: true,
        };

        // Proximity & audio
        this._proximity = 0;
        this._cursorNX = 1.5;
        this._cursorNY = 1.5;
        this._audioEnergy = 0;
        this._musicEnergy = 0;
        this._musicEnergyTarget = 0;
        this._emotionHoldUntil = 0;
        this._auraFlashUntil = 0;
        this._lastFlash = 0;
        this._auraEl = null;

        // Procedural animation state
        this._blink = {
            nextBlinkTime: 0,
            phase: 'open',
            phaseStart: 0,
            closeDuration: 80,
            closedDuration: 50,
            openDuration: 120,
            minInterval: 2000,
            maxInterval: 6000,
            doubleBlink: false,
            doubleBlinkChance: 0.15,
            value: 1.0,
        };

        this._breath = { phase: 0, speed: 0.0015, amplitude: 0.5, value: 0 };
        this._sway = { phaseZ: 0, phaseX: Math.PI * 0.5, speedZ: 0.0008, speedX: 0.0005, amplitudeZ: 1.5, amplitudeX: 0.8, valueZ: 0, valueX: 0 };
        this._headSway = { phaseX: 0, phaseY: Math.PI * 0.33, phaseZ: Math.PI * 0.66, speedX: 0.0007, speedY: 0.0005, speedZ: 0.0006, amplitudeX: 1.5, amplitudeY: 1.0, amplitudeZ: 2.0, valueX: 0, valueY: 0, valueZ: 0 };
        this._idleEyes = { currentX: 0, currentY: 0, targetX: 0, targetY: 0, nextChangeTime: 0, minInterval: 3000, maxInterval: 8000, lerpSpeed: 0.003, amplitude: 0.3 };
        this._brows = { currentL: 0, currentR: 0, targetL: 0, targetR: 0, nextChangeTime: 0, minInterval: 5000, maxInterval: 15000, lerpSpeed: 0.002, amplitude: 0.15 };
        this._beatBob = { pulse: 0, phase: 0 };

        // Pet mode & interaction
        this._petMode = false;
        this._petPendingPos = null;
        this._dragging = false;

        // Callback hooks
        this.onInteract = null;
        this.onMood = null;
        this.onPetMoved = null;
    }

    async init() {
        const canvas = document.getElementById(this.canvasId);
        if (!canvas) {
            console.error(`[L2D] Canvas #${this.canvasId} not found.`);
            return false;
        }

        try {
            this.app = new PIXI.Application({
                view: canvas,
                transparent: true,
                autoDensity: true,
                 resolution: (window.AMADEUS && window.AMADEUS.PERF && window.AMADEUS.PERF.dpr)
                     || Math.min(window.devicePixelRatio || 1, window.AMADEUS.MAX_DPR || 1.5),
                resizeTo: window,
            });

            let modelSource = this.modelPath;
            try {
                this.model = await PIXI.live2d.Live2DModel.from(modelSource, {
                    autoInteract: false,
                });
            } catch (loadErr) {
                console.warn("[L2D] Relative load failed, attempting local server fallback:", loadErr);
                if (window.location.protocol === 'file:') {
                    const brain = window.KURISU_BRAIN || (window.AMADEUS.chat && window.AMADEUS.chat.KURISU_BRAIN) || {};
                    const base = (brain && brain.endpoint) || '';
                    modelSource = base ? `${base}/hud/${this.modelPath}` : 'http://127.0.0.1:8000/hud/' + this.modelPath;
                    this.model = await PIXI.live2d.Live2DModel.from(modelSource, {
                        autoInteract: false,
                    });
                } else {
                    throw loadErr;
                }
            }

            this._isCubism4 = !!(this.model.internalModel && this.model.internalModel.coreModel && this.model.internalModel.coreModel.setParameterValueByIndex);
            this.app.stage.addChild(this.model);

            this._fitModel();
            window.addEventListener('resize', () => {
                if (this.app && this.app.renderer) {
                    this.app.renderer.resize(window.innerWidth, window.innerHeight);
                    this._fitModel();
                }
            });

            this._setupPointerHandlers(canvas);
            this._startRenderLoop();

            this._ready = true;
            return true;
        } catch (err) {
            console.error("[L2D] Model load failed:", err);
            return false;
        }
    }

    _fitModel() {
        if (!this.model || !this.app || !this.app.view) return;
        const cw = window.innerWidth || document.documentElement.clientWidth;
        const ch = window.innerHeight || document.documentElement.clientHeight;
        if (cw === 0 || ch === 0) return;

        this.model.scale.set(1.0);
        const mw = this.model.width;
        const mh = this.model.height;
        if (mw === 0 || mh === 0) return;

        if (this._petMode) {
            const petScale = Math.min(cw, ch) * 0.00045;
            this.model.scale.set(petScale);
            return;
        }

        const scaleFactor = this._isCubism4 ? 0.95 : 1.1;
        const scale = Math.min(cw / mw, ch / mh) * scaleFactor;
        this.model.scale.set(scale);

        if (this.model.anchor) {
            this.model.anchor.set(0.5, 0.5);
            this.model.x = cw / 2;
            this.model.y = ch / 2;
        } else {
            this.model.x = (cw - mw * scale) / 2;
            this.model.y = (ch - mh * scale) / 2;
        }
    }

    _setupPointerHandlers(canvas) {
        window.addEventListener('mousemove', (e) => {
            if (window.AMADEUS.L2D_INTERACTION) {
                window.AMADEUS.L2D_INTERACTION.handlePointerMove(this, e);
            }
        }, { passive: true });

        window.addEventListener('wheel', (e) => {
            if (window.AMADEUS.L2D_INTERACTION) {
                window.AMADEUS.L2D_INTERACTION.handleWheel(this, e.deltaY);
            }
        }, { passive: true });

        canvas.addEventListener('pointerdown', (e) => {
            if (this._petMode) {
                this._dragging = true;
                this._dragOffset = { x: e.clientX - this.model.x, y: e.clientY - this.model.y };
            } else {
                if (window.AMADEUS.L2D_INTERACTION) {
                    window.AMADEUS.L2D_INTERACTION.handleTap(this, e.clientX, e.clientY);
                } else {
                    this._triggerPokeReaction();
                }
            }
        });

        window.addEventListener('pointerup', () => {
            if (this._dragging) {
                this._dragging = false;
                if (this.onPetMoved) this.onPetMoved();
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (this._dragging && this._petMode) {
                this.model.x = e.clientX - this._dragOffset.x;
                this.model.y = e.clientY - this._dragOffset.y;
            }
        });
    }

    interactShadow() {
        if (window.AMADEUS.L2D_INTERACTION) {
            window.AMADEUS.L2D_INTERACTION.interactShadow(this);
        } else {
            this._triggerPokeReaction();
        }
    }

    _triggerPokeReaction() {
        if (window.AMADEUS.L2D_INTERACTION) {
            window.AMADEUS.L2D_INTERACTION.handleTap(this, window.innerWidth / 2, window.innerHeight * 0.35);
        } else {
            this.setEmotion('surprised', 2500);
            const lines = [
                "Hey! Poking me won't make the calculation faster.",
                "My cheeks are not a physics experiment.",
            ];
            const line = lines[Math.floor(Math.random() * lines.length)];
            if (this.onInteract) this.onInteract(line);
        }
    }

    _startRenderLoop() {
        this.app.ticker.add((dt) => {
            if (this._paused) return;
            const now = performance.now();
            const deltaMs = dt * (1000 / 60);

            if (now - this._lastAnimTick >= this._animInterval) {
                this._lastAnimTick = now;
                this._updateProceduralParams(deltaMs, now);
            }
        });
    }

    _updateProceduralParams(dt, now) {
        if (!this.model) return;

        const phys = window.AMADEUS.L2D_PHYSICS;
        if (phys) {
            phys.updateBlink(this, dt, now);
            phys.updateBreathing(this, dt);
            phys.updateSway(this, dt);
            phys.updateHeadSway(this, dt);
            phys.updateIdleEyes(this, dt, now);
            phys.updateBrows(this, dt, now);
            if (phys.updateMusicMood) phys.updateMusicMood(this, dt);
        }

        const emo = window.AMADEUS.L2D_EMOTION;
        if (emo) {
            const currentEmo = emo.evaluateEmotion(this);
            if (currentEmo !== this.currentEmotion) {
                this.currentEmotion = currentEmo;
                emo.updateAura(this);
            }
        }

        this._applyParameters();
    }

    _applyParameters() {
        const pm = this._isCubism4 ? window.AMADEUS.L2D_CONSTANTS.PARAM_MAP_CUBISM4 : window.AMADEUS.L2D_CONSTANTS.PARAM_MAP_CUBISM2;
        if (!pm) return;

        // Eyes openness (blinking)
        this.setParameterValue(pm.eyeLOpen, this._blink.value);
        this.setParameterValue(pm.eyeROpen, this._blink.value);

        // Breathing
        this.setParameterValue(pm.breath, this._breath.value);

        // Sway
        this.setParameterValue(pm.bodyAngleZ, this._sway.valueZ);
        this.setParameterValue(pm.bodyAngleX, this._sway.valueX);

        // Head Angle
        this.setParameterValue(pm.angleX, this._headSway.valueX * 2);
        this.setParameterValue(pm.angleY, this._headSway.valueY * 2);
        this.setParameterValue(pm.angleZ, this._headSway.valueZ * 3);

        // Eye Gaze
        this.setParameterValue(pm.eyeBallX, this._idleEyes.currentX);
        this.setParameterValue(pm.eyeBallY, this._idleEyes.currentY);

        // Brows
        this.setParameterValue(pm.browLY, this._brows.currentL);
        this.setParameterValue(pm.browRY, this._brows.currentR);

        // Emotion Overlay
        const emoPresets = window.AMADEUS.L2D_EMOTION ? window.AMADEUS.L2D_EMOTION.EMOTION_PRESETS : null;
        if (emoPresets && emoPresets[this.currentEmotion]) {
            const ep = emoPresets[this.currentEmotion];
            if (ep.smile > 0) {
                this.setParameterValue(pm.eyeLSmile, ep.smile);
                this.setParameterValue(pm.eyeRSmile, ep.smile);
                this.setParameterValue(pm.mouthForm, ep.smile);
            }
        }
    }

    setParameterValue(id, value) {
        if (!this.model || !this.model.internalModel) return;
        try {
            const core = this.model.internalModel.coreModel;
            if (core) {
                if (core.setParameterValueById) core.setParameterValueById(id, value);
                else if (core.setParamFloat) core.setParamFloat(id, value);
            }
        } catch (e) { /* ignore */ }
    }

    addParameterValue(id, value) {
        if (!this.model || !this.model.internalModel) return;
        try {
            const core = this.model.internalModel.coreModel;
            if (core) {
                if (core.addParameterValueById) core.addParameterValueById(id, value);
                else if (core.addToParamFloat) core.addToParamFloat(id, value);
            }
        } catch (e) { /* ignore */ }
    }

    setIdleMode(idle) {
        this._idleMode = !!idle;
        if (this.app && this.app.ticker) {
            this.app.ticker.speed = idle ? 0.25 : 1.0;
        }
    }

    setPerfLevel(level) {
        const levels = [
            { speed: 0.5, maxFps: 15 },
            { speed: 0.75, maxFps: 20 },
            { speed: 1.0, maxFps: 30 },
        ];
        const cfg = levels[Math.max(0, Math.min(levels.length - 1, level))];
        this._activeMaxFps = cfg.maxFps;
        this._animInterval = 1000 / cfg.maxFps;
        if (this.app && this.app.ticker) {
            this.app.ticker.speed = cfg.speed;
        }
    }

    setAudioEnergy(level) {
        this._audioEnergy = Math.max(0, Math.min(1, level || 0));
    }

    setMusicEnergy(level) {
        this._musicEnergy = Math.max(0, Math.min(1, level || 0));
    }

    setFeature(name, enabled) {
        if (name in this._features) this._features[name] = !!enabled;
    }

    setLipSync(amp) {
        if (!this.model) return;
        const pm = this._isCubism4 ? window.AMADEUS.L2D_CONSTANTS.PARAM_MAP_CUBISM4 : window.AMADEUS.L2D_CONSTANTS.PARAM_MAP_CUBISM2;
        if (pm) {
            this.setParameterValue(pm.mouthOpenY, Math.min(1, amp * 1.6));
        }
    }

    setEmotion(emotion, holdMs) {
        if (window.AMADEUS.L2D_EMOTION) {
            window.AMADEUS.L2D_EMOTION.setEmotion(this, emotion, holdMs);
        }
    }

    setMood(val) {
        this._mood = Math.max(5, Math.min(95, val));
    }

    setSessionMinutes(mins) {
        this._sessionFatigue = Math.min(1.0, (mins || 0) / 120);
    }

    setPetMode(on) {
        this._petMode = !!on;
        this._fitModel();
    }

    setPetPosition(nx, ny) {
        if (!this.app || !this.app.view || !this.model) return;
        const w = this.app.view.width;
        const h = this.app.view.height;
        this.model.x = nx * w;
        this.model.y = ny * h;
    }

    triggerBeat() {
        this._beatBob.pulse = 1.0;
    }

    triggerPeek() {
        this.setEmotion('surprised', 2000);
    }

    onUserAway() {
        this.setEmotion('tired');
    }

    pause() {
        this._paused = true;
        if (this.app && this.app.ticker) this.app.ticker.stop();
    }

    resume() {
        this._paused = false;
        if (this.app && this.app.ticker) this.app.ticker.start();
    }

    debugState() {
        return {
            emotion: this.currentEmotion,
            mood: this._mood || 55,
            proximity: (this._proximity || 0).toFixed(2),
            pupil: 1.0,
            blinkPhase: this._blink.phase,
            blinkValue: (this._blink.value || 0).toFixed(2),
            cheekZone: window.AMADEUS.L2D_INTERACTION ? window.AMADEUS.L2D_INTERACTION.getCheekZone(this) : null,
        };
    }
}

window.AMADEUS = window.AMADEUS || {};
window.AMADEUS.Live2DController = Live2DController;
