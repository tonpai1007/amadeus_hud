// modules/settings.js - AMADEUS Settings & Pet Mode Controller
window.AMADEUS = window.AMADEUS || {};

(function() {
  const PET_MODE_KEY = 'amadeus.petMode';
  const PET_POS_KEY = 'amadeus.petPos';
  let petApply = null;
  let pendingPetMode = null;
  let SETTINGS = window.AMADEUS.SETTINGS_DEFAULTS
    ? JSON.parse(JSON.stringify(window.AMADEUS.SETTINGS_DEFAULTS))
    : {};
  window.AMADEUS.SETTINGS = SETTINGS;

  function loadSettings() {
    const base = JSON.parse(JSON.stringify(window.AMADEUS.SETTINGS_DEFAULTS));
    try {
      const saved = JSON.parse(localStorage.getItem(window.AMADEUS.SETTINGS_KEY) || 'null');
      if (saved) {
        base.widgets = Object.assign(base.widgets, saved.widgets || {});
        base.scope = Object.assign(base.scope, saved.scope || {});
        base.features = Object.assign(base.features, saved.features || {});
        if (typeof saved.pet === 'boolean') base.pet = saved.pet;
        if (typeof saved.voice === 'boolean') base.voice = saved.voice;
        if (typeof saved.sfx === 'boolean') base.sfx = saved.sfx;
      }
    } catch (e) { /* ignore */ }

    // One-shot legacy palette migration (old green/violet -> Amadeus red).
    // Gated behind a localStorage flag so a deliberately chosen legacy color
    // isn't silently reset on every load.
    let colorMigrated = false;
    try { colorMigrated = localStorage.getItem('amadeus.colorMigrationV1') === '1'; } catch (e) { /* ignore */ }
    if (!colorMigrated) {
      if (/^(#)?39ff7a$/i.test(base.scope.ch1 || '')) base.scope.ch1 = '#ff4d55';
      if (/^(#)?b388ff$/i.test(base.scope.ch2 || '')) base.scope.ch2 = '#ff55aa';
      try { localStorage.setItem('amadeus.colorMigrationV1', '1'); } catch (e) { /* ignore */ }
    }
    return base;
  }

  function saveSettings() {
    try { localStorage.setItem(window.AMADEUS.SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (e) { /* ignore */ }
  }

  function pushFeaturesToController() {
    const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
    if (!l2d || !l2d.setFeature) return;
    if (!SETTINGS || !SETTINGS.features) return;
    for (const name of Object.keys(SETTINGS.features)) {
      l2d.setFeature(name, SETTINGS.features[name] !== false);
    }
  }

  const INTERACT_MODE_KEY = 'amadeus.interactMode';

  function initInteractMode() {
    const toggle = document.getElementById('interact-toggle');
    const stateEl = document.getElementById('interact-toggle-state');
    const canvas = document.getElementById('live2d-canvas');

    const updateUI = () => {
      const on = canvas && canvas.classList.contains('interact-mode');
      document.body.classList.toggle('interact-mode', on);
      if (toggle) toggle.classList.toggle('active', on);
      if (stateEl) stateEl.innerText = on ? 'ON' : 'OFF';
    };

    const apply = (on) => {
      if (canvas) canvas.classList.toggle('interact-mode', on);
      document.body.classList.toggle('interact-mode', on);
      try { localStorage.setItem(INTERACT_MODE_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
      updateUI();
    };

    try {
      if (localStorage.getItem(INTERACT_MODE_KEY) === '1') apply(true);
    } catch (e) { /* ignore */ }

    if (toggle) {
      toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
      toggle.addEventListener('click', () => {
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
        const isOn = canvas && canvas.classList.contains('interact-mode');
        apply(!isOn);
      });
    }
  }

  function initPetMode() {
    const toggle = document.getElementById('pet-toggle');
    const stateEl = document.getElementById('pet-toggle-state');
    const s = window.AMADEUS.state;

    const updateUI = () => {
      const on = !!(s.live2DController && s.live2DController._petMode);
      document.body.classList.toggle('pet-mode', on);
      if (toggle) toggle.classList.toggle('active', on);
      if (stateEl) stateEl.innerText = on ? 'ON' : 'OFF';
    };

    const apply = (on) => {
      const l2d = s.live2DController;
      if (!l2d || !l2d.setPetMode) return;
      if (on) {
        let nx = 0.82, ny = 0.86;
        try {
          const saved = JSON.parse(localStorage.getItem(PET_POS_KEY) || 'null');
          if (saved && typeof saved.nx === 'number') {
            nx = saved.nx;
            ny = saved.ny;
          }
        } catch (e) { /* ignore */ }
        l2d.setPetMode(true);
        l2d.setPetPosition(nx, ny);
      } else {
        l2d.setPetMode(false);
      }
      try { localStorage.setItem(PET_MODE_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
      updateUI();
      if (SETTINGS) SETTINGS.pet = on;
    };
    petApply = apply;
    if (pendingPetMode !== null) {
      apply(pendingPetMode);
      pendingPetMode = null;
    }

    if (toggle) {
      toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
      toggle.addEventListener('click', () => {
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
        apply(!(s.live2DController && s.live2DController._petMode));
      });
    }

    if (s.live2DController) {
      s.live2DController.onPetMoved = () => {
        const model = s.live2DController.model;
        const view = s.live2DController.app && s.live2DController.app.view;
        if (!model || !view || !view.width) return;
        try {
          localStorage.setItem(PET_POS_KEY, JSON.stringify({
            nx: model.x / view.width,
            ny: model.y / view.height,
          }));
        } catch (e) { /* ignore */ }
      };
    }

    if (localStorage.getItem(PET_MODE_KEY) === '1') apply(true);
    updateUI();
  }

  function initSettings() {
    SETTINGS = loadSettings();
    window.AMADEUS.SETTINGS = SETTINGS;
    if (window.AMADEUS.sfx) window.AMADEUS.sfx.setSfxEnabled(SETTINGS.sfx !== false);

    const toggleBody = () => {
      const body = document.getElementById('settings-body');
      const state = document.getElementById('settings-state');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      if (state) state.innerText = open ? 'EXPAND' : 'COLLAPSE';
      if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
    };

    const header = document.getElementById('settings-toggle');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (header) {
      header.addEventListener('pointerdown', (e) => e.stopPropagation());
      header.addEventListener('click', toggleBody);
    }

    document.querySelectorAll('#settings-body input').forEach((input) => {
      input.addEventListener('change', () => {
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playClickSound();
      });
    });

    document.querySelectorAll('#settings-body input[data-widget]').forEach((input) => {
      const id = input.dataset.widget;
      input.checked = SETTINGS.widgets[id] !== false;
      document.body.classList.toggle('hide-' + id, !input.checked);
      input.addEventListener('change', () => {
        SETTINGS.widgets[id] = input.checked;
        document.body.classList.toggle('hide-' + id, !input.checked);
        saveSettings();
      });
    });

    const sfxCheck = document.getElementById('setting-sfx');
    if (sfxCheck) {
      sfxCheck.checked = SETTINGS.sfx !== false;
      if (window.AMADEUS.sfx) window.AMADEUS.sfx.setSfxEnabled(sfxCheck.checked);
      sfxCheck.addEventListener('change', () => {
        if (window.AMADEUS.sfx) {
          window.AMADEUS.sfx.setSfxEnabled(sfxCheck.checked);
          if (sfxCheck.checked) window.AMADEUS.sfx.playBeepSound();
        }
        SETTINGS.sfx = sfxCheck.checked;
        saveSettings();
      });
    }

    const petCheck = document.getElementById('setting-pet');
    if (petCheck) {
      petCheck.checked = SETTINGS.pet || localStorage.getItem(PET_MODE_KEY) === '1';
      petCheck.addEventListener('change', () => {
        if (petApply) petApply(petCheck.checked);
      });
    }

    document.querySelectorAll('#settings-body input[data-feature]').forEach((input) => {
      const name = input.dataset.feature;
      input.checked = SETTINGS.features[name] !== false;
      input.addEventListener('change', () => {
        SETTINGS.features[name] = input.checked;
        saveSettings();
        const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
        if (l2d && l2d.setFeature) {
          l2d.setFeature(name, input.checked);
        }
      });
    });

    const voiceCheck = document.getElementById('setting-voice');
    if (voiceCheck) {
      voiceCheck.checked = SETTINGS.voice !== false;
      voiceCheck.addEventListener('change', () => {
        SETTINGS.voice = voiceCheck.checked;
        saveSettings();
      });
    }

    const syncScope = () => {
      const speedEl = document.getElementById('scope-speed');
      const densityEl = document.getElementById('scope-density');
      const ch1El = document.getElementById('scope-ch1');
      const ch2El = document.getElementById('scope-ch2');
      if (speedEl) SETTINGS.scope.speed = parseInt(speedEl.value, 10) || 5;
      if (densityEl) SETTINGS.scope.density = parseInt(densityEl.value, 10) || 5;
      if (ch1El) SETTINGS.scope.ch1 = ch1El.value;
      if (ch2El) SETTINGS.scope.ch2 = ch2El.value;
      saveSettings();
    };
    ['scope-speed', 'scope-density', 'scope-ch1', 'scope-ch2'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === 'scope-speed') el.value = SETTINGS.scope.speed;
      if (id === 'scope-density') el.value = SETTINGS.scope.density;
      if (id === 'scope-ch1') el.value = SETTINGS.scope.ch1;
      if (id === 'scope-ch2') el.value = SETTINGS.scope.ch2;
      el.addEventListener('input', syncScope);
    });
  }

  /**
   * AMADEUS settings & pet mode controller.
   * @property {() => object} loadSettings - Deep-clones SETTINGS_DEFAULTS, merges persisted overrides, runs the one-shot legacy color migration.
   * @property {() => void} saveSettings - Persists the current settings object to localStorage.
   * @property {() => void} initSettings - Reads settings, binds the settings panel inputs and widget toggles.
   * @property {() => void} initPetMode - Binds the PET toggle and drag persistence for pet mode.
   * @property {() => void} pushFeaturesToController - Pushes the feature-flag object into the Live2D controller.
   * @property {(on: boolean) => void} petApply - Turns pet mode (draggable avatar) on/off.
   * @property {() => object} getSettings - Live settings reference.
   */
  window.AMADEUS.settings = {
    loadSettings,
    saveSettings,
    initSettings,
    initPetMode,
    initInteractMode,
    pushFeaturesToController,
    petApply: (on) => { if (petApply) petApply(on); else pendingPetMode = on; },
    getSettings: () => SETTINGS,
  };
})();
