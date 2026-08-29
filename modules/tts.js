// modules/tts.js - AMADEUS Kurisu Voice Synthesis & Web Audio Lip-Sync
window.AMADEUS = window.AMADEUS || {};

(function() {
  let ttsAudioEl = null;
  let ttsSource = null;
  let ttsAnalyser = null;
  let isSpeakingVoice = false;
  let cachedVoices = [];

  function updateVoices() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const v = window.speechSynthesis.getVoices();
      if (v && v.length > 0) {
        cachedVoices = v;
      }
    }
  }

  if (typeof window !== 'undefined' && window.speechSynthesis) {
    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;
  }

  function initTTSAudio() {
    if (ttsAudioEl) return;
    ttsAudioEl = new Audio();
    ttsAudioEl.crossOrigin = 'anonymous';
    const clearSpeakTimeout = () => {
      if (ttsAudioEl._speakTimeout) { clearTimeout(ttsAudioEl._speakTimeout); ttsAudioEl._speakTimeout = null; }
    };
    ttsAudioEl.addEventListener('ended', () => {
      clearSpeakTimeout();
      isSpeakingVoice = false;
      const ctrl = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (ctrl) ctrl.isSpeaking = false;
    });
    ttsAudioEl.addEventListener('pause', () => {
      clearSpeakTimeout();
      isSpeakingVoice = false;
      const ctrl = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (ctrl) ctrl.isSpeaking = false;
    });
    ttsAudioEl.addEventListener('error', () => {
      clearSpeakTimeout();
      isSpeakingVoice = false;
      const ctrl = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (ctrl) ctrl.isSpeaking = false;
    });
  }

  function detectScriptLanguage(text) {
    if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) return 'ja';
    return 'en';
  }

  function pickBestWebSpeechVoice(lang) {
    updateVoices();
    const voices = cachedVoices.length > 0 ? cachedVoices : (window.speechSynthesis ? window.speechSynthesis.getVoices() : []);
    if (!voices || voices.length === 0) return null;

    const isMale = (v) => /\b(david|mark|guy|george|male|keita|ichiro|stefan|pavel|ravi|richard|james|paul|brian|steffan|claude|alex)\b/i.test(v.name);

    if (lang === 'ja') {
      const jaVoice = voices.find(v => !isMale(v) && (v.name.includes('Nanami') || v.name.includes('Haruka') || v.name.includes('Ayumi') || v.name.includes('Sayaka') || v.name.includes('Aoi') || v.name.includes('Mayu') || v.name.includes('Shiori') || v.name.includes('日本語') || (v.lang && v.lang.startsWith('ja'))));
      if (jaVoice) return jaVoice;
    }

    if (lang === 'th') {
      const thVoice = voices.find(v => !isMale(v) && (v.name.includes('Premwadee') || v.name.includes('Achara') || v.name.includes('ไทย') || (v.lang && v.lang.startsWith('th'))));
      if (thVoice) return thVoice;
    }

    // English / Universal Kurisu Female Preference
    const kurisuFemale = voices.find(v => !isMale(v) && (
      v.name.includes('Jenny') ||
      v.name.includes('Aria') ||
      v.name.includes('Zira') ||
      v.name.includes('Ana') ||
      v.name.includes('Ava') ||
      v.name.includes('Emma') ||
      v.name.includes('Sonia') ||
      v.name.includes('Natasha') ||
      v.name.includes('Michelle') ||
      v.name.includes('Google UK English Female') ||
      v.name.includes('Google US English') ||
      v.name.toLowerCase().includes('female')
    ));
    if (kurisuFemale) return kurisuFemale;

    // First non-male English voice
    const nonMaleEn = voices.find(v => !isMale(v) && v.lang && v.lang.startsWith('en'));
    if (nonMaleEn) return nonMaleEn;

    // First non-male voice of any language
    const nonMaleAny = voices.find(v => !isMale(v));
    if (nonMaleAny) return nonMaleAny;

    return voices[0];
  }

  async function speakKurisuVoice(text, emotion = 'neutral') {
    const s = window.AMADEUS.state;
    const settings = window.AMADEUS.settings || (window.AMADEUS.SETTINGS);
    const brain = window.KURISU_BRAIN || (window.AMADEUS.chat && window.AMADEUS.chat.KURISU_BRAIN) || {};
    if (settings && settings.voice === false) return;
    if (!text || (s && (s.isIdle || s.isSleeping))) return;
    const apiKey = (brain && brain.apiKey) || '';
    const endpoint = (brain && brain.endpoint) || '';

    try {
      const cleanText = text.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
      if (!cleanText) return;

      const lang = detectScriptLanguage(cleanText);

      let audioBase64 = null;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const res = await fetch(`${endpoint}/api/v1/kurisu/tts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: cleanText, language: lang, emotion: emotion || 'neutral' }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data.audio) audioBase64 = data.audio;
        }
      } catch (err) {
        console.warn('[Kurisu] Brain TTS failed, falling back to Web Speech:', err.message);
      }

      if (audioBase64) {
        if (!ttsAudioEl) initTTSAudio();
        ttsAudioEl.src = `data:audio/mp3;base64,${audioBase64}`;

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
        await ttsAudioEl.play().catch(e => {
          console.warn('[Kurisu] Audio play error:', e.message);
        });

        ttsAudioEl._speakTimeout = setTimeout(() => {
          if (isSpeakingVoice) {
            isSpeakingVoice = false;
            if (l2d) {
              l2d.isSpeaking = false;
              if (l2d.setLipSync) l2d.setLipSync(0);
            }
            window.AMADEUS.offMasterTick(lipSyncCb);
            try { ttsAudioEl.pause(); } catch(e) {}
          }
        }, 30000);

        // Real-time lip sync animation loop via master ticker
        const pcmData = new Uint8Array(32);
        const lipSyncCb = () => {
          if (!isSpeakingVoice) {
            if (l2d) {
              l2d.isSpeaking = false;
              if (l2d.setLipSync) l2d.setLipSync(0);
            }
            window.AMADEUS.offMasterTick(lipSyncCb);
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
        };
        window.AMADEUS.onMasterTick(lipSyncCb);
      } else {
        // Fallback to Web Speech API with Kurisu Voice Profile
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(cleanText);
        const kurisuVoice = pickBestWebSpeechVoice(lang);
        if (kurisuVoice) utterance.voice = kurisuVoice;

        // Kurisu personality acoustic tuning
        const emo = (emotion || 'neutral').toLowerCase();
        let pitch = 1.18;
        let rate = 1.10;

        if (emo.includes('tsundere') || emo.includes('annoyed') || emo.includes('flustered')) {
          pitch = 1.25;
          rate = 1.16;
        } else if (emo.includes('happy') || emo.includes('excited')) {
          pitch = 1.22;
          rate = 1.14;
        } else if (emo.includes('tired') || emo.includes('sad') || emo.includes('sleepy')) {
          pitch = 1.05;
          rate = 0.92;
        }

        utterance.pitch = pitch;
        utterance.rate = rate;

        isSpeakingVoice = true;
        const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
        if (l2d) l2d.isSpeaking = true;

        utterance.onend = () => {
          isSpeakingVoice = false;
          if (l2d) {
            l2d.isSpeaking = false;
            if (l2d.setLipSync) l2d.setLipSync(0);
          }
        };

        utterance.onerror = () => {
          isSpeakingVoice = false;
          if (l2d) {
            l2d.isSpeaking = false;
            if (l2d.setLipSync) l2d.setLipSync(0);
          }
        };

        function fakeLipSync() {
          if (!isSpeakingVoice) return;
          if (l2d && l2d.setLipSync) {
            const amp = Math.random() > 0.3 ? (Math.random() * 0.6 + 0.2) : 0.0;
            l2d.setLipSync(amp);
          }
        }

        window.speechSynthesis.speak(utterance);
        const fakeLipSyncCb = () => {
          if (!isSpeakingVoice) {
            window.AMADEUS.offMasterTick(fakeLipSyncCb);
            return;
          }
          fakeLipSync();
        };
        window.AMADEUS.onMasterTick(fakeLipSyncCb);
      }
    } catch (err) {
      console.warn('[Kurisu] Voice synthesis skipped:', err.message);
      isSpeakingVoice = false;
      const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
      if (l2d) {
        l2d.isSpeaking = false;
        if (l2d.setLipSync) l2d.setLipSync(0);
      }
    }
  }

  /**
   * AMADEUS TTS subsystem.
   * @property {() => void} initTTSAudio - Lazily creates the TTS <audio> element and its lifecycle hooks.
   * @property {(text: string, emotion?: string) => Promise<void>} speakKurisuVoice - Speaks a Kurisu line via the remote voice endpoint when available, falling back to Web Speech with per-emotion pitch/rate tuning. Drives Live2D lip-sync while speaking.
   * @property {() => boolean} isSpeakingVoice - True while a voice clip or utterance is playing.
   * @property {(lang: 'en'|'ja'|'th') => SpeechSynthesisVoice|null} pickBestWebSpeechVoice - Picks the best installed female Kurisu-like voice for the language.
   * @property {(text: string) => 'en'|'ja'|'th'} detectScriptLanguage - Detects language from Unicode script ranges (Thai, Japanese/kCJK, else English).
   */
  window.AMADEUS.tts = {
    initTTSAudio,
    speakKurisuVoice,
    isSpeakingVoice: () => isSpeakingVoice,
    pickBestWebSpeechVoice,
    detectScriptLanguage,
  };
})();
