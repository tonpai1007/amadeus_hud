// modules/media-player.js - Interactive Steins;Gate Cybernetic Media Player Dock for AMADEUS HUD
window.AMADEUS = window.AMADEUS || {};

(function() {
  let isPlaying = false;
  let currentTrack = "AUDIO_FEED_IDLE";
  let currentArtist = "";

  async function sendMediaAction(action) {
    if (window.AMADEUS.sfx) window.AMADEUS.sfx.playBeepSound();
    
    // Animate button feedback
    const btn = document.querySelector(`[data-media-act="${action}"]`);
    if (btn) {
      btn.classList.add('media-active');
      setTimeout(() => btn.classList.remove('media-active'), 200);
    }

    const brain = window.KURISU_BRAIN || (window.AMADEUS.chat && window.AMADEUS.chat.KURISU_BRAIN) || {};
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const headers = { 'Content-Type': 'application/json' };
      if (brain.apiKey) headers['Authorization'] = `Bearer ${brain.apiKey}`;
      const res = await fetch(`${brain.endpoint}/api/v1/kurisu/media-control`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        if (action === 'play_pause') {
          isPlaying = !isPlaying;
          updatePlayPauseBtn();
        }
      }
    } catch (e) {
      // Local fallback simulation
      if (action === 'play_pause') {
        isPlaying = !isPlaying;
        updatePlayPauseBtn();
      }
    }
  }

  function updatePlayPauseBtn() {
    const playBtn = document.getElementById('media-play-pause');
    if (playBtn) {
      playBtn.innerHTML = isPlaying ? '❚❚' : '▶';
      playBtn.title = isPlaying ? 'Pause (Space / Media Key)' : 'Play (Space / Media Key)';
      playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    }
  }

  function updateTrackInfo(track, artist) {
    currentTrack = track || "AUDIO_FEED_IDLE";
    currentArtist = artist || "";
    const trackEl = document.getElementById('now-playing-track');
    const artistEl = document.getElementById('now-playing-artist');
    if (trackEl) trackEl.textContent = currentTrack;
    if (artistEl) artistEl.textContent = currentArtist ? `// ${currentArtist}` : "";
    if (track && track !== "AUDIO_FEED_IDLE") {
      isPlaying = true;
      updatePlayPauseBtn();
    }
  }

  function initMediaPlayer() {
    const prevBtn = document.getElementById('media-prev');
    const playBtn = document.getElementById('media-play-pause');
    const nextBtn = document.getElementById('media-next');
    const volUpBtn = document.getElementById('media-vol-up');
    const volDownBtn = document.getElementById('media-vol-down');

    if (prevBtn) prevBtn.addEventListener('click', () => sendMediaAction('previous'));
    if (playBtn) playBtn.addEventListener('click', () => sendMediaAction('play_pause'));
    if (nextBtn) nextBtn.addEventListener('click', () => sendMediaAction('next'));
    if (volUpBtn) volUpBtn.addEventListener('click', () => sendMediaAction('volume_up'));
    if (volDownBtn) volDownBtn.addEventListener('click', () => sendMediaAction('volume_down'));
  }

  /**
   * AMADEUS interactive media player dock (Brain media-control bridge).
   * @property {() => void} initMediaPlayer - Binds prev/play/next/volume buttons.
   * @property {('previous'|'play_pause'|'next'|'volume_up'|'volume_down') => Promise<void>} sendMediaAction - POSTs a media action to the brain; falls back to local play/pause simulation when unreachable.
   * @property {(track?: string, artist?: string) => void} updateTrackInfo - Updates the now-playing readout from Lively track events.
   */
  window.AMADEUS.mediaPlayer = {
    initMediaPlayer,
    sendMediaAction,
    updateTrackInfo,
  };
})();
