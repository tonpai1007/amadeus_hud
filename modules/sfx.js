// modules/sfx.js - AMADEUS Web Audio SFX Synthesizer
window.AMADEUS = window.AMADEUS || {};

(function() {
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
    const s = window.AMADEUS.state;
    if (!sfxEnabled || (s && (s.isIdle || s.isLivelyPaused))) return;
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
    const s = window.AMADEUS.state;
    if (!sfxEnabled || (s && (s.isIdle || s.isLivelyPaused))) return;
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
    const s = window.AMADEUS.state;
    if (!sfxEnabled || (s && (s.isIdle || s.isLivelyPaused))) return;
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

  /**
   * AMADEUS Web Audio SFX synthesizer (UI clicks, beeps, transmit chirps).
   * @property {() => AudioContext|null} getAudioContext - Lazily creates/resumes the shared AudioContext.
   * @property {() => void} playClickSound - Short triangle-wave click (settings interactions).
   * @property {() => void} playBeepSound - Square-wave double beep (toggles, pet mode).
   * @property {() => void} playTransmitSound - Sine chirp on message send.
   * @property {(v: boolean) => void} setSfxEnabled - Master SFX switch (settings panel).
   * @property {() => boolean} isSfxEnabled - Current SFX switch state.
   */
  window.AMADEUS.sfx = {
    getAudioContext,
    playClickSound,
    playBeepSound,
    playTransmitSound,
    setSfxEnabled: (v) => { sfxEnabled = !!v; },
    isSfxEnabled: () => sfxEnabled,
  };
})();
