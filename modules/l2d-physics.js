// modules/l2d-physics.js - AMADEUS Live2D Procedural Physics & Micro-Animation
window.AMADEUS = window.AMADEUS || {};

(function() {
  function updateBlink(ctrl, dt, now) {
    if (!ctrl || !ctrl._blink) return;
    const b = ctrl._blink;

    if (now >= b.nextBlinkTime && b.phase === 'open') {
      b.phase = 'closing';
      b.phaseStart = now;
    }

    if (b.phase === 'closing') {
      const elapsed = now - b.phaseStart;
      const progress = Math.min(1, elapsed / b.closeDuration);
      b.value = 1.0 - progress;
      if (progress >= 1) {
        b.phase = 'closed';
        b.phaseStart = now;
      }
    } else if (b.phase === 'closed') {
      const elapsed = now - b.phaseStart;
      if (elapsed >= b.closedDuration) {
        b.phase = 'opening';
        b.phaseStart = now;
      }
    } else if (b.phase === 'opening') {
      const elapsed = now - b.phaseStart;
      const progress = Math.min(1, elapsed / b.openDuration);
      b.value = progress;
      if (progress >= 1) {
        b.phase = 'open';
        b.value = 1.0;
        if (b.doubleBlink) {
          b.doubleBlink = false;
          b.nextBlinkTime = now + 120;
        } else {
          b.doubleBlink = Math.random() < b.doubleBlinkChance;
          b.nextBlinkTime = now + b.minInterval + Math.random() * (b.maxInterval - b.minInterval);
        }
      }
    }
  }

  function updateBreathing(ctrl, dt) {
    if (!ctrl || !ctrl._breath) return;
    const br = ctrl._breath;
    br.phase += br.speed * dt;
    br.value = (Math.sin(br.phase) * 0.5 + 0.5) * br.amplitude;
  }

  function updateSway(ctrl, dt) {
    if (!ctrl || !ctrl._sway) return;
    const sw = ctrl._sway;
    sw.phaseZ += sw.speedZ * dt;
    sw.phaseX += sw.speedX * dt;
    sw.valueZ = Math.sin(sw.phaseZ) * sw.amplitudeZ;
    sw.valueX = Math.sin(sw.phaseX) * sw.amplitudeX;
  }

  function updateHeadSway(ctrl, dt) {
    if (!ctrl || !ctrl._headSway) return;
    const hs = ctrl._headSway;
    hs.phaseX += hs.speedX * dt;
    hs.phaseY += hs.speedY * dt;
    hs.phaseZ += hs.speedZ * dt;
    hs.valueX = Math.sin(hs.phaseX) * hs.amplitudeX;
    hs.valueY = Math.cos(hs.phaseY) * hs.amplitudeY;
    hs.valueZ = Math.sin(hs.phaseZ) * hs.amplitudeZ;
  }

  function updateIdleEyes(ctrl, dt, now) {
    if (!ctrl || !ctrl._idleEyes) return;
    const ie = ctrl._idleEyes;
    if (now >= ie.nextChangeTime) {
      ie.targetX = (Math.random() * 2 - 1) * ie.amplitude;
      ie.targetY = (Math.random() * 2 - 1) * ie.amplitude * 0.6;
      ie.nextChangeTime = now + ie.minInterval + Math.random() * (ie.maxInterval - ie.minInterval);
    }
    ie.currentX += (ie.targetX - ie.currentX) * ie.lerpSpeed * dt;
    ie.currentY += (ie.targetY - ie.currentY) * ie.lerpSpeed * dt;
  }

  function updateBrows(ctrl, dt, now) {
    if (!ctrl || !ctrl._brows) return;
    const br = ctrl._brows;
    if (now >= br.nextChangeTime) {
      br.targetL = (Math.random() * 2 - 1) * br.amplitude;
      br.targetR = (Math.random() * 2 - 1) * br.amplitude;
      br.nextChangeTime = now + br.minInterval + Math.random() * (br.maxInterval - br.minInterval);
    }
    br.currentL += (br.targetL - br.currentL) * br.lerpSpeed * dt;
    br.currentR += (br.targetR - br.currentR) * br.lerpSpeed * dt;
  }

  window.AMADEUS.L2D_PHYSICS = {
    updateBlink,
    updateBreathing,
    updateSway,
    updateHeadSway,
    updateIdleEyes,
    updateBrows,
  };
})();
