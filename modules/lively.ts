/// <reference path="../types/amadeus.d.ts" />
// modules/lively.js - AMADEUS Lively Wallpaper Native Integration & Telemetry WS
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  let livelyWS = null;
  let livelyHb = null;
  let wsReconnectTimer = null;
  let wsRetryCount = 0;
  let wsIntentionallyClosed = false;
  let simulatedAudioTime = 0;

  function initLivelyWebSocket() {
    wsIntentionallyClosed = false;
    if (livelyWS && (livelyWS.readyState === WebSocket.OPEN || livelyWS.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const client = window.AMADEUS.brainClient;
    const wsUrl = client.getWsUrl('/ws/lively');
    try {
      livelyWS = new WebSocket(wsUrl);
      livelyHb = window.AMADEUS.createWsHeartbeat(livelyWS, { intervalMs: 25000, staleMs: 90000 });
      livelyWS.onopen = () => {
        console.log('[Kurisu] Telemetry WebSocket connected to Brain.');
        wsRetryCount = 0;
        if (livelyHb) livelyHb.start();
        if (window.AMADEUS.chat) window.AMADEUS.chat.setUplink('online', 'UPLINK: BRAIN_LINK');
      };
      livelyWS.onmessage = (event) => {
        if (livelyHb) livelyHb.touch();
        try {
          const data = JSON.parse(event.data);
          const s = window.AMADEUS.state;
          const l2d = s && s.live2DController;
          const tts = window.AMADEUS.tts;
          if (data.emotion && data.emotion.dominant_emotion) {
            if (l2d && !l2d.isThinking && !(tts && tts.isSpeakingVoice())) {
              l2d.setEmotion(data.emotion.dominant_emotion, 3000);
            }
          }
          if (data.second_brain && data.second_brain.memories && data.second_brain.memories.length > 0) {
            const mindEl = document.getElementById('wl-mind');
            if (mindEl) {
              mindEl.textContent = `MEM: ${data.second_brain.memories[0].substring(0, 14)}...`;
            }
          }
          if (data.system && data.system.active_goals && data.system.active_goals.length > 0) {
            const goalEl = document.getElementById('news-status');
            if (goalEl) goalEl.textContent = `GOAL: ${data.system.active_goals[0].substring(0, 14)}`;
          }
        } catch (e) { /* ignore */ }
      };
      livelyWS.onclose = () => {
        if (livelyHb) livelyHb.stop();
        if (wsIntentionallyClosed) return;
        scheduleWsReconnect();
      };
      livelyWS.onerror = () => {
        try { livelyWS.close(); } catch (e) {}
      };
    } catch (err) {
      scheduleWsReconnect();
    }
  }

  function scheduleWsReconnect() {
    clearTimeout(wsReconnectTimer);
    const delay = Math.min(12000, 1000 * Math.pow(1.5, wsRetryCount) + Math.random() * 500);
    wsRetryCount++;
    wsReconnectTimer = setTimeout(initLivelyWebSocket, delay);
  }

  // Intentional teardown: closes the telemetry socket WITHOUT arming the
  // reconnect loop (used when Lively pauses playback or the page unloads, so
  // a paused wallpaper stops holding sockets open).
  function closeTelemetryWebSocket() {
    wsIntentionallyClosed = true;
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
    wsRetryCount = 0;
    if (livelyHb) livelyHb.stop();
    if (livelyWS) {
      try { livelyWS.close(); } catch (e) { /* already closed */ }
      livelyWS = null;
    }
  }

  function handleAudioFrame(audioArray) {
    if (!audioArray || audioArray.length === 0) return;
    const s = window.AMADEUS.state;
    const power = window.AMADEUS.power;

    let energy = 0;
    const sampleBins = Math.min(audioArray.length, 64);
    for (let i = 0; i < sampleBins; i++) {
      if (audioArray[i] > energy) energy = audioArray[i];
    }
    if (energy > (power ? power.ACTIVITY_ENERGY : 0.02)) {
      if (power) power.markActivity();
    }

    if (s.isLivelyPaused) return;

    let bassSum = 0;
    for (let i = 0; i < 8; i++) bassSum += audioArray[i];
    const bassVal = bassSum / 8;

    if (bassVal > 0.14 && bassVal > s.lastBassLevel * 1.35 && bassVal - s.lastBassLevel > 0.05) {
      if (window.AMADEUS.background) window.AMADEUS.background.triggerBeatPulse();
    }
    s.lastBassLevel = bassVal;
    s.worldLineEnergy = bassVal;
    s.lastAudioLevel = energy;
    s.lastSpectrum = audioArray.slice(0, 48);

    let vocalsSum = 0;
    for (let i = 1; i <= 12; i++) vocalsSum += audioArray[i] || 0;
    const vocalsAvg = vocalsSum / 12;

    const l2d = s.live2DController;
    if (l2d && l2d.setAudioEnergy) l2d.setAudioEnergy(bassVal);

    const settings = window.AMADEUS.SETTINGS;
    if (!s.isIdle && (!settings || settings.features.musicMood !== false)) {
      let trackSum = 0;
      for (let i = 0; i < audioArray.length; i++) trackSum += audioArray[i] || 0;
      const trackVal = audioArray.length ? trackSum / audioArray.length : 0;
      if (l2d && l2d.setMusicEnergy) l2d.setMusicEnergy(trackVal);
    }

    if (l2d && l2d.setLipSync) {
      l2d.setLipSync(vocalsAvg, audioArray, bassVal);
    }

    if (s.isIdle) return;
    if (document.body.classList.contains('hide-ring')) return;

    const now = performance.now();
    const interval = 1000 / window.AMADEUS.PERF.visualFps;
    if (now - ((handleAudioFrame as any)._lastVis || 0) >= interval) {
      (handleAudioFrame as any)._lastVis = now;
      if (window.AMADEUS.audioRing) window.AMADEUS.audioRing.drawAudioRing(audioArray, now);
    }
  }

  function startBrowserSimulation() {
    const simulatedFFT = new Float32Array(128);
    let lastSimTime = 0;
    const simInterval = 1000 / 30;

    window.AMADEUS.onMasterTick((now) => {
      if (window.AMADEUS.state.isLivelyActive) return;
      if (now - lastSimTime < simInterval) return;
      lastSimTime = now;

      simulatedAudioTime += 0.07;
      for (let i = 0; i < 128; i++) {
        let val = Math.sin(simulatedAudioTime + i * 0.12) * 0.3 +
                  Math.sin(simulatedAudioTime * 0.4 + i * 0.04) * 0.2 +
                  Math.cos(simulatedAudioTime * 2.1 + i * 0.25) * 0.15 +
                  Math.random() * 0.08;
        val = Math.max(0, val);
        const speechEnvelope = Math.max(0, Math.sin(simulatedAudioTime * 0.3) * 0.8 + 0.2);
        if (i >= 1 && i <= 12) val *= speechEnvelope;
        simulatedFFT[i] = val;
      }
      handleAudioFrame(simulatedFFT);
    });
  }

  // --- Lively C# Native Callbacks ---
  window.livelyAudioListener = function(audioArray) {
    window.AMADEUS.state.isLivelyActive = true;
    handleAudioFrame(audioArray);
  };

  window.livelyWallpaperPlaybackChanged = function(data) {
    let obj = data;
    if (typeof data === 'string') {
      try { obj = JSON.parse(data); } catch (e) { return; }
    }
    if (!obj || typeof obj.IsPaused !== 'boolean') return;
    window.AMADEUS.state.isLivelyPaused = obj.IsPaused;
    const l2d = window.AMADEUS.state.live2DController;
    const power = window.AMADEUS.power;
    const uplink = window.AMADEUS.uplink;
    if (obj.IsPaused) {
      // Stop holding sockets open while the wallpaper is paused.
      if (uplink && uplink.close) uplink.close();
      closeTelemetryWebSocket();
      if (l2d) l2d.pause();
      if (power) power.onUserAway();
    } else {
      initLivelyWebSocket();
      if (uplink && uplink.init) uplink.init();
      if (l2d) l2d.resume();
      if (power) {
        power.markActivity();
        power.onUserReturn();
      }
    }
  };

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
    if (albumEl && obj.Thumbnail) {
      albumEl.style.backgroundImage = 'url(data:image/png;base64,' + obj.Thumbnail + ')';
      albumEl.classList.add('visible');
    } else if (albumEl) {
      albumEl.classList.remove('visible');
    }
  };

  function toBoolean(val, defaultVal = false) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') {
      const s = val.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    }
    return defaultVal;
  }

  function toNumber(val, min, max, defaultVal) {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (!Number.isFinite(num)) return defaultVal;
    if (typeof min === 'number' && typeof max === 'number') {
      return Math.max(min, Math.min(max, num));
    }
    return num;
  }

  window.livelyPropertyListener = function(name, val) {
    if (typeof name !== 'string' || !name) return;
    const settingsMod = window.AMADEUS.settings;
    const settings = window.AMADEUS.SETTINGS;
    switch (name) {
      case 'crtScanline': {
        const intensity = toNumber(val, 0, 100, 50);
        const opacity = (intensity / 100).toFixed(2);
        document.documentElement.style.setProperty('--crt-scanline-opacity', opacity);
        const crtEl = (document.querySelector('.crt-overlay') || document.getElementById('crt-overlay')) as HTMLElement | null;
        if (crtEl) crtEl.style.opacity = opacity;
        break;
      }
      case 'scopeSpeed': {
        const speed = Math.round(toNumber(val, 1, 10, 5));
        if (settings && settings.scope) {
          settings.scope.speed = speed;
          if (settingsMod && settingsMod.saveSettings) settingsMod.saveSettings();
        }
        break;
      }
      case 'showAudioRing': {
        const enabled = toBoolean(val, true);
        document.body.classList.toggle('hide-ring', !enabled);
        if (settings && settings.widgets) {
          settings.widgets.ring = enabled;
          if (settingsMod && settingsMod.saveSettings) settingsMod.saveSettings();
        }
        break;
      }
      case 'petMode': {
        const enabled = toBoolean(val, false);
        if (settingsMod && settingsMod.petApply) settingsMod.petApply(enabled);
        break;
      }
      case 'perfGovernor': {
        let level = 2; // default high
        if (typeof val === 'number' && Number.isFinite(val)) {
          level = Math.max(0, Math.min(2, Math.round(val)));
        } else if (typeof val === 'string') {
          const s = val.trim().toLowerCase();
          if (s.includes('saver') || s === '0' || s === 'low') level = 0;
          else if (s.includes('balance') || s === '1' || s === 'mid' || s === 'medium') level = 1;
          else if (s.includes('high') || s === '2') level = 2;
        }
        // Route through the shared shell governor (PERF.dpr / visualFps +
        // canvas resize callbacks) as well as the Live2D controller, so the
        // slider affects the whole HUD, not just the avatar. Mark the level
        // as user-set so the auto-governor stops overriding it.
        window.AMADEUS.state.perfLevelManual = true;
        if (window.AMADEUS.setPerfLevel) window.AMADEUS.setPerfLevel(level);
        const power = window.AMADEUS.power;
        if (power && power.applyPerfLevel) {
          power.applyPerfLevel();
        } else {
          const PERF = window.AMADEUS.PERF;
          const levels = window.AMADEUS.PERF_LEVELS;
          if (PERF && levels && levels[level]) {
            PERF.dpr = levels[level].dpr;
            PERF.visualFps = levels[level].visualFps;
          }
          const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
          if (l2d && l2d.setPerfLevel) l2d.setPerfLevel(level);
        }
        break;
      }
      case 'voiceEnabled': {
        const enabled = toBoolean(val, true);
        if (settings) {
          settings.voice = enabled;
          if (settingsMod && settingsMod.saveSettings) settingsMod.saveSettings();
        }
        break;
      }
    }
  };

  /**
   * AMADEUS Lively native integration & telemetry WebSocket.
   * Exposes the four `window.lively*` callbacks required by Lively's C# host
   * (audio spectrum frames, playback pause/resume, now-playing track, settings
   * property changes) plus the telemetry WS client used in browser mode.
   * @property {() => void} initLivelyWebSocket - Opens (or reopens) the telemetry WebSocket with heartbeat + exponential reconnect.
   * @property {() => void} closeTelemetryWebSocket - Tears the telemetry WebSocket down without arming reconnect (pause/unload).
   * @property {number[]} handleAudioFrame - Feed for `livelyAudioListener` spectrum frames: drives beat pulse, mood energy and Live2D audio reaction.
   * @property {() => void} startBrowserSimulation - Simulates Lively audio/playback events when the native API is absent.
   * @property {(val: any, defaultVal?: boolean) => boolean} toBoolean - Pure: coerces bool/number/string ("true"/"1"/"on"/...) to boolean with default.
   * @property {(val: any, min?: number, max?: number, defaultVal?: number) => number} toNumber - Pure: parses and clamps a number, returning defaultVal when not finite.
   */
  window.AMADEUS.lively = {
    initLivelyWebSocket,
    closeTelemetryWebSocket,
    handleAudioFrame,
    startBrowserSimulation,
    toBoolean,
    toNumber,
  };
})();
