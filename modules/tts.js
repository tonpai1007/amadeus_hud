// modules/tts.js - AMADEUS Kurisu Voice Synthesis & Web Audio Lip-Sync
window.AMADEUS = window.AMADEUS || {};

(function() {
  let ttsAudioEl = null;
  let ttsSource = null;
  let ttsAnalyser = null;
  let isSpeakingVoice = false;

  function initTTSAudio() {
    if (ttsAudioEl) return;
    ttsAudioEl = new Audio();
    ttsAudioEl.crossOrigin = 'anonymous';
    ttsAudioEl.addEventListener('ended', () => {
      isSpeakingVoice = false;
      const ctrl = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (ctrl) ctrl.isSpeaking = false;
    });
    ttsAudioEl.addEventListener('pause', () => {
      isSpeakingVoice = false;
      const ctrl = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (ctrl) ctrl.isSpeaking = false;
    });
  }

  async function speakKurisuVoice(text, emotion = 'neutral') {
    const s = window.AMADEUS.state;
    const settings = window.AMADEUS.settings;
    const brain = window.AMADEUS.KURISU_BRAIN || {
      endpoint: 'http://127.0.0.1:8000',
      apiKey: 'amadeus_secure_key_2026',
    };
    if (settings && settings.voice === false) return;
    if (!text || (s && (s.isIdle || s.isSleeping))) return;
    const apiKey = (brain && brain.apiKey) || 'amadeus_secure_key_2026';
    const endpoint = (brain && brain.endpoint) || 'http://127.0.0.1:8000';

    try {
      const cleanText = text.replace(/[\(\[].*?[\)\]]/g, '').trim();
      if (!cleanText) return;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`${endpoint}/api/v1/kurisu/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ text: cleanText, language: 'en', emotion: emotion || 'neutral' }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.audio) return;

      if (!ttsAudioEl) initTTSAudio();
      ttsAudioEl.src = `data:audio/mp3;base64,${data.audio}`;

      // Wire Web Audio analyser for lip-sync mouth opening
      try {
        const actx = window.AMADEUS.sfx && window.AMADEUS.sfx.getAudioContext();
        if (actx && !ttsSource) {
          ttsSource = actx.createMediaElementSource(ttsAudioEl);
          ttsAnalyser = actx.createAnalyser();
          ttsAnalyser.fftSize = 64;
          ttsSource.connect(ttsAnalyser);
          ttsAnalyser.connect(actx.destination);
        }
      } catch (e) { /* ignore already connected node */ }

      isSpeakingVoice = true;
      const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (l2d) l2d.isSpeaking = true;
      await ttsAudioEl.play();

      // Real-time lip sync animation loop
      const pcmData = new Uint8Array(32);
      function trackLipSync() {
        if (!isSpeakingVoice) {
          if (l2d) l2d.isSpeaking = false;
          return;
        }
        if (ttsAnalyser) {
          ttsAnalyser.getByteFrequencyData(pcmData);
          let sum = 0;
          for (let i = 0; i < 16; i++) sum += pcmData[i];
          const amp = Math.min(1.0, (sum / 16) / 128);
          if (l2d && l2d.setLipSync) {
            l2d.setLipSync(amp);
          }
        }
        requestAnimationFrame(trackLipSync);
      }
      trackLipSync();
    } catch (err) {
      console.warn('[Kurisu] Voice synthesis skipped:', err.message);
      isSpeakingVoice = false;
      const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (l2d) l2d.isSpeaking = false;
    }
  }

  window.AMADEUS.tts = {
    initTTSAudio,
    speakKurisuVoice,
    isSpeakingVoice: () => isSpeakingVoice,
  };

  // Global aliases
  window.initTTSAudio = initTTSAudio;
  window.speakKurisuVoice = speakKurisuVoice;
})();
