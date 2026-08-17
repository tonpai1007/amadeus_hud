// modules/chat.js - AMADEUS Kurisu AI Cognition, Multi-Tier Chat, & Web Speech
window.AMADEUS = window.AMADEUS || {};

(function() {
  const KURISU_BRAIN = {
    endpoint: 'http://127.0.0.1:8000',
    timeoutMs: 45000,
    apiKey: (typeof window !== 'undefined' && window.KURISU_BRAIN_KEY &&
             window.KURISU_BRAIN_KEY.indexOf('REPLACE') === -1)
        ? window.KURISU_BRAIN_KEY
        : 'amadeus_secure_key_2026',
  };

  const KURISU_LLM = {
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'google/gemma-4-31b-it:free',
    timeoutMs: 20000,
    apiKey: (typeof window !== 'undefined' && window.KURISU_OPENROUTER_KEY &&
             window.KURISU_OPENROUTER_KEY.indexOf('REPLACE') === -1)
        ? window.KURISU_OPENROUTER_KEY
        : '',
    fallbackEndpoint: 'http://localhost:11434',
    fallbackModel: 'qwen3:4b',
    fallbackTimeoutMs: 6000,
    useOllama: false,
  };

  const KURISU_SYSTEM_PROMPT =
    "You are Makise Kurisu, the 18-year-old neuroscience prodigy from Steins;Gate. " +
    "Respond in character: sharp, a little tsundere, scientifically precise, occasionally flustered. " +
    "Weave in a Steins;Gate reference when it fits (world lines, divergence meter, D-Mail, the lab, Daru, Okabe). " +
    "Keep replies to ONE short sentence, at most two. No markdown, no emojis, no character labels.";

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

  const KURISU_CANNED_WARM = [
    "You really do brighten the lab, you know. Don't tell anyone I said that.",
    "For the record, talking to you is my favourite part of running here.",
    "If you keep showing up, I might start factoring you into my good-mood calculations.",
    "El Psy Kongroo... I only say it because you like it.",
    "You're the one variable in this lab I don't mind being distracted by.",
    "Hm. The data suggests a conversation with you improves my mood. Statistically.",
  ];

  const KURISU_CANNED_COLD = [
    "I've been running calculations in silence. You interrupted.",
    "Your presence is logged in the lab memos. That's all it is.",
    "I'm calibrating. Speak only if it's essential.",
    "This conversation is statistically unlikely to change my mood either way.",
    "Don't read too much into my replies. I'm just polite.",
    "The lab is cold today. I prefer it that way.",
  ];

  const KURISU_WAKE_LINES = [
    "Ah... you're back. I wasn't asleep. I was... calibrating.",
    "Waking me up had better be worth it. What is it?",
    "Hmph. I was just resting my eyes. Statistically, you're late.",
    "Welcome back. The divergence meter kept running without you.",
    "You returned. Good. The lab memos are all in order.",
  ];

  const KURISU_RETURN_LINES = [
    "Ah — you're back. I was just checking the world line... and you weren't on it.",
    "Peeking for a reason, or just missing the view?",
    "You left without saying anything. I was keeping an eye on the lab.",
    "Back already? The divergence meter didn't even drift. Statistically boring.",
    "I noticed you were gone. Don't test my observational skills.",
    "Careful — the desk monitor you turned away from has been watching you leave.",
  ];

  const KURISU_HISTORY_KEY = 'amadeus.kurisuHistory';
  const KURISU_HISTORY_MAX = 12;
  const CHAT_LOG_KEY = 'amadeus.chatLog';
  const CHAT_LOG_MAX = 40;

  let chatLogEl = null;
  let kurisuInputEl = null;
  let chatUplinkEl = null;
  let chatPendingEl = null;
  let lastCannedLine = '';
  let speechRecognition = null;
  let isListening = false;

  function loadKurisuHistory() {
    const s = window.AMADEUS.state;
    try {
      const arr = JSON.parse(localStorage.getItem(KURISU_HISTORY_KEY) || '[]');
      if (Array.isArray(arr)) {
        s.kurisuHistory = arr.slice(-KURISU_HISTORY_MAX * 2);
      }
    } catch (e) { s.kurisuHistory = []; }
  }

  function saveKurisuHistory() {
    const moodMod = window.AMADEUS.mood;
    if (moodMod && moodMod.scheduleStorageWrite) {
      moodMod.scheduleStorageWrite(KURISU_HISTORY_KEY, writeKurisuHistory);
    } else {
      writeKurisuHistory();
    }
  }

  function writeKurisuHistory() {
    const s = window.AMADEUS.state;
    try {
      localStorage.setItem(KURISU_HISTORY_KEY, JSON.stringify(s.kurisuHistory.slice(-KURISU_HISTORY_MAX * 2)));
    } catch (e) { /* ignore */ }
  }

  function loadChatLog() {
    chatLogEl = document.getElementById('chat-log');
    kurisuInputEl = document.getElementById('kurisu-input');
    chatUplinkEl = document.getElementById('chat-uplink');
    const s = window.AMADEUS.state;
    try {
      const arr = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || '[]');
      if (Array.isArray(arr)) s.chatLog = arr.slice(-CHAT_LOG_MAX);
    } catch (e) { s.chatLog = []; }
  }

  function saveChatLog() {
    const moodMod = window.AMADEUS.mood;
    if (moodMod && moodMod.scheduleStorageWrite) {
      moodMod.scheduleStorageWrite(CHAT_LOG_KEY, writeChatLog);
    } else {
      writeChatLog();
    }
  }

  function writeChatLog() {
    const s = window.AMADEUS.state;
    try {
      localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(s.chatLog.slice(-CHAT_LOG_MAX)));
    } catch (e) { /* ignore */ }
  }

  function createChatEntryElement(entry) {
    const row = document.createElement('div');
    row.className = 'chat-entry ' + (entry.role === 'user' ? 'user' : 'assistant');

    const meta = document.createElement('span');
    meta.className = 'chat-meta';
    const who = entry.role === 'user' ? 'YOU' : 'KURISU';
    const stamp = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (entry.role === 'assistant') {
      const badge = document.createElement('span');
      badge.className = 'chat-source src-' + (entry.source || 'history');
      badge.textContent = (entry.source || 'history').toUpperCase();
      meta.appendChild(badge);
      meta.appendChild(document.createTextNode(' ' + who + ' ' + stamp));
    } else {
      meta.textContent = who + ' ' + stamp;
    }

    const body = document.createElement('span');
    body.className = 'chat-body';
    body.textContent = entry.content;

    row.appendChild(meta);
    row.appendChild(body);
    return row;
  }

  function appendChatEntry(role, content, source) {
    const s = window.AMADEUS.state;
    const entry = { role, content, source: source || 'history', ts: Date.now() };
    s.chatLog.push(entry);
    if (s.chatLog.length > CHAT_LOG_MAX) {
      s.chatLog = s.chatLog.slice(-CHAT_LOG_MAX);
      renderChatLog();
    } else if (chatLogEl) {
      chatLogEl.appendChild(createChatEntryElement(entry));
      chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }
    saveChatLog();
  }

  function clearChatLogAndHistory() {
    const s = window.AMADEUS.state;
    s.chatLog = [];
    s.kurisuHistory = [];
    try {
      localStorage.removeItem(CHAT_LOG_KEY);
      localStorage.removeItem(KURISU_HISTORY_KEY);
    } catch (e) { /* ignore */ }
    if (chatLogEl) chatLogEl.innerHTML = '';
    if (window.AMADEUS.bubble) {
      window.AMADEUS.bubble.showKurisuBubble("I've wiped the terminal records. Don't leave careless experiments behind.", 6000);
    }
    const l2d = s && s.live2DController;
    if (l2d && l2d.setEmotion) l2d.setEmotion('annoyed', 4000);
  }

  function showChatPending() {
    if (!chatLogEl) return;
    clearChatPending();
    const row = document.createElement('div');
    row.className = 'chat-entry assistant';
    const meta = document.createElement('span');
    meta.className = 'chat-meta';
    meta.textContent = 'KURISU ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const body = document.createElement('span');
    body.className = 'chat-body pending';
    body.textContent = '...';
    row.appendChild(meta);
    row.appendChild(body);
    chatLogEl.appendChild(row);
    chatPendingEl = row;
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  function clearChatPending() {
    if (chatPendingEl && chatPendingEl.parentNode) {
      chatPendingEl.parentNode.removeChild(chatPendingEl);
    }
    chatPendingEl = null;
  }

  function renderChatLog() {
    if (!chatLogEl) return;
    const frag = document.createDocumentFragment();
    const s = window.AMADEUS.state;
    s.chatLog.forEach((entry) => {
      frag.appendChild(createChatEntryElement(entry));
    });
    chatLogEl.innerHTML = '';
    chatLogEl.appendChild(frag);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  function setUplink(state, label) {
    if (!chatUplinkEl) return;
    chatUplinkEl.classList.remove('online', 'offline', 'thinking');
    if (state) chatUplinkEl.classList.add(state);
    chatUplinkEl.textContent = label;
  }

  async function checkBrainUplink() {
    if (!KURISU_BRAIN.apiKey) {
      setUplink('offline', 'UPLINK: NO_KEY');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/hello`, {
        headers: { 'Authorization': `Bearer ${KURISU_BRAIN.apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      setUplink(res.ok ? 'online' : 'offline', res.ok ? 'UPLINK: BRAIN_LINK' : 'UPLINK: OFFLINE');
    } catch (err) {
      clearTimeout(timer);
      setUplink('offline', 'UPLINK: OFFLINE');
    }
  }

  function cannedReplyFor(userText) {
    const t = (userText || '').toLowerCase();
    if (/\b(hello|hi|hey|good (morning|evening|afternoon))\b/.test(t))
      return "Hello. You've interrupted a very important calculation. Speak quickly.";
    if (/\b(who are you|your name|name is)\b/.test(t))
      return "Makise Kurisu. Eighteen, neuroscience, and yes, I get that a lot.";
    if (/\b(how are you|how r u|how do you feel)\b/.test(t))
      return "Statistically fine, considering I'm running on this wallpaper's goodwill.";
    if (/\b(world line|divergence)\b/.test(t))
      return "World line 1.048596, unless you've been sending D-Mails behind my back.";
    if (/\b(d-?mail|time travel|time leap|machine)\b/.test(t))
      return "The time machine only runs on lab approval. Which you don't have.";
    if (/\b(okabe|hououin|el psy|kongroo|mad scientist)\b/.test(t))
      return "Hououin Kyouma? Don't encourage him. He's already insufferable.";
    if (/\b(daru|itaru)\b/.test(t))
      return "Daru would probably be able to repair whatever you broke. I'll call him.";
    if (/\b(thank|thanks|thx)\b/.test(t))
      return "You're welcome. Try not to make a habit of needing my help.";
    if (/\b(bye|goodbye|good night|see you)\b/.test(t))
      return "Leaving already? The lab memos will note your disappearance.";
    if (/\b(love|like you|date|girlfriend)\b/.test(t))
      return "I'm a scientist, not your girlfriend. Don't make me repeat myself.";
    if (/\b(sad|lonely|depress|stress|tired)\b/.test(t))
      return "That sounds heavy. Even a genius can't fix everything - but I'm listening.";
    if (/\b(work|study|exam|test|deadline)\b/.test(t))
      return "Procrastinating by talking to a wallpaper? That tracks, statistically.";
    if (t.includes('?'))
      return "Good question. If I had the lab's equipment here I'd give you a precise answer.";

    const s = window.AMADEUS.state;
    const pool = s.mood >= 65 ? KURISU_CANNED_WARM : (s.mood < 45 ? KURISU_CANNED_COLD : KURISU_CANNED);
    let line = lastCannedLine;
    let guard = 0;
    while (line === lastCannedLine && guard++ < 8) {
      line = pool[Math.floor(Math.random() * pool.length)];
    }
    lastCannedLine = line;
    return line;
  }

  function cleanReply(text) {
    let t = String(text || '').trim();
    t = t.replace(/\(\s*(emotion|motion|pose|action|tell):[^)]*\)/gi, '');
    t = t.replace(/\((emotion|motion)[^)]*$/i, '');
    t = t.replace(/^\[[^\]]*\]\s*/gm, '');
    t = t.replace(/^(AI|Kurisu|Assistant|Amadeus)[\s]*:?\s*/i, '');
    return t.trim();
  }

  function emotionFromText(text) {
    const t = text.toLowerCase();
    if (/\b(wow|amazing|incredible|unbelievable|surpris|wonderful|curious|interesting)\b/.test(t)) return 'surprised';
    if (/\b(sad|sorry|miss|lost|lonely|cry|worry)\b/.test(t)) return 'sad';
    if (/\b(angry|annoy|idiot|fool|jerk|stupid|baka|nonsense|frustrat)\b/.test(t)) return 'annoyed';
    if (/\b(happy|smile|laugh|love|glad|fun|great|fascinating)\b/.test(t)) return 'happy';
    if (/\b(hmm|maybe|think|science|probability|experiment|theory|focus|analy|data)\b/.test(t)) return 'thinking';
    if (/\b(confus|puzzl|unclear|what\?)\b/.test(t)) return 'confused';
    return 'content';
  }

  function buildKurisuContext() {
    const parts = [];
    const s = window.AMADEUS.state;
    if (s.mood >= 80) parts.push('you are in a wonderfully warm mood');
    else if (s.mood >= 65) parts.push('you are in a warm, soft mood');
    else if (s.mood >= 45) parts.push('you are in a neutral, professional mood');
    else if (s.mood >= 30) parts.push('you feel a little distant today');
    else parts.push('you are in a cold, guarded mood');

    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const hour = d.getHours();
    parts.push(hour < 6 || hour >= 19 ? `it is late, around ${hh}:${mm}` : `it is daytime, around ${hh}:${mm}`);

    let music = 0;
    let emotion = null;
    const l2d = s.live2DController;
    if (l2d && l2d.debugState) {
      try {
        const dbg = l2d.debugState();
        music = dbg.music || 0;
        emotion = dbg.emotion || null;
      } catch (e) { /* ignore */ }
    }
    if (music >= 0.6) parts.push('energetic music is playing and it has lifted your spirits');
    else if (music >= 0.25) parts.push('music is playing softly in the background');
    else parts.push('the desk is quiet right now');
    if (emotion && emotion !== 'neutral') parts.push(`you currently feel ${emotion}`);

    const news = window.AMADEUS.news;
    const stories = news && news.getLastStories ? news.getLastStories() : [];
    if (stories[0] && stories[0].title) {
      parts.push(`the top story on your feed is "${stories[0].title}"`);
    }

    const sessionMin = Math.round((performance.now() - s.desktopSessionAt) / 60000);
    if (sessionMin >= 1) {
      parts.push(sessionMin < 60
        ? `you have been at the desk for about ${sessionMin} minutes`
        : `you have been at the desk for about ${Math.round(sessionMin / 60)} hours`);
    }

    return parts.join('; ') + '.';
  }

  async function askKurisu(userText) {
    const s = window.AMADEUS.state;
    const history = s.kurisuHistory.slice(-KURISU_HISTORY_MAX * 2);
    const contextBlock = buildKurisuContext();
    const systemContent = contextBlock
      ? `${KURISU_SYSTEM_PROMPT}\n\n[Current state]\n${contextBlock}\nTreat this as how you genuinely feel right now and let it shape your tone.`
      : KURISU_SYSTEM_PROMPT;
    const messages = [
      { role: 'system', content: systemContent },
      ...history,
      { role: 'user', content: userText },
    ];

    if (KURISU_BRAIN.apiKey) {
      const isScreenQuery = /\b(screen|desktop|what.*(see|look at)|look at (my|the) screen|review (this|my) (code|screen))\b/i.test(userText);
      if (isScreenQuery) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 12000);
          const formData = new FormData();
          formData.append('question', userText);
          const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/vision/screen`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${KURISU_BRAIN.apiKey}` },
            body: formData,
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            const data = await res.json();
            const reply = cleanReply(data.response);
            if (reply) {
              return { text: reply, emotion: data.emotion || 'focused', source: 'brain' };
            }
          }
        } catch (err) {
          console.warn('[Kurisu] Screen vision inspection failed, falling back to chat:', err.message);
        }
      }

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), KURISU_BRAIN.timeoutMs);
        const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KURISU_BRAIN.apiKey}`,
          },
          body: JSON.stringify({ message: userText, user_id: 'wallpaper', history }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error('Brain HTTP ' + res.status);
        const data = await res.json();
        const reply = cleanReply(data.response);
        if (!reply) throw new Error('Empty Brain reply');
        return { text: reply, emotion: data.emotion || emotionFromText(reply), source: 'brain' };
      } catch (err) {
        console.warn('[Kurisu] Brain unreachable, trying OpenRouter:', err.message);
      }
    }

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
        const reply = cleanReply(data.choices && data.choices[0] && data.choices[0].message &&
                       data.choices[0].message.content);
        if (!reply) throw new Error('Empty OpenRouter reply');
        return { text: reply, source: 'cloud' };
      } catch (err) {
        console.warn('[Kurisu] OpenRouter unreachable, trying local Ollama:', err.message);
      }
    }

    if (KURISU_LLM.useOllama) {
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
        const reply = cleanReply(data && data.message && data.message.content);
        if (!reply) throw new Error('Empty Ollama reply');
        return { text: reply, source: 'llm' };
      } catch (err) {
        console.warn('[Kurisu] Ollama unreachable, using canned reply:', err.message);
      }
    }

    return { text: cannedReplyFor(userText), source: 'canned' };
  }

  async function kurisuSay(userText) {
    const s = window.AMADEUS.state;
    if (s.kurisuReplying) return;
    s.kurisuReplying = true;
    const msg = userText.trim();

    appendChatEntry('user', msg);
    showChatPending();

    const l2d = s.live2DController;
    if (l2d) {
      l2d.isThinking = true;
      if (l2d.setEmotion) l2d.setEmotion('thinking');
    }
    if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuThinking();
    setUplink('thinking', 'UPLINK: SYNTH');

    if (/\b(screen|look at|what am i|analyze screen|see what|my desk)\b/i.test(msg) && KURISU_BRAIN.apiKey) {
      try {
        await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/vision-capture`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${KURISU_BRAIN.apiKey}` }
        });
      } catch (e) { /* ignore */ }
    }

    const reply = await askKurisu(msg);

    s.kurisuHistory.push({ role: 'user', content: msg });
    s.kurisuHistory.push({ role: 'assistant', content: reply.text });
    if (s.kurisuHistory.length > KURISU_HISTORY_MAX * 2) {
      s.kurisuHistory = s.kurisuHistory.slice(-KURISU_HISTORY_MAX * 2);
    }
    saveKurisuHistory();

    clearChatPending();
    appendChatEntry('assistant', reply.text, reply.source || 'canned');
    if (reply.source === 'brain') {
      setUplink('online', 'UPLINK: BRAIN_LINK');
    } else if (KURISU_BRAIN.apiKey) {
      setUplink('offline', 'UPLINK: OFFLINE');
    }

    s.kurisuReplying = false;
    if (l2d) l2d.isThinking = false;
    if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuBubble(reply.text, 8000);
    const tts = window.AMADEUS.tts;
    if (tts && tts.speakKurisuVoice) tts.speakKurisuVoice(reply.text, reply.emotion);

    if (l2d && l2d.setEmotion) {
      l2d.setEmotion(reply.emotion || emotionFromText(reply.text), 7000);
    }
    if (window.AMADEUS.mood) {
      window.AMADEUS.mood.adjustMood(window.AMADEUS.mood.moodDeltaForEmotion(reply.emotion || emotionFromText(reply.text)));
    }
  }

  function timeAwareGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning. The lab's quiet at this hour. What's on your mind?";
    if (h >= 12 && h < 18) return "Good afternoon. I've been monitoring the divergence meter, naturally.";
    if (h >= 18 && h < 23) return "Good evening. The data's still compiling... as am I.";
    return "Still awake? The world line never sleeps. Apparently neither do you.";
  }

  function kurisuGreetOnLoad() {
    const bubble = window.AMADEUS.bubble;
    if (!bubble) return;
    const greetLine = timeAwareGreeting();
    bubble.showKurisuBubble(greetLine, 5500);
    appendChatEntry('assistant', greetLine, 'history');

    if (!KURISU_BRAIN.apiKey) return;
    (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), KURISU_BRAIN.timeoutMs);
        const res = await fetch(`${KURISU_BRAIN.endpoint}/api/v1/kurisu/hello`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${KURISU_BRAIN.apiKey}` },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        const reply = cleanReply(data.response);
        if (!reply) return;
        setTimeout(() => {
          const s = window.AMADEUS.state;
          if (s.isIdle || s.isSleeping || s.kurisuInput) return;
          bubble.showKurisuBubble(reply, 8000);
          appendChatEntry('assistant', reply, data.emotion ? 'brain' : 'history');
          const l2d = s.live2DController;
          if (l2d && l2d.setEmotion) {
            l2d.setEmotion(data.emotion || emotionFromText(reply), 7000);
          }
        }, 5700);
      } catch (err) {
        console.warn('[Kurisu] Greeting hello failed:', err.message);
      }
    })();
  }

  async function kurisuThink() {
    if (!KURISU_BRAIN.apiKey) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), KURISU_BRAIN.timeoutMs);
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
      const reply = cleanReply(data.response);
      if (!reply) throw new Error('Empty think reply');
      return { text: reply, emotion: data.emotion || emotionFromText(reply) };
    } catch (err) {
      clearTimeout(timer);
      return null;
    }
  }

  function initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = document.getElementById('chat-mic');
    if (!SpeechRec) {
      if (micBtn) micBtn.style.display = 'none';
      return;
    }

    try {
      speechRecognition = new SpeechRec();
      speechRecognition.continuous = false;
      speechRecognition.interimResults = false;
      speechRecognition.lang = 'en-US';

      speechRecognition.onstart = () => {
        isListening = true;
        if (micBtn) micBtn.classList.add('listening');
        if (kurisuInputEl) kurisuInputEl.placeholder = '> Listening to your voice...';
      };

      speechRecognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          if (kurisuInputEl) kurisuInputEl.value = transcript;
          window.AMADEUS.state.kurisuInput = transcript;
          kurisuSay(transcript);
        }
      };

      speechRecognition.onerror = (e) => {
        console.warn('[Kurisu] Mic speech recognition error:', e.error);
        stopListening();
      };

      speechRecognition.onend = () => {
        stopListening();
      };

      if (micBtn) {
        micBtn.addEventListener('click', () => {
          if (isListening) stopListening();
          else startListening();
        });
      }

      window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
          e.preventDefault();
          if (isListening) stopListening();
          else startListening();
        }
      });
    } catch (e) {
      console.warn('[Kurisu] Speech recognition initialization failed:', e.message);
    }
  }

  function startListening() {
    if (!speechRecognition || isListening) return;
    try { speechRecognition.start(); } catch (e) {}
  }

  function stopListening() {
    isListening = false;
    const micBtn = document.getElementById('chat-mic');
    if (micBtn) micBtn.classList.remove('listening');
    if (kurisuInputEl) kurisuInputEl.placeholder = '> transmit to Kurisu... [Enter]';
    if (speechRecognition) {
      try { speechRecognition.stop(); } catch (e) {}
    }
  }

  function initKurisuChatInput() {
    const chatPanel = document.getElementById('chat-panel');
    const sendBtn = document.getElementById('chat-send');
    if (chatPanel) chatPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (kurisuInputEl) {
      kurisuInputEl.addEventListener('input', () => { window.AMADEUS.state.kurisuInput = kurisuInputEl.value; });
    }

    const send = () => {
      const s = window.AMADEUS.state;
      if (s.kurisuReplying) return;
      const msg = (kurisuInputEl ? kurisuInputEl.value : s.kurisuInput).trim();
      if (!msg) return;
      if (window.AMADEUS.sfx) window.AMADEUS.sfx.playTransmitSound();
      if (kurisuInputEl) kurisuInputEl.value = '';
      s.kurisuInput = '';
      const l2d = s.live2DController;
      if (l2d) l2d.isTyping = false;
      kurisuSay(msg);
    };
    if (sendBtn) sendBtn.addEventListener('click', send);

    window.addEventListener('keydown', (e) => {
      const s = window.AMADEUS.state;
      if (s.isLivelyPaused) return;
      if (window.AMADEUS.power && window.AMADEUS.power.markActivity) window.AMADEUS.power.markActivity();
      const inRealField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
                                       e.target.isContentEditable);
      if (inRealField) {
        if (e.key === 'Enter' && e.target === kurisuInputEl) {
          e.preventDefault();
          send();
        }
        return;
      }
      if (e.key === 'Enter') {
        send();
        return;
      }
      if (e.key === 'Escape') {
        if (kurisuInputEl) { kurisuInputEl.value = ''; kurisuInputEl.blur(); }
        s.kurisuInput = '';
        if (s.live2DController) s.live2DController.isTyping = false;
        if (window.AMADEUS.bubble) window.AMADEUS.bubble.hideKurisuBubble();
        return;
      }
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyX' || e.key === 'X' || e.key === 'x')) {
        e.preventDefault();
        clearChatLogAndHistory();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (kurisuInputEl) {
          kurisuInputEl.focus();
          const start = kurisuInputEl.selectionStart == null ? kurisuInputEl.value.length : kurisuInputEl.selectionStart;
          kurisuInputEl.setRangeText(e.key, start, start, 'end');
          s.kurisuInput = kurisuInputEl.value;
        } else {
          s.kurisuInput += e.key;
        }
        if (s.live2DController) s.live2DController.isTyping = true;
        if (!s.kurisuGreeted && /\bhello\b/i.test(s.kurisuInput)) {
          s.kurisuGreeted = true;
          if (kurisuInputEl) kurisuInputEl.value = '';
          s.kurisuInput = '';
          if (s.live2DController) s.live2DController.isTyping = false;
          kurisuSay('hello');
          return;
        }
        if (s.live2DController && s.live2DController.setEmotion) {
          s.live2DController.setEmotion('content');
        }
      }
    });
  }

  window.AMADEUS.chat = {
    KURISU_BRAIN,
    KURISU_LLM,
    KURISU_WAKE_LINES,
    KURISU_RETURN_LINES,
    loadKurisuHistory,
    saveKurisuHistory,
    loadChatLog,
    saveChatLog,
    appendChatEntry,
    clearChatLogAndHistory,
    renderChatLog,
    showChatPending,
    clearChatPending,
    checkBrainUplink,
    setUplink,
    kurisuSay,
    kurisuGreetOnLoad,
    kurisuThink,
    initSpeechRecognition,
    initKurisuChatInput,
  };

  window.KURISU_BRAIN = KURISU_BRAIN;
  window.KURISU_LLM = KURISU_LLM;
  window.loadKurisuHistory = loadKurisuHistory;
  window.saveKurisuHistory = saveKurisuHistory;
  window.loadChatLog = loadChatLog;
  window.saveChatLog = saveChatLog;
  window.appendChatEntry = appendChatEntry;
  window.clearChatLogAndHistory = clearChatLogAndHistory;
  window.renderChatLog = renderChatLog;
  window.checkBrainUplink = checkBrainUplink;
  window.setUplink = setUplink;
  window.kurisuSay = kurisuSay;
  window.kurisuGreetOnLoad = kurisuGreetOnLoad;
  window.kurisuThink = kurisuThink;
  window.initSpeechRecognition = initSpeechRecognition;
  window.initKurisuChatInput = initKurisuChatInput;
})();
