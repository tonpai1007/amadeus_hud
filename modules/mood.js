// modules/mood.js - AMADEUS Kurisu Mood Memory & Emotion HUD Tinting
window.AMADEUS = window.AMADEUS || {};

(function() {
  const MOOD_KEY = 'amadeus.mood';
  const MOOD_DEFAULT = 55;

  const MOOD_DELTA = {
    happy: 3, content: 2, thinking: 1, surprised: 1, curious: 1,
    neutral: 1, confused: 0, sad: -1, sleepy: -1, annoyed: -2, angry: -3,
  };

  const EMOTION_TINT = {
    neutral:    { r: 204, g:  50, b:  53, glow: 0.35 },
    calm:       { r: 255, g: 110, b: 120, glow: 0.30 },
    content:    { r: 255, g: 170, b: 180, glow: 0.35 },
    amused:     { r: 255, g: 175, b: 200, glow: 0.45 },
    smug:       { r: 255, g: 200, b: 120, glow: 0.42 },
    proud:      { r: 255, g: 130, b: 110, glow: 0.43 },
    jealous:    { r: 255, g:  60, b: 160, glow: 0.58 },
    happy:      { r: 255, g: 120, b: 170, glow: 0.45 },
    excited:    { r: 255, g:  95, b: 150, glow: 0.55 },
    surprised:  { r: 255, g: 180, b: 200, glow: 0.50 },
    curious:    { r: 235, g: 120, b: 140, glow: 0.40 },
    focused:    { r: 230, g:  90, b: 110, glow: 0.35 },
    confused:   { r: 240, g: 150, b: 170, glow: 0.40 },
    thinking:   { r: 230, g:  80, b: 100, glow: 0.35 },
    angry:      { r: 255, g:  65, b:  70, glow: 0.60 },
    annoyed:    { r: 255, g: 130, b:  75, glow: 0.45 },
    frustrated: { r: 255, g: 100, b:  65, glow: 0.50 },
    sad:        { r: 160, g:  70, b: 110, glow: 0.25 },
    bitter:     { r: 140, g:  60, b:  90, glow: 0.25 },
    tired:      { r: 170, g: 100, b: 120, glow: 0.28 },
    sleepy:     { r: 150, g:  85, b: 110, glow: 0.25 },
    sleeping:   { r: 120, g:  60, b:  90, glow: 0.22 },
  };

  let hudTint = { r: EMOTION_TINT.neutral.r, g: EMOTION_TINT.neutral.g, b: EMOTION_TINT.neutral.b, glow: EMOTION_TINT.neutral.glow };

  function moodDeltaForEmotion(emotion) {
    return MOOD_DELTA[emotion] !== undefined ? MOOD_DELTA[emotion] : 1;
  }

  function loadMood() {
    const s = window.AMADEUS.state;
    try {
      const saved = JSON.parse(localStorage.getItem(MOOD_KEY) || 'null');
      if (saved && typeof saved.value === 'number') {
        s.mood = Math.max(5, Math.min(95, saved.value));
        s.moodLastAdjustAt = saved.at || 0;
      }
    } catch (e) { /* ignore */ }
    syncMoodToController();
  }

  function saveMood() {
    scheduleStorageWrite(MOOD_KEY, writeMood);
  }

  function writeMood() {
    const s = window.AMADEUS.state;
    try {
      localStorage.setItem(MOOD_KEY, JSON.stringify({ value: s.mood, at: performance.now() }));
    } catch (e) { /* ignore */ }
  }

  function syncMoodToController() {
    const s = window.AMADEUS.state;
    const l2d = s && s.live2DController;
    if (l2d && l2d.setMood) {
      l2d.setMood(s.mood);
    }
  }

  function driftMood() {
    const s = window.AMADEUS.state;
    if (!s.moodLastAdjustAt) { s.moodLastAdjustAt = performance.now(); return; }
    const elapsed = performance.now() - s.moodLastAdjustAt;
    if (elapsed < 3 * 60 * 1000) return;
    const steps = Math.min(Math.floor(elapsed / (3 * 60 * 1000)), 5);
    s.mood += (s.mood > MOOD_DEFAULT ? -1 : 1) * steps;
    s.mood = Math.max(5, Math.min(95, s.mood));
    s.moodLastAdjustAt += steps * 3 * 60 * 1000;
    saveMood();
    syncMoodToController();
  }

  function adjustMood(delta) {
    const s = window.AMADEUS.state;
    s.mood = Math.max(5, Math.min(95, s.mood + delta));
    s.moodLastAdjustAt = performance.now();
    saveMood();
    syncMoodToController();
  }

  function updateEmotionTint() {
    const s = window.AMADEUS.state;
    const l2d = s && s.live2DController;
    const emo = (l2d && l2d.currentEmotion) || 'neutral';
    const base = EMOTION_TINT[emo] || EMOTION_TINT.neutral;
    const moodMix = (s.mood - 50) / 50;

    let tr = base.r, tg = base.g, tb = base.b, tglow = base.glow;
    if (moodMix > 0) {
      tr += (255 - tr) * moodMix * 0.20;
      tg += (150 - tg) * moodMix * 0.10;
      tb += (170 - tb) * moodMix * 0.10;
      tglow += (0.5 - tglow) * moodMix * 0.30;
    } else {
      const m = -moodMix;
      tr -= tr * m * 0.15;
      tb += (190 - tb) * m * 0.12;
      tglow -= tglow * m * 0.15;
    }

    hudTint.r += (tr - hudTint.r) * 0.08;
    hudTint.g += (tg - hudTint.g) * 0.08;
    hudTint.b += (tb - hudTint.b) * 0.08;
    hudTint.glow += (tglow - hudTint.glow) * 0.08;

    const r = Math.round(hudTint.r);
    const g = Math.round(hudTint.g);
    const b = Math.round(hudTint.b);
    const glow = hudTint.glow.toFixed(2);

    if (r === updateEmotionTint._lr && g === updateEmotionTint._lg &&
        b === updateEmotionTint._lb && glow === updateEmotionTint._lglow) return;

    updateEmotionTint._lr = r; updateEmotionTint._lg = g;
    updateEmotionTint._lb = b; updateEmotionTint._lglow = glow;

    const root = document.documentElement.style;
    root.setProperty('--hud-emote-r', r);
    root.setProperty('--hud-emote-g', g);
    root.setProperty('--hud-emote-b', b);
    root.setProperty('--hud-emote-glow', glow);
  }

  // LocalStorage debounce writing
  const STORAGE_DEBOUNCE_MS = 600;
  const storageWriteTimers = {};

  function scheduleStorageWrite(key, fn) {
    if (storageWriteTimers[key]) return;
    storageWriteTimers[key] = setTimeout(() => {
      storageWriteTimers[key] = null;
      try { fn(); } catch (e) { /* ignore */ }
    }, STORAGE_DEBOUNCE_MS);
  }

  /**
   * AMADEUS persistent mood memory & emotion-reactive HUD tinting.
   * @property {() => void} loadMood - Restores the persisted mood (0-100) and syncs it to the Live2D controller.
   * @property {() => void} saveMood - Persists the mood via the debounced storage writer.
   * @property {(delta: number) => void} adjustMood - Nudges the mood (clamped 5-95) and persists it.
   * @property {() => void} driftMood - Slowly pulls the mood back toward neutral (called from markActivity).
   * @property {() => void} updateEmotionTint - Blends the HUD accent CSS vars toward the current emotion hue (call per visual tick).
   * @property {(emotion: string) => number} moodDeltaForEmotion - Pure: mood delta associated with an emotion label.
   * @property {(key: string, fn: Function) => void} scheduleStorageWrite - Debounced localStorage write helper (600ms, per key).
   * @property {() => void} writeMood - Immediate mood write (used by the debouncer and pagehide flush).
   */
  window.AMADEUS.mood = {
    loadMood,
    saveMood,
    adjustMood,
    driftMood,
    updateEmotionTint,
    moodDeltaForEmotion,
    scheduleStorageWrite,
    writeMood,
  };
})();
