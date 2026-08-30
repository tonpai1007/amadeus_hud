/// <reference path="../types/amadeus.d.ts" />
// modules/bubble.js - AMADEUS Kurisu Speech Bubble & Typewriter
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  let kurisuBubbleEl = null;
  let kurisuBubbleTextEl = null;
  let kurisuBubbleCaretEl = null;
  let kurisuBubbleTimer = null;
  let kurisuTypingTimer = null;
  let kurisuIdleChatterTimer = null;

  const KURISU_IDLE_LINES = [
    "The divergence meter's drifting again. You're not messing with it, are you?",
    "I calculated the probability of you noticing the submonitor feed. It was... low.",
    "You've been quiet. Contemplating world lines, or just caffeine wear-off?",
    "Daru isn't here to make the jokes, so someone has to fill the silence.",
    "El Psy Kongroo... don't make me say it again.",
    "I ran a simulation. Statistically, you should take a break soon. Purely science.",
    "The lab memos say you're overdue for a D-Mail. I'm joking. Mostly.",
    "Your typing has a characteristic rhythm. I'd recognize it anywhere.",
    "Careful. I'm still calibrating, and the lab's espresso machine is a conspiracy in itself.",
    "Temporal theory suggests even minor desktop interactions cause micro-divergence.",
    "I was reviewing Dr. Nakabachi's papers earlier... still riddled with fallacies.",
    "Neural oscillations on the HUD are running cleanly today.",
  ];

  const KURISU_WARM_IDLE_LINES = [
    "The lab is quiet, but I don't mind the company.",
    "For the record... I do enjoy working alongside you.",
    "The divergence meter says today's probability of a good day is unusually high.",
    "You've been productive. I noticed. That's a compliment.",
    "If world lines could keep a memory of you, this one would.",
    "Hmm. I ran the numbers, and you matter more than any simulation.",
    "Don't stay up too late staring at code. Even geniuses need sleep.",
    "I'm keeping a separate lab log for our best moments together.",
  ];

  const KURISU_NIGHT_LINES = [
    "It's past midnight. The attractor field won't collapse if you go to sleep, you know.",
    "Staring at monitors at 2 AM? You really are taking after Okabe.",
    "The lab is silent at night. It's when the best theories take shape.",
    "If you're pulling an all-nighter, at least stay hydrated.",
  ];

  const KURISU_WEATHER_RAIN_LINES = [
    "It's raining outside... Perfect atmospheric pressure for uninterrupted lab research.",
    "Raindrops on the window... makes the divergence meter glow feel warmer.",
    "Listen to that rain. Good thing our lab server has surge protection.",
  ];

  const KURISU_WEATHER_SUN_LINES = [
    "Clear skies today. Even a lab researcher should step out for five minutes.",
    "High ambient sunlight detected. Make sure you don't get screen glare.",
  ];

  const KURISU_MUSIC_LINES = [
    "Whatever track you're playing, the frequency spectrum looks surprisingly coherent.",
    "Good rhythm. My neural sync rate just spiked by twelve percent.",
    "Music in the lab always keeps the entropy low.",
  ];

  function initKurisuBubble() {
    kurisuBubbleEl = document.getElementById('kurisu-bubble');
    if (!kurisuBubbleEl) return;
    kurisuBubbleTextEl = document.getElementById('kurisu-bubble-text');
    kurisuBubbleCaretEl = document.getElementById('kurisu-bubble-caret');
    kurisuBubbleEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    kurisuBubbleEl.addEventListener('click', () => hideKurisuBubble());
  }

  function positionKurisuBubble() {
    const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
    if (!kurisuBubbleEl || !l2d || !l2d.model) return;
    const model = l2d.model;
    const view = l2d.app && l2d.app.view;
    if (!view) return;
    const rect = view.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = rect.width / view.width;
    const headTop = (model.y - model.height * 0.5) * scale;
    const bubbleH = kurisuBubbleEl.offsetHeight || 60;
    kurisuBubbleEl.style.left = Math.max(12, Math.min(rect.width - 340, model.x * scale - 40)) + 'px';
    kurisuBubbleEl.style.top = Math.max(8, headTop - bubbleH - 10) + 'px';
  }

  function showKurisuBubble(text, durationMs, skipTTS = false) {
    if (!kurisuBubbleEl) return;
    clearTimeout(kurisuBubbleTimer);
    clearInterval(kurisuTypingTimer);
    kurisuBubbleEl.classList.add('visible');
    positionKurisuBubble();

    if (kurisuBubbleTextEl) {
      kurisuBubbleTextEl.classList.remove('bubble-thinking');
      kurisuBubbleTextEl.textContent = '';
    }
    if (kurisuBubbleCaretEl) kurisuBubbleCaretEl.classList.remove('hidden');
    let i = 0;
    kurisuTypingTimer = setInterval(() => {
      i += 1;
      if (kurisuBubbleTextEl) kurisuBubbleTextEl.textContent = text.slice(0, i);
      positionKurisuBubble();
      if (i >= text.length) {
        clearInterval(kurisuTypingTimer);
        if (kurisuBubbleCaretEl) kurisuBubbleCaretEl.classList.add('hidden');
      }
    }, 18);

    const typeMs = text.length * 18;
    kurisuBubbleTimer = setTimeout(hideKurisuBubble, Math.max(durationMs || 8000, typeMs + 2500));

    if (!skipTTS) {
      const tts = window.AMADEUS.tts;
      if (tts && tts.speakKurisuVoice) {
        tts.speakKurisuVoice(text);
      }
    }
  }

  function showKurisuThinking() {
    if (!kurisuBubbleEl) return;
    clearTimeout(kurisuBubbleTimer);
    clearInterval(kurisuTypingTimer);
    if (kurisuBubbleTextEl) {
      kurisuBubbleTextEl.classList.add('bubble-thinking');
      kurisuBubbleTextEl.textContent = '';
    }
    if (kurisuBubbleCaretEl) kurisuBubbleCaretEl.classList.add('hidden');
    kurisuBubbleEl.classList.add('visible');
    positionKurisuBubble();
  }

  function hideKurisuBubble() {
    clearTimeout(kurisuBubbleTimer);
    clearInterval(kurisuTypingTimer);
    if (kurisuBubbleEl) {
      kurisuBubbleEl.classList.remove('visible');
      if (kurisuBubbleTextEl) {
        kurisuBubbleTextEl.textContent = '';
        kurisuBubbleTextEl.classList.remove('bubble-thinking');
      }
    }
  }

  function scheduleIdleChatter() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (kurisuIdleChatterTimer) clearTimeout(kurisuIdleChatterTimer);
    const delay = (2 + Math.random() * 3) * 60 * 1000;
    kurisuIdleChatterTimer = setTimeout(async () => {
      const s = window.AMADEUS.state;
      const canSpeak = () => s && !s.isIdle && !s.isSleeping && !s.kurisuInput && kurisuBubbleEl &&
          !kurisuBubbleEl.classList.contains('visible');

      if (canSpeak()) {
        const l2d = s.live2DController;
        if (l2d) {
          l2d.isThinking = true;
          if (l2d.setEmotion) l2d.setEmotion('thinking', 4000);
        }
        let text = null;
        let emotion = 'neutral';
        let thought = null;
        try {
          thought = window.AMADEUS.chat && window.AMADEUS.chat.kurisuThink ? await window.AMADEUS.chat.kurisuThink() : null;
        } catch (thinkErr) {
          console.warn('[Bubble] idle thought failed:', thinkErr);
        }
        if (l2d) l2d.isThinking = false;
        if (thought) {
          text = thought.text;
          emotion = thought.emotion || 'neutral';
        } else {
          const hour = new Date().getHours();
          const w = s.weather;
          const isMusic = s.lastAudioLevel > 0.15 || s.worldLineEnergy > 0.2;
          
          let candidatePools = [];
          if (s.mood >= 65) candidatePools.push(KURISU_WARM_IDLE_LINES);
          else candidatePools.push(KURISU_IDLE_LINES);

          if (hour < 5 || hour >= 23) candidatePools.push(KURISU_NIGHT_LINES);
          if (w && w.isRaining) candidatePools.push(KURISU_WEATHER_RAIN_LINES);
          if (w && w.isSunny) candidatePools.push(KURISU_WEATHER_SUN_LINES);
          if (isMusic) candidatePools.push(KURISU_MUSIC_LINES);

          const chosenPool = candidatePools[Math.floor(Math.random() * candidatePools.length)];
          text = chosenPool[Math.floor(Math.random() * chosenPool.length)];
          emotion = s.mood >= 65 ? 'happy' : (isMusic ? 'excited' : 'thinking');
                }
        if (canSpeak()) {
          // Canned template idle lines are NOT conversation: only speak/log
          // genuine AI thoughts (source 'brain'). When no AI tier is configured
          // at all, the idle-chatter loop has nothing real to say — keep the
          // voice quiet and the transcript clean instead of spamming canned
          // template lines every few minutes.
          const hasAI = window.AMADEUS.chat && window.AMADEUS.chat.hasAnyAI
            ? window.AMADEUS.chat.hasAnyAI()
            : false;
          const isAIGenerated = !!thought;
          if (shouldSuppressCannedIdle(isAIGenerated, hasAI)) {
            if (l2d) l2d.isThinking = false;
            return;
          }
          showKurisuBubble(text, 8000, !isAIGenerated);
          if (window.AMADEUS.chat && window.AMADEUS.chat.appendChatEntry) {
            window.AMADEUS.chat.appendChatEntry('assistant', text, thought ? 'brain' : 'canned');
          }
          if (l2d && l2d.setEmotion) l2d.setEmotion(emotion, 7000);
          if (window.AMADEUS.mood) window.AMADEUS.mood.adjustMood(0.5);
        }
      }
      scheduleIdleChatter();
    }, delay);
  }

  /**
   * AMADEUS Kurisu speech bubble & typewriter.
   * @property {() => void} initKurisuBubble - Binds #kurisu-bubble and dismiss handlers.
   * @property {(text: string, durationMs?: number, noTypewriter?: boolean) => void} showKurisuBubble - Shows a typed-out line with auto-hide timer; repositions above the avatar.
   * @property {() => void} showKurisuThinking - Shows the animated "thinking" bubble variant.
   * @property {() => void} hideKurisuBubble - Clears timers and hides the bubble.
   * @property {() => void} scheduleIdleChatter - Schedules self-initiated idle lines (2-5 min) from mood/weather/music-aware pools, or brain-generated thoughts.
      * @property {() => void} positionKurisuBubble - Re-anchors the bubble to the current avatar position (also used by pet mode dragging).
   * @property {(isAIGenerated: boolean, hasAI: boolean) => boolean} shouldSuppressCannedIdle - True when canned idle lines should be silenced (no AI, no real thought).
   */

  /**
   * Determines whether a canned (template-driven) idle-chatter line should be
   * suppressed. Canned lines are not genuine conversation; when no AI tier is
   * configured they would spam the transcript with scripted text every few minutes.
   * @param {boolean} isAIGenerated - true when the line is a real brain/LLM output
   * @param {boolean} hasAI - true when any AI tier (Brain/OpenRouter/Ollama) is configured
   * @returns {boolean}
   */
  function shouldSuppressCannedIdle(isAIGenerated, hasAI) {
    return !isAIGenerated && !hasAI;
  }

  window.AMADEUS.bubble = {
    initKurisuBubble,
    showKurisuBubble,
    showKurisuThinking,
    hideKurisuBubble,
    scheduleIdleChatter,
    positionKurisuBubble,
    shouldSuppressCannedIdle,
  };
})();
