// tests/run-tests.mjs - AMADEUS HUD unit tests (node:test, zero dependencies).
//
// Loads browser IIFE modules into a node:vm sandbox with a minimal DOM/window
// stub, then exercises their exported pure functions. Run:  npm test
//
// Note: timers are stubbed so modules that schedule work at load time
// (e.g. news.js's fetch loop) never actually fire during tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = (f) => {
  const tsName = f.replace(/\.js$/, '.ts');
  const tsPath = path.join(ROOT, 'modules', tsName);
  if (fs.existsSync(tsPath)) return tsPath;
  return path.join(ROOT, 'src', 'modules', f);
};

function stubElement() {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  };
}

function makeSandbox(extra = {}) {
  const storage = new Map();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    performance: { now: () => Date.now() },
    devicePixelRatio: 1,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
    URL,
    AbortController,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => stubElement(),
      addEventListener() {},
      body: stubElement(),
      documentElement: { style: { setProperty() {} } },
      hidden: false,
    },
  };
  sandbox.window = sandbox;
  Object.assign(sandbox, extra);
  return { sandbox, storage };
}

function loadModule(sandbox, file) {
  let code = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.ts')) {
    code = esbuild.transformSync(code, { loader: 'ts', target: 'node18' }).code;
  }
  vm.runInContext(code, vm.createContext(sandbox), { filename: path.basename(file) });
}
// ---------------------------------------------------------------------------
test('tts.detectScriptLanguage detects Thai, Japanese and English', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('tts.js'));
  const detect = sandbox.window.AMADEUS.tts.detectScriptLanguage;
  assert.equal(detect('สวัสดีครับ'), 'th');
  assert.equal(detect('こんにちは、世界'), 'ja');
  assert.equal(detect('漢字とひらがな'), 'ja');
  assert.equal(detect('Hello there, Lab Member.'), 'en');
  assert.equal(detect(''), 'en');
  assert.equal(detect(null), 'en');
});

test('tts.pickBestWebSpeechVoice prefers female Kurisu-like voices and excludes male names', () => {
  const voices = [
    { name: 'Microsoft David', lang: 'en-US' },   // male — must be skipped
    { name: 'Microsoft Zira', lang: 'en-US' },    // Kurisu-preferred female
    { name: 'Microsoft Haruka', lang: 'ja-JP' },  // Japanese female
    { name: 'Microsoft Premwadee', lang: 'th-TH' },
  ];
  const { sandbox } = makeSandbox({
    speechSynthesis: { getVoices: () => voices },
  });
  loadModule(sandbox, MOD('tts.js'));
  const pick = sandbox.window.AMADEUS.tts.pickBestWebSpeechVoice;
  assert.equal(pick('en')?.name, 'Microsoft Zira');
  assert.equal(pick('ja')?.name, 'Microsoft Haruka');
  assert.equal(pick('th')?.name, 'Microsoft Premwadee');
});

test('tts.pickBestWebSpeechVoice falls back gracefully with no voices', () => {
  const { sandbox } = makeSandbox({ speechSynthesis: { getVoices: () => [] } });
  loadModule(sandbox, MOD('tts.js'));
  assert.equal(sandbox.window.AMADEUS.tts.pickBestWebSpeechVoice('en'), null);
});

// ---------------------------------------------------------------------------
// state.js — net indicator + safeSetItem
// ---------------------------------------------------------------------------
test('AMADEUS.net flips offline after repeated failures and recovers on success', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  const net = sandbox.window.AMADEUS.net;
  assert.equal(typeof net, 'object');
  assert.equal(net.isNetOnline(), true);
  net.reportNetFailure(); // 1st failure: threshold not reached
  assert.equal(net.isNetOnline(), true);
  net.reportNetFailure(); // 2nd failure: flips offline
  assert.equal(net.isNetOnline(), false);
  net.reportNetSuccess();
  assert.equal(net.isNetOnline(), true);
});

test('safeSetItem trims caches and retries on quota error', () => {
  const { sandbox } = makeSandbox();
  // Storage that is "full": writes fail with a quota error until the evictable
  // cache entries are removed (simulating space reclaimed by the trim).
  const backing = new Map();
  const quotaErr = Object.assign(new Error('too big'), { name: 'QuotaExceededError' });
  sandbox.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => {
      if (backing.has('amadeus.chatLog') && k !== 'amadeus.chatLog') throw quotaErr;
      backing.set(k, String(v));
    },
    removeItem: (k) => backing.delete(k),
  };
  loadModule(sandbox, MOD('state.js'));
  // Seed the evictable cache key — storage is now "full"
  sandbox.localStorage.setItem('amadeus.chatLog', 'cached-chat-payload');
  // Write while "full": quota error → evict chatLog → retry succeeds
  assert.equal(sandbox.window.AMADEUS.safeSetItem('amadeus.settings', '{"v":1}'), true);
  assert.equal(backing.get('amadeus.settings'), '{"v":1}');
  assert.equal(backing.has('amadeus.chatLog'), false);
});

// Controllable clock for vm-context modules. focus.ts (and others) call both
// Date.now() and `new Date()`, so the fake must be a real constructor whose
// instances read the current fake time and support setHours/setTime/getTime.
function makeFakeClock(sandbox, startNow = Date.now()) {
  let now = startNow;
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() { return now; }
  }
  sandbox.Date = FakeDate;
  return {
    advance: (ms) => { now += ms; },
    set: (v) => { now = v; },
    get: () => now,
  };
}

// ---------------------------------------------------------------------------
// focus.js — Pomodoro state machine
// ---------------------------------------------------------------------------
test('focus.start begins a session and _tick advances it to completion', () => {
  const { sandbox } = makeSandbox();
  // Modules run inside a vm context with their own intrinsics, so inject a
  // controllable clock as the sandbox's Date (shadows the context intrinsic).
  const clock = makeFakeClock(sandbox);
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('focus.js'));
  const focus = sandbox.window.AMADEUS.focus;
  assert.equal(focus.getPhase(), 'idle');
  assert.equal(focus.start(), true);
  assert.equal(focus.getPhase(), 'focus');
  assert.equal(focus.isActive(), true);
  // Ticking while still in session keeps it running
  focus._tick();
  assert.equal(focus.getPhase(), 'focus');
  // Jump the clock past the 25-minute horizon
  clock.advance(26 * 60 * 1000);
  focus._tick(); // focus expires → break phase begins
  assert.equal(focus.getPhase(), 'break');
  clock.advance(6 * 60 * 1000);
  focus._tick(); // break expires → idle
  assert.equal(focus.getPhase(), 'idle');
  assert.equal(focus.isActive(), false);
});

test('focus.cancel stops an active session and start respects the feature flag', () => {
  const { sandbox } = makeSandbox();
  makeFakeClock(sandbox);
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('focus.js'));
  const focus = sandbox.window.AMADEUS.focus;
  focus.start();
  assert.equal(focus.cancel(), true);
  assert.equal(focus.getPhase(), 'idle');
  // Disabled flag: start must refuse
  focus.setFeatureEnabled(false);
  assert.equal(focus.start(), false);
  focus.setFeatureEnabled(true);
  assert.equal(focus.start(), true);
});

test('focus history persists completed sessions and exposes today count + streak', () => {
  const { sandbox, storage } = makeSandbox();
  const clock = makeFakeClock(sandbox);
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('focus.js'));
  const focus = sandbox.window.AMADEUS.focus;
  assert.equal(focus.getTodayCount(), 0);
  assert.equal(focus.getStreak(), 0);

  // Complete one focus session
  focus.start();
  clock.advance(26 * 60 * 1000);
  focus._tick(); // → break
  clock.advance(6 * 60 * 1000);
  focus._tick(); // → idle, session recorded
  assert.equal(focus.getTodayCount(), 1);
  assert.equal(focus.getStreak(), 1);
  assert.equal(JSON.parse(storage.get('amadeus.focus.history')).length, 1);

  // A fresh module instance (simulating a reload) restores the history
  loadModule(sandbox, MOD('focus.js'));
  assert.equal(sandbox.window.AMADEUS.focus.getTodayCount(), 1);

  // A session completed yesterday still counts toward the streak even with
  // nothing done today, but not toward today's count.
  const yesterday = clock.get() - 24 * 60 * 60 * 1000;
  storage.set('amadeus.focus.history', JSON.stringify([yesterday]));
  loadModule(sandbox, MOD('focus.js'));
  assert.equal(sandbox.window.AMADEUS.focus.getTodayCount(), 0);
  assert.equal(sandbox.window.AMADEUS.focus.getStreak(), 1);

  // Nothing for days → streak broken
  storage.set('amadeus.focus.history', JSON.stringify([clock.get() - 3 * 24 * 60 * 60 * 1000]));
  loadModule(sandbox, MOD('focus.js'));
  assert.equal(sandbox.window.AMADEUS.focus.getStreak(), 0);
});

// ---------------------------------------------------------------------------
// state.js — per-source net indicator + pickFreshLine dedup
// ---------------------------------------------------------------------------
test('net.setSource tracks web and brain independently', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  const net = sandbox.window.AMADEUS.net;
  assert.equal(net.isNetOnline(), true);

  // Definitive brain outage (immediate: WebSocket close) takes it down
  net.setSource('brain', false, { immediate: true });
  assert.equal(net.isNetOnline(), false);
  // A healthy web fetch does NOT restore overall status while brain is down
  net.reportNetSuccess();
  assert.equal(net.isNetOnline(), false);
  // Brain back → fully online
  net.setSource('brain', true);
  assert.equal(net.isNetOnline(), true);

  // Polled web fetches need repeated failures (threshold 2) to flip
  net.setSource('web', false);
  assert.equal(net.isNetOnline(), true);
  net.setSource('web', false);
  assert.equal(net.isNetOnline(), false);
  // One success recovers
  net.reportNetSuccess();
  assert.equal(net.isNetOnline(), true);
});

test('pickFreshLine avoids recently used lines while unseen options remain', () => {
  const { sandbox, storage } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  const pick = sandbox.window.AMADEUS.pickFreshLine;
  const pool = ['alpha', 'beta', 'gamma'];
  // Seed the seen-ring with 'alpha' → the first pick must avoid it
  storage.set('amadeus.seenLines', JSON.stringify({ idle: ['alpha'] }));
  assert.notEqual(pick('idle', pool), 'alpha');
  // Once the ring saturates (whole pool seen) repeats become unavoidable,
  // but two consecutive picks must never be the same line
  let prev = pick('idle', pool);
  for (let i = 0; i < 60; i++) {
    const cur = pick('idle', pool);
    assert.notEqual(cur, prev);
    prev = cur;
  }
  // Mark everything seen → the ring saturates and the pool still yields lines
  storage.set('amadeus.seenLines', JSON.stringify({ idle: pool }));
  const picks = new Set();
  for (let i = 0; i < 30; i++) picks.add(pick('idle', pool));
  assert.ok(picks.size >= 1);
  // Degenerate inputs
  assert.equal(pick('x', []), '');
  assert.equal(pick('x', ['solo']), 'solo');
});

// ---------------------------------------------------------------------------
// divergence.js — task-progress world line nudge
// ---------------------------------------------------------------------------
test('divergence.applyTaskNudge bends the target toward the Steins Gate line', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  sandbox.performance = { now: () => 1e12 };
  loadModule(sandbox, MOD('divergence.js'));
  const div = sandbox.window.AMADEUS.divergence;
  const NOW = 1e12 + 20000; // past the initial mood-sync + jitter horizons

  // One tick lets the mood baseline pull the target off 1.048596
  div.updateDivergence(NOW);
  let settled = 0;
  for (let i = 0; i < 300; i++) {
    div.updateDivergence(NOW);
    settled = div.getDivergence();
  }

  // Full progress nudge → the meter drifts upward toward 1.048596
  div.applyTaskNudge(1);
  for (let i = 0; i < 300; i++) div.updateDivergence(NOW);
  assert.ok(div.getDivergence() > settled,
    `expected divergence above ${settled}, got ${div.getDivergence()}`);

  // Degenerate inputs are clamped/no-ops (must not throw or crash)
  div.applyTaskNudge(0);
  div.applyTaskNudge(-5);
  div.applyTaskNudge(999);
  div.applyTaskNudge('not-a-number');
});

// ---------------------------------------------------------------------------
// task-widget.js — praise pool wiring (bubble chatter consumes getTasks)
// ---------------------------------------------------------------------------
test('task-widget exposes getTasks for bubble chatter and widget init', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('bubble.js'));
  loadModule(sandbox, MOD('task-widget.js'));
  assert.equal(typeof sandbox.window.AMADEUS.taskWidget.getTasks, 'function');
  // Task list starts empty in the sandbox (no init fetch); the contract is
  // that it is always an array so bubble.ts chatter can safely consume it.
  assert.ok(Array.isArray(sandbox.window.AMADEUS.taskWidget.getTasks()));
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// oscilloscope.js — hexToRgb
// ---------------------------------------------------------------------------
test('oscilloscope.hexToRgb parses hex colors and rejects malformed input', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('oscilloscope.js'));
  const hexToRgb = sandbox.window.AMADEUS.oscilloscope.hexToRgb;
  assert.deepEqual({ ...hexToRgb('#ff4d55') }, { r: 255, g: 77, b: 85 });
  assert.deepEqual({ ...hexToRgb('#FF55AA') }, { r: 255, g: 85, b: 170 });
  assert.deepEqual({ ...hexToRgb('ff4d55') }, { r: 255, g: 77, b: 85 });
  assert.equal(hexToRgb('#12345'), null);
  assert.equal(hexToRgb('not-a-color'), null);
  assert.equal(hexToRgb(''), null);
  assert.equal(hexToRgb(null), null);
});

// ---------------------------------------------------------------------------
// audio-ring.js — freqColor gradient
// ---------------------------------------------------------------------------
test('audioRing.freqColor maps the normalized spectrum to crimson→violet→pink', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('audio-ring.js'));
  const c = sandbox.window.AMADEUS.audioRing.freqColor;
  assert.deepEqual({ ...c(0) }, { r: 255, g: 77, b: 85 });      // crimson base
  assert.deepEqual({ ...c(0.25) }, { r: 255, g: 166, b: 170 }); // halfway to white
  assert.deepEqual({ ...c(0.5) }, { r: 255, g: 255, b: 255 });  // white pivot
  assert.deepEqual({ ...c(1) }, { r: 255, g: 85, b: 170 });     // pink end
});

// ---------------------------------------------------------------------------
// news.js — feed helpers
// ---------------------------------------------------------------------------
test('news.timeSince formats seconds/minutes/hours', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('news.js'));
  const t = sandbox.window.AMADEUS.news.timeSince;
  const now = Date.now() / 1000;
  assert.equal(t(now - 45), '45s');
  assert.equal(t(now - 90), '1m');
  assert.equal(t(now - 600), '10m');
  assert.equal(t(now - 7200), '2h');
  assert.equal(t(now + 5), '0s');
});

test('news.getCleanDomainTag maps known domains and falls back cleanly', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('news.js'));
  const tag = sandbox.window.AMADEUS.news.getCleanDomainTag;
  assert.equal(tag('https://github.com/foo/bar', 'x'), 'GITHUB');
  assert.equal(tag('https://arxiv.org/abs/1234', 'x'), 'ARXIV');
  assert.equal(tag('https://www.nature.com/articles/abc', 'x'), 'SCIENCE');
  assert.equal(tag('https://microsoft.com/blog', 'x'), 'MICROSOFT'); // www stripped, host tag
  assert.equal(tag(undefined, 'x'), 'LAB_MEMO');
  assert.equal(tag('', 'x'), 'LAB_MEMO');
});

test('news.isStoryRelevant filters out drama/politics, keeps science/tech', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('news.js'));
  const rel = sandbox.window.AMADEUS.news.isStoryRelevant;
  assert.equal(rel(null), false);
  assert.equal(rel({ title: 'Quantum error correction hits a new milestone' }), true);
  assert.equal(rel({ title: 'New neuroscience study maps synaptic weights' }), true);
  assert.equal(rel({ title: 'The election results and political drama of the week' }), false);
  assert.equal(rel({ title: 'Tenant landlord lawsuit filed over apartment' }), false);
});

// ---------------------------------------------------------------------------
// state.js — brainClient URL helpers & frozen defaults
// ---------------------------------------------------------------------------
test('brainClient builds http/ws URLs from the chat brain endpoint', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  sandbox.window.AMADEUS.chat = { KURISU_BRAIN: { endpoint: 'http://127.0.0.1:8000' } };
  const client = sandbox.window.AMADEUS.brainClient;
  assert.equal(client.getHttpUrl('/api/v1/vault/tasks/today'), 'http://127.0.0.1:8000/api/v1/vault/tasks/today');
  assert.equal(client.getHttpUrl('api'), 'http://127.0.0.1:8000/api');
  assert.equal(client.getHttpUrl(), 'http://127.0.0.1:8000');
  assert.equal(client.getWsUrl('/ws/amadeus'), 'ws://127.0.0.1:8000/ws/amadeus');

  sandbox.window.AMADEUS.chat.KURISU_BRAIN.endpoint = 'https://brain.example.com/';
  assert.equal(client.getWsUrl('/ws'), 'wss://brain.example.com/ws');
  assert.equal(client.getHttpUrl('/api'), 'https://brain.example.com/api');
});

test('brainClient falls back to the default localhost endpoint', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  const client = sandbox.window.AMADEUS.brainClient;
  assert.equal(client.getHttpUrl('/api'), 'http://127.0.0.1:8000/api');
});

test('SETTINGS_DEFAULTS is deep-frozen so defaults can never be mutated', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  const d = sandbox.window.AMADEUS.SETTINGS_DEFAULTS;
  assert.equal(Object.isFrozen(d), true);
  assert.equal(Object.isFrozen(d.widgets), true);
  assert.equal(Object.isFrozen(d.scope), true);
  assert.equal(Object.isFrozen(d.features), true);
});

// ---------------------------------------------------------------------------
// lively.js — property value validators
// ---------------------------------------------------------------------------
test('lively.toBoolean coerces Lively property values with a default', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('lively.js'));
  const b = sandbox.window.AMADEUS.lively.toBoolean;
  assert.equal(b(true), true);
  assert.equal(b(false), false);
  assert.equal(b(1), true);
  assert.equal(b(0), false);
  assert.equal(b('true'), true);
  assert.equal(b('TRUE'), true);
  assert.equal(b(' on '), true);
  assert.equal(b('no'), false);
  assert.equal(b('0'), false);
  assert.equal(b('junk', true), true);
  assert.equal(b(undefined, false), false);
});

test('lively.toNumber parses and clamps with a default', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('lively.js'));
  const n = sandbox.window.AMADEUS.lively.toNumber;
  assert.equal(n('42', 0, 100, 5), 42);
  assert.equal(n(42, 0, 100, 5), 42);
  assert.equal(n('150', 0, 100, 5), 100);
  assert.equal(n('-3', 0, 100, 5), 0);
  assert.equal(n('abc', 0, 100, 5), 5);
  assert.equal(n(NaN, 0, 100, 5), 5);
  assert.equal(n(7.5), 7.5);
});

// ---------------------------------------------------------------------------
// chat-api.js — reply sanitization & emotion inference
// ---------------------------------------------------------------------------
test('chat.cleanReply strips model artifacts from LLM replies', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('chat-api.js'));
  const clean = sandbox.window.AMADEUS.chat.cleanReply;
  assert.equal(clean('(emotion: happy) Fascinating data.'), 'Fascinating data.');
  assert.equal(clean('Kurisu: Hello there, Lab Member.'), 'Hello there, Lab Member.');
  assert.equal(clean('[Amadeus] System nominal.'), 'System nominal.');
  assert.equal(clean('Trailing (emotion: angry'), 'Trailing');
  assert.equal(clean(null), '');
  assert.equal(clean('  '), '');
});

test('chat.emotionFromText keyword-maps wording to emotion labels', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('chat-api.js'));
  const emo = sandbox.window.AMADEUS.chat.emotionFromText;
  assert.equal(emo('Wow, that is amazing!'), 'surprised');
  assert.equal(emo('I miss the old lab... so sad.'), 'sad');
  assert.equal(emo('You idiot! That is annoying.'), 'annoyed');
  assert.equal(emo('That makes me happy, glad you laughed.'), 'happy');
  assert.equal(emo('Hmm, maybe the data supports the theory.'), 'thinking');
  assert.equal(emo('A perfectly ordinary sentence.'), 'content');
});

// ---------------------------------------------------------------------------
// settings.js — one-shot legacy color migration & defaults isolation
// ---------------------------------------------------------------------------
test('settings migrates legacy palette colors exactly once', () => {
  const { sandbox, storage } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('settings.js'));
  const settingsMod = sandbox.window.AMADEUS.settings;

  storage.set('amadeus.settings', JSON.stringify({
    scope: { ch1: '#39ff7a', ch2: '#b388ff' },
  }));

  // First load: legacy green/violet are migrated to the Amadeus red palette.
  const migrated = settingsMod.loadSettings();
  assert.equal(migrated.scope.ch1, '#ff4d55');
  assert.equal(migrated.scope.ch2, '#ff55aa');
  assert.equal(storage.get('amadeus.colorMigrationV1'), '1');

  // A user who deliberately picks the legacy color afterwards keeps it.
  storage.set('amadeus.settings', JSON.stringify({
    scope: { ch1: '#39ff7a', ch2: '#b388ff' },
  }));
  const second = settingsMod.loadSettings();
  assert.equal(second.scope.ch1, '#39ff7a');
  assert.equal(second.scope.ch2, '#b388ff');
});

test('settings deep-clones defaults so the shared schema is never mutated', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('settings.js'));
  const s = sandbox.window.AMADEUS.settings.loadSettings();
  s.widgets.clock = false;
  s.scope.speed = 99;
  assert.equal(sandbox.window.AMADEUS.SETTINGS_DEFAULTS.widgets.clock, true);
  assert.equal(sandbox.window.AMADEUS.SETTINGS_DEFAULTS.scope.speed, 5);
});

// ---------------------------------------------------------------------------
// mood.js — mood math, drift decay, and HUD tint blending
// ---------------------------------------------------------------------------

test('mood.moodDeltaForEmotion returns known deltas and defaults to 1', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  assert.equal(mood.moodDeltaForEmotion('happy'), 3);
  assert.equal(mood.moodDeltaForEmotion('content'), 2);
  assert.equal(mood.moodDeltaForEmotion('thinking'), 1);
  assert.equal(mood.moodDeltaForEmotion('annoyed'), -2);
  assert.equal(mood.moodDeltaForEmotion('angry'), -3);
  assert.equal(mood.moodDeltaForEmotion('unknown_emotion'), 1);
});

test('mood.adjustMood clamps to 5-95 and persists to localStorage', () => {
  const { sandbox, storage } = makeSandbox();
  // saveMood persists through the 600ms debounced storage writer; capture the
  // pending debounce callbacks so we can flush them like a fired timer.
  const debouncedWrites = [];
  sandbox.setTimeout = (fn) => { debouncedWrites.push(fn); return debouncedWrites.length; };
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;

  assert.equal(s.mood, 55);

  mood.adjustMood(10);
  assert.equal(s.mood, 65);

  s.mood = 90;
  mood.adjustMood(20);
  assert.equal(s.mood, 95);

  s.mood = 50;
  mood.adjustMood(-20);
  assert.equal(s.mood, 30);

  s.mood = 10;
  mood.adjustMood(-20);
  assert.equal(s.mood, 5);

  // Flush the pending debounced write (scheduleStorageWrite coalesces while a
  // timer is pending, so exactly one callback carries the final value).
  assert.ok(debouncedWrites.length >= 1, 'adjustMood should schedule a storage write');
  debouncedWrites.forEach((fn) => fn());
  const saved = JSON.parse(storage.get('amadeus.mood'));
  assert.equal(saved.value, 5);
});

test('mood.adjustMood syncs the new mood value to the Live2D controller', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const l2d = { setMood(val) { l2d.lastMood = val; } };
  sandbox.window.AMADEUS.state.live2DController = l2d;

  mood.adjustMood(15);
  assert.equal(l2d.lastMood, 70);
});

test('mood.driftMood pulls warm mood down and cold mood up toward 55', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;

  // Sandbox performance.now() is Date.now()-based; the outer Node
  // performance.now() runs on a different epoch and would make elapsed time
  // compute as ~1.7e12 ms. Always build timestamps from the sandbox clock.
  s.mood = 80;
  s.moodLastAdjustAt = Date.now() - 10 * 60 * 1000;
  mood.driftMood();
  assert.equal(s.mood, 77);

  s.mood = 30;
  s.moodLastAdjustAt = Date.now() - 20 * 60 * 1000;
  mood.driftMood();
  assert.equal(s.mood, 35);
});

test('mood.driftMood ignores sub-threshold elapsed time', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;

  s.mood = 80;
  s.moodLastAdjustAt = Date.now() - 60 * 1000;
  mood.driftMood();
  assert.equal(s.mood, 80);
});

test('mood.driftMood initializes moodLastAdjustAt when missing', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;

  s.moodLastAdjustAt = 0;
  mood.driftMood();
  assert.ok(s.moodLastAdjustAt > 0);
  assert.equal(s.mood, 55);
});

test('mood.loadMood restores persisted mood and clamps to 5-95', () => {
  const { sandbox, storage } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;

  storage.set('amadeus.mood', JSON.stringify({ value: 72, at: 1000 }));
  mood.loadMood();
  assert.equal(s.mood, 72);

  storage.set('amadeus.mood', JSON.stringify({ value: 150, at: 1000 }));
  mood.loadMood();
  assert.equal(s.mood, 95);

  storage.set('amadeus.mood', JSON.stringify({ value: -10, at: 1000 }));
  mood.loadMood();
  assert.equal(s.mood, 5);
});

test('mood.loadMood ignores corrupt localStorage and keeps default', () => {
  const { sandbox, storage } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;

  storage.set('amadeus.mood', 'not-json');
  mood.loadMood();
  assert.equal(s.mood, 55);
});

test('mood.updateEmotionTint writes CSS vars and stops writing once converged', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;
  const calls = [];
  sandbox.document.documentElement.style.setProperty = (name, value) => {
    calls.push([name, value]);
  };

  s.mood = 80;
  sandbox.window.AMADEUS.state.live2DController = { currentEmotion: 'happy' };

  mood.updateEmotionTint();
  assert.equal(calls.length, 4);
  assert.equal(calls[0][0], '--hud-emote-r');
  assert.equal(calls[1][0], '--hud-emote-g');
  assert.equal(calls[2][0], '--hud-emote-b');
  assert.equal(calls[3][0], '--hud-emote-glow');

  // The tint eases 8% toward its target per call, so early ticks legitimately
  // keep writing as the rounded values move. Run until the rounded output
  // settles, then verify settled state no longer touches the DOM.
  const writesAfterFirstTick = calls.length;
  for (let i = 0; i < 300; i++) mood.updateEmotionTint();
  assert.ok(calls.length > writesAfterFirstTick, 'tint should keep easing toward its target');
  const settledWrites = calls.length;
  for (let i = 0; i < 50; i++) mood.updateEmotionTint();
  assert.equal(calls.length, settledWrites, 'converged tint should not write CSS vars again');
});

test('mood.updateEmotionTint cools the tint when mood is low', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('mood.js'));
  const mood = sandbox.window.AMADEUS.mood;
  const s = sandbox.window.AMADEUS.state;
  const calls = [];
  sandbox.document.documentElement.style.setProperty = (name, value) => {
    calls.push([name, value]);
  };
  const lastRed = () => {
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i][0] === '--hud-emote-r') return Number(calls[i][1]);
    }
    return NaN;
  };
  // Ease fully to the target so we compare settled colors, not mid-ease ticks.
  const converge = () => { for (let i = 0; i < 400; i++) mood.updateEmotionTint(); };

  s.mood = 80;
  sandbox.window.AMADEUS.state.live2DController = { currentEmotion: 'happy' };
  converge();
  const warmR = lastRed();

  calls.length = 0;
  s.mood = 20;
  converge();
  const coldR = lastRed();

  assert.ok(Number(coldR) < Number(warmR), `cold mood red ${coldR} should be < warm mood red ${warmR}`);
});

// ---------------------------------------------------------------------------
// Smoke: sources must be clean UTF-8 with no double-encoded (mojibake)
// sequences. Editors saving in Windows-1252/Latin-1 produce artifacts like
// "â€”" (U+2014 double-encoded) or "Â°C" (U+00B0 preceded by a stray U+00C2)
// that render as garbage in the HUD and corrupt user-visible strings.
// Legit non-ASCII (—, °, arrows, emoji, Japanese voice lines) is unaffected.
// ---------------------------------------------------------------------------
test('smoke: no mojibake (double-encoded UTF-8) in user-facing sources', () => {
  // Typical Windows-1252 misread sequences: â€œ â€ "" â€™ (U+00E2 U+20AC..)
  // and the Latin-1 stray-uppercase prefix: Â before °, ©, £, etc.
  const mojibake = /[\u00C2\u00C3\u00E2][\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;

  const bad = [];
  for (const f of ['index.html', 'style.css', 'src/wallpaper.js', 'src/live2d_controller.js', 'package.json']) {
    const m = fs.readFileSync(path.join(ROOT, f), 'utf8').match(mojibake);
    if (m) bad.push(`${f}: ${JSON.stringify(m[0])}`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'modules'))) {
    if (!f.endsWith('.js')) continue;
    const m = fs.readFileSync(path.join(ROOT, 'modules', f), 'utf8').match(mojibake);
    if (m) bad.push(`modules/${f}: ${JSON.stringify(m[0])}`);
  }
  assert.deepEqual(bad, [], `mojibake sequences found (file was likely saved in Windows-1252):\n${bad.join('\n')}`);
});

// ---------------------------------------------------------------------------
// Smoke: every source file must COMPILE. A single duplicate declaration or
// stray token kills the entire IIFE (or the whole wallpaper bootstrap) at
// parse time, which no function-level test can detect.
// ---------------------------------------------------------------------------
test('smoke: all source JS files compile without syntax errors', () => {
  const files = [];
  for (const dir of ['src', 'src/modules']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.js')) continue;
      const full = path.join(ROOT, dir, f);
      if (!fs.statSync(full).isFile()) continue;
      // Skip Node/ESM tooling (playwright.config.js, etc.): these are parsed by
      // Node's module system, not the browser classic-script loader this guard
      // protects. Detect top-level ESM import/export statements.
      if (/^\s*(import\s|export\s)/m.test(fs.readFileSync(full, 'utf8'))) continue;
      files.push(full);
    }
  }
  assert.ok(files.length >= 20, `expected to scan real sources, found ${files.length}`);

  const failures = [];
  for (const file of files) {
    try {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.basename(file) });
    } catch (err) {
      failures.push(`${path.relative(ROOT, file)}: ${err.message}`);
    }
  }
  assert.deepEqual(failures, [], `syntax errors found:\n${failures.join('\n')}`);
});

// ---------------------------------------------------------------------------
// Smoke: every static id referenced via getElementById in the sources must
// exist in index.html. Markup drift otherwise turns features (status lines,
// telemetry readouts) into silent no-ops.
// ---------------------------------------------------------------------------
test('smoke: DOM ids referenced in modules exist in index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

  const missing = [];
  const refRe = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const dir of ['src', 'src/modules']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.js')) continue;
      const full = path.join(ROOT, dir, f);
      if (!fs.statSync(full).isFile()) continue;
      const rel = path.relative(ROOT, full).replace(/\\/g, '/');
      for (const m of fs.readFileSync(full, 'utf8').matchAll(refRe)) {
        const id = m[1];
        if (!htmlIds.has(id)) {
          missing.push(`${rel} -> "${id}"`);
        }
      }
    }
  }
  assert.ok(htmlIds.size > 50, `index.html markup scan found only ${htmlIds.size} ids`);
  assert.deepEqual(missing, [], `ids referenced but missing from index.html:\n${missing.join('\n')}`);
});
// ---------------------------------------------------------------------------
// uplink.js — close() idempotency & reconnect guard.
// Contract: close() must (1) not throw when called repeatedly, (2) clear any
// pending reconnect timer, (3) make a late onclose event a no-op for reconnect,
// and (4) allow re-init afterwards (Lively resume path).
// ---------------------------------------------------------------------------
test('uplink.close() is idempotent, blocks reconnect, and allows re-init', () => {
  const created = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.onopen = null; this.onclose = null; created.push(this); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
    send() {}
  }
  FakeWS.OPEN = 1;
  FakeWS.CONNECTING = 0;

  // Count setTimeout calls — scheduleReconnect() is the ONLY setTimeout
  // consumer in the reconnect path, so any call here means reconnect armed.
  let timerCalls = 0;
  const { sandbox } = makeSandbox({
    WebSocket: FakeWS,
    setTimeout: () => { timerCalls++; return 0; },
  });
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('uplink.js'));
  const A = sandbox.window.AMADEUS;
  A.brainClient = { getWsUrl: (p) => 'ws://amadeus.test' + p };

  A.uplink.init();
  assert.equal(created.length, 1);
  created[0].readyState = FakeWS.OPEN;

  // 1) Unintentional close while connected => reconnect IS scheduled.
  created[0].onclose();
  assert.equal(timerCalls, 1, 'unintentional close must arm the reconnect timer');

  // 2) Intentional close: idempotent, and a late onclose must NOT reconnect.
  A.uplink.close();
  A.uplink.close(); // second call must not throw
  created[0].onclose(); // stale close event after teardown
  assert.equal(timerCalls, 1, 'intentional close must prevent reconnect scheduling');

  // 3) Re-init after close opens a fresh socket (Lively resume path).
  A.uplink.init();
  assert.equal(created.length, 2);
  assert.equal(created[1].url, 'ws://amadeus.test/ws/amadeus');
});

// ---------------------------------------------------------------------------
// chat-api.js — history trimming for the LLM context window.
// The message builder must cap the conversation at KURISU_HISTORY_MAX turns
// (max*2 messages), keep the most recent turns, and pass small/empty history
// through untouched. This locks in the shared-CHAT_LIMITS fix (C2) forever.
// ---------------------------------------------------------------------------
test('chat.buildHistoryMessages bounds context to CHAT_LIMITS.KURISU_HISTORY_MAX turns', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('chat-api.js'));
  const A = sandbox.window.AMADEUS;
  const max = A.CHAT_LIMITS.KURISU_HISTORY_MAX;
  assert.ok(max > 0);

  // 3x the limit -> must be trimmed back to max*2 turns.
  const many = [];
  for (let i = 0; i < max * 3; i++) {
    many.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` });
  }
  const messages = A.chat.buildHistoryMessages(many, 'hello kurisu');
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[messages.length - 1].role, 'user');
  assert.equal(messages[messages.length - 1].content, 'hello kurisu');
  const historyLen = messages.length - 2;
  assert.ok(historyLen <= max * 2, `history should be capped at ${max * 2}, got ${historyLen}`);
  // Keeps the MOST RECENT turns (tail of the list), not the oldest.
  assert.equal(messages[1].content, `turn ${max * 3 - max * 2}`);

  // Small history passes through untouched.
  const small = A.chat.buildHistoryMessages([{ role: 'user', content: 'hi' }], 'yo');
  assert.equal(small.length, 3);
  assert.equal(small[1].content, 'hi');

  // Empty history -> just system + user.
  const empty = A.chat.buildHistoryMessages([], 'yo');
  assert.equal(empty.length, 2);
  assert.equal(empty[1].role, 'user');
});
// ---------------------------------------------------------------------------
// weather.js — city extraction from wttr.in payloads.
// Guards the /weather "in <city>" fix (M2): nearest_area.areaName[0].value is
// used when present, otherwise the 'Local Area' fallback.
// ---------------------------------------------------------------------------
test('weather.fetchWeather extracts city from nearest_area', async () => {
  const { sandbox } = makeSandbox({
    fetch: async () => ({
      ok: true,
      json: async () => ({
        current_condition: [{ temp_C: '21', humidity: '55', weatherDesc: [{ value: 'Partly cloudy' }] }],
        nearest_area: [{ areaName: [{ value: 'Akihabara' }] }],
      }),
    }),
  });
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('weather.js'));
  await sandbox.window.AMADEUS.weather.fetchWeather();
  const w = sandbox.window.AMADEUS.state.weather;
  assert.equal(w.city, 'Akihabara');
  assert.equal(w.condition, 'Partly cloudy');
  assert.equal(w.temp_C, '21');
  assert.equal(w.isCloudy, true);
  assert.equal(w.isSunny, false);
});

test('weather.fetchWeather falls back to "Local Area" when nearest_area is missing', async () => {
  const { sandbox } = makeSandbox({
    fetch: async () => ({
      ok: true,
      json: async () => ({
        current_condition: [{ temp_C: '26', humidity: '50', weatherDesc: [{ value: 'Clear' }] }],
      }),
    }),
  });
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('weather.js'));
  await sandbox.window.AMADEUS.weather.fetchWeather();
  const w = sandbox.window.AMADEUS.state.weather;
  assert.equal(w.city, 'Local Area');
  assert.equal(w.isSunny, true);
});

// ---------------------------------------------------------------------------
// power.js — perf profile mapping + governor manual-mode override.
// Contract: applyPerfLevel() maps PERF_LEVELS dpr/visualFps onto PERF and
// notifies subsystems (audio ring, oscilloscope, Live2D). The FPS auto-governor
// must NOT change the level while state.perfLevelManual is set.
// ---------------------------------------------------------------------------
test('power.applyPerfLevel maps PERF_LEVELS dpr/visualFps and notifies subsystems', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('power.js'));
  const A = sandbox.window.AMADEUS;
  const notices = [];
  A.audioRing = { getResizeCallback: () => () => notices.push('ring') };
  A.oscilloscope = { getResizeCallback: () => () => notices.push('scope') };
  A.state.live2DController = { setPerfLevel: (lvl) => notices.push('l2d:' + lvl) };

  A.setPerfLevel(0); A.power.applyPerfLevel();
  assert.equal(A.PERF.dpr, 0.5);
  assert.equal(A.PERF.visualFps, 15);

  A.setPerfLevel(1); A.power.applyPerfLevel();
  assert.equal(A.PERF.dpr, 0.75);
  assert.equal(A.PERF.visualFps, 20);

  A.setPerfLevel(2); A.power.applyPerfLevel();
  assert.equal(A.PERF.dpr, 1.0);
  assert.equal(A.PERF.visualFps, 30);

  assert.ok(notices.includes('ring'), 'audio ring resize callback should fire');
  assert.ok(notices.includes('scope'), 'oscilloscope resize callback should fire');
  assert.ok(notices.includes('l2d:0') && notices.includes('l2d:2'), 'Live2D should receive each level');
});

test('power governor skips auto-adjust while perfLevelManual is set', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('power.js'));
  const A = sandbox.window.AMADEUS;
  const ticks = [];
  A.onMasterTick = (cb) => { ticks.push(cb); return cb; };

  // MANUAL mode: brutal sustained low FPS must NOT change the level.
  A.setPerfLevel(2);
  A.state.perfLevelManual = true;
  A.power.startPerfGovernor();
  assert.equal(ticks.length, 1, 'governor registers a single master-tick callback');
  let now = Date.now();
  for (let i = 0; i < 8; i++) { now += 1500; ticks[0](now); }
  assert.equal(A.getPerfLevel(), 2, 'perfLevelManual must block auto-downgrade');

  // Same samples WITHOUT manual mode => governor downgrades to the minimum.
  A.state.perfLevelManual = false;
  now = Date.now();
  for (let i = 0; i < 8; i++) { now += 1500; ticks[0](now); }
  assert.equal(A.getPerfLevel(), 0, 'governor should downgrade to min on sustained low FPS');
});

// ---------------------------------------------------------------------------
// Memory-leak prevention: timer/RAF cleanup
// ---------------------------------------------------------------------------

test('clock.initClock starts a 1s interval and stopClock clears it', () => {
  const { sandbox, storage } = makeSandbox();
  const timers = [];
  let timerIdCounter = 1;
  sandbox.setInterval = (fn, ms) => { const id = timerIdCounter++; timers[id] = fn; return id; };
  sandbox.clearInterval = (id) => { timers[id] = null; };

  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('clock.js'));
  const clock = sandbox.window.AMADEUS.clock;

  // Stub DOM elements
  sandbox.document.getElementById = (id) => {
    if (id === 'hud-clock') {
      return {
        querySelectorAll: () => [{ dataset: {}, classList: { remove() {}, add() {} }, innerText: '' }],
        classList: { remove() {}, add() {} },
      };
    }
    if (id === 'hud-date') return { innerText: '' };
    return null;
  };

  clock.initClock();
  const clockTimerIds = Object.keys(timers).map(Number);
  assert.ok(clockTimerIds.length > 0, 'initClock should schedule an interval');
  const clockTimerId = clockTimerIds[0];
  clock.stopClock();
  assert.equal(timers[clockTimerId], null, 'stopClock should clear the interval');
});

test('oscilloscope.initWorldLine starts a 500ms meta interval and stopWorldLineMeta clears it', () => {
  const { sandbox, storage } = makeSandbox();
  const timers = [];
  let timerIdCounter = 1;
  sandbox.setInterval = (fn, ms) => { const id = timerIdCounter++; timers[id] = fn; return id; };
  sandbox.clearInterval = (id) => { timers[id] = null; };

  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('oscilloscope.js'));
  const osc = sandbox.window.AMADEUS.oscilloscope;

  // Stub DOM elements
  sandbox.document.getElementById = (id) => {
    if (id === 'world-line-canvas') {
      return {
        getContext: () => ({
          fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          fillText() {}, setLineDash() {}, createLinearGradient: () => ({ addColorStop() {} }),
          shadowBlur: 0, shadowColor: '', lineWidth: 1, fillStyle: '', strokeStyle: '',
        }),
        getBoundingClientRect: () => ({ width: 380, height: 160 }),
        classList: { add() {}, remove() {} },
        width: 380, height: 160,
      };
    }
    if (id === 'wl-audio' || id === 'wl-mind') return { innerText: '' };
    return null;
  };
  sandbox.window.AMADEUS.PERF = { dpr: 1 };
  sandbox.window.AMADEUS.PERF_LEVELS = [{ scopeStep: 2 }];
  sandbox.window.AMADEUS.getPerfLevel = () => 2;
  sandbox.window.AMADEUS.SETTINGS_DEFAULTS = { scope: { ch1: '#ff4d55', ch2: '#ff55aa' } };
  sandbox.window.AMADEUS.SETTINGS = { scope: { ch1: '#ff4d55', ch2: '#ff55aa' } };
  sandbox.window.AMADEUS.state = {
    isLivelyPaused: false, isIdle: false, lastAudioLevel: 0, mindEnergy: 0.3,
    audioEnv: 0, smoothSpec: new Array(48).fill(0), peakSpec: new Array(48).fill(0),
    peakFalloff: 0.86, lastSpectrum: new Array(48).fill(0), wlPhase2: 0, mindBaseline: 0,
    live2DController: null,
  };

  osc.initWorldLine();
  const oscTimerIds = Object.keys(timers).map(Number);
  assert.ok(oscTimerIds.length > 0, 'initWorldLine should schedule a meta interval');
  const oscTimerId = oscTimerIds[0];
  osc.stopWorldLineMeta();
  assert.equal(timers[oscTimerId], null, 'stopWorldLineMeta should clear the interval');
});

test('power.startIdleWatchdog guards against double-start and stopIdleWatchdog clears it', () => {
  const { sandbox, storage } = makeSandbox();
  const timers = [];
  let timerIdCounter = 1;
  sandbox.setInterval = (fn, ms) => { const id = timerIdCounter++; timers[id] = fn; return id; };
  sandbox.clearInterval = (id) => { timers[id] = null; };
  sandbox.performance = { now: () => Date.now() };

  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('power.js'));
  const power = sandbox.window.AMADEUS.power;
  const s = sandbox.window.AMADEUS.state;

  s.lastActivityTime = Date.now();
  power.startIdleWatchdog();
  const timerIds = Object.keys(timers).map(Number);
  assert.ok(timerIds.length > 0, 'first startIdleWatchdog should schedule an interval');
  const firstId = timerIds[0];

  power.startIdleWatchdog();
  const secondIds = Object.keys(timers).map(Number);
  assert.equal(secondIds.length, 1, 'second startIdleWatchdog must not create a duplicate interval');

  power.stopIdleWatchdog();
  assert.equal(timers[firstId], null, 'stopIdleWatchdog should clear the interval');
});

test('state master ticker stops RAF when all callbacks are removed', () => {
  const { sandbox, storage } = makeSandbox();
  const rafs = [];
  sandbox.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length - 1; };
  sandbox.cancelAnimationFrame = (id) => { rafs[id] = null; };

  loadModule(sandbox, MOD('state.js'));
  const A = sandbox.window.AMADEUS;

  const cb = () => {};
  A.onMasterTick(cb);
  assert.ok(rafs[0], 'onMasterTick should start RAF');

  A.offMasterTick(cb);
  // Simulate one RAF frame to let the ticker notice empty callbacks
  if (rafs[0]) rafs[0](Date.now());
  assert.equal(rafs.length, 1, 'no additional RAF should be scheduled after callbacks empty');
});

// ---------------------------------------------------------------------------
// bubble.js — shouldSuppressCannedIdle gating
// ---------------------------------------------------------------------------

test('bubble.shouldSuppressCannedIdle silences canned chatter when no AI is configured', () => {
  const { sandbox } = makeSandbox();
  loadModule(sandbox, MOD('bubble.js'));
  const { shouldSuppressCannedIdle } = sandbox.window.AMADEUS.bubble;

  // No AI configured + canned (non-AI) line → suppress (keep transcript clean)
  assert.equal(shouldSuppressCannedIdle(false, false), true,
    'canned idle line should be suppressed when no AI tier is configured');
  // Real AI thought → never suppress
  assert.equal(shouldSuppressCannedIdle(true, false), false,
    'a genuine brain/LLM thought should never be suppressed');
  assert.equal(shouldSuppressCannedIdle(true, true), false,
    'a genuine brain/LLM thought should never be suppressed even with AI configured');
  // AI configured + canned fallback → allow (AI is present, so canned backup is valid)
  assert.equal(shouldSuppressCannedIdle(false, true), false,
    'canned fallback should be allowed when an AI tier is configured');
});
// ---------------------------------------------------------------------------
// settings.js � theme completeness: every valid theme must have a scope
// preset so the oscilloscope colors never fall back to defaults silently.
// ---------------------------------------------------------------------------
test('settings: all valid themes have scope presets', () => {
  const { sandbox } = makeSandbox({ AMADEUS: {} });
  sandbox.window.AMADEUS.SETTINGS_DEFAULTS = { scope: { ch1: '#000000', ch2: '#000000' } };
  loadModule(sandbox, MOD('settings.js'));
  const settings = sandbox.window.AMADEUS.settings;

  const expected = {
    skuld:   { ch1: '#ff4d55', ch2: '#ff55aa' },
    amber:   { ch1: '#ffaa40', ch2: '#ffc266' },
    sg0:     { ch1: '#98a6b8', ch2: '#bfa0c4' },
    amadeus: { ch1: '#00e5ff', ch2: '#7c4dff' },
  };
  const missing = [];
  for (const [theme, preset] of Object.entries(expected)) {
    settings.applyTheme(theme, true);
    const scope = settings.getSettings().scope;
    if (JSON.stringify(scope) !== JSON.stringify(preset)) {
      missing.push(theme + ' (got ' + JSON.stringify(scope) + ')');
    }
  }
  assert.deepEqual(missing, [], `missing or wrong scope presets: ${missing.join(', ')}`);
});
// ---------------------------------------------------------------------------
// build: dist/index.html must not leak secret script paths after stripping.
// ---------------------------------------------------------------------------
test('build: dist/index.html does not reference secret key files', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
  const secrets = ['brain-key.js', 'openrouter-key.js'];
  const leaks = [];
  for (const s of secrets) {
    if (html.includes(s)) leaks.push(s);
  }
  assert.deepEqual(leaks, [], `secret file references leaked into dist/index.html: ${leaks.join(', ')}`);
});

// ---------------------------------------------------------------------------
// build: dist/ structure must contain minified modules, vendor dirs, and
// static assets after a successful build.
// ---------------------------------------------------------------------------
test('build: dist/ contains expected minified output and assets', () => {
  const distRoot = path.join(ROOT, 'dist');
  assert.ok(fs.existsSync(distRoot), 'dist/ should exist after build');

  const requiredJs = ['wallpaper.js', 'live2d_controller.js'];
  for (const f of requiredJs) {
    assert.ok(fs.existsSync(path.join(distRoot, f)), `dist/${f} should exist`);
    assert.ok(fs.existsSync(path.join(distRoot, f + '.map')), `dist/${f}.map should exist`);
  }

  for (const d of ['lib', 'live2d', 'sounds']) {
    assert.ok(fs.existsSync(path.join(distRoot, d)), `dist/${d}/ should exist`);
  }

  for (const f of ['LivelyInfo.json', 'LivelyProperties.json', 'thumbnail.png', 'style.css', 'style.css.map', 'index.html']) {
    assert.ok(fs.existsSync(path.join(distRoot, f)), `dist/${f} should exist`);
  }

  assert.ok(fs.existsSync(path.join(distRoot, 'modules')), 'dist/modules/ should exist');
  const modFiles = fs.readdirSync(path.join(distRoot, 'modules')).filter(f => f.endsWith('.js'));
  assert.ok(modFiles.length >= 20, `expected >=20 minified modules, got ${modFiles.length}`);
});

// ---------------------------------------------------------------------------
// settings.js — updateSettingsDrawerUi ARIA state synchronization
// ---------------------------------------------------------------------------
function makeTrackingElement() {
  const el = {
    style: {},
    dataset: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        const has = this._classes.has(c);
        const want = force !== undefined ? force : !has;
        if (want) this._classes.add(c);
        else this._classes.delete(c);
        return want;
      },
      contains(c) { return this._classes.has(c); },
    },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    _hidden: false,
    set hidden(v) { this._hidden = v; },
    get hidden() { return this._hidden; },
    appendChild() {},
    addEventListener() {},
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  };
  return el;
}

test('settings.updateSettingsDrawerUi opens drawer and sets ARIA state', () => {
  const panel = makeTrackingElement();
  const body = makeTrackingElement();
  const handle = makeTrackingElement();
  const state = makeTrackingElement();

  const { sandbox } = makeSandbox();
  sandbox.document.getElementById = (id) => {
    if (id === 'settings-panel') return panel;
    if (id === 'settings-body') return body;
    if (id === 'settings-toggle') return handle;
    if (id === 'settings-state') return state;
    return null;
  };
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('settings.js'));
  const settings = sandbox.window.AMADEUS.settings;

  // Open the drawer
  settings.updateSettingsDrawerUi(true);

  assert.equal(panel.classList.contains('is-open'), true, 'panel gets is-open class');
  assert.equal(body.hidden, false, 'body is visible when open');
  assert.equal(body.getAttribute('aria-hidden'), 'false', 'body aria-hidden is false');
  assert.equal(handle.getAttribute('aria-expanded'), 'true', 'handle aria-expanded is true');
  assert.equal(state.textContent, 'COLLAPSE', 'state text shows COLLAPSE when open');

  // Close the drawer
  settings.updateSettingsDrawerUi(false);

  assert.equal(panel.classList.contains('is-open'), false, 'panel loses is-open class');
  assert.equal(body.hidden, true, 'body is hidden when closed');
  assert.equal(body.getAttribute('aria-hidden'), 'true', 'body aria-hidden is true');
  assert.equal(handle.getAttribute('aria-expanded'), 'false', 'handle aria-expanded is false');
  assert.equal(state.textContent, 'EXPAND', 'state text shows EXPAND when closed');
});

test('settings.updateSettingsDrawerUi toggles when no argument given', () => {
  const panel = makeTrackingElement();
  const body = makeTrackingElement();
  const handle = makeTrackingElement();
  const state = makeTrackingElement();

  const { sandbox } = makeSandbox();
  sandbox.document.getElementById = (id) => {
    if (id === 'settings-panel') return panel;
    if (id === 'settings-body') return body;
    if (id === 'settings-toggle') return handle;
    if (id === 'settings-state') return state;
    return null;
  };
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('settings.js'));
  const settings = sandbox.window.AMADEUS.settings;

  // Initially closed → toggle opens
  settings.updateSettingsDrawerUi();
  assert.equal(panel.classList.contains('is-open'), true, 'toggle opens from closed');

  // Now open → toggle closes
  settings.updateSettingsDrawerUi();
  assert.equal(panel.classList.contains('is-open'), false, 'toggle closes from open');
});

// ---------------------------------------------------------------------------
// settings.js — updateCinematicUi synchronizes body class and controls
// ---------------------------------------------------------------------------
test('settings.updateCinematicUi enters cinematic mode and toggles controls', () => {
  const toggleBtn = makeTrackingElement();
  const exitBtn = makeTrackingElement();
  const stateEl = makeTrackingElement();
  const body = makeTrackingElement();

  const { sandbox } = makeSandbox();
  sandbox.document.getElementById = (id) => {
    if (id === 'btn-cinematic-toggle') return toggleBtn;
    if (id === 'cinematic-exit-btn') return exitBtn;
    if (id === 'cinematic-state') return stateEl;
    return null;
  };
  sandbox.document.body = body;
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('settings.js'));
  const settings = sandbox.window.AMADEUS.settings;

  // Enter cinematic
  settings.updateCinematicUi(true);

  assert.equal(body.classList.contains('cinematic-mode'), true, 'body gets cinematic-mode class');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true', 'toggle aria-pressed is true');
  assert.equal(toggleBtn.hidden, true, 'enter button hidden in cinematic');
  assert.equal(exitBtn.hidden, false, 'exit button visible in cinematic');
  assert.equal(stateEl.textContent, 'CINEMATIC', 'state shows CINEMATIC');

  // Exit cinematic
  settings.updateCinematicUi(false);

  assert.equal(body.classList.contains('cinematic-mode'), false, 'body loses cinematic-mode class');
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false', 'toggle aria-pressed is false');
  assert.equal(toggleBtn.hidden, false, 'enter button visible when not cinematic');
  assert.equal(exitBtn.hidden, true, 'exit button hidden when not cinematic');
  assert.equal(stateEl.textContent, 'STANDBY', 'state shows STANDBY');
});

// ---------------------------------------------------------------------------
// task-widget.js — setParaSyncState state machine
// ---------------------------------------------------------------------------
test('task-widget.setParaSyncState cycles idle → syncing → success → idle', () => {
  const button = makeTrackingElement();
  const status = makeTrackingElement();
  status.dataset = {};

  const { sandbox } = makeSandbox();
  sandbox.document.getElementById = (id) => {
    if (id === 'para-organize-btn') return button;
    if (id === 'task-sync-status') return status;
    return null;
  };
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('task-widget.js'));
  const taskWidget = sandbox.window.AMADEUS.taskWidget;

  // Idle state
  taskWidget.setParaSyncState('idle');
  assert.equal(button.textContent, 'PARA SYNC', 'idle button text');
  assert.equal(button.disabled, false, 'button enabled when idle');
  assert.equal(button.getAttribute('aria-busy'), null, 'no aria-busy when idle');
  assert.equal(status.dataset.state, 'idle', 'status dataset state is idle');
  assert.equal(status.textContent, '', 'status text empty when idle');

  // Syncing state
  taskWidget.setParaSyncState('syncing', 'Organizing 00_Inbox');
  assert.equal(button.textContent, 'SYNCING...', 'syncing button text');
  assert.equal(button.disabled, true, 'button disabled while syncing');
  assert.equal(button.getAttribute('aria-busy'), 'true', 'aria-busy set while syncing');
  assert.equal(status.dataset.state, 'syncing', 'status dataset state is syncing');
  assert.equal(status.textContent, 'Organizing 00_Inbox', 'status shows sync message');

  // Success state
  taskWidget.setParaSyncState('success', 'Moved 5 items');
  assert.equal(button.textContent, 'PARA SYNC', 'success restores button text');
  assert.equal(button.disabled, false, 'button re-enabled after success');
  assert.equal(button.getAttribute('aria-busy'), null, 'aria-busy removed after success');
  assert.equal(status.dataset.state, 'success', 'status dataset state is success');
  assert.equal(status.textContent, 'Moved 5 items', 'status shows success message');

  // Error state
  taskWidget.setParaSyncState('error', 'Sync unavailable');
  assert.equal(button.textContent, 'RETRY SYNC', 'error button text');
  assert.equal(button.disabled, false, 'button re-enabled after error');
  assert.equal(status.dataset.state, 'error', 'status dataset state is error');
  assert.equal(status.textContent, 'Sync unavailable', 'status shows error message');
});

test('task-widget.setParaSyncState clears previous timer on new state', () => {
  const button = makeTrackingElement();
  const status = makeTrackingElement();
  status.dataset = {};
  const timers = [];
  const cleared = [];

  const { sandbox } = makeSandbox();
  sandbox.document.getElementById = (id) => {
    if (id === 'para-organize-btn') return button;
    if (id === 'task-sync-status') return status;
    return null;
  };
  sandbox.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  sandbox.clearTimeout = (id) => { cleared.push(id); };
  loadModule(sandbox, MOD('state.js'));
  loadModule(sandbox, MOD('task-widget.js'));
  const taskWidget = sandbox.window.AMADEUS.taskWidget;

  // Set success (starts a timer)
  taskWidget.setParaSyncState('success', 'Done');
  assert.ok(timers.length === 1, 'success starts a timer');

  // Set syncing before timer fires (should clear the pending timer)
  taskWidget.setParaSyncState('syncing', 'Working');
  assert.ok(cleared.length === 1, 'previous timer is cleared on new state');
});
