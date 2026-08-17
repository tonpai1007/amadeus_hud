// modules/lively.js - AMADEUS Lively Wallpaper Native Integration & Telemetry WS
window.AMADEUS = window.AMADEUS || {};

(function() {
  let livelyWS = null;
  let wsReconnectTimer = null;
  let simulatedAudioTime = 0;

  function initLivelyWebSocket() {
    if (livelyWS && (livelyWS.readyState === WebSocket.OPEN || livelyWS.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const brain = window.AMADEUS.chat && window.AMADEUS.chat.KURISU_BRAIN;
    if (!brain || !brain.endpoint) return;
    const wsUrl = `${brain.endpoint.replace('http', 'ws')}/api/v1/ws/lively`;
    try {
      livelyWS = new WebSocket(wsUrl);
      livelyWS.onopen = () => {
        console.log('[Kurisu] Telemetry WebSocket connected to Brain.');
        if (window.AMADEUS.chat) window.AMADEUS.chat.setUplink('online', 'UPLINK: BRAIN_LINK');
      };
      livelyWS.onmessage = (event) => {
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
          if (data.business && window.AMADEUS.news) {
            window.AMADEUS.news.setBusinessData(data.business);
          }
        } catch (e) { /* ignore */ }
      };
      livelyWS.onclose = () => {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(initLivelyWebSocket, 6000);
      };
      livelyWS.onerror = () => {
        try { livelyWS.close(); } catch (e) {}
      };
    } catch (err) {
      wsReconnectTimer = setTimeout(initLivelyWebSocket, 6000);
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
    if (now - (handleAudioFrame._lastVis || 0) >= interval) {
      handleAudioFrame._lastVis = now;
      if (window.AMADEUS.audioRing) window.AMADEUS.audioRing.drawAudioRing(audioArray, now);
    }
  }

  function startBrowserSimulation() {
    const simulatedFFT = new Float32Array(128);
    function simulateAudioLoop() {
      if (window.AMADEUS.state.isLivelyActive) return;
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
      requestAnimationFrame(simulateAudioLoop);
    }
    simulateAudioLoop();
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
    if (l2d) {
      if (obj.IsPaused) {
        l2d.pause();
        if (power) power.onUserAway();
      } else {
        l2d.resume();
        if (power) {
          power.markActivity();
          power.onUserReturn();
        }
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

  window.livelyPropertyListener = function(name, val) {
    const settingsMod = window.AMADEUS.settings;
    const settings = window.AMADEUS.SETTINGS;
    switch (name) {
      case 'crtScanline': {
        const opacity = (val / 100).toFixed(2);
        document.documentElement.style.setProperty('--crt-scanline-opacity', opacity);
        const crtEl = document.querySelector('.crt-overlay') || document.getElementById('crt-overlay');
        if (crtEl) crtEl.style.opacity = opacity;
        break;
      }
      case 'scopeSpeed': {
        if (settings && settings.scope) {
          settings.scope.speed = Math.max(1, Math.min(10, val));
          if (settingsMod) settingsMod.saveSettings();
        }
        break;
      }
      case 'showAudioRing': {
        const enabled = !!val;
        document.body.classList.toggle('hide-ring', !enabled);
        if (settings && settings.widgets) {
          settings.widgets.ring = enabled;
          if (settingsMod) settingsMod.saveSettings();
        }
        break;
      }
      case 'petMode': {
        if (settingsMod) settingsMod.petApply(!!val);
        break;
      }
      case 'perfGovernor': {
        const l2d = window.AMADEUS.state.live2DController;
        if (l2d && l2d.setPerfLevel) l2d.setPerfLevel(val);
        break;
      }
      case 'voiceEnabled': {
        if (settings) {
          settings.voice = !!val;
          if (settingsMod) settingsMod.saveSettings();
        }
        break;
      }
    }
  };

  window.AMADEUS.lively = {
    initLivelyWebSocket,
    handleAudioFrame,
    startBrowserSimulation,
  };

  window.initLivelyWebSocket = initLivelyWebSocket;
  window.startBrowserSimulation = startBrowserSimulation;
})();
