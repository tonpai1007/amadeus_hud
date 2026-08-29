// modules/clock.js - AMADEUS Nixie Clock & Taskbar Clearance
window.AMADEUS = window.AMADEUS || {};

(function() {
  function applyTaskbarClearance() {
    let clear = 0;
    try {
      clear = window.innerHeight - window.screen.availHeight;
    } catch (e) { clear = 0; }
    if (!isFinite(clear) || clear < 0) clear = 0;
    clear = Math.round(Math.min(clear, 120));
    document.documentElement.style.setProperty('--taskbar-clear', clear + 'px');
  }

  let _clockInterval = null;

  function initClock() {
    const clockEl = document.getElementById('hud-clock');
    const dateEl = document.getElementById('hud-date');
    if (!clockEl || !dateEl) return;
    const tubes = clockEl.querySelectorAll('.clock-tube');

    function update() {
      const now = new Date();
      const hrs = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');

      const time = hrs + mins + secs;
      tubes.forEach((tube, idx) => {
        const d = time[idx];
        if (tube.dataset.digit === d) return;
        tube.dataset.digit = d;
        tube.innerText = d;
        tube.classList.remove('tube-pop');
        void tube.offsetWidth;
        tube.classList.add('tube-pop');
        if (tube._popTimer) clearTimeout(tube._popTimer);
        tube._popTimer = setTimeout(() => tube.classList.remove('tube-pop'), 400);
      });

      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      dateEl.innerText = `${yyyy}.${mm}.${dd}`;
    }

    update();
    _clockInterval = setInterval(update, 1000);
  }


  function stopClock() {
    if (_clockInterval) {
      clearInterval(_clockInterval);
      _clockInterval = null;
    }
  }
  window.addEventListener('resize', applyTaskbarClearance);

  /**
   * AMADEUS nixie clock & taskbar clearance.
   * @property {() => void} applyTaskbarClearance - Sets --taskbar-clear from the window/screen height delta (Lively taskbar overlap).
   * @property {() => void} initClock - Starts the 1s HH:MM:SS nixie update with digit-flip pop animation.
   */
  window.AMADEUS.clock = {
    applyTaskbarClearance,
    initClock,
    stopClock,
  };
})();
