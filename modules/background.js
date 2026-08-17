// modules/background.js - AMADEUS Ambient Particle Layer & Beat Pulse
window.AMADEUS = window.AMADEUS || {};

(function() {
  let bgCanvas, bgCtx;
  let bgParticles = [];
  let bgW = 0, bgH = 0;
  const BG_PARTICLE_COUNT = 150;
  let beatGlowEl = null;

  function initBackground() {
    bgCanvas = document.getElementById('bg-canvas');
    if (!bgCanvas) return;
    bgCtx = bgCanvas.getContext('2d');

    function resize() {
      const dpr = window.AMADEUS.PERF.dpr;
      bgW = window.innerWidth;
      bgH = window.innerHeight;
      bgCanvas.width = Math.max(1, Math.round(bgW * dpr));
      bgCanvas.height = Math.max(1, Math.round(bgH * dpr));
      bgParticles = [];
      for (let i = 0; i < BG_PARTICLE_COUNT; i++) {
        bgParticles.push({
          x: Math.random() * bgW,
          y: Math.random() * bgH,
          vx: (Math.random() - 0.5) * 0.45,
          vy: (Math.random() - 0.5) * 0.45,
          r: Math.random() * 1.6 + 0.5,
          p: Math.random() * Math.PI * 2,
          tw: 0.02 + Math.random() * 0.05,
        });
      }
    }

    window.addEventListener('resize', resize);
    resize();
  }

  function updateBackground() {
    if (!bgCtx || bgW === 0) return;
    if (document.body.classList.contains('hide-bg')) return;
    const s = window.AMADEUS.state;
    if (s.isIdle) return;

    const t = performance.now() / 1000;
    const en = Math.max(0, Math.min(1, s.lastAudioLevel));
    const beat = s.bgBeatPulse;
    s.bgBeatPulse = Math.max(0, s.bgBeatPulse - 0.09);

    const dpr = window.AMADEUS.PERF.dpr;
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.clearRect(0, 0, bgW, bgH);

    const pace = 1 + en * 2.5 + beat * 5;
    bgCtx.fillStyle = 'rgba(255, 90, 110, 0.6)';
    for (const p of bgParticles) {
      p.x += p.vx * pace;
      p.y += p.vy * pace;
      if (p.x < -4) p.x = bgW + 4; else if (p.x > bgW + 4) p.x = -4;
      if (p.y < -4) p.y = bgH + 4; else if (p.y > bgH + 4) p.y = -4;
      const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * p.tw * 60 + p.p));
      bgCtx.globalAlpha = Math.min(1, a + beat * 0.55);
      const size = p.r * (1 + beat * 1.5);
      bgCtx.fillRect(p.x, p.y, size, size);
    }
    bgCtx.globalAlpha = 1;

    if (beat > 0.02) {
      const rp = 1 - beat;
      bgCtx.strokeStyle = `rgba(255, 90, 120, ${(0.45 * beat).toFixed(3)})`;
      bgCtx.lineWidth = 1.5;
      bgCtx.beginPath();
      bgCtx.arc(bgW / 2, bgH / 2, 60 + rp * Math.max(bgW, bgH) * 0.45, 0, Math.PI * 2);
      bgCtx.stroke();
    }

    drawEdgeStrip(8, 1, en);
    drawEdgeStrip(bgH - 14, -1, en);
  }

  function drawEdgeStrip(y, dir, en) {
    const N = 64;
    const seg = bgW / N;
    bgCtx.strokeStyle = 'rgba(255, 77, 85, 0.30)';
    bgCtx.lineWidth = 1;
    bgCtx.beginPath();
    const spec = window.AMADEUS.state.lastSpectrum;
    for (let i = 0; i <= N; i++) {
      const v = i < spec.length ? (spec[i] || 0) : 0;
      const amp = 2 + v * 24 * (0.35 + en * 1.2);
      const x = i * seg;
      const yv = y + dir * (amp + Math.sin(performance.now() / 320 + i * 0.45) * 1.5);
      if (i === 0) bgCtx.moveTo(x, yv);
      else bgCtx.lineTo(x, yv);
    }
    bgCtx.stroke();
  }

  function triggerBeatPulse() {
    const s = window.AMADEUS.state;
    const now = performance.now();
    if (now - s.lastBeatAt < 200) return;
    s.lastBeatAt = now;
    const l2d = s.live2DController;
    if (l2d && l2d.triggerBeat) l2d.triggerBeat();
    if (!beatGlowEl) beatGlowEl = document.getElementById('beat-glow');
    if (beatGlowEl) {
      beatGlowEl.classList.remove('beat');
      void beatGlowEl.offsetWidth;
      beatGlowEl.classList.add('beat');
    }
    s.bgBeatPulse = 1;
  }

  window.AMADEUS.background = {
    initBackground,
    updateBackground,
    triggerBeatPulse,
  };

  window.initBackground = initBackground;
  window.updateBackground = updateBackground;
  window.triggerBeatPulse = triggerBeatPulse;
})();
