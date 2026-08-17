// modules/uplink.js - AMADEUS Real-Time Consciousness & Cognitive Telemetry Stream
window.AMADEUS = window.AMADEUS || {};

(function() {
  let ws = null;
  let reconnectTimer = null;
  let retryCount = 0;
  const WS_URL = 'ws://127.0.0.1:8000/ws/amadeus';

  function initCognitiveUplink() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[Uplink] WebSocket connected to AMADEUS Brain Consciousness stream.');
        retryCount = 0;
        updateUplinkStatus(true);
      };

      ws.onmessage = (event) => {
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
        updateUplinkStatus(false);
        scheduleReconnect();
      };
    } catch (err) {
      console.warn('[Uplink] Connection failed:', err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(30000, 2000 * Math.pow(1.5, retryCount));
    retryCount++;
    reconnectTimer = setTimeout(initCognitiveUplink, delay);
  }

  function updateUplinkStatus(online) {
    const uplinkEl = document.getElementById('hud-uplink');
    const kernelEl = document.getElementById('hud-kernel');
    if (uplinkEl) {
      uplinkEl.innerHTML = `<span class="bullet"></span> UPLINK: ${online ? 'LIVE_STREAM' : 'DISCONNECTED'}`;
      uplinkEl.style.color = online ? '#ff4d55' : '#888';
    }
    if (kernelEl) {
      kernelEl.innerHTML = `<span class="bullet"></span> KERNEL: ${online ? 'ACTIVE_SYNC' : 'LOCAL_IDLE'}`;
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
              divEl.innerHTML = `<span class="bullet"></span> DIV: ${Number(evData.world_line_divergence).toFixed(6)}`;
            }
          }
          if (evData.valence !== undefined && window.AMADEUS.mood) {
            window.AMADEUS.mood.adjustMood(evData.valence * 5);
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

  window.AMADEUS.uplink = {
    init: initCognitiveUplink,
  };
})();
