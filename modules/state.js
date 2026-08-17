// modules/state.js - AMADEUS Unified State & Shared Configuration
window.AMADEUS = window.AMADEUS || {};

(function() {
  // Global AMADEUS runtime state
  const state = {
    live2DController: null,
    isLivelyActive: false,
    isLivelyPaused: false,
    isIdle: false,
    isSleeping: false,
    isUserAway: false,
    userAwaySince: 0,
    lastPeekAt: 0,
    peekReadyAt: performance.now() + 3000,
    desktopSessionAt: performance.now(),
    lastActivityTime: performance.now(),

    // Cursor tracking
    cursorNX: 0.5,
    cursorNY: 0.5,
    cursorSeen: false,

    // Audio & Spectrum
    worldLineEnergy: 0,
    lastAudioLevel: 0,
    lastBassLevel: 0,
    lastBeatAt: 0,
    bgBeatPulse: 0,
    mindEnergy: 0.3,
    lastSpectrum: new Array(48).fill(0),
    smoothSpec: new Array(48).fill(0),
    peakSpec: new Array(48).fill(0),
    peakFalloff: 0.86,
    audioEnv: 0,
    wlPhase2: Math.random() * Math.PI * 2,
    mindBaseline: 0,

    // Mood & Emotion
    mood: 55,
    moodLastAdjustAt: 0,

    // Chat
    kurisuInput: '',
    kurisuHistory: [],
    chatLog: [],
    kurisuReplying: false,
    kurisuGreeted: false,
    kurisuHintShown: false,
  };

  // Performance Profile
  const PERF = {
    dpr: Math.min(window.devicePixelRatio || 1, 1.0),
    visualFps: 30,
    gearFps: 10
  };

  const PERF_LEVELS = [
    { dpr: 0.5,  visualFps: 20, scopeStep: 5, ringBars: 32 },
    { dpr: 0.75, visualFps: 30, scopeStep: 3, ringBars: 48 },
    { dpr: 1.0,  visualFps: 40, scopeStep: 2, ringBars: 64 },
  ];

  let perfLevel = PERF_LEVELS.length - 1;

  // Settings schema & defaults
  const SETTINGS_KEY = 'amadeus.settings';
  const SETTINGS_DEFAULTS = {
    widgets: { scope: true, news: true, clock: true, ring: true, crt: true, chat: true, bg: true },
    scope: { speed: 5, density: 5, ch1: '#ff4d55', ch2: '#ff55aa' },
    pet: false,
    voice: true,
    sfx: true,
    features: {
      idleGestures: true,
      ambientMotions: true,
      easterEggs: true,
      newsReactions: true,
      musicMood: true,
      postureFatigue: true,
    },
  };

  window.AMADEUS.state = state;
  window.AMADEUS.PERF = PERF;
  window.AMADEUS.PERF_LEVELS = PERF_LEVELS;
  window.AMADEUS.getPerfLevel = () => perfLevel;
  window.AMADEUS.setPerfLevel = (lvl) => { perfLevel = lvl; };
  window.AMADEUS.SETTINGS_KEY = SETTINGS_KEY;
  window.AMADEUS.SETTINGS_DEFAULTS = SETTINGS_DEFAULTS;
})();
