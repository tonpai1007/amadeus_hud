// modules/audio-ring.js - AMADEUS 2D Audio Visualizer Ring & Clockwork Gears
window.AMADEUS = window.AMADEUS || {};

(function() {
  let audioCanvas, ctx;
  let staticRingCanvas = null;
  let spinRingCanvas = null;
  let ringSpinAngle = 0;
  let gearSnapshot = null;
  let gearAngle = 0;
  let audioResize = null;
  let lastGearUpdate = 0;
  const DASH_RING_A = Object.freeze([2, 14]);
  const DASH_RING_B = Object.freeze([18, 6]);
  const DASH_EMPTY = Object.freeze([]);

  function initAudioCanvas() {
    audioCanvas = document.getElementById('audio-canvas');
    if (!audioCanvas) return;
    ctx = audioCanvas.getContext('2d');

    function resize() {
      const dpr = window.AMADEUS.PERF.dpr;
      audioCanvas.width = Math.round(window.innerWidth * dpr);
      audioCanvas.height = Math.round(window.innerHeight * dpr);
      buildStaticRing();
      buildSpinRing();
    }

    audioResize = resize;
    resize();
    window.addEventListener('resize', resize);
  }

  function buildStaticRing() {
    if (!audioCanvas) return;
    staticRingCanvas = document.createElement('canvas');
    staticRingCanvas.width = audioCanvas.width;
    staticRingCanvas.height = audioCanvas.height;
    const sctx = staticRingCanvas.getContext('2d');
    if (!sctx) return;

    const cx = staticRingCanvas.width / 2;
    const cy = staticRingCanvas.height / 2;
    const radius = Math.min(audioCanvas.width, audioCanvas.height) * 0.17;

    sctx.strokeStyle = 'rgba(255, 77, 85, 0.05)';
    sctx.lineWidth = 1;
    for (const r of [radius - 30, radius, radius + 30]) {
      sctx.beginPath();
      sctx.arc(cx, cy, r, 0, Math.PI * 2);
      sctx.stroke();
    }
    sctx.strokeStyle = 'rgba(255, 85, 170, 0.06)';
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      sctx.beginPath();
      sctx.moveTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      sctx.lineTo(cx + Math.cos(a) * (radius + 38), cy + Math.sin(a) * (radius + 38));
      sctx.stroke();
    }
  }

  function buildSpinRing() {
    if (!audioCanvas) return;
    spinRingCanvas = document.createElement('canvas');
    spinRingCanvas.width = audioCanvas.width;
    spinRingCanvas.height = audioCanvas.height;
    const g = spinRingCanvas.getContext('2d');
    if (!g) return;
    const cx = spinRingCanvas.width / 2;
    const cy = spinRingCanvas.height / 2;
    const radius = Math.min(audioCanvas.width, audioCanvas.height) * 0.17;

    g.strokeStyle = 'rgba(255, 77, 85, 0.35)';
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    const ticks = 60;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2;
      const inner = radius + 8;
      const outer = radius + (i % 5 === 0 ? 16 : 11);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      g.stroke();
    }

    g.setLineDash([3, 26]);
    g.strokeStyle = `rgba(255, 77, 85, 0.45)`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, radius - 6, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  function freqColor(freq) {
    if (freq < 0.5) {
      const t = freq * 2;
      return {
        r: Math.round(255 * (1 - t) + 255 * t),
        g: Math.round(77 * (1 - t) + 255 * t),
        b: Math.round(85 * (1 - t) + 255 * t)
      };
    } else {
      const t = (freq - 0.5) * 2;
      return {
        r: Math.round(255 * (1 - t) + 255 * t),
        g: Math.round(255 * (1 - t) + 85 * t),
        b: Math.round(255 * (1 - t) + 170 * t)
      };
    }
  }

  function drawGear(gctx, x, y, radius, teeth, angle, strokeColor) {
    gctx.save();
    gctx.strokeStyle = strokeColor;
    gctx.lineWidth = 1.0;
    gctx.translate(x, y);
    gctx.rotate(angle);

    gctx.beginPath();
    gctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
    gctx.stroke();

    gctx.beginPath();
    gctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
    gctx.stroke();

    gctx.beginPath();
    gctx.arc(0, 0, 8, 0, Math.PI * 2);
    gctx.stroke();

    const spokes = 6;
    for (let i = 0; i < spokes; i++) {
      const spokeAngle = (i / spokes) * Math.PI * 2;
      gctx.beginPath();
      gctx.moveTo(Math.cos(spokeAngle) * 8, Math.sin(spokeAngle) * 8);
      gctx.lineTo(Math.cos(spokeAngle) * radius * 0.9, Math.sin(spokeAngle) * radius * 0.9);
      gctx.stroke();
    }

    const toothWidth = (Math.PI * 2) / teeth / 2;
    gctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const curAngle = (i / teeth) * Math.PI * 2;
      const a1 = curAngle - toothWidth / 2;
      const a2 = curAngle + toothWidth / 2;
      const a3 = curAngle + toothWidth * 1.5;
      gctx.lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
      gctx.lineTo(Math.cos(a1) * (radius * 1.08), Math.sin(a1) * (radius * 1.08));
      gctx.lineTo(Math.cos(a2) * (radius * 1.08), Math.sin(a2) * (radius * 1.08));
      gctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
      gctx.lineTo(Math.cos(a3) * radius, Math.sin(a3) * radius);
    }
    gctx.closePath();
    gctx.stroke();
    gctx.restore();
  }

  function drawCoordinateDial(gctx, x, y, radius, ticks, angle, strokeColor) {
    gctx.save();
    gctx.strokeStyle = strokeColor;
    gctx.lineWidth = 1.0;
    gctx.translate(x, y);
    gctx.rotate(angle);
    gctx.beginPath();
    gctx.arc(0, 0, radius, 0, Math.PI * 2);
    gctx.stroke();
    gctx.beginPath();
    gctx.arc(0, 0, radius - 15, 0, Math.PI * 2);
    gctx.stroke();
    for (let i = 0; i < ticks; i++) {
      const tickAngle = (i / ticks) * Math.PI * 2;
      const len = i % 4 === 0 ? 10 : 5;
      gctx.beginPath();
      gctx.moveTo(Math.cos(tickAngle) * (radius - 15), Math.sin(tickAngle) * (radius - 15));
      gctx.lineTo(Math.cos(tickAngle) * (radius - 15 + len), Math.sin(tickAngle) * (radius - 15 + len));
      gctx.stroke();
    }
    gctx.restore();
  }

  function buildGearSnapshot(cx, cy, bass) {
    if (!audioCanvas) return;
    if (!gearSnapshot) {
      gearSnapshot = document.createElement('canvas');
      gearSnapshot.width = audioCanvas.width;
      gearSnapshot.height = audioCanvas.height;
    }
    const gctx = gearSnapshot.getContext('2d');
    gctx.clearRect(0, 0, gearSnapshot.width, gearSnapshot.height);

    const baseRotationSpeed = 0.0012;
    gearAngle += baseRotationSpeed + (bass * 0.0035);

    const scale = 1.0 + (bass * 0.04);
    const strokeColor = `rgba(255, 77, 85, ${0.07 + bass * 0.05})`;
    const lineStroke = `rgba(255, 77, 85, 0.035)`;

    const centers = [
      { x: cx - 400, y: cy - 120, r: 130, teeth: 36, speedMult: 1.0 },
      { x: cx - 580, y: cy - 120, r: 50, teeth: 14, speedMult: -2.57 },
      { x: cx + 450, y: cy + 150, r: 150, teeth: 40, speedMult: -0.7 },
      { x: cx + 230, y: cy + 150, r: 70, teeth: 18, speedMult: 1.55 },
      { x: cx - 250, y: cy + 220, r: 90, teeth: 24, speedMult: -1.2 },
      { x: cx + 380, y: cy - 200, r: 110, teeth: 28, speedMult: 1.4 }
    ];

    gctx.save();
    gctx.strokeStyle = lineStroke;
    gctx.lineWidth = 1.0;
    gctx.beginPath();
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const dist = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
        if (dist < 550) {
          gctx.moveTo(centers[i].x, centers[i].y);
          gctx.lineTo(centers[j].x, centers[j].y);
        }
      }
      gctx.moveTo(centers[i].x, centers[i].y);
      gctx.lineTo(cx, cy);
    }
    gctx.stroke();

    gctx.strokeStyle = `rgba(255, 77, 85, 0.015)`;
    for (let i = 0; i < centers.length; i++) {
      gctx.beginPath();
      gctx.arc(centers[i].x, centers[i].y, centers[i].r * 1.4, 0, Math.PI * 2);
      gctx.setLineDash([4, 12]);
      gctx.stroke();
      gctx.setLineDash([]);
    }
    gctx.restore();

    centers.forEach((c) => {
      const activeRadius = c.r * scale;
      const currentAngle = gearAngle * c.speedMult;
      drawGear(gctx, c.x, c.y, activeRadius, c.teeth, currentAngle, strokeColor);
      if (c.r > 80) {
        drawCoordinateDial(gctx, c.x, c.y, activeRadius * 1.22, 24, -currentAngle * 0.35, strokeColor);
      }
    });
  }

  function drawAudioRing(fftData, now) {
    if (!ctx || !audioCanvas) return;
    const s = window.AMADEUS.state;
    ctx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);

    const cx = audioCanvas.width / 2;
    const cy = audioCanvas.height / 2;
    const radius = Math.min(audioCanvas.width, audioCanvas.height) * 0.17;

    let bassSum = 0;
    for (let i = 0; i < 10; i++) bassSum += fftData[i] || 0;
    const bassAvg = bassSum / 10;
    const centerPulseRadius = radius - 20 + bassAvg * 25;

    const gearInterval = 1000 / window.AMADEUS.PERF.gearFps;
    if (now - lastGearUpdate >= gearInterval) {
      lastGearUpdate = now;
      buildGearSnapshot(cx, cy, bassAvg);
    }
    if (gearSnapshot) ctx.drawImage(gearSnapshot, 0, 0);
    if (staticRingCanvas) ctx.drawImage(staticRingCanvas, 0, 0);

    ringSpinAngle += 0.0015;
    if (spinRingCanvas) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringSpinAngle);
      ctx.drawImage(spinRingCanvas, -cx, -cy);
      ctx.restore();
    }

    ctx.strokeStyle = `rgba(255, 77, 85, ${0.10 + bassAvg * 0.45})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff4d55';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, centerPulseRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    const perfLevel = window.AMADEUS.getPerfLevel();
    const numBars = Math.min(fftData.length, window.AMADEUS.PERF_LEVELS[perfLevel].ringBars);
    ctx.lineCap = 'round';

    for (let i = 0; i < numBars; i++) {
      const angle = (i / numBars) * Math.PI * 2;
      const value = fftData[i] || 0;
      const maxLine = Math.min(audioCanvas.width, audioCanvas.height) * 0.08;
      const lineLength = Math.min(value * 80 * window.AMADEUS.PERF.dpr, maxLine);
      const freq = i / numBars;
      const barColor = freqColor(freq);

      const x1 = cx + Math.cos(angle) * radius;
      const y1 = cy + Math.sin(angle) * radius;
      let x2 = cx + Math.cos(angle) * (radius + lineLength);
      let y2 = cy + Math.sin(angle) * (radius + lineLength);

      if (s.cursorSeen) {
        const mouseCX = s.cursorNX * audioCanvas.width;
        const mouseCY = s.cursorNY * audioCanvas.height;
        const gravRadius = Math.min(audioCanvas.width, audioCanvas.height) * 0.22;
        const mdx = mouseCX - x2;
        const mdy = mouseCY - y2;
        const md2 = mdx * mdx + mdy * mdy;
        if (md2 < gravRadius * gravRadius && md2 > 0) {
          const d = Math.sqrt(md2);
          const strength = (1 - d / gravRadius) * 0.15;
          x2 += mdx * strength;
          y2 += mdy * strength;
        }
      }

      ctx.strokeStyle = `rgba(${barColor.r}, ${barColor.g}, ${barColor.b}, ${Math.max(0, 0.08 + value * 0.16)})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(${barColor.r}, ${barColor.g}, ${barColor.b}, ${Math.max(0.15, Math.min(1, 0.55 + value * 0.95))})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (s.cursorSeen) {
      const mouseCX = s.cursorNX * audioCanvas.width;
      const mouseCY = s.cursorNY * audioCanvas.height;
      if (Math.hypot(mouseCX - cx, mouseCY - cy) < Math.min(audioCanvas.width, audioCanvas.height) * 0.45) {
        const glowR = 28 + bassAvg * 46;
        const glow = ctx.createRadialGradient(mouseCX, mouseCY, 0, mouseCX, mouseCY, glowR);
        glow.addColorStop(0, 'rgba(255, 77, 85, 0.10)');
        glow.addColorStop(1, 'rgba(255, 77, 85, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(mouseCX, mouseCY, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const haloR = Math.min(audioCanvas.width, audioCanvas.height) * (0.30 + bassAvg * 0.03);
    const spin = now * 0.00015;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash(DASH_RING_A);
    ctx.strokeStyle = `rgba(255, 77, 85, ${(0.05 + bassAvg * 0.18).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, spin, spin + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(DASH_RING_B);
    ctx.strokeStyle = `rgba(255, 85, 170, ${(0.04 + bassAvg * 0.14).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR * 0.9, -spin * 1.6, -spin * 1.6 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(DASH_EMPTY);
    ctx.restore();
  }

  /**
   * AMADEUS audio visualizer ring & clockwork gears.
   * @property {() => void} initAudioCanvas - Binds the #audio-canvas, sizes it to the window and (re)builds the static/spin ring offscreen layers.
   * @property {(now: number) => void} drawAudioRing - Draws one frame of the spectrum ring, gears, cursor lens and bass halos.
   * @property {(freq: number) => {r: number, g: number, b: number}} freqColor - Pure: maps a normalized frequency (0..1) to a crimson→violet→pink gradient RGB triplet.
   * @property {() => Function|null} getResizeCallback - Returns the resize handler for registry-based re-attachment.
   */
  window.AMADEUS.audioRing = {
    initAudioCanvas,
    drawAudioRing,
    freqColor,
    getResizeCallback: () => audioResize,
  };
})();
