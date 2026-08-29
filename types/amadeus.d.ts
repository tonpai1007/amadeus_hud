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
    };
  }

  // Perf levels
  interface PerfLevel {
    dpr: number;
    visualFps: number;
    scopeStep: number;
    ringBars: number;
  }

  // Module namespaces
  const state: {
    state: State;
    onMasterTick(cb: (now: number) => void): (now: number) => void;
    offMasterTick(cb: (now: number) => void): void;
    startMasterTicker(): void;
    getPerfLevel(): number;
    setPerfLevel(level: number): void;
    PERF: {
      dpr: number;
      visualFps: number;
      gearFps: number;
    };
    PERF_LEVELS: PerfLevel[];
    SETTINGS_DEFAULTS: Settings;
    brainClient: {
      getHttpUrl(path?: string): string;
      getWsUrl(path?: string): string;
      getApiKey(): string;
      getHeaders(extra?: Record<string, string>): Record<string, string>;
    };
  };

  const mood: {
    moodDeltaForEmotion(emotion: string): number;
    adjustMood(delta: number): void;
    driftMood(): void;
    loadMood(): void;
    saveMood(): void;
    updateEmotionTint(): void;
  };

  const clock: {
    applyTaskbarClearance(): void;
    initClock(): void;
    stopClock(): void;
  };

  const oscilloscope: {
    initWorldLine(): void;
    updateWorldLine(): void;
    updateWorldLineMeta(): void;
    stopWorldLineMeta(): void;
    hexToRgb(hex: string): { r: number; g: number; b: number } | null;
    getResizeCallback(): (() => void) | null;
  };

  const power: {
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

  const weather: {
    initWeather(): void;
    fetchWeather(): Promise<void>;
    getWeatherSummary(): any;
  };

  const divergence: {
    initDivergence(): void;
    triggerWorldlineShift(): void;
    updateDivergence(now: number): void;
    getDivergence(): string;
    renderDivergence(now: number): void;
  };

  const bubble: {
    initKurisuBubble(): void;
    showKurisuBubble(text: string, durationMs?: number): void;
    hideKurisuBubble(): void;
    scheduleIdleChatter(): void;
  };

  const uplink: {
    init(): void;
    close(): void;
    handleIncomingMessage(msg: any): void;
  };

  const chat: {
    initSpeechRecognition(): void;
    initKurisuChatInput(): void;
    loadKurisuHistory(): void;
    loadChatLog(): void;
    renderChatLog(): void;
    syncBackendChatHistory(): void;
    checkBrainUplink(): void;
    appendChatEntry(role: string, text: string, source?: string): void;
    buildHistoryMessages(): any[];
    KURISU_BRAIN: any;
    KURISU_LLM: any;
    KURISU_HISTORY_MAX: number;
    KURISU_INPUT_MAX: number;
    CHAT_ENTRY_MAX: number;
    KURISU_RETURN_LINES: string[];
    KURISU_WAKE_LINES: string[];
  };

  const news: {
    initNews(): void;
    fetchRealtimeNews(): void;
    toggleFeedMode(): void;
  };

  const tts: {
    initTTSAudio(): void;
    detectScriptLanguage(text: string): string;
    pickBestWebSpeechVoice(preferredLang: string): SpeechSynthesisVoice | null;
    speak(text: string, opts?: { lang?: string; voice?: SpeechSynthesisVoice }): void;
  };

  const lively: {
    initLivelyWebSocket(): void;
    closeTelemetryWebSocket(): void;
    startBrowserSimulation(): void;
    toBoolean(val: any, fallback: boolean): boolean;
    toNumber(val: any, fallback: number): number;
  };

  const audioRing: {
    initAudioCanvas(): void;
    getResizeCallback(): (() => void) | null;
  };

  const background: {
    initBackground(): void;
    updateBackground(): void;
  };

  const settings: {
    initSettings(): void;
    loadSettings(): Settings;
    saveSettings(): void;
    pushFeaturesToController(): void;
    initPetMode(): void;
    initInteractMode(): void;
  };

  const taskWidget: {
    initTaskWidget(): void;
  };

  const mediaPlayer: {
    initMediaPlayer(): void;
  };

  const sfx: {
    initSfx(): void;
    playBeepSound(): void;
    setSfxEnabled(enabled: boolean): void;
    isSfxEnabled(): boolean;
  };

  const speechInput: {
    initSpeechInput(): void;
    isSpeechSupported(): boolean;
  };

  const chatUi: {
    initChatUi(): void;
  };

  const chatHistory: {
    loadKurisuHistory(): void;
    saveKurisuHistory(): void;
    loadChatLog(): void;
    saveChatLog(): void;
  };
}

export = AMADEUS;
