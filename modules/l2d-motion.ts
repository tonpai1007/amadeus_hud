/// <reference path="../types/amadeus.d.ts" />
// modules/l2d-motion.ts - AMADEUS Live2D Motion Playback Scheduler
// The bundled model3.json defines Idle / TapHead / TapBody / Special motion
// groups, but pixi-live2d-display only autoplays the Idle group — taps and
// ambient specials were never triggered. This module schedules them and
// publishes a "motion-led" flag (ctrl._motionLed) while an EVENT motion we
// started is playing, so the controller's procedural pose writes stand down
// instead of fighting the Cubism motion values.
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  // MotionPriority in pixi-live2d-display: NONE=0, IDLE=1, NORMAL=2, FORCE=3.
  // NORMAL preempts the looping idle motions without stomping FORCE-level stuff.
  const EVENT_PRIORITY = 2;
  const AMBIENT_MIN_MS = 45 * 1000;
  const AMBIENT_MAX_MS = 90 * 1000;

  function motionManager(ctrl) {
    return ctrl && ctrl.model && ctrl.model.internalModel && ctrl.model.internalModel.motionManager;
  }

  // True while ANY motion (including the library's idle loop) is playing.
  // In the bundled build, MotionState.shouldRequestIdleMotion() returns true
  // exactly when the motion queue has drained.
  function isMotionPlaying(ctrl) {
    const mm = motionManager(ctrl);
    try {
      if (mm && mm.state && typeof mm.state.shouldRequestIdleMotion === 'function') {
        return !mm.state.shouldRequestIdleMotion();
      }
    } catch (e) { /* older build — fall through */ }
    return false;
  }

  function canPlay(ctrl) {
    if (!ctrl || !ctrl.model || ctrl._petMode) return false;
    const s = window.AMADEUS.state;
    if (s && (s.isSleeping || s.isLivelyPaused)) return false;
    return true;
  }

  // Fire a random motion from a group. Marks the controller motion-led only
  // if the runtime actually accepted the motion (the promise resolves true).
  function playGroup(ctrl, group) {
    if (!canPlay(ctrl) || !ctrl.model || typeof ctrl.model.motion !== 'function') return false;
    try {
      const res = ctrl.model.motion(group, undefined, EVENT_PRIORITY);
      Promise.resolve(res).then((ok) => {
        if (ok) ctrl._motionLed = true;
      }).catch(() => { /* motion file missing/audio failed — ignore */ });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Per-tick scheduler (called from the controller's procedural tick).
  function updateMotion(ctrl, dt, now) {
    if (!ctrl) return;
    // Release the gate once our event motion has drained out of the queue.
    if (ctrl._motionLed && !isMotionPlaying(ctrl)) ctrl._motionLed = false;

    let st = ctrl._motionSched;
    if (!st) {
      st = ctrl._motionSched = {
        nextAt: now + AMBIENT_MIN_MS + Math.random() * (AMBIENT_MAX_MS - AMBIENT_MIN_MS),
      };
    }
    if (now < st.nextAt) return;
    st.nextAt = now + AMBIENT_MIN_MS + Math.random() * (AMBIENT_MAX_MS - AMBIENT_MIN_MS);

    // Don't stack event motions; idle-loop playback is fine to preempt.
    if (ctrl._motionLed) return;
    const feats = ctrl._features || {};
    if (feats.ambientMotions === false) return;
    playGroup(ctrl, 'Special');
  }

  // Tap choreography: head hits play TapHead, everything else TapBody.
  // Called from L2D_INTERACTION.handleTap after the expression/emotion layer.
  function playTapMotion(ctrl, zone) {
    if (!canPlay(ctrl) || ctrl._motionLed) return false;
    return playGroup(ctrl, zone === 'head' ? 'TapHead' : 'TapBody');
  }

  /**
   * AMADEUS Live2D motion playback scheduler.
   * @property {(ctrl: object, dt: number, now: number) => void} updateMotion - Ambient Special-motion scheduler + motion-led gate release (called from the controller tick).
   * @property {(ctrl: object, zone: string) => boolean} playTapMotion - Plays a TapHead/TapBody motion for a tap interaction.
   * @property {(ctrl: object) => boolean} isMotionPlaying - True while any Cubism motion (idle loop included) is playing.
   * @property {(ctrl: object, group: string) => boolean} playGroup - Starts a random motion from a named group at NORMAL priority.
   */
  window.AMADEUS.L2D_MOTION = {
    updateMotion,
    playTapMotion,
    isMotionPlaying,
    playGroup,
  };
})();
