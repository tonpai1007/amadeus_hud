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
    
    let targetX = Math.sin(hs.phaseX) * hs.amplitudeX;
    let targetY = Math.cos(hs.phaseY) * hs.amplitudeY;
    hs.valueZ = Math.sin(hs.phaseZ) * hs.amplitudeZ;

    const s = window.AMADEUS.state;
    const isTyping = ctrl.isTyping || (s && s.kurisuInput && s.kurisuInput.length > 0);

    if (s && s.cursorSeen && typeof s.cursorNX === 'number' && typeof s.cursorNY === 'number') {
      const mouseAngleX = (s.cursorNX - 0.5) * 30; 
      const mouseAngleY = (0.5 - s.cursorNY) * 30; 
      targetX = mouseAngleX + targetX * 0.2; 
      targetY = mouseAngleY + targetY * 0.2; 
    }

    // Typing awareness: lean head slightly forward and tilted with curious interest
    if (isTyping) {
      targetY += 5.5; // pitch forward towards user
      targetX *= 0.6; // stabilize gaze
    }

    // Music bounce: if music is active, add rhythm bounce
    if (ctrl._musicEnergy > 0.15) {
      const beatBob = Math.sin(performance.now() * 0.008) * (ctrl._musicEnergy * 3.5);
      targetY += beatBob;
    }

    if (hs.valueX === undefined) hs.valueX = 0;
    if (hs.valueY === undefined) hs.valueY = 0;
    const lerp = Math.min(1.0, 0.05 * (dt / 16.66));
    hs.valueX += (targetX - hs.valueX) * lerp;
    hs.valueY += (targetY - hs.valueY) * lerp;
  }

  function updateIdleEyes(ctrl, dt, now) {
    if (!ctrl || !ctrl._idleEyes) return;
    const ie = ctrl._idleEyes;
    const s = window.AMADEUS.state;
    const isTyping = ctrl.isTyping || (s && s.kurisuInput && s.kurisuInput.length > 0);
    
    let targetX = 0;
    let targetY = 0;

    if (isTyping) {
      // Look down-center towards chat input terminal with curious interest
      targetX = 0;
      targetY = -0.45;
    } else if (s && s.cursorSeen && typeof s.cursorNX === 'number' && typeof s.cursorNY === 'number') {
      targetX = (s.cursorNX - 0.5) * 1.8; 
      targetY = (0.5 - s.cursorNY) * 1.8; 
    } else {
      if (now >= ie.nextChangeTime) {
        ie.targetX = (Math.random() * 2 - 1) * ie.amplitude;
        ie.targetY = (Math.random() * 2 - 1) * ie.amplitude * 0.6;
        ie.nextChangeTime = now + ie.minInterval + Math.random() * (ie.maxInterval - ie.minInterval);
      }
      targetX = ie.targetX;
      targetY = ie.targetY;
    }

    const lerp = Math.min(1.0, ie.lerpSpeed * dt * 2.5);
    ie.currentX += (targetX - ie.currentX) * lerp;
    ie.currentY += (targetY - ie.currentY) * lerp;
  }

  function updateBrows(ctrl, dt, now) {
    if (!ctrl || !ctrl._brows) return;
    const br = ctrl._brows;
    const s = window.AMADEUS.state;
    const isTyping = ctrl.isTyping || (s && s.kurisuInput && s.kurisuInput.length > 0);

    if (isTyping) {
      // Raised inquisitive brows while user types
      br.targetL = 0.28;
      br.targetR = 0.28;
    } else if (now >= br.nextChangeTime) {
      br.targetL = (Math.random() * 2 - 1) * br.amplitude;
      br.targetR = (Math.random() * 2 - 1) * br.amplitude;
      br.nextChangeTime = now + br.minInterval + Math.random() * (br.maxInterval - br.minInterval);
    }
    br.currentL += (br.targetL - br.currentL) * br.lerpSpeed * dt;
    br.currentR += (br.targetR - br.currentR) * br.lerpSpeed * dt;
  }

  function updateMusicMood(ctrl, dt) {
    if (!ctrl) return;
    const music = ctrl._musicEnergy || 0;

    if (music > 0.35) {
      ctrl._sway.speedZ = 0.0016;
      ctrl._sway.amplitudeZ = 2.4;
      if (ctrl.setEmotion && ctrl.currentEmotion !== 'happy' && ctrl.currentEmotion !== 'excited') {
        if (Math.random() < 0.02) {
          ctrl.setEmotion('happy', 4000);
        }
      }
    } else if (music < 0.08) {
      ctrl._sway.speedZ = 0.0008;
      ctrl._sway.amplitudeZ = 1.5;
    }
  }

  /**
   * AMADEUS Live2D procedural physics & micro-animation.
   * Pure update functions driven by the controller's animation tick.
   * @property {(ctrl: object, dt: number, now: number) => void} updateBlink - Stateful blink state machine (double-blinks, random intervals).
   * @property {(ctrl: object, dt: number) => void} updateBreathing - Sinusoidal breath parameter.
   * @property {(ctrl: object, dt: number) => void} updateSway - Body sway oscillation (amplitude/speed modulated by music energy).
   * @property {(ctrl: object, dt: number) => void} updateHeadSway - Head tracking toward the cursor with typing lean and music bob.
   * @property {(ctrl: object, dt: number, now: number) => void} updateIdleEyes - Idle saccades vs cursor tracking vs typing gaze.
   * @property {(ctrl: object, dt: number, now: number) => void} updateBrows - Idle brow drift vs raised inquisitive typing brows.
   * @property {(ctrl: object, dt: number) => void} updateMusicMood - Music-energy-driven sway tuning and occasional happy flashes.
   */
  window.AMADEUS.L2D_PHYSICS = {
    updateBlink,
    updateBreathing,
    updateSway,
    updateHeadSway,
    updateIdleEyes,
    updateBrows,
    updateMusicMood,
  };
})();
