// modules/state.js - AMADEUS Unified State & Shared Configuration
window.AMADEUS = window.AMADEUS || {};

(function() {
  // Global AMADEUS runtime state
  const state: AMADEUS.State = {
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

    // Environment & Weather
    weather: null,

    // Chat
    kurisuInput: '',
    kurisuHistory: [],
    chatLog: [],
    kurisuReplying: false,
    kurisuGreeted: false,
    kurisuHintShown: false,

    // True once the user picks a perf level from the Lively settings slider —
    // the FPS auto-governor in power.js then stops auto-adjusting.
    perfLevelManual: false,
  };

  // Shared HTML escaping utility — prevents XSS in any innerHTML construction
  function escapeHtml(str: string): string {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  // Performance Profile
  const MAX_DPR = 1.5;
  const PERF = {
    dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    visualFps: 30,
    gearFps: 10
  };

  const PERF_LEVELS: AMADEUS.PerfLevel[] = [
    { dpr: 0.5,  visualFps: 15, scopeStep: 5, ringBars: 32 },
    { dpr: 0.75, visualFps: 20, scopeStep: 3, ringBars: 48 },
    { dpr: 1.0,  visualFps: 30, scopeStep: 2, ringBars: 64 },
  ];

  let perfLevel = PERF_LEVELS.length - 1;

  // Master ticker: single RAF source for all visual / governor / simulation
  // updates. Modules subscribe via onMasterTick(callback). The ticker runs
  // uncapped so the perf governor can measure true frame rate.
  let _masterCallbacks: ((now: number) => void)[] = [];
  let _masterRafId: number | null = null;

  function _masterTick(now: number) {
    const callbacks = [..._masterCallbacks];
    if (callbacks.length === 0) {
      _masterRafId = null;
      return;
    }
    _masterRafId = requestAnimationFrame(_masterTick);
    for (let i = 0; i < callbacks.length; i++) {
      try { callbacks[i](now); } catch (e) { /* ignore */ }
    }
  }

  function startMasterTicker() {
    if (_masterRafId) return;
    _masterRafId = requestAnimationFrame(_masterTick);
  }

  function onMasterTick(cb: (now: number) => void): (now: number) => void {
    _masterCallbacks.push(cb);
    if (!_masterRafId) startMasterTicker();
    return cb;
  }

  function offMasterTick(cb: (now: number) => void) {
    const idx = _masterCallbacks.indexOf(cb);
    if (idx >= 0) _masterCallbacks.splice(idx, 1);
  }

  // Settings schema & defaults (deep frozen to protect default invariants)
  const SETTINGS_KEY = 'amadeus.settings';
  const SETTINGS_DEFAULTS: AMADEUS.Settings = {
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

  function deepFreeze(obj: any): any {
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(key => {
        if (obj[key] && typeof obj[key] === 'object') deepFreeze(obj[key]);
      });
      Object.freeze(obj);
    }
    return obj;
  }
  deepFreeze(SETTINGS_DEFAULTS);

  // Centralized Second Brain Endpoint & Network Utilities
  const brainClient = {
    getHttpUrl(path = '') {
      const chat = window.AMADEUS.chat;
      const base = (chat && chat.KURISU_BRAIN && chat.KURISU_BRAIN.endpoint) || 'http://127.0.0.1:8000';
      const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
      return `${base.replace(/\/+$/, '')}${cleanPath}`;
    },
    getWsUrl(path = '') {
      const http = this.getHttpUrl(path);
      if (http.startsWith('https://')) return http.replace('https://', 'wss://');
      if (http.startsWith('http://')) return http.replace('http://', 'ws://');
      return http.startsWith('ws') ? http : `ws://${http}`;
    },
    getApiKey(): string {
      const chat = window.AMADEUS.chat;
      return (chat && chat.KURISU_BRAIN && chat.KURISU_BRAIN.apiKey) ||
        (typeof window !== 'undefined' && window.KURISU_BRAIN_KEY && !window.KURISU_BRAIN_KEY.includes('REPLACE') ? window.KURISU_BRAIN_KEY : '');
    },
    getHeaders(extra = {}) {
      const headers = { 'Content-Type': 'application/json', ...extra };
      const key = this.getApiKey();
      if (key) headers['Authorization'] = `Bearer ${key}`;
      return headers;
    },
  };

  // WebSocket liveness helper: sends keep-alive pings on an interval and closes
  // the socket when no traffic of ANY kind has been seen for staleMs, so
  // half-open connections surface as onclose -> reconnect instead of silently
  // stale status. Any inbound frame (data or pong) resets the staleness clock.
  function createWsHeartbeat(ws: WebSocket, opts: { intervalMs?: number; staleMs?: number } = {}): { start: () => void; stop: () => void; touch: () => void } {
    const o = opts || {};
    const intervalMs = o.intervalMs || 25000;
    const staleMs = o.staleMs || 90000;
    let timer: number | null = null;
    let lastSeen = Date.now();

    function touch() { lastSeen = Date.now(); }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function start() {
      stop();
      lastSeen = Date.now();
      timer = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastSeen > staleMs) {
          try { ws.close(); } catch (e) { /* onclose handles reconnect */ }
          return;
        }
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* ignore */ }
      }, intervalMs);
    }

    return { start, stop, touch };
  }

  // Shared chat persistence limits — single source of truth for chat-api.js
  // and chat-history.js (each module is a separate classic-script IIFE scope,
  // so these constants must live on window.AMADEUS to be shared).
  const CHAT_LIMITS = Object.freeze({
    KURISU_HISTORY_MAX: 12,
    CHAT_LOG_MAX: 60,
  });

  /**
   * AMADEUS shared runtime state & platform helpers. Exports:
   * - `state`          mutable runtime state (cursor, audio, mood, chat, sleep flags)
   * - `PERF` / `PERF_LEVELS` / `getPerfLevel` / `setPerfLevel` — perf profile plumbing
   * - `SETTINGS_KEY` / `SETTINGS_DEFAULTS` (deep-frozen schema defaults)
   * - `brainClient`    centralized Brain endpoint/key/headers helper
   *   - `getHttpUrl(path)` — absolute Brain HTTP URL with normalized slashes
   *   - `getWsUrl(path)`   — ws:// / wss:// equivalent of the HTTP URL
   *   - `getApiKey()` / `getHeaders(extra)` — auth plumbing
   * - `onMasterTick(cb)` / `offMasterTick(cb)` / `startMasterTicker` — the single
   *   requestAnimationFrame source; all visual subsystems subscribe here
   * - `createWsHeartbeat(ws, opts)` — keep-alive pings + staleness close for
   *   WebSocket clients ({intervalMs=25000, staleMs=90000}) → {start, stop, touch}
   */
  window.AMADEUS.state = state;
  window.AMADEUS.PERF = PERF;
  window.AMADEUS.PERF_LEVELS = PERF_LEVELS;
  window.AMADEUS.MAX_DPR = MAX_DPR;
  window.AMADEUS.escapeHtml = escapeHtml;
  window.AMADEUS.chat = window.AMADEUS.chat || {};
  window.AMADEUS.getPerfLevel = () => perfLevel;
  window.AMADEUS.setPerfLevel = (lvl) => { perfLevel = lvl; };
  window.AMADEUS.SETTINGS_KEY = SETTINGS_KEY;
  window.AMADEUS.SETTINGS_DEFAULTS = SETTINGS_DEFAULTS;
  window.AMADEUS.CHAT_LIMITS = CHAT_LIMITS;
  window.AMADEUS.brainClient = brainClient;
  window.AMADEUS.createWsHeartbeat = createWsHeartbeat;
  window.AMADEUS.startMasterTicker = startMasterTicker;
  window.AMADEUS.onMasterTick = onMasterTick;
  window.AMADEUS.offMasterTick = offMasterTick;
})();
