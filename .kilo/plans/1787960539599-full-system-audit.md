# AMADEUS HUD — Full System Audit Plan

Scope: security, code quality/architecture, and performance across all 26 modules +
`live2d_controller.js` + `build.mjs`. Baseline: 17 unit tests exist (`tests/run-tests.mjs`);
`npm test` could not be executed from this session (tool permission), so treat the test
count as unverified until re-run.

---

## 1. Security (highest priority)

### 1.1 XSS via `innerHTML` — news feed (HIGH)
- `modules/news.js:338` and `:377` build `metaDiv.innerHTML` with a `tag` from
  `getCleanDomainTag()`. For unknown domains that function returns
  `parts[0].toUpperCase()` (`:62`) / `cleanHost.toUpperCase().substring(0,14)` (`:64`)
  **without HTML-escaping**. A crafted HN story host containing `<` injects markup.
- `modules/news.js:208-211` (trendshift) injects `e.key_innovation` from the brain API
  raw into `innerHTML` — second unescaped vector.
- **Fix:** escape the tag/innovation strings, or build the meta line with
  `textContent`/`createTextNode` like `chat-history.js` already does. Add an
  `escapeHtml` helper (see `task-widget.js:152`) and reuse it everywhere.

### 1.2 Prompt injection into LLM context (MEDIUM)
- `modules/chat-api.js:189` injects `stories[0].title` (from HN, untrusted) verbatim into
  the system prompt: `the top story on "${stories[0].title}"`. A malicious title can
  inject instructions. Same class of issue as 1.1 but targeting the LLM, not the DOM.
- **Fix:** wrap the injected value in a delimited, quoted block and prepend an
  instruction that the bracketed state is data, not instructions; or sanitize titles.

### 1.3 Implicit global leak (LOW, correctness)
- `modules/audio-ring.js:261` reads/writes `lastGearUpdate` which is never declared
  (`let`/`var`/`const`). In classic-script mode this creates `window.lastGearUpdate`.
- **Fix:** declare `let lastGearUpdate = 0;` at module top.

### 1.4 Empty Bearer token sent (LOW)
- `modules/media-player.js:27` and `modules/tts.js:120` send
  `Authorization: Bearer ${brain.apiKey}` even when `apiKey === ''`, producing a
  spurious `Authorization: Bearer ` header.
- **Fix:** only attach the header when the key is non-empty (same guard `state.js`
  already uses in `getHeaders`).

### 1.5 Build pipeline — secrets (OK, record)
- `build.mjs:22,88-117` correctly excludes `brain-key.js`/`openrouter-key.js` and
  strips their `<script>` tags. `.gitignore` covers both. **No action needed** — this
  is the one area that is already correct.

### 1.6 WebSocket trust boundary (INFO)
- `modules/uplink.js` and `modules/lively.js` trust all fields of brain-dispatched
  messages and forward them to the bubble/chat. Renders use `textContent`, so no DOM
  XSS, but a compromised brain can inject arbitrary speech. Document this trust
  boundary; do not relax it without brain-side auth.

---

## 2. Code Quality & Architecture

### 2.1 Cross-file `window.AMADEUS.chat` assembly (MEDIUM)
- `chat-api.js`, `chat-ui.js`, `chat-history.js`, `speech-input.js` each
  `Object.assign(window.AMADEUS.chat, {...})`. `kurisuSay` (chat-ui) calls
  `window.AMADEUS.chat.appendChatEntry` and `.askKurisu`, which exist only because
  `chat-history.js` and `chat-api.js` load first. Works today, but the dependency is
  implicit and load-order-sensitive.
- **Fix:** centralize `AMADEUS.chat` creation in one module, or have each module
  import from a single chat namespace object rather than re-assigning.

### 2.2 Duplicate `interactShadow` method (LOW)
- `live2d_controller.js:209` and `:412` define `interactShadow()` twice; the second
  silently overwrites the first (identical body). Dead code.
- **Fix:** delete one copy.

### 2.3 `const s` redeclaration in `visualLoopTick` (LOW)
- `wallpaper.js:52` declares `const s`, then `:65` redeclares a block-scoped `const s`
  inside a nested `if`. Legal shadowing, but the outer `s` is then unused — confusing.
- **Fix:** remove the redundant inner declaration and reuse the outer `s`.

### 2.4 Master-tick subscriber mutation during iteration (LOW)
- `modules/state.js:78-81` iterates `_masterCallbacks` with a `for` loop; a callback
  calling `offMasterTick` splices the array mid-iteration and skips the next callback.
- **Fix:** iterate a snapshot (`[..._masterCallbacks]`) or mark-and-sweep after the loop.

### 2.5 DPR cap inconsistency (LOW)
- README claims 1.5 DPR cap; `modules/state.js:57` caps at `1.0`;
  `live2d_controller.js:92` caps at `1.25`. Three conflicting values.
- **Fix:** define one `MAX_DPR` constant in `l2d-constants.js` and reference it everywhere.

### 2.6 `l2d-interaction.js` dead `lipSyncRaf` (LOW)
- `let lipSyncRaf = null` is declared (`:11`) and `cancelAnimationFrame(lipSyncRaf)`
  is called (`:155`) but it is never assigned a rAF id. Lip sync actually runs via
  `onMasterTick(mouthCb)`. Dead code.
- **Fix:** remove `lipSyncRaf` and the `cancelAnimationFrame` call.

### 2.7 `isStoryRelevant` regex rebuild (LOW)
- `modules/news.js:90-91` rebuilds `new RegExp(...)` for every keyword × every story
  on each fetch (~450 compilations).
- **Fix:** pre-compile the keyword arrays once at module load.

### 2.8 Positive patterns (record, no action)
- `chat-history.js` and `bubble.js` correctly use `textContent`/`createTextNode` —
  template for the news fix.
- `task-widget.js:152` already has a correct `escapeHtml` helper — reuse it.
- `_masterTick` wraps each subscriber in try/catch so one failure can't break the loop.
- All network calls are try/catch'd with AbortController timeouts.

---

## 3. Performance

### 3.1 Master ticker runs uncapped at 60fps (INFO)
- `modules/state.js:76` runs rAF uncapped so the perf governor can measure true FPS.
  `visualLoopTick` throttles drawing, but the callback loop + FPS math run 60fps even
  when idle. By design; confirm this is acceptable (it is cheap). The PixiJS ticker
  is throttled to 0.25× in idle via `setIdleMode`, so the model itself draws at ~6fps.

### 3.2 `handleAudioFrame` gating (OK)
- `modules/lively.js:121` gates the audio-ring redraw to `PERF.visualFps`. Good.
  The heavy per-frame work (beat detection, mood energy, lip sync) still runs on every
  Lively audio frame — acceptable since Lively itself dispatches at ~30fps.

### 3.3 Canvas backing resolution (OK)
- `oscilloscope.js:31-33`, `audio-ring.js:22-25`, `background.js:19-21` all size canvases
  to `PERF.dpr` and the perf governor scales `dpr` down under load. Matches README.

### 3.4 Potential tts master-tick leak (LOW)
- `modules/tts.js:159` registers `lipSyncCb` via `onMasterTick` and removes it when
  `!isSpeakingVoice`. If an audio element never fires `ended`/`error` (e.g. stalled
  network), the callback leaks into the master loop indefinitely.
- **Fix:** add a wall-clock timeout fallback that forces `isSpeakingVoice = false`.

### 3.5 Storage debounce (OK)
- `modules/mood.js:143` debounces localStorage writes at 600ms per key; `wallpaper.js:84`
  flushes on `pagehide`. Matches README. Good.

---

## 4. Recommended execution order

1. **1.1** (news XSS) + **2.1** (escapeHtml reuse) — one patch, two call sites.
2. **1.2** (prompt injection) — sanitize `buildKurisuContext()` inserts.
3. **1.3**, **2.2**, **2.3**, **2.6**, **3.4** — quick cleanups, low risk.
4. **2.4** (subscriber mutation) — needs a small test to prove the skip.
5. **1.4**, **2.5**, **2.7**, **1.6** — polish.
6. Re-run `npm test` and add regression tests for the XSS/prompt-injection fixes.

## 5. Validation plan
- `npm test` — confirm 17 (or more) tests pass after each change.
- `npm run build` — confirm `dist/` still excludes secret scripts.
- Manual: load `index.html` in a browser, toggle every settings widget, send a chat
  message, trigger a worldline shift, and confirm no console errors.
- Add unit tests for `escapeHtml`, the sanitized `getCleanDomainTag`, and the
  `buildKurisuContext` prompt-injection guard.
