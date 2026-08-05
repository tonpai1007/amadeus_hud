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
let ringBarGradient = null;  // cached radial gradient for the spectrum bars (rebuilt on resize)

// --- IDLE / PAUSE POWER SAVING ---
// Lively keeps pushing near-zero audio arrays when the system is silent, so we
// drop to a slow idle state until real audio or mouse activity returns.
const IDLE_THRESHOLD_MS = 8000;
const SLEEP_THRESHOLD_MS = 20 * 60 * 1000; // no activity for 20 min = Kurisu falls asleep
const ACTIVITY_ENERGY = 0.02; // audio bins above this count as "real sound"
let lastActivityTime = performance.now();
let isIdle = false;
let isSleeping = false;
let isLivelyPaused = false; // set by --pause-event

// Nixie Tube target convergence
const defaultConvergence = "0.986254";
let currentConvergence = defaultConvergence; // live nixie reading (feeds DELTA readout)
let lastNixieShift = 0;                      // cooldown guard against audio spam
let nixieTimer = null;                       // shift-cycle timer

// Cursor position (normalized 0..1) for the audio-ring gravitational distortion
let cursorNX = 0.5;
let cursorNY = 0.5;
let cursorSeen = false;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  initClock();
  initAudioCanvas();
  initLive2D().then(kurisuGreetOnLoad);
  initWorldLine();
  fetchRealtimeNews();
  // Keep the attractor readout in sync with the configured convergence constant
  const wlAttrEl = document.getElementById('wl-attractor');
  if (wlAttrEl) wlAttrEl.innerText = `ATTRACTOR ${defaultConvergence}`;
  startIdleWatchdog();
  scheduleIdleChatter();
  initKurisuBubble();
  initKurisuChatInput();
  startNixieAmbientFlicker();
  startNixieIntro();
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
    // One-time hint that Kurisu can be talked to
    if (!kurisuHintShown) {
      kurisuHintShown = true;
      setTimeout(() => showKurisuBubble('[ type a message - press Enter to talk to me ]', 5000), 700);
    }
  }, { passive: true });
  
  // Start simulation loop (will run if Lively events aren't received)
  setTimeout(() => {
    if (!isLivelyActive) {
      console.log("AMADEUS HUD: Lively API not detected, launching browser simulation mode.");
      startBrowserSimulation();
    }
  }, 2500);
});

// --- KURISU CHAT (type to talk) ---
// Kurisu's brain tries, in order: AMADEUS Brain (local FastAPI, memory +
// emotion) -> OpenRouter (fast cloud, no local CPU/GPU load) if a key is
// configured -> local Ollama (free, offline) if its server is up -> a canned
// Steins;Gate-flavored reply pool. Typing goes to a hidden buffer; Enter sends,
// Escape dismisses.
const KURISU_BRAIN = {
  // Local AMADEUS Brain (set your key in brain-key.js)
  endpoint: 'http://127.0.0.1:8000',
  timeoutMs: 20000,
  apiKey: (typeof window !== 'undefined' && window.KURISU_BRAIN_KEY &&
           window.KURISU_BRAIN_KEY.indexOf('REPLACE') === -1)
      ? window.KURISU_BRAIN_KEY
      : '',
};

const KURISU_LLM = {
  // Cloud: OpenRouter (set your key in openrouter-key.js)
  endpoint: 'https://openrouter.ai/api/v1',
  model: 'google/gemma-4-31b-it:free',
  timeoutMs: 20000,
  apiKey: (typeof window !== 'undefined' && window.KURISU_OPENROUTER_KEY &&
           window.KURISU_OPENROUTER_KEY.indexOf('REPLACE') === -1)
      ? window.KURISU_OPENROUTER_KEY
      : '',
  // Local fallback: Ollama (free, offline)
  fallbackEndpoint: 'http://localhost:11434',
  fallbackModel: 'qwen3:4b',
  fallbackTimeoutMs: 6000,
};

const KURISU_SYSTEM_PROMPT =
  "You are Makise Kurisu, the 18-year-old neuroscience prodigy from Steins;Gate. " +
  "Respond in character: sharp, a little tsundere, scientifically precise, occasionally flustered. " +
  "Weave in a Steins;Gate reference when it fits (world lines, divergence meter, D-Mail, the lab, Daru, Okabe). " +
  "Keep replies to ONE short sentence, at most two. No markdown, no emojis, no character labels.";

// Offline fallback lines (used whenever Ollama isn't reachable)
const KURISU_CANNED = [
  "Typical. You really did change the world line just to talk to me.",
  "For the record, I'm a scientist, not your lab assistant.",
  "The divergence is reading 0.986254... and rising. Don't ask why I know that offhand.",
  "If you're drafting a D-Mail right now, I will delete it myself.",
  "Okabe's delusions are contagious, and clearly you've caught them.",
  "Hmm. Statistically, you standing here typing at a wall is... improbable.",
  "This conversation is going straight into the lab memos. Don't say anything foolish.",
  "I've told you before - I'm not your girlfriend. Now, what was it you wanted?",
  "Curious. Your persistence implies a suspiciously high curiosity coefficient.",
  "El Psy Kongroo. ...Yes, I said it. Happy now?",
];

// Ambient chatter — occasionally she mutters something unprompted while you're
// at the desk, but never while typing or while the system is idle/asleep.
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

// She says one of these when you come back after a long absence.
const KURISU_WAKE_LINES = [
  "Ah... you're back. I wasn't asleep. I was... calibrating.",
  "Waking me up had better be worth it. What is it?",
  "Hmph. I was just resting my eyes. Statistically, you're late.",
  "Welcome back. The divergence meter kept running without you.",
  "You returned. Good. The lab memos are all in order.",
];

let kurisuBubbleEl = null;
let kurisuBubbleTextEl = null;
let kurisuBubbleCaretEl = null;
let kurisuBubbleTimer = null;
let kurisuTypingTimer = null;
let kurisuIdleChatterTimer = null;
let kurisuInput = '';
let kurisuGreeted = false;
let kurisuHintShown = false;
let kurisuReplying = false; // one chat request in flight at a time

function initKurisuBubble() {
  kurisuBubbleEl = document.getElementById('kurisu-bubble');
  if (!kurisuBubbleEl) return;
  kurisuBubbleTextEl = document.getElementById('kurisu-bubble-text');
  kurisuBubbleCaretEl = document.getElementById('kurisu-bubble-caret');
  // Clicking the bubble dismisses it without also shifting the world line
  kurisuBubbleEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  kurisuBubbleEl.addEventListener('click', () => hideKurisuBubble());
}

function positionKurisuBubble() {
  if (!kurisuBubbleEl || !live2DController || !live2DController.model) return;
  const model = live2DController.model;
  const view = live2DController.app && live2DController.app.view;
  if (!view) return;
  const rect = view.getBoundingClientRect();
  if (rect.width === 0) return;
  const scale = rect.width / view.width;
  const headTop = (model.y - model.height * 0.5) * scale; // top of her head
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

  // Typewriter effect
  if (kurisuBubbleTextEl) {
    kurisuBubbleTextEl.classList.remove('bubble-thinking');
    kurisuBubbleTextEl.textContent = '';
  }
  kurisuBubbleCaretEl.classList.remove('hidden');
  let i = 0;
  kurisuTypingTimer = setInterval(() => {
    i += 1;
    kurisuBubbleTextEl.textContent = text.slice(0, i);
    positionKurisuBubble();
    if (i >= text.length) {
      clearInterval(kurisuTypingTimer);
      kurisuBubbleCaretEl.classList.add('hidden');
    }
  }, 18);

  // Never cut a long reply off mid-typing: keep the bubble up at least as
  // long as the typewriter takes, plus a short grace period.
  const typeMs = text.length * 18;
  kurisuBubbleTimer = setTimeout(hideKurisuBubble, Math.max(durationMs || 8000, typeMs + 2500));
}

// "…" placeholder bubble while Kurisu is generating a reply
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

// --- Kurisu's brain: AMADEUS Brain first, then OpenRouter, Ollama, canned ---
async function askKurisu(userText) {
  const messages = [
    { role: 'system', content: KURISU_SYSTEM_PROMPT },
    { role: 'user', content: userText },
  ];

  // 0) AMADEUS Brain (local FastAPI): memory recall + explicit emotion
  if (KURISU_BRAIN.apiKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), KURISU_BRAIN.timeoutMs);
      const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KURISU_BRAIN.apiKey}`,
        },
        body: JSON.stringify({ message: userText, user_id: 'wallpaper', history: [] }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('Brain HTTP ' + res.status);
      const data = await res.json();
      const reply = (data.response || '').trim();
      if (!reply) throw new Error('Empty Brain reply');
      return { text: reply, emotion: data.emotion || emotionFromText(reply), source: 'brain' };
    } catch (err) {
      console.warn('[Kurisu] Brain unreachable, trying OpenRouter:', err.message);
    }
  }

  // 1) Cloud: OpenRouter - fast replies, no local CPU/GPU cost
  if (KURISU_LLM.apiKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), KURISU_LLM.timeoutMs);
      const res = await fetch(`${KURISU_LLM.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KURISU_LLM.apiKey}`,
        },
        body: JSON.stringify({
          model: KURISU_LLM.model,
          messages,
          temperature: 0.8,
          max_tokens: 120,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('OpenRouter HTTP ' + res.status);
      const data = await res.json();
      const reply = (data.choices && data.choices[0] && data.choices[0].message &&
                     data.choices[0].message.content || '').trim();
      if (!reply) throw new Error('Empty OpenRouter reply');
      return { text: reply, source: 'cloud' };
    } catch (err) {
      console.warn('[Kurisu] OpenRouter unreachable, trying local Ollama:', err.message);
    }
  }

  // 2) Local: Ollama (free, offline) if the server is up
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), KURISU_LLM.fallbackTimeoutMs);
    const res = await fetch(`${KURISU_LLM.fallbackEndpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: KURISU_LLM.fallbackModel, messages, stream: false }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
    const data = await res.json();
    const reply = (data && data.message && data.message.content || '').trim();
    if (!reply) throw new Error('Empty Ollama reply');
    return { text: reply, source: 'llm' };
  } catch (err) {
    console.warn('[Kurisu] Ollama unreachable, using canned reply:', err.message);
  }

  // 3) Canned Steins;Gate-flavored lines
  return { text: KURISU_CANNED[Math.floor(Math.random() * KURISU_CANNED.length)], source: 'canned' };
}

// Map her reply's tone onto a Live2D expression
function emotionFromText(text) {
  const t = text.toLowerCase();
  if (/\b(wow|amazing|incredible|unbelievable|surpris|wonderful)\b/.test(t)) return 'surprised';
  if (/\b(sad|sorry|miss|lost|lonely|cry|worry)\b/.test(t)) return 'sad';
  if (/\b(angry|annoy|idiot|fool|jerk|stupid|baka|nonsense)\b/.test(t)) return 'annoyed';
  if (/\b(happy|smile|laugh|love|glad|fun|great|fascinating)\b/.test(t)) return 'happy';
  if (/\b(hmm|maybe|think|science|probability|experiment|theory)\b/.test(t)) return 'thinking';
  return 'content';
}

async function kurisuSay(userText) {
  if (!kurisuBubbleEl) return;
  if (kurisuReplying) return; // ignore Enter spam while a reply is pending
  kurisuReplying = true;

  // She mulls it over while the LLM thinks — thinking bubble + thoughtful gaze
  if (live2DController) {
    live2DController.isThinking = true;
    if (live2DController.setEmotion) {
      live2DController.setEmotion('thinking');
    }
  }
  showKurisuThinking();

  const reply = await askKurisu(userText.trim());

  kurisuReplying = false;
  if (live2DController) live2DController.isThinking = false;
  showKurisuBubble(reply.text, 8000);
  // ...and reacts to her own words (Brain supplies an explicit emotion tag).
  // Hold the face ~7s so the reaction is visible before ambient mood resumes.
  if (live2DController && live2DController.setEmotion) {
    live2DController.setEmotion(reply.emotion || emotionFromText(reply.text), 7000);
  }
}

function timeAwareGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning. The lab's quiet at this hour. What's on your mind?";
  if (h >= 12 && h < 18) return "Good afternoon. I've been monitoring the divergence meter, naturally.";
  if (h >= 18 && h < 23) return "Good evening. The data's still compiling... as am I.";
  return "Still awake? The world line never sleeps. Apparently neither do you.";
}

// Greet on wallpaper load: instant time-aware line, then a personalized hello
// from the AMADEUS Brain (memory-backed) when it arrives.
function kurisuGreetOnLoad() {
  if (!kurisuBubbleEl) return;
  showKurisuBubble(timeAwareGreeting(), 5500);

  if (!KURISU_BRAIN.apiKey) return;
  (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/hello`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${KURISU_BRAIN.apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return;
      const data = await res.json();
      const reply = (data.response || '').trim();
      if (!reply) return;
      setTimeout(() => {
        if (isIdle || isSleeping || kurisuInput) return;
        showKurisuBubble(reply, 8000);
        if (live2DController && live2DController.setEmotion) {
          live2DController.setEmotion(data.emotion || emotionFromText(reply), 7000);
        }
      }, 5700);
    } catch (err) {
      console.warn('[Kurisu] Greeting hello failed (using time-aware line):', err.message);
    }
  })();
}

// Kurisu's own spontaneous thought, generated by the AMADEUS Brain from her
// memories + recent conversation + time of day. Falls back to null on failure.
async function kurisuThink() {
  if (!KURISU_BRAIN.apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/think`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KURISU_BRAIN.apiKey}`,
      },
      body: JSON.stringify({ user_id: 'wallpaper' }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Brain think HTTP ' + res.status);
    const data = await res.json();
    const reply = (data.response || '').trim();
    if (!reply) throw new Error('Empty think reply');
    return { text: reply, emotion: data.emotion || emotionFromText(reply) };
  } catch (err) {
    clearTimeout(timer);
    console.warn('[Kurisu] think failed, using canned line:', err.message);
    return null;
  }
}

// Unprompted chatter while the user is around but not talking: real thoughts
// from the Brain when possible, canned lines otherwise.
function scheduleIdleChatter() {
  const delay = (10 + Math.random() * 8) * 60 * 1000; // 10-18 minutes
  kurisuIdleChatterTimer = setTimeout(async () => {
    const canSpeak = () => !isIdle && !isSleeping && !kurisuInput && kurisuBubbleEl &&
        !kurisuBubbleEl.classList.contains('visible');

    if (canSpeak()) {
      // She mulls it over while the thought is generated
      if (live2DController) {
        live2DController.isThinking = true;
        if (live2DController.setEmotion) {
          live2DController.setEmotion('thinking', 4000);
        }
      }
      let text = null;
      let emotion = 'thinking';
      const thought = await kurisuThink();
      if (live2DController) live2DController.isThinking = false;
      if (thought) {
        text = thought.text;
        emotion = thought.emotion;
      } else {
        text = KURISU_IDLE_LINES[Math.floor(Math.random() * KURISU_IDLE_LINES.length)];
      }
      // Re-check: the user may have started typing or the system went idle
      if (canSpeak()) {
        showKurisuBubble(text, 8000);
        if (live2DController && live2DController.setEmotion) {
          live2DController.setEmotion(emotion, 7000);
        }
      }
    }
    scheduleIdleChatter();
  }, delay);
}

function initKurisuChatInput() {
  window.addEventListener('keydown', (e) => {
    if (isLivelyPaused) return;
    markActivity();
    if (e.key === 'Enter') {
      if (kurisuInput.trim()) {
        const msg = kurisuInput.trim();
        kurisuInput = '';
        if (live2DController) live2DController.isTyping = false;
        kurisuSay(msg);
      }
      return;
    }
    if (e.key === 'Escape') {
      kurisuInput = '';
      if (live2DController) live2DController.isTyping = false;
      hideKurisuBubble();
      return;
    }
    if (e.key === 'Backspace') {
      kurisuInput = kurisuInput.slice(0, -1);
      return;
    }
    if (e.key.length === 1) {
      kurisuInput += e.key;
      if (live2DController) live2DController.isTyping = true;
      // "hello" triggers the classic lab greeting without pressing Enter
      if (!kurisuGreeted && /\bhello\b/i.test(kurisuInput)) {
        kurisuGreeted = true;
        kurisuInput = '';
        if (live2DController) live2DController.isTyping = false;
        kurisuSay('hello');
        return;
      }
      if (live2DController && live2DController.setEmotion) {
        live2DController.setEmotion('content'); // she notices you typing
      }
    }
  });
}

// --- ADAPTIVE IDLE POWER SAVING ---
// When the system is silent and the mouse is idle, throttle everything down.
function markActivity() {
  lastActivityTime = performance.now();
  if (isIdle) enterIdleState(false);
  if (isSleeping) enterSleepState(false);
}

function startIdleWatchdog() {
  setInterval(() => {
    if (isLivelyPaused) return; // already fully paused
    const inactiveFor = performance.now() - lastActivityTime;
    if (!isIdle && inactiveFor >= IDLE_THRESHOLD_MS) {
      enterIdleState(true);
    }
    if (!isSleeping && inactiveFor >= SLEEP_THRESHOLD_MS) {
      enterSleepState(true);
    }
  }, 2000);
}

// Long absence (20 min without any input/audio) = Kurisu actually falls asleep.
function enterSleepState(sleep) {
  if (isSleeping === sleep) return;
  isSleeping = sleep;
  if (sleep) {
    hideKurisuBubble();
    if (live2DController && live2DController.setEmotion) {
      live2DController.setEmotion('sleepy');
    }
    console.log('AMADEUS HUD: Kurisu fell asleep (no activity for 20 min).');
  } else {
    // Waking up: brief surprised flash, then a short wake line.
    if (live2DController && live2DController.setEmotion) {
      live2DController.setEmotion('surprised', 2500);
    }
    setTimeout(() => {
      if (isSleeping || !kurisuBubbleEl) return;
      const line = KURISU_WAKE_LINES[Math.floor(Math.random() * KURISU_WAKE_LINES.length)];
      showKurisuBubble(line, 6000);
    }, 900);
    console.log('AMADEUS HUD: Kurisu woke up.');
  }
}

function enterIdleState(idle) {
  if (isIdle === idle) return;
  isIdle = idle;
  // body.idle lets CSS fade the HUD chrome and pause decorative animations
  document.body.classList.toggle('idle', idle);
  if (live2DController && live2DController.setIdleMode) {
    live2DController.setIdleMode(idle);
  }
  if (live2DController && live2DController.setEmotion) {
    // System silence reads as a sleepy Kurisu; activity wakes her up neutral
    live2DController.setEmotion(idle ? 'tired' : 'neutral');
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
  if (live2DController && live2DController.triggerSurprise) {
    live2DController.triggerSurprise();
  }
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

// --- WORLD LINE OSCILLOSCOPE ---
// Replaces the old radar map with a lab oscilloscope: a scrolling graticule
// plots two live signals — the divergence offset from the attractor (amber)
// and the current audio energy (cyan) — with a peak-hold marker, live numeric
// readouts and a scan head. The amber trace is driven by the same signal math
// as the nixie meter, so the scope genuinely "measures" the world line instead
// of being decorative noise.
const SCOPE_SAMPLES = 120;      // ~8s of history at 15fps
const SCOPE_AMPLITUDE = 0.006;  // divergence scale: ±0.006 fills the scope
let scopeHistory = [];          // { d: divergence offset, a: audio energy } samples
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
    scopeHistory = [];
  }

  window.addEventListener('resize', resize);
  resize();

  setInterval(updateWorldLine, 1000 / 15);
  setInterval(updateWorldLineMeta, 500);
}

function drawScopeGraticule(w, h) {
  wlCtx.lineWidth = 1;
  // Fine grid
  wlCtx.strokeStyle = 'rgba(126, 211, 250, 0.06)';
  const grid = 18;
  for (let x = grid; x < w; x += grid) {
    wlCtx.beginPath();
    wlCtx.moveTo(x, 0);
    wlCtx.lineTo(x, h);
    wlCtx.stroke();
  }
  for (let y = grid; y < h; y += grid) {
    wlCtx.beginPath();
    wlCtx.moveTo(0, y);
    wlCtx.lineTo(w, y);
    wlCtx.stroke();
  }
  // Divergence zero baseline
  wlCtx.strokeStyle = 'rgba(255, 122, 0, 0.12)';
  wlCtx.beginPath();
  wlCtx.moveTo(0, h / 2);
  wlCtx.lineTo(w, h / 2);
  wlCtx.stroke();
}

function updateWorldLine() {
  if (!wlCtx || !wlCanvas) return;
  // Frozen frame while paused or idle: last draw stays on the canvas
  if (isLivelyPaused || isIdle) return;

  const w = wlCanvas.width;
  const h = wlCanvas.height;

  // Sample the live signal — the same math the nixie meter uses, so the scope
  // and the tubes agree about where the world line is.
  const shifted = parseFloat(computeShiftedConvergence()) || parseFloat(defaultConvergence);
  const delta = shifted - parseFloat(defaultConvergence);
  const audio = Math.max(0, Math.min(1, worldLineEnergy));
  scopeHistory.push({ d: delta, a: audio });
  if (scopeHistory.length > SCOPE_SAMPLES) scopeHistory.shift();

  const n = scopeHistory.length;
  const xFor = (i) => (i / (SCOPE_SAMPLES - 1)) * w;

  wlCtx.clearRect(0, 0, w, h);
  drawScopeGraticule(w, h);

  // Channel 1 — audio energy: filled trace rising from the bottom baseline
  const baseY = h - 5;
  const aAmp = h * 0.42;
  const audioPath = () => {
    wlCtx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = baseY - Math.min(1, scopeHistory[i].a) * aAmp;
      if (i === 0) wlCtx.moveTo(xFor(i), y);
      else wlCtx.lineTo(xFor(i), y);
    }
  };
  audioPath();
  wlCtx.lineTo(xFor(n - 1), baseY);
  wlCtx.lineTo(xFor(0), baseY);
  wlCtx.closePath();
  const aFill = wlCtx.createLinearGradient(0, baseY - aAmp, 0, baseY);
  aFill.addColorStop(0, 'rgba(126, 211, 250, 0.30)');
  aFill.addColorStop(1, 'rgba(126, 211, 250, 0.02)');
  wlCtx.fillStyle = aFill;
  wlCtx.fill();
  audioPath();
  wlCtx.strokeStyle = 'rgba(126, 211, 250, 0.85)';
  wlCtx.lineWidth = 1.5;
  wlCtx.stroke();

  // Peak hold marker for the audio channel
  let peak = 0;
  for (const s of scopeHistory) if (s.a > peak) peak = s.a;
  const py = baseY - peak * aAmp;
  wlCtx.setLineDash([3, 5]);
  wlCtx.strokeStyle = 'rgba(126, 211, 250, 0.35)';
  wlCtx.beginPath();
  wlCtx.moveTo(0, py);
  wlCtx.lineTo(w, py);
  wlCtx.stroke();
  wlCtx.setLineDash([]);

  // Channel 2 — divergence offset from the attractor (amber, centered trace)
  const midY = h / 2;
  const dScale = (h / 2 - 8) / SCOPE_AMPLITUDE;
  wlCtx.beginPath();
  for (let i = 0; i < n; i++) {
    const y = midY - scopeHistory[i].d * dScale;
    if (i === 0) wlCtx.moveTo(xFor(i), y);
    else wlCtx.lineTo(xFor(i), y);
  }
  wlCtx.strokeStyle = 'rgba(255, 122, 0, 0.95)';
  wlCtx.lineWidth = 1.5;
  wlCtx.shadowColor = 'rgba(255, 122, 0, 0.7)';
  wlCtx.shadowBlur = 6;
  wlCtx.stroke();
  wlCtx.shadowBlur = 0;

  // Live readouts (top corners) + peak label
  wlCtx.font = '9px "Share Tech Mono", monospace';
  wlCtx.textBaseline = 'top';
  const dSign = delta >= 0 ? '+' : '-';
  wlCtx.fillStyle = 'rgba(255, 122, 0, 0.9)';
  wlCtx.fillText(`Δ ${dSign}${Math.abs(delta).toFixed(4)}`, 4, 3);
  wlCtx.fillStyle = 'rgba(126, 211, 250, 0.85)';
  wlCtx.fillText(`A ${Math.round(audio * 100)}%`, w - 34, 3);
  wlCtx.fillStyle = 'rgba(126, 211, 250, 0.55)';
  wlCtx.fillText(`PK ${Math.round(peak * 100)}%`, w - 34, py + 2);

  // Scan head — bright vertical sweep line at the right edge
  const sx = w - 1;
  const scan = wlCtx.createLinearGradient(sx - 14, 0, sx, 0);
  scan.addColorStop(0, 'rgba(255, 122, 0, 0)');
  scan.addColorStop(1, 'rgba(255, 122, 0, 0.45)');
  wlCtx.fillStyle = scan;
  wlCtx.fillRect(sx - 14, 0, 14, h);
  wlCtx.fillStyle = 'rgba(255, 122, 0, 0.8)';
  wlCtx.fillRect(sx, 0, 1, h);
}

function updateWorldLineMeta() {
  const deltaEl = document.getElementById('wl-delta');
  if (!deltaEl) return;
  // Freeze the readout together with the scope while paused or idle
  if (isLivelyPaused || isIdle) return;
  // DELTA = live divergence offset — matches the scope's amber trace.
  const shown = parseFloat(computeShiftedConvergence()) || parseFloat(defaultConvergence);
  const delta = shown - parseFloat(defaultConvergence);
  const sign = delta >= 0 ? '+' : '-';
  deltaEl.innerText = `DELTA ${sign}${Math.abs(delta).toFixed(4)}`;
}

// --- CLOCK & DATE WIDGET ---
function initClock() {
  const clockEl = document.getElementById('hud-clock');
  const dateEl = document.getElementById('hud-date');
  if (!clockEl || !dateEl) return;
  const tubes = clockEl.querySelectorAll('.clock-tube');

  function update() {
    const now = new Date();
    
    // Time format: HH:MM:SS
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');

    // Nixie tubes: only write digits that changed, with a brief cathode pop
    const time = hrs + mins + secs;
    tubes.forEach((tube, idx) => {
      const d = time[idx];
      if (tube.dataset.digit === d) return;
      tube.dataset.digit = d;
      tube.innerText = d;
      tube.classList.remove('tube-pop');
      void tube.offsetWidth; // restart the animation
      tube.classList.add('tube-pop');
      if (tube._popTimer) clearTimeout(tube._popTimer);
      tube._popTimer = setTimeout(() => tube.classList.remove('tube-pop'), 400);
    });

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

  // Rebuild the shared spectrum-bar gradient once per resize instead of every frame
  if (ctx) {
    ringBarGradient = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius + 110);
    ringBarGradient.addColorStop(0, 'rgba(230, 0, 38, 0.8)');   // crimson inner
    ringBarGradient.addColorStop(1, 'rgba(255, 77, 109, 0.9)'); // rose outer
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

  ctx.strokeStyle = ringBarGradient || 'rgba(230, 0, 38, 0.8)';

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

  // 6. Ambient energy halo around Kurisu — two counter-rotating dashed rings
  //    that swell and brighten with bass (cheap: 2 stroked arcs).
  const haloR = Math.min(audioCanvas.width, audioCanvas.height) * (0.30 + bassAvg * 0.03);
  const spin = now * 0.00015;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 14]);
  ctx.strokeStyle = `rgba(126, 211, 250, ${(0.05 + bassAvg * 0.18).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, spin, spin + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([18, 6]);
  ctx.strokeStyle = `rgba(255, 77, 109, ${(0.04 + bassAvg * 0.14).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR * 0.9, -spin * 1.6, -spin * 1.6 + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
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

// --- NIXIE CONVERGENCE FLICKER & ROLL EFFECT ---
// Hard-set every digit instantly (used by the rapid flicker phase). Deliberately
// does NOT touch currentConvergence — a scramble is pure visual FX and must not
// leak into the DELTA readout, which only tracks stable rolled readings.
function setNixieDigits(digitsString) {
  const digits = digitsString.replace('.', '').split('');
  document.querySelectorAll('#divergence-meter .nixie-digit').forEach((el, idx) => {
    if (el._rollRaf) cancelAnimationFrame(el._rollRaf);
    if (digits[idx] !== undefined) {
      el.innerText = digits[idx];
    }
  });
}

// Roll each changed digit upward through the nixie stack like a real tube,
// landing exactly on the target value with a brief bright "settle" pop.
function rollNixieTo(digitsString) {
  currentConvergence = digitsString;
  const targets = digitsString.replace('.', '').split('');
  document.querySelectorAll('#divergence-meter .nixie-digit').forEach((el, idx) => {
    const target = targets[idx];
    if (target === undefined) return;
    const from = Number(el.innerText) || 0;
    const to = Number(target);
    if (from === to) return;
    if (el._rollRaf) cancelAnimationFrame(el._rollRaf);
    el.classList.remove('digit-settle');
    let current = from;
    el._rollRaf = requestAnimationFrame(function step() {
      current = (current + 1) % 10;
      el.innerText = String(current);
      if (current === to) {
        el.classList.add('digit-settle');
        setTimeout(() => el.classList.remove('digit-settle'), 450);
        return;
      }
      el._rollRaf = requestAnimationFrame(step);
    });
  });
}

// Boot-up sequence: scramble the digits once, then roll them home.
function startNixieIntro() {
  let scramble = "";
  for (let i = 0; i < 7; i++) scramble += Math.floor(Math.random() * 10);
  scramble = scramble[0] + "." + scramble.substring(1);
  setNixieDigits(scramble);
  setTimeout(() => rollNixieTo(defaultConvergence), 120);
}

// The shift reading is derived from real inputs — live bass energy plus the
// current clock — so the value is deterministic at any moment and actually
// "measures" the world line instead of showing arbitrary digits.
function computeShiftedConvergence() {
  const now = new Date();
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  // Audio pull: silence contributes nothing (reading ≈ attractor), bass pushes
  // the divergence upward. The clock wobble below keeps the trace breathing in
  // both directions around the baseline even with no sound playing.
  const audioPull = worldLineEnergy * 0.004;
  // Slow, stable drift from the clock (different every second, no randoms)
  const wobble = Math.sin(t / 1.6180339887) * 0.0015 + Math.sin(t / 2.7182818284) * 0.0008;
  const delta = audioPull + wobble;
  const shifted = Math.min(1, Math.max(0.9, parseFloat(defaultConvergence) + delta));
  return shifted.toFixed(6);
}

// One world-line shift cycle: brief scramble, roll to a real shift reading,
// hold it, then converge back to the attractor. Cooldown prevents heavy bass
// from restarting the cycle every frame.
function triggerNixieFlicker() {
  const now = performance.now();
  if (now - lastNixieShift < 1500) return;
  lastNixieShift = now;

  if (nixieTimer) { clearTimeout(nixieTimer); nixieTimer = null; }

  // Phase 1 — instability: rapid scramble
  let scramble = "";
  for (let i = 0; i < 7; i++) scramble += Math.floor(Math.random() * 10);
  setNixieDigits(scramble[0] + "." + scramble.substring(1));

  // Phase 2 — roll to a shift reading driven by audio + clock
  nixieTimer = setTimeout(() => {
    rollNixieTo(computeShiftedConvergence());
    // Phase 3 — converge back to the attractor
    nixieTimer = setTimeout(() => {
      rollNixieTo(defaultConvergence);
      nixieTimer = null;
    }, 1100);
  }, 180);
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
  if (seconds < 0) return "0s"; // guard against clock skew / future timestamps
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

  // Feed the Live2D emotion engine so she reacts to the soundtrack in real time
  if (live2DController && live2DController.setAudioEnergy) {
    live2DController.setAudioEnergy(bassVal);
  }

  if (bassVal > 0.65) {
    triggerNixieFlicker();
  }

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

// 2. Wallpaper playback pause/resume (--pause-event)
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

// 3. Now playing track (--system-nowplaying)
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

// --- BROWSER SIMULATION ENGINE (STANDALONE / FALLBACK MODE) ---
function startBrowserSimulation() {
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
