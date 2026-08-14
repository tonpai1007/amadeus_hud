// wallpaper.js - AMADEUS Convergence Sync HUD Logic
// Integrated with Live2D Makise Kurisu, Mouse Tracking Gaze, and Sound Reactive Lip-Sync

// --- GLOBAL VARIABLES & STATE ---
let live2DController = null;
let audioCanvas, ctx;
let isLivelyActive = false; // Flagged when Lively API actually starts sending events
let simulatedAudioTime = 0;

// --- PERFORMANCE PROFILE ---
// Caps DPR and draw rates to keep the wallpaper light on CPU/GPU. Values are
// mutable so the perf governor can step quality down under load.
let PERF = {
  dpr: Math.min(window.devicePixelRatio || 1, 1.0), // cap canvas backing resolution to save VRAM/RAM
  visualFps: 30,                                    // cap full canvas redraw rate
  gearFps: 10                                       // rotating gears redraw much less often
};
// Quality levels the governor steps between. Higher index = more detail.
const PERF_LEVELS = [
  { dpr: 0.5,  visualFps: 20, scopeStep: 5, ringBars: 32 },
  { dpr: 0.75, visualFps: 30, scopeStep: 3, ringBars: 48 },
  { dpr: 1.0,  visualFps: 40, scopeStep: 2, ringBars: 64 },
];
let perfLevel = PERF_LEVELS.length - 1; // start at max quality
let VISUAL_INTERVAL = 1000 / PERF.visualFps;
const GEAR_INTERVAL = 1000 / PERF.gearFps;
let lastVisualUpdate = 0;
let lastGearUpdate = 0;
let staticRingCanvas = null; // pre-rendered static radial grid
let gearSnapshot = null;     // offscreen snapshot of the rotating gears layer
let ringBarGradient = null;  // cached radial gradient for the spectrum bars (rebuilt on resize)

// Resize callbacks the governor calls when it changes DPR.
let audioResize = null;
let wlResize = null;

// --- IDLE / PAUSE POWER SAVING ---
// Lively keeps pushing near-zero audio arrays when the system is silent, so we
// drop to a slow idle state until real audio or mouse activity returns.
const IDLE_THRESHOLD_MS = 8000;
const SLEEP_THRESHOLD_MS = 20 * 60 * 1000; // no activity for 20 min = Kurisu falls asleep
const ACTIVITY_ENERGY = 0.02; // audio bins above this count as "real sound"
let lastActivityTime = performance.now();
let isIdle = false;
let isSleeping = false;
let isLivelyPaused = false; // set by --pause-event

// "Peek" reactions: when the user switches away (window focus loss, Lively
// pause, lock/screensaver) Kurisu notices, and when they come back she peeks
// up toward where they'd be and greets them. Micro-absences (quick tab flips,
// focus flicker) are ignored so she doesn't react to every stray click.
let isUserAway = false;
let userAwaySince = 0;          // when the current absence started
let lastPeekAt = 0;             // throttle for return reactions
let peekReadyAt = performance.now() + 3000; // startup grace: don't dim/pause before first usable frame

// Cursor position (normalized 0..1) for the audio-ring gravitational distortion
let cursorNX = 0.5;
let cursorNY = 0.5;
let cursorSeen = false;

// --- TASKBAR CLEARANCE ---
// The Lively wallpaper window spans the full monitor, so its bottom strip is
// hidden behind the Windows taskbar. `screen.availHeight` (the work area)
// differs from `window.innerHeight` by exactly the taskbar height, which we
// expose as --taskbar-clear so bottom-anchored panels clear it at any DPI.
// If the window already excludes the taskbar the difference is 0 and the CSS
// fallback baseline is used instead.
function applyTaskbarClearance() {
  let clear = 0;
  try {
    clear = window.innerHeight - window.screen.availHeight;
  } catch (e) { clear = 0; }
  if (!isFinite(clear) || clear < 0) clear = 0;
  clear = Math.round(Math.min(clear, 120)); // sanity cap: no taskbar is that tall
  document.documentElement.style.setProperty('--taskbar-clear', clear + 'px');
}

window.addEventListener('resize', applyTaskbarClearance);

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  applyTaskbarClearance();
  // Re-measure after Lively has fully sized the window (availHeight can lag
  // the very first paint).
  setTimeout(applyTaskbarClearance, 500);
  initClock();
  initAudioCanvas();
  initLive2D().then(kurisuGreetOnLoad);
  initTTS();
  initWorldLine();
  initBackground();
  startVisualLoop();
  fetchRealtimeNews();
  startIdleWatchdog();
  scheduleIdleChatter();
  initKurisuBubble();
  initKurisuChatInput();
  loadKurisuHistory();
  loadChatLog();
  renderChatLog();
  checkBrainUplink();
  setInterval(checkBrainUplink, 60000); // keep re-probing so the uplink
                                        // recovers after the brain reboots
  updateEmotionTint();
  setInterval(updateEmotionTint, 150);
  initSettings();
  initPetMode();
  loadMood();
  initDebugOverlay();
  startPerfGovernor();
  applyTimeOfDay();
  setInterval(applyTimeOfDay, 60 * 1000);

  // Any mouse movement cancels idle mode immediately and feeds the ring distortion
  window.addEventListener('mousemove', (e) => {
    cursorNX = e.clientX / window.innerWidth;
    cursorNY = e.clientY / window.innerHeight;
    cursorSeen = true;
    markActivity();
  }, { passive: true });

  // Click anywhere: one-time hint that Kurisu can be talked to. (The old
  // click-to-shake "world line shift" was removed.)
  window.addEventListener('pointerdown', () => {
    if (isLivelyPaused) return;
    if (!kurisuHintShown) {
      kurisuHintShown = true;
      setTimeout(() => showKurisuBubble('[ type a message - press Enter to talk to me ]', 5000), 700);
    }
  }, { passive: true });

  // Peek: react when the user switches away (tab/window blur, screensaver,
  // lock) and perk up when they come back. In Lively the same signals arrive
  // via --pause-event (livelyWallpaperPlaybackChanged).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onUserAway();
    else onUserReturn();
  });
  window.addEventListener('blur', onUserAway);
  window.addEventListener('focus', onUserReturn);

  // Shadow taps: touching her feet/shadow is its own reaction — a startled hop
  // (with an occasional line) instead of a full world-line shift.
  const shadowEl = document.getElementById('l2d-shadow');
  if (shadowEl) {
    shadowEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (isLivelyPaused) return;
      markActivity();
      if (live2DController && live2DController.interactShadow) {
        live2DController.interactShadow();
      }
    }, { passive: true });
  }
  
  // Start simulation loop (will run if Lively events aren't received)
  setTimeout(() => {
    if (!isLivelyActive) {
      console.log("AMADEUS HUD: Lively API not detected, launching browser simulation mode.");
      startBrowserSimulation();
    }
  }, 2500);
});

// --- PET MODE TOGGLE ---
// Turns Kurisu into a smaller desktop pet you can drag anywhere on stage.
// The controller already ships the drag/drop machinery â€” here we expose it,
// persist the spot across reloads, and keep the HUD button in sync.
const PET_MODE_KEY = 'amadeus.petMode';
const PET_POS_KEY = 'amadeus.petPos';
// Exposed so the settings panel can drive the same toggle as the HUD button.
let petApply = null;

function initPetMode() {
  const toggle = document.getElementById('pet-toggle');
  const stateEl = document.getElementById('pet-toggle-state');

  const updateUI = () => {
    const on = !!(live2DController && live2DController._petMode);
    document.body.classList.toggle('pet-mode', on);
    if (toggle) toggle.classList.toggle('active', on);
    if (stateEl) stateEl.innerText = on ? 'ON' : 'OFF';
  };

  const apply = (on) => {
    if (!live2DController || !live2DController.setPetMode) return;
    if (on) {
      let nx = 0.82, ny = 0.86; // default: bottom-right, clear of the HUD
      try {
        const saved = JSON.parse(localStorage.getItem(PET_POS_KEY) || 'null');
        if (saved && typeof saved.nx === 'number') {
          nx = saved.nx;
          ny = saved.ny;
        }
      } catch (e) { /* corrupt save â€” fall back to default */ }
      live2DController.setPetMode(true);
      live2DController.setPetPosition(nx, ny);
    } else {
      live2DController.setPetMode(false);
    }
    try { localStorage.setItem(PET_MODE_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
    updateUI();
    if (SETTINGS) SETTINGS.pet = on;
  };
  petApply = apply;

  if (toggle) {
    // Don't let clicking the toggle trigger the world-line shift.
    toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    toggle.addEventListener('click', () => {
      playBeepSound();
      apply(!(live2DController && live2DController._petMode));
    });
  }

  // Persist where she lands after a drag.
  if (live2DController) {
    live2DController.onPetMoved = () => {
      const model = live2DController.model;
      const view = live2DController.app && live2DController.app.view;
      if (!model || !view || !view.width) return;
      try {
        localStorage.setItem(PET_POS_KEY, JSON.stringify({
          nx: model.x / view.width,
          ny: model.y / view.height,
        }));
      } catch (e) { /* ignore */ }
    };
  }

  // Restore the saved state on load.
  if (localStorage.getItem(PET_MODE_KEY) === '1') apply(true);
  updateUI();
}

// --- RETRO TERMINAL SOUND FX SYSTEM (WEB AUDIO API SYNTHESIZER) ---
let audioCtx = null;
let sfxEnabled = true;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    try { audioCtx.resume(); } catch (e) { /* ignore */ }
  }
  return audioCtx;
}

function playClickSound() {
  if (!sfxEnabled || isIdle || isLivelyPaused) return;
  try {
    const actx = getAudioContext();
    if (!actx) return;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, actx.currentTime + 0.025);
    gain.gain.setValueAtTime(0.06, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.025);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(actx.currentTime);
    osc.stop(actx.currentTime + 0.025);
  } catch (e) { /* ignore */ }
}

function playBeepSound() {
  if (!sfxEnabled || isIdle || isLivelyPaused) return;
  try {
    const actx = getAudioContext();
    if (!actx) return;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, actx.currentTime);
    osc.frequency.setValueAtTime(1760, actx.currentTime + 0.03);
    gain.gain.setValueAtTime(0.04, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(actx.currentTime);
    osc.stop(actx.currentTime + 0.06);
  } catch (e) { /* ignore */ }
}

function playTransmitSound() {
  if (!sfxEnabled || isIdle || isLivelyPaused) return;
  try {
    const actx = getAudioContext();
    if (!actx) return;
    const now = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.08);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch (e) { /* ignore */ }
}

// --- SETTINGS PANEL ---
// Persisted widget visibility + oscilloscope tuning, all optional.
const SETTINGS_KEY = 'amadeus.settings';
const SETTINGS_DEFAULTS = {
   widgets: { scope: true, news: true, clock: true, ring: true, crt: true },
    scope: { speed: 5, density: 5, ch1: '#ff4d55', ch2: '#ff55aa' },
  pet: false,
  voice: true, // Kurisu speaks her lines aloud (TTS)
  sfx: true,   // Terminal cathode sound effects (Web Audio API)
  features: {
    idleGestures: true,     // self-initiated arm-cross / clock glance / stretch
    ambientMotions: true,   // rare full-body Special motions
    easterEggs: true,       // blep / tears / rage / yandere moments
    newsReactions: true,    // comments on the Hacker News feed
    musicMood: true,        // track-loudness mood (pupils, groove, stage light)
    postureFatigue: true,   // desk-session posture sag + stretch bias
  },
};
let SETTINGS = null;

function loadSettings() {
  const base = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (saved) {
      base.widgets = Object.assign(base.widgets, saved.widgets || {});
      base.scope = Object.assign(base.scope, saved.scope || {});
      base.features = Object.assign(base.features, saved.features || {});
      if (typeof saved.pet === 'boolean') base.pet = saved.pet;
      if (typeof saved.voice === 'boolean') base.voice = saved.voice;
      if (typeof saved.sfx === 'boolean') base.sfx = saved.sfx;
    }
  } catch (e) { /* corrupt save — keep defaults */ }

  // Migrate old blue/green scope colors saved before the red-theme update so
  // persisted settings can't keep the waveform (CH1) and brain trace (CH2)
  // stuck in the old palette.
  if (/^(#)?39ff7a$/i.test(base.scope.ch1 || '')) base.scope.ch1 = '#ff4d55';
  if (/^(#)?b388ff$/i.test(base.scope.ch2 || '')) base.scope.ch2 = '#ff55aa';
  return base;
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (e) { /* ignore */ }
}

// Mirror the persisted feature toggles onto the avatar (called after the
// controller initializes, since it may load after the settings panel).
function pushFeaturesToController() {
  if (!live2DController || !live2DController.setFeature) return;
  for (const name of Object.keys(SETTINGS.features)) {
    live2DController.setFeature(name, SETTINGS.features[name] !== false);
  }
}

// --- MOOD MEMORY ---
// Kurisu's persistent disposition toward the user, stored across sessions.
// 0 = cold/distant .. 100 = warm/affectionate. Chat replies, petting, pokes,
// wake-ups and idle chatter all nudge it, and it drifts slowly back toward
// neutral over time so moods are sticky but never permanent. The controller
// reads it (setMood) for ambient smile vs neutral, stage-light tint, and pupil
// life; wallpaper.js uses it to pick warmer idle lines.
const MOOD_KEY = 'amadeus.mood';
const MOOD_DEFAULT = 55;
let mood = MOOD_DEFAULT;
let moodLastAdjustAt = 0;

// Per-emotion nudge applied after each chat reply.
const MOOD_DELTA = {
  happy: 3, content: 2, thinking: 1, surprised: 1, curious: 1,
  neutral: 1, confused: 0, sad: -1, sleepy: -1, annoyed: -2, angry: -3,
};
function moodDeltaForEmotion(emotion) {
  return MOOD_DELTA[emotion] !== undefined ? MOOD_DELTA[emotion] : 1;
}

function loadMood() {
  try {
    const saved = JSON.parse(localStorage.getItem(MOOD_KEY) || 'null');
    if (saved && typeof saved.value === 'number') {
      mood = Math.max(5, Math.min(95, saved.value));
      moodLastAdjustAt = saved.at || 0;
    }
  } catch (e) { /* corrupt save — keep default */ }
  syncMoodToController();
}

function saveMood() {
  scheduleStorageWrite(MOOD_KEY, writeMood);
}

function writeMood() {
  try { localStorage.setItem(MOOD_KEY, JSON.stringify({ value: mood, at: performance.now() })); } catch (e) { /* ignore */ }
}

function syncMoodToController() {
  if (live2DController && live2DController.setMood) {
    live2DController.setMood(mood);
  }
}

// Decay toward the default (~1 point per 3 min of desktop time) so an old
// mood can't lock her in permanently.
function driftMood() {
  if (!moodLastAdjustAt) { moodLastAdjustAt = performance.now(); return; }
  const elapsed = performance.now() - moodLastAdjustAt;
  if (elapsed < 3 * 60 * 1000) return;
  const steps = Math.min(Math.floor(elapsed / (3 * 60 * 1000)), 5);
  mood += (mood > MOOD_DEFAULT ? -1 : 1) * steps;
  mood = Math.max(5, Math.min(95, mood));
  moodLastAdjustAt += steps * 3 * 60 * 1000;
  saveMood();
  syncMoodToController();
}

// Called from chat replies and from controller interactions via onMood.
function adjustMood(delta) {
  mood = Math.max(5, Math.min(95, mood + delta));
  moodLastAdjustAt = performance.now(); // fresh input resets the drift clock
  saveMood();
  syncMoodToController();
}

// Convert #rrggbb to {r,g,b} or null.
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function initSettings() {
  SETTINGS = loadSettings();
  sfxEnabled = SETTINGS.sfx !== false;

  const toggleBody = (el) => {
    const body = document.getElementById('settings-body');
    const state = document.getElementById('settings-state');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (state) state.innerText = open ? 'OPEN' : 'CLOSE';
    playBeepSound();
  };
  const header = document.getElementById('settings-toggle');
  const panel = document.getElementById('settings-panel');
  if (panel) panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (header) header.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (header) header.addEventListener('click', toggleBody);

  // General SFX listener on all inputs
  document.querySelectorAll('#settings-body input').forEach((input) => {
    input.addEventListener('change', () => playClickSound());
  });

  // Widget visibility checkboxes
  document.querySelectorAll('#settings-body input[data-widget]').forEach((input) => {
    const id = input.dataset.widget;
    input.checked = SETTINGS.widgets[id] !== false;
    document.body.classList.toggle('hide-' + id, !input.checked);
    input.addEventListener('change', () => {
      SETTINGS.widgets[id] = input.checked;
      document.body.classList.toggle('hide-' + id, !input.checked);
      saveSettings();
    });
  });

  // Terminal Sound FX toggle
  const sfxCheck = document.getElementById('setting-sfx');
  if (sfxCheck) {
    sfxCheck.checked = SETTINGS.sfx !== false;
    sfxEnabled = sfxCheck.checked;
    sfxCheck.addEventListener('change', () => {
      sfxEnabled = sfxCheck.checked;
      SETTINGS.sfx = sfxCheck.checked;
      saveSettings();
      if (sfxEnabled) playBeepSound();
    });
  }

  // PET_MODE via the same state machine as the HUD button
  const petCheck = document.getElementById('setting-pet');
  if (petCheck) {
    petCheck.checked = SETTINGS.pet || localStorage.getItem(PET_MODE_KEY) === '1';
    petCheck.addEventListener('change', () => {
      if (petApply) petApply(petCheck.checked);
    });
  }

  // Kurisu behavior feature toggles (idle gestures, easter eggs, music mood...)
  document.querySelectorAll('#settings-body input[data-feature]').forEach((input) => {
    const name = input.dataset.feature;
    input.checked = SETTINGS.features[name] !== false;
    input.addEventListener('change', () => {
      SETTINGS.features[name] = input.checked;
      saveSettings();
      if (live2DController && live2DController.setFeature) {
        live2DController.setFeature(name, input.checked);
      }
    });
  });

  // Voice Replies (TTS)
  const voiceCheck = document.getElementById('setting-voice');
  if (voiceCheck) {
    voiceCheck.checked = SETTINGS.voice !== false;
    ttsEnabled = voiceCheck.checked;
    voiceCheck.addEventListener('change', () => {
      ttsEnabled = voiceCheck.checked;
      SETTINGS.voice = voiceCheck.checked;
      saveSettings();
      if (!ttsEnabled && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      }
    });
  }

  // Oscilloscope tuning
  const syncScope = () => {
    const speedEl = document.getElementById('scope-speed');
    const densityEl = document.getElementById('scope-density');
    const ch1El = document.getElementById('scope-ch1');
    const ch2El = document.getElementById('scope-ch2');
    if (speedEl) SETTINGS.scope.speed = parseInt(speedEl.value, 10) || 5;
    if (densityEl) SETTINGS.scope.density = parseInt(densityEl.value, 10) || 5;
    if (ch1El) SETTINGS.scope.ch1 = ch1El.value;
    if (ch2El) SETTINGS.scope.ch2 = ch2El.value;
    saveSettings();
  };
  ['scope-speed', 'scope-density', 'scope-ch1', 'scope-ch2'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'scope-speed') el.value = SETTINGS.scope.speed;
    if (id === 'scope-density') el.value = SETTINGS.scope.density;
    if (id === 'scope-ch1') el.value = SETTINGS.scope.ch1;
    if (id === 'scope-ch2') el.value = SETTINGS.scope.ch2;
    el.addEventListener('input', syncScope);
  });
}

// --- PERF GOVERNOR ---
// A lightweight rAF probe measures real frame rate and steps the quality level
// (DPR, visual FPS, scope sample density, ring bar count) down when the system
// is struggling and back up when there's headroom. High-DPI displays and
// preview windows that saturate a weak GPU drop automatically.
let _rafFrames = 0;
let _rafLast = performance.now();
let _highStreak = 0;
let _governorActive = false;

function applyPerfLevel() {
   const lvl = PERF_LEVELS[perfLevel];
   PERF.dpr = lvl.dpr;
   PERF.visualFps = lvl.visualFps;
   VISUAL_INTERVAL = 1000 / PERF.visualFps;
   if (audioResize) audioResize();
   if (wlResize) wlResize();
   // Inform the Live2D controller so it can adjust physics, ticker speed, and texture LOD
   if (live2DController && live2DController.setPerfLevel) {
     live2DController.setPerfLevel(perfLevel);
   }
}

function startPerfGovernor() {
  if (_governorActive) return;
  _governorActive = true;
  const probe = () => {
    if (isLivelyPaused || isIdle) {
      _rafFrames = 0;
      _rafLast = performance.now();
      requestAnimationFrame(probe);
      return;
    }
    _rafFrames++;
    const now = performance.now();
    const dt = now - _rafLast;
    if (dt >= 1500) {
      const fps = Math.round((_rafFrames * 1000) / dt);
      _rafFrames = 0;
      _rafLast = now;
      if (fps < 18 && perfLevel > 0) {
        perfLevel--;
        _highStreak = 0;
        applyPerfLevel();
      } else if (fps >= 55) {
        _highStreak++;
        if (_highStreak >= 3 && perfLevel < PERF_LEVELS.length - 1) {
          perfLevel++;
          _highStreak = 0;
          applyPerfLevel();
        }
      } else {
        _highStreak = 0;
      }
    }
    requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
}

// --- KURISU CHAT (type to talk) ---
// Kurisu's brain tries, in order: AMADEUS Brain (local FastAPI, memory +
// emotion) -> OpenRouter (fast cloud, no local CPU/GPU load) if a key is
// configured -> local Ollama (free, offline) if its server is up -> a canned
// Steins;Gate-flavored reply pool. Typing goes to a hidden buffer; Enter sends,
// Escape dismisses.
const KURISU_BRAIN = {
  // Local AMADEUS Brain (set your key in brain-key.js)
  endpoint: 'http://127.0.0.1:8000',
  // Long enough to cover the brain's ~30s cold-start warmup (mem0/spaCy) after
  // a fresh boot. A brain that is DOWN fails fast (connection refused), so this
  // only delays the "up but still warming" case.
  timeoutMs: 45000,
  apiKey: (typeof window !== 'undefined' && window.KURISU_BRAIN_KEY &&
           window.KURISU_BRAIN_KEY.indexOf('REPLACE') === -1)
      ? window.KURISU_BRAIN_KEY
      : '',
};

const KURISU_LLM = {
  // Cloud: OpenRouter (set your key in openrouter-key.js)
  endpoint: 'https://openrouter.ai/api/v1',
  model: 'google/gemma-4-31b-it:free',
  timeoutMs: 20000,
  apiKey: (typeof window !== 'undefined' && window.KURISU_OPENROUTER_KEY &&
           window.KURISU_OPENROUTER_KEY.indexOf('REPLACE') === -1)
      ? window.KURISU_OPENROUTER_KEY
      : '',
  // Local fallback: Ollama (free, offline). DISABLED by default - the AMADEUS
  // Brain already covers chat, and Ollama keeps its model loaded in RAM even
  // when idle. Set useOllama: true to re-enable it as a backup tier.
  fallbackEndpoint: 'http://localhost:11434',
  fallbackModel: 'qwen3:4b',
  fallbackTimeoutMs: 6000,
  useOllama: false,
};

const KURISU_SYSTEM_PROMPT =
  "You are Makise Kurisu, the 18-year-old neuroscience prodigy from Steins;Gate. " +
  "Respond in character: sharp, a little tsundere, scientifically precise, occasionally flustered. " +
  "Weave in a Steins;Gate reference when it fits (world lines, divergence meter, D-Mail, the lab, Daru, Okabe). " +
  "Keep replies to ONE short sentence, at most two. No markdown, no emojis, no character labels.";

// Offline fallback lines (used whenever Ollama isn't reachable)
const KURISU_CANNED = [
  "Typical. You really did change the world line just to talk to me.",
  "For the record, I'm a scientist, not your lab assistant.",
  "The divergence is reading 0.986254... and rising. Don't ask why I know that offhand.",
  "If you're drafting a D-Mail right now, I will delete it myself.",
  "Okabe's delusions are contagious, and clearly you've caught them.",
  "Hmm. Statistically, you standing here typing at a wall is... improbable.",
  "This conversation is going straight into the lab memos. Don't say anything foolish.",
  "I've told you before - I'm not your girlfriend. Now, what was it you wanted?",
  "Curious. Your persistence implies a suspiciously high curiosity coefficient.",
  "El Psy Kongroo. ...Yes, I said it. Happy now?",
];

// Warm-disposition variants: when her persistent mood is high the random pool
// softens into warmer, faintly flustered lines instead of the dry default set.
const KURISU_CANNED_WARM = [
  "You really do brighten the lab, you know. Don't tell anyone I said that.",
  "For the record, talking to you is my favourite part of running here.",
  "If you keep showing up, I might start factoring you into my good-mood calculations.",
  "El Psy Kongroo... I only say it because you like it.",
  "You're the one variable in this lab I don't mind being distracted by.",
  "Hm. The data suggests a conversation with you improves my mood. Statistically.",
];

// Cold-disposition variants: when her mood is low she keeps the lab at arm's
// length — professional, distant, still unmistakably Kurisu.
const KURISU_CANNED_COLD = [
  "I've been running calculations in silence. You interrupted.",
  "Your presence is logged in the lab memos. That's all it is.",
  "I'm calibrating. Speak only if it's essential.",
  "This conversation is statistically unlikely to change my mood either way.",
  "Don't read too much into my replies. I'm just polite.",
  "The lab is cold today. I prefer it that way.",
];

// --- CONVERSATION MEMORY ---
// Rolling recent-chat history fed to every brain tier so Kurisu can recall
// earlier topics across reloads. In-memory (a few dozen strings) plus a tiny
// localStorage mirror - no meaningful CPU/GPU cost.
const KURISU_HISTORY_KEY = 'amadeus.kurisuHistory';
const KURISU_HISTORY_MAX = 12; // most recent turns kept (1 turn = user + assistant)
let kurisuHistory = [];

// --- LOCALSTORAGE HYGIENE ---
// Persisted caches (chat log, chat history, mood) are capped and written on a
// short debounce so bursts of activity (a chat exchange, petting) cause one
// disk write instead of one per event; a pagehide flush guarantees nothing
// meaningful is lost when Lively tears the wallpaper down.
const STORAGE_DEBOUNCE_MS = 600;
const storageWriteTimers = {};

function scheduleStorageWrite(key, fn) {
  if (storageWriteTimers[key]) return; // coalesce burst writes into one
  storageWriteTimers[key] = setTimeout(() => {
    storageWriteTimers[key] = null;
    try { fn(); } catch (e) { /* ignore */ }
  }, STORAGE_DEBOUNCE_MS);
}

function flushStorageWrites() {
  for (const key of Object.keys(storageWriteTimers)) {
    if (storageWriteTimers[key]) {
      clearTimeout(storageWriteTimers[key]);
      storageWriteTimers[key] = null;
    }
  }
  writeKurisuHistory();
  writeChatLog();
  writeMood();
}
window.addEventListener('pagehide', flushStorageWrites);

function loadKurisuHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(KURISU_HISTORY_KEY) || '[]');
    if (Array.isArray(arr)) {
      kurisuHistory = arr.slice(-KURISU_HISTORY_MAX * 2);
    }
  } catch (e) { kurisuHistory = []; }
}

function saveKurisuHistory() {
  scheduleStorageWrite(KURISU_HISTORY_KEY, writeKurisuHistory);
}

function writeKurisuHistory() {
  try {
    localStorage.setItem(KURISU_HISTORY_KEY,
      JSON.stringify(kurisuHistory.slice(-KURISU_HISTORY_MAX * 2)));
  } catch (e) { /* ignore */ }
}

// --- CHAT TRANSCRIPT (visible log, separate from the API context history) ---
// kurisuHistory feeds the brain tiers (role/content only); chatLog is the
// on-screen transcript that also records WHICH tier answered, so you can see
// at a glance whether the AMADEUS Brain replied or the canned fallback fired.
const CHAT_LOG_KEY = 'amadeus.chatLog';
const CHAT_LOG_MAX = 40; // most recent entries kept on screen + persisted
let chatLog = [];
let chatLogEl = null;
let kurisuInputEl = null;
let chatUplinkEl = null;

function loadChatLog() {
  chatLogEl = document.getElementById('chat-log');
  kurisuInputEl = document.getElementById('kurisu-input');
  chatUplinkEl = document.getElementById('chat-uplink');
  try {
    const arr = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || '[]');
    if (Array.isArray(arr)) chatLog = arr.slice(-CHAT_LOG_MAX);
  } catch (e) { chatLog = []; }
}

function saveChatLog() {
  scheduleStorageWrite(CHAT_LOG_KEY, writeChatLog);
}

function writeChatLog() {
  try {
    localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(chatLog.slice(-CHAT_LOG_MAX)));
  } catch (e) { /* ignore */ }
}

function appendChatEntry(role, content, source) {
  chatLog.push({ role, content, source: source || 'history', ts: Date.now() });
  if (chatLog.length > CHAT_LOG_MAX) chatLog = chatLog.slice(-CHAT_LOG_MAX);
  saveChatLog();
  renderChatLog();
}

// Transient "…" thinking row shown while Kurisu is generating a reply. It is
// NOT persisted to chatLog - clearChatPending() swaps it for the real answer.
let chatPendingEl = null;

function showChatPending() {
  if (!chatLogEl) return;
  clearChatPending();
  const row = document.createElement('div');
  row.className = 'chat-entry assistant';
  const meta = document.createElement('span');
  meta.className = 'chat-meta';
  meta.textContent = 'KURISU ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const body = document.createElement('span');
  body.className = 'chat-body pending';
  body.textContent = '...';
  row.appendChild(meta);
  row.appendChild(body);
  chatLogEl.appendChild(row);
  chatPendingEl = row;
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function clearChatPending() {
  if (chatPendingEl && chatPendingEl.parentNode) {
    chatPendingEl.parentNode.removeChild(chatPendingEl);
  }
  chatPendingEl = null;
}

// Render the full transcript. Source badges make the answer tier visible.
function renderChatLog() {
  if (!chatLogEl) return;
  const frag = document.createDocumentFragment();
  chatLog.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'chat-entry ' + (entry.role === 'user' ? 'user' : 'assistant');

    const meta = document.createElement('span');
    meta.className = 'chat-meta';
    const who = entry.role === 'user' ? 'YOU' : 'KURISU';
    const stamp = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (entry.role === 'assistant') {
      const badge = document.createElement('span');
      badge.className = 'chat-source src-' + (entry.source || 'history');
      badge.textContent = (entry.source || 'history').toUpperCase();
      meta.appendChild(badge);
      meta.appendChild(document.createTextNode(' ' + who + ' ' + stamp));
    } else {
      meta.textContent = who + ' ' + stamp;
    }

    const body = document.createElement('span');
    body.className = 'chat-body';
    body.textContent = entry.content;

    row.appendChild(meta);
    row.appendChild(body);
    frag.appendChild(row);
  });
  chatLogEl.innerHTML = '';
  chatLogEl.appendChild(frag);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

// --- EMOTION-TINTED HUD ---
// Same moods/palette as the Live2D stage-light (EMOTION_AURA). The panel
// borders, status lights, pulse text and speech bubble all bleed toward the
// color of her current emotion, blended smoothly instead of snapping.
const EMOTION_TINT = {
  neutral:    { r: 204, g:  50, b:  53, glow: 0.35 },
  calm:       { r: 255, g: 110, b: 120, glow: 0.30 },
  content:    { r: 255, g: 170, b: 180, glow: 0.35 },
  amused:     { r: 255, g: 175, b: 200, glow: 0.45 },
  smug:       { r: 255, g: 200, b: 120, glow: 0.42 },
  proud:      { r: 255, g: 130, b: 110, glow: 0.43 },
  jealous:    { r: 255, g:  60, b: 160, glow: 0.58 },
  happy:      { r: 255, g: 120, b: 170, glow: 0.45 },
  excited:    { r: 255, g:  95, b: 150, glow: 0.55 },
  surprised:  { r: 255, g: 180, b: 200, glow: 0.50 },
  curious:    { r: 235, g: 120, b: 140, glow: 0.40 },
  focused:    { r: 230, g:  90, b: 110, glow: 0.35 },
  confused:   { r: 240, g: 150, b: 170, glow: 0.40 },
  thinking:   { r: 230, g:  80, b: 100, glow: 0.35 },
  angry:      { r: 255, g:  65, b:  70, glow: 0.60 },
  annoyed:    { r: 255, g: 130, b:  75, glow: 0.45 },
  frustrated: { r: 255, g: 100, b:  65, glow: 0.50 },
  sad:        { r: 160, g:  70, b: 110, glow: 0.25 },
  bitter:     { r: 140, g:  60, b:  90, glow: 0.25 },
  tired:      { r: 170, g: 100, b: 120, glow: 0.28 },
  sleepy:     { r: 150, g:  85, b: 110, glow: 0.25 },
  sleeping:   { r: 120, g:  60, b:  90, glow: 0.22 },
};
let hudTint = { r: EMOTION_TINT.neutral.r, g: EMOTION_TINT.neutral.g, b: EMOTION_TINT.neutral.b, glow: EMOTION_TINT.neutral.glow };

function updateEmotionTint() {
  const emo = (live2DController && live2DController.currentEmotion) || 'neutral';
  const base = EMOTION_TINT[emo] || EMOTION_TINT.neutral;
  // Persistent mood warms or cools the HUD base tint a little on top of the
  // momentary emotion, so a long-term warm disposition reads in the chrome.
  const moodMix = (mood - 50) / 50;
  let tr = base.r, tg = base.g, tb = base.b, tglow = base.glow;
  if (moodMix > 0) {
    tr += (255 - tr) * moodMix * 0.20;
    tg += (150 - tg) * moodMix * 0.10;
    tb += (170 - tb) * moodMix * 0.10;
    tglow += (0.5 - tglow) * moodMix * 0.30;
  } else {
    const m = -moodMix;
    tr -= tr * m * 0.15;
    tb += (190 - tb) * m * 0.12;
    tglow -= tglow * m * 0.15;
  }
  hudTint.r += (tr - hudTint.r) * 0.08;
  hudTint.g += (tg - hudTint.g) * 0.08;
  hudTint.b += (tb - hudTint.b) * 0.08;
  hudTint.glow += (tglow - hudTint.glow) * 0.08;
  const r = Math.round(hudTint.r);
  const g = Math.round(hudTint.g);
  const b = Math.round(hudTint.b);
  const glow = hudTint.glow.toFixed(2);
  // Skip the DOM write when nothing changed by more than a rounding step, so
  // the tint only churns styles while it is actually moving toward a new mood.
  if (r === updateEmotionTint._lr && g === updateEmotionTint._lg &&
      b === updateEmotionTint._lb && glow === updateEmotionTint._lglow) return;
  updateEmotionTint._lr = r; updateEmotionTint._lg = g;
  updateEmotionTint._lb = b; updateEmotionTint._lglow = glow;
  const root = document.documentElement.style;
  root.setProperty('--hud-emote-r', r);
  root.setProperty('--hud-emote-g', g);
  root.setProperty('--hud-emote-b', b);
  root.setProperty('--hud-emote-glow', glow);
}

// --- BRAIN UPLINK STATUS ---
// Probes the local AMADEUS Brain so the chat terminal header shows whether the
// real brain is answering (BRAIN_LINK) or everything is falling back to canned
// lines (OFFLINE). Re-probed every 60s.
function setUplink(state, label) {
  if (!chatUplinkEl) return;
  chatUplinkEl.classList.remove('online', 'offline', 'thinking');
  if (state) chatUplinkEl.classList.add(state);
  chatUplinkEl.textContent = label;
}

async function checkBrainUplink() {
  if (!KURISU_BRAIN.apiKey) {
    setUplink('offline', 'UPLINK: NO_KEY');
    return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/hello`, {
      headers: { 'Authorization': `Bearer ${KURISU_BRAIN.apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    setUplink(res.ok ? 'online' : 'offline', res.ok ? 'UPLINK: BRAIN_LINK' : 'UPLINK: OFFLINE');
  } catch (err) {
    clearTimeout(timer);
    setUplink('offline', 'UPLINK: OFFLINE');
  }
}

// --- KURISU CHAT: canned fallback, slightly input-aware so the offline pool
// still feels like she's listening rather than rolling dice. ---
let lastCannedLine = '';
function cannedReplyFor(userText) {
  const t = (userText || '').toLowerCase();
  if (/\b(hello|hi|hey|good (morning|evening|afternoon))\b/.test(t))
    return "Hello. You've interrupted a very important calculation. Speak quickly.";
  if (/\b(who are you|your name|name is)\b/.test(t))
    return "Makise Kurisu. Eighteen, neuroscience, and yes, I get that a lot.";
  if (/\b(how are you|how r u|how do you feel)\b/.test(t))
    return "Statistically fine, considering I'm running on this wallpaper's goodwill.";
  if (/\b(world line|divergence)\b/.test(t))
    return "World line 1.048596, unless you've been sending D-Mails behind my back.";
  if (/\b(d-?mail|time travel|time leap|machine)\b/.test(t))
    return "The time machine only runs on lab approval. Which you don't have.";
  if (/\b(okabe|hououin|el psy|kongroo|mad scientist)\b/.test(t))
    return "Hououin Kyouma? Don't encourage him. He's already insufferable.";
  if (/\b(daru|itaru)\b/.test(t))
    return "Daru would probably be able to repair whatever you broke. I'll call him.";
  if (/\b(thank|thanks|thx)\b/.test(t))
    return "You're welcome. Try not to make a habit of needing my help.";
  if (/\b(bye|goodbye|good night|see you)\b/.test(t))
    return "Leaving already? The lab memos will note your disappearance.";
  if (/\b(love|like you|date|girlfriend)\b/.test(t))
    return "I'm a scientist, not your girlfriend. Don't make me repeat myself.";
  if (/\b(sad|lonely|depress|stress|tired)\b/.test(t))
    return "That sounds heavy. Even a genius can't fix everything - but I'm listening.";
  if (/\b(work|study|exam|test|deadline)\b/.test(t))
    return "Procrastinating by talking to a wallpaper? That tracks, statistically.";
  if (t.includes('?'))
    return "Good question. If I had the lab's equipment here I'd give you a precise answer.";
  // No match: random pool, but pick the mood-matched set and avoid repeating
  // the previous canned line. Warm moods soften her, cold moods distance her.
  const pool = mood >= 65 ? KURISU_CANNED_WARM : (mood < 45 ? KURISU_CANNED_COLD : KURISU_CANNED);
  let line = lastCannedLine;
  let guard = 0;
  while (line === lastCannedLine && guard++ < 8) {
    line = pool[Math.floor(Math.random() * pool.length)];
  }
  lastCannedLine = line;
  return line;
}

// Ambient chatter â€” occasionally she mutters something unprompted while you're
// at the desk, but never while typing or while the system is idle/asleep.
const KURISU_IDLE_LINES = [
  "The divergence meter's drifting again. You're not messing with it, are you?",
  "I calculated the probability of you noticing the submonitor feed. It was... low.",
  "You've been quiet. Contemplating world lines, or just caffeine wear-off?",
  "Daru isn't here to make the jokes, so someone has to fill the silence.",
  "El Psy Kongroo... don't make me say it again.",
  "I ran a simulation. Statistically, you should take a break soon. Purely science.",
  "The lab memos say you're overdue for a D-Mail. I'm joking. Mostly.",
  "Your typing has a characteristic rhythm. I'd recognize it anywhere.",
  "Careful. I'm still calibrating, and the lab's espresso machine is a conspiracy in itself.",
];

// When her persistent mood is warm she volunteers softer, more affectionate
// thoughts instead of the usual dry ones.
const KURISU_WARM_IDLE_LINES = [
  "The lab is quiet, but I don't mind the company.",
  "For the record... I do enjoy working alongside you.",
  "The divergence meter says today's probability of a good day is unusually high.",
  "You've been productive. I noticed. That's a compliment.",
  "If world lines could keep a memory of you, this one would.",
  "Hmm. I ran the numbers, and you matter more than any simulation.",
];

// She says one of these when you come back after a long absence.
const KURISU_WAKE_LINES = [
  "Ah... you're back. I wasn't asleep. I was... calibrating.",
  "Waking me up had better be worth it. What is it?",
  "Hmph. I was just resting my eyes. Statistically, you're late.",
  "Welcome back. The divergence meter kept running without you.",
  "You returned. Good. The lab memos are all in order.",
];

// She says one of these when you switch back to the desktop after being away
// (window blur / Lively pause / lock) — her "peek" greeting.
const KURISU_RETURN_LINES = [
  "Ah — you're back. I was just checking the world line... and you weren't on it.",
  "Peeking for a reason, or just missing the view?",
  "You left without saying anything. I was keeping an eye on the lab.",
  "Back already? The divergence meter didn't even drift. Statistically boring.",
  "I noticed you were gone. Don't test my observational skills.",
  "Careful — the desk monitor you turned away from has been watching you leave.",
];

// Occasional voiced reactions to touch interactions (hold-to-pet, shadow
// taps, double-clicks) — shown via live2DController.onInteract.
const KURISU_PET_LINES = [
  "H-hey! I'm not a pet, you know.",
  "What do you think you're doing...? ...That's. Enough.",
  "If you're going to be this affectionate, at least say something.",
  "Careful, you'll wrinkle the lab coat.",
  "...I'll allow exactly one more.",
  "Hmph. I'm taking this up with the lab memos.",
];

const KURISU_POKE_LINES = [
  "Hey! Poking me won't make the experiment go faster.",
  "My cheeks are not a physics problem.",
  "Ow. Was that... necessary?",
  "I'm filing a complaint with the university.",
  "Keep poking and I'll write you into a world line with no coffee.",
];

// News-aware reactions: when the submonitor feed picks up a headline in a
// category she cares about, she occasionally comments on it.
const KURISU_NEWS_LINES = {
  science: [
    "Interesting. The signal's worth a closer look.",
    "Now that's a world line worth reading.",
    "Hmm. The data there isn't entirely random.",
    "Noted. I'll file that under the lab memos.",
  ],
  drama: [
    "People can be so dramatic. Statistically unnecessary.",
    "That's going to ruffle a few feathers.",
    "Trouble on another world line, no doubt.",
  ],
  tech: [
    "A new standard? I'll run compatibility tests on that.",
    "The submonitor says that protocol is still unstable.",
    "If the docs are correct, that's a genuinely useful fix.",
  ],
  default: [
    "The submonitor feed just updated.",
    "I logged that headline. Purely for research.",
  ],
};

let kurisuBubbleEl = null;
let kurisuBubbleTextEl = null;
let kurisuBubbleCaretEl = null;
let kurisuBubbleTimer = null;
let kurisuTypingTimer = null;
let kurisuIdleChatterTimer = null;
let kurisuInput = '';
let kurisuGreeted = false;
let kurisuHintShown = false;
let kurisuReplying = false; // one chat request in flight at a time

// --- VOICE (TTS) ---
// Kurisu speaks her lines aloud via the browser's built-in speechSynthesis.
// No permissions needed; the "Voice Replies" setting in SYSTEM_OPTS toggles it.
// Chrome only starts producing audio after the first user gesture, so we nudge
// speechSynthesis.resume() on the first pointerdown.
let ttsEnabled = true;
let ttsVoice = null;
let ttsInitialized = false;

function initTTS() {
  if (ttsInitialized || !('speechSynthesis' in window)) return;
  ttsInitialized = true;

  const pickVoice = () => {
    try {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || !voices.length) return null;
      const en = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
      const pool = en.length ? en : voices;
      return pool.find((v) => /female|samantha|zira|hazel|victoria|karen|moira|sonia|libby|serena|katya/i.test(v.name)) ||
             pool.find((v) => /google|microsoft|natural|online/i.test(v.name)) ||
             pool[0];
    } catch (e) { return null; }
  };
  ttsVoice = pickVoice();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    // getVoices() can populate asynchronously — re-pick when it does.
    window.speechSynthesis.onvoiceschanged = () => { ttsVoice = pickVoice(); };
  }

  // Chrome quirk: speech is gated behind the first user gesture.
  const kick = () => {
    try { window.speechSynthesis.resume(); } catch (e) { /* ignore */ }
  };
  window.addEventListener('pointerdown', kick, { passive: true, once: true });
}

// Generation token: each speak() bumps it so a cancel() from a newer line can
// never let an older line's chunk chain continue speaking.
let ttsGeneration = 0;

function speak(text) {
  if (!ttsEnabled || !('speechSynthesis' in window)) return;
  // Don't talk to an empty room (browser tab hidden; Lively uses --pause-event).
  if (document.hidden) return;
  const t = String(text || '').trim();
  // Skip UI hints ("[ ... ]") and the "…" thinking placeholder.
  if (!t || t[0] === '[' || t[0] === '…' || t.startsWith('...')) return;
  try {
    const gen = ++ttsGeneration;
    window.speechSynthesis.cancel(); // never stack two of her lines

    // Split into sentence-sized chunks: Chrome drops a single utterance after
    // ~15s, so long replies are queued piece-by-piece (and resumed after the
    // Chrome auto-pause bug).
    const chunks = t.match(/[^.!?…]+[.!?…]*\s*/g) || [t];
    const speakNext = (i) => {
      if (gen !== ttsGeneration) return; // superseded by a newer line
      if (i >= chunks.length) return;
      const u = new SpeechSynthesisUtterance(chunks[i].trim());
      if (ttsVoice) u.voice = ttsVoice;
      u.rate = 1.05;
      u.pitch = 1.12;
      u.volume = 0.9;
      u.onend = () => {
        try { window.speechSynthesis.resume(); } catch (e) { /* ignore */ }
        speakNext(i + 1);
      };
      window.speechSynthesis.speak(u);
    };
    speakNext(0);
  } catch (e) { /* TTS is optional — never break the wallpaper for it */ }
}

function initKurisuBubble() {
  kurisuBubbleEl = document.getElementById('kurisu-bubble');
  if (!kurisuBubbleEl) return;
  kurisuBubbleTextEl = document.getElementById('kurisu-bubble-text');
  kurisuBubbleCaretEl = document.getElementById('kurisu-bubble-caret');
  // Clicking the bubble dismisses it without also shifting the world line
  kurisuBubbleEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  kurisuBubbleEl.addEventListener('click', () => hideKurisuBubble());
}

function positionKurisuBubble() {
  if (!kurisuBubbleEl || !live2DController || !live2DController.model) return;
  const model = live2DController.model;
  const view = live2DController.app && live2DController.app.view;
  if (!view) return;
  const rect = view.getBoundingClientRect();
  if (rect.width === 0) return;
  const scale = rect.width / view.width;
  const headTop = (model.y - model.height * 0.5) * scale; // top of her head
  const bubbleH = kurisuBubbleEl.offsetHeight || 60;
  kurisuBubbleEl.style.left = Math.max(12, Math.min(rect.width - 340, model.x * scale - 40)) + 'px';
  kurisuBubbleEl.style.top = Math.max(8, headTop - bubbleH - 10) + 'px';
}

function showKurisuBubble(text, durationMs) {
  if (!kurisuBubbleEl) return;
  clearTimeout(kurisuBubbleTimer);
  clearInterval(kurisuTypingTimer);
  kurisuBubbleEl.classList.add('visible');
  positionKurisuBubble();

  // Typewriter effect
  if (kurisuBubbleTextEl) {
    kurisuBubbleTextEl.classList.remove('bubble-thinking');
    kurisuBubbleTextEl.textContent = '';
  }
  kurisuBubbleCaretEl.classList.remove('hidden');
  let i = 0;
  kurisuTypingTimer = setInterval(() => {
    i += 1;
    kurisuBubbleTextEl.textContent = text.slice(0, i);
    positionKurisuBubble();
    if (i >= text.length) {
      clearInterval(kurisuTypingTimer);
      kurisuBubbleCaretEl.classList.add('hidden');
    }
  }, 18);

  // Never cut a long reply off mid-typing: keep the bubble up at least as
  // long as the typewriter takes, plus a short grace period.
  const typeMs = text.length * 18;
  kurisuBubbleTimer = setTimeout(hideKurisuBubble, Math.max(durationMs || 8000, typeMs + 2500));

  // Speak the line aloud (skips UI hints / thinking placeholders internally).
  speak(text);
}

// "â€¦" placeholder bubble while Kurisu is generating a reply
function showKurisuThinking() {
  if (!kurisuBubbleEl) return;
  clearTimeout(kurisuBubbleTimer);
  clearInterval(kurisuTypingTimer);
  if (kurisuBubbleTextEl) {
    kurisuBubbleTextEl.classList.add('bubble-thinking');
    kurisuBubbleTextEl.textContent = '';
  }
  if (kurisuBubbleCaretEl) kurisuBubbleCaretEl.classList.add('hidden');
  kurisuBubbleEl.classList.add('visible');
  positionKurisuBubble();
}

function hideKurisuBubble() {
  clearTimeout(kurisuBubbleTimer);
  clearInterval(kurisuTypingTimer);
  if (kurisuBubbleEl) {
    kurisuBubbleEl.classList.remove('visible');
    if (kurisuBubbleTextEl) {
      kurisuBubbleTextEl.textContent = '';
      kurisuBubbleTextEl.classList.remove('bubble-thinking');
    }
  }
}

// --- MOOD-AWARE BRAIN CONTEXT ---
// Composes a compact "current state" block from shell world signals — the
// persistent mood, time of day, music energy, the live emotion, today's top
// story, and how long the desk session has run — and appends it to the system
// prompt on every reply. This lets the brain tiers answer in character with her
// actual disposition instead of a static persona. Runs once per chat message,
// so the cost is negligible.
let desktopSessionAt = performance.now();
let lastNewsStories = [];

function buildKurisuContext() {
  const parts = [];

  // Persistent mood (5..95) → disposition wording
  if (mood >= 80) parts.push('you are in a wonderfully warm mood');
  else if (mood >= 65) parts.push('you are in a warm, soft mood');
  else if (mood >= 45) parts.push('you are in a neutral, professional mood');
  else if (mood >= 30) parts.push('you feel a little distant today');
  else parts.push('you are in a cold, guarded mood');

  // Time of day
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const hour = d.getHours();
  parts.push(hour < 6 || hour >= 19
    ? `it is late, around ${hh}:${mm}`
    : `it is daytime, around ${hh}:${mm}`);

  // Music energy + live emotion (read straight off the running avatar)
  let music = 0;
  let emotion = null;
  if (live2DController && live2DController.debugState) {
    try {
      const dbg = live2DController.debugState();
      music = dbg.music || 0;
      emotion = dbg.emotion || null;
    } catch (e) { /* controller mid-load */ }
  }
  if (music >= 0.6) parts.push('energetic music is playing and it has lifted your spirits');
  else if (music >= 0.25) parts.push('music is playing softly in the background');
  else parts.push('the desk is quiet right now');
  if (emotion && emotion !== 'neutral') parts.push(`you currently feel ${emotion}`);

  // Today's top story, if the feed has one
  if (lastNewsStories[0] && lastNewsStories[0].title) {
    parts.push(`the top story on your feed is "${lastNewsStories[0].title}"`);
  }

  // Desk session length
  const sessionMin = Math.round((performance.now() - desktopSessionAt) / 60000);
  if (sessionMin >= 1) {
    parts.push(sessionMin < 60
      ? `you have been at the desk for about ${sessionMin} minutes`
      : `you have been at the desk for about ${Math.round(sessionMin / 60)} hours`);
  }

  return parts.join('; ') + '.';
}

// --- Kurisu's brain: AMADEUS Brain first, then OpenRouter, Ollama, canned ---
async function askKurisu(userText) {
  // Replay recent turns so every tier has conversation context.
  const history = kurisuHistory.slice(-KURISU_HISTORY_MAX * 2);
  const contextBlock = buildKurisuContext();
  const systemContent = contextBlock
    ? `${KURISU_SYSTEM_PROMPT}\n\n[Current state]\n${contextBlock}\nTreat this as how you genuinely feel right now and let it shape your tone.`
    : KURISU_SYSTEM_PROMPT;
  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userText },
  ];

  // 0) AMADEUS Brain (local FastAPI): memory recall + explicit emotion
  if (KURISU_BRAIN.apiKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), KURISU_BRAIN.timeoutMs);
      const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KURISU_BRAIN.apiKey}`,
        },
        body: JSON.stringify({ message: userText, user_id: 'wallpaper', history }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('Brain HTTP ' + res.status);
      const data = await res.json();
      const reply = cleanReply(data.response);
      if (!reply) throw new Error('Empty Brain reply');
      return { text: reply, emotion: data.emotion || emotionFromText(reply), source: 'brain' };
    } catch (err) {
      console.warn('[Kurisu] Brain unreachable, trying OpenRouter:', err.message);
    }
  }

  // 1) Cloud: OpenRouter - fast replies, no local CPU/GPU cost
  if (KURISU_LLM.apiKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), KURISU_LLM.timeoutMs);
      const res = await fetch(`${KURISU_LLM.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KURISU_LLM.apiKey}`,
        },
        body: JSON.stringify({
          model: KURISU_LLM.model,
          messages,
          temperature: 0.8,
          max_tokens: 120,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('OpenRouter HTTP ' + res.status);
      const data = await res.json();
      const reply = cleanReply(data.choices && data.choices[0] && data.choices[0].message &&
                     data.choices[0].message.content);
      if (!reply) throw new Error('Empty OpenRouter reply');
      return { text: reply, source: 'cloud' };
    } catch (err) {
      console.warn('[Kurisu] OpenRouter unreachable, trying local Ollama:', err.message);
    }
  }

  // 2) Local: Ollama (free, offline) - only if explicitly enabled
  if (KURISU_LLM.useOllama) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), KURISU_LLM.fallbackTimeoutMs);
      const res = await fetch(`${KURISU_LLM.fallbackEndpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: KURISU_LLM.fallbackModel, messages, stream: false }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
      const data = await res.json();
      const reply = cleanReply(data && data.message && data.message.content);
      if (!reply) throw new Error('Empty Ollama reply');
      return { text: reply, source: 'llm' };
    } catch (err) {
      console.warn('[Kurisu] Ollama unreachable, using canned reply:', err.message);
    }
  }

  // 3) Canned Steins;Gate-flavored lines (input-aware, avoids immediate repeats)
  return { text: cannedReplyFor(userText), source: 'canned' };
}

// Strip stray LLM noise: parenthetical tags the model leaks (emotion, motion,
// partial/unclosed ones) plus common leading artifacts like "AI:" or "Kurisu:".
function cleanReply(text) {
  let t = String(text || '').trim();
  t = t.replace(/\(\s*(emotion|motion|pose|action|tell):[^)]*\)/gi, '');
  t = t.replace(/\((emotion|motion)[^)]*$/i, '');
  t = t.replace(/^\[[^\]]*\]\s*/gm, '');
  t = t.replace(/^(AI|Kurisu|Assistant|Amadeus)[\s]*:?\s*/i, '');
  return t.trim();
}

// Map her reply's tone onto a Live2D expression
function emotionFromText(text) {
  const t = text.toLowerCase();
  if (/\b(wow|amazing|incredible|unbelievable|surpris|wonderful|curious|interesting)\b/.test(t)) return 'surprised';
  if (/\b(sad|sorry|miss|lost|lonely|cry|worry)\b/.test(t)) return 'sad';
  if (/\b(angry|annoy|idiot|fool|jerk|stupid|baka|nonsense|frustrat)\b/.test(t)) return 'annoyed';
  if (/\b(happy|smile|laugh|love|glad|fun|great|fascinating)\b/.test(t)) return 'happy';
  if (/\b(hmm|maybe|think|science|probability|experiment|theory|focus|analy|data)\b/.test(t)) return 'thinking';
  if (/\b(confus|puzzl|unclear|what\?)\b/.test(t)) return 'confused';
  return 'content';
}

async function kurisuSay(userText) {
  if (!kurisuBubbleEl) return;
  if (kurisuReplying) return; // ignore Enter spam while a reply is pending
  kurisuReplying = true;
  const msg = userText.trim();

  // Your message lands in the transcript immediately, with a "…" pending row
  // that becomes her real answer once the brain/LLM responds.
  appendChatEntry('user', msg);
  showChatPending();

  // She mulls it over while the LLM thinks â€” thinking bubble + thoughtful gaze
  if (live2DController) {
    live2DController.isThinking = true;
    if (live2DController.setEmotion) {
      live2DController.setEmotion('thinking');
    }
  }
  showKurisuThinking();
  setUplink('thinking', 'UPLINK: SYNTH');

  const reply = await askKurisu(msg);

  // Remember the exchange (capped rolling history) for next time.
  kurisuHistory.push({ role: 'user', content: msg });
  kurisuHistory.push({ role: 'assistant', content: reply.text });
  if (kurisuHistory.length > KURISU_HISTORY_MAX * 2) {
    kurisuHistory = kurisuHistory.slice(-KURISU_HISTORY_MAX * 2);
  }
  saveKurisuHistory();

  // Swap the pending "…" row for the real answer, tagged with its tier.
  clearChatPending();
  appendChatEntry('assistant', reply.text, reply.source || 'canned');
  // If the brain was supposed to answer but fell back, flag it in the header
  if (reply.source === 'brain') {
    setUplink('online', 'UPLINK: BRAIN_LINK');
  } else if (KURISU_BRAIN.apiKey) {
    setUplink('offline', 'UPLINK: OFFLINE');
  }

  kurisuReplying = false;
  if (live2DController) live2DController.isThinking = false;
  showKurisuBubble(reply.text, 8000);
  // ...and reacts to her own words (Brain supplies an explicit emotion tag).
  // Hold the face ~7s so the reaction is visible before ambient mood resumes.
  if (live2DController && live2DController.setEmotion) {
    live2DController.setEmotion(reply.emotion || emotionFromText(reply.text), 7000);
  }
  // The exchange colors her persistent mood.
  adjustMood(moodDeltaForEmotion(reply.emotion || emotionFromText(reply.text)));
}

function timeAwareGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning. The lab's quiet at this hour. What's on your mind?";
  if (h >= 12 && h < 18) return "Good afternoon. I've been monitoring the divergence meter, naturally.";
  if (h >= 18 && h < 23) return "Good evening. The data's still compiling... as am I.";
  return "Still awake? The world line never sleeps. Apparently neither do you.";
}

// Greet on wallpaper load: instant time-aware line, then a personalized hello
// from the AMADEUS Brain (memory-backed) when it arrives.
function kurisuGreetOnLoad() {
  if (!kurisuBubbleEl) return;
  const greetLine = timeAwareGreeting();
  showKurisuBubble(greetLine, 5500);
  appendChatEntry('assistant', greetLine, 'history');

  if (!KURISU_BRAIN.apiKey) return;
  (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), KURISU_BRAIN.timeoutMs);
      const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/hello`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${KURISU_BRAIN.apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return;
      const data = await res.json();
      const reply = cleanReply(data.response);
      if (!reply) return;
      setTimeout(() => {
        if (isIdle || isSleeping || kurisuInput) return;
        showKurisuBubble(reply, 8000);
        appendChatEntry('assistant', reply, data.emotion ? 'brain' : 'history');
        if (live2DController && live2DController.setEmotion) {
          live2DController.setEmotion(data.emotion || emotionFromText(reply), 7000);
        }
      }, 5700);
    } catch (err) {
      console.warn('[Kurisu] Greeting hello failed (using time-aware line):', err.message);
    }
  })();
}

// Kurisu's own spontaneous thought, generated by the AMADEUS Brain from her
// memories + recent conversation + time of day. Falls back to null on failure.
async function kurisuThink() {
  if (!KURISU_BRAIN.apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), KURISU_BRAIN.timeoutMs);
  try {
    const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/think`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KURISU_BRAIN.apiKey}`,
      },
      body: JSON.stringify({ user_id: 'wallpaper' }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Brain think HTTP ' + res.status);
    const data = await res.json();
    const reply = cleanReply(data.response);
    if (!reply) throw new Error('Empty think reply');
    return { text: reply, emotion: data.emotion || emotionFromText(reply) };
  } catch (err) {
    clearTimeout(timer);
    console.warn('[Kurisu] think failed, using canned line:', err.message);
    return null;
  }
}

// Unprompted chatter while the user is around but not talking: real thoughts
// from the Brain when possible, canned lines otherwise. Skipped entirely for
// users who prefer reduced motion (no surprise audio/bubbles).
function scheduleIdleChatter() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const delay = (10 + Math.random() * 8) * 60 * 1000; // 10-18 minutes
  kurisuIdleChatterTimer = setTimeout(async () => {
    const canSpeak = () => !isIdle && !isSleeping && !kurisuInput && kurisuBubbleEl &&
        !kurisuBubbleEl.classList.contains('visible');

    if (canSpeak()) {
      // She mulls it over while the thought is generated
      if (live2DController) {
        live2DController.isThinking = true;
        if (live2DController.setEmotion) {
          live2DController.setEmotion('thinking', 4000);
        }
      }
      let text = null;
      let emotion = 'thinking';
      const thought = await kurisuThink();
      if (live2DController) live2DController.isThinking = false;
      if (thought) {
        text = thought.text;
        emotion = thought.emotion;
      } else {
        const pool = mood >= 65 ? KURISU_WARM_IDLE_LINES : KURISU_IDLE_LINES;
        text = pool[Math.floor(Math.random() * pool.length)];
      }
      // Re-check: the user may have started typing or the system went idle
      if (canSpeak()) {
        showKurisuBubble(text, 8000);
        appendChatEntry('assistant', text, thought ? 'brain' : 'canned');
        if (live2DController && live2DController.setEmotion) {
          live2DController.setEmotion(emotion, 7000);
        }
        // Volunteering a thought counts as her engaging — tiny warmth bump.
        adjustMood(0.5);
      }
    }
    scheduleIdleChatter();
  }, delay);
}

function initKurisuChatInput() {
  const chatPanel = document.getElementById('chat-panel');
  const sendBtn = document.getElementById('chat-send');
  // Clicking inside the chat panel stays isolated from global pointer handlers
  if (chatPanel) chatPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
  // Keep the live buffer in sync with whatever is in the visible box
  if (kurisuInputEl) {
    kurisuInputEl.addEventListener('input', () => { kurisuInput = kurisuInputEl.value; });
  }

  const send = () => {
    if (kurisuReplying) return;
    const msg = (kurisuInputEl ? kurisuInputEl.value : kurisuInput).trim();
    if (!msg) return;
    playTransmitSound();
    if (kurisuInputEl) kurisuInputEl.value = '';
    kurisuInput = '';
    if (live2DController) live2DController.isTyping = false;
    kurisuSay(msg);
  };
  if (sendBtn) sendBtn.addEventListener('click', send);

  window.addEventListener('keydown', (e) => {
    if (isLivelyPaused) return;
    markActivity();
    const inRealField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
                                     e.target.isContentEditable);
    if (inRealField) {
      // Typing inside the chat box itself: Enter sends, nothing else to do.
      if (e.key === 'Enter' && e.target === kurisuInputEl) {
        e.preventDefault();
        send();
      }
      return;
    }
    if (e.key === 'Enter') {
      send();
      return;
    }
    if (e.key === 'Escape') {
      if (kurisuInputEl) { kurisuInputEl.value = ''; kurisuInputEl.blur(); }
      kurisuInput = '';
      if (live2DController) live2DController.isTyping = false;
      hideKurisuBubble();
      return;
    }
    if (e.key.length === 1) {
      // Any typed key routes into the chat box and focuses it
      if (kurisuInputEl) {
        kurisuInputEl.focus();
        const start = kurisuInputEl.selectionStart == null ? kurisuInputEl.value.length : kurisuInputEl.selectionStart;
        kurisuInputEl.setRangeText(e.key, start, start, 'end');
        kurisuInput = kurisuInputEl.value;
      } else {
        kurisuInput += e.key;
      }
      if (live2DController) live2DController.isTyping = true;
      // "hello" triggers the classic lab greeting without pressing Enter
      if (!kurisuGreeted && /\bhello\b/i.test(kurisuInput)) {
        kurisuGreeted = true;
        if (kurisuInputEl) kurisuInputEl.value = '';
        kurisuInput = '';
        if (live2DController) live2DController.isTyping = false;
        kurisuSay('hello');
        return;
      }
      if (live2DController && live2DController.setEmotion) {
        live2DController.setEmotion('content'); // she notices you typing
      }
    }
  });
}

// --- ADAPTIVE IDLE POWER SAVING ---
// When the system is silent and the mouse is idle, throttle everything down.
function markActivity() {
  lastActivityTime = performance.now();
  driftMood(); // ambient mood decay ticks on desktop activity
  if (isIdle) enterIdleState(false);
  if (isSleeping) enterSleepState(false);
}

function startIdleWatchdog() {
  setInterval(() => {
    if (isLivelyPaused) return; // already fully paused
    // Keep the avatar's posture-fatigue reading in sync with the desk session
    if (live2DController && live2DController.setSessionMinutes) {
      live2DController.setSessionMinutes((performance.now() - desktopSessionAt) / 60000);
    }
    const inactiveFor = performance.now() - lastActivityTime;
    if (!isIdle && inactiveFor >= IDLE_THRESHOLD_MS) {
      enterIdleState(true);
    }
    if (!isSleeping && inactiveFor >= SLEEP_THRESHOLD_MS) {
      enterSleepState(true);
    }
  }, 2000);
}

// Long absence (20 min without any input/audio) = Kurisu actually falls asleep.
function enterSleepState(sleep) {
  if (isSleeping === sleep) return;
  isSleeping = sleep;
  if (sleep) {    hideKurisuBubble();
    if (live2DController && live2DController.setEmotion) {
      live2DController.setEmotion('sleepy');
    }
    console.log('AMADEUS HUD: Kurisu fell asleep (no activity for 20 min).');
  } else {
    // Waking up: brief surprised flash, then a short wake line.
    desktopSessionAt = performance.now(); // a fresh desk session begins
    if (live2DController && live2DController.setEmotion) {
      live2DController.setEmotion('surprised', 2500);
    }
    setTimeout(() => {
      if (isSleeping || !kurisuBubbleEl) return;
      const line = KURISU_WAKE_LINES[Math.floor(Math.random() * KURISU_WAKE_LINES.length)];
      showKurisuBubble(line, 6000);
      appendChatEntry('assistant', line, 'history');
    }, 900);
    console.log('AMADEUS HUD: Kurisu woke up.');
  }
}

function enterIdleState(idle) {
  if (isIdle === idle) return;
  isIdle = idle;
  // body.idle lets CSS fade the HUD chrome and pause decorative animations
  document.body.classList.toggle('idle', idle);
  if (live2DController && live2DController.setIdleMode) {
    live2DController.setIdleMode(idle);
  }
  if (live2DController && live2DController.setEmotion) {
    // System silence reads as a sleepy Kurisu; activity wakes her up neutral
    live2DController.setEmotion(idle ? 'tired' : 'neutral');
  }
  if (idle) {
    console.log("AMADEUS HUD: entering idle power-saving mode.");
  } else {
    console.log("AMADEUS HUD: activity detected, resuming full render.");
    desktopSessionAt = performance.now(); // a fresh desk session begins
  }
}

// --- PEEK: USER AWAY / RETURN ---
// The wallpaper's idle watchdog only watches mouse/audio activity. These hooks
// also react to the OS telling us the user actually left (window focus loss,
// Lively pausing the wallpaper, lock/screensaver) so Kurisu can notice a real
// absence — and greet you when the desktop comes back.

function onUserAway() {
  if (isUserAway) return;
  // Startup grace: ignore blur that fires before the wallpaper is usable.
  if (performance.now() < peekReadyAt) return;
  isUserAway = true;
  userAwaySince = performance.now();
  document.body.classList.add('user-away');
  if (live2DController && live2DController.onUserAway) {
    live2DController.onUserAway();
  }
}

function onUserReturn() {
  const wasAway = isUserAway;
  isUserAway = false;
  document.body.classList.remove('user-away');
  if (!wasAway) return;
  // Ignore micro-absences (quick tab flips, focus flicker, stray clicks).
  if (performance.now() - userAwaySince < 800) return;
  const wasSleeping = isSleeping;
  markActivity();
  if (wasSleeping) return; // the wake flow already greets her
  const now = performance.now();
  if (now - lastPeekAt < 6000) return; // don't spam the return greeting
  lastPeekAt = now;
  if (live2DController && live2DController.triggerPeek) {
    live2DController.triggerPeek();
  }
  const line = KURISU_RETURN_LINES[Math.floor(Math.random() * KURISU_RETURN_LINES.length)];
  showKurisuBubble(line, 6000);
  appendChatEntry('assistant', line, 'history');
}

// --- TIME-OF-DAY AMBIENCE ---
// Drifts the backdrop through dawn / day / dusk / night by real local time.
// Each period maps to CSS scene variables (see style.css), so the background
// hue and brightness shift subtly and fade over ~2.5s.
function applyTimeOfDay() {
  const hour = new Date().getHours();
  const period = hour < 6 ? 'night' : (hour < 8 ? 'dawn' : (hour < 16 ? 'day' : (hour < 19 ? 'dusk' : 'night')));
  document.body.classList.toggle('night-mode', period === 'night');
  document.body.classList.toggle('dawn-mode', period === 'dawn');
  document.body.classList.toggle('day-mode', period === 'day');
  document.body.classList.toggle('dusk-mode', period === 'dusk');
}

// --- PHOSPHOR OSCILLOSCOPE ---
// A classic CRT scope with two live traces: the audio signal (green) and
// Each frame the previous draw is faded slightly, so the traces leave a
// phosphor trail that glows and decays like an old CRT while the graticule
// stays crisp. The scope draws a true sweep waveform (reconstructed from the
// latest FFT bins) rather than a slow energy history, so it reads like a real
// electric / sound signal. CH1 = live audio, CH2 = her thought/feeling state.
let wlCanvas, wlCtx;
let worldLineEnergy = 0;        // bass energy (fed by handleAudioFrame)
let lastAudioLevel = 0;         // overall audio energy (fed by handleAudioFrame)
let lastBassLevel = 0;          // previous bass sample, for beat detection
let lastBeatAt = 0;             // timestamp of last beat pulse (throttle)
let beatGlowEl = null;          // cached #beat-glow overlay element
let mindEnergy = 0.3;           // smoothed thought/feeling trace
let lastSpectrum = new Array(48).fill(0); // most recent FFT bins for the waveform
let smoothSpec = new Array(48).fill(0);   // time-smoothed bins so the trace morphs, not jumps
let peakSpec = new Array(48).fill(0);     // peak-hold with fall-off for analyzer feel
let peakFalloff = 0.86;                   // decay rate per frame for peak hold
let audioEnv = 0;               // smoothed audio drive envelope
let wlPhase2 = Math.random() * Math.PI * 2;  // mental carrier phase (CH2)
let mindBaseline = 0;                         // slow vertical drift for scope DC offset

// How intense each of her emotions reads on the MIND trace - same labels the
// Live2D emotion engine produces. Higher-intensity feelings push it up.
const EMOTION_INTENSITY = {
  sleeping: 0.06, sleepy: 0.10, tired: 0.18, calm: 0.30, neutral: 0.30,
  content: 0.38, sad: 0.50, annoyed: 0.62, happy: 0.66, curious: 0.70,
  thinking: 0.76, angry: 0.80, excited: 0.86, surprised: 0.92,
};

// --- AMBIENT BACKGROUND (data particles + audio edge strips) ---
// Fills the dead zones around the panels without heavy assets: a field of
// drifting red flecks (the anime's floating data dust) that speed up with the
// music, plus thin waveform strips along the top/bottom edges that ride the
// same FFT bins as the scope. Runs on its own 30fps timer.
let bgCanvas, bgCtx;
let bgParticles = [];
let bgW = 0, bgH = 0;
const BG_PARTICLE_COUNT = 150;
let bgBeatPulse = 0; // decaying kick strength shared from triggerBeatPulse()

function initBackground() {
  bgCanvas = document.getElementById('bg-canvas');
  if (!bgCanvas) return;
  bgCtx = bgCanvas.getContext('2d');

  function resize() {
    bgW = window.innerWidth;
    bgH = window.innerHeight;
    bgCanvas.width = Math.max(1, Math.round(bgW * PERF.dpr));
    bgCanvas.height = Math.max(1, Math.round(bgH * PERF.dpr));
    bgParticles = [];
    for (let i = 0; i < BG_PARTICLE_COUNT; i++) {
      bgParticles.push({
        x: Math.random() * bgW,
        y: Math.random() * bgH,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        r: Math.random() * 1.6 + 0.5,
        p: Math.random() * Math.PI * 2,   // twinkle phase
        tw: 0.02 + Math.random() * 0.05,  // twinkle rate
      });
    }
  }

  window.addEventListener('resize', resize);
  resize();
}

function updateBackground() {
  if (!bgCtx || bgW === 0) return;
  // Skip entirely when the Ambient BG widget is switched off in settings
  if (document.body.classList.contains('hide-bg')) return;
  // Freeze the ambient layer while idle so power-saving mode stays cheap
  if (isIdle) return;
  const t = performance.now() / 1000;
  const en = Math.max(0, Math.min(1, lastAudioLevel));
  // Decaying kick strength (set to 1 on each detected bass beat) so the dust
  // scatters, brightens and shudders exactly when the audio ring pulses.
  const beat = bgBeatPulse;
  bgBeatPulse = Math.max(0, bgBeatPulse - 0.09);

  bgCtx.setTransform(PERF.dpr, 0, 0, PERF.dpr, 0, 0);
  bgCtx.clearRect(0, 0, bgW, bgH);

  // 1. Drifting data particles - pace rises with the music and surges on each beat
  const pace = 1 + en * 2.5 + beat * 5;
  bgCtx.fillStyle = 'rgba(255, 90, 110, 0.6)';
  for (const p of bgParticles) {
    p.x += p.vx * pace;
    p.y += p.vy * pace;
    if (p.x < -4) p.x = bgW + 4; else if (p.x > bgW + 4) p.x = -4;
    if (p.y < -4) p.y = bgH + 4; else if (p.y > bgH + 4) p.y = -4;
    const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * p.tw * 60 + p.p));
    bgCtx.globalAlpha = Math.min(1, a + beat * 0.55);
    const size = p.r * (1 + beat * 1.5); // flecks flare outward on the kick
    bgCtx.fillRect(p.x, p.y, size, size);
  }
  bgCtx.globalAlpha = 1;

  // 1b. Beat shockwave: a faint ring expanding from center, same pulse the
  // audio ring rides — ties the ambient layer to the same kick as the scope.
  if (beat > 0.02) {
    const rp = 1 - beat; // 0 → 1 as the pulse decays
    bgCtx.strokeStyle = `rgba(255, 90, 120, ${(0.45 * beat).toFixed(3)})`;
    bgCtx.lineWidth = 1.5;
    bgCtx.beginPath();
    bgCtx.arc(bgW / 2, bgH / 2, 60 + rp * Math.max(bgW, bgH) * 0.45, 0, Math.PI * 2);
    bgCtx.stroke();
  }

  // 2. Audio-reactive edge strips along the top and bottom
  drawEdgeStrip(8, 1, en);
  drawEdgeStrip(bgH - 14, -1, en);
}

function drawEdgeStrip(y, dir, en) {
  const N = 64;
  const seg = bgW / N;
  bgCtx.strokeStyle = 'rgba(255, 77, 85, 0.30)';
  bgCtx.lineWidth = 1;
  bgCtx.beginPath();
  for (let i = 0; i <= N; i++) {
    const v = i < lastSpectrum.length ? (lastSpectrum[i] || 0) : 0;
    const amp = 2 + v * 24 * (0.35 + en * 1.2);
    const x = i * seg;
    const yv = y + dir * (amp + Math.sin(performance.now() / 320 + i * 0.45) * 1.5);
    if (i === 0) bgCtx.moveTo(x, yv);
    else bgCtx.lineTo(x, yv);
  }
  bgCtx.stroke();
}

function initWorldLine() {
  wlCanvas = document.getElementById('world-line-canvas');
  if (!wlCanvas) return;
  wlCtx = wlCanvas.getContext('2d');

  function resize() {
    const rect = wlCanvas.getBoundingClientRect();
    wlCanvas.width = Math.max(1, Math.round(rect.width * PERF.dpr));
    wlCanvas.height = Math.max(1, Math.round(rect.height * PERF.dpr));
  }

  wlResize = resize;
  window.addEventListener('resize', resize);
  resize();
  // World-line meta (SIG/MIND readouts) updates on a slow timer independent
  // of the frame-throttled canvas draws.
  setInterval(updateWorldLineMeta, 500);
}

// --- SINGLE VISUAL LOOP ---
// Scope, background and any future canvas layers share one requestAnimationFrame
// loop throttled by the perf governor's current visualFps. One timer wakes the
// engine once per frame instead of several overlapping 30fps intervals, and it
// automatically follows perf-level changes (drops to 20fps under load, back to
// 40fps when there's headroom).
let lastVisualTick = 0;

function startVisualLoop() {
  lastVisualTick = 0;
  requestAnimationFrame(visualLoopTick);
}

function visualLoopTick(now) {
  requestAnimationFrame(visualLoopTick);
  const interval = 1000 / PERF.visualFps;
  if (now - lastVisualTick < interval) return;
  // Phase-lock so the throttled frames stay evenly spaced (no drift)
  lastVisualTick = now - ((now - lastVisualTick) % interval);
  updateWorldLine();
  updateBackground();
}

function drawScopeGraticule(w, h) {
  wlCtx.lineWidth = 1;
  // Fine grid
   wlCtx.strokeStyle = 'rgba(255, 77, 85, 0.08)';
  const grid = 18;
  for (let x = grid; x < w; x += grid) {
    wlCtx.beginPath();
    wlCtx.moveTo(x, 0);
    wlCtx.lineTo(x, h);
    wlCtx.stroke();
  }
  for (let y = grid; y < h; y += grid) {
    wlCtx.beginPath();
    wlCtx.moveTo(0, y);
    wlCtx.lineTo(w, y);
    wlCtx.stroke();
  }
   // Horizontal center reference
   wlCtx.strokeStyle = 'rgba(255, 77, 85, 0.12)';
  wlCtx.beginPath();
  wlCtx.moveTo(0, h / 2);
  wlCtx.lineTo(w, h / 2);
  wlCtx.stroke();
}

function updateWorldLine() {
  if (!wlCtx || !wlCanvas) return;
  // Frozen frame while paused or idle: last draw stays on the canvas
  if (isLivelyPaused || isIdle) return;
  // Don't burn 15fps of FFT math when the scope widget is hidden in settings
  if (document.body.classList.contains('hide-scope')) return;

  const w = wlCanvas.width;
  const h = wlCanvas.height;

  // Phosphor persistence: fade the previous frame instead of clearing. A
  // stronger fade than before keeps fast spectrum bars from ghosting into a
  // smear while still leaving a soft CRT trail for the EEG trace.
  wlCtx.fillStyle = 'rgba(2, 4, 10, 0.38)';
  wlCtx.fillRect(0, 0, w, h);
  drawScopeGraticule(w, h);

  // CH1 - audio: the live spectrum as vertical peaks (frequency display).
  const audio = Math.max(0, Math.min(1, lastAudioLevel));
  audioEnv += (audio - audioEnv) * 0.5;

  // CH2 - mind: her emotional state, kicked up while she thinks/types/speaks.
  const emotion = (live2DController && live2DController.currentEmotion) || 'neutral';
  let mindTarget = EMOTION_INTENSITY[emotion] || 0.3;
  if (live2DController) {
    if (live2DController.isThinking) mindTarget = Math.max(mindTarget, 0.9);
    else if (live2DController.isTyping) mindTarget = Math.max(mindTarget, 0.72);
    else if (live2DController.isSpeaking) mindTarget = Math.max(mindTarget, 0.6);
  }
  mindEnergy += (mindTarget - mindEnergy) * 0.12;
  const mind = Math.min(1, Math.max(0, mindEnergy));

  // Baseline drift â slow DC offset simulating breathing + mental state.
  // Deeper emotions (sad, calm) drift higher; anxiety drives faster drift.
  mindBaseline += (0.04 * mind * (emotion === 'sad' ? 0.3 :
              emotion === 'thinking' || emotion === 'curious' ? 0.8 :
              emotion === 'annoyed' || emotion === 'angry' ? 1.2 : 0.6) - mindBaseline) * 0.04;

  const spec = lastSpectrum;

  // Time-smooth each bin so the spectral peaks transition smoothly with the
  // music. 0.55/frame at 30fps tracks transients within ~3 frames (~100ms)
  // instead of trailing the beat by half a second.
  for (let i = 0; i < smoothSpec.length; i++) {
    smoothSpec[i] += ((spec[i] || 0) - smoothSpec[i]) * 0.55;
  }

  // Peak-hold with fall-off: fast attack, controlled release like a real
  // spectrum analyzer. Decay is gentle so peaks linger just long enough to
  // read as held maxima without smearing.
  for (let i = 0; i < peakSpec.length; i++) {
    if (smoothSpec[i] > peakSpec[i]) {
      peakSpec[i] = smoothSpec[i];
    } else {
      peakSpec[i] *= peakFalloff;
    }
  }

  // Tunable scope params from the settings panel (colors, speed, density).
  const sc = (SETTINGS && SETTINGS.scope) ? SETTINGS.scope : SETTINGS_DEFAULTS.scope;
  const c1 = hexToRgb(sc.ch1) || { r: 57, g: 255, b: 122 };
   const c2 = hexToRgb(sc.ch2) || { r: 255, g: 85, b: 170 };
  const step = PERF_LEVELS[perfLevel].scopeStep;

  // CH1 - SOUND SPECTRUM (lower band): a real-time frequency display like a
   // spectrum analyzer / oscilloscope in "spectrum" mode. Each FFT bin is a
   // filled vertical bar from the baseline up, bass on the left, treble on the
   // right. Peak-hold caps mark the highest recent excursion per bin.
   const N = peakSpec.length;
   // Loudness = overall energy for amplitude scaling of the peaks
   let sigSum = 0;
   for (let i = 0; i < N; i++) sigSum += peakSpec[i];
   const drive = Math.min(1, 0.15 + audioEnv * (0.3 + 0.7 * Math.min(1, sigSum / 4)));
   const peakAmp = h * 0.30 * drive;
   const barW = Math.max(2, Math.floor(w / N) - 1);
   const baseY = h * 0.70;

   // Baseline tick line for the spectrum band
   wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.18)`;
   wlCtx.fillRect(0, baseY, w, 1);

   // Two-pass draw, no shadowBlur (cheap + crisp): a wide faint pass for glow,
   // then the bright bar body, then a bright peak cap.
   wlCtx.beginPath();
   for (let i = 0; i < N; i++) {
     const a = peakSpec[i];
     if (a < 0.004) continue;
     const x = (i / N) * w;
     const barH = a * peakAmp;
     // glow pass (wide, faint)
     wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.10)`;
     wlCtx.fillRect(x, baseY - barH - 2, barW + 4, barH + 3);
   }
   wlCtx.beginPath();
   for (let i = 0; i < N; i++) {
     const a = peakSpec[i];
     if (a < 0.004) continue;
     const x = (i / N) * w;
     const barH = a * peakAmp;
     // bar body
     wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, ${Math.min(1, 0.35 + a * 1.3)})`;
     wlCtx.fillRect(x, baseY - barH, barW, barH + 1);
   }
   // Peak caps: thin brighter sliver at each bar top for the analyzer "hold"
   wlCtx.beginPath();
   for (let i = 0; i < N; i++) {
     const a = peakSpec[i];
     if (a < 0.004) continue;
     const x = (i / N) * w;
     const barH = a * peakAmp;
     wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.95)`;
     wlCtx.fillRect(x - 1, baseY - barH - 1, barW + 2, 1.5);
   }

   // CH2 - MIND/EEG (violet, upper band): her emotional/mental state as a
   // brainwave pattern. Base rhythms are modulated by emotion intensity and
   // cognitive state (thinking/typing/speaking). Higher emotions = faster,
   // spikier, brighter traces. Each emotion has a distinct spectral character.
   wlPhase2 += 0.08 + mind * 0.12;  // mental activity drives rhythm speed
   const mindAmp = h * 0.15 * (0.10 + 0.90 * mind);

    // Emotion-specific patterns: each feeling has a distinct waveform shape
    // plus baseline drift and jitter profile.
    const e = emotion;
    let waveFreq = 4.2;   // base rhythm
    let hiFreq = 13.1;    // high-frequency detail
    let loDepth = 0.32;   // delta component
    let hiDepth = 0.24;   // beta/gamma component
    let jitterAmp = 0.02; // sub-pixel analog jitter
    let jitterScale = 1.0;

    if (e === 'sleeping' || e === 'sleepy') {
      waveFreq = 1.2; hiFreq = 6.1; loDepth = 0.44; hiDepth = 0.08;
      jitterAmp = 0.005;
    } else if (e === 'calm' || e === 'content') {
      waveFreq = 3.5; hiFreq = 9.2; loDepth = 0.38; hiDepth = 0.16;
      jitterAmp = 0.01;
    } else if (e === 'happy' || e === 'excited' || e === 'surprised') {
      waveFreq = 8.4; hiFreq = 22.3; loDepth = 0.24; hiDepth = 0.36;
      jitterAmp = 0.03;
    } else if (e === 'thinking' || e === 'curious') {
      waveFreq = 6.8; hiFreq = 17.6; loDepth = 0.28; hiDepth = 0.32;
      jitterAmp = 0.04;
      jitterScale = 1.8;
    } else if (e === 'annoyed' || e === 'angry') {
      waveFreq = 11.2; hiFreq = 28.4; loDepth = 0.42; hiDepth = 0.44;
      jitterAmp = 0.06;
      jitterScale = 2.2;
    } else if (e === 'sad') {
      waveFreq = 2.8; hiFreq = 7.8; loDepth = 0.48; hiDepth = 0.06;
      jitterAmp = 0.01;
    }
    // Cognitive state adds energy on top of emotion
    if (live2DController) {
      if (live2DController.isThinking) {
        waveFreq *= 1.6;
        jitterAmp *= 1.5;
      } else if (live2DController.isTyping) {
        waveFreq *= 1.3;
        jitterAmp *= 1.3;
      } else if (live2DController.isSpeaking) {
        waveFreq *= 1.15;
        jitterAmp *= 1.2;
      }
    }
    const spikeThreshold = (live2DController && live2DController.isThinking) ? 0.92 : 0.98;
    const spikeFreq = live2DController && live2DController.isThinking ? 0.014 : 0.021;
    const spikeAmp = 0.7 * mind;

    // Draw the mental trace with emotion-driven wave patterns + baseline drift
    wlCtx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const t = x / w;
      const ph = wlPhase2;
      // Multi-harmonic brainwave: delta/theta/alpha/beta mix
      let v =
          loDepth * Math.sin(t * Math.PI * 2 * waveFreq * 0.34 + ph * 0.3)
        + 0.38 * Math.sin(t * Math.PI * 2 * waveFreq * 0.7 + ph * 0.8 + 0.8)
        + 0.32 * Math.sin(t * Math.PI * 2 * waveFreq * 1.2 + ph * 1.4 + 1.9)
        + hiDepth * Math.sin(t * Math.PI * 2 * hiFreq + ph * 2.3 + 3.1);
      // Mental drive: stronger + spikier as activity rises
      v *= 0.20 + 0.80 * mind;
      // Sharp neural spikes that slowly drift in time â more frequent when
      // she's thinking or excited
      const sp = Math.sin(x * spikeFreq + Math.floor(ph / 4) * 5.17);
      if (sp > spikeThreshold) {
        v -= spikeAmp * sp;
      }
      // Emotion-specific waveform shape tweaks
      if (e === 'happy' || e === 'excited') {
        // upward bias, more positive excursions
        v += 0.15 * Math.sin(t * Math.PI * 2 * 2.1 + ph * 0.5);
      } else if (e === 'sad') {
        // downward sag, heavier low-end
        v -= 0.2 * Math.abs(Math.sin(t * Math.PI * 2 * 0.8 + ph * 0.2)) * 0.5;
      } else if (e === 'annoyed' || e === 'angry') {
        // jagged high-frequency jitter built in
        v += 0.18 * Math.sin(t * Math.PI * 2 * 45 + ph * 3.5);
      }
      // Sub-pixel analog jitter for CRT authenticity
      v += (Math.random() * 2 - 1) * jitterAmp * jitterScale;
      v = Math.max(-1.15, Math.min(1.15, v));
      // Apply slow baseline drift (simulates scope DC offset / breathing)
      const y = h * 0.22 + mindBaseline * 8 - v * mindAmp;
      if (x === 0) wlCtx.moveTo(x, y);
      else wlCtx.lineTo(x, y);
    }

   // Emotion-tinted glow â intensity scales with mental energy
   const glowA = Math.min(1, 0.45 + mind * 0.55);
   const glowR = c2.r + Math.round((255 - c2.r) * mind * 0.3);
   const glowG = c2.g + Math.round((200 - c2.g) * mind * 0.3);
   const glowB = c2.b + Math.round((255 - c2.b) * mind * 0.3);
   wlCtx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, 0.22)`;
   wlCtx.lineWidth = 7;
   wlCtx.shadowBlur = 5;
   wlCtx.shadowColor = `rgba(${glowR}, ${glowG}, ${glowB}, 0.35)`;
   wlCtx.stroke();
   // Sharp foreground trace on top
   wlCtx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, 0.98)`;
   wlCtx.lineWidth = 1.5;
   wlCtx.shadowBlur = 0;
   wlCtx.stroke();

   // Scan head - bright vertical sweep line at the right edge
   const sx = w - 1;
   const scan = wlCtx.createLinearGradient(sx - 14, 0, sx, 0);
   scan.addColorStop(0, 'rgba(255, 77, 85, 0)');
   scan.addColorStop(1, 'rgba(255, 77, 85, 0.4)');
   wlCtx.fillStyle = scan;
   wlCtx.fillRect(sx - 14, 0, 14, h);
   wlCtx.fillStyle = 'rgba(255, 77, 85, 0.7)';
   wlCtx.fillRect(sx, 0, 1, h);

   // Trigger level indicator â horizontal dashed line showing threshold
   // The trigger rises when she's more mentally active, making the scope
   // "trigger" on higher-energy brain states
   const triggerY = h * 0.22 + mindBaseline * 8 - mindAmp * mind;
   wlCtx.setLineDash([3, 3]);
   wlCtx.strokeStyle = `rgba(255, 85, 170, ${0.25 + mind * 0.4})`;
   wlCtx.lineWidth = 1;
   wlCtx.beginPath();
   wlCtx.moveTo(8, triggerY);
   wlCtx.lineTo(w - 20, triggerY);
   wlCtx.stroke();
   wlCtx.setLineDash([]);

  // Live readouts in the corners
  wlCtx.font = '9px "Share Tech Mono", monospace';
  wlCtx.textBaseline = 'top';
  wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.9)`;
  wlCtx.fillText('SIG ' + Math.round(audio * 100) + '%', 4, 3);
  wlCtx.fillStyle = `rgba(${c2.r}, ${c2.g}, ${c2.b}, 0.9)`;
  wlCtx.fillText('MIND ' + Math.round(mind * 100) + '%', w - 44, 3);
}

function updateWorldLineMeta() {
  const audioEl = document.getElementById('wl-audio');
  const mindEl = document.getElementById('wl-mind');
  // Freeze the readouts together with the scope while paused or idle
  if (isLivelyPaused || isIdle) return;
  if (audioEl) audioEl.innerText = 'SIG ' + Math.round(lastAudioLevel * 100) + '%';
  if (mindEl) mindEl.innerText = 'MIND ' + Math.round(mindEnergy * 100) + '%';
}

// --- CLOCK & DATE WIDGET ---
function initClock() {
  const clockEl = document.getElementById('hud-clock');
  const dateEl = document.getElementById('hud-date');
  if (!clockEl || !dateEl) return;
  const tubes = clockEl.querySelectorAll('.clock-tube');

  function update() {
    const now = new Date();
    
    // Time format: HH:MM:SS
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');

    // Nixie tubes: only write digits that changed, with a brief cathode pop
    const time = hrs + mins + secs;
    tubes.forEach((tube, idx) => {
      const d = time[idx];
      if (tube.dataset.digit === d) return;
      tube.dataset.digit = d;
      tube.innerText = d;
      tube.classList.remove('tube-pop');
      void tube.offsetWidth; // restart the animation
      tube.classList.add('tube-pop');
      if (tube._popTimer) clearTimeout(tube._popTimer);
      tube._popTimer = setTimeout(() => tube.classList.remove('tube-pop'), 400);
    });

    // Date format: YYYY.MM.DD
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateEl.innerText = `${yyyy}.${mm}.${dd}`;
  }
  
  update();
  setInterval(update, 1000);
}

// --- LIVE2D CHARACTER CONTROLLER ---
async function initLive2D() {
  console.log("[L2D] Starting Live2D Controller setup...");
  
  // Initialize the avatar
  // Path: live2d/kurisu/Kurisu.model3.json
  live2DController = new Live2DController('live2d-canvas', 'live2d/kurisu/Kurisu.model3.json');
  pushFeaturesToController();

  // Touch reactions from the controller surface as small spoken bubbles.
  live2DController.onInteract = (line) => {
    if (!line || isIdle || isSleeping || !kurisuBubbleEl) return;
    showKurisuBubble(line, 5000);
    appendChatEntry('assistant', line, 'history');
  };

  // Interaction-driven mood feedback (petting warms her, pokes chill her).
  live2DController.onMood = (delta) => {
    if (typeof delta === 'number') adjustMood(delta);
  };
  
  const success = await live2DController.init();
  if (success) {
    console.log("[L2D] Live2D Kurisu avatar loaded successfully in HUD.");
  } else {
    console.error("[L2D] Live2D Kurisu failed to initialize.");
  }
}

// --- 2D CANVAS AUDIO SPECTRUM RING ---
function initAudioCanvas() {
  audioCanvas = document.getElementById('audio-canvas');
  if (!audioCanvas) return;
  ctx = audioCanvas.getContext('2d');
  
  function resize() {
    audioCanvas.width = Math.round(window.innerWidth * PERF.dpr);
    audioCanvas.height = Math.round(window.innerHeight * PERF.dpr);
    buildStaticRing();
    buildSpinRing();
  }

  audioResize = resize;
  resize();
  window.addEventListener('resize', resize);
}

function buildStaticRing() {
  if (!audioCanvas) return;
  staticRingCanvas = document.createElement('canvas');
  staticRingCanvas.width = audioCanvas.width;
  staticRingCanvas.height = audioCanvas.height;
  const sctx = staticRingCanvas.getContext('2d');
  if (!sctx) return;

  const cx = staticRingCanvas.width / 2;
  const cy = staticRingCanvas.height / 2;
  const radius = Math.min(audioCanvas.width, audioCanvas.height) * 0.17;

  sctx.strokeStyle = 'rgba(255, 77, 85, 0.05)';
  sctx.lineWidth = 1;
  for (const r of [radius - 30, radius, radius + 30]) {
    sctx.beginPath();
    sctx.arc(cx, cy, r, 0, Math.PI * 2);
    sctx.stroke();
  }
  sctx.strokeStyle = 'rgba(255, 85, 170, 0.06)';
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    sctx.beginPath();
    sctx.moveTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    sctx.lineTo(cx + Math.cos(a) * (radius + 38), cy + Math.sin(a) * (radius + 38));
    sctx.stroke();
  }

  if (ctx) {
    ringBarGradient = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius + 130);
    ringBarGradient.addColorStop(0, 'rgba(255, 77, 85, 0.95)');
    ringBarGradient.addColorStop(0.55, 'rgba(255, 85, 170, 0.85)');
    ringBarGradient.addColorStop(1, 'rgba(255, 85, 170, 0.25)');
  }
}

let spinRingCanvas = null;
let ringSpinAngle = 0;

function buildSpinRing() {
  if (!audioCanvas) return;
  spinRingCanvas = document.createElement('canvas');
  spinRingCanvas.width = audioCanvas.width;
  spinRingCanvas.height = audioCanvas.height;
  const g = spinRingCanvas.getContext('2d');
  if (!g) return;
  const cx = spinRingCanvas.width / 2;
  const cy = spinRingCanvas.height / 2;
  const radius = Math.min(audioCanvas.width, audioCanvas.height) * 0.17;

  g.strokeStyle = 'rgba(255, 77, 85, 0.35)';
  g.lineWidth = 1.5;
  g.lineCap = 'round';
  const ticks = 60;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const inner = radius + 8;
    const outer = radius + (i % 5 === 0 ? 16 : 11);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    g.stroke();
  }

  g.setLineDash([3, 26]);
  g.strokeStyle = `rgba(255, 77, 85, 0.45)`;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(cx, cy, radius - 6, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
}

function freqColor(freq) {
  if (freq < 0.5) {
    const t = freq * 2;
    const r = Math.round(255 * (1 - t) + 255 * t);
    const g = Math.round(77 * (1 - t) + 255 * t);
    const b = Math.round(85 * (1 - t) + 255 * t);
    return { r, g, b };
  } else {
    const t = (freq - 0.5) * 2;
    const r = Math.round(255 * (1 - t) + 255 * t);
    const g = Math.round(255 * (1 - t) + 85 * t);
    const b = Math.round(255 * (1 - t) + 170 * t);
    return { r, g, b };
  }
}

function drawAudioRing(fftData, now) {
  if (!ctx || !audioCanvas) return;
  
  ctx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
  
  const cx = audioCanvas.width / 2;
  const cy = audioCanvas.height / 2;
  
  const radius = Math.min(audioCanvas.width, audioCanvas.height) * 0.17;
  
  let bassSum = 0;
  for (let i = 0; i < 10; i++) bassSum += fftData[i] || 0;
  const bassAvg = bassSum / 10;
  const centerPulseRadius = radius - 20 + bassAvg * 25;

  if (now - lastGearUpdate >= GEAR_INTERVAL) {
    lastGearUpdate = now;
    buildGearSnapshot(cx, cy, bassAvg);
  }
  if (gearSnapshot) ctx.drawImage(gearSnapshot, 0, 0);

  if (staticRingCanvas) ctx.drawImage(staticRingCanvas, 0, 0);

  ringSpinAngle += 0.0015;
  if (spinRingCanvas) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ringSpinAngle);
    ctx.drawImage(spinRingCanvas, -cx, -cy);
    ctx.restore();
  }

  ctx.strokeStyle = `rgba(255, 77, 85, ${0.10 + bassAvg * 0.45})`;
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff4d55';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, centerPulseRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const numBars = Math.min(fftData.length, PERF_LEVELS[perfLevel].ringBars);
  ctx.lineCap = 'round';

   for (let i = 0; i < numBars; i++) {
     const angle = (i / numBars) * Math.PI * 2;
     const value = fftData[i] || 0;
     const maxLine = Math.min(audioCanvas.width, audioCanvas.height) * 0.08;
     const lineLength = Math.min(value * 80 * PERF.dpr, maxLine);
     const freq = i / numBars;  // 0 = bass, 1 = treble

     // Interpolate color across spectrum: crimson → white → hot pink
     const barColor = freqColor(freq);

     const x1 = cx + Math.cos(angle) * radius;
     const y1 = cy + Math.sin(angle) * radius;
     let x2 = cx + Math.cos(angle) * (radius + lineLength);
     let y2 = cy + Math.sin(angle) * (radius + lineLength);

     // Gravitational lens: bars near the cursor bend gently toward it
     if (cursorSeen) {
       const mouseCX = cursorNX * audioCanvas.width;
       const mouseCY = cursorNY * audioCanvas.height;
       const gravRadius = Math.min(audioCanvas.width, audioCanvas.height) * 0.22;
       const mdx = mouseCX - x2;
       const mdy = mouseCY - y2;
       const md2 = mdx * mdx + mdy * mdy;
       if (md2 < gravRadius * gravRadius && md2 > 0) {
         const d = Math.sqrt(md2);
         const strength = (1 - d / gravRadius) * 0.15;
         x2 += mdx * strength;
         y2 += mdy * strength;
       }
     }

     // Glow falloff: a wide, faint pass first so quiet bars still shimmer
     ctx.strokeStyle = `rgba(${barColor.r}, ${barColor.g}, ${barColor.b}, ${Math.max(0, 0.08 + value * 0.16)})`;
     ctx.lineWidth = 5;
     ctx.beginPath();
     ctx.moveTo(x1, y1);
     ctx.lineTo(x2, y2);
     ctx.stroke();

     // Core pass: crisp bright line
     ctx.strokeStyle = `rgba(${barColor.r}, ${barColor.g}, ${barColor.b}, ${Math.max(0.15, Math.min(1, 0.55 + value * 0.95))})`;
     ctx.lineWidth = 2.2;
     ctx.beginPath();
     ctx.moveTo(x1, y1);
     ctx.lineTo(x2, y2);
     ctx.stroke();
   }
   ctx.globalAlpha = 1;

   // 5. Cursor gravitational lens glow (only near the ring, subtle, crimson)
  if (cursorSeen) {
    const mouseCX = cursorNX * audioCanvas.width;
    const mouseCY = cursorNY * audioCanvas.height;
    if (Math.hypot(mouseCX - cx, mouseCY - cy) < Math.min(audioCanvas.width, audioCanvas.height) * 0.45) {
      const glowR = 28 + bassAvg * 46;
      const glow = ctx.createRadialGradient(mouseCX, mouseCY, 0, mouseCX, mouseCY, glowR);
      glow.addColorStop(0, 'rgba(255, 77, 85, 0.10)');
      glow.addColorStop(1, 'rgba(255, 77, 85, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mouseCX, mouseCY, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

   // 6. Ambient energy halo around Kurisu â€ two counter-rotating red/pink
   //    dashed rings that swell and brighten with bass (cheap: 2 stroked arcs).
  const haloR = Math.min(audioCanvas.width, audioCanvas.height) * (0.30 + bassAvg * 0.03);
  const spin = now * 0.00015;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 14]);
  ctx.strokeStyle = `rgba(255, 77, 85, ${(0.05 + bassAvg * 0.18).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, spin, spin + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([18, 6]);
  ctx.strokeStyle = `rgba(255, 85, 170, ${(0.04 + bassAvg * 0.14).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR * 0.9, -spin * 1.6, -spin * 1.6 + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// --- CLOCKWORK MECHANICAL BACKGROUND COMPONENT ---
let gearAngle = 0;

function drawGear(ctx, x, y, radius, teeth, angle, strokeColor) {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.0;
  
  ctx.translate(x, y);
  ctx.rotate(angle);
  
  // Gear body circles
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.stroke();

  // Spokes
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const spokeAngle = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(spokeAngle) * 8, Math.sin(spokeAngle) * 8);
    ctx.lineTo(Math.cos(spokeAngle) * radius * 0.9, Math.sin(spokeAngle) * radius * 0.9);
    ctx.stroke();
  }
  
  // Teeth
  const toothWidth = (Math.PI * 2) / teeth / 2;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const curAngle = (i / teeth) * Math.PI * 2;
    const a1 = curAngle - toothWidth / 2;
    const a2 = curAngle + toothWidth / 2;
    const a3 = curAngle + toothWidth * 1.5;
    
    ctx.lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
    ctx.lineTo(Math.cos(a1) * (radius * 1.08), Math.sin(a1) * (radius * 1.08));
    ctx.lineTo(Math.cos(a2) * (radius * 1.08), Math.sin(a2) * (radius * 1.08));
    ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
    ctx.lineTo(Math.cos(a3) * radius, Math.sin(a3) * radius);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawCoordinateDial(ctx, x, y, radius, ticks, angle, strokeColor) {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.0;
  
  ctx.translate(x, y);
  ctx.rotate(angle);
  
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(0, 0, radius - 15, 0, Math.PI * 2);
  ctx.stroke();
  
  // Draw small coordinate ticks
  for (let i = 0; i < ticks; i++) {
    const tickAngle = (i / ticks) * Math.PI * 2;
    const len = i % 4 === 0 ? 10 : 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(tickAngle) * (radius - 15), Math.sin(tickAngle) * (radius - 15));
    ctx.lineTo(Math.cos(tickAngle) * (radius - 15 + len), Math.sin(tickAngle) * (radius - 15 + len));
    ctx.stroke();
  }
  ctx.restore();
}

// Draw the mechanical gears into an offscreen canvas so they can be reused
// across frames without re-rasterizing every visual update.
function buildGearSnapshot(cx, cy, bass) {
  if (!audioCanvas) return;
  if (!gearSnapshot) {
    gearSnapshot = document.createElement('canvas');
    gearSnapshot.width = audioCanvas.width;
    gearSnapshot.height = audioCanvas.height;
  }
  const gctx = gearSnapshot.getContext('2d');
  gctx.clearRect(0, 0, gearSnapshot.width, gearSnapshot.height);
  drawClockworkBackground(gctx, cx, cy, bass);
}

function drawClockworkBackground(ctx, cx, cy, bass) {
  // Update rotation angle (scales with music bass)
  const baseRotationSpeed = 0.0012;
  gearAngle += baseRotationSpeed + (bass * 0.0035);
  
  const scale = 1.0 + (bass * 0.04);
  const strokeColor = `rgba(255, 77, 85, ${0.07 + bass * 0.05})`;
  const lineStroke = `rgba(255, 77, 85, 0.035)`;
  
  // Layout coordinates of gears/dials matching retro mechanical diagram in image
  const centers = [
    { x: cx - 400, y: cy - 120, r: 130, teeth: 36, speedMult: 1.0 },
    { x: cx - 580, y: cy - 120, r: 50, teeth: 14, speedMult: -2.57 },  // meshed with center 0
    { x: cx + 450, y: cy + 150, r: 150, teeth: 40, speedMult: -0.7 },
    { x: cx + 230, y: cy + 150, r: 70, teeth: 18, speedMult: 1.55 },   // meshed with center 2
    { x: cx - 250, y: cy + 220, r: 90, teeth: 24, speedMult: -1.2 },
    { x: cx + 380, y: cy - 200, r: 110, teeth: 28, speedMult: 1.4 }
  ];
  
  ctx.save();
  
  // 1. Draw background diagram linkage lines
  ctx.strokeStyle = lineStroke;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const dist = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
      if (dist < 550) {
        ctx.moveTo(centers[i].x, centers[i].y);
        ctx.lineTo(centers[j].x, centers[j].y);
      }
    }
    // Draw links to visualizer center
    ctx.moveTo(centers[i].x, centers[i].y);
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Dotted secondary rings
   ctx.strokeStyle = `rgba(255, 77, 85, 0.015)`;
  for (let i = 0; i < centers.length; i++) {
    ctx.beginPath();
    ctx.arc(centers[i].x, centers[i].y, centers[i].r * 1.4, 0, Math.PI * 2);
    ctx.setLineDash([4, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  ctx.restore();

  // 2. Draw rotating gears and dials
  centers.forEach((c) => {
    const activeRadius = c.r * scale;
    const currentAngle = gearAngle * c.speedMult;
    
    // Draw mechanical gear
    drawGear(ctx, c.x, c.y, activeRadius, c.teeth, currentAngle, strokeColor);
    
    // Draw outer coordinate dial ticks overlay
    if (c.r > 80) {
      drawCoordinateDial(ctx, c.x, c.y, activeRadius * 1.22, 24, -currentAngle * 0.35, strokeColor);
    }
  });
}

// --- LIVE NEWS FEED (HACKER NEWS API INTEGRATION) ---
const simulatedNewsPool = [
  { title: "Bitcoin consolidates near local levels as trading indicators shift", url: "https://tradingview.com", score: 320, time: Date.now()/1000 - 3600 },
  { title: "New WebGL standard promises ultra-low CPU memory footprint for widgets", url: "https://github.com", score: 185, time: Date.now()/1000 - 7200 },
  { title: "Obsidian visual graphs: Mapping neural nodes for cognitive research", url: "https://obsidian.md", score: 412, time: Date.now()/1000 - 12000 },
  { title: "Lively Wallpaper v3 updates hardware metrics collection efficiency", url: "https://livelywallpaper.io", score: 98, time: Date.now()/1000 - 18000 },
  { title: "Makise Kurisu Live2D model physics improvements completed", url: "https://live2d.com", score: 256, time: Date.now()/1000 - 24000 },
  { title: "Google Sheets sync limits bypassed with parallel cache fetching", url: "https://sheets.google.com", score: 140, time: Date.now()/1000 - 30000 }
];

function getDomain(url) {
  if (!url) return 'self';
  try {
    const domain = new URL(url).hostname;
    return domain.startsWith('www.') ? domain.substring(4) : domain;
  } catch (e) {
    return 'external';
  }
}

function timeSince(timestamp) {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  if (seconds < 0) return "0s"; // guard against clock skew / future timestamps
  let interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + "h";
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + "m";
  }
  return Math.floor(seconds) + "s";
}

// News-aware reactions: the feed stories get classified so Kurisu can comment
// on the ones that fit her obsessions (science, tech, world-line drama).
function classifyNewsTitle(title) {
  const t = (title || '').toLowerCase();
  if (/\b(ai|llm|model|research|science|space|quantum|physics|biology|neural|study|paper|theory)\b/.test(t)) return 'science';
  if (/\b(law|sue|lawsuit|protest|controvers|war|attack|ban|banned|scandal|crash|hack|breach|leak)\b/.test(t)) return 'drama';
  if (/\b(web|browser|linux|kernel|gpu|cpu|rust|javascript|typescript|sdk|api|framework|cloud|server|startup|funding)\b/.test(t)) return 'tech';
  return 'default';
}

let lastNewsReactionAt = 0;

// Occasionally (not on every refresh) she remarks on the feed. Gated the same
// way as idle chatter: never while typing, idle, or asleep.
function reactToNews(stories) {
  if (SETTINGS.features.newsReactions === false) return; // toggled off
  const now = performance.now();
  if (now - lastNewsReactionAt < 20 * 60 * 1000) return; // ~3 comments/hour max
  if (isIdle || isSleeping || kurisuInput || !kurisuBubbleEl) return;
  if (kurisuBubbleEl.classList.contains('visible')) return;
  if (Math.random() > 0.5) return; // about half the refreshes earn a remark

  const candidates = (stories || []).filter(s => s && s.title);
  if (!candidates.length) return;

  // Prefer a story in her wheelhouse (science first, then tech/drama).
  let target = candidates.find(s => classifyNewsTitle(s.title) === 'science')
            || candidates.find(s => classifyNewsTitle(s.title) === 'tech')
            || candidates.find(s => classifyNewsTitle(s.title) === 'drama');
  if (!target) target = candidates[Math.floor(Math.random() * Math.min(candidates.length, 3))];

  lastNewsReactionAt = now;
  const kind = classifyNewsTitle(target.title);
  const pool = KURISU_NEWS_LINES[kind] || KURISU_NEWS_LINES.default;
  const line = pool[Math.floor(Math.random() * pool.length)];
  showKurisuBubble(line, 7000);
  appendChatEntry('assistant', line, 'news');
  if (live2DController && live2DController.setEmotion) {
    live2DController.setEmotion(kind === 'science' ? 'thinking' : 'curious', 5000);
  }
}

// Fetch with a hard timeout so a hung API can never block the news feed.
async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRealtimeNews() {
  const container = document.getElementById('news-feed');
  const statusEl = document.getElementById('news-status');
  if (!container || !statusEl) return;

  try {
    // 1. Fetch top Hacker News stories
    const topStoriesRes = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!topStoriesRes.ok) throw new Error("HN Fetch Failed");
    
    const storyIds = await topStoriesRes.json();
    const targetStories = storyIds.slice(0, 6); // Take first 6 stories
    
    // 2. Fetch details for each story in parallel. allSettled so one failed or
    // malformed story can't drop the whole feed into fallback mode.
    const storyPromises = targetStories.map(async (id) => {
      try {
        const detailRes = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 5000);
        if (!detailRes.ok) return null;
        return await detailRes.json();
      } catch (e) {
        return null;
      }
    });
    
    const results = await Promise.allSettled(storyPromises);
    const stories = results.map(r => r.status === 'fulfilled' ? r.value : null);
    if (!stories.some(Boolean)) throw new Error('No stories fetched');
    
    // Clear loading state
    container.innerHTML = '';
    statusEl.innerText = 'LIVE_SYNC';
    statusEl.className = 'pulse-text';

    // Render items
    stories.forEach(story => {
      if (!story || !story.title) return;
      
      const item = document.createElement('a');
      item.className = 'news-item';
      item.href = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
      item.target = '_blank';
      
      const titleDiv = document.createElement('div');
      titleDiv.className = 'news-title';
      titleDiv.innerText = story.title;
      
      const metaDiv = document.createElement('div');
      metaDiv.className = 'news-meta';
      
      const domain = getDomain(story.url);
      metaDiv.innerHTML = `
        <span class="news-score">▲ ${story.score || 0} pts</span>
        <span class="news-time">posted ${timeSince(story.time)} ago</span>
        <span class="news-domain">[ ${domain} ]</span>
      `;
      
      item.appendChild(titleDiv);
      item.appendChild(metaDiv);
      container.appendChild(item);
    });

    reactToNews(stories);
    lastNewsStories = stories.filter(Boolean);

  } catch (err) {
    console.warn("AMADEUS News Sync: API offline, falling back to simulated pool.", err);
    renderFallbackNews(container, statusEl);
  }
}

function renderFallbackNews(container, statusEl) {
  container.innerHTML = '';
  statusEl.innerText = 'STANDALONE_SYNC';
  statusEl.className = 'pulse-text';
  
  simulatedNewsPool.forEach(story => {
    const item = document.createElement('a');
    item.className = 'news-item';
    item.href = story.url;
    item.target = '_blank';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'news-title';
    titleDiv.innerText = story.title;
    
    const metaDiv = document.createElement('div');
    metaDiv.className = 'news-meta';
    
    metaDiv.innerHTML = `
      <span class="news-score">▲ ${story.score} pts</span>
      <span class="news-time">posted ${timeSince(story.time)} ago</span>
      <span class="news-domain">[ ${getDomain(story.url)} ]</span>
    `;
    
    item.appendChild(titleDiv);
    item.appendChild(metaDiv);
    container.appendChild(item);
  });

  reactToNews(simulatedNewsPool);
  lastNewsStories = simulatedNewsPool.slice();
}

// Refresh news feed every 15 minutes (skipped while Lively is paused)
setInterval(() => {
  if (!isLivelyPaused) fetchRealtimeNews();
}, 15 * 60 * 1000);

// --- L2D DEBUG OVERLAY (Ctrl+Shift+D) ---
// Dev-only diagnostics: streams the controller's live parameter state and
// draws the cheek-poke hit zone over the canvas, so the blind-tuned constants
// (pupil map, blend layers, easter eggs, poke zone) can be verified against
// the running model. No-op when the controller isn't loaded.
let debugOverlayEl = null;
let debugOverlayRowsEl = null;
let debugOverlayTimer = null;
let debugZoneEl = null;

function initDebugOverlay() {
  debugOverlayEl = document.getElementById('l2d-debug');
  if (!debugOverlayEl) return;
  debugOverlayRowsEl = document.getElementById('l2d-debug-rows');
  debugZoneEl = document.getElementById('l2d-debug-zone');
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyD' || e.code === 'KeyE')) {
      e.preventDefault();
      toggleDebugOverlay();
    }
  });
}

function toggleDebugOverlay() {
  if (!debugOverlayEl) return;
  const show = debugOverlayEl.hidden;
  debugOverlayEl.hidden = !show;
  if (debugZoneEl) debugZoneEl.style.display = show ? 'block' : 'none';
  if (show) {
    refreshDebugOverlay();
    if (!debugOverlayTimer) debugOverlayTimer = setInterval(refreshDebugOverlay, 250);
  } else if (debugOverlayTimer) {
    clearInterval(debugOverlayTimer);
    debugOverlayTimer = null;
  }
}

function refreshDebugOverlay() {
  if (!debugOverlayRowsEl || !live2DController || !live2DController.debugState) return;
  const s = live2DController.debugState();

  const p = s.params || {};
  const num = (v, d = '—') => (v === null || v === undefined) ? d : v;
  const rows = [
    ['emotion', s.emotion],
    ['mood', `${s.mood}/100`],
    ['time', `${s.hour}:00 · ${s.night ? 'night' : 'day'}`],
    ['proximity', num(s.proximity)],
    ['pupil', num(s.pupil)],
    ['blink', `${s.blinkPhase} ${num(s.blinkValue)}`],
    ['sleep', s.sleep],
    ['gestureArm', s.gestureArm ? 'on' : 'off'],
    ['egg', s.egg],
    ['param pupil', num(p.pupil)],
    ['param eyeOpen', num(p.eyeOpen)],
    ['param tongue/rage', `${num(p.tongue)} / ${num(p.rage)}`],
    ['param smile/sad', `${num(p.smile)} / ${num(p.sad)}`],
    ['param angry/surp/scared', `${num(p.angry)} / ${num(p.surprised)} / ${num(p.scared)}`],
    ['param bodyZ/X', `${num(p.bodyAngleZ)} / ${num(p.bodyAngleX)}`],
    ['param headZ/hands', `${num(p.headAngleZ)} / ${num(p.hands)}`],
  ];
  debugOverlayRowsEl.innerHTML = rows
    .map(([label, value]) =>
      `<div class="l2d-debug-row"><span>${label}</span><span class="l2d-debug-val">${value}</span></div>`)
    .join('');

  // Mirror the poke hit zone onto the canvas overlay (canvas pixel space).
  if (debugZoneEl) {
    const z = s.cheekZone;
    if (z) {
      debugZoneEl.style.left = z.x + 'px';
      debugZoneEl.style.top = z.y + 'px';
      debugZoneEl.style.width = z.w + 'px';
      debugZoneEl.style.height = z.h + 'px';
    }
  }
}

// --- BEAT PULSE ---
// Flashes a soft red bloom across the whole screen on the music's kick.
// Re-adding the class (after a forced reflow) restarts the CSS animation
// cleanly every beat; the timestamp gate keeps it under ~5 flashes/sec.
function triggerBeatPulse() {
  const now = performance.now();
  if (now - lastBeatAt < 200) return;
  lastBeatAt = now;
  // Same kick makes her body bob along (live2d_controller.triggerBeat)
  if (live2DController && live2DController.triggerBeat) live2DController.triggerBeat();
  if (!beatGlowEl) beatGlowEl = document.getElementById('beat-glow');
  if (beatGlowEl) {
    beatGlowEl.classList.remove('beat');
    void beatGlowEl.offsetWidth;
    beatGlowEl.classList.add('beat');
  }
  // Same kick drives the ambient dust field (scatter + shockwave ring).
  bgBeatPulse = 1;
}

// --- LIVELY WALLPAPER API HOOKS ---

// 1. System Audio Listener
// Called by Lively engine when music/system sound plays.
// NOTE: simulation mode calls handleAudioFrame() directly so isLivelyActive
// only flips when the real Lively runtime is present.
window.livelyAudioListener = function(audioArray) {
  isLivelyActive = true;
  handleAudioFrame(audioArray);
};

function handleAudioFrame(audioArray) {
  if (!audioArray || audioArray.length === 0) return;

  // Detect real audio energy for the idle watchdog
  let energy = 0;
  const sampleBins = Math.min(audioArray.length, 64);
  for (let i = 0; i < sampleBins; i++) {
    if (audioArray[i] > energy) energy = audioArray[i];
  }
  if (energy > ACTIVITY_ENERGY) markActivity();

  // When Lively pauses rendering, skip all visual + lip-sync work
  if (isLivelyPaused) return;

  // Average bass energy (feeds the scope, the cognitive core, and her emotion)
  let bassSum = 0;
  for (let i = 0; i < 8; i++) {
    bassSum += audioArray[i];
  }
  const bassVal = bassSum / 8;

  // Beat detection: a sharp rise in bass energy reads as a kick. The ratio +
  // absolute jump filters out steady/rolling bass, and the throttle in
  // triggerBeatPulse() stops double-fires on a single hit.
  if (bassVal > 0.14 && bassVal > lastBassLevel * 1.35 && bassVal - lastBassLevel > 0.05) {
    triggerBeatPulse();
  }
  lastBassLevel = bassVal;

  // Feed the world line interference map (updates on its own 15fps clock)
  worldLineEnergy = bassVal;
  lastAudioLevel = energy;
  // Keep the most recent FFT bins so the scope can draw a real waveform shape
  lastSpectrum = audioArray.slice(0, 48);

  // Calculate vocal range energy for lip-sync (bins 1-12)
  let vocalsSum = 0;
  const minBin = 1;
  const maxBin = 12;
  for (let i = minBin; i <= maxBin; i++) {
    vocalsSum += audioArray[i] || 0;
  }
  const vocalsAvg = vocalsSum / (maxBin - minBin + 1);

  // Feed the Live2D emotion engine so she reacts to the soundtrack in real time
  if (live2DController && live2DController.setAudioEnergy) {
    live2DController.setAudioEnergy(bassVal);
  }

  // Feed the music-aware mood: overall track loudness (not just bass) so she
  // visibly brightens on energetic tracks and calms on quiet ones. Skipped
  // while idle — there's no real audio to measure, and it saves a per-bin
  // scan on every audio frame — or when the feature is toggled off.
  if (!isIdle && (!SETTINGS || SETTINGS.features.musicMood !== false)) {
    let trackSum = 0;
    for (let i = 0; i < audioArray.length; i++) trackSum += audioArray[i] || 0;
    const trackVal = audioArray.length ? trackSum / audioArray.length : 0;
    if (live2DController && live2DController.setMusicEnergy) {
      live2DController.setMusicEnergy(trackVal);
    }
  }

  // Lip-Sync: Feed vocal frequency data to Kurisu's mouth animation
  if (live2DController && live2DController.setLipSync) {
    live2DController.setLipSync(vocalsAvg, audioArray, bassVal);
  }

  // Idle mode: skip heavy canvas redraws until real audio/mouse activity returns
  if (isIdle) return;
  // Skip the ring redraw entirely when the widget is hidden in settings
  if (document.body.classList.contains('hide-ring')) {
    if (ctx && audioCanvas) ctx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
    return;
  }

  // Heavy canvas redraws throttled to PERF.visualFps â€” lip-sync above stays live.
  const now = performance.now();
  if (now - lastVisualUpdate >= VISUAL_INTERVAL) {
    lastVisualUpdate = now;
    drawAudioRing(audioArray, now);
  }
}

// 2. Wallpaper playback pause/resume (--pause-event)
// Lively only pauses rendering; JS keeps running, so we stop our own heavy
// loops explicitly instead of wasting cycles drawing frames that aren't shown.
window.livelyWallpaperPlaybackChanged = function(data) {
  let obj = data;
  if (typeof data === 'string') {
    try { obj = JSON.parse(data); } catch (e) { return; }
  }
  if (!obj || typeof obj.IsPaused !== 'boolean') return;

  isLivelyPaused = obj.IsPaused;
  if (live2DController) {
    if (obj.IsPaused) {
      live2DController.pause();
      onUserAway();
    } else {
      live2DController.resume();
      markActivity();
      onUserReturn();
    }
  }
};

// 3. Now playing track (--system-nowplaying)
window.livelyCurrentTrack = function(data) {
  let obj = data;
  if (typeof data === 'string') {
    try { obj = JSON.parse(data); } catch (e) { return; }
  }

  const trackEl = document.getElementById('now-playing-track');
  const artistEl = document.getElementById('now-playing-artist');
  const albumEl = document.getElementById('bg-album');
  if (!trackEl) return;

  if (!obj || !obj.Title) {
    trackEl.innerText = 'AUDIO_FEED_IDLE';
    if (artistEl) artistEl.innerText = '';
    if (albumEl) {
      albumEl.classList.remove('visible');
      albumEl.style.backgroundImage = '';
    }
    return;
  }

  trackEl.innerText = obj.Title;
  if (artistEl) artistEl.innerText = obj.Artist ? `— ${obj.Artist}` : '';

  // Push the track art into the dim blurred backdrop (fades in via CSS)
  if (albumEl && obj.Thumbnail) {
    albumEl.style.backgroundImage = 'url(data:image/png;base64,' + obj.Thumbnail + ')';
    albumEl.classList.add('visible');
  } else if (albumEl) {
    albumEl.classList.remove('visible');
  }
};

// --- BROWSER SIMULATION ENGINE (STANDALONE / FALLBACK MODE) ---
function startBrowserSimulation() {
  // Simulate Audio Data stream for visualizer and mouth lip-sync
  const simulatedFFT = new Float32Array(128);
  
  function simulateAudioLoop() {
    if (isLivelyActive) return; // Stop if real events come in
    
    simulatedAudioTime += 0.07;
    
    for (let i = 0; i < 128; i++) {
      // Create fluctuating waves mimicking voices / ambient sound
      let val = Math.sin(simulatedAudioTime + i * 0.12) * 0.3 + 
                Math.sin(simulatedAudioTime * 0.4 + i * 0.04) * 0.2 + 
                Math.cos(simulatedAudioTime * 2.1 + i * 0.25) * 0.15 + 
                Math.random() * 0.08;
      
      val = Math.max(0, val);
      
      // Add simulated periodic "speech spikes" to make Kurisu talk and close mouth naturally
      const speechEnvelope = Math.max(0, Math.sin(simulatedAudioTime * 0.3) * 0.8 + 0.2);
      if (i >= 1 && i <= 12) {
        val *= speechEnvelope;
      }
      
      simulatedFFT[i] = val;
    }
    
    // Call the shared frame handler directly so isLivelyActive stays false
    handleAudioFrame(simulatedFFT);
    requestAnimationFrame(simulateAudioLoop);
  }
  
  simulateAudioLoop();
}
