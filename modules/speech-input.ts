/// <reference path="../types/amadeus.d.ts" />
// modules/speech-input.js - AMADEUS Kurisu Speech Recognition & Voice Input
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  let speechRecognition = null;
  let isListening = false;
  let mediaRecorder = null;
  let audioChunks = [];

  // The chat input lives in chat-ui.js's IIFE scope; resolve it locally with
  // the same lazy/isConnected pattern that module uses for its own elements.
  let kurisuInputEl = null;
  function getInputEl() {
    if (!kurisuInputEl || !kurisuInputEl.isConnected) {
      kurisuInputEl = document.getElementById('kurisu-input');
    }
    return kurisuInputEl;
  }

  function initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = document.getElementById('chat-mic');

    if (SpeechRec) {
      try {
        speechRecognition = new SpeechRec();
        speechRecognition.continuous = false;
        speechRecognition.interimResults = false;
        speechRecognition.lang = 'en-US';

        speechRecognition.onstart = () => {
          isListening = true;
          if (micBtn) micBtn.classList.add('listening');
          const inp = getInputEl();
          if (inp) inp.placeholder = '> Listening to your voice...';
        };

        speechRecognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            const inp = getInputEl();
            if (inp) inp.value = transcript;
            window.AMADEUS.state.kurisuInput = transcript;
            window.AMADEUS.chat.kurisuSay(transcript);
          }
        };

        speechRecognition.onerror = (e) => {
          console.warn('[Kurisu] Web Speech API error, falling back to MediaStream:', e.error);
          stopListening();
        };

        speechRecognition.onend = () => {
          stopListening();
        };
      } catch (e) {
        console.warn('[Kurisu] Speech recognition initialization failed:', e.message);
      }
    }

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
  }

  async function startListening() {
    if (isListening) return;
    const micBtn = document.getElementById('chat-mic');

    if (speechRecognition) {
      try {
        speechRecognition.start();
        return;
      } catch (e) {
        console.warn("[Kurisu] Web Speech start failed, attempting MediaRecorder:", e);
      }
    }

    // MediaRecorder / Whisper fallback for Lively Wallpaper
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("[Kurisu] MediaDevices audio capture not supported.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (audioChunks.length === 0) return;
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];

        // Transcribe via Brain Whisper endpoint
        try {
          const inp = getInputEl();
          if (inp) inp.placeholder = '> Transcribing voice...';
          const formData = new FormData();
          formData.append('file', audioBlob, 'speech.webm');
          const brain = window.KURISU_BRAIN || (window.AMADEUS.chat && window.AMADEUS.chat.KURISU_BRAIN) || {};
          const base = (brain && brain.endpoint) || '';
          const resp = base ? await fetch(`${base}/v1/audio/transcriptions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${brain.apiKey || ''}` },
            body: formData,
          }) : null;
          if (resp && resp.ok) {
            const result = await resp.json();
            const text = result.text || result.transcription || '';
            if (text.trim()) {
              const inp = getInputEl();
              if (inp) inp.value = text;
              window.AMADEUS.state.kurisuInput = text;
              window.AMADEUS.chat.kurisuSay(text);
            }
          }
        } catch (sttErr) {
          console.warn("[Kurisu] Whisper STT fallback failed:", sttErr);
        } finally {
          const inp = getInputEl();
          if (inp) inp.placeholder = '> transmit to Kurisu... [Enter]';
        }
      };

      mediaRecorder.start();
      isListening = true;
      if (micBtn) micBtn.classList.add('listening');
      const inp = getInputEl();
      if (inp) inp.placeholder = '> Recording voice... (Click mic to send)';
    } catch (micErr) {
      console.warn("[Kurisu] Microphone access denied or unavailable:", micErr);
      stopListening();
    }
  }

  function stopListening() {
    isListening = false;
    const micBtn = document.getElementById('chat-mic');
    if (micBtn) micBtn.classList.remove('listening');
    const inp = getInputEl();
    if (inp) inp.placeholder = '> transmit to Kurisu... [Enter]';
    if (speechRecognition) {
      try { speechRecognition.stop(); } catch (e) {}
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch (e) {}
    }
  }

  /**
   * AMADEUS push-to-talk speech recognition (Ctrl+Shift+M) with
   * Web Speech STT wired into the chat input.
   * @property {() => void} initSpeechRecognition - Sets up the SpeechRecognition instance and hotkey bindings.
   * @property {() => void} startListening - Begins dictation into the chat input.
   * @property {() => void} stopListening - Ends dictation.
   */
  Object.assign(window.AMADEUS.chat, {
    initSpeechRecognition,
    startListening,
    stopListening,
  });
})();
