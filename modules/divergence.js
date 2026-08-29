// modules/divergence.js - AMADEUS Steins;Gate Holographic Nixie Divergence Meter
window.AMADEUS = window.AMADEUS || {};

(function() {
  let divCanvas = null;
  let divCtx = null;
  let divW = 0, divH = 0;
  let resizeDivergence = null;

  // Worldline divergence state
  let currentDivergence = 1.048596;
  let targetDivergence = 1.048596;
  let displayDigits = "1.048596";
  let isShifting = false;
  let shiftProgress = 1;
  let nextJitterTime = performance.now() + 8000;

  function initDivergence() {
    divCanvas = document.getElementById('divergence-canvas');
    if (!divCanvas) return;
    divCtx = divCanvas.getContext('2d');

    function resize() {
      const rect = divCanvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      divW = rect.width || 220;
      divH = rect.height || 46;
      divCanvas.width = Math.round(divW * dpr);
      divCanvas.height = Math.round(divH * dpr);
    }

    window.addEventListener('resize', resize);
    resizeDivergence = resize;
    resize();

    // Click on divergence meter to manually trigger a Worldline Shift calculation!
    divCanvas.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
      triggerWorldlineShift();
    });

    // Render is driven externally by the unified visual loop tick
  }

  function triggerWorldlineShift(customTarget) {
    if (customTarget !== undefined) {
      targetDivergence = customTarget;
    } else {
      // Calculate a random diverging worldline (e.g. 0.571024 to 1.130205)
      const isAlpha = Math.random() < 0.35;
      const isSteinsGate = Math.random() < 0.25;
      if (isSteinsGate) {
        targetDivergence = 1.048596;
      } else if (isAlpha) {
        targetDivergence = 0.571024 + (Math.random() * 0.05);
      } else {
        targetDivergence = 1.129848 + (Math.random() * 0.08);
      }
    }
    
    isShifting = true;
    shiftProgress = 0;

    // Notify speech bubble
    if (window.AMADEUS.bubble && Math.random() < 0.4) {
      setTimeout(() => {
        const line = targetDivergence > 1.0 
          ? "Divergence recalculated. We are maintaining Beta/Steins Gate line."
          : "Warning: Divergence dropped below 1.0. Alpha attractor field detected.";
        window.AMADEUS.bubble.showKurisuBubble(line, 5000);
      }, 1200);
    }
  }

  function updateDivergence(now) {
    // Small quantum jitter every 9-16 seconds
    if (now >= nextJitterTime && !isShifting) {
      const delta = (Math.random() * 0.000004 - 0.000002);
      targetDivergence = Math.max(0.000001, targetDivergence + delta);
      nextJitterTime = now + 9000 + Math.random() * 8000;
    }

    if (isShifting) {
      shiftProgress += 0.022;
      if (shiftProgress >= 1.0) {
        shiftProgress = 1.0;
        isShifting = false;
        currentDivergence = targetDivergence;
      } else {
        // Linear interpolation with high speed spinning
        currentDivergence = currentDivergence + (targetDivergence - currentDivergence) * 0.15;
      }
    } else {
      currentDivergence += (targetDivergence - currentDivergence) * 0.1;
    }

    // Format target string
    const str = currentDivergence.toFixed(6);
    displayDigits = str;
  }

  function renderDivergence(now) {
    if (!divCtx || !divCanvas) return;
    // Skip painting entirely while the host panel is hidden (display:none);
    // if a window resize happened while hidden, re-measure once on return.
    if (divCanvas.offsetParent === null) return;
    if (divW === 0 && resizeDivergence) resizeDivergence();
    if (divW === 0) return;

    updateDivergence(now);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    divCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    divCtx.clearRect(0, 0, divW, divH);

    // Render Nixie Tube Container Background
    divCtx.fillStyle = 'rgba(12, 6, 8, 0.75)';
    divCtx.strokeStyle = 'rgba(255, 120, 60, 0.35)';
    divCtx.lineWidth = 1;
    roundRect(divCtx, 1, 1, divW - 2, divH - 2, 4, true, true);

    const chars = displayDigits.split('');
    const totalChars = chars.length; // e.g. 8 chars: "1.048596"
    const charWidth = (divW - 16) / totalChars;
    const startX = 8;
    const centerY = divH / 2 + 5;

    divCtx.font = 'bold 18px "Courier New", monospace, sans-serif';
    divCtx.textAlign = 'center';
    divCtx.textBaseline = 'middle';

    for (let i = 0; i < totalChars; i++) {
      const char = chars[i];
      const cx = startX + i * charWidth + charWidth / 2;
      
      // Tube chamber slot
      divCtx.fillStyle = 'rgba(255, 60, 20, 0.06)';
      divCtx.fillRect(startX + i * charWidth + 1, 4, charWidth - 2, divH - 8);

      // Tube wire grid mesh
      divCtx.strokeStyle = 'rgba(255, 100, 50, 0.12)';
      divCtx.lineWidth = 0.5;
      divCtx.strokeRect(startX + i * charWidth + 2, 5, charWidth - 4, divH - 10);

      // Digit calculation (rolling if shifting)
      let drawChar = char;
      if (isShifting && char !== '.') {
        const randRoll = Math.floor((now * 0.05 + i * 3.7) % 10);
        if (Math.random() < (1.0 - shiftProgress)) {
          drawChar = String(randRoll);
        }
      }

      // Tube filament glow (Steins;Gate iconic orange-amber Nixie)
      const flicker = 0.92 + Math.sin(now * 0.02 + i) * 0.08;
      
      // Background unlit filament silhouette (dark amber)
      divCtx.fillStyle = 'rgba(80, 25, 10, 0.35)';
      divCtx.fillText('8', cx, centerY);

      // Glow layer 1 (Wide bloom)
      divCtx.shadowColor = 'rgba(255, 110, 30, 0.85)';
      divCtx.shadowBlur = 12 * flicker;
      divCtx.fillStyle = `rgba(255, 160, 50, ${flicker.toFixed(2)})`;
      divCtx.fillText(drawChar, cx, centerY);

      // Glow layer 2 (Hot core)
      divCtx.shadowColor = 'rgba(255, 230, 150, 0.9)';
      divCtx.shadowBlur = 4;
      divCtx.fillStyle = '#fff4d0';
      divCtx.fillText(drawChar, cx, centerY);

      divCtx.shadowBlur = 0;
    }

    // Top indicator tag
    divCtx.font = '7px sans-serif';
    divCtx.fillStyle = 'rgba(255, 140, 70, 0.6)';
    divCtx.textAlign = 'left';
    divCtx.fillText('// DIVERGENCE METER', 6, 8);
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  /**
   * AMADEUS Steins;Gate holographic Nixie divergence meter.
   * @property {() => void} initDivergence - Binds #divergence-canvas, sizes it and wires the click-to-recalculate handler. Rendering is driven by the master visual tick.
   * @property {(customTarget?: number) => void} triggerWorldlineShift - Starts a rolling recalculation toward a random (or given) divergence value.
   * @property {(now: number) => void} renderDivergence - Advances the divergence simulation and paints one nixie frame (skips while the panel is hidden).
   * @property {() => number} getDivergence - Current displayed divergence value.
   */
  window.AMADEUS.divergence = {
    initDivergence,
    triggerWorldlineShift,
    renderDivergence,
    getDivergence: () => currentDivergence,
  };
})();
