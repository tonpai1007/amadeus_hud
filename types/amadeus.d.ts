/// <reference types="node" />

declare namespace AMADEUS {
  // Core state shape
  interface State {
    live2DController: any;
    isLivelyActive: boolean;
    isLivelyPaused: boolean;
    isIdle: boolean;
    isSleeping: boolean;
    isUserAway: boolean;
    userAwaySince: number;
    lastPeekAt: number;
    peekReadyAt: number;
    desktopSessionAt: number;
    lastActivityTime: number;
    cursorNX: number;
    cursorNY: number;
    cursorSeen: boolean;
    worldLineEnergy: number;
    lastAudioLevel: number;
    lastBassLevel: number;
    lastBeatAt: number;
    bgBeatPulse: number;
    mindEnergy: number;
    lastSpectrum: number[];
    smoothSpec: number[];
    peakSpec: number[];
    peakFalloff: number;
    audioEnv: number;
    wlPhase2: number;
    mindBaseline: number;
    mood: number;
    moodLastAdjustAt: number;
    weather: any;
    kurisuInput: string;
    kurisuHistory: any[];
    chatLog: any[];
    kurisuReplying: boolean;
    kurisuGreeted: boolean;
    kurisuHintShown: boolean;
    perfLevelManual: boolean;
    newsOfflineSince?: number;
    uplinkOfflineSince?: number;
  }

  // Settings shape
  interface Settings {
    widgets: {
      scope: boolean;
      news: boolean;
      clock: boolean;
      ring: boolean;
      chat: boolean;
      crt: boolean;
      bg: boolean;
    };
    scope: {
      speed: number;
      density: number;
      ch1: string;
      ch2: string;
    };
    pet: boolean;
    voice: boolean;
    sfx: boolean;
    features: {
      idleGestures: boolean;
      ambientMotions: boolean;
      easterEggs: boolean;
      newsReactions: boolean;
      musicMood: boolean;
      postureFatigue: boolean;
      focusMode: boolean;
    };
  }

  // Perf levels
  interface PerfLevel {
    dpr: number;
    visualFps: number;
    scopeStep: number;
    ringBars: number;
  }

  // Core runtime globals (populated by modules/state.ts, modules/settings.ts)
  let state: State;
  let SETTINGS_DEFAULTS: Settings;
  let SETTINGS_KEY: string;
  let SETTINGS: Settings & Record<string, any>;
  let CHAT_LIMITS: {
    KURISU_INPUT_MAX?: number;
    KURISU_HISTORY_MAX?: number;
    CHAT_ENTRY_MAX?: number;
    CHAT_VISIBLE_MAX?: number;
    CHAT_LOG_MAX?: number;
  };
  let PERF: {
    dpr: number;
    visualFps: number;
    gearFps: number;
  };
  let PERF_LEVELS: PerfLevel[];
  let MAX_DPR: number;
  let brainClient: {
    getHttpUrl(path?: string): string;
    getWsUrl(path?: string): string;
    getApiKey(): string;
    getHeaders(extra?: Record<string, string>): Record<string, string>;
  };
  function onMasterTick(cb: (now: number) => void): (now: number) => void;
  function offMasterTick(cb: (now: number) => void): void;
  function startMasterTicker(): void;
  function getPerfLevel(): number;
  function setPerfLevel(level: number): void;
  function escapeHtml(s: string): string;
  function createWsHeartbeat(...args: any[]): any;

  // Live2D subsystem namespaces (modules/l2d-*.ts, live2d_controller.ts)
  let L2D_CONSTANTS: Record<string, any>;
  let L2D_EMOTION: Record<string, any>;
  let L2D_PHYSICS: Record<string, any>;
  let L2D_INTERACTION: Record<string, any>;
  class Live2DController {
    constructor(...args: any[]);
    [key: string]: any;
  }

  let mood: {
    moodDeltaForEmotion(emotion: string): number;
    adjustMood(delta: number): void;
    driftMood(): void;
    loadMood(): void;
    saveMood(): void;
    updateEmotionTint(): void;
    scheduleStorageWrite(key: string, value: any, delayMs?: number): void;
  };

  let clock: {
    applyTaskbarClearance(): void;
    initClock(): void;
    stopClock(): void;
  };

  let oscilloscope: {
    initWorldLine(): void;
    updateWorldLine(): void;
    updateWorldLineMeta(): void;
    stopWorldLineMeta(): void;
    hexToRgb(hex: string): { r: number; g: number; b: number } | null;
    getResizeCallback(): (() => void) | null;
  };

  let power: {
    markActivity(): void;
    startIdleWatchdog(): void;
    stopIdleWatchdog(): void;
    enterIdleState(idle: boolean): void;
    enterSleepState(sleep: boolean): void;
    onUserAway(): void;
    onUserReturn(): void;
    applyPerfLevel(): void;
    startPerfGovernor(): void;
    applyTimeOfDay(): void;
    initDebugOverlay(): void;
    getLastMeasuredFps(): number;
    ACTIVITY_ENERGY: number;
  };

  let weather: {
    initWeather(): void;
    fetchWeather(): Promise<void>;
    getWeatherSummary(): any;
  };

  let divergence: {
    initDivergence(): void;
    triggerWorldlineShift(customTarget?: number): void;
    applyTaskNudge(progress: number): void;
    updateDivergence(now: number): void;
    getDivergence(): string;
    renderDivergence(now: number): void;
  };

  let bubble: {
    initKurisuBubble(): void;
    showKurisuBubble(text: string, durationMs?: number, suppressTts?: boolean): void;
    hideKurisuBubble(): void;
    scheduleIdleChatter(): void;
    positionKurisuBubble(): void;
    shouldSuppressCannedIdle(isAiThought: boolean, aiConfigured: boolean): boolean;
    showKurisuThinking(): void;
  };

  let uplink: {
    init(): void;
    close(): void;
    retry(): void;
    handleIncomingMessage?(msg: any): void;
  };

  let chat: {
    initSpeechRecognition(): void;
    initKurisuChatInput(): void;
    loadKurisuHistory(): void;
    loadChatLog(): void;
    renderChatLog(): void;
    syncBackendChatHistory(): void;
    checkBrainUplink(): void;
    appendChatEntry(role: string, text: string, source?: string): void;
    buildHistoryMessages(): any[];
    kurisuThink(text?: string): Promise<void>;
    hasAnyAI(): boolean;
    clearChatPending(): void;
    showChatPending(text?: string): void;
    triggerScreenCoPilot(): void;
    askKurisu(text: string, opts?: any): Promise<any>;
    setUplink(status: string, label?: string): void;
    saveKurisuHistory(): void;
    saveChatLog(): void;
    emotionFromText(text: string): any;
    cleanReply(text: string): string;
    clearChatLogAndHistory(): void;
    kurisuGreetOnLoad(): void;
    kurisuSay(text: string, opts?: any): void;
    KURISU_BRAIN: any;
    KURISU_LLM: any;
    KURISU_HISTORY_MAX: number;
    KURISU_INPUT_MAX: number;
    CHAT_ENTRY_MAX: number;
    KURISU_RETURN_LINES: string[];
    KURISU_WAKE_LINES: string[];
  };

  let news: {
    initNews?(): void;
    fetchRealtimeNews(): void;
    toggleFeedMode(): void;
    getLastStories(): any[];
    renderTrendshiftFeed(stories?: any[]): void;
    isStoryRelevant(story: any): boolean;
    getCleanDomainTag(url: any, fallback?: any): string;
    timeSince(ts: number): string;
  };

  let tts: {
    initTTSAudio(): void;
    detectScriptLanguage(text: string): string;
    pickBestWebSpeechVoice(preferredLang: string): SpeechSynthesisVoice | null;
    speak?(text: string, opts?: { lang?: string; voice?: SpeechSynthesisVoice }): void;
    speakKurisuVoice(text: string, opts?: any): void;
    isSpeakingVoice(): boolean;
  };

  let lively: {
    initLivelyWebSocket(): void;
    closeTelemetryWebSocket(): void;
    startBrowserSimulation(): void;
    handleAudioFrame(...args: any[]): void;
    toBoolean(val: any, fallback: boolean): boolean;
    toNumber(val: any, min: number, max: number, defaultVal: number): number;
  };

  let audioRing: {
    initAudioCanvas(): void;
    getResizeCallback(): (() => void) | null;
    drawAudioRing(...args: any[]): void;
    freqColor(n: number): { r: number; g: number; b: number };
  };

  let background: {
    initBackground(): void;
    updateBackground(): void;
    triggerBeatPulse(): void;
  };

  let settings: {
    initSettings(): void;
    getSettings(): Settings;
    loadSettings(): Settings;
    saveSettings(): void;
    pushFeaturesToController(): void;
    initPetMode(): void;
    initInteractMode(): void;
    applyTheme(theme?: string): void;
    resetPanelPositions(): void;
    toggleCinematicMode(): void;
    closeSettingsDrawer(): boolean;
    petApply: any;
    voice?: boolean;
  };

  let taskWidget: {
    initTaskWidget(): void;
    renderTasks(): void;
    addNewTask(title?: string): void;
    toggleWidget(id?: string): void;
    autoOrganizeVault(): void;
    getTasks(): any;
  };

  let focus: {
    initFocus(): void;
    start(): boolean;
    cancel(silent?: boolean): boolean;
    setFeatureEnabled(on: boolean): void;
    isActive(): boolean;
    getPhase(): 'idle' | 'focus' | 'break';
    getTodayCount(): number;
    getStreak(): number;
    _tick(): void;
  };

  let net: {
    reportNetSuccess(): void;
    reportNetFailure(): void;
    setSource(name: string, online: boolean, opts?: { immediate?: boolean; detail?: string }): void;
    isNetOnline(): boolean;
  };

  function safeSetItem(key: string, value: string): boolean;

  function pickFreshLine(key: string, pool: string[]): string;

  let mediaPlayer: {
    initMediaPlayer(): void;
    sendMediaAction(action: string): void;
    updateTrackInfo(track: any, artist: any): void;
  };

  let sfx: {
    initSfx?(): void;
    playBeepSound(): void;
    playTransmitSound(): void;
    playClickSound(): void;
    playPokeSound?(): void;
    getAudioContext(): AudioContext | null;
    setSfxEnabled(enabled: boolean): void;
    isSfxEnabled(): boolean;
  };

  let speechInput: {
    initSpeechInput(): void;
    isSpeechSupported(): boolean;
  };

  let chatUi: {
    initChatUi(): void;
  };

  let chatHistory: {
    loadKurisuHistory(): void;
    saveKurisuHistory(): void;
    loadChatLog(): void;
    saveChatLog(): void;
  };
}


interface Window {
  AMADEUS: typeof AMADEUS;
  KURISU_BRAIN_KEY?: string;
  KURISU_OPENROUTER_KEY?: string;
  KURISU_BRAIN?: any;
  livelyAudioListener?: (...args: any[]) => void;
  livelyWallpaperPlaybackChanged?: (obj: any) => void;
  livelyCurrentTrack?: (track: any) => void;
  livelyPropertyListener?: (propName: string, value: any) => void;
  webkitAudioContext?: typeof AudioContext;
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

declare class Live2DController {
  constructor(canvasId: string, modelPath: string);
  [key: string]: any;
}

declare const PIXI: any;
declare const Live2DModel: any;
declare const MotionManager: any;
