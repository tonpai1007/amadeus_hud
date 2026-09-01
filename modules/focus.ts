/// <reference path="../types/amadeus.d.ts" />
// modules/focus.ts - AMADEUS Focus Mode (Pomodoro-style session watcher)
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  const FOCUS_MS = 25 * 60 * 1000;
  const BREAK_MS = 5 * 60 * 1000;
  const HISTORY_KEY = 'amadeus.focus.history';
  const HISTORY_MAX = 200;

  // Completed-session timestamps (ms). Persisted, capped; drives the daily
  // count and streak shown on the FOCUS chip and in streak praise lines.
  let history: number[] = loadHistory();

  function loadHistory(): number[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (Array.isArray(parsed)) return parsed.filter((n) => typeof n === 'number').slice(-HISTORY_MAX);
    } catch (e) { /* ignore */ }
    return [];
  }

  function saveHistory(): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX)));
    } catch (e) { /* ignore */ }
  }

  function localDayKey(ms: number): string {
    const d = new Date(ms);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function getTodayCount(): number {
    const today = localDayKey(Date.now());
    return history.filter((ms) => localDayKey(ms) === today).length;
  }

  // Consecutive days (ending today) with at least one completed session. If
  // nothing was completed today yet, the streak counted up to yesterday still
  // stands — today doesn't break it until it ends.
  function getStreak(): number {
    if (history.length === 0) return 0;
    const days = new Set(history.map((ms) => localDayKey(ms)));
    const dayMs = 24 * 60 * 60 * 1000;
    let streak = 0;
    let cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!days.has(localDayKey(cursor.getTime()))) {
      cursor.setTime(cursor.getTime() - dayMs);
      if (!days.has(localDayKey(cursor.getTime()))) return 0;
    }
    while (days.has(localDayKey(cursor.getTime()))) {
      streak++;
      cursor.setTime(cursor.getTime() - dayMs);
    }
    return streak;
  }

  let phase: 'idle' | 'focus' | 'break' = 'idle';
  let endsAt = 0;
  let tickCb: ((now: number) => void) | null = null;
  let featureEnabled = true;

  function l2d(): any {
    return window.AMADEUS.state && window.AMADEUS.state.live2DController;
  }
  function setEmotionSafe(emo: string, ms: number): void {
    const c = l2d();
    if (c && c.setEmotion) c.setEmotion(emo, ms);
  }
  function bubbleSafe(text: string, ms: number): void {
    const b = window.AMADEUS.bubble;
    if (b && b.showKurisuBubble) b.showKurisuBubble(text, ms);
  }
  function fmt(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function renderChip(): void {
    const chip = document.getElementById('hud-focus');
    if (!chip) return;
    if (phase === 'idle') {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    chip.classList.toggle('status-live', phase === 'focus');
    chip.classList.toggle('status-offline', phase === 'break');
    // innerHTML with a fully static template (no user data) so the bullet
    // decorative span survives the per-second text swap
    chip.innerHTML = '<span class="bullet" aria-hidden="true"></span> ' +
      (phase === 'focus' ? 'FOCUS: ' : 'BREAK: ') + fmt(endsAt - Date.now());
    chip.title = 'Focus mode — ' + getTodayCount() + ' session(s) completed today, streak: ' + getStreak();
  }

  // Driven by the master ticker while a session is running. Exposed for tests.
  function tick(): void {
    if (phase === 'idle') return;
    const s = window.AMADEUS.state;
    if (s && (s.isSleeping || s.isLivelyPaused)) {
      cancel(true);
      return;
    }
    if (Date.now() >= endsAt) {
      if (phase === 'focus') completeFocus();
      else endBreak();
      return;
    }
    renderChip();
  }

  function completeFocus(): void {
    phase = 'break';
    endsAt = Date.now() + BREAK_MS;
    history.push(Date.now());
    saveHistory();
    setEmotionSafe('happy', 6000);
    bubbleSafe("Twenty-five minutes of focus. Impressive. Break time — five minutes, doctor's orders.", 7000);
    if (window.AMADEUS.mood && window.AMADEUS.mood.adjustMood) window.AMADEUS.mood.adjustMood(2);
    renderChip();
    updateChipTitle();
  }

  function endBreak(): void {
    phase = 'idle';
    renderChip();
    updateChipTitle();
    stopTicker();
    bubbleSafe("Break's over. Ready for another round whenever you are.", 6000);
  }

  function cancel(silent?: boolean): boolean {
    if (phase === 'idle') return false;
    const was = phase;
    phase = 'idle';
    renderChip();
    stopTicker();
    if (!silent && was === 'focus') {
      bubbleSafe('Focus session cancelled. No penalty — the timeline just shifts a little.', 6000);
    }
    updateChipTitle();
    return true;
  }

  const FOCUS_STREAK_LINES = [
    "Third-plus session today. Your focus is becoming statistically significant.",
    "Back at it again? Fine — I'll keep the clock running, lab member.",
    "Another one? At this rate the world line converges on 'workaholic'.",
  ];

  function start(): boolean {
    const s = window.AMADEUS.state;
    if (!s || s.isSleeping || !featureEnabled) return false;
    if (phase !== 'idle') return true;
    phase = 'focus';
    endsAt = Date.now() + FOCUS_MS;
    setEmotionSafe('thinking', 8000);
    const opener = getTodayCount() >= 3 && window.AMADEUS.pickFreshLine
      ? window.AMADEUS.pickFreshLine('focusStreak', FOCUS_STREAK_LINES)
      : "Focus mode: twenty-five minutes on the clock. I'll keep watch.";
    bubbleSafe(opener, 6000);
    startTicker();
    renderChip();
    updateChipTitle();
    return true;
  }

  function startTicker(): void {
    if (!tickCb && window.AMADEUS.onMasterTick) {
      tickCb = tick;
      window.AMADEUS.onMasterTick(tickCb);
    }
  }
  function stopTicker(): void {
    if (tickCb && window.AMADEUS.offMasterTick) {
      window.AMADEUS.offMasterTick(tickCb);
      tickCb = null;
    }
  }

  function initFocus(): void {
    const chip = document.getElementById('hud-focus');
    if (chip) {
      chip.addEventListener('click', () => {
        if (phase === 'idle') start();
        else cancel(false);
      });
    }
    const f = window.AMADEUS.SETTINGS && window.AMADEUS.SETTINGS.features;
    featureEnabled = !f || f.focusMode !== false;
    renderChip();
    updateChipTitle();
  }

  // Hover tooltip: sessions-today + day streak + current action. Called on
  // phase changes only (never per-second from the tick loop).
  function updateChipTitle(): void {
    const chip = document.getElementById('hud-focus');
    if (!chip) return;
    chip.title = 'Focus sessions today: ' + getTodayCount() +
      ' · Day streak: ' + getStreak() +
      ' (click to ' + (phase === 'idle' ? 'start' : 'cancel') + ')';
  }

  function setFeatureEnabled(on: boolean): void {
    featureEnabled = on !== false;
    if (!featureEnabled) cancel(true);
  }

  /**
   * AMADEUS Focus Mode (Pomodoro-lite).
   * @property {() => void} initFocus - Wires the #hud-focus chip click and reads the feature flag.
   * @property {() => boolean} start - Begins a 25-min focus session (no-op if running/disabled/asleep).
   * @property {(silent?: boolean) => boolean} cancel - Stops the current session (bubble line unless silent).
   * @property {(on: boolean) => void} setFeatureEnabled - Settings-panel hook; cancels when disabled.
   * @property {() => boolean} isActive - True while a focus or break session runs.
   * @property {() => string} getPhase - 'idle' | 'focus' | 'break'.
   * @property {() => number} getTodayCount - Completed sessions today (persisted history).
   * @property {() => number} getStreak - Consecutive days with >=1 completed session.
   * @property {() => void} _tick - Test hook: advance the state machine by one tick.
   */
  window.AMADEUS.focus = {
    initFocus,
    start,
    cancel,
    setFeatureEnabled,
    isActive: () => phase !== 'idle',
    getPhase: () => phase,
    getTodayCount,
    getStreak,
    _tick: tick,
  };
})();
