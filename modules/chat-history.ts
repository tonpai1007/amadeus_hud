/// <reference path="../types/amadeus.d.ts" />
// modules/chat-history.js - AMADEUS Kurisu Chat History & Transcript Management
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  const KURISU_HISTORY_KEY = 'amadeus.kurisuHistory';
  const CHAT_LOG_KEY = 'amadeus.chatLog';
  // Shared limits defined in state.js (CHAT_LIMITS) so chat-api.js and this
  // module always trim with the same values.
  const KURISU_HISTORY_MAX = (window.AMADEUS.CHAT_LIMITS && window.AMADEUS.CHAT_LIMITS.KURISU_HISTORY_MAX) || 12;
  const CHAT_LOG_MAX = (window.AMADEUS.CHAT_LIMITS && window.AMADEUS.CHAT_LIMITS.CHAT_LOG_MAX) || 60;
  let chatLogEl = null;

  function getChatLogEl() {
    if (!chatLogEl || !chatLogEl.isConnected) {
      chatLogEl = document.getElementById('chat-log');
    }
    return chatLogEl;
  }

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
    getChatLogEl();
    const s = window.AMADEUS.state;
    try {
      const arr = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || '[]');
      if (Array.isArray(arr)) s.chatLog = arr.slice(-CHAT_LOG_MAX);
    } catch (e) { s.chatLog = []; }
  }

  async function syncBackendChatHistory() {
    const client = window.AMADEUS.brainClient;
    if (!client) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const endpoints = [
        '/api/v1/telegram/history',
        '/api/v1/kurisu/history',
        '/api/v1/chat/history',
      ];
      let remoteEntries = null;
      for (const ep of endpoints) {
        try {
          const res = await fetch(client.getHttpUrl(ep), {
            headers: client.getHeaders(),
            signal: ctrl.signal,
          });
          if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data.messages || data.history || data.chat_log);
            if (Array.isArray(list) && list.length > 0) {
              remoteEntries = list;
              break;
            }
          }
        } catch (e) { /* try next endpoint */ }
      }
      clearTimeout(timer);

      if (remoteEntries && remoteEntries.length > 0) {
        const s = window.AMADEUS.state;
        const existingMap = new Set(s.chatLog.map(e => `${e.role}:${e.content}`));
        let added = false;
        remoteEntries.forEach(item => {
          const isAssistant = item.role === 'assistant' || item.sender === 'kurisu' || item.is_bot;
          const role = isAssistant ? 'assistant' : 'user';
          const sender = item.sender || item.author || item.username;
          let content = item.content || item.text || item.message || '';
          if (!isAssistant && sender && !content.startsWith('[')) {
            content = `[${sender}] ${content}`;
          }
          const source = item.source || (item.channel === 'telegram' || item.platform === 'telegram' ? 'telegram' : 'brain');
          const ts = item.timestamp || item.ts ? new Date(item.timestamp || item.ts).getTime() : Date.now();
          if (content && !existingMap.has(`${role}:${content}`)) {
            s.chatLog.push({ role, content, source, ts });
            existingMap.add(`${role}:${content}`);
            added = true;
          }
        });
        if (added) {
          s.chatLog.sort((a, b) => (a.ts || 0) - (b.ts || 0));
          if (s.chatLog.length > CHAT_LOG_MAX) s.chatLog = s.chatLog.slice(-CHAT_LOG_MAX);
          renderChatLog();
          saveChatLog();
        }
      }
    } catch (e) {
      // Backend offline or endpoint inactive
    }
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
    const who = entry.role === 'user' ? (entry.source === 'telegram' ? 'TELEGRAM' : 'YOU') : 'KURISU';
    const stamp = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (entry.role === 'assistant' || entry.source === 'telegram') {
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
    const el = getChatLogEl();
    if (s.chatLog.length > CHAT_LOG_MAX) {
      s.chatLog = s.chatLog.slice(-CHAT_LOG_MAX);
      renderChatLog();
    } else if (el) {
      el.appendChild(createChatEntryElement(entry));
      el.scrollTop = el.scrollHeight;
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
    const el = getChatLogEl();
    if (el) el.innerHTML = '';
    if (window.AMADEUS.bubble) {
      window.AMADEUS.bubble.showKurisuBubble("I've wiped the terminal records. Don't leave careless experiments behind.", 6000);
    }
    const l2d = s && s.live2DController;
    if (l2d && l2d.setEmotion) l2d.setEmotion('annoyed', 4000);
  }

  function renderChatLog() {
    const el = getChatLogEl();
    if (!el) return;
    const frag = document.createDocumentFragment();
    const s = window.AMADEUS.state;
    s.chatLog.forEach((entry) => {
      frag.appendChild(createChatEntryElement(entry));
    });
    el.innerHTML = '';
    el.appendChild(frag);
    el.scrollTop = el.scrollHeight;
  }

  /**
   * AMADEUS chat persistence (localStorage with debounced writes).
   * @property {() => void} loadKurisuHistory - Restores conversation history into state.
   * @property {() => void} saveKurisuHistory - Persists conversation history (debounced).
   * @property {() => void} writeKurisuHistory - Immediate history write (debouncer/pagehide).
   * @property {() => void} loadChatLog - Restores the rendered chat log state.
   * @property {() => void} saveChatLog - Persists the chat log (debounced).
   * @property {() => void} writeChatLog - Immediate log write (debouncer/pagehide).
   * @property {() => HTMLElement} createChatEntryElement - Builds a chat log row element.
   * @property {(role: 'user'|'assistant', text: string, source?: string) => void} appendChatEntry - Appends an entry to state + DOM + persisted log.
   * @property {() => void} clearChatLogAndHistory - Wipes chat UI, log and history (Ctrl+Shift+X).
   * @property {() => void} renderChatLog - Re-renders the full chat log from state.
   */
  Object.assign(window.AMADEUS.chat, {
    loadKurisuHistory,
    saveKurisuHistory,
    writeKurisuHistory,
    loadChatLog,
    saveChatLog,
    writeChatLog,
    createChatEntryElement,
    appendChatEntry,
    clearChatLogAndHistory,
    renderChatLog,
    syncBackendChatHistory,
  });
})();
