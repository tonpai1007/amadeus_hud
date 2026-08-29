// modules/uplink.js - AMADEUS Real-Time Consciousness & Cognitive Telemetry Stream
window.AMADEUS = window.AMADEUS || {};

(function() {
  let ws = null;
  let hb = null;
  let reconnectTimer = null;
  let retryCount = 0;
  let intentionallyClosed = false;

  function initCognitiveUplink() {
    intentionallyClosed = false;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const client = window.AMADEUS.brainClient;
    const wsUrl = client.getWsUrl('/ws/amadeus');

    try {
      ws = new WebSocket(wsUrl);
      hb = window.AMADEUS.createWsHeartbeat(ws, { intervalMs: 25000, staleMs: 90000 });

      ws.onopen = () => {
        console.log('[Uplink] WebSocket connected to AMADEUS Brain Consciousness stream.');
        retryCount = 0;
        if (hb) hb.start();
        updateUplinkStatus(true);
      };

      ws.onmessage = (event) => {
        if (hb) hb.touch();
        try {
          const data = JSON.parse(event.data);
          handleIncomingMessage(data);
        } catch (e) {
          console.warn('[Uplink] Failed to parse message:', e);
        }
      };

      ws.onerror = (err) => {
        console.warn('[Uplink] WebSocket error:', err);
      };

      ws.onclose = () => {
        if (hb) hb.stop();
        updateUplinkStatus(false);
        if (intentionallyClosed) return;
        scheduleReconnect();
      };
    } catch (err) {
      console.warn('[Uplink] Connection failed:', err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(15000, 1000 * Math.pow(1.5, retryCount) + Math.random() * 500);
    retryCount++;
    reconnectTimer = setTimeout(initCognitiveUplink, delay);
  }

  // Intentional teardown: closes the consciousness stream WITHOUT arming the
  // reconnect loop (used when Lively pauses playback or the page unloads).
  function closeCognitiveUplink() {
    intentionallyClosed = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    retryCount = 0;
    if (hb) hb.stop();
    if (ws) {
      try { ws.close(); } catch (e) { /* already closed */ }
      ws = null;
    }
    updateUplinkStatus(false);
  }

  function setStatusText(el, text) {
    if (!el) return;
    el.textContent = '';
    const bullet = document.createElement('span');
    bullet.className = 'bullet';
    el.appendChild(bullet);
    el.appendChild(document.createTextNode(' ' + text));
  }

  function updateUplinkStatus(online) {
    const uplinkEl = document.getElementById('hud-uplink');
    const kernelEl = document.getElementById('hud-kernel');
    if (uplinkEl) {
      setStatusText(uplinkEl, `UPLINK: ${online ? 'LIVE_STREAM' : 'DISCONNECTED'}`);
      uplinkEl.style.color = online ? '#ff4d55' : '#888';
    }
    if (kernelEl) {
      setStatusText(kernelEl, `KERNEL: ${online ? 'ACTIVE_SYNC' : 'LOCAL_IDLE'}`);
    }
  }

  function handleIncomingMessage(msg) {
    if (!msg) return;

    if (msg.type === 'initial_state' && msg.state) {
      const emo = msg.state.emotion;
      if (emo && window.AMADEUS.state && window.AMADEUS.state.live2DController) {
        window.AMADEUS.state.live2DController.setEmotion(emo.label || 'neutral');
      }
      return;
    }

    if (msg.type === 'bus_event' && msg.event) {
      const ev = msg.event;
      const evType = ev.type || ev.event_type;
      const evData = ev.data || {};

      switch (evType) {
        case 'telemetry_update':
          if (evData.world_line_divergence) {
            const divEl = document.getElementById('hud-divergence');
            if (divEl) {
              divEl.style.display = 'block';
              setStatusText(divEl, `DIV: ${Number(evData.world_line_divergence).toFixed(6)}`);
            }
          }
          if (evData.valence !== undefined && window.AMADEUS.mood) {
            window.AMADEUS.mood.adjustMood(evData.valence * 5);
          }
          break;

        case 'proactive_vision_summary':
        case 'vision_insight':
          if (evData.summary && window.AMADEUS.bubble) {
            window.AMADEUS.bubble.showKurisuBubble(`[Vision Scan] ${evData.summary}`, 9000);
            if (window.AMADEUS.state?.live2DController?.setEmotion) {
              window.AMADEUS.state.live2DController.setEmotion(evData.emotion || 'focused', 7000);
            }
          }
          break;

        case 'proactive_task_focus':
          if (evData.title && window.AMADEUS.bubble) {
            window.AMADEUS.bubble.showKurisuBubble(`Task focus: ${evData.title}`, 6000);
          }
          break;

        case 'internal_monologue':
          if (evData.thought && window.AMADEUS.chat) {
            console.log(`[Kurisu Monologue] ${evData.perspective || 'Kurisu'}: ${evData.thought}`);
          }
          break;

        case 'telegram_message':
        case 'telegram_inbound':
        case 'telegram_outbound':
        case 'chat_message':
        case 'external_transmission': {
          const text = evData.text || evData.message || evData.content;
          if (text) {
            const isAssistant = evType === 'telegram_outbound' || evData.role === 'assistant' || evData.sender === 'kurisu' || evData.is_bot;
            const role = isAssistant ? 'assistant' : 'user';
            const sender = evData.sender || evData.author || evData.username || (isAssistant ? 'KURISU' : 'TELEGRAM');
            const display = isAssistant ? text : `[${sender}] ${text}`;

            if (window.AMADEUS.chat && window.AMADEUS.chat.appendChatEntry) {
              window.AMADEUS.chat.appendChatEntry(role, display, 'telegram');
            }
            if (window.AMADEUS.bubble && evData.notify !== false) {
              window.AMADEUS.bubble.showKurisuBubble(display, 7000);
            }
            if (isAssistant && window.AMADEUS.state?.live2DController?.setEmotion) {
              window.AMADEUS.state.live2DController.setEmotion(evData.emotion || 'content', 5000);
            }
            if (window.AMADEUS.sfx && window.AMADEUS.sfx.playTransmitSound) {
              window.AMADEUS.sfx.playTransmitSound();
            }
          }
          break;
        }

        case 'spontaneous_speech':
          if (evData.text && window.AMADEUS.bubble) {
            window.AMADEUS.bubble.showKurisuBubble(evData.text, 8000);
            if (window.AMADEUS.tts) {
              window.AMADEUS.tts.speakKurisuVoice(evData.text, evData.emotion || 'neutral');
            }
          }
          break;
      }
    }
  }

  /**
   * AMADEUS real-time consciousness stream (Brain → HUD WebSocket).
   * @property {() => void} init - Opens the /ws/amadeus stream with heartbeat + exponential reconnect; dispatches bus events (telemetry, vision insights, task focus, spontaneous speech) to the HUD.
   * @property {() => void} close - Tears the stream down without arming reconnect (pause/unload).
   */
  window.AMADEUS.uplink = {
    init: initCognitiveUplink,
    close: closeCognitiveUplink,
  };
})();
