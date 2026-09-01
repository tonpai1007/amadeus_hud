// modules/state.js - AMADEUS Unified State & Shared Configuration
window.AMADEUS = window.AMADEUS || ({} as any);

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
      postureFatigue: true, focusMode: true,
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
    let timer: ReturnType<typeof setInterval> | null = null;
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

  // ---------------------------------------------------------------------------
  // Network health indicator. Modules that talk to the internet (weather,
  // news, brain uplink) report success/failure here; after repeated failures
  // the clock panel's #hud-uplink alert flips to "UPLINK: OFFLINE" so a dead
  // connection is visible on the HUD instead of being console-warn only.
  const NET_FAIL_THRESHOLD = 2;
  // Per-source connectivity. 'web' = public internet (weather/news fetches),
  // 'brain' = local AMADEUS brain WebSocket. The HUD line shows OFFLINE only
  // when every known source is down; a mixed state shows DEGRADED.
  const _netSources: Record<string, { online: boolean; failures: number; offlineSince: number; detail: string }> = {
    web: { online: true, failures: 0, offlineSince: 0, detail: '' },
  };

  function renderUplinkStatus(): void {
    const el = document.getElementById('hud-uplink');
    if (!el) return;
    const names = Object.keys(_netSources);
    const allOnline = names.every((n) => _netSources[n].online);
    const allOffline = names.every((n) => !_netSources[n].online);
    const detail = names.map((n) => _netSources[n].detail).filter(Boolean)[0] || '';
    // Rebuild the alert line (static string, no user data — safe as innerHTML)
    // so the decorative bullet span survives the text swap.
    el.innerHTML = '<span class="bullet" aria-hidden="true"></span> UPLINK: ' +
      (allOnline ? 'LIVE_FEED' : allOffline ? 'OFFLINE' : 'DEGRADED') +
      (!allOnline && detail ? ' (' + detail + ')' : '');
    el.classList.toggle('status-live', allOnline);
    el.classList.toggle('status-offline', allOffline);
  }

  function setNetSource(name: string, online: boolean, opts?: { immediate?: boolean; detail?: string }): void {
    const src = _netSources[name] || (_netSources[name] = { online: true, failures: 0, offlineSince: 0, detail: '' });
    const immediate = !!(opts && opts.immediate);
    const detail = opts ? opts.detail : undefined;
    if (online) {
      src.failures = 0; src.offlineSince = 0; src.detail = '';
      if (src.online) return;
      src.online = true;
      console.log('[AMADEUS] Net source "' + name + '" restored.');
      renderUplinkStatus();
      return;
    }
    const wasOnline = src.online;
    const detailChanged = detail !== undefined && detail !== src.detail;
    if (detail !== undefined) src.detail = detail;
    if (wasOnline) src.offlineSince = Date.now();
    src.failures++;
    // Definitive offline events (e.g. WebSocket close) flip immediately;
    // polled web fetches need repeated failures so one hiccup never flickers.
    const flip = wasOnline && (immediate || src.failures >= NET_FAIL_THRESHOLD);
    if (flip) {
      src.online = false;
      console.warn('[AMADEUS] Net source "' + name + '" offline.');
    }
    if (!flip && !detailChanged) return;
    renderUplinkStatus();
  }

  function reportNetSuccess(): void { setNetSource('web', true); }
  function reportNetFailure(): void { setNetSource('web', false); }

  function isNetOnline(): boolean {
    const names = Object.keys(_netSources);
    return names.every((n) => _netSources[n].online);
  }

  // ---------------------------------------------------------------------------
  // Cross-restart line dedup for canned chatter. Keeps a small ring of recently
  // used lines per key in localStorage so Kurisu doesn't repeat the same quip
  // across sessions.
  const SEEN_LINES_KEY = 'amadeus.seenLines';
  const SEEN_LINES_MAX = 12;

  function pickFreshLine(key: string, pool: string[]): string {
    if (!Array.isArray(pool) || pool.length === 0) return '';
    if (pool.length === 1) return pool[0];
    let seen: string[] = [];
    try {
      const raw = localStorage.getItem(SEEN_LINES_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any)[key])) {
        seen = (parsed as any)[key];
      }
    } catch (e) { /* ignore */ }
    // Prefer unseen lines; only when the whole pool has been seen recently
    // (ring saturation) fall back to the full pool, but never immediately
    // repeat the most recent line.
    const unseen = pool.filter((l) => seen.indexOf(l) === -1);
    let source = unseen;
    if (source.length === 0) {
      const last = seen[seen.length - 1];
      source = pool.filter((l) => l !== last);
      if (source.length === 0) source = pool;
    }
    const pick = source[Math.floor(Math.random() * source.length)];
    seen = seen.filter((l) => l !== pick);
    seen.push(pick);
    while (seen.length > SEEN_LINES_MAX) seen.shift();
    try {
      let blob: Record<string, string[]> = {};
      const raw2 = localStorage.getItem(SEEN_LINES_KEY);
      if (raw2) {
        const p = JSON.parse(raw2);
        if (p && typeof p === 'object') blob = p;
      }
      blob[key] = seen;
      localStorage.setItem(SEEN_LINES_KEY, JSON.stringify(blob));
    } catch (e) { /* ignore */ }
    return pick;
  }

  // ---------------------------------------------------------------------------
  // Quota-safe localStorage write. On QuotaExceededError, evicts the oldest
  // optional cache entries (chat log, chat history, news cache) once and
  // retries; if it still fails, surfaces a one-time bubble instead of silently
  // dropping writes forever.
  const EVICTABLE_STORAGE_KEYS = [
    'amadeus.chatLog',
    'amadeus.kurisuHistory',
    'amadeus.news.cache',
  ];
  let _quotaWarned = false;

  function safeSetItem(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e: any) {
      const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String(e.message || '')));
      if (!quota) return false;
      console.warn('[AMADEUS] localStorage quota exceeded — trimming old caches once.', e);
      // Drop the in-memory chat state too so a later pagehide flush doesn't
      // immediately re-overflow the quota.
      try {
        EVICTABLE_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
        state.chatLog = state.chatLog.slice(-10);
        localStorage.setItem(key, value);
      } catch (e2) {
        if (!_quotaWarned) {
          _quotaWarned = true;
          try {
            if (window.AMADEUS.bubble && window.AMADEUS.bubble.showKurisuBubble) {
              window.AMADEUS.bubble.showKurisuBubble('Heads up — local storage is full. I had to trim the older chat records.', 7000, true);
            }
          } catch (e3) { /* ignore */ }
        }
        return false;
      }
      return true;
    }
  }


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
   * - `net` — per-source network health: reportNetSuccess()/reportNetFailure()
   *   track the public web (weather/news), setSource(name, online, {immediate,
   *   detail}) tracks other sources (e.g. the brain WebSocket). The clock
   *   panel's #hud-uplink alert shows LIVE_FEED / DEGRADED / OFFLINE;
   *   isNetOnline() is true only when every known source is online
   * - `safeSetItem(key, value)` — quota-safe localStorage write; trims old
   *   caches and retries on QuotaExceededError, warns via bubble once
   * - `pickFreshLine(key, pool)` — picks a line from a pool while avoiding the
   *   last ~12 used ones (persisted), so canned chatter never repeats across
   *   restarts
   */
  window.AMADEUS.state = state;
  window.AMADEUS.PERF = PERF;
  window.AMADEUS.PERF_LEVELS = PERF_LEVELS;
  window.AMADEUS.MAX_DPR = MAX_DPR;
  window.AMADEUS.escapeHtml = escapeHtml;
  window.AMADEUS.chat = window.AMADEUS.chat || ({} as any);
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
  window.AMADEUS.net = { reportNetSuccess, reportNetFailure, isNetOnline, setSource: setNetSource };
  window.AMADEUS.safeSetItem = safeSetItem;
  window.AMADEUS.pickFreshLine = pickFreshLine;
})();
