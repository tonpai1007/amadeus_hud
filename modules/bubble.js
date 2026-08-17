// modules/bubble.js - AMADEUS Kurisu Speech Bubble & Typewriter
window.AMADEUS = window.AMADEUS || {};

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
  ];

  const KURISU_WARM_IDLE_LINES = [
    "The lab is quiet, but I don't mind the company.",
    "For the record... I do enjoy working alongside you.",
    "The divergence meter says today's probability of a good day is unusually high.",
    "You've been productive. I noticed. That's a compliment.",
    "If world lines could keep a memory of you, this one would.",
    "Hmm. I ran the numbers, and you matter more than any simulation.",
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

  function showKurisuBubble(text, durationMs) {
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

    const tts = window.AMADEUS.tts;
    if (tts && tts.speakKurisuVoice) {
      tts.speakKurisuVoice(text);
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
        let emotion = 'thinking';
        const thought = window.AMADEUS.chat && window.AMADEUS.chat.kurisuThink ? await window.AMADEUS.chat.kurisuThink() : null;
        if (l2d) l2d.isThinking = false;
        if (thought) {
          text = thought.text;
          emotion = thought.emotion;
        } else {
          const pool = s.mood >= 65 ? KURISU_WARM_IDLE_LINES : KURISU_IDLE_LINES;
          text = pool[Math.floor(Math.random() * pool.length)];
        }
        if (canSpeak()) {
          showKurisuBubble(text, 8000);
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

  window.AMADEUS.bubble = {
    initKurisuBubble,
    showKurisuBubble,
    showKurisuThinking,
    hideKurisuBubble,
    scheduleIdleChatter,
    positionKurisuBubble,
  };

  window.initKurisuBubble = initKurisuBubble;
  window.showKurisuBubble = showKurisuBubble;
  window.showKurisuThinking = showKurisuThinking;
  window.hideKurisuBubble = hideKurisuBubble;
  window.scheduleIdleChatter = scheduleIdleChatter;
  window.positionKurisuBubble = positionKurisuBubble;
})();
