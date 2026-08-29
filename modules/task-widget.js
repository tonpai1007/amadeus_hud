// modules/task-widget.js - Holographic Obsidian Task Tracker & Checklist for AMADEUS HUD
window.AMADEUS = window.AMADEUS || {};

(function() {
  const STORAGE_KEY = 'amadeus_obsidian_tasks_cache_v1';
  
  const DEFAULT_TASKS = [
    { id: 1, text: "Review AMADEUS Brain 4-Asset Memory telemetry", completed: true },
    { id: 2, text: "Calibrate Live2D convergence & divergence meter", completed: true },
    { id: 3, text: "Check TonpaiICE2 supply chain logistics", completed: false },
    { id: 4, text: "Deploy updated agent skills to second brain", completed: false },
    { id: 5, text: "Deep research on agentic coding frameworks", completed: false },
  ];

  let tasks = [];
  let isExpanded = true;

  function loadCachedTasks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        tasks = JSON.parse(raw);
        return;
      }
    } catch (e) { /* ignore */ }
    tasks = [...DEFAULT_TASKS];
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) { /* ignore */ }
    renderTasks();
  }

  async function syncTaskWithBrain(task, action = 'update') {
    const client = window.AMADEUS.brainClient;
    if (!client) return;
    try {
      const url = client.getHttpUrl('/api/v1/life-os/tasks/sync');
      await fetch(url, {
        method: 'POST',
        headers: client.getHeaders(),
        body: JSON.stringify({ action, task: { id: task.id, text: task.text, completed: !!task.completed } }),
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  async function fetchBrainTasks() {
    const client = window.AMADEUS.brainClient;
    if (!client) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(client.getHttpUrl('/api/v1/life-os/summary'), {
        headers: client.getHeaders(),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const pmTasks = Array.isArray(data.pm_tasks) ? data.pm_tasks : [];
        if (pmTasks.length > 0) {
          tasks = pmTasks.map((t, idx) => ({
            id: idx + 1,
            text: typeof t === 'string' ? t : t.task,
            completed: typeof t === 'object' &&
              /^(done|complete[d]?|ok)$/i.test(String(t.status || '').trim()),
          }));
          saveTasks();
        }
      }
    } catch (e) {
      // Offline fallback already loaded
    }
  }

  function renderTasks() {
    const listEl = document.getElementById('task-list');
    const badgeEl = document.getElementById('task-badge');
    const countEl = document.getElementById('task-count');
    if (!listEl) return;

    const total = tasks.length;
    const done = tasks.filter(t => t.completed).length;

    if (badgeEl) badgeEl.textContent = `${done}/${total} DONE`;
    if (countEl) countEl.textContent = `[${Math.round(total ? (done / total) * 100 : 0)}%]`;

    listEl.innerHTML = '';
    tasks.forEach((t) => {
      const item = document.createElement('div');
      item.className = `task-item ${t.completed ? 'completed' : ''}`;
      item.innerHTML = `
        <label class="task-checkbox-wrap">
          <input type="checkbox" class="task-chk" data-id="${t.id}" ${t.completed ? 'checked' : ''}>
          <span class="task-custom-chk"></span>
        </label>
        <span class="task-text">${window.AMADEUS.escapeHtml(t.text)}</span>
        <button class="task-del" data-id="${t.id}" title="Remove task" aria-label="Remove task">✕</button>
      `;
      listEl.appendChild(item);
    });

    // Wire clicks
    listEl.querySelectorAll('.task-chk').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = Number.parseInt(e.target.dataset.id, 10);
        const task = tasks.find(x => x.id === id);
        if (task) {
          task.completed = e.target.checked;
          window.AMADEUS?.sfx?.playPokeSound?.();
          if (task.completed) {
            window.AMADEUS?.state?.live2DController?.setEmotion?.('happy', 4000);
          }
          saveTasks();
          syncTaskWithBrain(task, 'toggle');
        }
      });
    });

    listEl.querySelectorAll('.task-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = Number.parseInt(e.target.dataset.id, 10);
        const task = tasks.find(x => x.id === id);
        tasks = tasks.filter(x => x.id !== id);
        saveTasks();
        if (task) syncTaskWithBrain(task, 'delete');
      });
    });
  }

  function addNewTask(text) {
    const clean = text.trim();
    if (!clean) return;
    const nextId = tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const newTask = { id: nextId, text: clean, completed: false };
    tasks.push(newTask);
    saveTasks();
    syncTaskWithBrain(newTask, 'create');
    window.AMADEUS?.sfx?.playTransmitSound?.();
  }

  function toggleWidget() {
    const body = document.getElementById('task-widget-body');
    const stateText = document.getElementById('task-toggle-state');
    isExpanded = !isExpanded;
    if (body) body.style.display = isExpanded ? 'block' : 'none';
    if (stateText) stateText.textContent = isExpanded ? 'COLLAPSE' : 'EXPAND';
  }

  function initTaskWidget() {
    loadCachedTasks();
    renderTasks();
    fetchBrainTasks();

    const header = document.getElementById('task-widget-header');
    const input = document.getElementById('task-new-input');
    const addBtn = document.getElementById('task-new-btn');

    if (header) header.addEventListener('click', toggleWidget);

    const submitNew = () => {
      if (input?.value) {
        addNewTask(input.value);
        input.value = '';
      }
    };

    if (addBtn) addBtn.addEventListener('click', submitNew);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitNew();
        }
      });
    }

    const paraBtn = document.getElementById('para-organize-btn');
    if (paraBtn) {
      paraBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        autoOrganizeVault();
      });
    }

    // Hotkey: Ctrl+Shift+T or Ctrl+T to toggle
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) || (e.ctrlKey && (e.key === 't' || e.key === 'T') && !e.altKey)) {
        const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
        if (!inField) {
          e.preventDefault();
          toggleWidget();
        }
      }
    });
  }

  async function autoOrganizeVault() {
    const badgeEl = document.getElementById('task-badge');
    const prevText = badgeEl ? badgeEl.textContent : '';
    if (badgeEl) badgeEl.textContent = 'PARA SYNCING...';

    const l2d = window.AMADEUS?.state?.live2DController;
    if (l2d && l2d.setEmotion) l2d.setEmotion('thinking', 4000);

    try {
      const client = window.AMADEUS.brainClient;
      if (!client) throw new Error('No brain client');
      const resp = await fetch(client.getHttpUrl('/second-brain/para/organize?auto_execute=true'), {
        method: 'POST',
        headers: client.getHeaders(),
      });
      if (resp.ok) {
        const data = await resp.json();
        const relocated = data.relocated_count || 0;
        const msg = relocated > 0
          ? `00_Inboxから${relocated}件のメモをPARA各フォルダへ自動分類・整理したわ！`
          : '00_Inboxはすでに綺麗に整理されているわ。素晴らしいわね。';

        if (window.AMADEUS.bubble && window.AMADEUS.bubble.showKurisuBubble) {
          window.AMADEUS.bubble.showKurisuBubble(msg, 6000);
        }
        if (l2d && l2d.setEmotion) l2d.setEmotion('happy', 4000);
        if (badgeEl) badgeEl.textContent = `SYNCED: ${relocated}`;
        setTimeout(() => { if (badgeEl) badgeEl.textContent = prevText; }, 5000);
        return;
      }
    } catch (e) {
      console.warn("PARA auto-organize failed:", e);
    }
    if (badgeEl) badgeEl.textContent = prevText;
  }

  /**
   * AMADEUS holographic Obsidian task tracker.
   * @property {() => void} initTaskWidget - Loads cached tasks, renders, syncs from the brain vault and binds add/remove/organize controls + Ctrl+T hotkey.
   * @property {() => void} renderTasks - Re-renders the task list, badge and completion percentage.
   * @property {(text: string) => void} addNewTask - Appends a task and persists it.
   * @property {() => void} toggleWidget - Collapses/expands the task matrix body.
   * @property {() => Promise<void>} autoOrganizeVault - Triggers the brain's PARA auto-organize pass and reports the result in the bubble.
   * @property {() => Array} getTasks - Current task list.
   */
  window.AMADEUS.taskWidget = {
    initTaskWidget,
    renderTasks,
    addNewTask,
    toggleWidget,
    autoOrganizeVault,
    getTasks: () => tasks,
  };
})();
