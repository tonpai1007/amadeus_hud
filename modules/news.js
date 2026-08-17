// modules/news.js - AMADEUS Realtime Intelligence & Business Ops Feed
window.AMADEUS = window.AMADEUS || {};

(function() {
  let feedMode = 'news';
  let lastBusinessData = null;
  let lastNewsStories = [];
  let lastNewsReactionAt = 0;

  const simulatedNewsPool = [
    { title: "Bitcoin consolidates near local levels as trading indicators shift", url: "https://tradingview.com", score: 320, time: Date.now()/1000 - 3600 },
    { title: "New WebGL standard promises ultra-low CPU memory footprint for widgets", url: "https://github.com", score: 185, time: Date.now()/1000 - 7200 },
    { title: "Obsidian visual graphs: Mapping neural nodes for cognitive research", url: "https://obsidian.md", score: 412, time: Date.now()/1000 - 12000 },
    { title: "Lively Wallpaper v3 updates hardware metrics collection efficiency", url: "https://livelywallpaper.io", score: 98, time: Date.now()/1000 - 18000 },
    { title: "Makise Kurisu Live2D model physics improvements completed", url: "https://live2d.com", score: 256, time: Date.now()/1000 - 24000 },
    { title: "Google Sheets sync limits bypassed with parallel cache fetching", url: "https://sheets.google.com", score: 140, time: Date.now()/1000 - 30000 }
  ];

  const KURISU_NEWS_LINES = {
    science: [
      "Interesting. The signal's worth a closer look.",
      "Now that's a world line worth reading.",
      "Hmm. The data there isn't entirely random.",
      "Noted. I'll file that under the lab memos.",
    ],
    drama: [
      "People can be so dramatic. Statistically unnecessary.",
      "That's going to ruffle a few feathers.",
      "Trouble on another world line, no doubt.",
    ],
    tech: [
      "A new standard? I'll run compatibility tests on that.",
      "The submonitor says that protocol is still unstable.",
      "If the docs are correct, that's a genuinely useful fix.",
    ],
    default: [
      "The submonitor feed just updated.",
      "I logged that headline. Purely for research.",
    ],
  };

  function getDomain(url) {
    if (!url) return 'self';
    try {
      const domain = new URL(url).hostname;
      return domain.startsWith('www.') ? domain.substring(4) : domain;
    } catch (e) { return 'external'; }
  }

  function timeSince(timestamp) {
    const seconds = Math.floor((Date.now() / 1000) - timestamp);
    if (seconds < 0) return "0s";
    let interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m";
    return Math.floor(seconds) + "s";
  }

  function classifyNewsTitle(title) {
    const t = (title || '').toLowerCase();
    if (/\b(ai|llm|model|research|science|space|quantum|physics|biology|neural|study|paper|theory)\b/.test(t)) return 'science';
    if (/\b(law|sue|lawsuit|protest|controvers|war|attack|ban|banned|scandal|crash|hack|breach|leak)\b/.test(t)) return 'drama';
    if (/\b(web|browser|linux|kernel|gpu|cpu|rust|javascript|typescript|sdk|api|framework|cloud|server|startup|funding)\b/.test(t)) return 'tech';
    return 'default';
  }

  function reactToNews(stories) {
    const settings = window.AMADEUS.SETTINGS;
    if (settings && settings.features && settings.features.newsReactions === false) return;
    const now = performance.now();
    if (now - lastNewsReactionAt < 20 * 60 * 1000) return;
    const s = window.AMADEUS.state;
    if (s && (s.isIdle || s.isSleeping || s.kurisuInput)) return;
    const bubble = document.getElementById('kurisu-bubble');
    if (bubble && bubble.classList.contains('visible')) return;
    if (Math.random() > 0.5) return;

    const candidates = (stories || []).filter(item => item && item.title);
    if (!candidates.length) return;

    let target = candidates.find(item => classifyNewsTitle(item.title) === 'science')
              || candidates.find(item => classifyNewsTitle(item.title) === 'tech')
              || candidates.find(item => classifyNewsTitle(item.title) === 'drama');
    if (!target) target = candidates[Math.floor(Math.random() * Math.min(candidates.length, 3))];

    lastNewsReactionAt = now;
    const kind = classifyNewsTitle(target.title);
    const pool = KURISU_NEWS_LINES[kind] || KURISU_NEWS_LINES.default;
    const line = pool[Math.floor(Math.random() * pool.length)];
    if (window.AMADEUS.bubble) window.AMADEUS.bubble.showKurisuBubble(line, 7000);
    if (window.AMADEUS.chat) window.AMADEUS.chat.appendChatEntry('assistant', line, 'news');
    const l2d = s && s.live2DController;
    if (l2d && l2d.setEmotion) {
      l2d.setEmotion(kind === 'science' ? 'thinking' : 'curious', 5000);
    }
  }

  function toggleFeedMode() {
    feedMode = (feedMode === 'news') ? 'business' : 'news';
    const feedTag = document.getElementById('feed-tag');
    if (feedTag) {
      feedTag.textContent = (feedMode === 'business') ? '// BUSINESS_OPS' : '// REALTIME_NEWS_FEED';
    }
    if (feedMode === 'business') {
      renderBusinessFeed();
    } else {
      fetchRealtimeNews();
    }
  }

  function renderBusinessFeed() {
    const container = document.getElementById('news-feed');
    const statusEl = document.getElementById('news-status');
    if (!container) return;
    if (statusEl) {
      statusEl.innerText = 'BIZ_SYNC';
      statusEl.className = 'pulse-text';
    }
    const rev = lastBusinessData ? (lastBusinessData.revenue_thb || 0).toLocaleString() : '0';
    const orders = lastBusinessData ? (lastBusinessData.orders_count || 0) : '0';
    const status = (lastBusinessData && lastBusinessData.status === 'online') ? 'CONNECTED' : 'STANDBY';

    container.innerHTML = `
      <div class="biz-card">
        <span>TONPAI_ICE_REVENUE</span>
        <span class="biz-val">฿ ${rev} THB</span>
      </div>
      <div class="biz-card">
        <span>ORDERS_TODAY</span>
        <span class="biz-val">${orders} TICKETS</span>
      </div>
      <div class="biz-card">
        <span>LOYVERSE_SYNC</span>
        <span class="biz-val" style="color:#ff4d55;">${status}</span>
      </div>
    `;
  }

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
    const feedTag = document.getElementById('feed-tag');
    if (feedTag && !feedTag._bound) {
      feedTag._bound = true;
      feedTag.addEventListener('click', toggleFeedMode);
    }
    if (!container || !statusEl) return;

    if (feedMode === 'business') {
      renderBusinessFeed();
      return;
    }

    try {
      const topStoriesRes = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json');
      if (!topStoriesRes.ok) throw new Error("HN Fetch Failed");

      const storyIds = await topStoriesRes.json();
      const targetStories = storyIds.slice(0, 6);

      const storyPromises = targetStories.map(async (id) => {
        try {
          const detailRes = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 5000);
          if (!detailRes.ok) return null;
          return await detailRes.json();
        } catch (e) { return null; }
      });

      const results = await Promise.allSettled(storyPromises);
      const stories = results.map(r => r.status === 'fulfilled' ? r.value : null);
      if (!stories.some(Boolean)) throw new Error('No stories fetched');

      container.innerHTML = '';
      statusEl.innerText = 'LIVE_SYNC';
      statusEl.className = 'pulse-text';

      stories.forEach(story => {
        if (!story || !story.title) return;
        const item = document.createElement('a');
        item.className = 'news-item';
        const targetUrl = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
        item.href = targetUrl;
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
        item.addEventListener('click', (e) => {
          e.preventDefault();
          try { window.open(targetUrl, '_blank'); } catch (err) {}
        });

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

      reactToNews(stories);
      lastNewsStories = stories.filter(Boolean);
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

    reactToNews(simulatedNewsPool);
    lastNewsStories = simulatedNewsPool.slice();
  }

  setInterval(() => {
    const s = window.AMADEUS.state;
    if (s && !s.isLivelyPaused) fetchRealtimeNews();
  }, 15 * 60 * 1000);

  window.AMADEUS.news = {
    fetchRealtimeNews,
    toggleFeedMode,
    renderBusinessFeed,
    setBusinessData: (data) => { lastBusinessData = data; if (feedMode === 'business') renderBusinessFeed(); },
    getLastStories: () => lastNewsStories,
  };

  window.fetchRealtimeNews = fetchRealtimeNews;
  window.toggleFeedMode = toggleFeedMode;
  window.renderBusinessFeed = renderBusinessFeed;
})();
