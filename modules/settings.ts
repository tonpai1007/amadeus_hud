/// <reference path="../types/amadeus.d.ts" />
// modules/settings.js - AMADEUS Settings & Pet Mode Controller
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  const PET_MODE_KEY = 'amadeus.petMode';
  const PET_POS_KEY = 'amadeus.petPos';
  let petApply = null;
  let pendingPetMode = null;
  let settingsDrawerOpen = false;
  let closeSettingsDrawer = null;
  let SETTINGS = window.AMADEUS.SETTINGS_DEFAULTS
    ? JSON.parse(JSON.stringify(window.AMADEUS.SETTINGS_DEFAULTS))
    : {};
  window.AMADEUS.SETTINGS = SETTINGS;

  function loadSettings() {
    const base = JSON.parse(JSON.stringify(window.AMADEUS.SETTINGS_DEFAULTS));
    try {
      const saved = JSON.parse(localStorage.getItem(window.AMADEUS.SETTINGS_KEY) || 'null');
      if (saved) {
        if (typeof saved.theme === 'string') base.theme = saved.theme;
        base.widgets = Object.assign(base.widgets, saved.widgets || {});
        base.scope = Object.assign(base.scope, saved.scope || {});
        base.features = Object.assign(base.features, saved.features || {});
        if (saved.collapsedPanels && typeof saved.collapsedPanels === 'object') {
          base.collapsedPanels = Object.assign({}, saved.collapsedPanels);
        }
        if (saved.panelPositions && typeof saved.panelPositions === 'object') {
          base.panelPositions = Object.assign({}, saved.panelPositions);
        }
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

  const THEME_SCOPE_PRESETS: Record<string, { ch1: string; ch2: string }> = {
    skuld:   { ch1: '#ff4d55', ch2: '#ff55aa' },
    amber:   { ch1: '#ffaa40', ch2: '#ffc266' },
    sg0:     { ch1: '#98a6b8', ch2: '#bfa0c4' },
    amadeus: { ch1: '#00e5ff', ch2: '#7c4dff' },
  };

  function applyTheme(themeName: string, updateScopeColors: boolean = false) {
    const validThemes = ['skuld', 'amber', 'sg0', 'amadeus'];
    const theme = validThemes.includes(themeName) ? themeName : 'skuld';
    document.body.setAttribute('data-theme', theme);
    if (SETTINGS) {
      SETTINGS.theme = theme;
      if (updateScopeColors && THEME_SCOPE_PRESETS[theme]) {
        SETTINGS.scope.ch1 = THEME_SCOPE_PRESETS[theme].ch1;
        SETTINGS.scope.ch2 = THEME_SCOPE_PRESETS[theme].ch2;
        const ch1El = document.getElementById('scope-ch1') as HTMLInputElement | null;
        const ch2El = document.getElementById('scope-ch2') as HTMLInputElement | null;
        if (ch1El) ch1El.value = SETTINGS.scope.ch1;
        if (ch2El) ch2El.value = SETTINGS.scope.ch2;
      }
      saveSettings();
    }
    const select = document.getElementById('setting-theme') as HTMLSelectElement | null;
    if (select && select.value !== theme) select.value = theme;
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
      if (toggle) {
        toggle.classList.toggle('active', on);
        toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
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
      if (toggle) {
        toggle.classList.toggle('active', on);
        toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
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

  function updateSettingsDrawerUi(open?: boolean) {
    const panel = document.getElementById('settings-panel');
    const body = document.getElementById('settings-body');
    const header = document.getElementById('settings-toggle');
    const state = document.getElementById('settings-state');
    settingsDrawerOpen = open !== undefined ? open : !settingsDrawerOpen;
    if (panel) panel.classList.toggle('is-open', settingsDrawerOpen);
    if (body) {
      body.hidden = !settingsDrawerOpen;
      body.setAttribute('aria-hidden', String(!settingsDrawerOpen));
    }
    if (header) {
      header.setAttribute('aria-expanded', String(settingsDrawerOpen));
      header.setAttribute('aria-label', settingsDrawerOpen ? 'Close system options' : 'Open system options');
    }
    if (state) state.textContent = settingsDrawerOpen ? 'COLLAPSE' : 'EXPAND';
  }

  function initSettings() {
    SETTINGS = loadSettings();
    window.AMADEUS.SETTINGS = SETTINGS;
    if (window.AMADEUS.sfx) window.AMADEUS.sfx.setSfxEnabled(SETTINGS.sfx !== false);

    const header = document.getElementById('settings-toggle');
    const panel = document.getElementById('settings-panel');

    const toggleBody = () => {
      const panelEl = document.getElementById('settings-panel');
      const isOpen = panelEl && panelEl.classList.contains('is-open');
      updateSettingsDrawerUi(!isOpen);
      if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
    };
    closeSettingsDrawer = () => {
      const panelEl = document.getElementById('settings-panel');
      if (!panelEl || !panelEl.classList.contains('is-open')) return false;
      updateSettingsDrawerUi(false);
      return true;
    };

    if (panel) panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (header) {
      header.addEventListener('pointerdown', (e) => e.stopPropagation());
      header.addEventListener('click', toggleBody);
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleBody();
        }
      });
    }
    updateSettingsDrawerUi(false);

    document.querySelectorAll<HTMLInputElement>('#settings-body input').forEach((input) => {
      input.addEventListener('change', () => {
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playClickSound();
      });
    });

    document.querySelectorAll<HTMLInputElement>('#settings-body input[data-widget]').forEach((input) => {
      const id = input.dataset.widget || '';
      input.checked = SETTINGS.widgets[id] !== false;
      document.body.classList.toggle('hide-' + id, !input.checked);
      input.addEventListener('change', () => {
        SETTINGS.widgets[id] = input.checked;
        document.body.classList.toggle('hide-' + id, !input.checked);
        saveSettings();
      });
    });

    const sfxCheck = document.getElementById('setting-sfx') as HTMLInputElement | null;
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

    const petCheck = document.getElementById('setting-pet') as HTMLInputElement | null;
    if (petCheck) {
      petCheck.checked = SETTINGS.pet || localStorage.getItem(PET_MODE_KEY) === '1';
      petCheck.addEventListener('change', () => {
        if (petApply) petApply(petCheck.checked);
      });
    }

    document.querySelectorAll<HTMLInputElement>('#settings-body input[data-feature]').forEach((input) => {
      const name = input.dataset.feature || '';
      input.checked = SETTINGS.features[name] !== false;
      input.addEventListener('change', () => {
        SETTINGS.features[name] = input.checked;
        saveSettings();
        const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
        if (l2d && l2d.setFeature) {
          l2d.setFeature(name, input.checked);
        }
        if (name === 'focusMode' && window.AMADEUS.focus && window.AMADEUS.focus.setFeatureEnabled) {
          window.AMADEUS.focus.setFeatureEnabled(input.checked);
        }
      });
    });

    const voiceCheck = document.getElementById('setting-voice') as HTMLInputElement | null;
    if (voiceCheck) {
      voiceCheck.checked = SETTINGS.voice !== false;
      voiceCheck.addEventListener('change', () => {
        SETTINGS.voice = voiceCheck.checked;
        saveSettings();
      });
    }

    const syncScope = () => {
      const speedEl = document.getElementById('scope-speed') as HTMLInputElement | null;
      const densityEl = document.getElementById('scope-density') as HTMLInputElement | null;
      const ch1El = document.getElementById('scope-ch1') as HTMLInputElement | null;
      const ch2El = document.getElementById('scope-ch2') as HTMLInputElement | null;
      if (speedEl) SETTINGS.scope.speed = parseInt(speedEl.value, 10) || 5;
      if (densityEl) SETTINGS.scope.density = parseInt(densityEl.value, 10) || 5;
      if (ch1El) SETTINGS.scope.ch1 = ch1El.value;
      if (ch2El) SETTINGS.scope.ch2 = ch2El.value;
      saveSettings();
    };
    ['scope-speed', 'scope-density', 'scope-ch1', 'scope-ch2'].forEach((id) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      if (id === 'scope-speed') el.value = SETTINGS.scope.speed;
      if (id === 'scope-density') el.value = SETTINGS.scope.density;
      if (id === 'scope-ch1') el.value = SETTINGS.scope.ch1;
      if (id === 'scope-ch2') el.value = SETTINGS.scope.ch2;
      el.addEventListener('input', syncScope);
    });

    // Theme Engine Selector
    applyTheme(SETTINGS.theme || 'skuld');
    const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
    if (themeSelect) {
      themeSelect.value = SETTINGS.theme || 'skuld';
      themeSelect.addEventListener('change', () => {
        applyTheme(themeSelect.value, true);
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playClickSound();
      });
    }

    // Cinematic Mode Button
    const cinematicBtn = document.getElementById('btn-cinematic-toggle');
    if (cinematicBtn) {
      cinematicBtn.addEventListener('click', () => toggleCinematicMode(true));
    }
    const cinematicExitBtn = document.getElementById('cinematic-exit-btn');
    if (cinematicExitBtn) {
      cinematicExitBtn.addEventListener('click', () => toggleCinematicMode(false));
    }
    updateCinematicUi(document.body.classList.contains('cinematic-mode'));

    // Reset Panel Positions Button
    const resetPosBtn = document.getElementById('btn-reset-positions');
    if (resetPosBtn) {
      resetPosBtn.addEventListener('click', () => {
        resetPanelPositions();
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
      });
    }

    // Initialize per-panel collapse and draggable panels
    initPanelCollapse();
    initDraggablePanels();
  }

  function initPanelCollapse() {
    if (!SETTINGS.collapsedPanels) SETTINGS.collapsedPanels = {};

    document.querySelectorAll('.panel-collapse-btn').forEach((btnEl) => {
      const btn = btnEl as HTMLButtonElement;
      const panelKey = btn.dataset.panel;
      const panel = btn.closest('.hud-panel') as HTMLElement | null;
      if (!panel || !panelKey) return;

      // Restore collapsed state
      if (SETTINGS.collapsedPanels[panelKey]) {
        panel.classList.add('panel-collapsed');
      }

      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = panel.classList.toggle('panel-collapsed');
        SETTINGS.collapsedPanels[panelKey] = isCollapsed;
        saveSettings();
        if (window.AMADEUS.sfx) window.AMADEUS.sfx.playClickSound();
      });
    });
  }

  function initDraggablePanels() {
    if (!SETTINGS.panelPositions) SETTINGS.panelPositions = {};

    const panels = document.querySelectorAll('.hud-panel');
    panels.forEach((panelEl) => {
      const panel = panelEl as HTMLElement;
      const panelId = panel.id
        || (panel.classList.contains('top-left-panel') ? 'top-left-panel' : '')
        || (panel.classList.contains('top-right-panel') ? 'top-right-panel' : '')
        || (panel.classList.contains('bottom-left-panel') ? 'bottom-left-panel' : '')
        || panel.className.split(' ')[1]
        || '';
      if (!panelId) return;

      // Restore persisted positions
      const pos = SETTINGS.panelPositions[panelId];
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        const maxX = Math.max(0, window.innerWidth - (panel.offsetWidth || 280));
        const maxY = Math.max(0, window.innerHeight - (panel.offsetHeight || 100));
        const clampedX = Math.max(0, Math.min(pos.x, maxX));
        const clampedY = Math.max(0, Math.min(pos.y, maxY));
        panel.style.left = clampedX + 'px';
        panel.style.top = clampedY + 'px';
        panel.classList.add('panel-dragged');
      }

      const header = panel.querySelector('.panel-header') as HTMLElement | null;
      if (!header) return;

      let isDragging = false;
      let startX = 0, startY = 0;
      let initialLeft = 0, initialTop = 0;

      const onPointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('button, input, select, textarea, a, .feed-toggle, .panel-header-actions')) return;
        if (e.button !== 0) return;

        isDragging = true;
        panel.classList.add('is-dragging');
        header.setPointerCapture(e.pointerId);

        const rect = panel.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;

        e.preventDefault();
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const panelWidth = panel.offsetWidth || 280;
        const panelHeight = panel.offsetHeight || 100;
        const maxX = Math.max(0, window.innerWidth - panelWidth);
        const maxY = Math.max(0, window.innerHeight - panelHeight);

        const newLeft = Math.max(0, Math.min(initialLeft + dx, maxX));
        const newTop = Math.max(0, Math.min(initialTop + dy, maxY));

        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
        panel.classList.add('panel-dragged');
      };

      const onPointerUp = (e: PointerEvent) => {
        if (!isDragging) return;
        isDragging = false;
        panel.classList.remove('is-dragging');
        try { header.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        const rect = panel.getBoundingClientRect();
        SETTINGS.panelPositions[panelId] = { x: Math.round(rect.left), y: Math.round(rect.top) };
        saveSettings();
      };

      header.addEventListener('pointerdown', onPointerDown);
      header.addEventListener('pointermove', onPointerMove);
      header.addEventListener('pointerup', onPointerUp);
      header.addEventListener('pointercancel', onPointerUp);
    });
  }

  function resetPanelPositions() {
    SETTINGS.panelPositions = {};
    saveSettings();
    document.querySelectorAll('.hud-panel').forEach((panelEl) => {
      const panel = panelEl as HTMLElement;
      panel.style.left = '';
      panel.style.top = '';
      panel.classList.remove('panel-dragged');
      panel.classList.remove('is-dragging');
    });
  }

  function updateCinematicUi(isCinematic: boolean) {
    const enterBtn = document.getElementById('btn-cinematic-toggle') as HTMLButtonElement | null;
    const exitBtn = document.getElementById('cinematic-exit-btn') as HTMLButtonElement | null;
    const stateEl = document.getElementById('cinematic-state');

    document.body.classList.toggle('cinematic-mode', isCinematic);
    if (enterBtn) {
      enterBtn.hidden = isCinematic;
      enterBtn.setAttribute('aria-pressed', isCinematic ? 'true' : 'false');
    }
    if (exitBtn) {
      exitBtn.hidden = !isCinematic;
    }
    if (stateEl) stateEl.textContent = isCinematic ? 'CINEMATIC' : 'STANDBY';
  }

  function toggleCinematicMode(force?: boolean): boolean {
    const isCinematic = typeof force === 'boolean'
      ? force
      : !document.body.classList.contains('cinematic-mode');
    updateCinematicUi(isCinematic);
    if (window.AMADEUS.sfx) {
      if (isCinematic) window.AMADEUS.sfx.playBeepSound();
      else window.AMADEUS.sfx.playClickSound();
    }
    return isCinematic;
  }

  /**
   * AMADEUS settings, theme engine & pet mode controller.
   * @property {() => object} loadSettings - Deep-clones SETTINGS_DEFAULTS, merges persisted overrides, runs the one-shot legacy color migration.
   * @property {() => void} saveSettings - Persists the current settings object to localStorage.
   * @property {() => void} initSettings - Reads settings, binds the settings panel inputs, theme, collapses, and drag positions.
   * @property {() => void} initPetMode - Binds the PET toggle and drag persistence for pet mode.
   * @property {(themeName: string, updateScope?: boolean) => void} applyTheme - Applies a theme preset (skuld/amber/sg0/amadeus).
   * @property {() => void} resetPanelPositions - Resets all dragged panels back to default corners.
   * @property {(force?: boolean) => boolean} toggleCinematicMode - Toggles Kurisu focus cinematic mode.
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
    applyTheme,
    resetPanelPositions,
    toggleCinematicMode,
    updateSettingsDrawerUi,
    updateCinematicUi,
    closeSettingsDrawer: () => closeSettingsDrawer ? closeSettingsDrawer() : false,
    pushFeaturesToController,
    petApply: (on) => { if (petApply) petApply(on); else pendingPetMode = on; },
    getSettings: () => SETTINGS,
  };
})();
