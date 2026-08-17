// wallpaper.js - AMADEUS Convergence Sync HUD Orchestrator (Modular Architecture)
// Coordinates audio visualizers, Live2D avatar, cognitive uplink, and Lively Wallpaper runtime.

window.AMADEUS = window.AMADEUS || {};

(function() {
  let lastVisualTick = 0;

  // --- LIVE2D CONTROLLER BOOTSTRAP ---
  async function initLive2D() {
    console.log("[L2D] Starting Live2D Controller setup...");
    const l2d = new Live2DController('live2d-canvas', 'live2d/kurisu/Kurisu.model3.json');
    window.AMADEUS.state.live2DController = l2d;
    window.live2DController = l2d;

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

  // --- SINGLE PHASE-LOCKED VISUAL LOOP ---
  function startVisualLoop() {
    lastVisualTick = 0;
    requestAnimationFrame(visualLoopTick);
  }

  function visualLoopTick(now) {
    requestAnimationFrame(visualLoopTick);
    const interval = 1000 / window.AMADEUS.PERF.visualFps;
    if (now - lastVisualTick < interval) return;
    lastVisualTick = now - ((now - lastVisualTick) % interval);

    if (window.AMADEUS.oscilloscope) window.AMADEUS.oscilloscope.updateWorldLine();
    if (window.AMADEUS.background) window.AMADEUS.background.updateBackground();

    const s = window.AMADEUS.state;
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

    if (clock) {
      safeInit('applyTaskbarClearance', clock.applyTaskbarClearance);
      setTimeout(() => safeInit('applyTaskbarClearance(deferred)', clock.applyTaskbarClearance), 500);
      safeInit('initClock', clock.initClock);
    }

    if (audioRing) safeInit('initAudioCanvas', audioRing.initAudioCanvas);
    if (osc) safeInit('initWorldLine', osc.initWorldLine);
    if (bg) safeInit('initBackground', bg.initBackground);
    if (tts) safeInit('initTTSAudio', tts.initTTSAudio);

    safeInit('initLive2D', () => initLive2D().then(() => {
      if (chat && chat.kurisuGreetOnLoad) chat.kurisuGreetOnLoad();
    }));

    if (chat) {
      safeInit('initSpeechRecognition', chat.initSpeechRecognition);
      safeInit('initKurisuChatInput', chat.initKurisuChatInput);
      safeInit('loadKurisuHistory', chat.loadKurisuHistory);
      safeInit('loadChatLog', chat.loadChatLog);
      safeInit('renderChatLog', chat.renderChatLog);
      safeInit('checkBrainUplink', chat.checkBrainUplink);
      setInterval(() => safeInit('checkBrainUplink(interval)', chat.checkBrainUplink), 60000);
    }

    if (bubble) {
      safeInit('initKurisuBubble', bubble.initKurisuBubble);
      safeInit('scheduleIdleChatter', bubble.scheduleIdleChatter);
    }

    if (news) safeInit('fetchRealtimeNews', news.fetchRealtimeNews);
    if (settings) {
      safeInit('initSettings', settings.initSettings);
      safeInit('initPetMode', settings.initPetMode);
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
      if (!s.kurisuHintShown) {
        s.kurisuHintShown = true;
        if (bubble) setTimeout(() => bubble.showKurisuBubble('[ type a message - press Enter to talk to me ]', 5000), 700);
      }
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
  });
})();
