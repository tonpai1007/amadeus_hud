// modules/l2d-interaction.js - AMADEUS Live2D Interaction & Pointer Tracking
window.AMADEUS = window.AMADEUS || {};

(function() {
  function getCheekZone(ctrl) {
    if (!ctrl || !ctrl.model || !ctrl.app || !ctrl.app.view) return null;
    const m = ctrl.model;
    const v = ctrl.app.view;
    const scale = v.getBoundingClientRect().width / (v.width || 1);
    const headW = m.width * 0.45 * scale;
    const headH = m.height * 0.25 * scale;
    const headX = m.x * scale - headW * 0.5;
    const headY = (m.y - m.height * 0.45) * scale;
    return { x: headX, y: headY, w: headW, h: headH };
  }

  function handlePointerMove(ctrl, e) {
    if (!ctrl || !ctrl.app || !ctrl.app.view) return;
    const rect = ctrl.app.view.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    ctrl._cursorNX = nx;
    ctrl._cursorNY = ny;

    // Face proximity calculation
    const faceX = 0.5;
    const faceY = 0.35;
    const dist = Math.hypot(nx - faceX, (ny - faceY) * 1.5);
    ctrl._proximity = Math.max(0, Math.min(1, 1 - dist / 0.45));

    if (ctrl.onProximity) ctrl.onProximity(ctrl._proximity);
  }

  function interactShadow(ctrl) {
    if (!ctrl) return;
    setEmotion(ctrl, 'surprised', 2000);
    const shadowLines = [
      "H-hey! Watch your step!",
      "My shadow is not a playground.",
      "Careful! You nearly made me stumble.",
    ];
    const line = shadowLines[Math.floor(Math.random() * shadowLines.length)];
    if (ctrl.onInteract) ctrl.onInteract(line);
  }

  function setEmotion(ctrl, emo, hold) {
    if (window.AMADEUS.L2D_EMOTION) {
      window.AMADEUS.L2D_EMOTION.setEmotion(ctrl, emo, hold);
    }
  }

  window.AMADEUS.L2D_INTERACTION = {
    getCheekZone,
    handlePointerMove,
    interactShadow,
  };
})();
