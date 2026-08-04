// wallpaper.js - AMADEUS Convergence Sync HUD Logic
// Integrated with Live2D Makise Kurisu, Mouse Tracking Gaze, and Sound Reactive Lip-Sync

// --- GLOBAL VARIABLES & STATE ---
let live2DController = null;
let audioCanvas, ctx;
let isLivelyActive = false; // Flagged when Lively API actually starts sending events
let simulatedAudioTime = 0;

// --- PERFORMANCE PROFILE ---
// Caps DPR and draw rates to keep the wallpaper light on CPU/GPU.
const PERF = {
  dpr: Math.min(window.devicePixelRatio || 1, 1.5), // cap canvas backing resolution
  visualFps: 30,                                    // cap full canvas redraw rate
  gearFps: 10                                       // rotating gears redraw much less often
};
const VISUAL_INTERVAL = 1000 / PERF.visualFps;
const GEAR_INTERVAL = 1000 / PERF.gearFps;
let lastVisualUpdate = 0;
let lastGearUpdate = 0;
let staticRingCanvas = null; // pre-rendered static radial grid
let gearSnapshot = null;     // offscreen snapshot of the rotating gears layer

// --- IDLE / PAUSE POWER SAVING ---
// Lively keeps pushing near-zero audio arrays when the system is silent, so we
// drop to a slow idle state until real audio or mouse activity returns.
const IDLE_THRESHOLD_MS = 8000;
const ACTIVITY_ENERGY = 0.02; // audio bins above this count as "real sound"
let lastActivityTime = performance.now();
let isIdle = false;
let isLivelyPaused = false; // set by --pause-event

// Nixie Tube target convergence
const defaultConvergence = "0.986254";
let nixieFlickerCount = 0;

// Cursor position (normalized 0..1) for the audio-ring gravitational distortion
let cursorNX = 0.5;
let cursorNY = 0.5;
let cursorSeen = false;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  initClock();
  initAudioCanvas();
  initLive2D();
  initWorldLine();
  fetchRealtimeNews();
  startIdleWatchdog();
  startNixieAmbientFlicker();
  applyTimeOfDay();
  setInterval(applyTimeOfDay, 60 * 1000);

  // Any mouse movement cancels idle mode immediately and feeds the ring distortion
  window.addEventListener('mousemove', (e) => {
    cursorNX = e.clientX / window.innerWidth;
    cursorNY = e.clientY / window.innerHeight;
    cursorSeen = true;
    markActivity();
  }, { passive: true });

  // Click anywhere = shift the world line (nixie flicker + HUD glitch)
  window.addEventListener('pointerdown', () => {
    if (isLivelyPaused) return;
    triggerWorldLineShift();
  }, { passive: true });
  
  // Start simulation loop (will run if Lively events aren't received)
  setTimeout(() => {
    if (!isLivelyActive) {
      console.log("AMADEUS HUD: Lively API not detected, launching browser simulation mode.");
      startBrowserSimulation();
    }
  }, 2500);
});

// --- ADAPTIVE IDLE POWER SAVING ---
// When the system is silent and the mouse is idle, throttle everything down.
function markActivity() {
  lastActivityTime = performance.now();
  if (isIdle) enterIdleState(false);
}

function startIdleWatchdog() {
  setInterval(() => {
    if (isLivelyPaused) return; // already fully paused
    const inactiveFor = performance.now() - lastActivityTime;
    if (!isIdle && inactiveFor >= IDLE_THRESHOLD_MS) {
      enterIdleState(true);
    }
  }, 2000);
}

function enterIdleState(idle) {
  if (isIdle === idle) return;
  isIdle = idle;
  if (live2DController && live2DController.setIdleMode) {
    live2DController.setIdleMode(idle);
  }
  if (idle) {
    console.log("AMADEUS HUD: entering idle power-saving mode.");
  } else {
    console.log("AMADEUS HUD: activity detected, resuming full render.");
  }
}

// Let the divergence meter breathe even when nothing is playing: occasionally
// roll the digits through a random world-line before settling back.
function startNixieAmbientFlicker() {
  setInterval(() => {
    if (!isIdle) {
      triggerNixieFlicker();
    }
  }, 18000);
}

// --- CLICK: WORLD LINE SHIFT ---
// Any click briefly destabilizes the world line: divergence meter flickers and
// the HUD jitters through a chromatic glitch before snapping back.
function triggerWorldLineShift() {
  triggerNixieFlicker();
  document.body.classList.add('world-line-shifting');
  clearTimeout(triggerWorldLineShift._timer);
  triggerWorldLineShift._timer = setTimeout(() => {
    document.body.classList.remove('world-line-shifting');
  }, 450);
}

// --- TIME-OF-DAY AMBIENCE ---
// After 19:00 the HUD drops into a dimmer, colder "night ops" mode; it warms
// back up in the morning. The CSS transition fades the switch over ~2.5s.
function applyTimeOfDay() {
  const hour = new Date().getHours();
  const night = hour >= 19 || hour < 6;
  document.body.classList.toggle('night-mode', night);
}

// --- WORLD LINE INTERFERENCE MAP ---
// Lightweight audio-reactive particle constellation that replaces the old
// TradingView iframe: a network of nodes links up and pulses with sound energy,
// with an amber attractor core and slow radar sweep.
const WORLD_LINE_PARTICLES = 42;
let worldLineParticles = [];
let wlCanvas, wlCtx;
let worldLineEnergy = 0; // fed by handleAudioFrame() from real or simulated bass

function initWorldLine() {
  wlCanvas = document.getElementById('world-line-canvas');
  if (!wlCanvas) return;
  wlCtx = wlCanvas.getContext('2d');

  function resize() {
    const rect = wlCanvas.getBoundingClientRect();
    wlCanvas.width = Math.max(1, Math.round(rect.width * PERF.dpr));
    wlCanvas.height = Math.max(1, Math.round(rect.height * PERF.dpr));
    seedWorldLine();
  }

  window.addEventListener('resize', resize);
  resize();

  setInterval(updateWorldLine, 1000 / 15);
  setInterval(updateWorldLineMeta, 500);
}

function seedWorldLine() {
  worldLineParticles = [];
  for (let i = 0; i < WORLD_LINE_PARTICLES; i++) {
    worldLineParticles.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: 0.6 + Math.random() * 1.6,
      rose: Math.random() < 0.28
    });
  }
}

function updateWorldLine() {
  if (!wlCtx || !wlCanvas) return;
  // Frozen frame while paused or idle: last draw stays on the canvas
  if (isLivelyPaused || isIdle) return;

  const w = wlCanvas.width;
  const h = wlCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const pulse = worldLineEnergy;

  wlCtx.clearRect(0, 0, w, h);

  // Drift + bass pushes particles outward from the attractor core
  for (const p of worldLineParticles) {
    p.x += p.vx / w;
    p.y += p.vy / h;
    const dx = (p.x - 0.5) * 2;
    const dy = (p.y - 0.5) * 2;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    p.x += (dx / dist) * pulse * 0.02;
    p.y += (dy / dist) * pulse * 0.02;
    if (p.x < 0) p.x += 1;
    if (p.x > 1) p.x -= 1;
    if (p.y < 0) p.y += 1;
    if (p.y > 1) p.y -= 1;
  }

  // Constellations: link nearby nodes, brightness scales with audio
  const linkMax = (0.24 - pulse * 0.05) * w;
  const linkMax2 = linkMax * linkMax;
  for (let i = 0; i < worldLineParticles.length; i++) {
    const a = worldLineParticles[i];
    for (let j = i + 1; j < worldLineParticles.length; j++) {
      const b = worldLineParticles[j];
      const ddx = (a.x - b.x) * w;
      const ddy = (a.y - b.y) * h;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < linkMax2) {
        const t = 1 - Math.sqrt(d2) / linkMax;
        wlCtx.strokeStyle = `rgba(126, 211, 250, ${(t * (0.16 + pulse * 0.4)).toFixed(3)})`;
        wlCtx.lineWidth = 1;
        wlCtx.beginPath();
        wlCtx.moveTo(a.x * w, a.y * h);
        wlCtx.lineTo(b.x * w, b.y * h);
        wlCtx.stroke();
      }
    }
  }

  // Nodes
  for (const p of worldLineParticles) {
    const glow = p.r * (1 + pulse * 2.2);
    wlCtx.beginPath();
    if (p.rose) {
      wlCtx.fillStyle = `rgba(255, 77, 109, ${(0.5 + pulse * 0.5).toFixed(3)})`;
    } else {
      wlCtx.fillStyle = `rgba(126, 211, 250, ${(0.5 + pulse * 0.5).toFixed(3)})`;
    }
    wlCtx.arc(p.x * w, p.y * h, glow, 0, Math.PI * 2);
    wlCtx.fill();
  }

  // Amber attractor core at the center of the world line
  wlCtx.beginPath();
  wlCtx.fillStyle = `rgba(255, 122, 0, ${(0.55 + pulse * 0.45).toFixed(3)})`;
  wlCtx.arc(cx, cy, 3 + pulse * 6, 0, Math.PI * 2);
  wlCtx.fill();

  // Radar sweep arm
  const sweep = (performance.now() / 1000) * 0.9;
  wlCtx.beginPath();
  wlCtx.moveTo(cx, cy);
  wlCtx.lineTo(cx + Math.cos(sweep) * w * 0.5, cy + Math.sin(sweep) * w * 0.5);
  wlCtx.strokeStyle = `rgba(255, 122, 0, ${(0.12 + pulse * 0.3).toFixed(3)})`;
  wlCtx.lineWidth = 1;
  wlCtx.stroke();
}

function updateWorldLineMeta() {
  const deltaEl = document.getElementById('wl-delta');
  if (!deltaEl) return;
  const delta = worldLineEnergy * 0.25 + (Math.random() - 0.5) * 0.004;
  const sign = delta >= 0 ? '+' : '-';
  deltaEl.innerText = `DELTA ${sign}${Math.abs(delta).toFixed(4)}`;
}

// --- CLOCK & DATE WIDGET ---
function initClock() {
  const clockEl = document.getElementById('hud-clock');
  const dateEl = document.getElementById('hud-date');
  if (!clockEl || !dateEl) return;

  function update() {
    const now = new Date();
    
    // Time format: HH:MM:SS
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    clockEl.innerText = `${hrs}:${mins}:${secs}`;
    
    // Date format: YYYY.MM.DD
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateEl.innerText = `${yyyy}.${mm}.${dd}`;
  }
  
  update();
  setInterval(update, 1000);
}

// --- LIVE2D CHARACTER CONTROLLER ---
async function initLive2D() {
  console.log("[L2D] Starting Live2D Controller setup...");
  
  // Initialize the avatar
  // Path: live2d/kurisu/Kurisu.model3.json
  live2DController = new Live2DController('live2d-canvas', 'live2d/kurisu/Kurisu.model3.json');
  
  const success = await live2DController.init();
  if (success) {
    console.log("[L2D] Live2D Kurisu avatar loaded successfully in HUD.");
  } else {
    console.error("[L2D] Live2D Kurisu failed to initialize.");
  }
}

// --- 2D CANVAS AUDIO SPECTRUM RING ---
function initAudioCanvas() {
  audioCanvas = document.getElementById('audio-canvas');
  if (!audioCanvas) return;
  ctx = audioCanvas.getContext('2d');
  
  function resize() {
    audioCanvas.width = Math.round(window.innerWidth * PERF.dpr);
    audioCanvas.height = Math.round(window.innerHeight * PERF.dpr);
    buildStaticRing();
  }
  
  resize();
  window.addEventListener('resize', resize);
}

// Pre-render the static radial grid circles once per resize so they aren't
// re-stroked on every animation frame.
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

  sctx.strokeStyle = 'rgba(230, 0, 38, 0.04)';
  sctx.lineWidth = 1;
  for (const r of [radius - 25, radius, radius + 25]) {
    sctx.beginPath();
    sctx.arc(cx, cy, r, 0, Math.PI * 2);
    sctx.stroke();
  }
}

// Draw Audio Ring spectrum behind Kurisu
function drawAudioRing(fftData, now) {
  if (!ctx || !audioCanvas) return;
  
  ctx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
  
  const cx = audioCanvas.width / 2;
  const cy = audioCanvas.height / 2;
  
  // Center visualizer circular ring
  const radius = Math.min(audioCanvas.width, audioCanvas.height) * 0.17;
  
  // Pulse central circle dynamically based on average bass volume
  let bassSum = 0;
  for (let i = 0; i < 10; i++) bassSum += fftData[i] || 0;
  const bassAvg = bassSum / 10;
  const centerPulseRadius = radius - 20 + bassAvg * 25;

  // 1. Rotating gears — redraw into an offscreen snapshot every GEAR_INTERVAL ms
  //    (they turn too slowly to need every frame), then blit the snapshot.
  if (now - lastGearUpdate >= GEAR_INTERVAL) {
    lastGearUpdate = now;
    buildGearSnapshot(cx, cy, bassAvg);
  }
  if (gearSnapshot) ctx.drawImage(gearSnapshot, 0, 0);

  // 2. Static radial grid (pre-rendered offscreen)
  if (staticRingCanvas) ctx.drawImage(staticRingCanvas, 0, 0);

  // 3. Central pulse glow ring (crimson red) — single shadow draw per frame
  ctx.strokeStyle = `rgba(230, 0, 38, ${0.1 + bassAvg * 0.45})`;
  ctx.lineWidth = 3;
  ctx.shadowColor = '#e60026';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, centerPulseRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0; // reset shadow

  // 4. Radial frequency lines — single shared gradient + no shadow
  const numBars = Math.min(fftData.length, 64);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  const grad = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius + 110);
  grad.addColorStop(0, 'rgba(230, 0, 38, 0.8)');   // crimson inner
  grad.addColorStop(1, 'rgba(255, 77, 109, 0.9)'); // rose outer
  ctx.strokeStyle = grad;

  for (let i = 0; i < numBars; i++) {
    // Distribute angles around circle
    const angle = (i / numBars) * Math.PI * 2;
    const value = fftData[i] || 0;
    const lineLength = value * 110;
    
    // Inner coordinates
    const x1 = cx + Math.cos(angle) * radius;
    const y1 = cy + Math.sin(angle) * radius;
    
    // Outer coordinates
    let x2 = cx + Math.cos(angle) * (radius + lineLength);
    let y2 = cy + Math.sin(angle) * (radius + lineLength);

    // Gravitational lens: bars near the cursor bend toward it
    if (cursorSeen) {
      const mouseCX = cursorNX * audioCanvas.width;
      const mouseCY = cursorNY * audioCanvas.height;
      const gravRadius = Math.min(audioCanvas.width, audioCanvas.height) * 0.30;
      const mdx = x2 - mouseCX;
      const mdy = y2 - mouseCY;
      const md2 = mdx * mdx + mdy * mdy;
      if (md2 < gravRadius * gravRadius) {
        const d = Math.sqrt(md2);
        const strength = (1 - d / gravRadius) * 0.45;
        x2 += mdx * strength;
        y2 += mdy * strength;
      }
    }
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // 5. Cursor gravitational lens glow (only near the ring, subtle)
  if (cursorSeen) {
    const mouseCX = cursorNX * audioCanvas.width;
    const mouseCY = cursorNY * audioCanvas.height;
    if (Math.hypot(mouseCX - cx, mouseCY - cy) < Math.min(audioCanvas.width, audioCanvas.height) * 0.45) {
      const glowR = 28 + bassAvg * 46;
      const glow = ctx.createRadialGradient(mouseCX, mouseCY, 0, mouseCX, mouseCY, glowR);
      glow.addColorStop(0, 'rgba(126, 211, 250, 0.10)');
      glow.addColorStop(1, 'rgba(126, 211, 250, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mouseCX, mouseCY, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// --- CLOCKWORK MECHANICAL BACKGROUND COMPONENT ---
let gearAngle = 0;

function drawGear(ctx, x, y, radius, teeth, angle, strokeColor) {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.0;
  
  ctx.translate(x, y);
  ctx.rotate(angle);
  
  // Gear body circles
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.stroke();

  // Spokes
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const spokeAngle = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(spokeAngle) * 8, Math.sin(spokeAngle) * 8);
    ctx.lineTo(Math.cos(spokeAngle) * radius * 0.9, Math.sin(spokeAngle) * radius * 0.9);
    ctx.stroke();
  }
  
  // Teeth
  const toothWidth = (Math.PI * 2) / teeth / 2;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const curAngle = (i / teeth) * Math.PI * 2;
    const a1 = curAngle - toothWidth / 2;
    const a2 = curAngle + toothWidth / 2;
    const a3 = curAngle + toothWidth * 1.5;
    
    ctx.lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
    ctx.lineTo(Math.cos(a1) * (radius * 1.08), Math.sin(a1) * (radius * 1.08));
    ctx.lineTo(Math.cos(a2) * (radius * 1.08), Math.sin(a2) * (radius * 1.08));
    ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
    ctx.lineTo(Math.cos(a3) * radius, Math.sin(a3) * radius);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawCoordinateDial(ctx, x, y, radius, ticks, angle, strokeColor) {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.0;
  
  ctx.translate(x, y);
  ctx.rotate(angle);
  
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(0, 0, radius - 15, 0, Math.PI * 2);
  ctx.stroke();
  
  // Draw small coordinate ticks
  for (let i = 0; i < ticks; i++) {
    const tickAngle = (i / ticks) * Math.PI * 2;
    const len = i % 4 === 0 ? 10 : 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(tickAngle) * (radius - 15), Math.sin(tickAngle) * (radius - 15));
    ctx.lineTo(Math.cos(tickAngle) * (radius - 15 + len), Math.sin(tickAngle) * (radius - 15 + len));
    ctx.stroke();
  }
  ctx.restore();
}

// Draw the mechanical gears into an offscreen canvas so they can be reused
// across frames without re-rasterizing every visual update.
function buildGearSnapshot(cx, cy, bass) {
  if (!audioCanvas) return;
  if (!gearSnapshot) {
    gearSnapshot = document.createElement('canvas');
    gearSnapshot.width = audioCanvas.width;
    gearSnapshot.height = audioCanvas.height;
  }
  const gctx = gearSnapshot.getContext('2d');
  gctx.clearRect(0, 0, gearSnapshot.width, gearSnapshot.height);
  drawClockworkBackground(gctx, cx, cy, bass);
}

function drawClockworkBackground(ctx, cx, cy, bass) {
  // Update rotation angle (scales with music bass)
  const baseRotationSpeed = 0.0012;
  gearAngle += baseRotationSpeed + (bass * 0.0035);
  
  const scale = 1.0 + (bass * 0.04);
  const strokeColor = `rgba(230, 0, 38, ${0.07 + bass * 0.05})`;
  const lineStroke = `rgba(230, 0, 38, 0.035)`;
  
  // Layout coordinates of gears/dials matching retro mechanical diagram in image
  const centers = [
    { x: cx - 400, y: cy - 120, r: 130, teeth: 36, speedMult: 1.0 },
    { x: cx - 580, y: cy - 120, r: 50, teeth: 14, speedMult: -2.57 },  // meshed with center 0
    { x: cx + 450, y: cy + 150, r: 150, teeth: 40, speedMult: -0.7 },
    { x: cx + 230, y: cy + 150, r: 70, teeth: 18, speedMult: 1.55 },   // meshed with center 2
    { x: cx - 250, y: cy + 220, r: 90, teeth: 24, speedMult: -1.2 },
    { x: cx + 380, y: cy - 200, r: 110, teeth: 28, speedMult: 1.4 }
  ];
  
  ctx.save();
  
  // 1. Draw background diagram linkage lines
  ctx.strokeStyle = lineStroke;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const dist = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
      if (dist < 550) {
        ctx.moveTo(centers[i].x, centers[i].y);
        ctx.lineTo(centers[j].x, centers[j].y);
      }
    }
    // Draw links to visualizer center
    ctx.moveTo(centers[i].x, centers[i].y);
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Dotted secondary rings
  ctx.strokeStyle = `rgba(230, 0, 38, 0.015)`;
  for (let i = 0; i < centers.length; i++) {
    ctx.beginPath();
    ctx.arc(centers[i].x, centers[i].y, centers[i].r * 1.4, 0, Math.PI * 2);
    ctx.setLineDash([4, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  ctx.restore();

  // 2. Draw rotating gears and dials
  centers.forEach((c) => {
    const activeRadius = c.r * scale;
    const currentAngle = gearAngle * c.speedMult;
    
    // Draw mechanical gear
    drawGear(ctx, c.x, c.y, activeRadius, c.teeth, currentAngle, strokeColor);
    
    // Draw outer coordinate dial ticks overlay
    if (c.r > 80) {
      drawCoordinateDial(ctx, c.x, c.y, activeRadius * 1.22, 24, -currentAngle * 0.35, strokeColor);
    }
  });
}

// --- NIXIE CONVERGENCE FLICKER EFFECT ---
function updateNixieDisplay(digitsString) {
  const digits = digitsString.replace('.', '').split('');
  const nixieContainers = document.querySelectorAll('#divergence-meter .nixie-digit');
  
  nixieContainers.forEach((el, idx) => {
    if (digits[idx] !== undefined) {
      el.innerText = digits[idx];
    }
  });
}

function triggerNixieFlicker() {
  nixieFlickerCount = 15; // flicker for 15 frames
}

function processNixieFlicker() {
  if (nixieFlickerCount > 0) {
    nixieFlickerCount--;
    if (nixieFlickerCount === 0) {
      // Resolve to default Attractor Field Divergence
      updateNixieDisplay(defaultConvergence);
    } else {
      // Generate a string of random numbers for visual flicker
      let randomDigits = "";
      for (let i = 0; i < 7; i++) {
        randomDigits += Math.floor(Math.random() * 10);
      }
      // Insert decimal point
      randomDigits = randomDigits[0] + "." + randomDigits.substring(1);
      updateNixieDisplay(randomDigits);
    }
  }
}

// --- LIVE NEWS FEED (HACKER NEWS API INTEGRATION) ---
const simulatedNewsPool = [
  { title: "Bitcoin consolidates near local levels as trading indicators shift", url: "https://tradingview.com", score: 320, time: Date.now()/1000 - 3600 },
  { title: "New WebGL standard promises ultra-low CPU memory footprint for widgets", url: "https://github.com", score: 185, time: Date.now()/1000 - 7200 },
  { title: "Obsidian visual graphs: Mapping neural nodes for cognitive research", url: "https://obsidian.md", score: 412, time: Date.now()/1000 - 12000 },
  { title: "Lively Wallpaper v3 updates hardware metrics collection efficiency", url: "https://livelywallpaper.io", score: 98, time: Date.now()/1000 - 18000 },
  { title: "Makise Kurisu Live2D model physics improvements completed", url: "https://live2d.com", score: 256, time: Date.now()/1000 - 24000 },
  { title: "Google Sheets sync limits bypassed with parallel cache fetching", url: "https://sheets.google.com", score: 140, time: Date.now()/1000 - 30000 }
];

function getDomain(url) {
  if (!url) return 'self';
  try {
    const domain = new URL(url).hostname;
    return domain.startsWith('www.') ? domain.substring(4) : domain;
  } catch (e) {
    return 'external';
  }
}

function timeSince(timestamp) {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  let interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + "h";
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + "m";
  }
  return Math.floor(seconds) + "s";
}

// Fetch with a hard timeout so a hung API can never block the news feed.
async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRealtimeNews() {
  const container = document.getElementById('news-feed');
  const statusEl = document.getElementById('news-status');
  if (!container || !statusEl) return;

  try {
    // 1. Fetch top Hacker News stories
    const topStoriesRes = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!topStoriesRes.ok) throw new Error("HN Fetch Failed");
    
    const storyIds = await topStoriesRes.json();
    const targetStories = storyIds.slice(0, 6); // Take first 6 stories
    
    // 2. Fetch details for each story in parallel
    const storyPromises = targetStories.map(async (id) => {
      const detailRes = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return detailRes.json();
    });
    
    const stories = await Promise.all(storyPromises);
    
    // Clear loading state
    container.innerHTML = '';
    statusEl.innerText = 'LIVE_SYNC';
    statusEl.className = 'pulse-text';

    // Render items
    stories.forEach(story => {
      if (!story || !story.title) return;
      
      const item = document.createElement('a');
      item.className = 'news-item';
      item.href = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
      item.target = '_blank';
      
      const titleDiv = document.createElement('div');
      titleDiv.className = 'news-title';
      titleDiv.innerText = story.title;
      
      const metaDiv = document.createElement('div');
      metaDiv.className = 'news-meta';
      
      const domain = getDomain(story.url);
      metaDiv.innerHTML = `
        <span class="news-score">▲ ${story.score || 0} pts</span>
        <span class="news-time">posted ${timeSince(story.time)} ago</span>
        <span class="news-domain">[ ${domain} ]</span>
      `;
      
      item.appendChild(titleDiv);
      item.appendChild(metaDiv);
      container.appendChild(item);
    });

  } catch (err) {
    console.warn("AMADEUS News Sync: API offline, falling back to simulated pool.", err);
    renderFallbackNews(container, statusEl);
  }
}

function renderFallbackNews(container, statusEl) {
  container.innerHTML = '';
  statusEl.innerText = 'STANDALONE_SYNC';
  statusEl.className = 'pulse-text';
  
  simulatedNewsPool.forEach(story => {
    const item = document.createElement('a');
    item.className = 'news-item';
    item.href = story.url;
    item.target = '_blank';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'news-title';
    titleDiv.innerText = story.title;
    
    const metaDiv = document.createElement('div');
    metaDiv.className = 'news-meta';
    
    metaDiv.innerHTML = `
      <span class="news-score">▲ ${story.score} pts</span>
      <span class="news-time">posted ${timeSince(story.time)} ago</span>
      <span class="news-domain">[ ${getDomain(story.url)} ]</span>
    `;
    
    item.appendChild(titleDiv);
    item.appendChild(metaDiv);
    container.appendChild(item);
  });
}

// Refresh news feed every 15 minutes (skipped while Lively is paused)
setInterval(() => {
  if (!isLivelyPaused) fetchRealtimeNews();
}, 15 * 60 * 1000);

// --- LIVELY WALLPAPER API HOOKS ---

// 1. System Audio Listener
// Called by Lively engine when music/system sound plays.
// NOTE: simulation mode calls handleAudioFrame() directly so isLivelyActive
// only flips when the real Lively runtime is present.
window.livelyAudioListener = function(audioArray) {
  isLivelyActive = true;
  handleAudioFrame(audioArray);
};

function handleAudioFrame(audioArray) {
  if (!audioArray || audioArray.length === 0) return;

  // Detect real audio energy for the idle watchdog
  let energy = 0;
  const sampleBins = Math.min(audioArray.length, 64);
  for (let i = 0; i < sampleBins; i++) {
    if (audioArray[i] > energy) energy = audioArray[i];
  }
  if (energy > ACTIVITY_ENERGY) markActivity();

  // When Lively pauses rendering, skip all visual + lip-sync work
  if (isLivelyPaused) return;

  // Process Nixie tube flicker on massive bass spike
  let bassSum = 0;
  for (let i = 0; i < 8; i++) {
    bassSum += audioArray[i];
  }
  const bassVal = bassSum / 8;

  // Feed the world line interference map (updates on its own 15fps clock)
  worldLineEnergy = bassVal;

  if (bassVal > 0.65 && nixieFlickerCount === 0) {
    triggerNixieFlicker();
  }

  processNixieFlicker();

  // Lip-Sync: Feed average vocals volume (bins 1-12) to Kurisu mouth open parameter
  let vocalsSum = 0;
  const minBin = 1;
  const maxBin = 12;
  for (let i = minBin; i <= maxBin; i++) {
    vocalsSum += audioArray[i] || 0;
  }
  const vocalsAvg = vocalsSum / (maxBin - minBin + 1);
  
  // Amplify vocals amplitude to open her mouth clearly
  let openness = Math.min(1.0, vocalsAvg * 3.5); 
  if (openness < 0.08) openness = 0; // gate threshold

  // Apply mouth openness directly to Live2D model parameter
  if (live2DController && live2DController._ready && live2DController.model) {
    if (openness > 0) {
      live2DController.isSpeaking = true;
      live2DController.setParameter('PARAM_MOUTH_OPEN_Y', 'ParamMouthOpenY', openness);
    } else {
      live2DController.isSpeaking = false;
      live2DController.setParameter('PARAM_MOUTH_OPEN_Y', 'ParamMouthOpenY', 0);
    }
  }

  // Idle mode: skip heavy canvas redraws until real audio/mouse activity returns
  if (isIdle) return;

  // Heavy canvas redraws throttled to PERF.visualFps — lip-sync above stays live.
  const now = performance.now();
  if (now - lastVisualUpdate >= VISUAL_INTERVAL) {
    lastVisualUpdate = now;
    drawAudioRing(audioArray, now);
  }
}

// 2. Hardware System Information
// Called by Lively engine with CPU, GPU, RAM, Net usage.
// Lively may deliver this as a JSON string (older) or a parsed object (newer) —
// handle both so telemetry never silently no-ops.
window.livelySystemInformation = function(data) {
  isLivelyActive = true;
  
  if (!data) return;
  
  let obj = data;
  if (typeof data === 'string') {
    try {
      obj = JSON.parse(data);
    } catch (err) {
      console.error("AMADEUS Telemetry Parse Error: ", err);
      return;
    }
  }
  
  updateTelemetryUI(obj);
};

// 3. Wallpaper playback pause/resume (--pause-event)
// Lively only pauses rendering; JS keeps running, so we stop our own heavy
// loops explicitly instead of wasting cycles drawing frames that aren't shown.
window.livelyWallpaperPlaybackChanged = function(data) {
  let obj = data;
  if (typeof data === 'string') {
    try { obj = JSON.parse(data); } catch (e) { return; }
  }
  if (!obj || typeof obj.IsPaused !== 'boolean') return;

  isLivelyPaused = obj.IsPaused;
  if (live2DController) {
    if (obj.IsPaused) {
      live2DController.pause();
    } else {
      live2DController.resume();
      markActivity();
    }
  }
};

// 4. Now playing track (--system-nowplaying)
window.livelyCurrentTrack = function(data) {
  let obj = data;
  if (typeof data === 'string') {
    try { obj = JSON.parse(data); } catch (e) { return; }
  }

  const trackEl = document.getElementById('now-playing-track');
  const artistEl = document.getElementById('now-playing-artist');
  if (!trackEl) return;

  if (!obj || !obj.Title) {
    trackEl.innerText = 'AUDIO_FEED_IDLE';
    artistEl.innerText = '';
    return;
  }

  trackEl.innerText = obj.Title;
  artistEl.innerText = obj.Artist ? `— ${obj.Artist}` : '';
};

// Null-safe shorthand so a missing HUD element can never throw in the
// telemetry path (defensive: Lively may deliver fields out of order).
const $id = (id) => document.getElementById(id);

function updateTelemetryUI(obj) {
  // CPU
  const cpuValue = $id('cpu-value');
  const cpuBar = $id('cpu-bar');
  const cpuName = $id('cpu-name');
  if (obj.CurrentCpu !== undefined) {
    if (cpuValue) cpuValue.innerText = `${obj.CurrentCpu.toFixed(0)}%`;
    if (cpuBar) cpuBar.style.width = `${obj.CurrentCpu}%`;
  }
  if (obj.NameCpu && cpuName) {
    cpuName.innerText = obj.NameCpu;
  }

  // GPU
  const gpuValue = $id('gpu-value');
  const gpuBar = $id('gpu-bar');
  const gpuName = $id('gpu-name');
  if (obj.CurrentGpu3D !== undefined) {
    if (gpuValue) gpuValue.innerText = `${obj.CurrentGpu3D.toFixed(0)}%`;
    if (gpuBar) gpuBar.style.width = `${obj.CurrentGpu3D}%`;
  }
  if (obj.NameGpu && gpuName) {
    gpuName.innerText = obj.NameGpu;
  }

  // RAM
  const ramValue = $id('ram-value');
  const ramBar = $id('ram-bar');
  if (obj.TotalRam !== undefined && obj.CurrentRamAvail !== undefined) {
    const totalGB = (obj.TotalRam / 1024).toFixed(1);
    const usedGB = ((obj.TotalRam - obj.CurrentRamAvail) / 1024).toFixed(1);
    if (ramValue) ramValue.innerText = `${usedGB} / ${totalGB} GB`;
    
    const ramPct = ((obj.TotalRam - obj.CurrentRamAvail) / obj.TotalRam) * 100;
    if (ramBar) ramBar.style.width = `${ramPct}%`;
  }

  // Network Rates
  const netDown = $id('net-down-mb');
  const netUp = $id('net-up-mb');
  const netValue = $id('net-value');
  const netName = $id('net-name');
  if (obj.CurrentNetDown !== undefined && obj.CurrentNetUp !== undefined) {
    const netDownMB = (obj.CurrentNetDown / (1024 * 1024)).toFixed(1);
    const netUpMB = (obj.CurrentNetUp / (1024 * 1024)).toFixed(1);
    if (netDown) netDown.innerText = netDownMB;
    if (netUp) netUp.innerText = netUpMB;
    
    const downSpeedMb = ((obj.CurrentNetDown * 8) / (1024 * 1024)).toFixed(2);
    const upSpeedMb = ((obj.CurrentNetUp * 8) / (1024 * 1024)).toFixed(2);
    if (netValue) netValue.innerText = `↓${downSpeedMb} Mb/s ↑${upSpeedMb} Mb/s`;
  }
  if (obj.NameNetCard && netName) {
    netName.innerText = obj.NameNetCard;
  }
}

// --- BROWSER SIMULATION ENGINE (STANDALONE / FALLBACK MODE) ---
function startBrowserSimulation() {
  // Simulate Telemetry Updates every 1.5 seconds (only while no real Lively data)
  setInterval(() => {
    if (isLivelyActive) return;
    const simulatedTelemetry = {
      CurrentCpu: 12 + Math.random() * 25,
      NameCpu: "AMD Ryzen 9 5900X 12-Core Processor (Simulated)",
      CurrentGpu3D: 3 + Math.random() * 15,
      NameGpu: "NVIDIA GeForce RTX 3080 (Simulated)",
      TotalRam: 32768, // 32 GB
      CurrentRamAvail: 18000 + (Math.sin(Date.now() / 15000) * 1500),
      CurrentNetDown: 100000 + Math.random() * 2500000,
      CurrentNetUp: 20000 + Math.random() * 400000,
      NameNetCard: "Intel Wi-Fi 6E AX211 160MHz (Simulated)"
    };
    updateTelemetryUI(simulatedTelemetry);
  }, 1.5 * 1000);

  // Simulate Audio Data stream for visualizer and mouth lip-sync
  const simulatedFFT = new Float32Array(128);
  
  function simulateAudioLoop() {
    if (isLivelyActive) return; // Stop if real events come in
    
    simulatedAudioTime += 0.07;
    
    for (let i = 0; i < 128; i++) {
      // Create fluctuating waves mimicking voices / ambient sound
      let val = Math.sin(simulatedAudioTime + i * 0.12) * 0.3 + 
                Math.sin(simulatedAudioTime * 0.4 + i * 0.04) * 0.2 + 
                Math.cos(simulatedAudioTime * 2.1 + i * 0.25) * 0.15 + 
                Math.random() * 0.08;
      
      val = Math.max(0, val);
      
      // Add simulated periodic "speech spikes" to make Kurisu talk and close mouth naturally
      const speechEnvelope = Math.max(0, Math.sin(simulatedAudioTime * 0.3) * 0.8 + 0.2);
      if (i >= 1 && i <= 12) {
        val *= speechEnvelope;
      }
      
      simulatedFFT[i] = val;
    }
    
    // Call the shared frame handler directly so isLivelyActive stays false
    handleAudioFrame(simulatedFFT);
    requestAnimationFrame(simulateAudioLoop);
  }
  
  simulateAudioLoop();
}
