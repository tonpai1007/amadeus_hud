/// <reference path="./types/amadeus.d.ts" />
// wallpaper.js - AMADEUS Convergence Sync HUD Orchestrator (Modular Architecture)
// Coordinates audio visualizers, Live2D avatar, cognitive uplink, and Lively Wallpaper runtime.

window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  let lastVisualTick = 0;

  // --- LIVE2D CONTROLLER BOOTSTRAP ---
  async function initLive2D() {
    console.log("[L2D] Starting Live2D Controller setup...");
    const l2d = new (window.AMADEUS.Live2DController || Live2DController)('live2d-canvas', 'live2d/kurisu/Kurisu.model3.json');
    window.AMADEUS.state.live2DController = l2d;

    if (window.AMADEUS.settings && window.AMADEUS.settings.pushFeaturesToController) {
      window.AMADEUS.settings.pushFeaturesToController();
    }

    l2d.onInteract = (line) => {
      const s = window.AMADEUS.state;
      if (!line || (s && (s.isIdle || s.isSleeping))) return;
      if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuBubble(line, 5000);
      if (window.AMADEUS.chat) window.AMADEUS.chat.appendChatEntry('assistant', line, 'history');
    };

    l2d.onMood = (delta) => {
      if (typeof delta === 'number' && window.AMADEUS.mood) {
        window.AMADEUS.mood.adjustMood(delta);
      }
    };

    const success = await l2d.init();
    if (success) {
      console.log("[L2D] Live2D Kurisu avatar loaded successfully in HUD.");
    } else {
      console.error("[L2D] Live2D Kurisu failed to initialize.");
    }
    return success;
  }

  // --- SINGLE PHASE-LOCKED VISUAL LOOP WITH PHASE SCHEDULE ---
  function startVisualLoop() {
    lastVisualTick = 0;
    window.AMADEUS.onMasterTick(visualLoopTick);
  }

  function visualLoopTick(now) {
    const interval = 1000 / (window.AMADEUS.PERF ? window.AMADEUS.PERF.visualFps : 30);
    if (now - lastVisualTick < interval) return;
    lastVisualTick = now - ((now - lastVisualTick) % interval);

    const s = window.AMADEUS.state;
    if (s && s.isLivelyPaused) return;

    // Phase 0: Core Visual Telemetry & Background Render
    if (window.AMADEUS.oscilloscope) window.AMADEUS.oscilloscope.updateWorldLine();
    if (window.AMADEUS.background) window.AMADEUS.background.updateBackground();

    // Phase 1: Holographic Nixie Tube Divergence Meter
    if (window.AMADEUS.divergence && window.AMADEUS.divergence.renderDivergence) {
      window.AMADEUS.divergence.renderDivergence(now);
    }

    // Phase 2: Affective Emotion & Lighting Shader Tint
    if (s && !s.isIdle && !s.isLivelyPaused && window.AMADEUS.mood) {
      window.AMADEUS.mood.updateEmotionTint();
    }
  }

  // --- LOCALSTORAGE PAGEHIDE FLUSH ---
  function flushStorage() {
    if (window.AMADEUS.chat) {
      window.AMADEUS.chat.saveKurisuHistory();
      window.AMADEUS.chat.saveChatLog();
    }
    if (window.AMADEUS.mood) {
      window.AMADEUS.mood.saveMood();
    }
    if (window.AMADEUS.settings) {
      window.AMADEUS.settings.saveSettings();
    }
  }
  window.addEventListener('pagehide', flushStorage);

  // Tear down WebSocket uplinks on unload so no reconnect loop keeps firing
  // while the webview is being discarded.
  window.addEventListener('pagehide', () => {
    if (window.AMADEUS.uplink && window.AMADEUS.uplink.close) window.AMADEUS.uplink.close();
    if (window.AMADEUS.lively && window.AMADEUS.lively.closeTelemetryWebSocket) {
      window.AMADEUS.lively.closeTelemetryWebSocket();
    }
  });

  // --- INTERVAL REGISTRY FOR CLEANUP ---
  const _intervalIds = new Set<any>();
  const originalSetInterval = window.setInterval.bind(window);
  (window as any).setInterval = function(fn: any, ms?: number, ...args: any[]): any {
    const id = originalSetInterval(fn, ms, ...args);
    _intervalIds.add(id);
    return id;
  };
  const originalClearInterval = window.clearInterval.bind(window);
  (window as any).clearInterval = function(id?: any): void {
    _intervalIds.delete(id);
    originalClearInterval(id);
  };
  window.addEventListener('pagehide', () => {
    _intervalIds.forEach(id => originalClearInterval(id));
    _intervalIds.clear();
  });

  // --- MODULE HEALTH VALIDATION ---
  function validateModules() {
    const required = [
      ['AMADEUS.state', window.AMADEUS && window.AMADEUS.state],
      ['AMADEUS.chat', window.AMADEUS && window.AMADEUS.chat],
      ['AMADEUS.settings', window.AMADEUS && window.AMADEUS.settings],
      ['AMADEUS.power', window.AMADEUS && window.AMADEUS.power],
      ['AMADEUS.clock', window.AMADEUS && window.AMADEUS.clock],
      ['AMADEUS.bubble', window.AMADEUS && window.AMADEUS.bubble],
      ['AMADEUS.tts', window.AMADEUS && window.AMADEUS.tts],
      ['AMADEUS.news', window.AMADEUS && window.AMADEUS.news],
      ['AMADEUS.mood', window.AMADEUS && window.AMADEUS.mood],
      ['AMADEUS.uplink', window.AMADEUS && window.AMADEUS.uplink],
      ['AMADEUS.brainClient', window.AMADEUS && window.AMADEUS.brainClient],
      ['AMADEUS.net', window.AMADEUS && window.AMADEUS.net],
      ['AMADEUS.focus', window.AMADEUS && window.AMADEUS.focus],
    ];
    const missing = required.filter(([, val]) => !val).map(([name]) => name);
    if (missing.length > 0) {
      console.warn('[AMADEUS] Missing modules:', missing.join(', '));
    } else {
      console.log('[AMADEUS] All modules loaded.');
    }
  }

  // --- CRASH BANNER (global error surface) ---
  const CRASH_BANNER_REPEAT_MS = 60 * 1000;
  let _lastCrashBannerAt = 0;
  let _crashBannerTimer: ReturnType<typeof setTimeout> | null = null;

  function showCrashBanner(message?: string) {
    const now = Date.now();
    if (now - _lastCrashBannerAt < CRASH_BANNER_REPEAT_MS) return;
    _lastCrashBannerAt = now;
    let banner = document.getElementById('amadeus-crash-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'amadeus-crash-banner';
      banner.setAttribute('role', 'alert');
      banner.className = 'crash-banner';
      document.body.appendChild(banner);
    }
    // textContent only — error messages are untrusted
    banner.textContent = 'SYNC ERROR: ' + String(message || 'unknown').split('\n')[0].slice(0, 140);
    banner.classList.add('visible');
    if (_crashBannerTimer) clearTimeout(_crashBannerTimer);
    _crashBannerTimer = setTimeout(() => {
      if (banner) banner.classList.remove('visible');
      _crashBannerTimer = null;
    }, 10000);
  }

  // --- DOM BOOTSTRAP ---
  window.addEventListener('DOMContentLoaded', () => {
    const safeInit = (name, fn) => {
      try {
        const res = fn();
        if (res && typeof res.catch === 'function') {
          res.catch((err) => console.error(`[AMADEUS] async ${name} error:`, err));
        }
      } catch (err) {
        console.error(`[AMADEUS] ${name} error:`, err);
      }
    };

    // Global safety net: log any unhandled promise rejections from bootstrap modules
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[AMADEUS] Unhandled rejection:', event.reason);
      showCrashBanner(event && event.reason && (event.reason.message || String(event.reason)));
    });

    // Global error net: surface hard errors as a small HUD banner instead of
    // leaving a silent black wallpaper. Rate-limited, auto-dismissing.
    window.addEventListener('error', (event) => {
      showCrashBanner(event && (event.message || (event.error && event.error.message)));
    });

    const s = window.AMADEUS.state;
    const clock = window.AMADEUS.clock;
    const audioRing = window.AMADEUS.audioRing;
    const osc = window.AMADEUS.oscilloscope;
    const bg = window.AMADEUS.background;
    const news = window.AMADEUS.news;
    const chat = window.AMADEUS.chat;
    const bubble = window.AMADEUS.bubble;
    const tts = window.AMADEUS.tts;
    const settings = window.AMADEUS.settings;
    const power = window.AMADEUS.power;
    const lively = window.AMADEUS.lively;
    const mood = window.AMADEUS.mood;

    const weather = window.AMADEUS.weather;
    const divergence = window.AMADEUS.divergence;

    if (clock) {
      safeInit('applyTaskbarClearance', clock.applyTaskbarClearance);
      setTimeout(() => safeInit('applyTaskbarClearance(deferred)', clock.applyTaskbarClearance), 500);
      safeInit('initClock', clock.initClock);
    }

    if (weather) safeInit('initWeather', weather.initWeather);
    if (divergence) safeInit('initDivergence', divergence.initDivergence);
    if (audioRing) safeInit('initAudioCanvas', audioRing.initAudioCanvas);
    if (osc) safeInit('initWorldLine', osc.initWorldLine);
    if (bg) safeInit('initBackground', bg.initBackground);
    if (tts) safeInit('initTTSAudio', tts.initTTSAudio);

    safeInit('initLive2D', () => initLive2D().then(() => {
      // Kurisu speaks when the user invokes chat or an interaction, not on boot.
    }));

    if (chat) {
      safeInit('initSpeechRecognition', chat.initSpeechRecognition);
      safeInit('initKurisuChatInput', chat.initKurisuChatInput);
      safeInit('loadKurisuHistory', chat.loadKurisuHistory);
      safeInit('loadChatLog', chat.loadChatLog);
      safeInit('renderChatLog', chat.renderChatLog);
      safeInit('syncBackendChatHistory', chat.syncBackendChatHistory);
      safeInit('checkBrainUplink', chat.checkBrainUplink);
      setInterval(() => safeInit('checkBrainUplink(interval)', chat.checkBrainUplink), 60000);
    }

    if (bubble) {
      safeInit('initKurisuBubble', bubble.initKurisuBubble);
    }

    if (news) safeInit('fetchRealtimeNews', news.fetchRealtimeNews);
    if (settings) {
      safeInit('initSettings', settings.initSettings);
      safeInit('initPetMode', settings.initPetMode);
      safeInit('initInteractMode', settings.initInteractMode);
    }
    if (mood) {
      safeInit('loadMood', mood.loadMood);
      safeInit('updateEmotionTint', mood.updateEmotionTint);
    }
    if (power) {
      safeInit('startIdleWatchdog', power.startIdleWatchdog);
      safeInit('initDebugOverlay', power.initDebugOverlay);
      safeInit('startPerfGovernor', power.startPerfGovernor);
      safeInit('applyTimeOfDay', power.applyTimeOfDay);
      setInterval(() => safeInit('applyTimeOfDay(interval)', power.applyTimeOfDay), 60 * 1000);
    }
    if (lively) safeInit('initLivelyWebSocket', lively.initLivelyWebSocket);
    if (window.AMADEUS.uplink) safeInit('initCognitiveUplink', window.AMADEUS.uplink.init);
    if (window.AMADEUS.taskWidget) safeInit('initTaskWidget', window.AMADEUS.taskWidget.initTaskWidget);
    if (window.AMADEUS.focus) safeInit('initFocus', window.AMADEUS.focus.initFocus);
    if (window.AMADEUS.mediaPlayer) safeInit('initMediaPlayer', window.AMADEUS.mediaPlayer.initMediaPlayer);

    // Keyboard Shortcuts Matrix Modal (Ctrl+/)
    const keybindOverlay = document.getElementById('keybind-overlay');
    const keybindClose = document.getElementById('keybind-close');
    let keybindInvoker: HTMLElement | null = null;
    const toggleKeybinds = (show?: boolean) => {
      if (!keybindOverlay) return;
      const isHidden = keybindOverlay.hasAttribute('hidden');
      const next = show !== undefined ? show : isHidden;
      if (next) {
        const active = document.activeElement;
        keybindInvoker = active instanceof HTMLElement ? active : null;
        keybindOverlay.removeAttribute('hidden');
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
        if (keybindClose) keybindClose.focus();
      } else {
        keybindOverlay.setAttribute('hidden', '');
        if (keybindInvoker && keybindInvoker.isConnected) keybindInvoker.focus();
        keybindInvoker = null;
      }
    };
    if (keybindClose) keybindClose.addEventListener('click', () => toggleKeybinds(false));
    if (keybindOverlay) {
      keybindOverlay.addEventListener('click', (e) => {
        if (e.target === keybindOverlay) toggleKeybinds(false);
      });
    }

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash')) {
        e.preventDefault();
        toggleKeybinds();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C' || e.code === 'KeyC')) {
        e.preventDefault();
        if (settings && (settings as any).toggleCinematicMode) (settings as any).toggleCinematicMode();
      } else if (e.key === 'Escape') {
        if (keybindOverlay && !keybindOverlay.hasAttribute('hidden')) {
          toggleKeybinds(false);
        } else if (settings && (settings as any).closeSettingsDrawer && (settings as any).closeSettingsDrawer()) {
          // Close the drawer before changing any other stage state.
        } else if (document.body.classList.contains('cinematic-mode') && settings && (settings as any).toggleCinematicMode) {
          (settings as any).toggleCinematicMode(false);
        }
      }
    });

    // Focus trap for keybind modal
    if (keybindOverlay) {
      keybindOverlay.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || keybindOverlay.hasAttribute('hidden')) return;
        const focusable = keybindOverlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });
    }

    safeInit('startVisualLoop', startVisualLoop);

    // Global cursor tracking & wake triggers
    window.addEventListener('mousemove', (e) => {
      s.cursorNX = e.clientX / window.innerWidth;
      s.cursorNY = e.clientY / window.innerHeight;
      s.cursorSeen = true;
      if (power) power.markActivity();
    }, { passive: true });

    window.addEventListener('pointerdown', () => {
      if (s.isLivelyPaused) return;
      if (power) power.markActivity();
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && power) power.onUserAway();
      else if (power) power.onUserReturn();
    });
    window.addEventListener('blur', () => { if (power) power.onUserAway(); });
    window.addEventListener('focus', () => { if (power) power.onUserReturn(); });

    const shadowEl = document.getElementById('l2d-shadow');
    if (shadowEl) {
      shadowEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (s.isLivelyPaused) return;
        if (power) power.markActivity();
        const l2d = s.live2DController;
        if (l2d && l2d.interactShadow) l2d.interactShadow();
      }, { passive: true });
    }

    // Standalone fallback simulation if Lively API not present
    setTimeout(() => {
      if (!s.isLivelyActive && lively) {
        console.log("AMADEUS HUD: Lively API not detected, launching browser simulation mode.");
        lively.startBrowserSimulation();
      }
    }, 2500);

    validateModules();
  });
})();
