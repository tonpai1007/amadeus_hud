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

  let liveColor = { r: 255, g: 90, b: 110 };

  function computeParticleTheme(s, t) {
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour >= 22;
    const mood = s.mood || 50;
    const en = Math.max(0, Math.min(1, s.lastAudioLevel || 0));
    const emo = s?.live2DController?.currentEmotion || 'neutral';

    let [targetR, targetG, targetB] = [255, 90, 110];

    if (en > 0.45 || emo === 'excited') {
      [targetR, targetG, targetB] = [255, 70, 180];
    } else if (mood >= 70 || emo === 'happy') {
      [targetR, targetG, targetB] = [255, 150, 170];
    } else if (mood < 40 || emo === 'sad') {
      [targetR, targetG, targetB] = [130, 120, 240];
    } else if (emo === 'annoyed' || emo === 'angry') {
      [targetR, targetG, targetB] = [255, 50, 65];
    } else if (isNight) {
      [targetR, targetG, targetB] = [160, 90, 210];
    }

    // Beat pulse flash to bright peach/gold
    if (s.bgBeatPulse > 0.1) {
      targetR = targetR + (255 - targetR) * s.bgBeatPulse;
      targetG = targetG + (230 - targetG) * s.bgBeatPulse;
      targetB = targetB + (210 - targetB) * s.bgBeatPulse;
    }

    // Smooth lerp
    liveColor.r += (targetR - liveColor.r) * 0.06;
    liveColor.g += (targetG - liveColor.g) * 0.06;
    liveColor.b += (targetB - liveColor.b) * 0.06;

    return `rgb(${Math.round(liveColor.r)}, ${Math.round(liveColor.g)}, ${Math.round(liveColor.b)})`;
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

    const colStr = computeParticleTheme(s, t);
    const pace = 1 + en * 2.5 + beat * 5;
    
    // Draw particles
    bgCtx.fillStyle = colStr;
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

    // Neural Constellation Links: connect nearby particles with delicate faint lines
    if (bgParticles.length > 0 && !document.body.classList.contains('hide-bg')) {
      const linkDist = 58 + en * 25;
      bgCtx.strokeStyle = `rgba(${Math.round(liveColor.r)}, ${Math.round(liveColor.g)}, ${Math.round(liveColor.b)}, 0.12)`;
      bgCtx.lineWidth = 0.6;
      bgCtx.beginPath();
      for (let i = 0; i < 45; i++) {
        const p1 = bgParticles[i];
        if (!p1) break;
        for (let j = i + 1; j < 45; j++) {
          const p2 = bgParticles[j];
          if (!p2) break;
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          if (Math.abs(dx) < linkDist && Math.abs(dy) < linkDist) {
            const dist = Math.hypot(dx, dy);
            if (dist < linkDist) {
              bgCtx.moveTo(p1.x, p1.y);
              bgCtx.lineTo(p2.x, p2.y);
            }
          }
        }
      }
      bgCtx.stroke();
    }

    if (beat > 0.02) {
      const rp = 1 - beat;
      bgCtx.strokeStyle = `rgba(${Math.round(liveColor.r)}, ${Math.round(liveColor.g)}, ${Math.round(liveColor.b)}, ${(0.45 * beat).toFixed(3)})`;
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
    s?.live2DController?.triggerBeat?.();
    if (!beatGlowEl) beatGlowEl = document.getElementById('beat-glow');
    if (beatGlowEl) {
      beatGlowEl.classList.remove('beat');
      if (beatGlowEl.offsetHeight) {
        // Force reflow
      }
      beatGlowEl.classList.add('beat');
    }
    s.bgBeatPulse = 1;
  }

  /**
   * AMADEUS ambient particle layer & beat pulse.
   * @property {() => void} initBackground - Binds #bg-canvas and (re)seeds the 150 drifting particles on resize.
   * @property {() => void} updateBackground - Advances and paints one particle frame (constellation links, beat shockwave, edge spectrum strips); called from the master visual tick.
   * @property {() => void} triggerBeatPulse - Fires the bass-kick pulse (rate-limited to 200ms) across particles, ring and Live2D bob.
   */
  window.AMADEUS.background = {
    initBackground,
    updateBackground,
    triggerBeatPulse,
  };
})();
