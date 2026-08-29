# Lively-Specific Fixes — AMADEUS HUD

## 1. Skip visual loop while Lively is paused

**File:** `wallpaper.js`
**Change:** Add `isLivelyPaused` early-return in `visualLoopTick`.

```js
  function visualLoopTick(now) {
    const interval = 1000 / (window.AMADEUS.PERF ? window.AMADEUS.PERF.visualFps : 30);
    if (now - lastVisualTick < interval) return;
    lastVisualTick = now - ((now - lastVisualTick) % interval);

    const s = window.AMADEUS.state;
    if (s.isLivelyPaused) return;

    // Phase 0: Core Visual Telemetry & Background Render
    if (window.AMADEUS.oscilloscope) window.AMADEUS.oscilloscope.updateWorldLine();
    if (window.AMADEUS.background) window.AMADEUS.background.updateBackground();
```

---

## 2. Close WebSockets on Lively pause, reconnect on resume

**File:** `modules/uplink.js`
**Change:** In `livelyWallpaperPlaybackChanged`-style handling, close `ws` when paused and reconnect when resumed. If the pause handler is in `lively.js`, patch there and call `window.AMADEUS.uplink.init()` / `window.AMADEUS.lively.initLivelyWebSocket()` accordingly.

**File:** `modules/lively.js`
**Change:** In `livelyWallpaperPlaybackChanged`, after `l2d.pause()` / `l2d.resume()`, add:

```js
      if (obj.IsPaused) {
        l2d.pause();
        if (power) power.onUserAway();
        // Close telemetry WebSockets while paused
        if (window.AMADEUS.uplink && window.AMADEUS.uplink.init) {
          // uplink init is open-only; close via internal ws if exposed, or add close method
        }
      } else {
        l2d.resume();
        if (power) {
          power.markActivity();
          power.onUserReturn();
        }
        // Reconnect telemetry WebSockets on resume
        if (window.AMADEUS.uplink && window.AMADEUS.uplink.init) window.AMADEUS.uplink.init();
        if (window.AMADEUS.lively && window.AMADEUS.lively.initLivelyWebSocket) window.AMADEUS.lively.initLivelyWebSocket();
      }
```

> **Note:** If `uplink.js` doesn’t expose a `close()` method, add one:

```js
  function closeCognitiveUplink() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (livelyHb) { try { livelyHb.stop(); } catch (e) {} livelyHb = null; }
    clearTimeout(reconnectTimer);
  }
```

And export it in `window.AMADEUS.uplink`.

---

## 3. Sync Lively `perfGovernor` property with adaptive governor

**File:** `modules/lively.js` → `livelyPropertyListener` case `'perfGovernor'`
**Change:** After computing `level`, update the shared state and apply it:

```js
      case 'perfGovernor': {
        let level = 2;
        if (typeof val === 'number' && Number.isFinite(val)) {
          level = Math.max(0, Math.min(2, Math.round(val)));
        } else if (typeof val === 'string') {
          const s = val.trim().toLowerCase();
          if (s.includes('saver') || s === '0' || s === 'low') level = 0;
          else if (s.includes('balance') || s === '1' || s === 'mid' || s === 'medium') level = 1;
          else if (s.includes('high') || s === '2') level = 2;
        }
        if (window.AMADEUS.setPerfLevel) window.AMADEUS.setPerfLevel(level);
        const l2d = window.AMADEUS.state && window.AMADEUS.state.live2DController;
        if (l2d && l2d.setPerfLevel) l2d.setPerfLevel(level);
        if (window.AMADEUS.power && window.AMADEUS.power.applyPerfLevel) window.AMADEUS.power.applyPerfLevel();
        break;
      }
```

---

## 4. Back off news fetch while Lively is paused

**File:** `modules/news.js` → `scheduleNewsFetch`
**Change:** After fetch, choose interval based on pause state:

```js
  function scheduleNewsFetch() {
    setTimeout(async () => {
      const s = window.AMADEUS.state;
      let ok = true;
      if (s && !s.isLivelyPaused) ok = await fetchRealtimeNews();
      const next = (s && s.isLivelyPaused) ? 5 * 60 * 1000 : (ok ? NEWS_BASE_INTERVAL : Math.min(NEWS_MAX_INTERVAL, newsInterval * 2));
      newsInterval = next;
      scheduleNewsFetch();
    }, newsInterval);
  }
```

---

## 5. Skip gear snapshot rebuild when audio ring is hidden

**File:** `modules/audio-ring.js` → `buildGearSnapshot`
**Change:** Add early return:

```js
  function buildGearSnapshot() {
    if (document.body.classList.contains('hide-ring')) return;
    // ... existing code
  }
```

---

## 6. PixiJS resolution should respect `PERF.dpr`

**File:** `live2d_controller.js`
**Change:** In `initPixi()`:

```js
    this.app = new PIXI.Application({
      view: canvas,
      width: w,
      height: h,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, window.AMADEUS.PERF ? window.AMADEUS.PERF.dpr : 1),
      autoDensity: true,
    });
```

---

## 7. Verify font MIME types in Lively

No code change. Open Lively DevTools (Ctrl+Shift+I) → Network tab → reload wallpaper → filter by `font`. Confirm `.woff2` files return `200` with `font/woff2`. If they 404, Lively’s CEF web server may need `web_accessible_resources` or you may need `.woff` fallbacks.

---

## Files to modify

| File | Section |
|------|---------|
| `wallpaper.js` | `visualLoopTick` |
| `modules/lively.js` | `livelyWallpaperPlaybackChanged` |
| `modules/uplink.js` | add `closeCognitiveUplink`, export it |
| `modules/news.js` | `scheduleNewsFetch` |
| `modules/audio-ring.js` | `buildGearSnapshot` |
| `live2d_controller.js` | `initPixi` resolution |
