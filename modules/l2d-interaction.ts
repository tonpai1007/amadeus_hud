/// <reference path="../types/amadeus.d.ts" />
// modules/l2d-interaction.js - AMADEUS Live2D Interaction & Authentic VA Sound Engine
// Triggers authentic Makise Kurisu voice actress audio clips (Asami Imai) on gesture hits.

window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  let activeAudio = null;
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let lastShakeTime = 0;
  let shakeAccumulator = 0;
  let lastPointerPos = { x: 0, y: 0, time: 0 };

  const VA_SOUND_BANK = {
    flickHead: {
      emotion: 'annoyed',
      holdMs: 3200,
      sounds: [
        { file: 'sounds/flickHead_00.mp3', text: 'ちょっと、急に頭を触らないでよ！ [Hey, don\'t touch my head so suddenly!]' },
        { file: 'sounds/flickHead_01.mp3', text: 'な、何するのよ…変なこと考えないで！ [Wh-What are you doing... don\'t get weird ideas!]' },
        { file: 'sounds/flickHead_02.mp3', text: 'ツンデレって言わないで！私はただ科学的にだな… [Don\'t call me a tsundere! I\'m just being scientific...]' },
      ]
    },
    tapBody: {
      emotion: 'curious',
      holdMs: 2800,
      sounds: [
        { file: 'sounds/tapBody_00.mp3', text: 'どうしたの？何か気になることでも？ [What\'s wrong? Is something on your mind?]' },
        { file: 'sounds/tapBody_01.mp3', text: 'オカベ…じゃなくて、あなた、何か用？ [Okabe... I mean, you, do you need something?]' },
        { file: 'sounds/tapBody_02.mp3', text: 'Amadeusシステム、正常稼働中よ。 [Amadeus system operating normally.]' },
      ]
    },
    shake: {
      emotion: 'flustered',
      holdMs: 3500,
      sounds: [
        { file: 'sounds/shake_00.mp3', text: 'きゃっ！？揺らさないで、目が回る…！ [Kyaa!? Don\'t shake me, I\'m getting dizzy...!]' },
        { file: 'sounds/shake_01.mp3', text: 'ふ、不規則な加速度運動はやめて！ [St-Stop with this irregular acceleration motion!]' },
        { file: 'sounds/shake_02.mp3', text: 'もうっ！ラボメン失格よ！ [Geez! You\'re disqualified as a lab member!]' },
      ]
    },
    pinchIn: {
      emotion: 'tsundere',
      holdMs: 3000,
      sounds: [
        { file: 'sounds/pinchIn_00.mp3', text: 'あんまり近寄らないで…！ [Don\'t get so close...]' },
        { file: 'sounds/pinchIn_01.mp3', text: 'な、何じっと見てるのよ… [Wh-What are you staring at...]' },
        { file: 'sounds/pinchIn_02.mp3', text: '顔が近いって言ってるでしょ！ [I said you\'re too close!]' },
      ]
    },
    pinchOut: {
      emotion: 'thinking',
      holdMs: 2800,
      sounds: [
        { file: 'sounds/pinchOut_00.mp3', text: '観測距離を保ちなさいよね。 [Maintain proper observation distance, okay?]' },
        { file: 'sounds/pinchOut_01.mp3', text: '遠くからでも、あなたの行動は見えてるわ。 [Even from far away, I can see what you\'re doing.]' },
        { file: 'sounds/pinchOut_02.mp3', text: 'データ同期、継続中よ。 [Data synchronization continuing.]' },
      ]
    }
  };

  function initAudioLipSync(audioEl, ctrl) {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }

      if (!analyser) {
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
      }

      // Disconnect previous source to avoid graph leaks / duplicate routing
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch (e) { /* ignore */ }
        sourceNode = null;
      }
      try {
        sourceNode = audioContext.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
      } catch (e) {
        // Element may already be connected to a source
      }
      try {
        analyser.connect(audioContext.destination);
      } catch (e) {
        // May already be connected
      }

      const pcmData = new Uint8Array(analyser.frequencyBinCount);
      const mouthCb = () => {
        if (!ctrl || !activeAudio || activeAudio.paused) {
          if (ctrl) ctrl.setLipSync(0);
          window.AMADEUS.offMasterTick(mouthCb);
          return;
        }
        analyser.getByteFrequencyData(pcmData);
        let sum = 0;
        for (let i = 0; i < 16; i++) sum += pcmData[i];
        const amp = Math.min(1.0, (sum / 16) / 128);
        ctrl.setLipSync(amp);
      };
      window.AMADEUS.onMasterTick(mouthCb);
    } catch (err) {
      console.debug("[VA Audio] LipSync fallback:", err);
    }
  }

  function playVASound(ctrl, actionType) {
    if (!ctrl) return;
    const group = VA_SOUND_BANK[actionType];
    if (!group || !group.sounds || !group.sounds.length) return;

    // Pick random voice line
    const item = group.sounds[Math.floor(Math.random() * group.sounds.length)];

    // Stop current active sound
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch (e) {}
    }

    try {
      activeAudio = new Audio(item.file);
      activeAudio.volume = 0.85;

      // Emotion reaction
      setEmotion(ctrl, group.emotion, group.holdMs);

      // Display speech bubble without triggering secondary TTS
      if (window.AMADEUS.bubble && window.AMADEUS.bubble.showKurisuBubble) {
        window.AMADEUS.bubble.showKurisuBubble(item.text, group.holdMs + 1000, true);
      }

      // Append to history
      if (window.AMADEUS.chat && window.AMADEUS.chat.appendChatEntry) {
        window.AMADEUS.chat.appendChatEntry('assistant', item.text, 'history');
      }

      activeAudio.play().then(() => {
        initAudioLipSync(activeAudio, ctrl);
      }).catch(err => {
        console.warn("[VA Sound] Audio play blocked or not found:", err);
      });

      activeAudio.onended = () => {
        if (ctrl) ctrl.setLipSync(0);
      };
    } catch (e) {
      console.warn("[VA Sound] Playback error:", e);
    }
  }

  let cachedViewRect = null;
  let lastRectTime = 0;

  function getViewRect(view) {
    const now = performance.now();
    if (!cachedViewRect || now - lastRectTime > 1000) {
      cachedViewRect = view.getBoundingClientRect();
      lastRectTime = now;
    }
    return cachedViewRect;
  }

  window.addEventListener('resize', () => {
    cachedViewRect = null;
  }, { passive: true });

  function handlePointerMove(ctrl, e) {
    if (!ctrl || !ctrl.app || !ctrl.app.view) return;
    const rect = getViewRect(ctrl.app.view);
    if (rect.width === 0 || rect.height === 0) return;

    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    ctrl._cursorNX = nx;
    ctrl._cursorNY = ny;

    // Shake detection on fast cursor movement
    const now = performance.now();
    const dt = now - lastPointerPos.time;
    if (dt > 16 && dt < 200) {
      const dist = Math.hypot(e.clientX - lastPointerPos.x, e.clientY - lastPointerPos.y);
      const speed = dist / dt;
      if (speed > 3.5 && dist > 80) {
        shakeAccumulator += 1;
        if (shakeAccumulator >= 5 && (now - lastShakeTime > 6000)) {
          lastShakeTime = now;
          shakeAccumulator = 0;
          playVASound(ctrl, 'shake');
        }
      } else {
        shakeAccumulator = Math.max(0, shakeAccumulator - 0.2);
      }
    }
    lastPointerPos = { x: e.clientX, y: e.clientY, time: now };

    // Face proximity calculation
    const faceX = 0.5;
    const faceY = 0.35;
    const distToFace = Math.hypot(nx - faceX, (ny - faceY) * 1.5);
    ctrl._proximity = Math.max(0, Math.min(1, 1 - distToFace / 0.45));

    if (ctrl.onProximity) ctrl.onProximity(ctrl._proximity);
  }

  function handleTap(ctrl, clientX, clientY) {
    if (!ctrl || !ctrl.model || !ctrl.app || !ctrl.app.view) {
      playVASound(ctrl, 'tapBody');
      return;
    }

    const rect = getViewRect(ctrl.app.view);
    const viewW = rect.width || window.innerWidth;
    const viewH = rect.height || window.innerHeight;

    // Check vertical touch height relative to avatar
    const relY = clientY / viewH;

    if (relY < 0.45) {
      // Head / Cheek zone
      playVASound(ctrl, 'flickHead');
      if (ctrl.onMood) ctrl.onMood(-1);
    } else {
      // Body zone
      playVASound(ctrl, 'tapBody');
      if (ctrl.onMood) ctrl.onMood(1);
    }
  }

  function handleWheel(ctrl, deltaY) {
    const now = performance.now();
    if (now - lastShakeTime < 4000) return;
    lastShakeTime = now;
    if (deltaY < 0) {
      playVASound(ctrl, 'pinchIn');
    } else {
      playVASound(ctrl, 'pinchOut');
    }
  }

  function interactShadow(ctrl) {
    if (!ctrl) return;
    playVASound(ctrl, 'flickHead');
  }

  function setEmotion(ctrl, emo, hold) {
    if (window.AMADEUS.L2D_EMOTION) {
      window.AMADEUS.L2D_EMOTION.setEmotion(ctrl, emo, hold);
    }
  }

  window.AMADEUS.L2D_INTERACTION = {
    handlePointerMove,
    handleTap,
    handleWheel,
    playVASound,
    interactShadow,
  };
})();
