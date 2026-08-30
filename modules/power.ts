/// <reference path="../types/amadeus.d.ts" />
// modules/power.js - AMADEUS Power Governor, Idle/Sleep Watchdog, & Time-of-Day
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  const IDLE_THRESHOLD_MS = 8000;
  const SLEEP_THRESHOLD_MS = 20 * 60 * 1000;
  const ACTIVITY_ENERGY = 0.02;

  let _rafFrames = 0;
  let _rafLast = performance.now();
  let _highStreak = 0;
  let _governorActive = false;
  let _lastMeasuredFps = 0;

  let debugOverlayEl = null;
  let debugOverlayRowsEl = null;
  let debugOverlayTimer = null;
  let debugZoneEl = null;
  let _idleWatchdogInterval = null;

  function markActivity() {
    const s = window.AMADEUS.state;
    s.lastActivityTime = performance.now();
    if (window.AMADEUS.mood && window.AMADEUS.mood.driftMood) {
      window.AMADEUS.mood.driftMood();
    }
    if (s.isIdle) enterIdleState(false);
    if (s.isSleeping) enterSleepState(false);
  }

  function startIdleWatchdog() {
    if (_idleWatchdogInterval) return; // guard: already running
    _idleWatchdogInterval = setInterval(() => {
      const s = window.AMADEUS.state;
      if (s.isLivelyPaused) return;
      const l2d = s.live2DController;
      if (l2d && l2d.setSessionMinutes) {
        l2d.setSessionMinutes((performance.now() - s.desktopSessionAt) / 60000);
      }
      const inactiveFor = performance.now() - s.lastActivityTime;
      if (!s.isIdle && inactiveFor >= IDLE_THRESHOLD_MS) {
        enterIdleState(true);
      }
      if (!s.isSleeping && inactiveFor >= SLEEP_THRESHOLD_MS) {
        enterSleepState(true);
      }
    }, 2000);
  }

  function stopIdleWatchdog() {
    if (_idleWatchdogInterval) {
      clearInterval(_idleWatchdogInterval);
      _idleWatchdogInterval = null;
    }
  }

  function enterSleepState(sleep) {
    const s = window.AMADEUS.state;
    if (s.isSleeping === sleep) return;
    s.isSleeping = sleep;
    const l2d = s.live2DController;
    if (sleep) {
      if (window.AMADEUS.bubble) window.AMADEUS.bubble.hideKurisuBubble();
      if (l2d && l2d.setEmotion) l2d.setEmotion('sleepy');
      console.log('AMADEUS HUD: Kurisu fell asleep (no activity for 20 min).');
    } else {
      s.desktopSessionAt = performance.now();
      if (l2d && l2d.setEmotion) l2d.setEmotion('surprised', 2500);
      setTimeout(() => {
        if (s.isSleeping) return;
        const chat = window.AMADEUS.chat;
        const wakeLines = (chat && chat.KURISU_WAKE_LINES) || ["Welcome back. The divergence meter kept running without you."];
        const line = wakeLines[Math.floor(Math.random() * wakeLines.length)];
        if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuBubble(line, 6000);
        if (chat) chat.appendChatEntry('assistant', line, 'history');
      }, 900);
      console.log('AMADEUS HUD: Kurisu woke up.');
    }
  }

  function enterIdleState(idle) {
    const s = window.AMADEUS.state;
    const inputEl = document.getElementById('kurisu-input');
    if (idle && ((inputEl && document.activeElement === inputEl) || s.kurisuInput.length > 0)) {
      return;
    }
    if (s.isIdle === idle) return;
    s.isIdle = idle;
    document.body.classList.toggle('idle', idle);
    const l2d = s.live2DController;
    if (l2d && l2d.setIdleMode) l2d.setIdleMode(idle);
    if (l2d && l2d.setEmotion) l2d.setEmotion(idle ? 'tired' : 'neutral');
    if (idle) {
      console.log("AMADEUS HUD: entering idle power-saving mode.");
    } else {
      console.log("AMADEUS HUD: activity detected, resuming full render.");
      s.desktopSessionAt = performance.now();
    }
  }

  function onUserAway() {
    const s = window.AMADEUS.state;
    if (s.isUserAway) return;
    if (performance.now() < s.peekReadyAt) return;
    s.isUserAway = true;
    s.userAwaySince = performance.now();
    document.body.classList.add('user-away');
    const l2d = s.live2DController;
    if (l2d && l2d.onUserAway) l2d.onUserAway();
  }

  function onUserReturn() {
    const s = window.AMADEUS.state;
    const wasAway = s.isUserAway;
    s.isUserAway = false;
    document.body.classList.remove('user-away');
    if (!wasAway) return;
    if (performance.now() - s.userAwaySince < 800) return;
    const wasSleeping = s.isSleeping;
    markActivity();
    if (wasSleeping) return;
    const now = performance.now();
    if (now - s.lastPeekAt < 6000) return;
    s.lastPeekAt = now;
    const l2d = s.live2DController;
    if (l2d && l2d.triggerPeek) l2d.triggerPeek();
    const chat = window.AMADEUS.chat;
    const returnLines = (chat && chat.KURISU_RETURN_LINES) || ["Ah — you're back. I was just checking the world line... and you weren't on it."];
    const line = returnLines[Math.floor(Math.random() * returnLines.length)];
    if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuBubble(line, 6000);
    if (chat) chat.appendChatEntry('assistant', line, 'history');
  }

  function applyPerfLevel() {
    const perfLevel = window.AMADEUS.getPerfLevel();
    const lvl = window.AMADEUS.PERF_LEVELS[perfLevel];
    window.AMADEUS.PERF.dpr = lvl.dpr;
    window.AMADEUS.PERF.visualFps = lvl.visualFps;
    if (window.AMADEUS.audioRing && window.AMADEUS.audioRing.getResizeCallback()) {
      window.AMADEUS.audioRing.getResizeCallback()();
    }
    if (window.AMADEUS.oscilloscope && window.AMADEUS.oscilloscope.getResizeCallback()) {
      window.AMADEUS.oscilloscope.getResizeCallback()();
    }
    const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
    if (l2d && l2d.setPerfLevel) l2d.setPerfLevel(perfLevel);
  }

  function startPerfGovernor() {
    if (_governorActive) return;
    _governorActive = true;

    window.AMADEUS.onMasterTick((now) => {
      const s = window.AMADEUS.state;
      if (s.isLivelyPaused || s.isIdle || s.perfLevelManual) {
        _rafFrames = 0;
        _rafLast = performance.now();
        _highStreak = 0;
        return;
      }
      _rafFrames++;
      const dt = now - _rafLast;
      if (dt >= 1500) {
        const fps = Math.round((_rafFrames * 1000) / dt);
        _rafFrames = 0;
        _rafLast = now;
        _lastMeasuredFps = fps;
        let lvl = window.AMADEUS.getPerfLevel();
        if (fps < 18 && lvl > 0) {
          window.AMADEUS.setPerfLevel(lvl - 1);
          _highStreak = 0;
          applyPerfLevel();
        } else if (fps >= 55) {
          _highStreak++;
          if (_highStreak >= 3 && lvl < window.AMADEUS.PERF_LEVELS.length - 1) {
            window.AMADEUS.setPerfLevel(lvl + 1);
            _highStreak = 0;
            applyPerfLevel();
          }
        } else {
          _highStreak = 0;
        }
      }
    });
  }

  function getLastMeasuredFps() { return _lastMeasuredFps; }

  function applyTimeOfDay() {
    const hour = new Date().getHours();
    const period = hour < 6 ? 'night' : (hour < 8 ? 'dawn' : (hour < 16 ? 'day' : (hour < 19 ? 'dusk' : 'night')));
    document.body.classList.toggle('night-mode', period === 'night');
    document.body.classList.toggle('dawn-mode', period === 'dawn');
    document.body.classList.toggle('day-mode', period === 'day');
    document.body.classList.toggle('dusk-mode', period === 'dusk');
  }

  function initDebugOverlay() {
    debugOverlayEl = document.getElementById('l2d-debug');
    if (!debugOverlayEl) return;
    debugOverlayRowsEl = document.getElementById('l2d-debug-rows');
    debugZoneEl = document.getElementById('l2d-debug-zone');
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        toggleDebugOverlay();
      }
    });
  }

  function toggleDebugOverlay() {
    if (!debugOverlayEl) return;
    const show = debugOverlayEl.hidden;
    debugOverlayEl.hidden = !show;
    if (debugZoneEl) debugZoneEl.style.display = show ? 'block' : 'none';
    if (show) {
      refreshDebugOverlay();
      if (!debugOverlayTimer) debugOverlayTimer = setInterval(refreshDebugOverlay, 250);
    } else if (debugOverlayTimer) {
      clearInterval(debugOverlayTimer);
      debugOverlayTimer = null;
    }
  }

  function refreshDebugOverlay() {
    if (!debugOverlayRowsEl) return;
    const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
    if (!l2d || !l2d.debugState) return;
    const s = l2d.debugState();
    const num = (v, d = '—') => (v === null || v === undefined) ? d : v;
    const perfLvl = window.AMADEUS.getPerfLevel ? window.AMADEUS.getPerfLevel() : '—';
    const fps = _lastMeasuredFps || '—';
    const rows = [
      ['fps', fps],
      ['perf_lvl', perfLvl],
      ['emotion', s.emotion],
      ['mood', `${s.mood}/100`],
      ['proximity', num(s.proximity)],
      ['pupil', num(s.pupil)],
      ['blink', `${s.blinkPhase} ${num(s.blinkValue)}`],
    ];
    debugOverlayRowsEl.innerHTML = rows
      .map(([label, value]) => `<div class="l2d-debug-row"><span>${label}</span><span class="l2d-debug-val">${value}</span></div>`)
      .join('');

    if (debugZoneEl && s.cheekZone) {
      const z = s.cheekZone;
      debugZoneEl.style.left = z.x + 'px';
      debugZoneEl.style.top = z.y + 'px';
      debugZoneEl.style.width = z.w + 'px';
      debugZoneEl.style.height = z.h + 'px';
    }
  }

  /**
   * AMADEUS power management: idle/sleep watchdog, adaptive perf governor,
   * time-of-day ambience and the L2D debug overlay.
   * @property {(delta?: number) => void} markActivity - Registers user activity (resets idle/sleep timers, drifts mood).
   * @property {() => void} startIdleWatchdog - Starts the 2s polling watchdog that drives idle (8s) and sleep (20min) transitions.
   * @property {(idle: boolean) => void} enterIdleState - Forces the HUD idle power-saving state on/off.
   * @property {(sleep: boolean) => void} enterSleepState - Puts Kurisu to sleep / wakes her with a greeting line.
   * @property {() => void} onUserAway - Focus lost / Lively paused / lock handler (peek choreography entry).
   * @property {() => void} onUserReturn - Focus regained handler (peek reaction + wake).
   * @property {() => void} applyPerfLevel - Applies the current PERF_LEVELS entry (DPR, fps caps) to subsystems.
   * @property {() => void} startPerfGovernor - Samples master-tick FPS and auto-downgrades/upgrades the perf level.
   * @property {() => void} applyTimeOfDay - Toggles dawn/day/dusk/night body classes from the local hour.
   * @property {() => void} initDebugOverlay - Registers the Ctrl+Shift+D debug inspector toggle.
   * @property {() => number} getLastMeasuredFps - Last FPS measured by the governor.
   * @property {number} ACTIVITY_ENERGY - Audio energy threshold that counts as user activity.
   */
  window.AMADEUS.power = {
    markActivity,
    startIdleWatchdog,
    stopIdleWatchdog,
    enterIdleState,
    enterSleepState,
    onUserAway,
    onUserReturn,
    applyPerfLevel,
    startPerfGovernor,
    applyTimeOfDay,
    initDebugOverlay,
    getLastMeasuredFps,
    ACTIVITY_ENERGY,
  };
})();
