// modules/oscilloscope.js - AMADEUS Phosphor Oscilloscope & Cognitive Waveform
window.AMADEUS = window.AMADEUS || {};

(function() {
  let wlCanvas, wlCtx;
  let wlResize = null;

  const EMOTION_INTENSITY = {
    sleeping: 0.06, sleepy: 0.10, tired: 0.18, calm: 0.30, neutral: 0.30,
    content: 0.38, sad: 0.50, annoyed: 0.62, happy: 0.66, curious: 0.70,
    thinking: 0.76, angry: 0.80, excited: 0.86, surprised: 0.92,
  };

  const DASH_SCOPE = Object.freeze([3, 3]);
  const DASH_EMPTY = Object.freeze([]);

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  let _wlMetaInterval = null;

  function initWorldLine() {
    wlCanvas = document.getElementById('world-line-canvas');
    if (!wlCanvas) return;
    wlCtx = wlCanvas.getContext('2d');

    function resize() {
      const rect = wlCanvas.getBoundingClientRect();
      const dpr = window.AMADEUS.PERF.dpr;
      wlCanvas.width = Math.max(1, Math.round(rect.width * dpr));
      wlCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    }

    wlResize = resize;
    window.addEventListener('resize', resize);
    resize();
    _wlMetaInterval = setInterval(updateWorldLineMeta, 500);
  }

  function stopWorldLineMeta() {
    if (_wlMetaInterval) {
      clearInterval(_wlMetaInterval);
      _wlMetaInterval = null;
    }
  }

  function drawScopeGraticule(w, h) {
    wlCtx.lineWidth = 1;
    wlCtx.strokeStyle = 'rgba(255, 77, 85, 0.08)';
    const grid = 18;
    for (let x = grid; x < w; x += grid) {
      wlCtx.beginPath();
      wlCtx.moveTo(x, 0);
      wlCtx.lineTo(x, h);
      wlCtx.stroke();
    }
    for (let y = grid; y < h; y += grid) {
      wlCtx.beginPath();
      wlCtx.moveTo(0, y);
      wlCtx.lineTo(w, y);
      wlCtx.stroke();
    }
    wlCtx.strokeStyle = 'rgba(255, 77, 85, 0.12)';
    wlCtx.beginPath();
    wlCtx.moveTo(0, h / 2);
    wlCtx.lineTo(w, h / 2);
    wlCtx.stroke();
  }

  function updateWorldLine() {
    if (!wlCtx || !wlCanvas) return;
    const s = window.AMADEUS.state;
    if (s.isLivelyPaused || s.isIdle) return;
    if (document.body.classList.contains('hide-scope')) return;

    const w = wlCanvas.width;
    const h = wlCanvas.height;

    wlCtx.fillStyle = 'rgba(2, 4, 10, 0.38)';
    wlCtx.fillRect(0, 0, w, h);
    drawScopeGraticule(w, h);

    const audio = Math.max(0, Math.min(1, s.lastAudioLevel));
    s.audioEnv += (audio - s.audioEnv) * 0.5;

    const ctrl = s.live2DController;
    const emotion = (ctrl && ctrl.currentEmotion) || 'neutral';
    let mindTarget = EMOTION_INTENSITY[emotion] || 0.3;
    if (ctrl) {
      if (ctrl.isThinking) mindTarget = Math.max(mindTarget, 0.9);
      else if (ctrl.isTyping) mindTarget = Math.max(mindTarget, 0.72);
      else if (ctrl.isSpeaking) mindTarget = Math.max(mindTarget, 0.6);
    }
    s.mindEnergy += (mindTarget - s.mindEnergy) * 0.12;
    const mind = Math.min(1, Math.max(0, s.mindEnergy));

    s.mindBaseline += (0.04 * mind * (emotion === 'sad' ? 0.3 :
                emotion === 'thinking' || emotion === 'curious' ? 0.8 :
                emotion === 'annoyed' || emotion === 'angry' ? 1.2 : 0.6) - s.mindBaseline) * 0.04;

    const spec = s.lastSpectrum;

    for (let i = 0; i < s.smoothSpec.length; i++) {
      s.smoothSpec[i] += ((spec[i] || 0) - s.smoothSpec[i]) * 0.55;
    }

    for (let i = 0; i < s.peakSpec.length; i++) {
      if (s.smoothSpec[i] > s.peakSpec[i]) {
        s.peakSpec[i] = s.smoothSpec[i];
      } else {
        s.peakSpec[i] *= s.peakFalloff;
      }
    }

    const settings = window.AMADEUS.SETTINGS || window.AMADEUS.SETTINGS_DEFAULTS;
    const sc = settings.scope || window.AMADEUS.SETTINGS_DEFAULTS.scope;
    const c1 = hexToRgb(sc.ch1) || { r: 57, g: 255, b: 122 };
    const c2 = hexToRgb(sc.ch2) || { r: 255, g: 85, b: 170 };
    const step = window.AMADEUS.PERF_LEVELS[window.AMADEUS.getPerfLevel()].scopeStep;

    const N = s.peakSpec.length;
    let sigSum = 0;
    for (let i = 0; i < N; i++) sigSum += s.peakSpec[i];
    const drive = Math.min(1, 0.15 + s.audioEnv * (0.3 + 0.7 * Math.min(1, sigSum / 4)));
    const peakAmp = h * 0.30 * drive;
    const barW = Math.max(2, Math.floor(w / N) - 1);
    const baseY = h * 0.70;

    wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.18)`;
    wlCtx.fillRect(0, baseY, w, 1);

    wlCtx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = s.peakSpec[i];
      if (a < 0.004) continue;
      const x = (i / N) * w;
      const barH = a * peakAmp;
      wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.10)`;
      wlCtx.fillRect(x, baseY - barH - 2, barW + 4, barH + 3);
    }
    wlCtx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = s.peakSpec[i];
      if (a < 0.004) continue;
      const x = (i / N) * w;
      const barH = a * peakAmp;
      wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, ${Math.min(1, 0.35 + a * 1.3)})`;
      wlCtx.fillRect(x, baseY - barH, barW, barH + 1);
    }
    wlCtx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = s.peakSpec[i];
      if (a < 0.004) continue;
      const x = (i / N) * w;
      const barH = a * peakAmp;
      wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.95)`;
      wlCtx.fillRect(x - 1, baseY - barH - 1, barW + 2, 1.5);
    }

    s.wlPhase2 += 0.08 + mind * 0.12;
    const mindAmp = h * 0.15 * (0.10 + 0.90 * mind);

    const e = emotion;
    let waveFreq = 4.2;
    let hiFreq = 13.1;
    let loDepth = 0.32;
    let hiDepth = 0.24;
    let jitterAmp = 0.02;
    let jitterScale = 1.0;

    if (e === 'sleeping' || e === 'sleepy') {
      waveFreq = 1.2; hiFreq = 6.1; loDepth = 0.44; hiDepth = 0.08;
      jitterAmp = 0.005;
    } else if (e === 'calm' || e === 'content') {
      waveFreq = 3.5; hiFreq = 9.2; loDepth = 0.38; hiDepth = 0.16;
      jitterAmp = 0.01;
    } else if (e === 'happy' || e === 'excited' || e === 'surprised') {
      waveFreq = 8.4; hiFreq = 22.3; loDepth = 0.24; hiDepth = 0.36;
      jitterAmp = 0.03;
    } else if (e === 'thinking' || e === 'curious') {
      waveFreq = 6.8; hiFreq = 17.6; loDepth = 0.28; hiDepth = 0.32;
      jitterAmp = 0.04;
      jitterScale = 1.8;
    } else if (e === 'annoyed' || e === 'angry') {
      waveFreq = 11.2; hiFreq = 28.4; loDepth = 0.42; hiDepth = 0.44;
      jitterAmp = 0.06;
      jitterScale = 2.2;
    } else if (e === 'sad') {
      waveFreq = 2.8; hiFreq = 7.8; loDepth = 0.48; hiDepth = 0.06;
      jitterAmp = 0.01;
    }

    if (ctrl) {
      if (ctrl.isThinking) { waveFreq *= 1.6; jitterAmp *= 1.5; }
      else if (ctrl.isTyping) { waveFreq *= 1.3; jitterAmp *= 1.3; }
      else if (ctrl.isSpeaking) { waveFreq *= 1.15; jitterAmp *= 1.2; }
    }
    const spikeThreshold = (ctrl && ctrl.isThinking) ? 0.92 : 0.98;
    const spikeFreq = (ctrl && ctrl.isThinking) ? 0.014 : 0.021;
    const spikeAmp = 0.7 * mind;

    wlCtx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const t = x / w;
      const ph = s.wlPhase2;
      let v =
          loDepth * Math.sin(t * Math.PI * 2 * waveFreq * 0.34 + ph * 0.3)
        + 0.38 * Math.sin(t * Math.PI * 2 * waveFreq * 0.7 + ph * 0.8 + 0.8)
        + 0.32 * Math.sin(t * Math.PI * 2 * waveFreq * 1.2 + ph * 1.4 + 1.9)
        + hiDepth * Math.sin(t * Math.PI * 2 * hiFreq + ph * 2.3 + 3.1);
      v *= 0.20 + 0.80 * mind;

      const sp = Math.sin(x * spikeFreq + Math.floor(ph / 4) * 5.17);
      if (sp > spikeThreshold) {
        v -= spikeAmp * sp;
      }
      if (e === 'happy' || e === 'excited') {
        v += 0.15 * Math.sin(t * Math.PI * 2 * 2.1 + ph * 0.5);
      } else if (e === 'sad') {
        v -= 0.2 * Math.abs(Math.sin(t * Math.PI * 2 * 0.8 + ph * 0.2)) * 0.5;
      } else if (e === 'annoyed' || e === 'angry') {
        v += 0.18 * Math.sin(t * Math.PI * 2 * 45 + ph * 3.5);
      }
      v += (Math.random() * 2 - 1) * jitterAmp * jitterScale;
      v = Math.max(-1.15, Math.min(1.15, v));
      const y = h * 0.22 + s.mindBaseline * 8 - v * mindAmp;
      if (x === 0) wlCtx.moveTo(x, y);
      else wlCtx.lineTo(x, y);
    }

    const glowR = c2.r + Math.round((255 - c2.r) * mind * 0.3);
    const glowG = c2.g + Math.round((200 - c2.g) * mind * 0.3);
    const glowB = c2.b + Math.round((255 - c2.b) * mind * 0.3);
    wlCtx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, 0.22)`;
    wlCtx.lineWidth = 7;
    wlCtx.shadowBlur = 5;
    wlCtx.shadowColor = `rgba(${glowR}, ${glowG}, ${glowB}, 0.35)`;
    wlCtx.stroke();

    wlCtx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, 0.98)`;
    wlCtx.lineWidth = 1.5;
    wlCtx.shadowBlur = 0;
    wlCtx.stroke();

    const sx = w - 1;
    const scan = wlCtx.createLinearGradient(sx - 14, 0, sx, 0);
    scan.addColorStop(0, 'rgba(255, 77, 85, 0)');
    scan.addColorStop(1, 'rgba(255, 77, 85, 0.4)');
    wlCtx.fillStyle = scan;
    wlCtx.fillRect(sx - 14, 0, 14, h);
    wlCtx.fillStyle = 'rgba(255, 77, 85, 0.7)';
    wlCtx.fillRect(sx, 0, 1, h);

    const triggerY = h * 0.22 + s.mindBaseline * 8 - mindAmp * mind;
    wlCtx.setLineDash(DASH_SCOPE);
    wlCtx.strokeStyle = `rgba(255, 85, 170, ${0.25 + mind * 0.4})`;
    wlCtx.lineWidth = 1;
    wlCtx.beginPath();
    wlCtx.moveTo(8, triggerY);
    wlCtx.lineTo(w - 20, triggerY);
    wlCtx.stroke();
    wlCtx.setLineDash(DASH_EMPTY);

    wlCtx.font = '9px "Share Tech Mono", monospace';
    wlCtx.textBaseline = 'top';
    wlCtx.fillStyle = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.9)`;
    wlCtx.fillText('SIG ' + Math.round(audio * 100) + '%', 4, 3);
    wlCtx.fillStyle = `rgba(${c2.r}, ${c2.g}, ${c2.b}, 0.9)`;
    wlCtx.fillText('MIND ' + Math.round(mind * 100) + '%', w - 44, 3);
  }

  function updateWorldLineMeta() {
    const s = window.AMADEUS.state;
    if (s.isLivelyPaused || s.isIdle) return;
    const audioEl = document.getElementById('wl-audio');
    const mindEl = document.getElementById('wl-mind');
    if (audioEl) audioEl.innerText = 'SIG ' + Math.round(s.lastAudioLevel * 100) + '%';
    if (mindEl) mindEl.innerText = 'MIND ' + Math.round(s.mindEnergy * 100) + '%';
  }

  /**
   * AMADEUS phosphor oscilloscope & cognitive waveform.
   * @property {() => void} initWorldLine - Binds #world-line-canvas, sizes it and starts the 500ms meta readout interval.
   * @property {() => void} updateWorldLine - Draws one phosphor frame (audio trace + mind trace + graticule); called from the master visual tick.
   * @property {() => void} updateWorldLineMeta - Updates the SIG/MIND text readouts.
   * @property {() => Function|null} getResizeCallback - Resize handler for registry re-attachment.
   * @property {(hex: string) => {r: number, g: number, b: number}|null} hexToRgb - Pure: parses "#rrggbb" into an RGB triplet, null on malformed input.
   */
  window.AMADEUS.oscilloscope = {
    initWorldLine,
    updateWorldLine,
    updateWorldLineMeta,
    stopWorldLineMeta,
    getResizeCallback: () => wlResize,
    hexToRgb,
  };
})();
