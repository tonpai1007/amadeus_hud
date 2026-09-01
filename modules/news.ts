/// <reference path="../types/amadeus.d.ts" />
// modules/news.js - AMADEUS Realtime Intelligence & Cybernetic Feed
window.AMADEUS = window.AMADEUS || ({} as any);

(function() {
  let feedMode = 'news';
  let lastBusinessData = null;
  let lastNewsStories = [];
  let lastNewsReactionAt = 0;
  const NEWS_CACHE_KEY = "amadeus.news.cache";
  const NEWS_CACHE_MAX_AGE = 4 * 60 * 60 * 1000; // 4 hours

  const curatedCyberPool = [
    { title: "Quantum Divergence Field: Real-time coherence measurement in qubit arrays", url: "https://arxiv.org", score: 418, time: Date.now()/1000 - 1800, tag: "ARXIV" },
    { title: "Neuroscience Breakthrough: Synaptic weight modeling for AGI memory consolidation", url: "https://nature.com", score: 385, time: Date.now()/1000 - 3600, tag: "SCIENCE" },
    { title: "GraphRAG v2: High-density Obsidian associative neural graphs deployed", url: "https://obsidian.md", score: 342, time: Date.now()/1000 - 7200, tag: "OBSIDIAN" },
    { title: "Autonomous AGI Skill Distillation: Self-evolving cognitive matrices in production", url: "https://github.com", score: 295, time: Date.now()/1000 - 10800, tag: "GITHUB" },
    { title: "WebGPU Neural Shaders: Sub-millisecond latency for live interactive visualizers", url: "https://github.com", score: 264, time: Date.now()/1000 - 14400, tag: "SYS_CORE" },
    { title: "CERN Particle Collider: Micro-black hole detection telemetry confirmed", url: "https://cern.ch", score: 512, time: Date.now()/1000 - 21600, tag: "CERN_LAB" }
  ];

  const KURISU_NEWS_LINES = {
    science: [
      "Interesting. The divergence measurement is worth a closer look.",
      "Now that's a world line hypothesis worth investigating.",
      "Hmm. The cognitive telemetry data isn't entirely random.",
      "Noted. I'll file that under the Future Gadget lab memos.",
    ],
    tech: [
      "A new system standard? I'll run kernel compatibility tests.",
      "The submonitor telemetry says that protocol is stabilizing.",
      "If the documentation is accurate, that's a genuinely brilliant architecture.",
    ],
    default: [
      "World-line intelligence feed synchronized.",
      "Logged to episodic memory. Purely for laboratory research.",
    ],
  };

  function getCleanDomainTag(url, title) {
    if (!url) return 'LAB_MEMO';
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const cleanHost = hostname.startsWith('www.') ? hostname.substring(4) : hostname;

      if (cleanHost.includes('github.com')) return 'GITHUB';
      if (cleanHost.includes('arxiv.org')) return 'ARXIV';
      if (cleanHost.includes('openai.com') || cleanHost.includes('anthropic.com') || cleanHost.includes('deepmind') || cleanHost.includes('google.com')) return 'AI_RESEARCH';
      if (cleanHost.includes('nature.com') || cleanHost.includes('science.org') || cleanHost.includes('sciencedirect')) return 'SCIENCE';
      if (cleanHost.includes('huggingface.co')) return 'HUGGINGFACE';
      if (cleanHost.includes('ycombinator.com')) return 'HN_SYNC';
      if (cleanHost.includes('mit.edu') || cleanHost.includes('stanford.edu') || cleanHost.includes('cern.ch')) return 'ACADEMIA';
      if (cleanHost.includes('obsidian.md')) return 'OBSIDIAN';

      // Disallow weird TLDs or personal blog domains
      if (/\.(gay|xyz|top|site|click|online|blog|info|link|ca|is|tv)$/.test(cleanHost) || cleanHost.includes('blogspot') || cleanHost.includes('wordpress')) {
        const cat = classifyNewsTitle(title);
        if (cat === 'science') return 'QUANTUM_LAB';
        if (cat === 'tech') return 'SYSTEM_CORE';
        return 'TECH_FEED';
      }

      const parts = cleanHost.split('.');
      if (parts.length >= 2 && parts[0].length <= 12) {
        return parts[0].toUpperCase();
      }
      return cleanHost.toUpperCase().substring(0, 14);
    } catch (e) {
      return 'INTEL_NODE';
    }
  }

  function isStoryRelevant(story) {
    if (!story || !story.title) return false;
    const title = story.title.toLowerCase();

    const badKeywords = [
      'tax', 'railway', 'bricked', 'lawsuit', 'fired', 'layoff', 'drama',
      'dating', 'scam', 'fraud', 'arrest', 'crime', 'murder', 'gossip',
      'scanner', 'apartment', 'landlord', 'tenant', 'politics', 'election'
    ];

    const goodKeywords = [
      'ai', 'llm', 'gpt', 'model', 'neural', 'quantum', 'physics', 'algorithm',
      'gpu', 'cpu', 'linux', 'rust', 'kernel', 'code', 'database', 'compiler',
      'memory', 'vector', 'vision', 'robot', 'agent', 'graph', 'distributed',
      'browser', 'webgl', 'webgpu', 'wasm', 'security', 'crypto', 'protocol', 'network',
      'astronomy', 'biology', 'neuroscience', 'compute', 'hardware', 'deep learning',
      'performance', 'vram', 'framework', 'intelligence', 'chip', 'cuda'
    ];

    const badRes = badKeywords.map(k => new RegExp(String.raw`\b${k}\b`, 'i'));
    const goodRes = goodKeywords.map(k => new RegExp(String.raw`\b${k}\b`, 'i'));
    const hasBad = badRes.some(r => r.test(title));
    const hasGood = goodRes.some(r => r.test(title));

    if (hasBad && !hasGood) return false;
    return true;
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
    if (/\b(ai|llm|model|research|science|space|quantum|physics|biology|neural|study|paper|theory|brain)\b/.test(t)) return 'science';
    if (/\b(web|browser|linux|kernel|gpu|cpu|vram|rust|javascript|typescript|sdk|api|framework|cloud|server|hardware|chip)\b/.test(t)) return 'tech';
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
              || candidates.find(item => classifyNewsTitle(item.title) === 'tech');
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

  function setFeedStatus(statusEl, label, state = 'status-loading') {
    if (!statusEl) return;
    statusEl.className = `status-readout ${state}`;
    statusEl.innerText = label;
  }

  function toggleFeedMode() {
    if (feedMode === 'news') {
      feedMode = 'trendshift';
    } else {
      feedMode = 'news';
    }

    const feedTag = document.getElementById('feed-tag') as (HTMLElement & { _bound?: boolean }) | null;
    if (feedTag) {
      if (feedMode === 'trendshift') feedTag.textContent = '// TRENDSHIFT_SCOUT';
      else feedTag.textContent = '// REALTIME_NEWS_FEED';
    }

    if (feedMode === 'trendshift') {
      renderTrendshiftFeed();
    } else {
      fetchRealtimeNews();
    }
  }

  async function renderBusinessFeed() { renderTrendshiftFeed(); }

  async function renderTrendshiftFeed() {
    const container = document.getElementById('news-feed');
    const statusEl = document.getElementById('news-status');
    if (!container || !statusEl) return;

    container.innerHTML = '<div class="news-item"><div class="news-title">Scouting Trendshift weekly repositories...</div></div>';
    container.dataset.feedState = 'scouting';
    setFeedStatus(statusEl, 'SCOUTING', 'status-busy');

    try {
      const brain = window.KURISU_BRAIN || (window.AMADEUS.chat && window.AMADEUS.chat.KURISU_BRAIN) || {};
      const base = (brain && brain.endpoint) || '';
      if (!base) throw new Error('No brain endpoint configured');
      const res = await fetchWithTimeout(`${base}/v1/intel/trendshift`, 5000);
      if (!res.ok) throw new Error("Brain API unavailable");
      const data = await res.json();
      const evals = data.evaluations || [];

      if (!evals.length) throw new Error("No discoveries returned");

       container.innerHTML = '';
       container.dataset.feedState = 'live';
       setFeedStatus(statusEl, `DISCOVERIES (${data.high_value_count || 0})`, 'status-live');

      evals.forEach(e => {
        const item = document.createElement('a');
        item.className = 'news-item';
        item.href = e.url || '#';
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
        item.addEventListener('click', (ev) => {
          ev.preventDefault();
          try { window.open(e.url, '_blank'); } catch (err) {}
        });

        const titleDiv = document.createElement('div');
        titleDiv.className = 'news-title';
        titleDiv.innerText = `${e.name}`;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'news-meta';
        const score = e.relevance_score || 5;
        const tag = (score >= 8) ? 'AGI_HIGH_VALUE' : 'GITHUB_TREND';
        const esc = window.AMADEUS.escapeHtml;
        metaDiv.innerHTML = `
          <span class="news-score">${score >= 8 ? 'HIGH' : 'WATCH'}</span>
          <span class="news-time">${esc(e.key_innovation ? e.key_innovation.substring(0, 42) + '...' : 'Trending')}</span>
          <span class="news-domain">[ ${esc(tag)} ]</span>
        `;

        item.appendChild(titleDiv);
        item.appendChild(metaDiv);
        container.appendChild(item);
      });
    } catch (err) {
      console.warn("Trendshift HUD Fetch fallback:", err);
      container.innerHTML = `
        <div class="news-item">
          <div class="news-title">Hermes Agent: Autonomous AGI Matrix</div>
          <div class="news-meta">
            <span class="news-score">HIGH</span>
            <span class="news-time">Self-Evolving Cognitive Core</span>
            <span class="news-domain">[ AGI_HIGH ]</span>
          </div>
        </div>
        <div class="news-item">
          <div class="news-title">Learn Claude Code: Interactive CLI Subagents</div>
          <div class="news-meta">
            <span class="news-score">WATCH</span>
            <span class="news-time">Tool-Calling Multi-Agent</span>
            <span class="news-domain">[ AGENTIC ]</span>
          </div>
        </div>
        <div class="news-item">
          <div class="news-title">Open Connector: Universal Protocol Gateway</div>
          <div class="news-meta">
            <span class="news-score">EXPERIMENT</span>
            <span class="news-time">Distributed Neural Sync</span>
            <span class="news-domain">[ GATEWAY ]</span>
          </div>
        </div>
      `;
      container.dataset.feedState = 'offline-sample';
      setFeedStatus(statusEl, 'OFFLINE_SAMPLE', 'status-offline');
    }
  }

  async function fetchWithTimeout(url, ms = 6000) {
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
    const feedTag = document.getElementById('feed-tag') as (HTMLElement & { _bound?: boolean }) | null;
    const s = window.AMADEUS.state;
    
    if (feedTag && !feedTag._bound) {
      feedTag._bound = true;
      feedTag.addEventListener('click', toggleFeedMode);
    }
    if (!container || !statusEl) return true;

    container.dataset.feedState = 'loading';
    setFeedStatus(statusEl, 'FETCHING', 'status-loading');

    if (feedMode === 'business') {
      renderBusinessFeed();
      return true;
    }
    if (feedMode === 'trendshift') {
      renderTrendshiftFeed();
      return true;
    }

    // Offline: use cache
    if (!navigator.onLine) {
      const cached = loadNewsCache();
      if (cached && cached.stories) {
        renderNewsStories(container, statusEl, cached.stories, 'CACHED');
        if (s && s.newsOfflineSince === 0) s.newsOfflineSince = Date.now();
        return false;
      }
    }

    try {
      const topStoriesRes = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json');
      if (!topStoriesRes.ok) throw new Error("HN Fetch Failed");

      const storyIds = await topStoriesRes.json();
      const targetStories = storyIds.slice(0, 15);

      const storyPromises = targetStories.map(async (id) => {
        try {
          const detailRes = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 4000);
          if (!detailRes.ok) return null;
          return await detailRes.json();
        } catch (e) { return null; }
      });

      const results = await Promise.allSettled(storyPromises);
      const rawStories = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && !!(r as any).value && !!(r as any).value.title)
        .map(r => r.value);

      // Intelligent filter: keep only relevant science/tech/AI/engineering stories
      let filteredStories = rawStories.filter(isStoryRelevant);

      // If fewer than 4 relevant stories, top-up with curated cybernetic intelligence
      let usedSampleStories = false;
      if (filteredStories.length < 4) {
        for (const poolItem of curatedCyberPool) {
          if (!filteredStories.some(s => s.title === poolItem.title)) {
            filteredStories.push({ ...poolItem, sample: true });
            usedSampleStories = true;
          }
          if (filteredStories.length >= 5) break;
        }
      }

      filteredStories = filteredStories.slice(0, 4);

      // Cache successful fetch
      saveNewsCache(filteredStories);
      if (s) s.newsOfflineSince = 0; // Reset offline timer

      renderNewsStories(container, statusEl, filteredStories, usedSampleStories ? 'LIVE+SAMPLE' : 'LIVE_SYNC');
      lastNewsStories = filteredStories;
      if (window.AMADEUS.net) window.AMADEUS.net.reportNetSuccess();
      return true;
    } catch (err) {
      console.warn("AMADEUS News Sync: API offline, loading curated cyber intelligence pool.", err);
      
      // Try cache on failure
      const cached = loadNewsCache();
      if (cached && cached.stories) {
        renderNewsStories(container, statusEl, cached.stories, 'CACHED');
        if (s && s.newsOfflineSince === 0) s.newsOfflineSince = Date.now();
      } else {
        renderFallbackNews(container, statusEl);
        if (s && s.newsOfflineSince === 0) s.newsOfflineSince = Date.now();
      }
      if (window.AMADEUS.net) window.AMADEUS.net.reportNetFailure();
      return false;
    }
  }

  function renderNewsStories(container, statusEl, stories, statusText) {
    container.innerHTML = '';
    const state = statusText === 'LIVE_SYNC'
      ? 'status-live'
      : statusText === 'LIVE+SAMPLE'
        ? 'status-busy'
        : statusText === 'CACHED'
          ? 'status-cached'
          : 'status-offline';
    container.dataset.feedState = state.replace('status-', '');
    setFeedStatus(statusEl, statusText, state);

    stories.forEach(story => {
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

      const tag = story.tag || getCleanDomainTag(story.url, story.title);
      const esc = window.AMADEUS.escapeHtml;
      metaDiv.innerHTML = `
        <span class="news-score">${story.sample ? 'SAMPLE' : `▲ ${story.score || 0} pts`}</span>
        <span class="news-time">${story.sample ? 'curated fallback' : `posted ${timeSince(story.time || (Date.now()/1000 - 1800))} ago`}</span>
        <span class="news-domain">[ ${esc(tag)} ]</span>
      `;

      item.appendChild(titleDiv);
      item.appendChild(metaDiv);
      container.appendChild(item);
    });
  }

  function renderFallbackNews(container, statusEl) {
    container.innerHTML = '';
    container.dataset.feedState = 'offline-sample';
    setFeedStatus(statusEl, 'OFFLINE_SAMPLE', 'status-offline');

    curatedCyberPool.forEach(story => {
      const item = document.createElement('a');
      item.className = 'news-item';
      item.href = story.url;
      item.target = '_blank';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'news-title';
      titleDiv.innerText = story.title;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'news-meta';

      const esc = window.AMADEUS.escapeHtml;
      metaDiv.innerHTML = `
        <span class="news-score">SAMPLE</span>
        <span class="news-time">curated fallback</span>
        <span class="news-domain">[ ${esc(story.tag)} ]</span>
      `;

      item.appendChild(titleDiv);
      item.appendChild(metaDiv);
      container.appendChild(item);
    });

    lastNewsStories = curatedCyberPool.slice();
  }

  function saveNewsCache(stories) {
    try {
      const payload = JSON.stringify({ stories, at: Date.now() });
      localStorage.setItem(NEWS_CACHE_KEY, payload);
    } catch (e) { /* ignore */ }
  }

  function loadNewsCache() {
    try {
      const raw = localStorage.getItem(NEWS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const age = Date.now() - (parsed.at || 0);
      if (age > NEWS_CACHE_MAX_AGE) {
        localStorage.removeItem(NEWS_CACHE_KEY);
        return null;
      }
      return parsed;
    } catch (e) { return null; }
  }

  // Self-scheduling fetch loop with exponential backoff: a failed HN fetch
  // doubles the delay (capped at 1h) instead of hammering a dead API every
  // 15 minutes; a successful fetch resets the cadence to base.
  const NEWS_BASE_INTERVAL = 15 * 60 * 1000;
  const NEWS_MAX_INTERVAL = 60 * 60 * 1000;
  let newsInterval = NEWS_BASE_INTERVAL;

  function scheduleNewsFetch() {
    setTimeout(async () => {
      const s = window.AMADEUS.state;
      let ok = true;
      if (s && !s.isLivelyPaused) ok = await fetchRealtimeNews();
      newsInterval = ok ? NEWS_BASE_INTERVAL : Math.min(NEWS_MAX_INTERVAL, newsInterval * 2);
      scheduleNewsFetch();
    }, newsInterval);
  }
  scheduleNewsFetch();

  /**
   * AMADEUS realtime intelligence feed (Hacker News + curated fallback).
   * @property {() => Promise<boolean>} fetchRealtimeNews - Fetches and renders the live HN feed; resolves true on a live sync, false when the curated fallback pool was rendered (drives backoff).
   * @property {() => void} toggleFeedMode - Switches the bottom-left panel between news / business / trendshift feeds.
   * @property {() => void} renderTrendshiftFeed - Renders the Trendshift-style feed variant.
   * @property {() => Array} getLastStories - The story list backing the current render (for brain context).
   * @property {(story: {title: string, url?: string}) => boolean} isStoryRelevant - Pure: true when a story fits Kurisu's science/tech interests (no clickbait/politics keywords).
   * @property {(url?: string, title?: string) => string} getCleanDomainTag - Pure: maps a story URL to a short uppercase source tag (e.g. GITHUB, ARXIV).
   * @property {(timestamp: number) => string} timeSince - Pure: renders a unix timestamp (seconds) as "42s" / "5m" / "3h".
   */
  window.AMADEUS.news = {
    fetchRealtimeNews,
    toggleFeedMode,
    renderTrendshiftFeed,
    getLastStories: () => lastNewsStories,
    isStoryRelevant,
    getCleanDomainTag,
    timeSince,
  };
})();
