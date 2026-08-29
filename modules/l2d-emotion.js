// modules/l2d-emotion.js - AMADEUS Live2D Emotion Engine & Stage Aura
window.AMADEUS = window.AMADEUS || {};

(function() {
  const EMOTION_PRESETS = {
    neutral:    { smile: 0,   sad: 0,   angry: 0,   surprised: 0,   scared: 0,   browY: 0,    browAngle: 0 },
    calm:       { smile: 0.2, sad: 0,   angry: 0,   surprised: 0,   scared: 0,   browY: 0.1,  browAngle: 0 },
    content:    { smile: 0.4, sad: 0,   angry: 0,   surprised: 0,   scared: 0,   browY: 0.15, browAngle: 0 },
    amused:     { smile: 0.6, sad: 0,   angry: 0,   surprised: 0.1, scared: 0,   browY: 0.2,  browAngle: 0 },
    smug:       { smile: 0.7, sad: 0,   angry: 0.1, surprised: 0,   scared: 0,   browY: 0.3,  browAngle: 0.1 },
    proud:      { smile: 0.5, sad: 0,   angry: 0,   surprised: 0,   scared: 0,   browY: 0.25, browAngle: 0 },
    jealous:    { smile: -0.2,sad: 0.1, angry: 0.4, surprised: 0,   scared: 0,   browY: -0.2, browAngle: -0.2 },
    happy:      { smile: 0.8, sad: 0,   angry: 0,   surprised: 0.1, scared: 0,   browY: 0.3,  browAngle: 0.1 },
    excited:    { smile: 0.9, sad: 0,   angry: 0,   surprised: 0.4, scared: 0,   browY: 0.4,  browAngle: 0.2 },
    surprised:  { smile: 0,   sad: 0,   angry: 0,   surprised: 0.9, scared: 0.3, browY: 0.5,  browAngle: 0.3 },
    curious:    { smile: 0.2, sad: 0,   angry: 0,   surprised: 0.3, scared: 0,   browY: 0.2,  browAngle: 0.1 },
    focused:    { smile: -0.1,sad: 0,   angry: 0.2, surprised: 0,   scared: 0,   browY: -0.2, browAngle: -0.1 },
    confused:   { smile: 0,   sad: 0.1, angry: 0.1, surprised: 0.3, scared: 0.1, browY: 0.1,  browAngle: -0.2 },
    thinking:   { smile: 0,   sad: 0,   angry: 0,   surprised: 0,   scared: 0,   browY: -0.1, browAngle: 0 },
    angry:      { smile: -0.5,sad: 0,   angry: 0.9, surprised: 0,   scared: 0,   browY: -0.5, browAngle: -0.4 },
    annoyed:    { smile: -0.3,sad: 0,   angry: 0.5, surprised: 0,   scared: 0,   browY: -0.3, browAngle: -0.2 },
    frustrated: { smile: -0.4,sad: 0.2, angry: 0.6, surprised: 0,   scared: 0.1, browY: -0.3, browAngle: -0.3 },
    sad:        { smile: -0.4,sad: 0.8, angry: 0,   surprised: 0,   scared: 0.2, browY: -0.4, browAngle: -0.3 },
    bitter:     { smile: -0.2,sad: 0.5, angry: 0.3, surprised: 0,   scared: 0,   browY: -0.3, browAngle: -0.2 },
    tired:      { smile: -0.1,sad: 0.3, angry: 0,   surprised: 0,   scared: 0,   browY: -0.2, browAngle: -0.1 },
    sleepy:     { smile: 0,   sad: 0.2, angry: 0,   surprised: 0,   scared: 0,   browY: -0.2, browAngle: 0 },
    sleeping:   { smile: 0.1, sad: 0,   angry: 0,   surprised: 0,   scared: 0,   browY: 0,    browAngle: 0 },
  };

  function setEmotion(ctrl, emotion, holdMs) {
    if (!ctrl) return;
    const emo = emotion || 'neutral';
    ctrl.currentEmotion = emo;
    if (holdMs && typeof holdMs === 'number') {
      ctrl._emotionHoldUntil = performance.now() + holdMs;
    }
    updateAura(ctrl);
  }

  function evaluateEmotion(ctrl) {
    if (!ctrl) return 'neutral';
    const now = performance.now();
    if (now < ctrl._emotionHoldUntil) return ctrl.currentEmotion;

    if (ctrl._surpriseUntil && now < ctrl._surpriseUntil) return 'surprised';
    if (ctrl.isThinking) return 'thinking';
    if (ctrl.isSpeaking) return 'curious';
    if (ctrl.isTyping) return 'content';

    const s = window.AMADEUS.state;
    if (s && s.isSleeping) return 'sleeping';
    if (s && s.isIdle) return 'tired';

    if (ctrl._proximity > 0.7) return 'amused';
    if (ctrl._audioEnergy > 0.5) return 'excited';

    if (s && s.mood >= 75) return 'happy';
    if (s && s.mood >= 60) return 'content';
    if (s && s.mood <= 30) return 'annoyed';

    return 'neutral';
  }

  function updateAura(ctrl) {
    if (!ctrl) return;
    if (!ctrl._auraEl) ctrl._auraEl = document.getElementById('l2d-aura');
    if (!ctrl._auraEl) return;

    const aura = window.AMADEUS.L2D_CONSTANTS.EMOTION_AURA[ctrl.currentEmotion] || window.AMADEUS.L2D_CONSTANTS.EMOTION_AURA.neutral;
    const now = performance.now();

    if (aura.flash && now - ctrl._lastFlash > 4000) {
      ctrl._lastFlash = now;
      ctrl._auraFlashUntil = now + 650;
    }

    const isFlashing = now < ctrl._auraFlashUntil;
    const baseGlow = isFlashing ? aura.glow * 2.2 : aura.glow;
    const proxBoost = ctrl._proximity * 0.12;
    const finalGlow = (baseGlow + proxBoost).toFixed(3);

    ctrl._auraEl.style.background = `radial-gradient(ellipse at 50% 40%, rgba(${aura.r}, ${aura.g}, ${aura.b}, ${finalGlow}) 0%, rgba(${aura.r}, ${aura.g}, ${aura.b}, 0) 70%)`;
  }

  /**
   * AMADEUS Live2D emotion engine & stage aura.
   * @property {Object<string, {smile:number, sad:number, angry:number, surprised:number, scared:number, browY:number, browAngle:number}>} EMOTION_PRESETS - Per-emotion blend-shape/parameter presets.
   * @property {(ctrl: object, emotion: string, holdMs?: number) => void} setEmotion - Sets the active emotion (optionally held against automatic evaluation) and refreshes the aura.
   * @property {(ctrl: object) => string} evaluateEmotion - Pure-ish: resolves the currently appropriate emotion from hold timers, speech/thinking flags, proximity, audio energy and mood.
   * @property {(ctrl: object) => void} updateAura - Paints the emotion-tinted radial aura behind the avatar (with flash and proximity boost).
   */
  window.AMADEUS.L2D_EMOTION = {
    EMOTION_PRESETS,
    setEmotion,
    evaluateEmotion,
    updateAura,
  };
})();
