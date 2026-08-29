// modules/chat-ui.js - AMADEUS Kurisu Chat UI, Input Handling & Greeting Logic
window.AMADEUS = window.AMADEUS || {};

(function() {
  let chatLogEl = null;
  let kurisuInputEl = null;
  let chatUplinkEl = null;
  let chatPendingEl = null;
  let isComposing = false;

  function getUiElements() {
    if (!chatLogEl || !chatLogEl.isConnected) chatLogEl = document.getElementById('chat-log');
    if (!kurisuInputEl || !kurisuInputEl.isConnected) kurisuInputEl = document.getElementById('kurisu-input');
    if (!chatUplinkEl || !chatUplinkEl.isConnected) chatUplinkEl = document.getElementById('chat-uplink');
  }

  function showChatPending() {
    getUiElements();
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
    chatPendingEl?.remove();
    chatPendingEl = null;
  }

  function setUplink(state, label) {
    getUiElements();
    if (!chatUplinkEl) return;
    chatUplinkEl.classList.remove('online', 'offline', 'thinking');
    if (state) chatUplinkEl.classList.add(state);
    chatUplinkEl.textContent = label;
  }

  async function checkBrainUplink() {
    if (!window.AMADEUS.chat.KURISU_BRAIN.apiKey) {
      setUplink('offline', 'UPLINK: NO_KEY');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${window.AMADEUS.chat.KURISU_BRAIN.endpoint}/api/v1/kurisu/hello`, {
        headers: { 'Authorization': `Bearer ${window.AMADEUS.chat.KURISU_BRAIN.apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      setUplink(res.ok ? 'online' : 'offline', res.ok ? 'UPLINK: BRAIN_LINK' : 'UPLINK: OFFLINE');
    } catch (err) {
      clearTimeout(timer);
      setUplink('offline', 'UPLINK: OFFLINE');
    }
  }

  async function kurisuSay(userText) {
    const s = window.AMADEUS.state;
    if (s.kurisuReplying) return;
    s.kurisuReplying = true;
    const msg = userText.trim();

    window.AMADEUS.chat.appendChatEntry('user', msg);
    window.AMADEUS.chat.showChatPending();

    const l2d = s.live2DController;
    if (l2d) {
      l2d.isThinking = true;
      if (l2d.setEmotion) l2d.setEmotion('thinking');
    }
    if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuThinking();
    setUplink('thinking', 'UPLINK: SYNTH');

    if (msg.startsWith('/')) {
      const cmd = msg.toLowerCase().trim();
      let cmdReply = null;
      if (cmd === '/brain' || cmd === '/memory') {
        cmdReply = {
          text: "Second Brain Active: Chat Memory online, 15 Skills indexed, LLM-Wiki active in Obsidian, and 12,790 Code-Graph nodes mapped.",
          emotion: 'focused',
          source: 'brain',
        };
      } else if (cmd === '/screen' || cmd === '/shot' || cmd === '/inspect') {
        window.AMADEUS.chat.triggerScreenCoPilot();
        return;
      } else if (cmd === '/help') {
        cmdReply = {
          text: "Commands: /brain (Memory Status), /screen (Vision Inspect), /weather (Weather Brief), Ctrl+Shift+S (Screen Co-Pilot), Ctrl+/ (Keybinds).",
          emotion: 'content',
          source: 'canned',
        };
      } else if (cmd === '/weather') {
        const w = s.weather;
        cmdReply = {
          text: w ? `Currently ${w.condition} at ${w.temp_C}°C (${w.humidity}% humidity) in ${w.city}.` : "Atmospheric telemetry unavailable right now.",
          emotion: 'neutral',
          source: 'canned',
        };
      }
      if (cmdReply) {
        window.AMADEUS.chat.clearChatPending();
        window.AMADEUS.chat.appendChatEntry('assistant', cmdReply.text, cmdReply.source);
        s.kurisuReplying = false;
        if (l2d) { l2d.isThinking = false; if (l2d.setEmotion) l2d.setEmotion(cmdReply.emotion, 7000); }
        if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuBubble(cmdReply.text, 8000);
        const tts = window.AMADEUS.tts;
        if (tts && tts.speakKurisuVoice) tts.speakKurisuVoice(cmdReply.text, cmdReply.emotion);
        return;
      }
    }

    if (/\b(screen|look at|what am i|analyze screen|see what|my desk)\b/i.test(msg) && window.AMADEUS.chat.KURISU_BRAIN.apiKey) {
      try {
        await fetch(`${window.AMADEUS.chat.KURISU_BRAIN.endpoint}/api/v1/kurisu/vision-capture`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${window.AMADEUS.chat.KURISU_BRAIN.apiKey}` }
        });
      } catch (e) { /* ignore */ }
    }

    // Harden the reply pipeline: any throw inside askKurisu() (or the
    // post-processing below) must never leave kurisuReplying=true, or the
    // chat wedges forever with a pending "..." row.
    let reply = null;
    try {
      reply = await window.AMADEUS.chat.askKurisu(msg);
    } catch (err) {
      console.warn('[Kurisu] reply pipeline failed:', err);
      reply = {
        text: 'The uplink dropped mid-thought. Say that again?',
        emotion: 'neutral',
        source: 'canned',
      };
    } finally {
      s.kurisuReplying = false;
    }

    s.kurisuHistory.push(
      { role: 'user', content: msg },
      { role: 'assistant', content: reply.text }
    );
    if (s.kurisuHistory.length > 24) {
      s.kurisuHistory = s.kurisuHistory.slice(-24);
    }
    window.AMADEUS.chat.saveKurisuHistory();

    window.AMADEUS.chat.clearChatPending();
    window.AMADEUS.chat.appendChatEntry('assistant', reply.text, reply.source || 'canned');
    if (reply.source === 'brain') {
      setUplink('online', 'UPLINK: BRAIN_LINK');
    } else if (window.AMADEUS.chat.KURISU_BRAIN.apiKey) {
      setUplink('offline', 'UPLINK: OFFLINE');
    }

    if (l2d) l2d.isThinking = false;
    window.AMADEUS.bubble?.showKurisuBubble?.(reply.text, 8000);
    window.AMADEUS.tts?.speakKurisuVoice?.(reply.text, reply.emotion);

    l2d?.setEmotion?.(reply.emotion || window.AMADEUS.chat.emotionFromText(reply.text), 7000);
    if (window.AMADEUS.mood) {
      window.AMADEUS.mood.adjustMood(window.AMADEUS.mood.moodDeltaForEmotion(reply.emotion || window.AMADEUS.chat.emotionFromText(reply.text)));
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
    window.AMADEUS.chat.appendChatEntry('assistant', greetLine, 'history');

    if (!window.AMADEUS.chat.KURISU_BRAIN.apiKey) return;
    (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), window.AMADEUS.chat.KURISU_BRAIN.timeoutMs);
        const res = await fetch(`${window.AMADEUS.chat.KURISU_BRAIN.endpoint}/api/v1/kurisu/hello`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${window.AMADEUS.chat.KURISU_BRAIN.apiKey}` },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        const reply = window.AMADEUS.chat.cleanReply(data.response);
        if (!reply) return;
        setTimeout(() => {
          const s = window.AMADEUS.state;
          if (s.isIdle || s.isSleeping || s.kurisuInput) return;
          bubble.showKurisuBubble(reply, 8000);
          window.AMADEUS.chat.appendChatEntry('assistant', reply, data.emotion ? 'brain' : 'history');
          const l2d = s.live2DController;
          if (l2d && l2d.setEmotion) {
            l2d.setEmotion(data.emotion || window.AMADEUS.chat.emotionFromText(reply), 7000);
          }
        }, 5700);
      } catch (err) {
        console.warn('[Kurisu] Greeting hello failed:', err.message);
      }
    })();
  }

  function initKurisuChatInput() {
    getUiElements();
    const chatPanel = document.getElementById('chat-panel');
    const sendBtn = document.getElementById('chat-send');
    if (chatPanel) chatPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (kurisuInputEl) {
      kurisuInputEl.addEventListener('input', () => { window.AMADEUS.state.kurisuInput = kurisuInputEl.value; });
      kurisuInputEl.addEventListener('compositionstart', () => { isComposing = true; });
      kurisuInputEl.addEventListener('compositionend', () => {
        isComposing = false;
        window.AMADEUS.state.kurisuInput = kurisuInputEl.value;
      });
    }

    const send = () => {
      const s = window.AMADEUS.state;
      if (s.kurisuReplying) return;
      const msg = (kurisuInputEl ? kurisuInputEl.value : s.kurisuInput).trim();
      if (!msg) return;
      // "hello" lab-greeting easter egg: fires on submit only, so it can no
      // longer wipe partially typed text mid-composition.
      if (!s.kurisuGreeted && /^hello\b/i.test(msg)) {
        s.kurisuGreeted = true;
        if (kurisuInputEl) kurisuInputEl.value = '';
        s.kurisuInput = '';
        const l2d = s.live2DController;
        if (l2d) l2d.isTyping = false;
        kurisuSay('hello');
        return;
      }
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
        window.AMADEUS.chat.clearChatLogAndHistory();
        return;
      }
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyS' || e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        window.AMADEUS.chat.triggerScreenCoPilot();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !isComposing) {
        if (kurisuInputEl) {
          kurisuInputEl.focus();
          const start = kurisuInputEl.selectionStart == null ? kurisuInputEl.value.length : kurisuInputEl.selectionStart;
          kurisuInputEl.setRangeText(e.key, start, start, 'end');
          s.kurisuInput = kurisuInputEl.value;
        } else {
          s.kurisuInput += e.key;
        }
        if (s.live2DController) s.live2DController.isTyping = true;
        if (s.live2DController && s.live2DController.setEmotion) {
          s.live2DController.setEmotion('content');
        }
      }
    });
  }

  /**
   * AMADEUS chat input UI & greeting logic.
   * @property {() => void} showChatPending - Appends a transient "..." pending row while awaiting a reply.
   * @property {() => void} clearChatPending - Removes the pending row.
   * @property {(state: 'online'|'offline'|'thinking', label: string) => void} setUplink - Updates the chat panel uplink badge.
   * @property {() => Promise<void>} checkBrainUplink - Probes the brain /hello endpoint and sets the badge accordingly.
   * @property {(userText: string) => Promise<void>} kurisuSay - Sends a message through the reply pipeline, handles /commands, streams the reply with TTS.
   * @property {() => string} timeAwareGreeting - Pure-ish: time-of-day appropriate greeting line.
   * @property {() => void} kurisuGreetOnLoad - Greets the user shortly after boot.
   * @property {() => void} initKurisuChatInput - Binds the input element, send button and global keyboard handlers (Enter/Escape/Ctrl+Shift+X/Ctrl+Shift+S).
   */
  Object.assign(window.AMADEUS.chat, {
    showChatPending,
    clearChatPending,
    setUplink,
    checkBrainUplink,
    kurisuSay,
    timeAwareGreeting,
    kurisuGreetOnLoad,
    initKurisuChatInput,
  });
})();
