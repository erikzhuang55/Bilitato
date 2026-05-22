let IS_DEBUG_MODE = false;
const {
    escapeHtml,
    escapeHtmlAttr,
    escapeRegExp,
    formatTime,
    formatTimelineTime,
    formatUtc8DateTime,
    getBvidFromUrl,
    getTidFromUrl,
    normalizeBvidCase,
    resolveDefaultOpenPage,
    serializeTimelineDetail,
    sleep,
    toNumberOrNaN,
    toSrtTime
} = globalThis.BilitatoContentUtils || {};
const {
    downloadTextFile,
    hasUsablePlayInfoForBvid,
    normalizeIncomingPlayInfo,
    sanitizeDownloadFileName
} = globalThis.BilitatoContentDownload || {};
const {
    DEFAULT_PROMPT_SETTINGS,
    TASK_PROMPTS_DEFAULT,
    normalizePromptSettingsState
} = globalThis.BilitatoContentSettings || {};
const {
    flashButtonState,
    renderSkeletonLines,
    showToast
} = globalThis.BilitatoContentUi || {};

function isNoTimestampSubtitleCache(cache = {}) {
    const source = String(cache?.subtitleSource || "").toLowerCase();
    if (source === "siliconflow" || source === "funasr") return true;
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (!raw.length) return false;
    return raw.some((item) => item?.noTimestamp === true);
}

function getProviderModelOptions(providerKey) {
    const key = String(providerKey || "").toLowerCase();
    const options = {
        modelscope: [
            "moonshotai/Kimi-K2.5",
            "MiniMax/MiniMax-M2.5",
            "ZhipuAI/GLM-5.1",
            "deepseek-ai/DeepSeek-V3.2",
            "Qwen3.5-27B"
        ],
        zhipu: [
            "glm-5.1",
            "glm-5",
            "glm-5-turbo",
            "glm-4.7",
            "glm-4.6",
            "glm-4.5"
        ],
        gemini: [
            "gemini-3.5-flash",
            "gemini-3.1-pro-preview",
            "gemini-3-flash-preview",
            "gemini-3.1-flash-lite",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite"
        ],
        openai: [
            "gpt-5.5",
            "gpt-5.5-pro",
            "gpt-5.4",
            "gpt-5.4-pro",
            "gpt-5.4-mini",
            "gpt-5.4-nano",
            "gpt-5.2",
            "gpt-5.2-pro",
            "gpt-5.1",
            "gpt-5",
            "gpt-5-pro",
            "gpt-5-mini",
            "gpt-5-nano",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini"
        ],
        deepseek: [
            "deepseek-v4-flash",
            "deepseek-v4-pro"
        ],
        kimi: [
            "kimi-k2.6",
            "kimi-k2.5",
            "kimi-k2-turbo-preview",
            "kimi-k2-thinking",
            "kimi-k2-thinking-turbo",
            "moonshot-v1-8k",
            "moonshot-v1-32k",
            "moonshot-v1-128k"
        ],
        claude: [
            "claude-opus-4-5",
            "claude-sonnet-4-6",
            "claude-sonnet-4-5",
            "claude-haiku-4-5"
        ]
    };
    return options[key] || [];
}

function getDefaultProviderModel(providerKey) {
    const options = getProviderModelOptions(providerKey);
    return options[0] || "";
}
const {
    buildCacheTagHtml,
    getTaskCacheSource
} = globalThis.BilitatoContentCache || {};
const {
    renderRichContent
} = globalThis.BilitatoContentRichText || {};
const {
    formatMetricText,
    renderAssistantBubble: renderAssistantBubbleHtml,
    renderChatHistoryItem: renderChatHistoryItemHtml
} = globalThis.BilitatoContentChat || {};
const {
    buildSrtContent,
    buildTimestampedSubtitleText,
    getRawSubtitlePlainText: getRawSubtitlePlainTextFromCache,
    getRawSubtitleRows: getRawSubtitleRowsFromCache
} = globalThis.BilitatoContentSubtitle || {};
const {
    buildChatProgressTaskId,
    buildTasksProgressTaskId,
    canRunTasksWithCache,
    createChatMessageId,
    createPendingChatMessages,
    needsSubtitleForTasks
} = globalThis.BilitatoContentAi || {};
const {
    createCloudReadState,
    hasSubtitle: hasSubtitleInCache,
    isCloudReadLoadingForVideo,
    shouldAttemptCloudReadForPage: shouldAttemptCloudReadForPageState,
    shouldAttemptCloudReadForVideo: shouldAttemptCloudReadForVideoState
} = globalThis.BilitatoContentCloud || {};
const {
    cleanBilibiliTitle,
    isStorageChangeStateDirty: isStorageChangeStateDirtyFromPage,
    pickSubtitle: pickSubtitleFromPage,
    resolveCidFromState,
    resolveCurrentBvidFromState
} = globalThis.BilitatoContentPage || {};
const {
    reportContentError
} = globalThis.BilitatoContentErrorReporter || {};
const {
    mapErrorToView,
    renderErrorPanel
} = globalThis.BilitatoContentErrorMessages || {};

const DEBUG_LOG_DISPLAY_LIMIT = 2000;

const SETUP_PREVIEW_VIDEO_URL = "https://www.bilibili.com/video/BV1ojfDBSEPv/?spm_id_from=333.337.search-card.all.click&vd_source=3f5a30216e0108cea18aa63a3bff11b8";
const SETUP_PREVIEW_BVID = normalizeBvidCase(getBvidFromUrl?.(SETUP_PREVIEW_VIDEO_URL) || "BV1ojfDBSEPv");
const SETUP_PREVIEW_STORAGE_KEY = "setupGuidePreviewTarget";
const SETUP_PREVIEW_MAX_AGE_MS = 10 * 60 * 1000;

function isDebugLoggingEnabled() {
    return !!(IS_DEBUG_MODE || appState?.settings?.debugMode);
}

function abortBackgroundOperations(reason = "page_unload") {
    try {
        chrome.runtime.sendMessage({ action: "ABORT_TAB_OPERATIONS", reason }).catch?.(() => {});
    } catch (_) {}
}

window.addEventListener("pagehide", () => abortBackgroundOperations("pagehide"));
window.addEventListener("beforeunload", () => abortBackgroundOperations("beforeunload"));

const UI_ICON_BASE_DIR = "assets/ui";
const FOLLOW_RESUME_MS = 5000;
const SUBTITLE_CHECK_DELAY_MS = 1000;
const SUBTITLE_DETECT_TIMEOUT_MS = 5000;
const CACHE_SYNC_THROTTLE_MS = 500;
const SUBTITLE_OBSERVE_GRACE_MS = 3500;
const STEP_PROGRESS_TIMEOUT_MS = 60000;
const CLOUD_READ_TIMEOUT_MS = 1000;
const appState = {
    tabId: null,
    activePage: "CC",
    tabState: null,
    cache: null,
    settings: null,
    providers: null,
    followEnabled: true,
    followPausedAt: 0,
    followCurrentIndex: -1,
    renderedSubtitleIndex: -1,
    subtitleCaptureLock: false,
    subtitleCapturedBvid: "",
    injectBvid: "",
    injectCid: 0,
    logPollTimer: null,
    injectReady: false,
    injectRetryTimer: null,
    chatGuideHidden: false,
    chatPending: [],
    chatStreamingId: "",
    chatStreamTimer: null,
    chatPort: null,
    chatActiveMessageId: "",
    debugLogPollTimer: null,
    asrUiTraceLogs: [],
    chatAutoScrollPausedUntil: 0,
    pendingSubtitle: null,
    timelineSearchTerm: "",
    timelineSearchDebounceTimer: null,
    ccSearchTerm: "",
    cloudReadState: {
        bvid: "",
        status: "idle",
        requestId: 0,
        startedAt: 0
    },
    ccSearchDebounceTimer: null,
    subtitleFallbackTimer: null,
    lastSubtitleForwardAt: 0,
    routeWatchTimer: null,
    routeWatchBvid: "",
    subtitleTimeline: [],
    transcription: {
        phase: "idle",
        bvid: "",
        progress: 0,
        statusText: ""
    },
    asrSession: {
        active: false,
        bvid: "",
        runId: "",
        stage: "",
        progress: 0,
        statusText: "",
        startedAt: 0
    },
    transcriptionDeclinedBvid: "",
    transcriptionSuppressUntil: 0,
    transcriptionSuppressBvid: "",
    transcribeCountdownTimer: null,
    subtitleCheckDelayTimer: null,
    subtitleDetectTimeoutTimer: null,
    subtitleCheckTargetBvid: "",
    transcriptionCapsuleVisible: false,
    transcriptionCapsuleMeta: null,
    lastCacheSyncTime: 0,
    lastCacheSyncBvid: "",
    isStateDirty: true,
    subtitleObserver: null,
    subtitleObserveUntil: 0,
    subtitleDomDetected: false,
    injectBvidChangedAt: Date.now(),
    progressTaskId: "",
    progressLastTick: 0,
    progressLastPercent: 0,
    progressTimeoutTimer: null,
    progressResetTimer: null,
    progressFadeTimer: null,
    pseudoProgressTaskId: "",
    pseudoProgressValue: 0,
    pseudoProgressStartedAt: 0,
    pseudoProgressTimer: null,
    saveStatusTimer: null,
    navActionActive: "",
    navActionActiveTimer: null,
    segmentsFloatDragging: null,
    segmentsMarkerTickAt: 0,
    sessionGeneratedTasks: new Set(),
    summaryExpanded: false,
    summaryRatio: 0.6,
    panelMaxHeight: 0,
    expandedSummaryHeight: 0,
    isCollapsed: false,
    segmentsCollapsed: false,
    localPending: {
        tasks: {},
        transcription: false
    },
    playInfo: null,
    playInfoUpdatedAt: 0,
    isPlayInfoReady: false,
    panelErrors: {}
};
globalThis.BilitatoAppState = appState;

function getDefaultTranscriptionState() {
    return {
        phase: "idle",
        bvid: "",
        progress: 0,
        statusText: ""
    };
}

function getTranscriptionState() {
    return {
        ...getDefaultTranscriptionState(),
        ...(appState.transcription || {})
    };
}

function getStableCurrentBvid() {
    return normalizeBvidCase(
        resolveCurrentBvid() ||
        getBvidFromUrl(location.href) ||
        appState.injectBvid ||
        appState.tabState?.activeBvid ||
        appState.cache?.bvid ||
        ""
    );
}

function isAsrSessionActiveForCurrent(targetBvid = "") {
    const session = appState.asrSession || {};
    if (!session.active) return false;
    const currentBvid = normalizeBvidCase(targetBvid || getStableCurrentBvid() || "");
    const sessionBvid = normalizeBvidCase(session.bvid || "");
    return !currentBvid || !sessionBvid || currentBvid === sessionBvid;
}

function beginAsrSession({ bvid = "", runId = "", statusText = "正在请求转录...", progress = 0, stage = "start" } = {}) {
    const normalizedBvid = normalizeBvidCase(bvid || getStableCurrentBvid() || "");
    appState.asrSession = {
        active: true,
        bvid: normalizedBvid,
        runId: String(runId || ""),
        stage: String(stage || "start"),
        progress: Math.max(0, Math.min(100, Number(progress) || 0)),
        statusText: String(statusText || "正在请求转录..."),
        startedAt: Date.now()
    };
    setLocalPendingTranscription(true, normalizedBvid);
    logAsrUiTrace("session_begin", {
        bvid: normalizedBvid,
        run_id: appState.asrSession.runId,
        stage: appState.asrSession.stage,
        progress: appState.asrSession.progress,
        status_text: appState.asrSession.statusText
    });
    return appState.asrSession;
}

function updateAsrSession(patch = {}) {
    const current = appState.asrSession || {};
    const patchBvid = normalizeBvidCase(patch.bvid || "");
    const currentBvid = normalizeBvidCase(current.bvid || "");
    if (!current.active && !patchBvid && !currentBvid) return current;
    if (current.active && patchBvid && currentBvid && patchBvid !== currentBvid) return current;
    const incomingProgress = Number(patch.progress);
    const nextProgress = Number.isFinite(incomingProgress)
        ? Math.max(Number(current.progress || 0), Math.max(0, Math.min(100, incomingProgress)))
        : Number(current.progress || 0);
    appState.asrSession = {
        active: patch.active ?? current.active ?? true,
        bvid: patchBvid || currentBvid || getStableCurrentBvid(),
        runId: String(patch.runId ?? current.runId ?? ""),
        stage: String(patch.stage ?? current.stage ?? ""),
        progress: nextProgress,
        statusText: String(patch.statusText ?? current.statusText ?? ""),
        startedAt: Number(current.startedAt || Date.now())
    };
    if (appState.asrSession.active) setLocalPendingTranscription(true, appState.asrSession.bvid);
    logAsrUiTrace("session_update", {
        patch,
        before: {
            active: !!current.active,
            bvid: current.bvid || "",
            stage: current.stage || "",
            progress: Number(current.progress || 0),
            status_text: current.statusText || ""
        },
        after: {
            active: !!appState.asrSession.active,
            bvid: appState.asrSession.bvid || "",
            stage: appState.asrSession.stage || "",
            progress: Number(appState.asrSession.progress || 0),
            status_text: appState.asrSession.statusText || ""
        }
    });
    return appState.asrSession;
}

function clearAsrSession() {
    const before = { ...(appState.asrSession || {}) };
    appState.asrSession = {
        active: false,
        bvid: "",
        runId: "",
        stage: "",
        progress: 0,
        statusText: "",
        startedAt: 0
    };
    setLocalPendingTranscription(false);
    logAsrUiTrace("session_clear", {
        before: {
            active: !!before.active,
            bvid: before.bvid || "",
            stage: before.stage || "",
            progress: Number(before.progress || 0),
            status_text: before.statusText || ""
        }
    });
}

function logAsrUiTrace(event, detail = {}) {
    const entry = {
        time: new Date().toISOString(),
        event: String(event || "asr_ui_trace"),
        detail: detail && typeof detail === "object" ? detail : { value: detail }
    };
    const nextLogs = Array.isArray(appState.asrUiTraceLogs) ? [...appState.asrUiTraceLogs, entry] : [entry];
    appState.asrUiTraceLogs = nextLogs.slice(-300);
    const box = panelShadowRoot ? panelShadowRoot.getElementById("debug-asr-ui-log-body") : null;
    if (box && appState.activePage === "debug") {
        renderAsrUiTraceData();
    }
}

function patchTranscriptionState(patch = {}) {
    const current = getTranscriptionState();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, "progress")) {
        const currentProgress = Number(current.progress || 0);
        const incomingProgress = Math.max(0, Math.min(100, Number(nextPatch.progress) || 0));
        const sameTask = !nextPatch.bvid || !current.bvid || normalizeBvidCase(nextPatch.bvid) === normalizeBvidCase(current.bvid);
        const stillRunning = current.phase === "running" || nextPatch.phase === "running";
        const startsNewRun = nextPatch.phase === "running" && current.phase !== "running" && incomingProgress <= 10;
        nextPatch.progress = !startsNewRun && sameTask && stillRunning && incomingProgress < currentProgress
            ? currentProgress
            : incomingProgress;
    }
    appState.transcription = {
        ...current,
        ...nextPatch
    };
    return appState.transcription;
}

function resetTranscriptionState(patch = {}) {
    appState.transcription = {
        ...getDefaultTranscriptionState(),
        ...(patch || {})
    };
    return appState.transcription;
}

function getTranscriptionBvid() {
    return normalizeBvidCase(getTranscriptionState().bvid || "");
}

function isLocalPendingTranscriptionForCurrent(targetBvid = "") {
    const value = appState.localPending?.transcription;
    if (!value) return false;
    if (value === true) return true;
    const currentBvid = normalizeBvidCase(targetBvid || getStableCurrentBvid() || "");
    const pendingBvid = normalizeBvidCase(value || "");
    return !currentBvid || !pendingBvid || currentBvid === pendingBvid;
}

function isTranscriptionRunning() {
    const state = getTranscriptionState();
    return isAsrSessionActiveForCurrent() || isLocalPendingTranscriptionForCurrent() || state.phase === "running";
}

function hasLocalPendingTask(task) {
    const value = appState.localPending?.tasks?.[task];
    if (!value) return false;
    if (value === true) return true;
    const currentBvid = normalizeBvidCase(resolveCurrentBvid() || "");
    const pendingBvid = normalizeBvidCase(value || "");
    return !currentBvid || !pendingBvid || currentBvid === pendingBvid;
}

function hasLocalPendingTasks(tasks) {
    return (Array.isArray(tasks) ? tasks : []).some((task) => hasLocalPendingTask(task));
}

function setLocalPendingTasks(tasks, value) {
    const nextTasks = { ...(appState.localPending?.tasks || {}) };
    const pendingBvid = normalizeBvidCase(resolveCurrentBvid() || "") || true;
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
        if (!task) return;
        if (value) nextTasks[task] = pendingBvid;
        else delete nextTasks[task];
    });
    appState.localPending = {
        ...(appState.localPending || {}),
        tasks: nextTasks
    };
}

function setLocalPendingTranscription(value, bvid = "") {
    appState.localPending = {
        ...(appState.localPending || {}),
        transcription: value ? (normalizeBvidCase(bvid || resolveCurrentBvid() || "") || true) : false
    };
}

function mergeIncomingTabState(incomingTabState) {
    if (!incomingTabState || typeof incomingTabState !== "object") return;
    const incomingBvid = normalizeBvidCase(incomingTabState?.activeBvid || "");
    const runningBvid = normalizeBvidCase(appState.asrSession?.bvid || getTranscriptionBvid() || appState.injectBvid || "");
    const keepRunningTranscriptionState = isTranscriptionRunning()
        && runningBvid
        && (!incomingBvid || incomingBvid === runningBvid);
    if (!keepRunningTranscriptionState) {
        appState.tabState = incomingTabState;
        return;
    }
    const currentProgress = Math.max(
        Number(appState.tabState?.transcriptionProgress || 0),
        Number(getTranscriptionState().progress || 0),
        Number(appState.asrSession?.progress || 0)
    );
    const incomingProgress = Number(incomingTabState?.transcriptionProgress || 0);
    appState.tabState = {
        ...incomingTabState,
        activeBvid: incomingBvid || runningBvid,
        transcriptionProgress: Math.max(currentProgress, incomingProgress)
    };
    logAsrUiTrace("tab_state_preserved_during_asr", {
        incoming_bvid: incomingBvid,
        preserved_bvid: appState.tabState.activeBvid,
        incoming_progress: incomingProgress,
        preserved_progress: appState.tabState.transcriptionProgress
    });
}
function toErrorInput(error, fallbackMessage = "请求失败") {
    return {
        message: String(error?.message || error?.error || fallbackMessage),
        code: String(error?.code || ""),
        status: Number(error?.status || 0) || undefined,
        retryAfterSec: Number(error?.retryAfterSec || 0) || undefined
    };
}

function setPanelError(page, error, fallbackMessage = "请求失败") {
    const view = mapErrorToView ? mapErrorToView(toErrorInput(error, fallbackMessage), fallbackMessage, {
        provider: appState.settings?.provider || "",
        surface: "panel"
    }) : null;
    if (!view) return null;
    appState.panelErrors = {
        ...(appState.panelErrors || {}),
        [page]: view
    };
    return view;
}

function clearPanelError(page) {
    if (!appState.panelErrors?.[page]) return;
    appState.panelErrors = {
        ...(appState.panelErrors || {}),
        [page]: null
    };
}

function notifyMappedError(error, fallbackMessage = "请求失败") {
    const view = mapErrorToView ? mapErrorToView(toErrorInput(error, fallbackMessage), fallbackMessage, {
        provider: appState.settings?.provider || ""
    }) : null;
    showToast(view?.message || fallbackMessage);
    return view;
}

function runErrorDisplayDemo(code, target = "summary") {
    const normalizedCode = String(code || "UNKNOWN").trim();
    const page = String(target || "summary");
    logUI.info("debug_error_demo", {
        task: "debug",
        code: normalizedCode,
        detail: { target: page }
    });
    const error = {
        code: normalizedCode,
        status: normalizedCode.match(/^HTTP_(\d{3})$/)?.[1] ? Number(normalizedCode.match(/^HTTP_(\d{3})$/)?.[1]) : undefined,
        message: normalizedCode,
        provider: appState.settings?.provider || ""
    };
    const view = mapErrorToView ? mapErrorToView(error, "测试错误", {
        provider: appState.settings?.provider || ""
    }) : null;
    if (!view) return;
    if (view.presentation === "toast") {
        showToast(view.message);
        return;
    }
    const targetPage = ["summary", "chat", "real"].includes(page) ? page : "summary";
    appState.panelErrors = {
        ...(appState.panelErrors || {}),
        [targetPage]: view
    };
    appState.activePage = targetPage;
    renderNav();
    renderContent();
}
const logContent = globalThis.AIPluginLogger.create("content", {
    getDebugMode: () => isDebugLoggingEnabled()
});
const logUI = globalThis.AIPluginLogger.create("ui", {
    getDebugMode: () => isDebugLoggingEnabled()
});
const logDownload = globalThis.AIPluginLogger.create("download", {
    getDebugMode: () => isDebugLoggingEnabled()
});
const logInject = globalThis.AIPluginLogger.create("inject", {
    getDebugMode: () => isDebugLoggingEnabled()
});
let logWindowVisible = false;

bootstrap();


async function bootstrap() {
    injectScriptBridge();
    scheduleInjectRetry();
    window.addEventListener("message", onInjectMessage, false);
    chrome.runtime.onMessage.addListener(onBackgroundMessage);
    window.addEventListener("keydown", isolateChatInputKeyboardEvent, true);
    window.addEventListener("keydown", onGlobalShortcut, true);
    window.addEventListener("resize", syncPanelHeightMode);
    chrome.storage.onChanged.addListener(onStorageChanged);
    startRouteWatcher();
    await waitPanelMount();
    await loadBootstrapData();
    globalThis.AIPluginLogger?.setDebugEnabled?.(isDebugLoggingEnabled());
    appState.injectBvid = normalizeBvidCase(getBvidFromUrl(location.href) || appState.tabState?.activeBvid || "");
    appState.injectBvidChangedAt = Date.now();
    beginSubtitleObservation(appState.injectBvid);
    startSubtitleCheckTimer();
    await syncCacheFromBackground(getBvidFromUrl(location.href) || appState.tabState?.activeBvid);
    triggerDefaultSubtitleCapture();
    setInterval(triggerDefaultSubtitleCapture, 3500);
    renderApp();
    startFocusTicker();
    Object.defineProperty(window, '__biliDebug', { get: () => appState });
}

function injectScriptBridge() {
    if (appState.injectReady) return;
    if (document.getElementById("bili-ai-inject-bridge")) return;
    const script = document.createElement("script");
    script.id = "bili-ai-inject-bridge";
    script.src = chrome.runtime.getURL("inject.js");
    script.async = false;
    script.onload = () => {
        script.remove();
    };
    script.onerror = () => {
        script.remove();
        appState.injectReady = true;
        logContent.error("inject_load_error", {
            task: "subtitle",
            code: "INJECT_LOAD_FAILED",
            detail: { has_src: !!script.src }
        });
        scheduleInjectRetry();
    };
    (document.head || document.documentElement).appendChild(script);
}

async function onInjectMessage(event) {
    const msgType = String(event?.data?.type || "");
    if (!msgType.startsWith("BILI_")) return;
    if (msgType === "BILI_INJECT_READY" || msgType === "BILI_SUBTITLE_HANDSHAKE") {
        appState.injectReady = true;
        beginSubtitleObservation(appState.injectBvid || resolveCurrentBvid());
        if (appState.injectRetryTimer) {
            clearInterval(appState.injectRetryTimer);
            appState.injectRetryTimer = null;
        }
        if (msgType === "BILI_SUBTITLE_HANDSHAKE") {
            pushSubtitleTimeline("handshake", {
                bvid: String(event?.data?.bvid || "").trim(),
                cid: Number(event?.data?.cid || 0)
            });
            scheduleSubtitleFallbackWatchdog("handshake");
            flushPendingSubtitleIfReady();
        } else {
            pushSubtitleTimeline("inject_ready");
            logContent.info("subtitle_detected", { source: "inject_ready" });
        }
        return;
    }
    if (msgType === "BILI_INJECT_LOG") {
        appState.injectReady = true;
        logInject.debug(event.data.event || "subtitle_detected", event.data.detail || {});
        if (event.data.event === "subtitle_detected") {
            pushSubtitleTimeline("inject_detected", {
                source: String(event?.data?.detail?.source || "")
            });
            scheduleSubtitleFallbackWatchdog("inject_log");
        }
        return;
    }
    if (msgType === "BILI_PLAYINFO_DATA") {
        if (event.data?.info) {
            const normalizedInfo = normalizeIncomingPlayInfo(event.data.info);
            const pageBvid = normalizeBvidCase(getBvidFromUrl(location.href) || "");
            const infoBvid = normalizeBvidCase(normalizedInfo?._bvid || "");
            if (normalizedInfo && (!pageBvid || !infoBvid || infoBvid === pageBvid)) {
                appState.playInfo = normalizedInfo;
                appState.playInfoUpdatedAt = Date.now();
                appState.isPlayInfoReady = hasUsablePlayInfoForBvid(normalizedInfo, pageBvid || infoBvid);
                logContent.info("playinfo_received", {
                    bvid: infoBvid,
                    video_count: normalizedInfo.video?.length || 0,
                    audio_count: normalizedInfo.audio?.length || 0,
                    ready: appState.isPlayInfoReady
                });
                const exportMenu = panelShadowRoot ? panelShadowRoot.getElementById("export-option-menu") : null;
                if (exportMenu?.dataset?.streamLoading === "video" || exportMenu?.dataset?.streamLoading === "audio") {
                    renderQualityList(exportMenu, exportMenu.dataset.streamLoading);
                } else if (exportMenu && exportMenu.querySelector('[data-action="download-video"]')) {
                    renderExportMainMenu(exportMenu);
                }
            }
        }
        return;
    }
    if (msgType === "BILI_ROUTE_SWITCH") {
        // Notify background to abort ongoing transcription for previous BVID
        chrome.runtime.sendMessage({ action: "ABORT_TRANSCRIPTION", bvid: getTranscriptionBvid() }).catch(() => {});
        resetAllState();
        waitForAlignedPlayInfo(normalizeBvidCase(getBvidFromUrl(location.href) || "")).catch(() => {});
        return;
    }
    if (msgType !== "BILI_SUBTITLE_DATA") return;
    appState.subtitleDomDetected = true;
    pushSubtitleTimeline("inject_data_received", {
        count: Array.isArray(event.data?.data) ? event.data.data.length : 0
    });
    scheduleSubtitleFallbackWatchdog("subtitle_data");
    const subtitles = Array.isArray(event.data?.data) ? event.data.data : [];
    if (!subtitles.length) {
        logContent.warn("subtitle_detected", { source: "inject_message_empty" });
        return;
    }
    const bvid = normalizeBvidCase(event.data?.bvid) || normalizeBvidCase(resolveCurrentBvid());
    const cid = Number(event.data?.cid || 0);
    const currentUrlBvid = normalizeBvidCase(getBvidFromUrl(location.href));
    if (bvid && currentUrlBvid && bvid !== currentUrlBvid) {
        pushSubtitleTimeline("drop_mismatch_bvid", { payloadBvid: bvid, currentBvid: currentUrlBvid });
        return;
    }
    const pendingPayload = {
        bvid,
        cid: Number.isFinite(cid) && cid > 0 ? cid : (appState.injectCid || 0),
        tid: getTidFromUrl(location.href),
        title: cleanBilibiliTitle(document.title),
        subtitle: subtitles
    };
    if (!pendingPayload.bvid) {
        appState.pendingSubtitle = pendingPayload;
        logContent.info("subtitle_detected", { source: "pending_subtitle_set", count: subtitles.length, bvid: currentUrlBvid || "" });
        pushSubtitleTimeline("pending_wait_bvid", { count: subtitles.length });
        logContent.warn("subtitle_detected", { source: "inject_message_pending_bvid", count: subtitles.length });
        scheduleSubtitleFallbackWatchdog("pending_bvid");
        return;
    }
    await forwardSubtitlePayload(pendingPayload, "inject_message_forwarded");
    if (appState.activePage === "CC") {
        const container = document.getElementById("page-CC");
        if (container) renderCC(container, subtitles);
    }
}

function onStorageChanged(changes, areaName) {
    if (areaName !== "local") return;
    logContent.debug("storage_listener_trigger", { keys: Object.keys(changes || {}) });
    logAsrUiTrace("storage_changed", {
        keys: Object.keys(changes || {}),
        tab_state_key: getTabStateKey(),
        active_bvid_before: normalizeBvidCase(appState.tabState?.activeBvid || ""),
        tab_progress_before: Number(appState.tabState?.transcriptionProgress || 0),
        session: {
            active: !!appState.asrSession?.active,
            bvid: appState.asrSession?.bvid || "",
            stage: appState.asrSession?.stage || "",
            progress: Number(appState.asrSession?.progress || 0)
        }
    });
    const beforeBvid = normalizeBvidCase(appState.tabState?.activeBvid);
    const routeBvid = normalizeBvidCase(getBvidFromUrl(location.href));
    const tabStateBefore = appState.tabState;
    if (changes.settings?.newValue) {
        appState.settings = changes.settings.newValue;
        globalThis.AIPluginLogger?.setDebugEnabled?.(isDebugLoggingEnabled());
    }
    if (changes.providers?.newValue) appState.providers = changes.providers.newValue;
    const newKey = String(changes.settings?.newValue?.apiKey || "").trim();
    const prevKey = String(changes.settings?.oldValue?.apiKey || "").trim();
    if (!prevKey && newKey) {
        if (panelShadowRoot?.getElementById("setup-guide-overlay")) {
            closeSetupGuide();
            showToast("配置成功，AI 功能已解锁 🎉");
        }
    }
    const tabKey = getTabStateKey();
    if (tabKey && changes[tabKey]?.newValue) mergeIncomingTabState(changes[tabKey].newValue);
    const afterBvid = normalizeBvidCase(appState.tabState?.activeBvid);
    const activeCid = Number(appState.tabState?.activeCid || 0);
    const routeMismatch = !!(routeBvid && afterBvid && String(afterBvid) !== routeBvid);
    const switched = !!(beforeBvid && afterBvid && beforeBvid !== afterBvid);
    if (switched) {
        pushSubtitleTimeline("bvid_switch", { from: beforeBvid, to: afterBvid || "" });
        resetPageStateByBvidSwitch();
        clearStreamCache();
        
        appState.activePage = resolveDefaultOpenPage(appState.settings?.defaultOpenPage);
        renderNav();
        clearCCListImmediately();
    }
    const candidateCacheKeys = [...new Set([beforeBvid, afterBvid, routeBvid].filter(Boolean).map((bvid) => `cache_${bvid}`))];
    if (!switched && !routeMismatch) {
        const currentRoute = normalizeBvidCase(getBvidFromUrl(location.href));
        const nextCache = candidateCacheKeys
            .map((key) => changes[key]?.newValue)
            .find((cache) => {
                const cacheBvid = normalizeBvidCase(cache?.bvid || "");
                return cacheBvid && (!currentRoute || cacheBvid === currentRoute);
            });
        if (nextCache) {
            appState.cache = nextCache;
            applyCacheSubtitleState(appState.cache, currentRoute || afterBvid || beforeBvid);
        }
    }
    if (routeMismatch) {
        appState.cache = null;
    }
    if (afterBvid && appState.cache?.bvid && normalizeBvidCase(appState.cache.bvid) !== afterBvid) {
        appState.cache = null;
    }
    if (routeBvid && appState.cache?.bvid && normalizeBvidCase(appState.cache.bvid) !== routeBvid) {
        appState.cache = null;
    }
    if (afterBvid && hasUsableSubtitleCache(appState.cache, afterBvid)) {
        appState.subtitleCapturedBvid = afterBvid;
    }
    pruneChatPendingByHistory(appState.cache?.history);
    const injectBefore = normalizeBvidCase(appState.injectBvid || "");
    if (routeBvid) appState.injectBvid = routeBvid;
    else if (afterBvid) appState.injectBvid = afterBvid;
    if (normalizeBvidCase(appState.injectBvid || "") !== injectBefore) {
        appState.injectBvidChangedAt = Date.now();
        startSubtitleCheckTimer();
    }
    if (isStorageChangeStateDirty(changes, switched, routeMismatch, afterBvid)) {
        appState.isStateDirty = true;
    }
    if (Number.isFinite(activeCid) && activeCid > 0) appState.injectCid = activeCid;
    beginSubtitleObservation(appState.injectBvid || afterBvid || routeBvid);
    flushPendingSubtitleIfReady();
    renderContent();
    const tabStateChanged = tabStateBefore !== appState.tabState;
    const syncTarget = routeBvid || afterBvid || "";
    if ((tabStateChanged || switched || routeMismatch) && syncTarget && !changes[`cache_${syncTarget}`]?.newValue) {
        syncActiveCacheByBvid(syncTarget);
    }
}

let panelShadowRoot = null;
let playerResizeObserver = null;

function getPanelRoot() {
    return panelShadowRoot;
}

async function waitPanelMount() {
    // 等页面完全加载完毕再动 DOM
    if (document.readyState !== "complete") {
        await new Promise(resolve => window.addEventListener("load", resolve, { once: true }));
    }
    // 额外等待 2000ms，确保 B 站各组件初始化完成
    await sleep(2000);

    // 寻找挂载目标：右侧栏 sticky 容器
    const rightContainer = document.querySelector(".right-container-inner.scroll-sticky") 
        || document.querySelector(".right-container-inner") 
        || document.querySelector(".right-container");

    if (!rightContainer) {
        // 如果找不到右侧栏，尝试再次等待
        await sleep(1000);
        if (!document.querySelector(".right-container")) {
             logUI.warn("mount_target_missing", { task: "ui", detail: { selector: "right-container" } });
             return;
        }
    }

    // 检查根容器是否已存在
    let rootHost = document.getElementById("__bili_ai_plugin_root__");
    if (!rootHost) {
        rootHost = document.createElement("div");
        rootHost.id = "__bili_ai_plugin_root__";
        rootHost.className = "ai-summary-plugin-host";
        rootHost.style.opacity = "0";
        rootHost.style.transition = "opacity 0.2s ease-in-out";
        
        // 创建 Shadow DOM
        panelShadowRoot = rootHost.attachShadow({ mode: "open" });
        
        // 注入样式
        const styleLink = document.createElement("link");
        styleLink.rel = "stylesheet";
        styleLink.href = chrome.runtime.getURL("content.css");
        const revealHost = () => {
            rootHost.style.opacity = "1";
        };
        styleLink.addEventListener("load", revealHost, { once: true });
        styleLink.addEventListener("error", revealHost, { once: true });
        panelShadowRoot.appendChild(styleLink);
        
        // 创建面板容器
        const panel = document.createElement("section");
        panel.className = "ai-summary-plugin-box";
        const logoIconSrc = chrome.runtime.getURL(`assets/icons/icon38.png`);
        const usageIconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/usage.png`);
        panel.innerHTML = `
            <div class="plugin-top-logo">
                <div style="display:flex; align-items:center; gap:8px;">
                    <img src="${logoIconSrc}" style="width:38px;height:38px;object-fit:contain;" />
                    <span class="logo-title">Bilitato B站视频小助手</span>
                </div>
                <div class="logo-remaining-container">
                    <img src="${usageIconSrc}" class="logo-info-icon" />
                    <div class="logo-remaining-tooltip" id="logo-remaining">Checking...</div>
                </div>
                <div class="progress-container"><div id="step-progress-bar" class="progress-bar"></div></div>
            </div>
            <div class="plugin-main-container">
                <nav class="plugin-side-nav">
                    <div class="nav-group" id="nav-top"></div>
                    <div class="nav-group" id="nav-bottom"></div>
                </nav>
                <main class="plugin-content-panel" id="panel-body"></main>
            </div>
        `;
        panelShadowRoot.appendChild(panel);
        const logoEl = panel.querySelector(".plugin-top-logo");
        if (logoEl) {
            // Click on logo icon to take screenshot
            const logoImg = logoEl.querySelector("img");
            if (logoImg) {
                logoImg.onclick = (e) => {
                    e.stopPropagation();
                    if (!IS_DEBUG_MODE) return;
                    if (typeof html2canvas === 'undefined') {
                        showToast("截图组件尚未加载完成，请稍后再试");
                        return;
                    }
                    takePanelScreenshot();
                };
                refreshLogoDebugCaptureState();
            }

            // Click on other parts of the top area to collapse/expand
            logoEl.onclick = (e) => {
                if (e.target === logoImg) return;
                appState.isCollapsed = !appState.isCollapsed;
                const box = panelShadowRoot.querySelector('.ai-summary-plugin-box');
                box.classList.toggle('is-collapsed', appState.isCollapsed);
                if (!appState.isCollapsed) syncPluginHeight();
            };
        }

        // Ensure progress bar is hidden initially
        const bar = panel.querySelector("#step-progress-bar");
        if (bar) {
            bar.classList.remove("loading", "error");
            bar.style.opacity = "0";
            bar.style.transform = "scaleX(0)";
        }
        
        // Initialize ResizeObserver for dynamic height
        initResizeObserver();
    }

    // 挂载到 DOM
    // 严禁使用 innerHTML 操作 B 站节点
    // 使用 prepend 插入到 rightContainer
    if (rightContainer && !rightContainer.contains(rootHost)) {
        // 尝试插到 up-panel-container 之后，或者作为第一个/最后一个子元素
        const upPanel = rightContainer.querySelector(".up-panel-container");
        if (upPanel) {
            upPanel.after(rootHost);
        } else {
            // 如果没有 up 面板，插到最前面，确保在推荐列表上方
            rightContainer.prepend(rootHost);
        }
    } else {
         // 兜底：如果找不到右侧栏，挂到 body
        if (!document.body.contains(rootHost)) {
            document.body.appendChild(rootHost);
            rootHost.style.position = "fixed";
            rootHost.style.top = "100px";
            rootHost.style.right = "20px";
            rootHost.style.zIndex = "10001";
        }
    }
    
    // Initial height sync
    setTimeout(syncPluginHeight, 500);
    setTimeout(() => {
        if (rootHost.style.opacity !== "1") rootHost.style.opacity = "1";
    }, 800);
}

function initResizeObserver() {
    if (playerResizeObserver) {
        playerResizeObserver.disconnect();
    }
    
    // Observe video player container
    const playerContainer = document.querySelector("#bilibili-player") || document.querySelector(".player-container");
    const videoArea = document.querySelector(".bpx-player-video-area");
    
    playerResizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(syncPluginHeight);
    });
    
    if (playerContainer) playerResizeObserver.observe(playerContainer);
    if (videoArea) playerResizeObserver.observe(videoArea);
    
    // Also observe window resize
    window.addEventListener("resize", () => requestAnimationFrame(syncPluginHeight));
}

function syncPluginHeight() {
    if (appState.isCollapsed) return;
    const box = panelShadowRoot ? panelShadowRoot.querySelector(".ai-summary-plugin-box") : null;
    if (!box) return;

    // 1. Video Player Area
    const videoArea = document.querySelector(".bpx-player-video-area") || document.querySelector(".video-container-v1") || document.querySelector("#bilibili-player");
    // 2. Sending Bar
    const sendingBar = document.querySelector(".bpx-player-sending-bar") || document.querySelector(".player-sending-bar");
    // 3. Toolbar (below sending bar)
    const toolbar = document.querySelector(".video-toolbar-container") || document.querySelector("#arc_toolbar_report");

    let totalHeight = 0;
    
    if (videoArea) totalHeight += videoArea.getBoundingClientRect().height;
    if (sendingBar) totalHeight += sendingBar.getBoundingClientRect().height;
    if (toolbar) totalHeight += toolbar.getBoundingClientRect().height;

    // Fallback default if detection fails or height is too small
    if (totalHeight < 300) {
        totalHeight = 600; // Reasonable default
    }
    appState.panelMaxHeight = totalHeight;

    box.style.height = `${totalHeight}px`;
    box.style.maxHeight = `${totalHeight}px`;
    if (appState.activePage === "summary") {
        const summaryPanel = panelShadowRoot ? panelShadowRoot.getElementById("page-summary") : null;
        if (summaryPanel) {
            if (appState.segmentsCollapsed) {
                requestAnimationFrame(() => applyExpandedSegmentsLayout(summaryPanel));
            } else {
                requestAnimationFrame(() => applySummaryRatio(summaryPanel));
            }
        }
    }
}

// 移除 syncPanelPosition 相关逻辑，因为不再需要 fixed 定位同步
function waitForElement(selector, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (document.querySelector(selector)) { resolve(); return; }
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(); }, timeoutMs);
    });
}

function showStepProgress(percent) {
    updateProgress(percent, appState.progressTaskId || "manual");
}

function resetStepProgressBar(bar) {
    if (!bar) return;
    bar.classList.remove("loading", "error");
    bar.style.transition = "none";
    bar.style.opacity = "0";
    bar.style.transform = "scaleX(0)";
    void bar.offsetWidth;
    bar.style.transition = "";
}

function clearStepProgressTimers() {
    if (appState.progressTimeoutTimer) {
        clearTimeout(appState.progressTimeoutTimer);
        appState.progressTimeoutTimer = null;
    }
    if (appState.progressResetTimer) {
        clearTimeout(appState.progressResetTimer);
        appState.progressResetTimer = null;
    }
    if (appState.progressFadeTimer) {
        clearTimeout(appState.progressFadeTimer);
        appState.progressFadeTimer = null;
    }
}

function clearPseudoProgressTicker() {
    if (appState.pseudoProgressTimer) {
        clearInterval(appState.pseudoProgressTimer);
        appState.pseudoProgressTimer = null;
    }
}

function startAsymptoticPseudoProgress(taskId, initialPercent) {
    const nextTaskId = String(taskId || "tasks:unknown");
    const initial = Math.max(5, Math.min(60, Number(initialPercent) || 12));
    if (appState.pseudoProgressTaskId !== nextTaskId) {
        clearPseudoProgressTicker();
        appState.pseudoProgressTaskId = nextTaskId;
        appState.pseudoProgressValue = initial;
        appState.pseudoProgressStartedAt = Date.now();
        updateProgress(appState.pseudoProgressValue, nextTaskId);
    } else if (appState.pseudoProgressValue < initial) {
        appState.pseudoProgressValue = initial;
        updateProgress(appState.pseudoProgressValue, nextTaskId);
    }
    if (appState.pseudoProgressTimer) return;
    appState.pseudoProgressTimer = setInterval(() => {
        if (appState.pseudoProgressTaskId !== nextTaskId) {
            clearPseudoProgressTicker();
            return;
        }
        const elapsedSec = Math.max(0, (Date.now() - Number(appState.pseudoProgressStartedAt || Date.now())) / 1000);
        const asymptote = 92;
        const base = asymptote - (asymptote - initial) * Math.exp(-elapsedSec / 6);
        const next = Math.max(appState.pseudoProgressValue, Math.min(asymptote, base));
        if (next > appState.pseudoProgressValue) {
            appState.pseudoProgressValue = next;
            updateProgress(appState.pseudoProgressValue, nextTaskId);
        }
    }, 450);
}

function finishAsymptoticPseudoProgress(taskId, failed) {
    const activeTaskId = String(taskId || appState.pseudoProgressTaskId || appState.progressTaskId || "tasks:unknown");
    clearPseudoProgressTicker();
    appState.pseudoProgressTaskId = "";
    appState.pseudoProgressValue = 0;
    appState.pseudoProgressStartedAt = 0;
    if (failed) {
        updateProgress(100, activeTaskId, { error: true });
        return;
    }
    updateProgress(100, activeTaskId);
}

function scheduleStepProgressTimeout(taskId) {
    if (appState.progressTimeoutTimer) {
        clearTimeout(appState.progressTimeoutTimer);
    }
    appState.progressTimeoutTimer = setTimeout(() => {
        if (appState.progressTaskId !== taskId) return;
        if (String(taskId || "").startsWith("transcribe:") && isAsrSessionActiveForCurrent()) return;
        updateProgress(0, taskId, { force: true });
    }, STEP_PROGRESS_TIMEOUT_MS);
}

function scheduleProgressFadeOut(taskId) {
    const bar = panelShadowRoot ? panelShadowRoot.getElementById("step-progress-bar") : null;
    if (!bar) return;
    const nextTaskId = String(taskId || "global");
    if (appState.progressResetTimer) clearTimeout(appState.progressResetTimer);
    appState.progressResetTimer = setTimeout(() => {
        if (appState.progressTaskId !== nextTaskId) return;
        bar.style.opacity = "0";
        appState.progressFadeTimer = setTimeout(() => {
            if (appState.progressTaskId !== nextTaskId) return;
            bar.style.transition = "none";
            bar.style.transform = "scaleX(0)";
            void bar.offsetWidth;
            bar.style.transition = "";
            appState.progressTaskId = "";
            appState.progressLastTick = 0;
            appState.progressLastPercent = 0;
            
        }, 520);
    }, 2000);
}

function updateProgress(percent, taskId, options) {
    const bar = panelShadowRoot ? panelShadowRoot.getElementById("step-progress-bar") : null;

    const opts = options && typeof options === "object" ? options : {};
    const nextTaskId = String(taskId || "global");
    const previousTaskId = String(appState.progressTaskId || "");
    const previousPercent = Number(appState.progressLastPercent || 0);

    if (!bar) {
        logAsrUiTrace("progress_skip_no_bar", {
            requested_percent: Number(percent) || 0,
            task_id: nextTaskId,
            options: opts,
            previous_task_id: previousTaskId,
            previous_percent: previousPercent
        });
        return;
    }

    let clamped = Math.max(0, Math.min(100, Number(percent) || 0));

    const hasActiveTask = !!appState.progressTaskId;
    const sameTask = appState.progressTaskId === nextTaskId;

    // 核心修复：同一个任务进行中，进度只允许前进，不允许回退
    // 例如 Groq 可能回传 10 → 45 → 30 → 70
    // UI 应该显示为 10 → 45 → 45 → 70
    if (
        sameTask &&
        !opts.force &&
        !opts.error &&
        clamped > 0 &&
        clamped < 100 &&
        Number(appState.progressLastPercent || 0) > clamped
    ) {
        clamped = Number(appState.progressLastPercent || clamped);
    }

    logAsrUiTrace("progress_update", {
        requested_percent: Number(percent) || 0,
        final_percent: clamped,
        task_id: nextTaskId,
        previous_task_id: previousTaskId,
        previous_percent: previousPercent,
        same_task: sameTask,
        has_active_task: hasActiveTask,
        options: opts,
        session: {
            active: !!appState.asrSession?.active,
            bvid: appState.asrSession?.bvid || "",
            stage: appState.asrSession?.stage || "",
            progress: Number(appState.asrSession?.progress || 0)
        }
    });

    // 记录当前任务的最大进度
    appState.progressTaskId = nextTaskId;
    appState.progressLastPercent = clamped;
    appState.progressLastTick = Date.now();

    if (appState.pseudoProgressTaskId && appState.pseudoProgressTaskId !== nextTaskId) {
        clearPseudoProgressTicker();
        appState.pseudoProgressTaskId = "";
        appState.pseudoProgressValue = 0;
        appState.pseudoProgressStartedAt = 0;
    }

    if (hasActiveTask && appState.progressTaskId !== nextTaskId) {
        resetStepProgressBar(bar);
        appState.progressLastPercent = 0;
    }

    clearStepProgressTimers();

    if (clamped <= 0) {
        if (!opts.force && hasActiveTask && appState.progressTaskId !== nextTaskId) return;

        resetStepProgressBar(bar);
        appState.progressTaskId = "";
        appState.progressLastTick = 0;
        appState.progressLastPercent = 0;
        return;
    }

    appState.progressTaskId = nextTaskId;
    appState.progressLastTick = Date.now();

    bar.classList.remove("error");
    bar.style.opacity = "1";
    bar.style.transform = `scaleX(${clamped / 100})`;

    if (opts.error) {
        bar.classList.remove("loading");
        bar.classList.add("error");
        scheduleProgressFadeOut(nextTaskId);
        return;
    }

    if (clamped < 100) {
        bar.classList.add("loading");
        scheduleStepProgressTimeout(nextTaskId);
        return;
    }

    bar.classList.remove("loading");
    scheduleProgressFadeOut(nextTaskId);
}


function syncStepProgressByTaskState(tabState) {
    const currentBvid = normalizeBvidCase(resolveCurrentBvid() || "");
    const stateBvid = normalizeBvidCase(tabState?.activeBvid || "");
    
    if (currentBvid && stateBvid && currentBvid !== stateBvid) return;
    
    if (String(appState.progressTaskId || "").startsWith("transcribe:")) return;
    const rawTaskStatus = tabState?.taskStatus || {};
    const taskStatus = Object.fromEntries(
        Object.entries(rawTaskStatus).filter(([key]) => key !== "chat")
    );
    const entries = Object.entries(taskStatus);
    if (!entries.length) return;
    const processingTasks = entries
        .filter(([, value]) => value === "processing")
        .map(([key]) => key)
        .sort();
    const activeTaskId = appState.pseudoProgressTaskId
        || (String(appState.progressTaskId || "").startsWith("tasks:") ? appState.progressTaskId : "");
    if (processingTasks.length) {
        if (!activeTaskId) return;
        startAsymptoticPseudoProgress(buildTasksProgressTaskId(processingTasks), 18);
        return;
    }
    const hasError = entries.some(([, value]) => value === "error" || value === "timeout");
    if (hasError) {
        if (!activeTaskId) return;
        finishAsymptoticPseudoProgress(activeTaskId, true);
        return;
    }
    const hasDone = entries.some(([, value]) => value === "done");
    if (hasDone) {
        if (!activeTaskId) return;
        finishAsymptoticPseudoProgress(activeTaskId, false);
    }
}

async function loadBootstrapData() {
    const res = await chrome.runtime.sendMessage({ action: "GET_BOOTSTRAP", skipCloud: true });
    if (!res?.ok) {
        showToast(res?.error || "初始化失败");
        return;
    }
    appState.tabId = res?.tabId || null;
    appState.tabState = res?.tabState || null;
    const routeBvid = normalizeBvidCase(getBvidFromUrl(location.href) || "");
    const bootstrapBvid = normalizeBvidCase(routeBvid || appState.tabState?.activeBvid || "");
    if (routeBvid) {
        appState.tabState = {
            ...(appState.tabState || {}),
            activeBvid: routeBvid
        };
    }
    const bootstrapCache = res?.cache || null;
    appState.cache = bootstrapCache && normalizeBvidCase(bootstrapCache?.bvid || "") === bootstrapBvid ? bootstrapCache : null;
    appState.settings = res?.settings || null;
    appState.providers = res?.providers || null;
    let previewTarget = null;
    try {
        const previewRes = await chrome.storage.local.get([SETUP_PREVIEW_STORAGE_KEY]);
        previewTarget = previewRes?.[SETUP_PREVIEW_STORAGE_KEY] || null;
    } catch (_) {}
    const previewBvid = normalizeBvidCase(previewTarget?.bvid || "");
    const previewFresh = Date.now() - Number(previewTarget?.createdAt || 0) < SETUP_PREVIEW_MAX_AGE_MS;
    if (previewFresh && previewBvid && previewBvid === bootstrapBvid) {
        appState.activePage = "summary";
        try {
            await chrome.storage.local.remove([SETUP_PREVIEW_STORAGE_KEY]);
        } catch (_) {}
    } else {
        // 首次加载固定展示 CC，让用户先看到字幕检测状态
        appState.activePage = "CC";
    }
}

function renderApp() {
    bindPanelDelegatedEvents();
    renderNav();
    renderContent();
    renderTopRemaining();
    maybeAutoShowSetupGuideOnFirstRun();
    globalThis.BilitatoReleaseNotice?.maybeShowReleaseNotice({
        root: panelShadowRoot,
    });
}

// Backdoor mechanism
let logoClickCount = 0;
let logoClickTimer = null;

function refreshLogoDebugCaptureState() {
    if (!panelShadowRoot) return;
    const logoImg = panelShadowRoot.querySelector(".plugin-top-logo img:not(.logo-info-icon)");
    if (!logoImg) return;
    logoImg.style.cursor = IS_DEBUG_MODE ? "pointer" : "default";
    logoImg.title = IS_DEBUG_MODE ? "点击截图当前面板" : "";
}

function syncRuntimeDebugModeToBackground() {
    try {
        const result = chrome.runtime?.sendMessage?.({
            action: "SET_RUNTIME_DEBUG",
            enabled: isDebugLoggingEnabled(),
            source: "content_debug_toggle"
        });
        if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (_) {}
}

function bindPanelDelegatedEvents() {
    const panelRoot = panelShadowRoot ? panelShadowRoot.querySelector(".ai-summary-plugin-box") : null;
    if (!panelRoot || panelRoot.dataset.bound === "1") return;
    panelRoot.dataset.bound = "1";
    panelRoot.addEventListener("click", (event) => {
        const inCopyMenu = event.target.closest(".copy-menu-overlay");
        if (!inCopyMenu && !event.target.closest('[data-nav="copy"]')) {
            closeCopyMenu();
        }
        const navNode = event.target.closest("[data-nav]");
        if (navNode && navNode.dataset.nav === "settings") {
            logoClickCount++;
            if (logoClickTimer) clearTimeout(logoClickTimer);
            logoClickTimer = setTimeout(() => {
                logoClickCount = 0;
            }, 2000);
            
            if (logoClickCount >= 5) {
                IS_DEBUG_MODE = !IS_DEBUG_MODE;
                globalThis.AIPluginLogger?.setDebugEnabled?.(isDebugLoggingEnabled());
                syncRuntimeDebugModeToBackground();
                showToast(`Debug Mode ${IS_DEBUG_MODE ? "Enabled" : "Disabled"}`);
                logoClickCount = 0;
                refreshLogoDebugCaptureState();
                if (!IS_DEBUG_MODE && appState.activePage === "debug") {
                    appState.activePage = "settings";
                }
                renderNav();
                renderContent();
                // Sync to inject script if possible (optional)
            }
        }
        
        const logoTitleNode = event.target.closest(".logo-title");
        if (navNode) {
            const navId = navNode.dataset.nav;
            if (navId === "copy") {
                const hadMenu = !!document.getElementById("copy-option-menu");
                handleSmartCopy(navNode);
                const hasMenu = !!document.getElementById("copy-option-menu");
                if (appState.activePage === "CC" && (hadMenu || hasMenu)) {
                    setNavActionActive(hasMenu ? "copy" : "");
                } else {
                    setNavActionActive("copy", 900);
                }
                return;
            }
            if (navId === "export") {
                toggleExportMenu(navNode);
                return;
            }
            logUI.info("ui_tab_switch", { tab: navId });
            if (navId === "chat") {
                appState.chatJustSwitched = true;
                const chatPanel = panelShadowRoot ? panelShadowRoot.getElementById("page-chat") : null;
                if (chatPanel) chatPanel.dataset.lastSignature = "";
            }
            if (navId === "debug" && appState.activePage !== "debug") {
                logUI.info("debug_page_open", { task: "debug" });
            }
            appState.activePage = navId;
            setNavActionActive("");
            renderNav();
            renderContent();
            return;
        }
        const transcribeNode = event.target.closest("#start-groq-transcribe");
        if (transcribeNode) {
            startTranscriptionFromCapsule();
            return;
        }
        const actionNode = event.target.closest("[data-action]");
        if (!actionNode) return;
        const action = actionNode.dataset.action;
        if (action === "run-summary") {
            logUI.info("ui_generate_summary", { tab_id: appState.tabId || null });
            logUI.info("ui_generate_segments", { tab_id: appState.tabId || null });
            runTasks(["summary", "segments"]);
            return;
        }
        if (action === "run-rumors") {
            logUI.info("ui_generate_rumor", { tab_id: appState.tabId || null });
            runTasks(["rumors"]);
            return;
        }
        if (action === "summary-copy") {
            handleCopySummaryText(actionNode);
            return;
        }
        if (action === "segment-jump") {
            jumpTo(Number(actionNode.dataset.start || 0));
            return;
        }
        if (action === "chat-copy") {
            const text = String(actionNode.dataset.text || "").trim();
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
                showToast("已复制");
            }).catch(() => {
                showToast("复制失败");
            });
            return;
        }
        if (action === "copy-with-time") {
            closeCopyMenu();
            handleCopySubtitleWithTimestamp();
            return;
        }
        if (action === "copy-without-time") {
            closeCopyMenu();
            handleCopyRawSubtitle();
            return;
        }
        if (action === "copy-all") {
            handleCopyRawSubtitle(actionNode);
            return;
        }
        if (action === "export-srt") {
            handleExportSrt(actionNode);
            return;
        }
        if (action === "download-video") {
            handleDownloadMedia("video", actionNode);
            return;
        }
        if (action === "download-audio") {
            handleDownloadMedia("audio", actionNode);
            return;
        }
        if (action === "summary-expand") {
            const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-summary") : null;
            const summaryCard = panel ? panel.querySelector(".summary-card-fixed") : null;
            if (summaryCard && !appState.segmentsCollapsed) {
                appState.expandedSummaryHeight = summaryCard.getBoundingClientRect().height;
            }
            appState.segmentsCollapsed = !appState.segmentsCollapsed;
            if (!appState.segmentsCollapsed) {
                appState.expandedSummaryHeight = 0;
                // 收起时恢复正常高度
                if (panel) {
                    panel.dataset.lastSignature = "";
                    renderSummary(panel);
                }
                syncPluginHeight();
            } else {
                // 展开时只让 applyExpandedSegmentsLayout 负责高度
                if (panel) {
                    panel.dataset.lastSignature = "";
                    renderSummary(panel);
                }
                requestAnimationFrame(() => {
                    const summaryPanel = panelShadowRoot ? panelShadowRoot.getElementById("page-summary") : null;
                    if (summaryPanel) applyExpandedSegmentsLayout(summaryPanel);
                });
            }
            return;
        }
        if (action === "settings-save") {
            saveSettingsFromPanel();
            return;
        }
        if (action === "summary-mode-notice-dismiss") {
            const nextSettings = { ...(appState.settings || {}), summaryModeNoticeSeen: true };
            appState.settings = nextSettings;
            chrome.storage.local.set({ settings: nextSettings }).catch?.(() => {});
            const notice = actionNode.closest(".summary-mode-notice");
            if (notice) notice.remove();
            const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-summary") : null;
            if (panel) panel.dataset.lastSignature = "";
            renderContent();
            return;
        }
        if (action === "summary-refresh-subtitle-cache") {
            const target = normalizeBvidCase(resolveCurrentBvid() || "");
            if (target) {
                appState.cloudReadState = createCloudReadState(target, "idle", Number(appState.cloudReadState?.requestId || 0) + 1);
                startCloudReadForCurrentVideo({ bvid: target, silent: false });
            }
            return;
        }
        if (action === "goto-cc-tab") {
            appState.activePage = "CC";
            renderNav();
            renderContent();
            return;
        }
        if (action === "settings-toggle-secret") {
            const targetId = String(actionNode.dataset.target || "").trim();
            const input = targetId && panelShadowRoot ? panelShadowRoot.getElementById(targetId) : null;
            if (input) {
                const nextVisible = input.type === "password";
                input.type = nextVisible ? "text" : "password";
                actionNode.textContent = nextVisible ? "隐藏" : "显示";
                actionNode.setAttribute("aria-label", nextVisible ? "隐藏密钥明文" : "显示密钥明文");
            }
            return;
        }
        if (action === "open-feedback") {
            window.open("https://www.wenjuan.com/s/UZBZJvus3xI/", "_blank", "noopener,noreferrer");
            return;
        }
        if (action === "open-help") {
            window.open("https://ncnp7ti79hnh.feishu.cn/wiki/AMVswpIdZiufLukZ3x0cMTWJnge#share-JpZDddCK5oZWcyxlbJJcijLBnIe", "_blank", "noopener,noreferrer");
            return;
        }
        if (action === "open-review") {
            window.open("https://chromewebstore.google.com/detail/bilitato-ai%E9%99%AA%E4%BD%A0%E7%9C%8Bb%E7%AB%99/ggddcgdafeeoijoaohcffinbefcbpcga/reviews", "_blank", "noopener,noreferrer");
            return;
        }
        if (action === "settings-authorize-custom-origin") {
            authorizeCustomOriginFromPanel();
            return;
        }
        if (action === "settings-open-reg") {
            const url = String(actionNode.dataset.url || "").trim();
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            return;
        }
        if (action === "open-external-url") {
            const url = String(actionNode.dataset.url || "").trim();
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            return;
        }
        if (action === "refresh-page") {
            window.location.reload();
            return;
        }
        if (action === "settings-open-guide") {
            showSetupGuide();
            return;
        }
        if (action === "goto-setup-guide") {
            appState.activePage = "settings";
            renderNav();
            renderContent();
            showSetupGuide();
            return;
        }
        if (action === "settings-reset-prompts") {
            const settingsPanel = panelShadowRoot ? panelShadowRoot.getElementById("page-settings") : null;
            const mode = String(settingsPanel?.querySelector("#settings-prompt-mode")?.value || "guided");
            if (mode === "custom") {
                const summaryInput = settingsPanel?.querySelector("#settings-prompt-summary");
                const segmentsInput = settingsPanel?.querySelector("#settings-prompt-segments");
                const rumorsInput = settingsPanel?.querySelector("#settings-prompt-rumors");
                if (summaryInput) summaryInput.value = TASK_PROMPTS_DEFAULT.summary;
                if (segmentsInput) segmentsInput.value = TASK_PROMPTS_DEFAULT.segments;
                if (rumorsInput) rumorsInput.value = TASK_PROMPTS_DEFAULT.rumors;
            } else {
                const toneSelect = settingsPanel?.querySelector("#settings-prompt-tone");
                const detailSelect = settingsPanel?.querySelector("#settings-prompt-detail");
                if (toneSelect) toneSelect.value = "balanced";
                if (detailSelect) detailSelect.value = "normal";
            }
            saveSettingsFromPanel(true);
            return;
        }
        if (action === "debug-error-demo") {
            runErrorDisplayDemo(actionNode.dataset.code || "", actionNode.dataset.target || "summary");
            return;
        }
        if (action === "debug-clear-errors") {
            logUI.info("debug_clear_errors", { task: "debug" });
            appState.panelErrors = {};
            renderContent();
            showToast("已清空错误测试状态");
            return;
        }
        if (action === "debug-show-release-notice") {
            globalThis.BilitatoReleaseNotice?.renderReleaseNotice?.({
                root: panelShadowRoot,
                version: "1.2.3"
            });
            return;
        }
        if (action === "follow-now") {
            appState.followEnabled = true;
            appState.followPausedAt = 0;
            scrollToCurrentSubtitle(true);
            toggleFollowButton();
            return;
        }
        if (action === "chat-send") {
            logUI.info("ui_chat_send", { tab_id: appState.tabId || null });
            dismissChatGuide();
            hideChatGuideNodes(document.getElementById("page-chat"));
            handleSendChat();
            return;
        }
        if (action === "chat-stop") {
            handleStopChat();
            return;
        }
        if (action === "chat-suggest") {
            const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-chat") : null;
            const input = panel?.querySelector("#chat-input");
            const text = String(actionNode.dataset.text || "").trim();
            if (input && text) {
                input.value = text;
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
                dismissChatGuide();
                hideChatGuideNodes(panel);
            }
            return;
        }
        if (action === "logs-refresh") {
            renderLogWindowData();
            return;
        }
        if (action === "logs-copy") {
            copyLogWindowData();
            return;
        }
        if (action === "logs-close") {
            closeLogWindow();
            return;
        }
        if (action === "cc-regenerate-transcribe") {
            handleRegenerateGroqSubtitle();
            return;
        }
        if (action === "transcription-start") {
            startTranscriptionFromCapsule();
        }
    });
}

function setNavActionActive(navId, durationMs) {
    const nextId = String(navId || "");
    if (appState.navActionActiveTimer) {
        clearTimeout(appState.navActionActiveTimer);
        appState.navActionActiveTimer = null;
    }
    if (appState.navActionActive !== nextId) {
        appState.navActionActive = nextId;
        renderNav();
    }
    const timeoutMs = Number(durationMs || 0);
    if (!nextId || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    appState.navActionActiveTimer = setTimeout(() => {
        appState.navActionActiveTimer = null;
        if (appState.navActionActive !== nextId) return;
        appState.navActionActive = "";
        renderNav();
    }, timeoutMs);
}

function renderNav() {
    if (!panelShadowRoot) return;
    const top = panelShadowRoot.getElementById("nav-top");
    const bottom = panelShadowRoot.getElementById("nav-bottom");
    if (!top || !bottom) return;

    const items = [
        { id: "CC", file: "CC.png", slot: "top" },
        { id: "summary", file: "summary.png", slot: "top" },
        { id: "chat", file: "chat.png", slot: "top" },
        { id: "real", file: "real.png", slot: "top" },
        { id: "debug", file: "settings.png", slot: "top", label: "测试" },
        { id: "copy", file: "copy.png", slot: "bottom", label: "复制" },
        { id: "export", file: "download.png", slot: "bottom", label: "导出" },
        { id: "settings", file: "settings.png", slot: "bottom", label: "设置" }
    ];

    const renderedNavIds = new Set();

    items.forEach((item) => {
        const shouldRender = (() => {
            if (item.id === "debug" && !isDebugLoggingEnabled()) return false;
            if (appState.activePage === "summary") {
                return item.id !== "copy" && item.id !== "export";
            }
            if (appState.activePage === "chat" || appState.activePage === "real" || appState.activePage === "debug") {
                return item.id !== "copy" && item.id !== "export";
            }
            if (appState.activePage === "settings") {
                return item.id !== "copy" && item.id !== "export";
            }
            return true;
        })();

        if (!shouldRender) return;
        renderedNavIds.add(item.id);

        const activeVisual = appState.activePage === item.id || appState.navActionActive === item.id;
        const iconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/${activeVisual ? "active" : "default"}/${item.file}`);
        const container = item.slot === "top" ? top : bottom;
        let node = container.querySelector(`[data-nav='${item.id}']`);

        if (node) {
            // Update existing node
            node.className = `side-nav-item ${activeVisual ? "active" : ""}`;
            const img = node.querySelector("img");
            if (img && img.src !== iconSrc) {
                img.src = iconSrc;
            }
        } else {
            // Create new node
            node = document.createElement("button");
            node.type = "button";
            node.className = `side-nav-item ${activeVisual ? "active" : ""}`;
            node.dataset.id = item.id;
            node.dataset.nav = item.id;

            const img = document.createElement("img");
            img.src = iconSrc;
            img.alt = item.id;
            img.onload = () => img.classList.add("loaded");
            img.onerror = () => img.classList.add("loaded");
            node.appendChild(img);

            const fallback = document.createElement("span");
            fallback.className = "nav-fallback";
            fallback.textContent = item.label || item.id;
            node.appendChild(fallback);

            container.appendChild(node);
        }
    });

    // Remove obsolete buttons
    [...top.children, ...bottom.children].forEach(node => {
        const navId = node.dataset.nav;
        if (navId && !renderedNavIds.has(navId)) {
            node.remove();
        }
    });

    // Enforce order by appending nodes again
    items.forEach((item) => {
        if (!renderedNavIds.has(item.id)) return;
        const container = item.slot === "top" ? top : bottom;
        const node = container.querySelector(`[data-nav='${item.id}']`);
        if (node) {
            container.appendChild(node);
        }
    });
}

function renderContent() {
    const panel = panelShadowRoot ? panelShadowRoot.getElementById("panel-body") : null;
    if (!panel) return;
    if (appState.activePage !== "debug") stopRealtimeLogPolling();
    renderTopRemaining();
    ensureCloudReadForActivePage();

    const pages = ["CC", "summary", "chat", "real", "debug", "settings"];
    pages.forEach((id) => {
        if (id === "debug" && !isDebugLoggingEnabled()) {
            if (appState.activePage === "debug") appState.activePage = "settings";
            return;
        }
        let container = panelShadowRoot.getElementById(`page-${id}`);
        if (!container) {
            container = document.createElement("div");
            container.id = `page-${id}`;
            container.className = "plugin-page-container";
            container.style.display = "none";
            panel.appendChild(container);
        }

        if (appState.activePage === id) {
            container.style.display = "flex";
            if (id === "CC") renderCC(container);
            else if (id === "chat") renderChat(container);
            else if (id === "summary") renderSummary(container);
            else if (id === "real") renderReal(container);
            else if (id === "debug") renderDebugPanel(container);
            else if (id === "settings") renderSettings(container);
        } else {
            container.style.display = "none";
        }
    });
    
    syncPanelHeightMode();
    renderSubtitleTimelinePanel(panel);
    renderSegmentsFloatWindow();
    renderSegmentsProgressMarkers();
    ensureSegmentsVideoEvents();
}

async function takePanelScreenshot() {
    const pluginBox = panelShadowRoot ? panelShadowRoot.querySelector(".ai-summary-plugin-box") : null;
    if (!pluginBox) {
        showToast("无法找到插件容器");
        return;
    }
    const screenshotFn = globalThis.html2canvas;
    if (typeof screenshotFn !== "function") {
        showToast("截图组件未加载，当前版本暂不支持截图");
        return;
    }

    try {
        const oldOverflow = pluginBox.style.overflow;
        const oldMaxHeight = pluginBox.style.maxHeight;
        
        // Temporarily adjust styles to capture full content if it scrolls
        pluginBox.style.overflow = 'visible';
        pluginBox.style.maxHeight = 'none';
        
        // We capture the whole plugin box, so no need to find the specific page body.
        
        const canvas = await screenshotFn(pluginBox, {
            backgroundColor: null,
            scale: 2,
            useCORS: true,
            logging: false,
            // Add padding to ensure box-shadow is not cropped (e.g. 10px on all sides)
            windowWidth: pluginBox.scrollWidth + 20,
            windowHeight: pluginBox.scrollHeight + 20,
            x: -10, // Offset to capture the shadow
            y: -10,
            width: pluginBox.offsetWidth + 20,
            height: pluginBox.offsetHeight + 20
        });
        
        // Restore styles
        pluginBox.style.overflow = oldOverflow;
        pluginBox.style.maxHeight = oldMaxHeight;

        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `Snapshot-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast("截图已保存");
    } catch (err) {
        logUI.error("screenshot_failed", {
            task: "ui",
            code: "SCREENSHOT_FAILED",
            detail: { error_message: err.message || "截图失败" }
        });
        showToast("截图失败");
    }
}

function renderSummary(panel) {
    const debugErrorView = appState.panelErrors?.summary;
    if (debugErrorView && renderErrorPanel) {
        panel.classList.remove("summary-no-apikey");
        panel.classList.remove("is-segments-expanded");
        panel.dataset.lastSignature = "";
        panel.innerHTML = `
            <div class="page-header">
                <h3>总结</h3>
            </div>
            ${renderErrorPanel(debugErrorView, "run-summary")}
        `;
        return;
    }
    const summary = appState.cache?.summary || "";
    const segments = Array.isArray(appState.cache?.segments) ? appState.cache.segments : [];
    const summaryStatus = getCurrentVideoTaskStatus("summary");
    const segmentsStatus = getCurrentVideoTaskStatus("segments");
    const isLoading = summaryStatus === "processing" || segmentsStatus === "processing";
    const hasContent = !!String(summary || "").trim() || segments.length > 0;
    const apiKey = String(appState.settings?.apiKey || "").trim();
    if (!apiKey && !hasContent) {
        panel.classList.add("summary-no-apikey");
        panel.classList.remove("is-segments-expanded");
        panel.dataset.lastSignature = "";
        if (isCloudReadLoadingForCurrentVideo()) {
            panel.innerHTML = renderCloudLoadingState("总结", "正在读取云端演示内容...");
            return;
        }
        panel.innerHTML = `
            <div class="no-apikey-notice">
                <div class="no-apikey-icon">🔑</div>
                <div class="no-apikey-text">暂未配置 API Key<br>请去设置里填写哦~</div>
                <button class="no-apikey-btn" data-action="goto-setup-guide">点此配置 →</button>
            </div>
        `;
        panel.scrollTop = 0;
        return;
    }
    panel.classList.remove("summary-no-apikey");

    const signature = JSON.stringify({
        summary,
        segmentsLength: segments.length,
        summaryStatus,
        segmentsStatus,
        cacheBvid: normalizeBvidCase(appState.cache?.bvid || ""),
        rawSubtitleLength: Array.isArray(appState.cache?.rawSubtitle) ? appState.cache.rawSubtitle.length : 0,
        processedSubtitleLength: Array.isArray(appState.cache?.processedSubtitle) ? appState.cache.processedSubtitle.length : 0,
        cloudReadStatus: String(appState.cloudReadState?.status || ""),
        subtitleSource: String(appState.cache?.subtitleSource || ""),
        summarySource: getTaskCacheSource(appState.cache, "summary"),
        segmentsSource: getTaskCacheSource(appState.cache, "segments"),
        sessionFresh: appState.sessionGeneratedTasks.has("summary") || appState.sessionGeneratedTasks.has("segments")
    });

    if (panel.dataset.lastSignature === signature && panel.innerHTML.trim()) return;
    panel.dataset.lastSignature = signature;

    const isFresh = appState.sessionGeneratedTasks.has("summary") || appState.sessionGeneratedTasks.has("segments");
    const segmentsNoTimestamp = isNoTimestampSubtitleCache(appState.cache) || segments.some((item) => item?.no_timestamp || item?.virtual_time);
    const cacheTag = buildCacheTagHtml(appState.cache, ["summary", "segments"], hasContent, isLoading, isFresh);
    const showModeNotice = !appState.settings?.summaryModeNoticeSeen && !isFresh;
    const isFastMode = (appState.settings?.prefMode || "quality") === "quality";
    const modeNoticeHtml = showModeNotice ? `
        <div class="summary-mode-notice">
            <div class="summary-mode-notice-text">
                <strong>当前为「${isFastMode ? "高速模式" : "省流模式"}」</strong>
                <span>${isFastMode
                    ? "会同时生成总结和分段，速度更快，但每次会消耗 2 次模型调用次数，你可以在设置中切换。"
                    : "本次会消耗 1 次模型调用，同时生成总结和分段。速度较慢、更省次数，你可以在设置中切换。"}</span>
            </div>
            <button type="button" class="summary-mode-notice-btn" data-action="summary-mode-notice-dismiss">知道了</button>
        </div>
    ` : "";
    const headerHtml = `
        <div class="page-header">
            <h3>总结 <div class="header-tags">${cacheTag}</div></h3>
        </div>
        ${modeNoticeHtml}
    `;

    if (!isLoading && (!hasContent || isTranscriptionRunning())) {
        panel.classList.remove("is-segments-expanded");
        const errorView = appState.panelErrors?.summary;
        if (errorView && renderErrorPanel) {
            panel.innerHTML = `
                ${headerHtml}
                ${renderErrorPanel(errorView, "run-summary")}
            `;
            return;
        }
        const hasSubtitle = hasUsableSubtitleCache(appState.cache, resolveCurrentBvid());
        const isCheckingSubtitleCache = !hasSubtitle && isCloudReadLoadingForCurrentVideo();
        let btnDisabled = isTranscriptionRunning() ? "disabled" : "";
        let tipText = hasSubtitle ? "去除噪音，抓住重点。" : "点击后将先检查字幕缓存。";
        let btnOpacity = isTranscriptionRunning() ? "0.5" : "1";
        let btnText = isCheckingSubtitleCache ? "检查并生成" : "生成 AI 总结";
        let extraActionsHtml = "";

        if (isTranscriptionRunning()) {
            btnDisabled = "disabled";
            tipText = "正在生成字幕，请稍候...";
            btnOpacity = "0.5";
            btnText = "生成 AI 总结";
        } else if (isCheckingSubtitleCache) {
            tipText = "正在检查字幕缓存，也可以直接点击生成重试。";
        } else if (!hasSubtitle) {
            panel.innerHTML = `
                ${headerHtml}
                ${renderMissingSubtitleState()}
            `;
            return;
        }
        
        panel.innerHTML = `
            ${headerHtml}
            <div class="page-body subtitle-empty-container">
                <div class="action-container">
                    <p class="action-tip">${tipText}</p>
                    <button class="action-btn" data-action="run-summary" ${btnDisabled} style="opacity: ${btnOpacity}">${btnText}</button>
                    ${extraActionsHtml}
                </div>
            </div>
        `;
        return;
    }

    const summarySkeleton = renderSkeletonLines(4, "summary-skeleton");
    const segmentsSkeleton = renderSkeletonLines(5, "segments-skeleton");
    const summaryIsLoading = summaryStatus === "processing";
    const segmentsIsLoading = segmentsStatus === "processing";
    const summaryBody = summary
        ? `<div class="result-text summary-result-text">${renderRichContent(summary)}</div>`
        : (summaryIsLoading ? summarySkeleton : `<div class="empty-text">尚未生成总结</div>`);
    
    const copyIconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/copy2.png`);
    const refreshIconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/refresh.png`);
    const actionButton = `<button class="panel-icon-btn" data-action="run-summary" title="重新生成"><img src="${refreshIconSrc}" style="width:16px;height:16px;object-fit:contain;transform:scale(0.9);"></button>`;
    const copyBtn = summary ? `<button class="panel-icon-btn" data-action="summary-copy" title="复制"><img src="${copyIconSrc}" style="width:16px;height:16px;object-fit:contain;transform:scale(1);"></button>` : "";

    const isExpanded = !!appState.segmentsCollapsed;
    panel.classList.toggle("is-segments-expanded", isExpanded);

    const chevron = `<svg class="toggle-chevron" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
        style="width:12px;height:12px;">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`;

    const hasSegments = segments.length > 0 || segmentsIsLoading;
    const toggleBtn = hasSegments ? `
        <button class="segments-toggle-btn ${isExpanded ? "is-expanded" : ""}"
                data-action="summary-expand"
                title="${isExpanded ? "收起" : "展开完整分段"}">
            ${isExpanded ? "收起" : "展开"} ${chevron}
        </button>
    ` : "";

    const segmentListHtml = segments.length
        ? `<div class="segment-list">${segments.map((item) => {
                const itemNoTimestamp = segmentsNoTimestamp || item?.no_timestamp || item?.virtual_time;
                const lineStart = Number(item.start_line ?? item.ad_start_line);
                const lineEnd = Number(item.end_line ?? item.ad_end_line);
                const timeText = itemNoTimestamp
                    ? (Number.isInteger(lineStart) && Number.isInteger(lineEnd) ? `行 ${lineStart}-${lineEnd}` : "无时间轴")
                    : `${formatTime(item.start)}-${formatTime(item.end)}`;
                const actionAttrs = itemNoTimestamp
                    ? `disabled title="该字幕没有真实时间轴，无法跳转到具体时间"`
                    : `data-action="segment-jump" data-start="${item.start}"`;
                return `
                <button class="segment-card ${item.type === "ad" ? "ad" : ""} ${itemNoTimestamp ? "no-timestamp" : ""}"
                        ${actionAttrs}>
                    <span class="seg-time">${escapeHtml(timeText)}</span>
                    <span class="seg-label">${escapeHtml(item.label)}</span>
                    ${item.type === "ad" ? '<span class="ad-tag">广告片段</span>' : ""}
                </button>`;
            }).join("")}
              </div>`
        : (segmentsIsLoading
        ? segmentsSkeleton
        : `<div class="empty-text">尚未生成分段</div>`);

    panel.innerHTML = `
        <div class="page-header">
            <h3>总结 <div class="header-tags">${cacheTag}</div></h3>
            <div class="summary-header-actions" style="display:flex;gap:6px;">
                ${copyBtn}
                ${actionButton}
            </div>
        </div>
        <div class="page-body">
            <div class="summary-card-fixed">
                ${summaryBody}
            </div>
            <div class="summary-resize-divider" id="summary-resize-divider"></div>
            <div class="summary-card-segments">
                <div class="segments-section-header">
                    <span class="segments-section-title">视频分段</span>
                    ${toggleBtn}
                </div>
                <div class="segments-body">
                    ${segmentListHtml}
                </div>
            </div>
        </div>
        ${renderMetricsBox()}
    `;
    const summaryCard = panel.querySelector(".summary-card-fixed");
    if (isExpanded && summaryCard) {
        const lockedSummaryHeight = appState.expandedSummaryHeight > 0
            ? appState.expandedSummaryHeight
            : summaryCard.getBoundingClientRect().height;
        if (lockedSummaryHeight > 0) {
            appState.expandedSummaryHeight = lockedSummaryHeight;
            summaryCard.style.height = `${Math.round(lockedSummaryHeight)}px`;
        } else {
            summaryCard.style.height = "";
        }
        requestAnimationFrame(() => applyExpandedSegmentsLayout(panel));
    } else {
        if (summaryCard) {
            // Recover from expanded mode first to avoid summary area occupying the whole page.
            summaryCard.style.height = "";
        }
        const segmentsBody = panel.querySelector(".segments-body");
        if (segmentsBody) {
            segmentsBody.style.maxHeight = "";
            segmentsBody.style.overflowY = "";
        }
        applySummaryRatio(panel);
    }
    bindSummaryResizeDivider(panel);
}

function applyExpandedSegmentsLayout(panel) {
    if (!appState.segmentsCollapsed) return;
    const box = panelShadowRoot ? panelShadowRoot.querySelector(".ai-summary-plugin-box") : null;
    const pageBody = panel.querySelector(".page-body");
    const summaryCard = panel.querySelector(".summary-card-fixed");
    const divider = panel.querySelector("#summary-resize-divider");
    const segmentsHeader = panel.querySelector(".segments-section-header");
    const segmentsBody = panel.querySelector(".segments-body");
    if (!box || !pageBody || !summaryCard || !segmentsBody || !segmentsHeader) return;

    const segmentList = segmentsBody.querySelector(".segment-list");
    const boxRect = box.getBoundingClientRect();
    const pageBodyRect = pageBody.getBoundingClientRect();
    const fixedOutsideBody = Math.max(0, pageBodyRect.top - boxRect.top);
    const summaryHeight = Math.max(0, Number(appState.expandedSummaryHeight || parseFloat(summaryCard.style.height || "0") || 0));
    if (summaryHeight > 0) {
        appState.expandedSummaryHeight = summaryHeight;
        summaryCard.style.height = `${Math.round(summaryHeight)}px`;
    }
    const dividerHeight = divider ? (divider.getBoundingClientRect().height || 8) : 8;
    const segmentsHeaderHeight = segmentsHeader.getBoundingClientRect().height || 0;
    const segmentContentHeight = segmentList ? segmentList.scrollHeight : segmentsBody.scrollHeight;
    const bodyStyle = window.getComputedStyle(pageBody);
    const gap = Math.max(0, parseFloat(bodyStyle.rowGap || bodyStyle.gap || "0") || 0);
    const gapCount = 2; // summary -> divider -> segments

    const neededBodyHeight = summaryHeight + dividerHeight + segmentsHeaderHeight + segmentContentHeight + (gap * gapCount);
    const neededBoxHeight = fixedOutsideBody + neededBodyHeight;
    // 展开时不限制最大高度，让容器自然撑开到刚好显示完分段
    const targetBoxHeight = Math.max(320, Math.ceil(neededBoxHeight));
    box.style.height = `${targetBoxHeight}px`;
    box.style.maxHeight = `${targetBoxHeight}px`;

    const maxSegmentsBodyHeight = targetBoxHeight - fixedOutsideBody - summaryHeight - dividerHeight - segmentsHeaderHeight - (gap * gapCount);
    segmentsBody.style.maxHeight = `${Math.max(80, Math.floor(maxSegmentsBodyHeight))}px`;
    segmentsBody.style.overflowY = "auto";
}

function applySummaryRatio(panel) {
    if (appState.segmentsCollapsed) return;
    const pageBody = panel.querySelector(".page-body");
    const summaryCard = panel.querySelector(".summary-card-fixed");
    if (!pageBody || !summaryCard) return;
    const ratio = Math.max(0.15, Math.min(0.85, Number(appState.summaryRatio) || 0.6));

    const tryApply = () => {
        const bodyHeight = pageBody.getBoundingClientRect().height;
        if (bodyHeight < 100) return false;
        const dividerH = 8;
        const availableH = Math.max(0, bodyHeight - dividerH);
        summaryCard.style.height = `${Math.round(availableH * ratio)}px`;
        return true;
    };

    if (!tryApply()) {
        // Fallback height to prevent segments pane from disappearing while waiting for layout.
        const panelHeight = panel.getBoundingClientRect().height;
        if (panelHeight >= 160) {
            const fallbackAvailable = Math.max(120, panelHeight - 64);
            summaryCard.style.height = `${Math.round(fallbackAvailable * ratio)}px`;
        }
        requestAnimationFrame(() => {
            if (tryApply()) return;
            requestAnimationFrame(() => {
                tryApply();
            });
        });
    }
}

function bindSummaryResizeDivider(panel) {
    const divider = panel.querySelector("#summary-resize-divider");
    const pageBody = panel.querySelector(".page-body");
    const summaryCard = panel.querySelector(".summary-card-fixed");
    if (!divider || !pageBody || !summaryCard) return;

    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e) => {
        const bodyRect = pageBody.getBoundingClientRect();
        const dividerH = 8;
        const availableH = bodyRect.height - dividerH;
        const delta = e.clientY - startY;
        const newSummaryH = Math.max(60, Math.min(availableH - 60, startHeight + delta));
        const newRatio = newSummaryH / availableH;
        appState.summaryRatio = Math.max(0.15, Math.min(0.85, newRatio));
        summaryCard.style.height = `${newSummaryH}px`;
        if (appState.segmentsCollapsed) {
            appState.expandedSummaryHeight = newSummaryH;
            applyExpandedSegmentsLayout(panel);
        }
    };

    const onMouseUp = () => {
        divider.classList.remove("dragging");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
    };

    divider.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startY = e.clientY;
        startHeight = summaryCard.getBoundingClientRect().height;
        divider.classList.add("dragging");
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });
}

function renderCC(panel, rowsOverride) {
    const currentBvid = normalizeBvidCase(appState.tabState?.activeBvid || getBvidFromUrl(location.href) || "");
    const cacheBvid = normalizeBvidCase(appState.cache?.bvid || "");
    const cacheReadyForCurrent = !!currentBvid && cacheBvid === currentBvid;
    const rows = Array.isArray(rowsOverride) ? rowsOverride : (cacheReadyForCurrent ? getRawSubtitleRowsFromCache(appState.cache) : []);
    if (!Array.isArray(rowsOverride) && cacheBvid && currentBvid && cacheBvid !== currentBvid) {
        logContent.warn("cc_cache_mismatch_drop", {
            task: "subtitle",
            bvid: currentBvid,
            code: "CC_CACHE_BVID_MISMATCH",
            detail: {
                cache_bvid: cacheBvid,
                row_count: getRawSubtitleRowsFromCache(appState.cache).length
            }
        });
    }
    const subtitleSource = String(appState.tabState?.subtitleSource || "");

    const transcription = getTranscriptionState();

    const currentBvidForProgress = normalizeBvidCase(currentBvid || getStableCurrentBvid() || "");
    const tabStateBvidForProgress = normalizeBvidCase(appState.tabState?.activeBvid || "");
    const transcriptionBvidForProgress = normalizeBvidCase(transcription.bvid || "");
    const pendingTranscriptionForCurrent = isLocalPendingTranscriptionForCurrent(currentBvidForProgress);
    const asrSessionForCurrent = isAsrSessionActiveForCurrent(currentBvidForProgress);

    const tabProgressBelongsToCurrent =
        !!currentBvidForProgress &&
        !!tabStateBvidForProgress &&
        currentBvidForProgress === tabStateBvidForProgress;

    const localProgressBelongsToCurrent =
        !!currentBvidForProgress &&
        (
            (!!transcriptionBvidForProgress && currentBvidForProgress === transcriptionBvidForProgress) ||
            pendingTranscriptionForCurrent
        );

    const stateProgress = tabProgressBelongsToCurrent
        ? Math.max(0, Math.min(100, Number(appState.tabState?.transcriptionProgress ?? 0)))
        : 0;

    const localProgress = localProgressBelongsToCurrent
        ? Math.max(0, Math.min(100, Number(transcription.progress ?? 0)))
        : 0;

    const running = asrSessionForCurrent || ((isTranscriptionRunning() || pendingTranscriptionForCurrent) && localProgressBelongsToCurrent);
    const sessionProgress = asrSessionForCurrent
        ? Math.max(0, Math.min(100, Number(appState.asrSession?.progress ?? 0)))
        : 0;
    const progress = running ? Math.max(stateProgress, localProgress, sessionProgress) : 0;

    const isAsrSubtitle = subtitleSource === "groq" || subtitleSource === "whisper" || subtitleSource === "siliconflow" || subtitleSource === "funasr";
    const isNoTimestampSubtitle = subtitleSource === "siliconflow" || subtitleSource === "funasr";
    const shouldShowRegenerate = rows.length > 0 && isAsrSubtitle && !running;

    const subtitleCacheSource = String(appState.cache?.subtitleCacheSource || "").toLowerCase();
    const sourceText = running
        ? (appState.asrSession?.statusText || transcription.statusText || "正在转录音轨...")
        : rows.length
        ? (subtitleCacheSource === "cloud" ? "云端缓存" : (isAsrSubtitle ? "ASR转录生成" : "官方AI字幕"))
        : "未检测到字幕";
    const refreshIconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/refresh.png`);
    const regenBtnHtml = shouldShowRegenerate ? `<button class="panel-icon-btn" data-action="cc-regenerate-transcribe" title="重新生成"><img src="${refreshIconSrc}" style="width:16px;height:16px;object-fit:contain;transform:scale(0.9);"></button>` : "";
    const searchBoxHtml = `<div class="cc-search-container"><input type="text" id="cc-search-input" class="cc-search-input" placeholder="搜索字幕..." /><button type="button" class="cc-search-clear" aria-label="清空">×</button></div>`;
    const progressBarHtml = '';

    const controlCenterHtml = `<div class="transcription-control-center"><div class="cc-transcribe-head">${searchBoxHtml}<div class="cc-header-right"><div class="cc-transcribe-status">${escapeHtml(sourceText)}</div><div class="cc-transcribe-actions">${regenBtnHtml}</div></div></div>${(rows.length > 0 || running) ? progressBarHtml : ''}</div>`;

    if (rows.length > 0) {
        logAsrUiTrace("cc_render", {
            mode: "rows",
            rows: rows.length,
            current_bvid: currentBvidForProgress,
            cache_bvid: cacheBvid,
            running,
            progress,
            button_disabled: true,
            button_text: "字幕列表",
            source_text: sourceText,
            tab_progress: stateProgress,
            local_progress: localProgress,
            session_progress: sessionProgress,
            session_active: asrSessionForCurrent,
            transcription_bvid: transcriptionBvidForProgress,
            tab_state_bvid: tabStateBvidForProgress
        });
        const rowsHtml = rows.map((row, index) => {
            const start = Number(row?.start ?? row?.from ?? 0);
            const end = row?.end ?? row?.to ?? "";
            const text = String(row?.text ?? row?.content ?? "解析失败");
            const hasTimestamp = !isNoTimestampSubtitle && Number.isFinite(start) && start >= 0;
            const timeHtml = hasTimestamp
                ? `<button class="cc-time cc-time-btn" data-action="cc-jump" data-sec="${start}">${formatTime(start)}</button>`
                : `<span class="cc-time" aria-hidden="true" style="cursor:default;color:transparent;">--</span>`;
            return `<div class="cc-row" data-index="${index}" data-start="${hasTimestamp ? start : ""}" data-end="${hasTimestamp ? end : ""}">${timeHtml}<span class="cc-text">${escapeHtml(text)}</span><button class="cc-copy-btn" data-action="cc-copy">复制</button></div>`;
        }).join("");

        panel.innerHTML = `
            <section class="cc-panel">
                ${controlCenterHtml}
                <div class="cc-viewport">
                    <div class="cc-list" id="cc-list">${rowsHtml}</div>
                    <button class="follow-fab direction-down" id="btn-follow-now" data-action="follow-now" style="display:none;" title="回到当前">
                        <img class="follow-fab-icon" src="${chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/up.png`)}" alt="回到当前">
                    </button>
                </div>
            </section>
        `;
    } else {
        const detectElapsedMs = Date.now() - Number(appState.injectBvidChangedAt || 0);
        const detectTimeoutReached = detectElapsedMs >= SUBTITLE_DETECT_TIMEOUT_MS;
        const isDetectingSubtitle = !running && (!appState.cache || !cacheReadyForCurrent) && !detectTimeoutReached;
        if (isDetectingSubtitle && !appState.subtitleDetectTimeoutTimer) {
            const forceRenderInMs = Math.max(100, SUBTITLE_DETECT_TIMEOUT_MS - detectElapsedMs + 100);
            appState.subtitleDetectTimeoutTimer = setTimeout(() => {
                appState.subtitleDetectTimeoutTimer = null;
                renderContent();
            }, forceRenderInMs);
        } else if (!isDetectingSubtitle && appState.subtitleDetectTimeoutTimer) {
            clearTimeout(appState.subtitleDetectTimeoutTimer);
            appState.subtitleDetectTimeoutTimer = null;
        }
        const capsuleDisabled = (running || isDetectingSubtitle) ? "disabled" : "";
        const statusText = isDetectingSubtitle
            ? "正在读取字幕，请稍候..."
            : ((running && (appState.asrSession?.statusText || transcription.statusText))
                ? escapeHtml(appState.asrSession?.statusText || transcription.statusText)
                : "未检测到字幕，可开启在线转录");
        const buttonText = running ? "转录中..." : (isDetectingSubtitle ? "检测中..." : "开始在线转录");
        logAsrUiTrace("cc_render", {
            mode: "empty",
            rows: rows.length,
            current_bvid: currentBvidForProgress,
            cache_bvid: cacheBvid,
            cache_ready_for_current: cacheReadyForCurrent,
            running,
            progress,
            is_detecting_subtitle: isDetectingSubtitle,
            detect_elapsed_ms: detectElapsedMs,
            detect_timeout_reached: detectTimeoutReached,
            button_disabled: !!capsuleDisabled,
            button_text: buttonText,
            status_text: statusText.replace(/<[^>]*>/g, ""),
            source_text: sourceText,
            tab_progress: stateProgress,
            local_progress: localProgress,
            session_progress: sessionProgress,
            session_active: asrSessionForCurrent,
            session: {
                active: !!appState.asrSession?.active,
                bvid: appState.asrSession?.bvid || "",
                stage: appState.asrSession?.stage || "",
                progress: Number(appState.asrSession?.progress || 0),
                status_text: appState.asrSession?.statusText || ""
            },
            transcription: {
                phase: transcription.phase || "",
                bvid: transcriptionBvidForProgress,
                progress: Number(transcription.progress || 0),
                status_text: transcription.statusText || ""
            },
            tab_state_bvid: tabStateBvidForProgress
        });
            
        const capsuleHtml = `<div class="subtitle-empty-container">
            <div class="action-container">
                <p class="action-tip">${statusText}</p>
                <button id="start-groq-transcribe" class="action-btn" data-action="transcription-start" ${capsuleDisabled}>${buttonText}</button>
            </div>
        </div>`;
        panel.innerHTML = `
            <section class="cc-panel">
                ${controlCenterHtml}
                ${capsuleHtml}
            </section>
        `;
    }

    bindCCSearch(panel);
    const list = panel.querySelector("#cc-list");
    if (list) {
        const pauseFollow = () => {
            appState.followEnabled = false;
            appState.followPausedAt = Date.now();
            toggleFollowButton();
            updateFollowButtonDirection();
        };

        const onCCListClick = async (event) => {
            const jumpBtn = event.target.closest('[data-action="cc-jump"]');
            if (jumpBtn) {
                event.preventDefault();
                event.stopPropagation();
                jumpTo(Number(jumpBtn.dataset.sec || 0));
                return;
            }
            const button = event.target.closest('[data-action="cc-copy"]');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            const row = button.closest(".cc-row");
            const text = String(row?.querySelector(".cc-text")?.textContent || "").trim();
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                const origin = button.dataset.originText || button.textContent || "复制";
                button.dataset.originText = origin;
                button.textContent = "OK";
                button.classList.add("copied");
                row?.classList.add("copied");
                showToast("已复制");
                setTimeout(() => {
                    button.textContent = origin;
                    button.classList.remove("copied");
                    row?.classList.remove("copied");
                }, 1000);
            } catch (_) {
                showToast("复制失败");
            }
        };

        list.addEventListener("wheel", pauseFollow);
        list.addEventListener("touchmove", pauseFollow, { passive: true });
        list.addEventListener("scroll", updateFollowButtonDirection, { passive: true });
        list.addEventListener("click", onCCListClick);

        scrollToCurrentSubtitle(true, "auto");
    }
}

function bindCCSearch(panel) {
    const searchInput = panel.querySelector("#cc-search-input");
    const clearButton = panel.querySelector(".cc-search-clear");
    if (!searchInput || !clearButton) return;
    const term = String(appState.ccSearchTerm || "");
    if (searchInput.value !== term) searchInput.value = term;
    applyCCSearchFilter(panel, term);
    searchInput.oninput = () => {
        const nextTerm = String(searchInput.value || "");
        if (appState.ccSearchDebounceTimer) {
            clearTimeout(appState.ccSearchDebounceTimer);
            appState.ccSearchDebounceTimer = null;
        }
        appState.ccSearchDebounceTimer = setTimeout(() => {
            appState.ccSearchDebounceTimer = null;
            applyCCSearchFilter(panel, nextTerm);
        }, 100);
    };
    clearButton.onclick = () => {
        if (appState.ccSearchDebounceTimer) {
            clearTimeout(appState.ccSearchDebounceTimer);
            appState.ccSearchDebounceTimer = null;
        }
        searchInput.value = "";
        applyCCSearchFilter(panel, "");
        searchInput.focus();
    };
}

function applyCCSearchFilter(panel, rawTerm) {
    const term = String(rawTerm || "").trim();
    appState.ccSearchTerm = term;
    const normalized = term.toLowerCase();
    const clearButton = panel.querySelector(".cc-search-clear");
    if (clearButton) {
        clearButton.classList.toggle("visible", term.length > 0);
    }
    const allRows = panel.querySelectorAll(".cc-row");
    allRows.forEach((row) => {
        const textNode = row.querySelector(".cc-text");
        if (!textNode) return;
        const rawText = String(textNode.textContent || "");
        const matched = !normalized || rawText.toLowerCase().includes(normalized);
        row.style.display = matched ? "flex" : "none";
        if (matched) {
            textNode.innerHTML = highlightTimelineSearchText(rawText, normalized);
        }
    });
}

function renderChat(panel) {
    const debugErrorView = appState.panelErrors?.chat;
    if (debugErrorView && renderErrorPanel) {
        panel.dataset.lastSignature = "";
        panel.innerHTML = `
            <div class="page-header">
                <h3>聊天</h3>
            </div>
            ${renderErrorPanel(debugErrorView, "chat-send")}
        `;
        return;
    }
    const apiKey = String(appState.settings?.apiKey || "").trim();
    if (!apiKey) {
        panel.dataset.lastSignature = "";
        panel.innerHTML = `
            <div class="no-apikey-notice">
                <div class="no-apikey-icon">🔑</div>
                <div class="no-apikey-text">暂未配置 API Key<br>请去设置里填写哦~</div>
                <button class="no-apikey-btn" data-action="goto-setup-guide">点此配置 →</button>
            </div>
        `;
        return;
    }
    const history = Array.isArray(appState.cache?.history) ? appState.cache.history : [];
    const pending = Array.isArray(appState.chatPending) ? appState.chatPending : [];
    
    const signature = JSON.stringify({
        cacheBvid: normalizeBvidCase(appState.cache?.bvid || ""),
        rawSubtitleLength: Array.isArray(appState.cache?.rawSubtitle) ? appState.cache.rawSubtitle.length : 0,
        processedSubtitleLength: Array.isArray(appState.cache?.processedSubtitle) ? appState.cache.processedSubtitle.length : 0,
        cloudReadStatus: String(appState.cloudReadState?.status || ""),
        h: history.length,
        hLast: history[history.length - 1]?.content?.length,
        p: pending.length,
        last: pending[pending.length-1]?.content?.length,
        s: appState.chatStreamingId
    });
    
    // Always check for existing list first
    const listExisting = panel.querySelector("#chat-list");

    // Force render if pending messages changed (even if just status) to ensure loading state shows
    // We only skip if signature matches exactly AND we have content
    const alreadyRendered = !appState.chatJustSwitched && panel.dataset.lastSignature === signature && listExisting;
    panel.dataset.lastSignature = signature;

    if (alreadyRendered) {
        if (appState.chatJustSwitched) {
             listExisting.style.opacity = "0";
             listExisting.scrollTop = listExisting.scrollHeight;
             scrollChatToBottom(listExisting);
             requestAnimationFrame(() => {
                 listExisting.style.opacity = "1";
                 appState.chatJustSwitched = false;
             });
        }
        return;
    }

    const shouldHideGuide = appState.chatGuideHidden || history.length > 0;
    const guideSection = shouldHideGuide ? "" : `
        <div class="chat-greeting">Hello, Ask me anything!</div>
        <div class="chat-suggest-list">
            <button type="button" class="chat-suggest-link" data-action="chat-suggest" data-text="帮我生成视频大纲">帮我生成视频大纲</button>
            <button type="button" class="chat-suggest-link" data-action="chat-suggest" data-text="作者讲了哪些主要观点">作者讲了哪些主要观点</button>
            <button type="button" class="chat-suggest-link" data-action="chat-suggest" data-text="帮我翻译成英文稿">帮我翻译成英文稿</button>
            <button type="button" class="chat-suggest-link" data-action="chat-suggest" data-text="这个视频片段出自哪里？">这个视频片段出自哪里？</button>
        </div>
    `;
    const isGenerating = !!appState.chatStreamingId;
    const sendAction = isGenerating ? "chat-stop" : "chat-send";
    const sendLabel = isGenerating ? "■" : "↑";
    const sendAria = isGenerating ? "停止" : "发送";
    const chatRowsHtml = renderChatRows(history);

    // If chat structure exists, just update content to prevent scroll jump
    if (listExisting) {
        // Save scroll position
        const prevScrollTop = listExisting.scrollTop;
        const wasAtBottom = listExisting.scrollHeight - listExisting.scrollTop <= listExisting.clientHeight + 50;

        // Update guide visibility
        const guideNode = panel.querySelector(".chat-greeting");
        const suggestNode = panel.querySelector(".chat-suggest-list");
        if (shouldHideGuide) {
            if (guideNode) guideNode.style.display = "none";
            if (suggestNode) suggestNode.style.display = "none";
        }

        // Pre-hide to avoid flash
        if (appState.chatJustSwitched) {
            listExisting.style.opacity = "0";
        }

        listExisting.innerHTML = chatRowsHtml;
        
        // IMMEDIATE: Handle tab switching scroll first
        if (appState.chatJustSwitched) {
             listExisting.scrollTop = listExisting.scrollHeight;
             scrollChatToBottom(listExisting);
             requestAnimationFrame(() => {
                 listExisting.style.opacity = "1";
             });
             appState.chatJustSwitched = false;
        } else {
             // If not switching, restore position to prevent jump-to-top first
             if (prevScrollTop > 0) listExisting.scrollTop = prevScrollTop;
        }

        // Update footer button state
        const sendBtn = panel.querySelector(".chat-send-btn");
        if (sendBtn) {
            sendBtn.dataset.action = sendAction;
            sendBtn.ariaLabel = sendAria;
            sendBtn.textContent = sendLabel;
            sendBtn.className = `chat-send-btn ${isGenerating ? "stopping" : ""}`;
        }

        // Handle auto-scroll logic (if needed)
        if (shouldAutoScrollChat() || wasAtBottom) {
            scrollChatToBottom(listExisting);
        }
        return;
    }

    appState.chatJustSwitched = false;
    const initialStyle = '';


    panel.innerHTML = `
        <section class="chat-page">
            ${guideSection}
            <div class="chat-display-area" id="chat-list"${initialStyle}>${chatRowsHtml}</div>
            <div class="chat-footer">
                <div class="chat-input-wrap">
                    <textarea id="chat-input" placeholder="有咩想问的？"></textarea>
                    <button class="chat-send-btn ${isGenerating ? "stopping" : ""}" data-action="${sendAction}" aria-label="${sendAria}">${sendLabel}</button>
                </div>
            </div>
        </section>
    `;
    const input = panel.querySelector("#chat-input");
    input?.addEventListener("input", () => {
        if (!String(input.value || "").trim()) return;
        dismissChatGuide();
        hideChatGuideNodes(panel);
    });
    input?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        if (event.ctrlKey) return;
        event.preventDefault();
        dismissChatGuide();
        hideChatGuideNodes(panel);
        handleSendChat();
    });
    const list = panel.querySelector("#chat-list");
    bindChatListAutoScroll(list);
    if (list) {
        // 先同步设置，防止浏览器渲染第一帧时从顶部开始
        list.scrollTop = list.scrollHeight;
        // 再用 requestAnimationFrame 等布局完成后修正
        requestAnimationFrame(() => {
            list.scrollTop = list.scrollHeight;
            if (appState.chatJustSwitched) {
                appState.chatJustSwitched = false;
            }
            list.style.opacity = "1";
        });
    }
}

function renderReal(panel) {
    const debugErrorView = appState.panelErrors?.real;
    if (debugErrorView && renderErrorPanel) {
        panel.dataset.lastSignature = "";
        panel.innerHTML = `
            <div class="page-header">
                <h3>验真助手 <div class="header-tags"><span class="beta-tag">Beta</span></div></h3>
            </div>
            ${renderErrorPanel(debugErrorView, "run-rumors")}
        `;
        return;
    }
    const apiKey = String(appState.settings?.apiKey || "").trim();
    if (!apiKey) {
        panel.dataset.lastSignature = "";
        panel.innerHTML = `
            <div class="no-apikey-notice">
                <div class="no-apikey-icon">🔑</div>
                <div class="no-apikey-text">暂未配置 API Key<br>请去设置里填写哦~</div>
                <button class="no-apikey-btn" data-action="goto-setup-guide">点此配置 →</button>
            </div>
        `;
        return;
    }
    const rumors = appState.cache?.rumors;
    const claims = Array.isArray(rumors?.claims) ? rumors.claims : [];
    const rumorsStatus = getCurrentVideoTaskStatus("rumors");
    const hasRumorsCache = !!String(rumors?.overview || "").trim() || claims.length > 0;
    const rumorsNoTimestamp = isNoTimestampSubtitleCache(appState.cache) || rumors?.no_timestamp || claims.some((item) => item?.no_timestamp);
    
    // Sort claims by timestamp
    const sortedClaims = [...claims].sort((a, b) => {
        return (Number(a.timestamp_sec) || 0) - (Number(b.timestamp_sec) || 0);
    });

    const signature = JSON.stringify({
        overview: rumors?.overview,
        claimsLength: sortedClaims.length,
        rumorsStatus,
        cacheBvid: normalizeBvidCase(appState.cache?.bvid || ""),
        rawSubtitleLength: Array.isArray(appState.cache?.rawSubtitle) ? appState.cache.rawSubtitle.length : 0,
        processedSubtitleLength: Array.isArray(appState.cache?.processedSubtitle) ? appState.cache.processedSubtitle.length : 0,
        subtitleSource: String(appState.cache?.subtitleSource || ""),
        cloudReadStatus: String(appState.cloudReadState?.status || ""),
        rumorsSource: getTaskCacheSource(appState.cache, "rumors"),
        sessionFresh: appState.sessionGeneratedTasks.has("rumors")
    });

    if (panel.dataset.lastSignature === signature && panel.innerHTML.trim()) return;
    panel.dataset.lastSignature = signature;
    
    const isFresh = appState.sessionGeneratedTasks.has("rumors");
    const rumorsCacheTag = buildCacheTagHtml(appState.cache, ["rumors"], hasRumorsCache, rumorsStatus === "processing", isFresh);
    const realNoticeHtml = `
    <div class="real-notice">
        提示：当前内置大模型暂无联网能力，无法对时事新闻作出实时评判；验真结果仅基于历史事实、科学常识、通用知识和视频上下文，仅供参考。
    </div>
    `;
    
    if (rumorsStatus === "processing") {
        const rumorsSkeleton = renderSkeletonLines(6, "summary-skeleton");
        const claimsSkeleton = renderSkeletonLines(5, "segments-skeleton");
        const refreshIconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/refresh.png`);
    
        panel.innerHTML = `
            <div class="page-header">
                <h3>验真助手 <div class="header-tags"><span class="beta-tag">Beta</span>${rumorsCacheTag}</div></h3>
                <div class="summary-header-actions" style="display:flex;gap:6px;">
                    <button class="panel-icon-btn" disabled>
                        <img src="${refreshIconSrc}" style="width:16px;height:16px;object-fit:contain;transform:scale(0.9);opacity:0.5;">
                    </button>
                </div>
            </div>
            ${realNoticeHtml}
            <div class="page-body">
                <div class="result-text" style="margin-bottom:12px;">
                    ${rumorsSkeleton}
                </div>
                <div class="claim-list">
                    ${claimsSkeleton}
                </div>
            </div>
        `;
        return;
    }

    const claimListHtml = sortedClaims.map((item) => {
        // Determine style class based on verdict/credibility
        let statusClass = "unknown"; // Default (灰色)
        let verdictLabel = "未知";
        let tooltipText = "AI 暂时无法获取外部资料进行验证，或视频内容属于主观观点（无法验证对错）。";
        
        const verdict = String(item.verdict || "").toLowerCase();
        
        if (verdict.includes("false") || verdict.includes("fake") || verdict.includes("谣言") || verdict.includes("不实") || verdict.includes("不可信")) {
            statusClass = "fake";
            verdictLabel = "不可信";
            tooltipText = "信息与事实严重不符，或属于明显的误导/谣言。";
        } else if (verdict.includes("doubt") || verdict.includes("suspicious") || verdict.includes("存疑") || verdict.includes("有待核实")) {
            statusClass = "doubt";
            verdictLabel = "存疑";
            tooltipText = "证据不足，或存在逻辑上的矛盾点，需要用户自行甄别。";
        } else if (verdict.includes("basic") || verdict.includes("partially") || verdict.includes("基本可信") || verdict.includes("基本真实")) {
            statusClass = "basic";
            verdictLabel = "基本可信";
            tooltipText = "核心观点正确，但在细节描述上可能存在细微偏差。";
        } else if (verdict.includes("true") || verdict.includes("real") || verdict.includes("真实") || verdict.includes("可信")) {
            statusClass = "real";
            verdictLabel = "可信";
            tooltipText = "信息有明确出处或符合客观事实。";
        } else {
             // Fallback for unknown
             statusClass = "unknown";
             verdictLabel = "未知";
             tooltipText = "AI 暂时无法获取外部资料进行验证，或视频内容属于主观观点（无法验证对错）。";
        }

        const itemNoTimestamp = rumorsNoTimestamp || item?.no_timestamp;
        const timeLabel = itemNoTimestamp ? "无时间轴" : formatTime(item.timestamp_sec || 0);
        const timeControl = itemNoTimestamp
            ? `<span class="claim-time-btn claim-time-static" title="该字幕没有真实时间轴">${timeLabel}</span>`
            : `<button class="claim-time-btn" data-action="seek-video" data-time="${item.timestamp_sec}">${timeLabel}</button>`;
        
        return `
            <div class="claim-card ${statusClass}">
                <div class="claim-header">
                    ${timeControl}
                    <div class="claim-status-tag ${statusClass}" data-tooltip="${tooltipText}">
                        ${verdictLabel}
                    </div>
                </div>
                <div class="claim-content">${escapeHtml(item.claim)}</div>
                <div class="claim-analysis">${escapeHtml(item.analysis)}</div>
            </div>
        `;
    }).join("");

    const refreshIconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/refresh.png`);
    const actionButton = rumorsStatus === "processing" 
        ? `<button class="panel-icon-btn" disabled><img src="${refreshIconSrc}" style="width:16px;height:16px;object-fit:contain;transform:scale(0.9);opacity:0.5;"></button>`
        : `<button class="panel-icon-btn" data-action="run-rumors" title="${hasRumorsCache ? "重新验真" : "开始验真"}"><img src="${refreshIconSrc}" style="width:16px;height:16px;object-fit:contain;transform:scale(0.9);"></button>`;

    if (!hasRumorsCache && rumorsStatus !== "processing") {
        const errorView = appState.panelErrors?.real;
        if (errorView && renderErrorPanel) {
            panel.innerHTML = `
                <div class="page-header">
                    <h3>验真助手 <div class="header-tags"><span class="beta-tag">Beta</span>${rumorsCacheTag}</div></h3>
                </div>
                ${realNoticeHtml}
                ${renderErrorPanel(errorView, "run-rumors")}
            `;
            return;
        }
        panel.innerHTML = `
            <div class="page-header">
                <h3>验真助手 <div class="header-tags"><span class="beta-tag">Beta</span>${rumorsCacheTag}</div></h3>
            </div>
            ${realNoticeHtml}
            <div class="page-body subtitle-empty-container">
                <div class="action-container">
                    <p class="action-tip">先问是不是，再问为什么。</p>
                    <button class="action-btn" data-action="run-rumors">开始验真</button>
                </div>
            </div>
        `;
        return;
    }

    panel.innerHTML = `
        <div class="page-header">
            <h3>验真助手 <div class="header-tags"><span class="beta-tag">Beta</span>${rumorsCacheTag}</div></h3>
            <div class="summary-header-actions" style="display:flex;gap:6px;">
                ${actionButton}
            </div>
        </div>
        ${realNoticeHtml}
        <div class="page-body">
            <div class="result-text" style="margin-bottom:12px;">${escapeHtml(rumors?.overview || "")}</div>
            <div class="claim-list">${claimListHtml}</div>
        </div>
    `;
    
    // Bind seek events locally for this render
    panel.querySelectorAll(".claim-time-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const time = Number(e.target.dataset.time);
            if (!isNaN(time)) {
                const player = document.querySelector("video");
                if (player) {
                    player.currentTime = time;
                    player.play().catch(() => {});
                }
            }
        });
    });

    // Re-bind main button action if needed (though delegated events handle it usually)
    const runBtn = panel.querySelector('[data-action="run-rumors"]');
    if (runBtn) {
        // Just rely on global delegation
    }
}

let _guideStep = 1;

function showSetupGuide() {
    if (!panelShadowRoot) return;
    appState.activePage = "settings";
    renderNav();
    renderContent();
    const settingsScrollBody = panelShadowRoot.querySelector("#page-settings .settings-scroll-body");
    if (settingsScrollBody) settingsScrollBody.scrollTop = 0;
    if (panelShadowRoot.getElementById("setup-guide-overlay")) return;
    _guideStep = 1;
    const overlay = document.createElement("div");
    overlay.id = "setup-guide-overlay";
    const box = panelShadowRoot.querySelector(".ai-summary-plugin-box");
    if (!box) return;
    box.appendChild(overlay);
    renderGuideStep(1);
}

function renderGuideStep(step) {
    _guideStep = step;
    const overlay = panelShadowRoot.getElementById("setup-guide-overlay");
    if (!overlay) return;
    overlay.innerHTML = "";

    const highlight = (selector) => {
        const target = panelShadowRoot.querySelector(selector);
        if (!target) return;
        const boxEl = panelShadowRoot.querySelector(".ai-summary-plugin-box");
        if (!boxEl) return;
        const tRect = target.getBoundingClientRect();
        const bRect = boxEl.getBoundingClientRect();
        const ring = document.createElement("div");
        ring.className = "guide-highlight-ring";
        ring.style.top = `${tRect.top - bRect.top - 4}px`;
        ring.style.left = `${tRect.left - bRect.left - 4}px`;
        ring.style.width = `${tRect.width + 8}px`;
        ring.style.height = `${tRect.height + 8}px`;
        ring.style.pointerEvents = "none";
        overlay.appendChild(ring);
    };

    const totalSteps = 3;
    const dots = (current, total) => Array.from({ length: total }, (_, i) => `<span class="guide-dot ${i + 1 === current ? "active" : ""}"></span>`).join("");

    const actions = (hasPrev) => `
        <div class="guide-card-actions">
            <button class="guide-btn-skip" data-guide="skip">跳过引导</button>
            <div class="guide-btn-group">
                ${hasPrev ? `<button class="guide-btn-secondary" data-guide="prev">← 上一步</button>` : ""}
                <button class="guide-btn-primary" data-guide="next">
                    ${step === totalSteps ? "完成 ✓" : "下一步 →"}
                </button>
            </div>
        </div>
    `;

    if (step === 1) {
        highlight('[data-action="settings-open-reg"]');
        overlay.insertAdjacentHTML("beforeend", `
            <div class="guide-card">
                <div class="guide-steps-dots">${dots(1, totalSteps)}</div>
                <div class="guide-card-title">🔗 第一步：注册并获取 API Key</div>
                <div class="guide-card-desc">
                    点击高亮的「注册」按钮跳转到平台申请免费 Key。<br>
                    不确定怎么操作？看这里：<br>
                    <a class="guide-doc-link"
                       href="https://ncnp7ti79hnh.feishu.cn/wiki/AMVswpIdZiufLukZ3x0cMTWJnge#share-JpZDddCK5oZWcyxlbJJcijLBnIe"
                       target="_blank" rel="noopener noreferrer">
                        📖 二年级小朋友都会 · 5 分钟学会如何配置
                    </a>
                </div>
                ${actions(false)}
            </div>
        `);
    }

    if (step === 2) {
        if (appState.activePage !== "settings") {
            appState.activePage = "settings";
            renderNav();
            renderContent();
        }
        highlight("#settings-api-key");
        highlight("#settings-model");
        overlay.insertAdjacentHTML("beforeend", `
            <div class="guide-card">
                <div class="guide-steps-dots">${dots(2, totalSteps)}</div>
                <div class="guide-card-title">✏️ 第二步：填写 Key 和模型名</div>
                <div class="guide-card-desc">
                    将获取到的 API Key 填入高亮的输入框。<br>
                    模型名称可留空，将自动使用默认模型。<br>
                    填写后点「保存设置」，AI 功能即刻解锁 🎉
                </div>
                ${actions(true)}
            </div>
        `);
    }

    if (step === 3) {
        overlay.insertAdjacentHTML("beforeend", `
            <div class="guide-card">
                <div class="guide-steps-dots">${dots(3, totalSteps)}</div>
                <div class="guide-card-title">👀 第三步：先看看效果</div>
                <div class="guide-card-desc">
                    还没配置也没关系。这里有一个已生成云端缓存的视频。
                    点击后会跳到 B 站视频，并自动打开总结页展示效果。
                </div>
                <div class="guide-preview-row">
                    <button class="guide-btn-primary guide-preview-btn" data-guide="preview">预览总结效果</button>
                </div>
                ${actions(true)}
            </div>
        `);
    }

    const card = overlay.querySelector(".guide-card");
    card?.querySelector("[data-guide='skip']")?.addEventListener("click", () => {
        closeSetupGuide();
    });
    card?.querySelector("[data-guide='prev']")?.addEventListener("click", () => {
        renderGuideStep(step - 1);
    });
    card?.querySelector("[data-guide='next']")?.addEventListener("click", () => {
        if (step < totalSteps) {
            renderGuideStep(step + 1);
        } else {
            closeSetupGuide();
        }
    });
    card?.querySelector("[data-guide='preview']")?.addEventListener("click", async () => {
        try {
            await chrome.storage.local.set({
                [SETUP_PREVIEW_STORAGE_KEY]: {
                    bvid: SETUP_PREVIEW_BVID,
                    page: "summary",
                    createdAt: Date.now()
                }
            });
        } catch (_) {}
        closeSetupGuide();
        window.location.href = SETUP_PREVIEW_VIDEO_URL;
    });
}

function closeSetupGuide() {
    const overlay = panelShadowRoot?.getElementById("setup-guide-overlay");
    if (overlay) overlay.remove();
    renderContent();
}

function maybeAutoShowSetupGuideOnFirstRun() {
    const settings = appState.settings || {};
    if (settings.setupGuideAutoShown) return;
    const nextSettings = { ...settings, setupGuideAutoShown: true };
    appState.settings = nextSettings;
    chrome.storage.local.set({ settings: nextSettings });
    const apiKey = String(nextSettings.apiKey || "").trim();
    if (!apiKey) {
        showSetupGuide();
    }
}

function renderSettings(panel) {
    const settings = appState.settings || {};
    const signature = JSON.stringify(settings);
    if (panel.dataset.lastSignature === signature && panel.innerHTML.trim()) return;
    const prevScrollBody = panel.querySelector(".settings-scroll-body");
    const prevScrollTop = Number(prevScrollBody?.scrollTop || 0);
    const activeElement = document.activeElement;
    const shouldRestoreFocus = !!(activeElement && panel.contains(activeElement));
    const activeId = shouldRestoreFocus ? String(activeElement.id || "") : "";
    const activeSelectionStart = shouldRestoreFocus && typeof activeElement.selectionStart === "number" ? Number(activeElement.selectionStart) : -1;
    const activeSelectionEnd = shouldRestoreFocus && typeof activeElement.selectionEnd === "number" ? Number(activeElement.selectionEnd) : -1;
    panel.dataset.lastSignature = signature;

    const providers = { ...(appState.providers || {}) };
    if (!providers.custom) {
        providers.custom = { name: "自定义", baseUrl: "", regUrl: "" };
    }
    const providerKey = settings.provider || "modelscope";
    const provider = providers[providerKey] || {};
    const keys = Object.keys(providers);
    const optionsHtml = keys.map((key) => {
        const item = providers[key] || {};
        const isSelected = key === providerKey;
        return `<div class="custom-option ${isSelected ? "selected" : ""}" data-value="${escapeHtml(key)}">${escapeHtml(item.name || key)}</div>`;
    }).join("");
    
    const currentProviderName = providers[providerKey]?.name || providerKey;
    const arrowIcon = `<svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    const renderCustomSelect = (id, items, selectedValue) => {
        const selected = items.find((item) => String(item.value) === String(selectedValue)) || items[0] || { value: "", label: "" };
        return `
            <select id="${escapeHtmlAttr(id)}" class="settings-native-select-hidden">
                ${items.map((item) => `<option value="${escapeHtmlAttr(item.value)}" ${String(item.value) === String(selected.value) ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
            </select>
            <div class="custom-select-container settings-custom-select" data-target-select="${escapeHtmlAttr(id)}">
                <div class="custom-select-trigger">
                    <span class="current-value">${escapeHtml(selected.label)}</span>
                    ${arrowIcon}
                </div>
                <div class="custom-select-options">
                    ${items.map((item) => `<div class="custom-option ${String(item.value) === String(selected.value) ? "selected" : ""}" data-value="${escapeHtmlAttr(item.value)}">${escapeHtml(item.label)}</div>`).join("")}
                </div>
            </div>
        `;
    };
    const renderSecretInput = (id, value, placeholder, errorText = "API Key 不能包含中文或空格，首尾空格会自动清理") => `
        <div class="settings-secret-field">
            <input id="${escapeHtmlAttr(id)}" data-secret-input="true" type="password" value="${escapeHtml(value || "")}" placeholder="${escapeHtmlAttr(placeholder)}" autocomplete="off" spellcheck="false">
            <button type="button" class="settings-secret-toggle" data-action="settings-toggle-secret" data-target="${escapeHtmlAttr(id)}" aria-label="显示密钥明文">显示</button>
        </div>
        <div class="error-message" id="${escapeHtmlAttr(id)}-error">${escapeHtml(errorText)}</div>
    `;
    const promptSettings = normalizePromptSettingsState(settings.promptSettings);
    const promptMode = promptSettings.mode === "custom" ? "custom" : "guided";
    const promptSummary = String(promptSettings.custom.summary || "");
    const promptSegments = String(promptSettings.custom.segments || "");
    const promptRumors = String(promptSettings.custom.rumors || "");
    const customProtocol = String(settings.customProtocol || "openai").toLowerCase() === "claude" ? "claude" : "openai";
    const defaultOpenPage = resolveDefaultOpenPage(settings.defaultOpenPage);
    const providerModelOptions = getProviderModelOptions(providerKey);
    const hasProviderModelSelect = providerKey !== "custom" && providerModelOptions.length > 0;
    const currentModel = String(settings.model || getDefaultProviderModel(providerKey) || "").trim();
    const providerModelSelectValue = hasProviderModelSelect && providerModelOptions.includes(currentModel) ? currentModel : "custom";
    const providerModelWrapVisible = hasProviderModelSelect ? "" : "settings-hidden";
    const providerCustomModelVisible = hasProviderModelSelect && providerModelSelectValue === "custom" ? "" : "settings-hidden";
    const plainModelVisible = hasProviderModelSelect ? "settings-hidden" : "";
    const asrProviderKey = String(settings.asrProvider || "groq").toLowerCase() === "siliconflow" ? "siliconflow" : "groq";
    const asrProviders = {
        groq: {
            name: "Groq",
            note: "需科学上网",
            regUrl: "https://console.groq.com/keys"
        },
        siliconflow: {
            name: "硅基流动",
            note: "无字幕时间戳",
            regUrl: "https://cloud.siliconflow.cn/account/ak"
        }
    };
    const asrProvider = asrProviders[asrProviderKey] || asrProviders.groq;
    const asrOptionsHtml = Object.entries(asrProviders).map(([key, item]) => {
        const isSelected = key === asrProviderKey;
        return `<div class="custom-option ${isSelected ? "selected" : ""}" data-value="${escapeHtmlAttr(key)}" data-label="${escapeHtmlAttr(item.name)}"><span>${escapeHtml(item.name)}</span><span class="custom-option-note">${escapeHtml(item.note)}</span></div>`;
    }).join("");
    const groqModel = String(settings.groqModel || "whisper-large-v3-turbo");
    const siliconFlowAsrModel = String(settings.siliconFlowAsrModel || "FunAudioLLM/SenseVoiceSmall");
    const customVisible = providerKey === "custom" ? "" : "settings-hidden";
    const groqVisible = asrProviderKey === "groq" ? "" : "settings-hidden";
    const siliconFlowVisible = asrProviderKey === "siliconflow" ? "" : "settings-hidden";
    const guidedVisible = promptMode === "guided" ? "" : "settings-hidden";
    const customPromptVisible = promptMode === "custom" ? "" : "settings-hidden";
    panel.innerHTML = `
        <div class="page-header">
            <h3>设置（自动保存）</h3>
            <div id="save-status"></div>
        </div>
        <div class="settings-scroll-body">
            <div class="settings-grid">
                <div class="settings-group-title-row">
                    <div class="settings-group-title">主模型配置</div>
                    <button type="button" class="panel-btn ghost settings-guide-btn" data-action="settings-open-guide">查看引导</button>
                </div>
                <label>Provider</label>
                <div class="settings-provider-row">
                    <div class="custom-select-container" id="settings-provider-select">
                        <div class="custom-select-trigger">
                            <span class="current-value">${escapeHtml(currentProviderName)}</span>
                            ${arrowIcon}
                        </div>
                        <div class="custom-select-options">
                            ${optionsHtml}
                        </div>
                    </div>
                    <button class="panel-btn ghost" data-action="settings-open-reg" data-url="${escapeHtml(provider.regUrl || "")}">注册</button>
                </div>
                <div class="settings-provider-url">${escapeHtml(provider.baseUrl || "-")}</div>
                <label>API Key</label>
                ${renderSecretInput("settings-api-key", settings.apiKey || "", "示例：sk-xxxxx")}
                <label>Model</label>
                <div id="settings-provider-model-wrap" class="${providerModelWrapVisible}">
                    ${renderCustomSelect("settings-provider-model", [
                        ...providerModelOptions.map((model) => ({ value: model, label: model })),
                        { value: "custom", label: "自定义" }
                    ], providerModelSelectValue)}
                    <input id="settings-provider-custom-model" class="${providerCustomModelVisible}" type="text" value="${escapeHtml(currentModel)}" placeholder="请输入模型名">
                </div>
                <input id="settings-model" class="${plainModelVisible}" type="text" value="${escapeHtml(settings.model || "")}" placeholder="示例：gpt-4o-mini / deepseek-chat / glm-4-flash">
                <div class="settings-custom-only ${customVisible}">
                    <label>自定义地址协议</label>
                    <select id="settings-custom-protocol">
                        <option value="openai" ${customProtocol === "openai" ? "selected" : ""}>OpenAI 协议</option>
                        <option value="claude" ${customProtocol === "claude" ? "selected" : ""}>Claude 协议</option>
                    </select>
                    <label>Base URL</label>
                    <input id="settings-base-url" type="text" value="${escapeHtml(settings.customBaseUrl || "")}" placeholder="示例：https://api.example.com/v1">
                    <button type="button" class="panel-btn ghost" data-action="settings-authorize-custom-origin">授权当前域名</button>
                </div>
                <div class="settings-group-title">ASR（音频识别）模型配置</div>
                <label>ASR Provider</label>
                <div class="settings-provider-row">
                    <select id="settings-asr-provider" class="settings-native-select-hidden">
                        <option value="groq" ${asrProviderKey === "groq" ? "selected" : ""}>Groq</option>
                        <option value="siliconflow" ${asrProviderKey === "siliconflow" ? "selected" : ""}>硅基流动</option>
                    </select>
                    <div class="custom-select-container settings-custom-select" id="settings-asr-provider-select" data-target-select="settings-asr-provider">
                        <div class="custom-select-trigger">
                            <span class="current-value">${escapeHtml(asrProvider.name)}</span>
                            ${arrowIcon}
                        </div>
                        <div class="custom-select-options">
                            ${asrOptionsHtml}
                        </div>
                    </div>
                    <button class="panel-btn ghost" data-action="settings-open-reg" data-register-kind="asr" data-url="${escapeHtml(asrProvider.regUrl || "")}">注册</button>
                </div>
                <div id="settings-asr-groq-wrap" class="settings-asr-provider-fields ${groqVisible}">
                    <label>Groq API Key</label>
                    ${renderSecretInput("settings-groq-api-key", settings.groqApiKey || "", "示例：gsk_xxxxx")}
                    <label>ASR 模型</label>
                    <input id="settings-groq-model" type="text" value="${escapeHtml(groqModel)}" placeholder="示例：whisper-large-v3-turbo">
                </div>
                <div id="settings-asr-siliconflow-wrap" class="settings-asr-provider-fields ${siliconFlowVisible}">
                    <label>硅基流动 API Key</label>
                    ${renderSecretInput("settings-siliconflow-api-key", settings.siliconFlowApiKey || "", "示例：sk-xxxxx")}
                    <label>ASR 模型</label>
                    <input id="settings-siliconflow-asr-model" type="text" value="${escapeHtml(siliconFlowAsrModel)}" placeholder="示例：FunAudioLLM/SenseVoiceSmall">
                </div>
                <div class="settings-group-title">个性化</div>
                <label>修改模式</label>
                ${renderCustomSelect("settings-prompt-mode", [
                    { value: "guided", label: "简单模式" },
                    { value: "custom", label: "专业模式" }
                ], promptMode)}
                <div id="settings-prompt-guided-wrap" class="${guidedVisible}">
                    <label>语言风格</label>
                    <div class="slider-group">
                        <div class="slider-labels">
                            <span>轻松</span>
                            <span>平衡</span>
                            <span>专业</span>
                        </div>
                        <input id="settings-prompt-tone" type="range" min="0" max="2" step="1" 
                            value="${promptSettings.guided.tone === 'casual' ? 0 : (promptSettings.guided.tone === 'professional' ? 2 : 1)}">
                    </div>
                    
                    <label>详略程度</label>
                    <div class="slider-group">
                        <div class="slider-labels">
                            <span>简略</span>
                            <span>标准</span>
                            <span>详实</span>
                        </div>
                        <input id="settings-prompt-detail" type="range" min="0" max="2" step="1"
                            value="${promptSettings.guided.detail === 'brief' ? 0 : (promptSettings.guided.detail === 'detailed' ? 2 : 1)}">
                    </div>
                </div>
                <div id="settings-prompt-custom-wrap" class="${customPromptVisible}">
                    <div class="prompt-field-group">
                        <label class="prompt-field-label">总结 Prompt</label>
                        <textarea id="settings-prompt-summary" maxlength="1000">${escapeHtml(promptSummary)}</textarea>
                        <div class="prompt-char-count" id="count-summary">${promptSummary.length}/1000</div>
                    </div>
                    <div class="prompt-field-group">
                        <label class="prompt-field-label">分段 Prompt</label>
                        <textarea id="settings-prompt-segments" maxlength="1000">${escapeHtml(promptSegments)}</textarea>
                        <div class="prompt-char-count" id="count-segments">${promptSegments.length}/1000</div>
                    </div>
                    <div class="prompt-field-group">
                        <label class="prompt-field-label">验真 Prompt</label>
                        <textarea id="settings-prompt-rumors" maxlength="1000">${escapeHtml(promptRumors)}</textarea>
                        <div class="prompt-char-count" id="count-rumors">${promptRumors.length}/1000</div>
                    </div>
                </div>
                <button type="button" class="panel-btn ghost" data-action="settings-reset-prompts">恢复默认</button>
                <div class="settings-group-title">调用与显示模式</div>
                <label class="settings-label-with-info">
                    <span>调用模式</span>
                    <span class="settings-info-icon" data-tooltip="高速：总结和分段分别调用，速度更快但消耗 2 次。省流：一次调用同时生成总结和分段，更省次数。">i</span>
                </label>
                ${renderCustomSelect("settings-pref-mode", [
                    { value: "quality", label: "高速模式" },
                    { value: "efficiency", label: "省流模式" }
                ], settings.prefMode === "quality" ? "quality" : "efficiency")}
                <label>默认开屏页</label>
                ${renderCustomSelect("settings-default-open-page", [
                    { value: "CC", label: "字幕" },
                    { value: "summary", label: "总结" },
                    { value: "chat", label: "聊天" },
                    { value: "real", label: "验真" }
                ], defaultOpenPage)}
                <div class="settings-group-title">异常诊断</div>
                <label>允许上报异常</label>
                ${renderCustomSelect("settings-sentry-enabled", [
                    { value: "false", label: "关闭" },
                    { value: "true", label: "开启" }
                ], settings.sentryEnabled ? "true" : "false")}
                <!--
                <label>Debug</label>
                <select id="settings-debug-mode">
                    <option value="false" ${settings.debugMode ? "" : "selected"}>false</option>
                    <option value="true" ${settings.debugMode ? "selected" : ""}>true</option>
                </select>
                -->
                <div class="settings-group-title">帮助与反馈</div>
                <div class="settings-action-row">
                    <button type="button" class="panel-btn ghost" data-action="open-help">帮助文档</button>
                    <button type="button" class="panel-btn ghost" data-action="open-feedback">反馈建议</button>
                    <button type="button" class="panel-btn ghost" data-action="open-review">去好评</button>
                </div>
            </div>
        </div>
    `;
    
    // Bind custom select logic
    const selectContainer = panel.querySelector("#settings-provider-select");
    const selectTrigger = selectContainer?.querySelector(".custom-select-trigger");
    const selectOptions = selectContainer?.querySelector(".custom-select-options");
    
    if (selectContainer && selectTrigger && selectOptions) {
        selectTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = selectContainer.classList.contains("open");
            // Close all other selects if any (future proofing)
            panel.querySelectorAll(".custom-select-container.open").forEach(el => {
                if(el !== selectContainer) el.classList.remove("open");
            });
            selectContainer.classList.toggle("open");
        });

        selectOptions.querySelectorAll(".custom-option").forEach(option => {
            option.addEventListener("click", (e) => {
                e.stopPropagation();
                const val = option.dataset.value;
                if(val && val !== providerKey) {
                    // Update UI immediately for responsiveness
                    selectContainer.querySelector(".current-value").textContent = option.textContent;
                    selectContainer.classList.remove("open");
                    // Update internal state
                    if(!appState.settings) appState.settings = {};
                    appState.settings.provider = val;
                    const providerOptions = getProviderModelOptions(val);
                    if (val !== "custom" && providerOptions.length && !providerOptions.includes(String(appState.settings.model || "").trim())) {
                        appState.settings.model = providerOptions[0];
                    }
                    
                    // Update selection visual
                    selectOptions.querySelectorAll(".custom-option").forEach(opt => opt.classList.remove("selected"));
                    option.classList.add("selected");
                    
                    // Trigger hints update
                    renderSettings(panel);

                    // Trigger save
                    saveSettingsFromPanel(true);
                } else {
                     selectContainer.classList.remove("open");
                }
            });
        });

        // Global click listener to close dropdown is handled in bindPanelDelegatedEvents or via document listener
        // But since renderSettings can be called multiple times, we should attach a document listener once or handle it locally.
        // A simple way is to add a click listener to the panel or document that closes this specific dropdown.
        // To avoid multiple listeners, we can rely on the global listener in bindPanelDelegatedEvents if we add one there, 
        // OR we can add a one-time listener here that removes itself when the element is removed.
        // For simplicity and robustness, let's add a document click handler that checks if the click is outside.
        
        const closeDropdown = (e) => {
             if (!selectContainer.contains(e.target)) {
                selectContainer.classList.remove("open");
            }
        };
        
        // Remove previous listener if exists (tricky without reference), so we use a named function attached to the element
        if(selectContainer._closeHandler) {
            document.removeEventListener("click", selectContainer._closeHandler);
        }
        selectContainer._closeHandler = closeDropdown;
        document.addEventListener("click", closeDropdown);
    }
    bindSettingsCustomSelects(panel);

    panel.querySelector("#settings-base-url")?.addEventListener("input", () => updateSettingsProviderHint(panel));
    updateSettingsProviderHint(panel);
    const asrProviderSelect = panel.querySelector("#settings-asr-provider");
    if (asrProviderSelect) {
        asrProviderSelect.addEventListener("change", () => updateSettingsAsrProviderHint(panel));
    }
    updateSettingsAsrProviderHint(panel);

    // Dynamic Slider Fill Logic
    const updateSliderFill = (slider) => {
        const min = Number(slider.min ?? 0);
        const max = Number(slider.max ?? 2);
        const val = Number(slider.value ?? 1);
        const pct = ((val - min) / (max - min)) * 100;
        slider.style.background = `linear-gradient(to right, #fb7299 ${pct}%, #e3e8ec ${pct}%)`;
    };

    // Auto-save & Validation Logic
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    };

    const triggerAutoSave = () => saveSettingsFromPanel(true);
    const debouncedSave = debounce(triggerAutoSave, 500);

    // Initialize all sliders
    panel.querySelectorAll("input[type='range']").forEach(slider => {
        updateSliderFill(slider);
        slider.addEventListener("input", () => {
            updateSliderFill(slider);
            debouncedSave();
        });
    });

    const promptModeSelect = panel.querySelector("#settings-prompt-mode");
    const promptGuidedWrap = panel.querySelector("#settings-prompt-guided-wrap");
    const promptCustomWrap = panel.querySelector("#settings-prompt-custom-wrap");
    const providerModelSelect = panel.querySelector("#settings-provider-model");
    const providerCustomModelInput = panel.querySelector("#settings-provider-custom-model");
    const applyProviderModelVisibility = () => {
        if (providerCustomModelInput) {
            providerCustomModelInput.classList.toggle("settings-hidden", String(providerModelSelect?.value || "") !== "custom");
        }
    };
    if (providerModelSelect) {
        providerModelSelect.addEventListener("change", () => {
            applyProviderModelVisibility();
            triggerAutoSave();
        });
    }
    applyProviderModelVisibility();
    const applyPromptModeVisibility = () => {
        const mode = String(promptModeSelect?.value || "guided") === "custom" ? "custom" : "guided";
        if (promptGuidedWrap) promptGuidedWrap.classList.toggle("settings-hidden", mode !== "guided");
        if (promptCustomWrap) promptCustomWrap.classList.toggle("settings-hidden", mode !== "custom");
    };
    if (promptModeSelect) {
        promptModeSelect.addEventListener("change", () => {
            applyPromptModeVisibility();
            triggerAutoSave();
        });
    }
    applyPromptModeVisibility();

    const secretInputs = Array.from(panel.querySelectorAll("[data-secret-input]"));
    const normalizeSecretInput = (input) => {
        if (!input) return "";
        const trimmed = String(input.value || "").trim();
        if (input.value !== trimmed) input.value = trimmed;
        return trimmed;
    };
    const validateSecretInput = (input, shouldTrim = false) => {
        if (!input) return true;
        const val = shouldTrim ? normalizeSecretInput(input) : String(input.value || "");
        const invalid = /[\s\u4e00-\u9fa5]/.test(val);
        const errorNode = panel.querySelector(`#${input.id}-error`);
        if (invalid) {
            input.classList.add("input-error");
            if (errorNode) errorNode.classList.add("show");
            return false;
        }
        input.classList.remove("input-error");
        if (errorNode) errorNode.classList.remove("show");
        return true;
    };

    const inputs = panel.querySelectorAll("input, textarea");
    inputs.forEach(input => {
        if (input.type === "range") return;
        if (input.dataset.secretInput === "true") {
            input.addEventListener("input", () => {
                validateSecretInput(input, false);
            });
        }
        input.addEventListener("blur", () => {
            if (input.dataset.secretInput === "true" && !validateSecretInput(input, true)) return;
            triggerAutoSave();
        });
    });

    ["summary", "segments", "rumors"].forEach(key => {
        const textarea = panel.querySelector(`#settings-prompt-${key}`);
        const counter = panel.querySelector(`#count-${key}`);
        if (!textarea || !counter) return;
        
        const updateCount = () => {
            const len = textarea.value.length;
            counter.textContent = `${len}/1000`;
            counter.classList.toggle("over-limit", len > 400);
        };
        
        updateCount();
        textarea.addEventListener("input", () => {
            updateCount();
        });
    });

    const selects = panel.querySelectorAll("select");
    selects.forEach(select => {
        select.addEventListener("change", triggerAutoSave);
    });
    const nextScrollBody = panel.querySelector(".settings-scroll-body");
    if (nextScrollBody) nextScrollBody.scrollTop = prevScrollTop;
    if (activeId) {
        const nextActive = panel.querySelector(`#${activeId}`);
        if (nextActive && typeof nextActive.focus === "function") {
            try {
                nextActive.focus({ preventScroll: true });
            } catch (_) {
                nextActive.focus();
            }
            if (typeof nextActive.setSelectionRange === "function" && activeSelectionStart >= 0 && activeSelectionEnd >= 0) {
                const max = String(nextActive.value || "").length;
                const start = Math.max(0, Math.min(max, activeSelectionStart));
                const end = Math.max(0, Math.min(max, activeSelectionEnd));
                nextActive.setSelectionRange(start, end);
            }
        }
    }
}

function renderErrorDemoControls() {
    const panelErrors = [
        ["HTTP_401", "401 Key 无效", "summary"],
        ["HTTP_403", "403 无权限", "summary"],
        ["HTTP_404", "404 模型/接口", "summary"],
        ["TIMEOUT", "超时", "summary"],
        ["NETWORK_ERROR", "网络失败", "summary"],
        ["JSON_PARSE_ERROR", "JSON 格式", "summary"],
        ["ASR_FILE_TOO_LARGE", "音频过大", "summary"],
        ["SUBTITLE_MISSING", "未获取到字幕", "summary"],
        ["HTTP_401", "聊天 401", "chat"],
        ["JSON_PARSE_ERROR", "验真 JSON", "real"]
    ];
    const toastErrors = [
        ["HTTP_429", "429 限流"],
        ["HTTP_5XX", "5XX 服务异常"],
        ["ASR_RATE_LIMIT", "ASR 限流"],
        ["CLOUD_FAILED", "云缓存失败"],
        ["DOWNLOAD_FAILED", "下载失败"]
    ];
    const renderButton = ([code, label, target]) => (
        `<button type="button" class="panel-btn ghost error-demo-btn" data-action="debug-error-demo" data-code="${escapeHtml(code)}" data-target="${escapeHtml(target || "summary")}">${escapeHtml(label)}</button>`
    );
    return `
        <div class="settings-group-title">开发测试</div>
        <div class="error-demo-section">
            <div class="error-demo-label">面板提示</div>
            <div class="error-demo-grid">${panelErrors.map(renderButton).join("")}</div>
            <div class="error-demo-label">Toast 提示</div>
            <div class="error-demo-grid">${toastErrors.map(renderButton).join("")}</div>
            <div class="error-demo-label">更新导览</div>
            <button type="button" class="panel-btn ghost" data-action="debug-show-release-notice">显示 v1.2.3 更新导览</button>
            <button type="button" class="panel-btn ghost error-demo-clear" data-action="debug-clear-errors">清空测试状态</button>
        </div>
    `;
}

function renderSubtitleEmptyDemoControls() {
    return `
        <div class="settings-group-title">字幕空状态</div>
        <div class="error-demo-section">
            <div class="error-demo-label">总结页无字幕提示预览</div>
            <div class="debug-state-preview">
                ${renderMissingSubtitleState()}
            </div>
        </div>
    `;
}

function renderSegmentPromptDebugControls() {
    const variant = String(appState.settings?.segmentPromptVariant || "test").toLowerCase() === "original" ? "original" : "test";
    const debugEnabled = !!appState.settings?.debugMode;
    return `
        <div class="settings-group-title">分段 Prompt 对比</div>
        <div class="error-demo-section">
            <div class="error-demo-label">调试日志</div>
            <select id="debug-mode-inline">
                <option value="false" ${debugEnabled ? "" : "selected"}>关闭</option>
                <option value="true" ${debugEnabled ? "selected" : ""}>开启</option>
            </select>
            <div class="empty-text" style="margin-top:8px;">开启后会记录完整 Prompt 分块。测试完建议关闭。</div>
            <div class="error-demo-label">当前用于“视频分段 + 广告识别”的 Prompt</div>
            <select id="debug-segment-prompt-variant">
                <option value="test" ${variant === "test" ? "selected" : ""}>测试版：简化分段 + 广告识别</option>
                <option value="original" ${variant === "original" ? "selected" : ""}>原版：当前正式分段 Prompt</option>
            </select>
            <div class="empty-text" style="margin-top:8px;">切换后重新点击总结/分段刷新生效。开启调试模式后，日志会输出实际发送给 AI 的 Prompt 分块。</div>
        </div>
    `;
}

function renderDebugPanel(panel) {
    panel.dataset.lastSignature = "debug";
    panel.innerHTML = `
        <div class="page-header">
            <h3>测试</h3>
        </div>
        <div class="page-body debug-page-body">
            ${renderSegmentPromptDebugControls()}
            ${renderSubtitleEmptyDemoControls()}
            ${renderAsrUiTracePanel()}
            ${renderErrorDemoControls()}
            ${renderRealtimeLogPanel()}
        </div>
    `;
    bindSegmentPromptDebugControls(panel);
    bindRealtimeLogPanel(panel);
    renderAsrUiTraceData();
    renderRealtimeLogData();
    startRealtimeLogPolling();
}

function bindSegmentPromptDebugControls(panel) {
    const debugSelect = panel?.querySelector("#debug-mode-inline");
    if (debugSelect) {
        debugSelect.addEventListener("change", async () => {
            const debugMode = String(debugSelect.value || "false") === "true";
            const nextSettings = { ...(appState.settings || {}), debugMode };
            try {
                const res = await chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings: nextSettings });
                if (!res?.ok) throw new Error(res?.error || "保存失败");
                appState.settings = res.settings || nextSettings;
                IS_DEBUG_MODE = !!debugMode;
                logUI.info(debugMode ? "runtime_debug_enabled" : "runtime_debug_disabled", {
                    task: "debug",
                    detail: { source: "debug_page_inline_toggle" }
                });
                showToast(debugMode ? "已开启调试日志" : "已关闭调试日志");
                renderNav();
                renderRealtimeLogData();
            } catch (error) {
                showToast(error.message || "切换失败");
                debugSelect.value = appState.settings?.debugMode ? "true" : "false";
            }
        });
    }
    const select = panel?.querySelector("#debug-segment-prompt-variant");
    if (!select) return;
    select.addEventListener("change", async () => {
        const segmentPromptVariant = String(select.value || "test") === "original" ? "original" : "test";
        const nextSettings = { ...(appState.settings || {}), segmentPromptVariant };
        try {
            const res = await chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings: nextSettings });
            if (!res?.ok) throw new Error(res?.error || "保存失败");
            appState.settings = res.settings || nextSettings;
            logUI.info("debug_segment_prompt_variant_changed", {
                task: "debug",
                detail: { segment_prompt_variant: segmentPromptVariant }
            });
            showToast(segmentPromptVariant === "original" ? "已切换为原版分段 Prompt" : "已切换为测试版分段 Prompt");
        } catch (error) {
            showToast(error.message || "切换失败");
            select.value = String(appState.settings?.segmentPromptVariant || "test") === "original" ? "original" : "test";
        }
    });
}

function renderRealtimeLogPanel() {
    return `
        <div class="settings-group-title">实时日志</div>
        <div class="debug-log-panel">
            <div class="debug-log-toolbar">
                <span class="debug-log-status" id="debug-log-status">自动刷新中</span>
                <div class="debug-log-actions">
                    <button type="button" class="panel-btn ghost" data-action="debug-logs-refresh">刷新</button>
                    <button type="button" class="panel-btn ghost" data-action="debug-logs-copy">复制</button>
                    <button type="button" class="panel-btn ghost" data-action="debug-logs-clear">清空</button>
                </div>
            </div>
            <pre class="debug-log-body" id="debug-log-body">正在读取日志...</pre>
        </div>
    `;
}

function renderAsrUiTracePanel() {
    return `
        <div class="settings-group-title">转录 UI 状态日志</div>
        <div class="debug-log-panel">
            <div class="debug-log-toolbar">
                <span class="debug-log-status" id="debug-asr-ui-log-status">本页本地记录</span>
                <div class="debug-log-actions">
                    <button type="button" class="panel-btn ghost" data-action="debug-asr-ui-copy">复制</button>
                    <button type="button" class="panel-btn ghost" data-action="debug-asr-ui-clear">清空</button>
                </div>
            </div>
            <pre class="debug-log-body debug-asr-ui-log-body" id="debug-asr-ui-log-body">暂无转录 UI 状态日志。</pre>
        </div>
    `;
}

function bindRealtimeLogPanel(panel) {
    if (!panel) return;
    panel.querySelector('[data-action="debug-logs-refresh"]')?.addEventListener("click", () => {
        renderRealtimeLogData();
    });
    panel.querySelector('[data-action="debug-logs-copy"]')?.addEventListener("click", () => {
        copyRealtimeLogData();
    });
    panel.querySelector('[data-action="debug-logs-clear"]')?.addEventListener("click", () => {
        clearRealtimeLogs();
    });
    panel.querySelector('[data-action="debug-asr-ui-copy"]')?.addEventListener("click", () => {
        copyAsrUiTraceData();
    });
    panel.querySelector('[data-action="debug-asr-ui-clear"]')?.addEventListener("click", () => {
        clearAsrUiTraceData();
    });
}

async function runTasks(tasks) {
    if (hasLocalPendingTasks(tasks)) return;
    setLocalPendingTasks(tasks, true);
    renderContent();
    // Check for subtitle existence before running summary or segments
    if (!canRunTasksWithCache(tasks, resolveCurrentBvid(), appState.cache)) {
        const currentBvid = resolveCurrentBvid();
        if (needsSubtitleForTasks(tasks) && currentBvid) {
            const synced = await syncCacheFromBackgroundWithRetry(currentBvid, 3, 120, { skipCloud: false });
            if (synced && canRunTasksWithCache(tasks, currentBvid, appState.cache)) {
                setLocalPendingTasks(tasks, false);
                return runTasks(tasks);
            }
        }
        setLocalPendingTasks(tasks, false);
        if (!currentBvid || normalizeBvidCase(appState.cache?.bvid || "") !== normalizeBvidCase(currentBvid) || !hasSubtitleInCache(appState.cache)) {
            if (currentBvid) {
                appState.cloudReadState = createCloudReadState(
                    currentBvid,
                    "failed",
                    Number(appState.cloudReadState?.requestId || 0)
                );
            }
            if (appState.activePage === "summary") renderContent();
            showToast("当前视频暂无字幕，无法生成总结");
        }
        return;
    }

    const taskId = buildTasksProgressTaskId(tasks);
    try {
        tasks.forEach((t) => appState.sessionGeneratedTasks.add(t));
        tasks.forEach((t) => {
            if (t === "summary" || t === "segments") clearPanelError("summary");
            if (t === "rumors") clearPanelError("real");
        });
        startAsymptoticPseudoProgress(taskId, 12);
        const durationMeta = resolveVideoDurationMeta();
        const taskContext = durationMeta ? { videoDuration: durationMeta } : {};
        const res = await chrome.runtime.sendMessage({
            action: "RUN_TASKS",
            tasks,
            force: true,
            bvid: normalizeBvidCase(resolveCurrentBvid() || ""),
            taskContext
        });
        if (!res?.ok) throw new Error(res?.error || "任务失败");
        finishAsymptoticPseudoProgress(taskId, false);
    } catch (error) {
        finishAsymptoticPseudoProgress(taskId, true);
        logContent.error("task_abort", {
            task: "generate",
            code: error?.code || "",
            status: Number(error?.status || 0) || 0,
            detail: {
                tasks,
                error_message: error.message || "任务失败",
                stack_preview: String(error.stack || "").split("\n").slice(0, 3).join("\n")
            }
        });
        reportContentError?.(error, { task: tasks.join(","), source: "run_tasks" });
        const targetPage = tasks.includes("rumors") ? "real" : "summary";
        const view = setPanelError(targetPage, error, error.message || "任务失败");
        if (view?.presentation === "toast") showToast(view.message);
        else renderContent();
    } finally {
        setLocalPendingTasks(tasks, false);
        renderContent();
    }
}

async function handleSendChat() {
    const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-chat") : null;
    const input = panel?.querySelector("#chat-input");
    const text = String(input?.value || "").trim();
    if (!text) return;
    const messageId = createChatMessageId();
    const progressTaskId = buildChatProgressTaskId(messageId);
    clearPanelError("chat");
    
    input.value = "";
    appState.chatAutoScrollPausedUntil = 0;
    appState.chatStreamingId = `a_${messageId}`;
    appState.chatActiveMessageId = messageId;
    appState.sessionGeneratedTasks.add("chat");

    const currentPending = Array.isArray(appState.chatPending) ? appState.chatPending : [];
    appState.chatPending = [...currentPending, ...createPendingChatMessages(text, messageId)];
    startAsymptoticPseudoProgress(progressTaskId, 14);
    rerenderChatKeepInputAndScroll("");
    const port = getChatStreamPort();
    port.postMessage({
        action: "RUN_CHAT_STREAM",
        text,
        messageId,
        bvid: normalizeBvidCase(resolveCurrentBvid() || "")
    });
}

function handleStopChat() {
    const messageId = String(appState.chatActiveMessageId || "");
    if (!messageId) return;
    const port = getChatStreamPort();
    port.postMessage({ action: "ABORT_CHAT_STREAM", messageId });
}

function renderChatHistoryItem(item) {
    return renderChatHistoryItemHtml(item, {
        hideMetrics: shouldHideRuntimeMetrics(),
        onRenderError: (error) => {
            logUI.error("rich_content_render_failed", {
                task: "chat",
                code: "RENDER_FAILED",
                detail: { error_message: error.message || "渲染失败" }
            });
        }
    });
}

function renderAssistantBubble(text, metrics) {
    return renderAssistantBubbleHtml(text, metrics, {
        hideMetrics: shouldHideRuntimeMetrics(),
        onRenderError: (error) => {
            logUI.error("rich_content_render_failed", {
                task: "chat",
                code: "RENDER_FAILED",
                detail: { error_message: error.message || "渲染失败" }
            });
        }
    });
}

function renderTopRemaining() {
    const holder = panelShadowRoot ? panelShadowRoot.getElementById("logo-remaining") : null;
    if (!holder) return;
    if (shouldHideRuntimeMetrics()) {
        holder.textContent = "任务运行中...";
        holder.title = "任务运行中...";
        return;
    }
    const metrics = Array.isArray(appState.cache?.metrics) ? appState.cache.metrics : [];
    const latest = metrics[metrics.length - 1];
    if (!latest) {
        holder.textContent = "暂无调用指标";
        holder.title = "暂无调用指标";
        return;
    }
    const remaining = latest.modelScopeRemaining === null || latest.modelScopeRemaining === undefined || latest.modelScopeRemaining === "" ? "-" : String(latest.modelScopeRemaining);
    const total = Number(latest.tokens || 0);
    const input = Number(latest.inputTokens || 0);
    const output = Number(latest.outputTokens || 0);
    const tokenStr = input || output ? `${total} (In ${input} / Out ${output})` : `${total}`;
    const latency = Number.isFinite(Number(latest.latencyMs)) ? `${(Number(latest.latencyMs) / 1000).toFixed(3)}s` : "-";
    const metricLine = `用时: ${latency} · Tokens: ${tokenStr} · 该模型当天剩余次数 ${remaining}`;
    holder.textContent = metricLine;
    holder.title = metricLine;
}

function renderChatRows(history) {
    const historyList = Array.isArray(history) ? history : [];
    const pending = Array.isArray(appState.chatPending) ? appState.chatPending : [];
    const historyIds = new Set(historyList.map((item) => String(item?.id || "")));
    const merged = [
        ...historyList,
        ...pending.filter((item) => !historyIds.has(String(item?.id || "")))
    ];
    return merged.map((item) => {
        // Show skeleton if loading OR if streaming but no content yet
        if (item.role === "assistant" && (item.status === "loading" || (item.status === "streaming" && !String(item.content || "")))) {
            return `<div class="chat-loading-only">${renderSkeletonLines(4, "chat-skeleton")}</div>`;
        }
        if (item.role === "assistant" && item.status === "streaming") {
            return renderAssistantBubble(item.content || "", item.metrics || null);
        }
        return renderChatHistoryItem(item);
    }).filter((html) => !!String(html || "").trim()).join("");
}

function rerenderChatKeepInputAndScroll(value) {
    if (appState.activePage !== "chat") return;
    const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-chat") : null;
    if (!panel) return;
    const prevInput = panel.querySelector("#chat-input");
    const wasFocused = !!prevInput && (panelShadowRoot.activeElement === prevInput || document.activeElement === prevInput);
    const prevSelectionStart = wasFocused ? Number(prevInput.selectionStart || 0) : 0;
    const prevSelectionEnd = wasFocused ? Number(prevInput.selectionEnd || 0) : 0;
    const keepValue = typeof value === "string" ? value : String(prevInput?.value || "");
    renderChat(panel);
    const input = panel.querySelector("#chat-input");
    if (input) {
        input.value = keepValue;
        if (wasFocused) {
            try {
                input.focus({ preventScroll: true });
            } catch (_) {
                input.focus();
            }
            const max = input.value.length;
            const start = Math.max(0, Math.min(max, prevSelectionStart));
            const end = Math.max(0, Math.min(max, prevSelectionEnd));
            input.setSelectionRange(start, end);
        }
    }
    const list = panel.querySelector("#chat-list");
    if (list) {
        bindChatListAutoScroll(list);
        if (shouldAutoScrollChat()) scrollChatToBottom(list);
    }
}

function getChatStreamPort() {
    if (appState.chatPort) return appState.chatPort;
    const port = chrome.runtime.connect({ name: "chat-stream" });
    port.onMessage.addListener(onChatStreamMessage);
    port.onDisconnect.addListener(() => {
        const activeMessageId = String(appState.chatActiveMessageId || "");
        if (activeMessageId) {
            finishAsymptoticPseudoProgress(buildChatProgressTaskId(activeMessageId), true);
        }
        appState.chatPort = null;
    });
    appState.chatPort = port;
    return port;
}

function onChatStreamMessage(message) {
    const type = String(message?.type || "");
    const messageId = String(message?.messageId || "");
    if (!messageId) return;
    const progressTaskId = buildChatProgressTaskId(messageId);
    const assistantId = `a_${messageId}`;
    if (type === "delta") {
        const delta = String(message?.delta || "");
        if (!delta) return;
        appState.chatPending = (appState.chatPending || []).map((item) => {
            if (item.id !== assistantId) return item;
            const nextText = `${item.content || ""}${delta}`;
            return { ...item, status: "streaming", content: nextText };
        });
        rerenderChatKeepInputAndScroll("");
        return;
    }
    if (type === "done") {
        const answer = String(message?.answer || "");
        const metrics = message?.metrics || null;
        appState.chatPending = (appState.chatPending || []).map((item) => {
            if (item.id !== assistantId) return item;
            return { ...item, status: "done", content: answer, metrics };
        });
        appState.chatStreamingId = "";
        appState.chatActiveMessageId = "";
        finishAsymptoticPseudoProgress(progressTaskId, false);
        rerenderChatKeepInputAndScroll("");
        renderTopRemaining();
        return;
    }
    if (type === "aborted") {
        appState.chatPending = (appState.chatPending || []).map((item) => {
            if (item.id !== assistantId) return item;
            const text = String(item.content || "").trim() || "已停止";
            return { ...item, status: "done", content: text, metrics: item.metrics || null };
        });
        appState.chatStreamingId = "";
        appState.chatActiveMessageId = "";
        finishAsymptoticPseudoProgress(progressTaskId, false);
        rerenderChatKeepInputAndScroll("");
        return;
    }
    if (type === "error") {
        const errorInput = toErrorInput(message, "请求失败");
        const view = mapErrorToView ? mapErrorToView(errorInput, "请求失败") : null;
        const error = view?.message || String(message?.error || message?.message || "请求失败");
        if (view?.presentation !== "toast") {
            setPanelError("chat", errorInput, "请求失败");
            appState.chatPending = (appState.chatPending || []).filter((item) => item.id !== assistantId);
            appState.chatStreamingId = "";
            appState.chatActiveMessageId = "";
            finishAsymptoticPseudoProgress(progressTaskId, true);
            renderContent();
            return;
        }
    
        appState.chatPending = (appState.chatPending || []).map((item) => {
            if (item.id !== assistantId) return item;
            return {
                ...item,
                status: "done",
                content: `请求失败：${error}`,
                metrics: null,
                failed: true
            };
        });
    
        appState.chatStreamingId = "";
        appState.chatActiveMessageId = "";
        finishAsymptoticPseudoProgress(progressTaskId, true);
        rerenderChatKeepInputAndScroll("");
    
        setTimeout(() => {
            appState.chatPending = (appState.chatPending || []).filter((item) => {
                return !(item.id === assistantId && item.failed);
            });
            rerenderChatKeepInputAndScroll("");
        }, 5000);
    
        return;
    }
}

function scrollChatToBottom(list) {
    if (!list) return;
    const jumpToBottom = () => {
        list.scrollTop = list.scrollHeight;
    };
    jumpToBottom();
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                jumpToBottom();
            });
        });
    }
}

function pruneChatPendingByHistory(history) {
    const list = Array.isArray(history) ? history : [];
    if (!list.length || !Array.isArray(appState.chatPending) || !appState.chatPending.length) return;
    const ids = new Set(list.map((item) => String(item?.id || "")));
    appState.chatPending = appState.chatPending.filter((item) => !ids.has(String(item?.id || "")));
}

function resetPageStateByBvidSwitch() {
    appState.cache = null;
    appState.chatPending = [];
    appState.chatStreamingId = "";
    appState.chatActiveMessageId = "";
    appState.sessionGeneratedTasks = new Set();
    if (appState.chatStreamTimer) {
        clearInterval(appState.chatStreamTimer);
        appState.chatStreamTimer = null;
    }
    appState.chatGuideHidden = false;
    
    const chatPanel = panelShadowRoot ? panelShadowRoot.getElementById("page-chat") : null;
    if (chatPanel) {
    chatPanel.dataset.lastSignature = "";
    chatPanel.innerHTML = "";
    }
    
    appState.followCurrentIndex = -1;
    appState.renderedSubtitleIndex = -1;
    closeCopyMenu();
    appState.chatAutoScrollPausedUntil = 0;
    appState.subtitleCapturedBvid = "";
    appState.pendingSubtitle = null;
    appState.timelineSearchTerm = "";
    if (appState.timelineSearchDebounceTimer) {
        clearTimeout(appState.timelineSearchDebounceTimer);
        appState.timelineSearchDebounceTimer = null;
    }
    appState.ccSearchTerm = "";
    if (appState.ccSearchDebounceTimer) {
        clearTimeout(appState.ccSearchDebounceTimer);
        appState.ccSearchDebounceTimer = null;
    }
    if (appState.navActionActiveTimer) {
        clearTimeout(appState.navActionActiveTimer);
        appState.navActionActiveTimer = null;
    }
    appState.navActionActive = "";
    appState.lastSubtitleForwardAt = 0;
    appState.subtitleTimeline = [];
    resetTranscriptionState();
    clearAsrSession();
    appState.transcriptionDeclinedBvid = "";
    appState.transcriptionSuppressUntil = 0;
    appState.transcriptionCapsuleVisible = false;
    appState.transcriptionCapsuleMeta = null;
    appState.subtitleDomDetected = false;
    appState.subtitleObserveUntil = 0;
    appState.subtitleCheckTargetBvid = "";
    appState.expandedSummaryHeight = 0;
    appState.lastCacheSyncTime = 0;
    appState.lastCacheSyncBvid = "";
    appState.isStateDirty = true;
    clearStepProgressTimers();
    clearPseudoProgressTicker();
    appState.progressTaskId = "";
    appState.progressLastPercent = 0;
    appState.progressLastTick = 0;
    clearStepProgressTimers();
    clearPseudoProgressTicker();
    const currentBvid = normalizeBvidCase(resolveCurrentBvid() || getBvidFromUrl(location.href) || "");

    if (appState.tabState && typeof appState.tabState === "object") {
        appState.tabState = {
            ...appState.tabState,
            transcriptionProgress: 0
        };
    }

    appState.pseudoProgressTaskId = "";
    appState.pseudoProgressValue = 0;
    appState.pseudoProgressStartedAt = 0;
    appState.cloudReadState = { bvid: "", status: "idle", requestId: 0, startedAt: 0 };
    appState.cache = null; // Explicitly clear cache
    appState.playInfo = null; // Explicitly clear playInfo
    const bar = panelShadowRoot ? panelShadowRoot.getElementById("step-progress-bar") : null;
    if (bar) resetStepProgressBar(bar);
    appState.segmentsMarkerTickAt = 0;
    removeSegmentsFloatWindow();
    removeSegmentsProgressMarkers();
    if (appState.subtitleCheckDelayTimer) {
        clearTimeout(appState.subtitleCheckDelayTimer);
        appState.subtitleCheckDelayTimer = null;
    }
    if (appState.subtitleDetectTimeoutTimer) {
        clearTimeout(appState.subtitleDetectTimeoutTimer);
        appState.subtitleDetectTimeoutTimer = null;
    }
    if (appState.transcribeCountdownTimer) {
        clearInterval(appState.transcribeCountdownTimer);
        appState.transcribeCountdownTimer = null;
    }
    stopSubtitleObserver();
}

function resetAllState() {
    appState.chatPending = [];
    appState.chatStreamingId = "";
    appState.chatActiveMessageId = "";
    appState.sessionGeneratedTasks = new Set();
    appState.chatGuideHidden = false;

    const chatPanel = panelShadowRoot ? panelShadowRoot.getElementById("page-chat") : null;
    if (chatPanel) {
        chatPanel.dataset.lastSignature = "";
        chatPanel.innerHTML = "";
    }

    appState.subtitleDomDetected = false;
    resetTranscriptionState();
    clearAsrSession();
    appState.subtitleObserveUntil = 0;
    appState.subtitleCheckTargetBvid = "";
    appState.expandedSummaryHeight = 0;
    appState.lastCacheSyncTime = 0;
    appState.lastCacheSyncBvid = "";
    appState.isStateDirty = true;
    appState.transcriptionCapsuleVisible = false;
    appState.transcriptionCapsuleMeta = null;
    appState.pendingSubtitle = null;
    appState.cache = null; // Explicitly clear cache including summary, segments, etc.
    appState.playInfo = null; // Explicitly clear playInfo
    
    clearStreamCache();
    clearStepProgressTimers();
    clearPseudoProgressTicker();
    
    appState.progressTaskId = "";
    appState.progressLastTick = 0;
    appState.progressLastPercent = 0;
    appState.pseudoProgressTaskId = "";
    appState.pseudoProgressValue = 0;
    appState.pseudoProgressStartedAt = 0;
    appState.cloudReadState = { bvid: "", status: "idle", requestId: 0, startedAt: 0 };
    appState.segmentsMarkerTickAt = 0;
    
    const bar = panelShadowRoot ? panelShadowRoot.getElementById("step-progress-bar") : null;
    if (bar) resetStepProgressBar(bar);
    
    removeSegmentsFloatWindow();
    removeSegmentsProgressMarkers();
    
    if (appState.subtitleCheckDelayTimer) {
        clearTimeout(appState.subtitleCheckDelayTimer);
        appState.subtitleCheckDelayTimer = null;
    }
    if (appState.subtitleDetectTimeoutTimer) {
        clearTimeout(appState.subtitleDetectTimeoutTimer);
        appState.subtitleDetectTimeoutTimer = null;
    }
    if (appState.transcribeCountdownTimer) {
        clearInterval(appState.transcribeCountdownTimer);
        appState.transcribeCountdownTimer = null;
    }
    stopSubtitleObserver();
    resetPageStateByBvidSwitch();
    
    const ccContainer = panelShadowRoot ? panelShadowRoot.getElementById("page-CC") : null;
    if (ccContainer) {
        appState.renderedSubtitleIndex = -1;
        renderCC(ccContainer, []);
    }
}

function resetAppState() {
    resetPageStateByBvidSwitch();
}

async function handleSmartCopy(buttonNode) {
    if (appState.activePage === "summary") {
        await handleCopySummaryText(buttonNode);
        return;
    }
    if (appState.activePage === "CC") {
        toggleCopyMenu(buttonNode);
        return;
    }
    await handleCopyRawSubtitle(buttonNode);
}

async function handleCopySummaryText(buttonNode) {
    const text = String(appState.cache?.summary || "").trim();
    if (!text) {
        showToast("暂无总结可复制");
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast("复制成功");
    } catch (_) {
        showToast("复制失败");
    }
}

function toggleCopyMenu(buttonNode) {
    const existing = document.getElementById("copy-option-menu");
    if (existing) {
        existing.remove();
        return;
    }
    const rect = buttonNode?.getBoundingClientRect?.();
    const overlay = document.createElement("div");
    overlay.id = "copy-option-menu";
    overlay.className = "copy-menu-overlay";
    overlay.innerHTML = `<div class="copy-option-menu"><button type="button" class="copy-option-btn" data-action="copy-with-time">复制（带时间戳）</button><button type="button" class="copy-option-btn" data-action="copy-without-time">复制（纯文本）</button></div>`;
    const menu = overlay.querySelector(".copy-option-menu");
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeCopyMenu();
    });
    overlay.querySelector('[data-action="copy-with-time"]')?.addEventListener("click", () => {
        closeCopyMenu();
        handleCopySubtitleWithTimestamp();
    });
    overlay.querySelector('[data-action="copy-without-time"]')?.addEventListener("click", () => {
        closeCopyMenu();
        handleCopyRawSubtitle();
    });
    if (rect) {
        const left = Math.max(8, rect.right + 8);
        const top = Math.max(8, rect.top);
        overlay.style.setProperty("--copy-menu-left", `${left}px`);
        overlay.style.setProperty("--copy-menu-top", `${top}px`);
        if (menu) {
            menu.style.left = "var(--copy-menu-left)";
            menu.style.top = "var(--copy-menu-top)";
        }
    }
    document.body.appendChild(overlay);
}

function closeCopyMenu() {
    const menu = document.getElementById("copy-option-menu");
    if (menu) menu.remove();
    if (appState.navActionActive === "copy") {
        setNavActionActive("");
    }
}

async function handleCopySubtitleWithTimestamp() {
    const rows = getRawSubtitleRows();
    if (!rows.length) {
        showToast("暂无 RAW 字幕");
        return;
    }
    const text = buildTimestampedSubtitleText(appState.cache);
    try {
        await navigator.clipboard.writeText(text);
        showToast("复制成功");
    } catch (_) {
        showToast("复制失败");
    }
}

function bindChatListAutoScroll(list) {
    if (!list || list.dataset.autoBound === "1") return;
    list.dataset.autoBound = "1";
    const pause = () => {
        appState.chatAutoScrollPausedUntil = Date.now() + 3000;
    };
    list.addEventListener("wheel", pause, { passive: true });
    list.addEventListener("touchmove", pause, { passive: true });
}

function shouldAutoScrollChat() {
    const isStreaming = !!String(appState.chatStreamingId || "").trim();
    return isStreaming && Date.now() >= Number(appState.chatAutoScrollPausedUntil || 0);
}

function isCloudReadLoadingForCurrentVideo() {
    if (!isCloudReadLoadingForVideo(appState.cloudReadState, resolveCurrentBvid())) return false;
    const startedAt = Number(appState.cloudReadState?.startedAt || 0);
    if (startedAt && Date.now() - startedAt > CLOUD_READ_TIMEOUT_MS + 500) {
        appState.cloudReadState = createCloudReadState(
            appState.cloudReadState?.bvid || resolveCurrentBvid() || "",
            "failed",
            Number(appState.cloudReadState?.requestId || 0)
        );
        return false;
    }
    return true;
}

function shouldAttemptCloudReadForVideo(bvid) {
    return shouldAttemptCloudReadForVideoState(appState.cache, appState.cloudReadState, bvid || resolveCurrentBvid());
}

function shouldAttemptCloudReadForPage(page) {
    return shouldAttemptCloudReadForPageState(appState.cache, appState.cloudReadState, resolveCurrentBvid(), page);
}

function isAsrSubtitleSourceValue(source) {
    const value = String(source || "").toLowerCase();
    return value === "groq" || value === "whisper" || value === "siliconflow" || value === "funasr";
}

function applyCacheSubtitleState(cache, targetBvid = "") {
    const target = normalizeBvidCase(targetBvid || cache?.bvid || resolveCurrentBvid() || "");
    if (!target || !cache || normalizeBvidCase(cache?.bvid || "") !== target) return;
    const subtitleSource = String(cache?.subtitleSource || "");
    appState.tabState = {
        ...(appState.tabState || {}),
        activeBvid: target,
        subtitleSource: subtitleSource || appState.tabState?.subtitleSource || "",
        transcriptionProgress: isAsrSubtitleSourceValue(subtitleSource)
            ? 100
            : Number(appState.tabState?.transcriptionProgress || 0)
    };
    if (hasUsableSubtitleCache(cache, target)) {
        appState.subtitleCapturedBvid = target;
    }
}

function startCloudReadForCurrentVideo(options = {}) {
    const target = normalizeBvidCase(options?.bvid || resolveCurrentBvid() || "");
    if (!target) return;
    const silent = options?.silent !== false;
    const nextRequestId = Number(appState.cloudReadState?.requestId || 0) + 1;
    appState.cloudReadState = createCloudReadState(target, "loading", nextRequestId);
    if (!silent) renderContent();
    const request = chrome.runtime.sendMessage({ action: "GET_CACHE", bvid: target });
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("CLOUD_TIMEOUT")), CLOUD_READ_TIMEOUT_MS);
    });
    Promise.race([request, timeout])
        .then((res) => {
            if (normalizeBvidCase(appState.cloudReadState?.bvid || "") !== target) return;
            if (Number(appState.cloudReadState?.requestId || 0) !== nextRequestId) return;
            if (!res?.ok) {
                appState.cloudReadState = createCloudReadState(target, "failed", nextRequestId);
                if (!silent) renderContent();
                showToast("访问云端数据库失败");
                return;
            }
            const cache = res?.cache || null;
            const cacheUpdated = !!(cache && normalizeBvidCase(cache?.bvid || "") === target);
            if (cache && normalizeBvidCase(cache?.bvid || "") === target) {
                appState.cache = cache;
                applyCacheSubtitleState(cache, target);
            }
            if (res?.tabState) appState.tabState = res.tabState;
            if (cache && normalizeBvidCase(cache?.bvid || "") === target) {
                applyCacheSubtitleState(cache, target);
            }
            appState.cloudReadState = createCloudReadState(target, "success", nextRequestId);
            if (cacheUpdated || !silent || ["CC", "summary", "chat", "real"].includes(appState.activePage)) renderContent();
        })
        .catch((error) => {
            if (normalizeBvidCase(appState.cloudReadState?.bvid || "") !== target) return;
            if (Number(appState.cloudReadState?.requestId || 0) !== nextRequestId) return;
            appState.cloudReadState = createCloudReadState(target, "failed", nextRequestId);
            if (!silent || ["CC", "summary", "chat", "real"].includes(appState.activePage)) renderContent();
            if (String(error?.message || "") && String(error.message) !== "CLOUD_TIMEOUT") {
                reportContentError?.(error, { task: "cloud_read", source: "cloud_read" });
                notifyMappedError({ ...error, code: "CLOUD_FAILED" }, "访问云端数据库失败");
            }
        });
}

function ensureCloudReadForActivePage() {
    if (!shouldAttemptCloudReadForPage(appState.activePage)) return;
    startCloudReadForCurrentVideo();
}

function renderCloudLoadingState(title, detail = "读取云端数据中...") {
    return `
        <div class="page-header">
            <h3>${title}</h3>
        </div>
        <div class="page-body subtitle-empty-container">
            <div class="action-container">
                <p class="action-tip">${detail}</p>
            </div>
        </div>
    `;
}

function renderMissingSubtitleState() {
    return `
        <div class="page-body subtitle-empty-container">
            <div class="action-container">
                <p class="action-tip">暂无字幕</p>
                <div class="subtitle-empty-actions">
                    <button class="action-btn subtitle-empty-primary" data-action="goto-cc-tab">去生成字幕</button>
                    <button class="action-btn ghost subtitle-empty-secondary" data-action="summary-refresh-subtitle-cache">刷新</button>
                </div>
            </div>
        </div>
    `;
}

function dismissChatGuide() {
    appState.chatGuideHidden = true;
}

function hideChatGuideNodes(panel) {
    panel?.querySelectorAll(".chat-greeting, .chat-suggest-list").forEach((node) => {
        node.style.display = "none";
    });
}

function updateSettingsProviderHint(panel) {
    const providers = { ...(appState.providers || {}) };
    if (!providers.custom) providers.custom = { name: "自定义", baseUrl: "", regUrl: "" };
    
    // Check if we are using custom select or native select (fallback)
    let key = "";
    const customSelect = panel?.querySelector("#settings-provider-select");
    if (customSelect) {
        // Find the selected option in custom select
        const selectedOption = customSelect.querySelector(".custom-option.selected");
        key = selectedOption ? selectedOption.dataset.value : (appState.settings?.provider || "modelscope");
    } else {
        key = panel?.querySelector("#settings-provider")?.value || "";
    }

    const provider = providers[key] || {};
    const urlNode = panel?.querySelector(".settings-provider-url");
    const regBtn = panel?.querySelector('[data-action="settings-open-reg"]');
    const customWrap = panel?.querySelector(".settings-custom-only");
    const providerModelWrap = panel?.querySelector("#settings-provider-model-wrap");
    const plainModelInput = panel?.querySelector("#settings-model");
    const providerModelSelect = panel?.querySelector("#settings-provider-model");
    const providerCustomModelInput = panel?.querySelector("#settings-provider-custom-model");
    const customBase = String(panel?.querySelector("#settings-base-url")?.value || "").trim();
    const isCustom = key === "custom";
    const hasProviderModelSelect = !isCustom && getProviderModelOptions(key).length > 0;
    if (customWrap) customWrap.classList.toggle("settings-hidden", !isCustom);
    if (providerModelWrap) providerModelWrap.classList.toggle("settings-hidden", !hasProviderModelSelect);
    if (plainModelInput) plainModelInput.classList.toggle("settings-hidden", hasProviderModelSelect);
    if (providerCustomModelInput) {
        providerCustomModelInput.classList.toggle("settings-hidden", !hasProviderModelSelect || String(providerModelSelect?.value || "") !== "custom");
    }
    if (urlNode) {
        urlNode.textContent = isCustom ? (customBase || "请填写自定义 Base URL") : (provider.baseUrl || "-");
    }
    if (regBtn) {
        regBtn.dataset.url = isCustom ? "" : (provider.regUrl || "");
        regBtn.disabled = isCustom;
    }
}

function updateSettingsAsrProviderHint(panel) {
    const asrProviders = {
        groq: {
            note: "需科学上网",
            regUrl: "https://console.groq.com/keys"
        },
        siliconflow: {
            note: "无字幕时间戳",
            regUrl: "https://cloud.siliconflow.cn/account/ak"
        }
    };
    const key = String(panel?.querySelector("#settings-asr-provider")?.value || "groq").toLowerCase() === "siliconflow" ? "siliconflow" : "groq";
    const provider = asrProviders[key] || asrProviders.groq;
    const regBtn = panel?.querySelector('[data-register-kind="asr"]');
    const groqWrap = panel?.querySelector("#settings-asr-groq-wrap");
    const siliconFlowWrap = panel?.querySelector("#settings-asr-siliconflow-wrap");
    if (regBtn) {
        regBtn.dataset.url = provider.regUrl;
        regBtn.disabled = false;
    }
    if (groqWrap) groqWrap.classList.toggle("settings-hidden", key !== "groq");
    if (siliconFlowWrap) siliconFlowWrap.classList.toggle("settings-hidden", key !== "siliconflow");
}

async function authorizeCustomOriginFromPanel() {
    const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-settings") : null;
    if (!panel) return false;
    const statusEl = panel.querySelector("#save-status");
    const selectedOption = panel.querySelector("#settings-provider-select .custom-option.selected");
    const providerValue = selectedOption ? selectedOption.dataset.value : "modelscope";
    if (providerValue !== "custom") {
        showToast("请先切换到自定义 Provider");
        return false;
    }
    const customUrl = String(panel.querySelector("#settings-base-url")?.value || "").trim();
    if (!customUrl) {
        showToast("请先填写 Base URL");
        return false;
    }
    if (statusEl) {
        statusEl.textContent = "请在新窗口中完成授权...";
        statusEl.className = "show syncing pulse";
    }
    try {
        const openRes = await chrome.runtime.sendMessage({
            action: "OPEN_PERMISSION_REQUEST_PAGE",
            baseUrl: customUrl
        });
        if (!openRes?.ok) {
            throw new Error("打开授权窗口失败");
        }
        const startedAt = Date.now();
        let granted = false;
        while (Date.now() - startedAt < 60000) {
            const permissionRes = await chrome.runtime.sendMessage({
                action: "ENSURE_OPTIONAL_ORIGIN_PERMISSION",
                baseUrl: customUrl,
                request: false
            });
            if (permissionRes?.granted) {
                granted = true;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (!granted) {
            throw new Error("未授权访问该自定义 API 域名");
        }
        if (statusEl) {
            statusEl.textContent = "域名已授权，正在同步...";
            statusEl.className = "show syncing pulse";
        }
        await saveSettingsFromPanel(true);
        showToast("自定义 API 域名已授权");
        return true;
    } catch (error) {
        if (statusEl) {
            statusEl.textContent = "域名授权失败";
            statusEl.className = "show syncing";
        }
        reportContentError?.(error, { task: "settings_authorize", source: "settings" });
        showToast(error?.message || "授权失败");
        return false;
    }
}

function bindSettingsCustomSelects(panel) {
    if (panel.dataset.customSelectCloseBound !== "1") {
        panel.dataset.customSelectCloseBound = "1";
        panel.addEventListener("click", () => {
            panel.querySelectorAll(".custom-select-container.open").forEach((item) => item.classList.remove("open"));
        });
    }
    panel.querySelectorAll(".settings-custom-select").forEach((selectContainer) => {
        const targetId = selectContainer.dataset.targetSelect || "";
        const nativeSelect = targetId ? panel.querySelector(`#${CSS.escape(targetId)}`) : null;
        const selectTrigger = selectContainer.querySelector(".custom-select-trigger");
        const selectOptions = selectContainer.querySelector(".custom-select-options");
        if (!nativeSelect || !selectTrigger || !selectOptions) return;

        selectTrigger.addEventListener("click", (event) => {
            event.stopPropagation();
            const wasOpen = selectContainer.classList.contains("open");
            panel.querySelectorAll(".custom-select-container.open").forEach((item) => {
                if (item !== selectContainer) item.classList.remove("open");
            });
            selectContainer.classList.toggle("open", !wasOpen);
        });

        selectOptions.querySelectorAll(".custom-option").forEach((option) => {
            option.addEventListener("click", (event) => {
                event.stopPropagation();
                const value = String(option.dataset.value || "");
                nativeSelect.value = value;
                selectContainer.querySelector(".current-value").textContent = option.dataset.label || option.textContent || "";
                selectOptions.querySelectorAll(".custom-option").forEach((item) => item.classList.remove("selected"));
                option.classList.add("selected");
                selectContainer.classList.remove("open");
                nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
            });
        });
    });
}

async function saveSettingsFromPanel(isAutoSave = false, options = {}) {
    const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-settings") : null;
    if (!panel) return;
    const opts = options && typeof options === "object" ? options : {};
    
    // Validate API Keys globally before saving. Leading/trailing spaces are trimmed;
    // inner spaces still block saving because providers reject them.
    const secretInputs = Array.from(panel.querySelectorAll("[data-secret-input]"));
    for (const input of secretInputs) {
        const trimmed = String(input.value || "").trim();
        if (input.value !== trimmed) input.value = trimmed;
        const invalid = /[\s\u4e00-\u9fa5]/.test(trimmed);
        if (invalid) {
            const apiKeyError = panel.querySelector(`#${input.id}-error`);
            input.classList.add("input-error");
            if (apiKeyError) apiKeyError.classList.add("show");
            return;
        }
        input.classList.remove("input-error");
        const apiKeyError = panel.querySelector(`#${input.id}-error`);
        if (apiKeyError) apiKeyError.classList.remove("show");
    }

    const statusEl = panel.querySelector("#save-status");
    if (isAutoSave && statusEl) {
        if (appState.saveStatusTimer) {
            clearTimeout(appState.saveStatusTimer);
            appState.saveStatusTimer = null;
        }
        statusEl.textContent = "同步中...";
        statusEl.className = "show syncing pulse";
    }

    // Support custom select
    let providerValue = "modelscope";
    const customSelect = panel.querySelector("#settings-provider-select");
    if (customSelect) {
         const selectedOption = customSelect.querySelector(".custom-option.selected");
         providerValue = selectedOption ? selectedOption.dataset.value : providerValue;
    } else {
        providerValue = panel.querySelector("#settings-provider")?.value || "modelscope";
    }

    const customProtocolValue = panel.querySelector("#settings-custom-protocol")?.value || "openai";
    const defaultOpenPage = resolveDefaultOpenPage(panel.querySelector("#settings-default-open-page")?.value || appState.settings?.defaultOpenPage);
    const promptMode = String(panel.querySelector("#settings-prompt-mode")?.value || "guided") === "custom" ? "custom" : "guided";
    
    // Map slider values (0, 1, 2) back to string keys
    const toneVal = Number(panel.querySelector("#settings-prompt-tone")?.value ?? 1);
    const detailVal = Number(panel.querySelector("#settings-prompt-detail")?.value ?? 1);
    const promptTone = toneVal === 0 ? "casual" : (toneVal === 2 ? "professional" : "balanced");
    const promptDetail = detailVal === 0 ? "brief" : (detailVal === 2 ? "detailed" : "normal");
    const providerModelValue = String(panel.querySelector("#settings-provider-model")?.value || "").trim();
    const hasProviderModelSelect = providerValue !== "custom" && getProviderModelOptions(providerValue).length > 0;
    const resolvedModelValue = hasProviderModelSelect
        ? (providerModelValue === "custom"
            ? String(panel.querySelector("#settings-provider-custom-model")?.value || "").trim()
            : providerModelValue)
        : String(panel.querySelector("#settings-model")?.value || "").trim();

    const payload = {
        provider: providerValue,
        apiKey: String(panel.querySelector("#settings-api-key")?.value || "").trim(),
        model: resolvedModelValue,
        customBaseUrl: String(panel.querySelector("#settings-base-url")?.value || "").trim(),
        customProtocol: customProtocolValue === "claude" ? "claude" : "openai",
        asrProvider: String(panel.querySelector("#settings-asr-provider")?.value || "groq").toLowerCase() === "siliconflow" ? "siliconflow" : "groq",
        groqApiKey: String(panel.querySelector("#settings-groq-api-key")?.value || "").trim(),
        groqModel: String(panel.querySelector("#settings-groq-model")?.value || "").trim(),
        siliconFlowApiKey: String(panel.querySelector("#settings-siliconflow-api-key")?.value || "").trim(),
        siliconFlowAsrModel: String(panel.querySelector("#settings-siliconflow-asr-model")?.value || "").trim(),
        prefMode: panel.querySelector("#settings-pref-mode")?.value || "quality",
        defaultOpenPage,
        sentryEnabled: panel.querySelector("#settings-sentry-enabled")?.value === "true",
        sentryDsn: String(appState.settings?.sentryDsn || "").trim(),
        debugMode: panel.querySelector("#settings-debug-mode")?.value === "true",
        promptSettings: {
            mode: promptMode,
            guided: {
                tone: promptTone,
                detail: promptDetail
            },
            custom: {
                summary: String(panel.querySelector("#settings-prompt-summary")?.value || "").trim(),
                segments: String(panel.querySelector("#settings-prompt-segments")?.value || "").trim(),
                rumors: String(panel.querySelector("#settings-prompt-rumors")?.value || "").trim()
            }
        }
    };
    if (providerValue !== "custom") {
        payload.customBaseUrl = appState.settings?.customBaseUrl || payload.customBaseUrl;
    }
    try {
        if (providerValue === "custom") {
            const customUrl = String(payload.customBaseUrl || "").trim();
            if (!customUrl) {
                throw new Error("自定义 Provider 需要填写 Base URL");
            }
            const permissionRes = await chrome.runtime.sendMessage({
                action: "ENSURE_OPTIONAL_ORIGIN_PERMISSION",
                baseUrl: customUrl,
                request: !!opts.requestCustomPermission
            });
            if (!permissionRes?.granted) {
                if (isAutoSave) {
                    if (statusEl) {
                        statusEl.textContent = "请点击“授权当前域名”以启用自定义 API";
                        statusEl.className = "show syncing";
                    }
                    return;
                }
                throw new Error("请先授权访问该自定义 API 域名");
            }
        }
        const res = await chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings: payload });
        if (!res?.ok) throw new Error(res?.error || "保存失败");
        appState.settings = res.settings || payload;
        
    if (isAutoSave) {
        const livePanel = panel;
        livePanel.dataset.lastSignature = JSON.stringify(appState.settings);
        const liveStatusEl = livePanel.querySelector("#save-status");
        if (liveStatusEl) {
            // Cancel previous timers
            if (appState.saveShowTimer) clearTimeout(appState.saveShowTimer);
            if (appState.saveStatusTimer) clearTimeout(appState.saveStatusTimer);
            
            // Show "Saving..." immediately or if it's too fast, just proceed to "Saved"
            // Actually, for better UX, we should just show "Saved" after a tiny delay to ensure user sees it
            
            appState.saveShowTimer = setTimeout(() => {
                liveStatusEl.textContent = "已保存";
                liveStatusEl.className = "show saved";
                
                // Disappear after 2s
                appState.saveStatusTimer = setTimeout(() => {
                    const currentStatusEl = livePanel.querySelector("#save-status");
                    if (currentStatusEl) currentStatusEl.classList.remove("show");
                    appState.saveStatusTimer = null;
                }, 2000);
            }, 300);
        }
    } else {
        showToast("设置已保存");
        renderSettings(panel);
    }
    } catch (error) {
        reportContentError?.(error, { task: "settings_save", source: "settings" });
        showToast(error.message || "保存失败");
    }
}

function startFocusTicker() {
    const loop = () => {
        if (appState.activePage === "CC") scrollToCurrentSubtitle(false);
        if (Date.now() - Number(appState.segmentsMarkerTickAt || 0) >= 1000) {
            appState.segmentsMarkerTickAt = Date.now();
            renderSegmentsProgressMarkers();
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

function scrollToCurrentSubtitle(force, behavior = "smooth") {
    const rows = getRawSubtitleRowsFromCache(appState.cache);
    if (!rows.length) return;
    let canFollowScroll = appState.followEnabled;
    if (!appState.followEnabled && !force) {
        if (Date.now() - appState.followPausedAt >= FOLLOW_RESUME_MS) {
            appState.followEnabled = true;
            canFollowScroll = true;
            toggleFollowButton();
        } else {
            canFollowScroll = false;
            toggleFollowButton();
        }
    } else if (force) {
        canFollowScroll = true;
    }
    const t = getPlayerTime();
    // Allow highlighting even if time is 0 or paused, as long as it's valid
    if (!Number.isFinite(t)) return;
    
    const index = getActiveSubtitleIndex(rows, t);
    const changed = index !== appState.followCurrentIndex;
    
    // Always highlight if forced or changed
    if (changed || force) {
        appState.followCurrentIndex = index;
        highlightSubtitleRow(index);
    }
    
    updateFollowButtonDirection();
    
    if (!changed && !canFollowScroll) return;
    
    if (index >= 0 && canFollowScroll) {
        const list = panelShadowRoot ? panelShadowRoot.getElementById("cc-list") : null;
        const target = list?.querySelector(`.cc-row[data-index="${index}"]`);
        if (list && target) {
            // Force auto behavior if requested (e.g. tab switch), overriding smooth default
            const scrollBehavior = behavior === "auto" ? "auto" : behavior;
            const top = target.offsetTop - list.clientHeight / 2 + target.clientHeight / 2;
            list.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior });
        }
    }
}

function getActiveSubtitleIndex(rows, t) {
    for (let i = 0; i < rows.length; i += 1) {
        const start = Number(rows[i].start || 0);
        const nextStart = i < rows.length - 1 ? Number(rows[i + 1].start || start) : Number(rows[i].end ?? start + 6);
        const end = Number.isFinite(Number(rows[i].end)) ? Number(rows[i].end) : nextStart;
        if (start <= t && t < end) return i;
    }
    return -1;
}

function highlightSubtitleRow(index) {
    if (index === appState.renderedSubtitleIndex) return;
    const list = panelShadowRoot ? panelShadowRoot.getElementById("cc-list") : null;
    if (!list) return;
    list.querySelectorAll(".cc-row.active").forEach((node) => node.classList.remove("active"));
    const active = index >= 0 ? list.querySelector(`.cc-row[data-index="${index}"]`) : null;
    if (active) active.classList.add("active");
    appState.renderedSubtitleIndex = index;
}

function pauseFollow() {
    appState.followEnabled = false;
    appState.followPausedAt = Date.now();
    toggleFollowButton();
    updateFollowButtonDirection();
}

async function onCCListClick(event) {
    const jumpBtn = event.target.closest('[data-action="cc-jump"]');
    if (jumpBtn) {
        event.preventDefault();
        event.stopPropagation();
        jumpTo(Number(jumpBtn.dataset.sec || 0));
        return;
    }
    const button = event.target.closest('[data-action="cc-copy"]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const row = button.closest(".cc-row");
    const text = String(row?.querySelector(".cc-text")?.textContent || "").trim();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        const origin = button.dataset.originText || button.textContent || "复制";
        button.dataset.originText = origin;
        button.textContent = "OK";
        button.classList.add("copied");
        row?.classList.add("copied");
        showToast("已复制");
        setTimeout(() => {
            button.textContent = origin;
            button.classList.remove("copied");
            row?.classList.remove("copied");
        }, 1000);
    } catch (_) {
        showToast("复制失败");
    }
}

function toggleFollowButton() {
    const btn = panelShadowRoot ? panelShadowRoot.getElementById("btn-follow-now") : null;
    if (!btn) return;
    btn.style.display = appState.followEnabled ? "none" : "flex";
    if (!appState.followEnabled) updateFollowButtonDirection();
}

function updateFollowButtonDirection() {
    if (!panelShadowRoot) return;
    const btn = panelShadowRoot.getElementById("btn-follow-now");
    const list = panelShadowRoot.getElementById("cc-list");
    if (!btn || !list) return;
    const index = Number(appState.followCurrentIndex);
    const row = Number.isFinite(index) && index >= 0 ? list.querySelector(`.cc-row[data-index="${index}"]`) : null;
    if (!row) {
        btn.classList.remove("direction-up");
        btn.classList.add("direction-down");
        return;
    }
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowBottom > viewBottom) {
        btn.classList.remove("direction-up");
        btn.classList.add("direction-down");
        return;
    }
    if (rowTop < viewTop) {
        btn.classList.remove("direction-down");
        btn.classList.add("direction-up");
        return;
    }
    btn.classList.remove("direction-up");
    btn.classList.add("direction-down");
}

function getPlayerTime() {
    const video = document.querySelector("video");
    return video ? Number(video.currentTime) : NaN;
}

function getCurrentVideoElement() {
    const primary = document.querySelector("video");
    if (primary) return primary;
    const nested = document.querySelector(".bwp-video video");
    if (nested) return nested;
    const fallback = document.querySelector(".bwp-video");
    if (fallback && typeof fallback.duration !== "undefined") return fallback;
    return null;
}

function resolveDurationFromSubtitles() {
    const processed = Array.isArray(appState.cache?.processedSubtitle) ? appState.cache.processedSubtitle : [];
    const raw = Array.isArray(appState.cache?.rawSubtitle) ? appState.cache.rawSubtitle : [];
    const source = processed.length ? processed : raw;
    if (!source.length) return NaN;
    let maxSec = NaN;
    source.forEach((row) => {
        const start = toNumberOrNaN(row?.start ?? row?.from);
        const end = toNumberOrNaN(row?.end ?? row?.to);
        const candidate = Number.isFinite(end) ? end : start;
        if (!Number.isFinite(candidate)) return;
        if (!Number.isFinite(maxSec) || candidate > maxSec) maxSec = candidate;
    });
    return maxSec;
}

function resolveVideoDurationMeta() {
    const video = getCurrentVideoElement();
    const durationSec = Number(video?.duration || 0);
    const fromVideo = Number.isFinite(durationSec) && durationSec > 0 ? Math.floor(durationSec) : NaN;
    const fallback = resolveDurationFromSubtitles();
    const totalSeconds = Number.isFinite(fromVideo) && fromVideo > 0
        ? fromVideo
        : (Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 0);
    if (!totalSeconds) return null;
    return {
        totalSeconds,
        formattedTime: formatTime(totalSeconds)
    };
}

function jumpTo(sec) {
    const video = document.querySelector("video");
    if (!video) return;
    video.currentTime = Math.max(0, Number(sec) || 0);
    video.play().catch(() => {});
}

function getSegmentsForFloatWindow() {
    const list = Array.isArray(appState.cache?.segments) ? appState.cache.segments : [];
    return list
        .map((item) => ({
            start: Math.max(0, Number(item?.start || 0)),
            end: Math.max(0, Number(item?.end || 0)),
            label: String(item?.label || "未命名章节").trim(),
            type: String(item?.type || "content")
        }))
        .filter((item) => Number.isFinite(item.start))
        .sort((a, b) => a.start - b.start);
}

function removeSegmentsFloatWindow() {
    const node = document.getElementById("segments-float-window");
    if (node) node.remove();
}

function renderSegmentsFloatWindow() {
    const segments = getSegmentsForFloatWindow();
    if (!segments.length) {
        removeSegmentsFloatWindow();
        return;
    }
    let node = document.getElementById("segments-float-window");
    if (!node) {
        node = document.createElement("section");
        node.id = "segments-float-window";
        node.className = "segments-float-window";
        node.dataset.side = "right";
        node.style.top = "180px";
        node.style.right = "0px";
        document.body.appendChild(node);
        bindSegmentsFloatWindowEvents(node);
    }
    const rowsHtml = segments.map((item) => {
        const from = formatTime(item.start);
        const to = formatTime(item.end || item.start);
        const label = escapeHtml(item.label || "未命名章节");
        const badge = item.type === "ad" ? '<span class="segments-float-badge">广告</span>' : "";
        return `<button type="button" class="segments-float-item" data-start="${item.start}"><span class="segments-float-time">${from}-${to}</span><span class="segments-float-label">${label}</span>${badge}</button>`;
    }).join("");
    node.innerHTML = `
        <button type="button" class="drag-handle" data-action="segments-toggle"><span class="drag-handle-arrow"></span></button>
        <div class="segments-float-body">
            <div class="segments-float-title">视频分段</div>
            <div class="segments-float-list">${rowsHtml}</div>
        </div>
    `;
    updateSegmentsFloatArrow(node);
}

function bindSegmentsFloatWindowEvents(node) {
    if (!node || node.dataset.bound === "1") return;
    node.dataset.bound = "1";
    node.addEventListener("click", (event) => {
        const toggleBtn = event.target.closest('[data-action="segments-toggle"]');
        if (toggleBtn) {
            node.classList.toggle("is-collapsed");
            updateSegmentsFloatArrow(node);
            return;
        }
        const jumpBtn = event.target.closest(".segments-float-item");
        if (!jumpBtn) return;
        const sec = Number(jumpBtn.dataset.start || 0);
        jumpTo(sec);
    });
    node.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        if (event.target.closest(".segments-float-item")) return;
        const rect = node.getBoundingClientRect();
        appState.segmentsFloatDragging = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
        };
        node.classList.add("is-dragging");
        node.style.left = `${rect.left}px`;
        node.style.top = `${rect.top}px`;
        node.style.right = "auto";
        document.addEventListener("mousemove", onSegmentsFloatMouseMove);
        document.addEventListener("mouseup", onSegmentsFloatMouseUp);
    });
}

function onSegmentsFloatMouseMove(event) {
    const drag = appState.segmentsFloatDragging;
    const node = document.getElementById("segments-float-window");
    if (!drag || !node) return;
    const width = node.offsetWidth || 280;
    const height = node.offsetHeight || 360;
    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);
    const left = Math.max(0, Math.min(maxLeft, event.clientX - drag.offsetX));
    const top = Math.max(0, Math.min(maxTop, event.clientY - drag.offsetY));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
}

function onSegmentsFloatMouseUp() {
    const drag = appState.segmentsFloatDragging;
    const node = document.getElementById("segments-float-window");
    appState.segmentsFloatDragging = null;
    document.removeEventListener("mousemove", onSegmentsFloatMouseMove);
    document.removeEventListener("mouseup", onSegmentsFloatMouseUp);
    if (!drag || !node) return;
    node.classList.remove("is-dragging");
    const rect = node.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const side = centerX <= window.innerWidth / 2 ? "left" : "right";
    node.dataset.side = side;
    node.style.top = `${Math.max(0, rect.top)}px`;
    if (side === "left") {
        node.style.left = "0px";
        node.style.right = "auto";
    } else {
        node.style.right = "0px";
        node.style.left = "auto";
    }
    updateSegmentsFloatArrow(node);
}

function updateSegmentsFloatArrow(node) {
    if (!node) return;
    const arrow = node.querySelector(".drag-handle-arrow");
    if (!arrow) return;
    const side = node.dataset.side === "left" ? "left" : "right";
    const collapsed = node.classList.contains("is-collapsed");
    if (collapsed) {
        arrow.textContent = side === "right" ? "◀" : "▶";
        return;
    }
    arrow.textContent = side === "right" ? "▶" : "◀";
}

function removeSegmentsProgressMarkers() {
    document.querySelectorAll(".segment-marker-layer").forEach((node) => node.remove());
}

function renderSegmentsProgressMarkers() {
    const segments = getSegmentsForFloatWindow();
    if (!segments.length) {
        removeSegmentsProgressMarkers();
        return;
    }
    const video = document.querySelector("video");
    const duration = Number(video?.duration || 0);
    if (!video || !Number.isFinite(duration) || duration <= 0) return;
    const host = document.querySelector(".bpx-player-progress-schedule") || document.querySelector(".bpx-player-progress-wrap");
    if (!host) return;
    if (!host.querySelector(".segment-marker-layer")) {
        const layer = document.createElement("div");
        layer.className = "segment-marker-layer";
        host.appendChild(layer);
        layer.addEventListener("click", (event) => {
            const marker = event.target.closest(".segment-marker");
            if (!marker) return;
            jumpTo(Number(marker.dataset.start || 0));
        });
    }
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.style.overflow = "visible";
    const layer = host.querySelector(".segment-marker-layer");
    layer.style.pointerEvents = "auto";
    layer.style.zIndex = "30";
    layer.style.top = "-3px";
    layer.style.bottom = "auto";
    layer.style.height = "8px";
    const markersHtml = segments.map((item) => {
        const percent = Math.max(0, Math.min(100, (item.start / duration) * 100));
        const label = escapeHtml(item.label);
        return `<span class="segment-marker" style="left:calc(${percent}% - 1.5px);" data-start="${item.start}" title="${label}"><span class="segment-marker-tooltip">${label}</span></span>`;
    }).join("");
    layer.innerHTML = markersHtml;
}

function ensureSegmentsVideoEvents() {
    const video = document.querySelector("video");
    if (!video || video.dataset.segmentsBound === "1") return;
    const refresh = () => renderSegmentsProgressMarkers();
    video.addEventListener("loadedmetadata", refresh);
    video.addEventListener("durationchange", refresh);
    video.dataset.segmentsBound = "1";
}

function shouldHideRuntimeMetrics() {
    const taskStatus = isTabStateForCurrentVideo() ? (appState.tabState?.taskStatus || {}) : {};
    const summaryRunning = taskStatus.summary === "processing";
    const segmentsRunning = taskStatus.segments === "processing";
    const rumorsRunning = taskStatus.rumors === "processing";
    const chatRunning = taskStatus.chat === "processing" || !!String(appState.chatStreamingId || "").trim();
    return summaryRunning || segmentsRunning || rumorsRunning || chatRunning;
}

function renderMetricsBox() {
    return "";
}

function getTabStateKey() {
    return appState.tabId ? `tabState_${appState.tabId}` : null;
}

async function triggerDefaultSubtitleCapture() {
    if (isTranscriptionRunning()) return; // Transcription lock guard
    if (appState.subtitleCaptureLock) return;
    const bvid = resolveCurrentBvid();
    if (!bvid) return;
    if (appState.subtitleCapturedBvid === bvid) return;
    if (hasUsableSubtitleCache(appState.cache, bvid)) {
        appState.subtitleCapturedBvid = bvid;
        return;
    }
    appState.subtitleCaptureLock = true;
    try {
        const payload = await fetchSubtitleByPlayerApi(bvid);
        if (!payload?.length) {
            scheduleTranscriptionCapsuleIfNeeded({
                bvid,
                cid: resolveCid(),
                tid: getTidFromUrl(location.href),
                title: cleanBilibiliTitle(document.title)
            });
            return;
        }
        await chrome.runtime.sendMessage({
            action: "SUBTITLE_CAPTURED",
            payload: {
                bvid,
                cid: resolveCid(),
                tid: getTidFromUrl(location.href),
                title: cleanBilibiliTitle(document.title),
                subtitle: payload
            }
        });
        appState.subtitleCapturedBvid = bvid;
        appState.lastSubtitleForwardAt = Date.now();
        appState.transcriptionCapsuleVisible = false;
        appState.transcriptionCapsuleMeta = null;
        pushSubtitleTimeline("default_capture_success", { bvid, count: payload.length });
        logContent.info("subtitle_parsed", { bvid, count: payload.length, source: "default_fetch" });
    } catch (error) {
        appState.injectReady = true;
        pushSubtitleTimeline("default_capture_error", { bvid, error: error.message || "unknown_error" });
        logContent.debug("subtitle_detected", {
            bvid,
            source: "default_fetch_miss",
            detail: { error_message: error.message || "unknown_error" }
        });
    } finally {
        appState.subtitleCaptureLock = false;
    }
}

function scheduleTranscriptionCapsuleIfNeeded(meta) {
    if (isTranscriptionRunning()) return; // Transcription lock guard
    const bvid = normalizeBvidCase(meta?.bvid || "");
    const injectBvid = normalizeBvidCase(appState.injectBvid || "");
    const currentBvid = normalizeBvidCase(resolveCurrentBvid() || "");
    if (!bvid || !injectBvid || !currentBvid || bvid !== injectBvid || currentBvid !== injectBvid) return;
    if (appState.subtitleCheckDelayTimer) {
        clearTimeout(appState.subtitleCheckDelayTimer);
        appState.subtitleCheckDelayTimer = null;
    }
    appState.subtitleCheckTargetBvid = bvid;
    beginSubtitleObservation(bvid);
    appState.subtitleCheckDelayTimer = setTimeout(() => {
        appState.subtitleCheckDelayTimer = null;
        evaluateTranscriptionNeedAfterDelay({
            ...meta,
            bvid
        });
        renderSubtitleTimelinePanel(document.getElementById("panel-body"));
    }, SUBTITLE_CHECK_DELAY_MS);
}

function startSubtitleCheckTimer() {
    if (appState.subtitleCheckDelayTimer) {
        clearTimeout(appState.subtitleCheckDelayTimer);
        appState.subtitleCheckDelayTimer = null;
    }
    if (appState.subtitleDetectTimeoutTimer) {
        clearTimeout(appState.subtitleDetectTimeoutTimer);
        appState.subtitleDetectTimeoutTimer = null;
    }
    appState.subtitleCheckDelayTimer = setTimeout(() => {
        appState.subtitleCheckDelayTimer = null;
        renderSubtitleTimelinePanel(document.getElementById("panel-body"));
    }, SUBTITLE_CHECK_DELAY_MS);
    const detectElapsedMs = Date.now() - Number(appState.injectBvidChangedAt || 0);
    const detectRemainMs = SUBTITLE_DETECT_TIMEOUT_MS - detectElapsedMs;
    if (detectRemainMs > 0) {
        appState.subtitleDetectTimeoutTimer = setTimeout(() => {
            appState.subtitleDetectTimeoutTimer = null;
            renderContent();
        }, detectRemainMs);
    }
}

function evaluateTranscriptionNeedAfterDelay(meta) {
    const bvid = normalizeBvidCase(meta?.bvid || "");
    const injectBvid = normalizeBvidCase(appState.injectBvid || "");
    const currentBvid = normalizeBvidCase(resolveCurrentBvid() || "");
    if (!bvid || !injectBvid || !currentBvid || bvid !== injectBvid || currentBvid !== injectBvid) return;
    if (appState.subtitleCheckTargetBvid !== bvid) return;
    if (!appState.injectReady) return;
    if (isTranscriptionRunning()) return; // Skip warnings/updates if transcribing
    if (Date.now() < Number(appState.subtitleObserveUntil || 0)) return;
    if (appState.subtitleCapturedBvid === bvid) return;
    if (hasUsableSubtitleCache(appState.cache, bvid)) return;
    if ((Array.isArray(appState.subtitleTimeline) ? appState.subtitleTimeline : []).length > 0) return;
    if (appState.subtitleDomDetected || hasNativeCCSubtitleDom()) return;
    appState.transcriptionCapsuleMeta = {
        bvid,
        cid: Number(meta?.cid || appState.tabState?.activeCid || 0),
        tid: meta?.tid || appState.tabState?.activeTid || null,
        title: String(meta?.title || "").trim()
    };
    appState.transcriptionCapsuleVisible = true;
    renderSubtitleTimelinePanel(document.getElementById("panel-body"));
}

function hasNativeCCSubtitleDom() {
    const selectors = [
        ".bpx-player-subtitle-wrap .bpx-player-subtitle-item",
        ".bpx-player-subtitle-wrap .bpx-player-subtitle-item-text",
        ".bilibili-player-video-subtitle .bilibili-player-video-subtitle-content",
        ".bilibili-player-video-subtitle-content",
        ".bpx-player-dialog-wrap .bpx-player-ctrl-subtitle-language-item-text",
        "video track[kind='subtitles']",
        "video track[kind='captions']"
    ];
    return selectors.some((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const text = String(node.textContent || "").trim();
        if (selector.includes("track[")) return true;
        return text.length > 0;
    });
}

async function startTranscriptionFromCapsule() {
    const fallbackMeta = {
        bvid: normalizeBvidCase(appState.injectBvid || resolveCurrentBvid()),
        cid: Number(appState.injectCid || appState.tabState?.activeCid || 0),
        tid: appState.tabState?.activeTid || getTidFromUrl(location.href),
        title: cleanBilibiliTitle(document.title)
    };
    const meta = appState.transcriptionCapsuleMeta || fallbackMeta;
    const bvid = normalizeBvidCase(meta?.bvid || "");
    const progressTaskId = `transcribe:${bvid || "unknown"}`;
    const injectBvid = normalizeBvidCase(appState.injectBvid || "");
    if (!meta || !bvid || !injectBvid || bvid !== injectBvid) {
        logContent.warn("asr_start_blocked", {
            task: "asr",
            bvid,
            code: "ASR_VIDEO_STATE_CHANGED",
            detail: {
                inject_bvid: injectBvid,
                has_meta: !!meta
            }
        });
        showToast("当前视频状态已变化，请稍后重试");
        return;
    }
    if (isTranscriptionRunning()) {
        logContent.warn("asr_start_blocked", {
            task: "asr",
            bvid,
            code: "ASR_ALREADY_RUNNING"
        });
        showToast("正在转录中，请稍候...");
        return;
    }
    const asrRunId = `asr_${bvid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    appState.progressTaskId = "";
    appState.progressLastPercent = 0;
    appState.progressLastTick = 0;
    clearStepProgressTimers();
    clearPseudoProgressTicker();

    if (appState.tabState && typeof appState.tabState === "object") {
        appState.tabState = {
            ...appState.tabState,
            activeBvid: bvid,
            transcriptionProgress: 0
        };
    }
    beginAsrSession({
        bvid,
        runId: asrRunId,
        progress: 10,
        statusText: "正在检查云端字幕...",
        stage: "cloud_check"
    });
    patchTranscriptionState({
        phase: "running",
        bvid,
        progress: 10,
        statusText: "正在检查云端字幕..."
    });
    appState.transcriptionCapsuleVisible = true;
    updateProgress(10, progressTaskId, { force: true });
    renderContent();
    renderSubtitleTimelinePanel(document.getElementById("panel-body"));

    if (!hasUsableSubtitleCache(appState.cache, bvid)) {
        appState.cloudReadState = createCloudReadState(bvid, "idle", Number(appState.cloudReadState?.requestId || 0) + 1);
        const synced = await syncCacheFromBackgroundWithRetry(bvid, 2, 150, { skipCloud: false });
        if (synced && hasUsableSubtitleCache(appState.cache, bvid)) {
            applyCacheSubtitleState(appState.cache, bvid);
            clearAsrSession();
            resetTranscriptionState({ phase: "done", progress: 100 });
            appState.transcriptionCapsuleVisible = false;
            appState.transcriptionCapsuleMeta = null;
            updateProgress(100, progressTaskId);
            renderContent();
            showToast("已读取云端字幕");
            return;
        }
    }
    updateAsrSession({
        bvid,
        runId: asrRunId,
        progress: 10,
        statusText: "正在请求转录...",
        stage: "start"
    });
    patchTranscriptionState({
        phase: "running",
        bvid,
        progress: 10,
        statusText: "正在请求转录..."
    });
    const preparedAudioUrl = appState.playInfo?.audio?.[0]?.url || "";
    logContent.info("asr_start_clicked", {
        task: "asr",
        bvid,
        detail: {
            run_id: asrRunId,
            cid: Number(meta?.cid || 0),
            route_bvid: normalizeBvidCase(getBvidFromUrl(location.href) || ""),
            inject_bvid: injectBvid,
            playinfo_bvid: normalizeBvidCase(appState.playInfo?._bvid || ""),
            has_audio_locator: !!preparedAudioUrl,
            ...summarizeMediaLocator(preparedAudioUrl)
        }
    });

    updateProgress(10, progressTaskId, { force: true });
    renderContent();
    renderSubtitleTimelinePanel(document.getElementById("panel-body"));
    try {
        const freshPlayInfo = await ensureAsrPlayInfoForBvid(bvid).catch(() => null);
        const audioUrl = freshPlayInfo?.audio?.[0]?.url || "";
        logContent.info("asr_audio_payload_selected", {
            task: "asr",
            bvid,
            detail: {
                run_id: asrRunId,
                playinfo_bvid: normalizeBvidCase(freshPlayInfo?._bvid || appState.playInfo?._bvid || ""),
                playinfo_source: String(freshPlayInfo?._source || appState.playInfo?._source || ""),
                playinfo_age_ms: Math.max(0, Date.now() - Number(freshPlayInfo?._ts || appState.playInfo?._ts || 0)),
                has_audio_locator: !!audioUrl,
                ...summarizeMediaLocator(audioUrl)
            }
        });
        const res = await chrome.runtime.sendMessage({
            action: "GET_AUDIO_URL",
            payload: { ...meta, audioUrl, asrRunId }
        });
        if (!res?.ok) throw new Error(res?.error || "Groq 转录失败");
    } catch (error) {
        clearAsrSession();
        logContent.error("asr_start_failed", {
            task: "asr",
            bvid,
            code: error?.code || "ASR_START_FAILED",
            status: Number(error?.status || 0) || 0,
            detail: { error_message: error.message || "Groq 转录失败" }
        });
        appState.transcriptionSuppressUntil = Date.now() + 30000;
        if (appState.tabState && typeof appState.tabState === "object") {
            appState.tabState = {
                ...appState.tabState,
                transcriptionProgress: 0
            };
        }
        resetTranscriptionState();
        updateProgress(0, progressTaskId, { force: true });
        reportContentError?.(error, { task: "asr", source: "start_transcription" });
        notifyMappedError(error, error.message || "Groq 转录失败");
        renderContent();
        renderSubtitleTimelinePanel(document.getElementById("panel-body"));
    }
}

async function handleRegenerateGroqSubtitle() {
    const currentBvid = normalizeBvidCase(resolveCurrentBvid() || "");
    const injectBvid = normalizeBvidCase(appState.injectBvid || "");
    if (!currentBvid || !injectBvid || currentBvid !== injectBvid) {
        showToast("当前视频状态已变化，请稍后重试");
        return;
    }
    const subtitleSource = String(appState.tabState?.subtitleSource || "");
    if (!(subtitleSource === "groq" || subtitleSource === "whisper" || subtitleSource === "siliconflow" || subtitleSource === "funasr")) return;
    appState.subtitleTimeline = [];
    appState.cache = {
        ...(appState.cache || {}),
        rawSubtitle: [],
        processedSubtitle: [],
        rawHash: "",
        processedHash: ""
    };

    appState.progressTaskId = "";
    appState.progressLastPercent = 0;
    patchTranscriptionState({
        phase: "running",
        bvid: injectBvid,
        progress: 0,
        statusText: "正在重新请求转录..."
    });
    renderContent();
    const payload = {
        bvid: injectBvid,
        cid: Number(appState.injectCid || appState.tabState?.activeCid || 0),
        tid: appState.tabState?.activeTid || getTidFromUrl(location.href),
        title: cleanBilibiliTitle(document.title)
    };
    try {
        await chrome.runtime.sendMessage({ action: "CLEAR_SUBTITLE_CACHE", bvid: injectBvid });
        const freshPlayInfo = await ensureAsrPlayInfoForBvid(injectBvid).catch(() => null);
        const audioUrl = freshPlayInfo?.audio?.[0]?.url || "";
        const asrRunId = `asr_${injectBvid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        logContent.info("asr_regenerate_payload_prepared", {
            task: "asr",
            bvid: injectBvid,
            detail: {
                run_id: asrRunId,
                route_bvid: normalizeBvidCase(getBvidFromUrl(location.href) || ""),
                inject_bvid: injectBvid,
                playinfo_bvid: normalizeBvidCase(freshPlayInfo?._bvid || appState.playInfo?._bvid || ""),
                playinfo_source: String(freshPlayInfo?._source || appState.playInfo?._source || ""),
                playinfo_age_ms: Math.max(0, Date.now() - Number(freshPlayInfo?._ts || appState.playInfo?._ts || 0)),
                has_audio_locator: !!audioUrl,
                ...summarizeMediaLocator(audioUrl)
            }
        });
        const res = await chrome.runtime.sendMessage({
            action: "GET_AUDIO_URL",
            payload: { ...payload, audioUrl, asrRunId }
        });
        if (!res?.ok) throw new Error(res?.error || "重新生成失败");
    } catch (error) {
        if (appState.tabState && typeof appState.tabState === "object") {
            appState.tabState = {
                ...appState.tabState,
                transcriptionProgress: 0
            };
        }
        resetTranscriptionState();
        updateProgress(0, `transcribe:${injectBvid || "unknown"}`, { force: true });
        reportContentError?.(error, { task: "asr_regenerate", source: "regenerate_transcription" });
        notifyMappedError(error, error.message || "重新生成失败");
        renderContent();
    }
}

function beginSubtitleObservation(bvid) {
    const targetBvid = normalizeBvidCase(bvid || "");
    if (!targetBvid) return;
    appState.subtitleDomDetected = hasNativeCCSubtitleDom();
    appState.subtitleObserveUntil = Date.now() + SUBTITLE_OBSERVE_GRACE_MS;
    if (appState.subtitleObserver) return;
    const root = document.querySelector(".bpx-player-container") || document.body;
    if (!root) return;
    const observer = new MutationObserver(() => {
        const currentBvid = normalizeBvidCase(resolveCurrentBvid() || "");
        const injectBvid = normalizeBvidCase(appState.injectBvid || "");
        if (!currentBvid || !injectBvid || currentBvid !== injectBvid) return;
        if (hasNativeCCSubtitleDom()) {
            appState.subtitleDomDetected = true;
            appState.transcriptionCapsuleVisible = false;
            appState.transcriptionCapsuleMeta = null;
            renderSubtitleTimelinePanel(document.getElementById("panel-body"));
        }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    appState.subtitleObserver = observer;
}

function stopSubtitleObserver() {
    if (!appState.subtitleObserver) return;
    appState.subtitleObserver.disconnect();
    appState.subtitleObserver = null;
}

function isStorageChangeStateDirty(changes, switched, routeMismatch, afterBvid) {
    return isStorageChangeStateDirtyFromPage(changes, {
        switched,
        routeMismatch,
        afterBvid,
        tabKey: getTabStateKey()
    });
}

async function fetchSubtitleByPlayerApi(bvid) {
    const cid = resolveCid();
    if (!cid) return [];
    const api = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`;
    const res = await fetch(api, { credentials: "include" });
    if (!res.ok) return [];
    const data = await res.json();
    const subtitles = Array.isArray(data?.data?.subtitle?.subtitles) ? data.data.subtitle.subtitles : [];
    if (!subtitles.length) return [];
    const picked = pickSubtitle(subtitles);
    const rawUrl = String(picked?.subtitle_url || "").trim();
    if (!rawUrl) return [];
    const subtitleUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    const subRes = await fetch(subtitleUrl, { credentials: "include" });
    if (!subRes.ok) return [];
    const subData = await subRes.json();
    const body = subData?.body || subData?.data?.body || subData?.result?.body || subData?.content || [];
    return Array.isArray(body) ? body : [];
}

function pickSubtitle(subtitles) {
    return pickSubtitleFromPage(subtitles);
}

function resolveCid() {
    return resolveCidFromState(appState);
}

function resolveCurrentBvid() {
    return resolveCurrentBvidFromState(appState, location.href);
}

function isTabStateForCurrentVideo() {
    const currentBvid = normalizeBvidCase(resolveCurrentBvid() || "");
    const stateBvid = normalizeBvidCase(appState.tabState?.activeBvid || "");
    return !!currentBvid && !!stateBvid && currentBvid === stateBvid;
}

function getCurrentVideoTaskStatus(task) {
    if (hasLocalPendingTask(task)) return "processing";
    if (!isTabStateForCurrentVideo()) return "idle";
    return appState.tabState?.taskStatus?.[task] || "idle";
}

function hasUsableSubtitleCache(cache, targetBvid = "") {
    const target = normalizeBvidCase(targetBvid || "");
    const cacheBvid = normalizeBvidCase(cache?.bvid || "");

    if (target && cacheBvid && target !== cacheBvid) return false;

    return (
        (Array.isArray(cache?.rawSubtitle) && cache.rawSubtitle.length > 0) ||
        (Array.isArray(cache?.processedSubtitle) && cache.processedSubtitle.length > 0)
    );
}

function makeShortDigest(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizeMediaLocator(locator) {
    const raw = String(locator || "").trim();
    if (!raw) return { audio_host: "", audio_path_hash: "", audio_query_key_count: 0 };
    try {
        const parsed = new URL(raw);
        const queryKeys = [...parsed.searchParams.keys()].sort();
        return {
            audio_host: parsed.host || "",
            audio_path_hash: makeShortDigest(`${parsed.pathname || ""}?${parsed.search || ""}`),
            audio_query_key_count: queryKeys.length,
            audio_query_keys_hash: makeShortDigest(queryKeys.join("|"))
        };
    } catch (_) {
        return {
            audio_host: "",
            audio_path_hash: makeShortDigest(raw),
            audio_query_key_count: 0,
            audio_query_keys_hash: ""
        };
    }
}

function isolateChatInputKeyboardEvent(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const target = path.find((node) => node?.id === "chat-input") || event?.target;
    if (!target || target.id !== "chat-input") return;
    if (event.isComposing || event.keyCode === 229) return;
    const key = String(event.key || "");
    if ((key === " " || key === "Spacebar") && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        insertTextIntoControl(target, " ");
        return;
    }
    const isPlainTextKey = key.length === 1 || key === " " || key === "Spacebar";
    if (!isPlainTextKey) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.stopPropagation();
}

function insertTextIntoControl(input, text) {
    if (!input || typeof input.value !== "string") return;
    const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
    if (typeof input.setRangeText === "function") {
        input.setRangeText(text, start, end, "end");
    } else {
        input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
        const nextPosition = start + text.length;
        input.selectionStart = nextPosition;
        input.selectionEnd = nextPosition;
    }
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function onGlobalShortcut(event) {
    if (!event.ctrlKey || !event.shiftKey || String(event.key).toLowerCase() !== "l") return;
    event.preventDefault();
    if (logWindowVisible) {
        closeLogWindow();
        return;
    }
    openLogWindow();
}

async function openLogWindow() {
    logWindowVisible = true;
    let win = document.getElementById("plugin-log-window");
    if (!win) {
        win = document.createElement("section");
        win.id = "plugin-log-window";
        win.className = "plugin-log-window";
        win.innerHTML = `
            <div class="plugin-log-head">
                <div class="plugin-log-title">AI Plugin Logs</div>
                <div class="plugin-log-actions">
                    <button class="panel-btn ghost" data-action="logs-refresh">刷新</button>
                    <button class="panel-btn ghost" data-action="logs-copy">复制</button>
                    <button class="panel-btn ghost" data-action="logs-close">关闭</button>
                </div>
            </div>
            <pre class="plugin-log-body" id="plugin-log-body"></pre>
        `;
        document.body.appendChild(win);
        bindLogWindowEvents(win);
    }
    win.style.display = "flex";
    await renderLogWindowData();
    startLogWindowPolling();
}

function closeLogWindow() {
    logWindowVisible = false;
    const win = document.getElementById("plugin-log-window");
    if (win) win.style.display = "none";
    stopLogWindowPolling();
}

async function renderLogWindowData() {
    const box = document.getElementById("plugin-log-body");
    if (!box) return;
    try {
        const res = await chrome.runtime.sendMessage({ action: "GET_LOGS" });
        if (!res?.ok) throw new Error(res?.error || "读取日志失败");
        const logs = Array.isArray(res.logs) ? res.logs : [];
        box.textContent = logs
            .slice(-DEBUG_LOG_DISPLAY_LIMIT)
            .map((item) => `${item.time} ${item.level} ${item.module} ${item.event} ${JSON.stringify(item.detail || {})}`)
            .join("\n");
    } catch (error) {
        box.textContent = `读取日志失败：${error.message || "未知错误"}`;
        logContent.error("cache_read_failed", {
            task: "logs",
            code: "LOG_READ_FAILED",
            detail: {
                key: "global_logs",
                error_message: error.message || "读取日志失败"
            }
        });
    }
}

async function renderRealtimeLogData() {
    const box = panelShadowRoot ? panelShadowRoot.getElementById("debug-log-body") : null;
    const status = panelShadowRoot ? panelShadowRoot.getElementById("debug-log-status") : null;
    if (!box) return;
    try {
        const res = await chrome.runtime.sendMessage({ action: "GET_LOGS" });
        if (!res?.ok) throw new Error(res?.error || "读取日志失败");
        const logs = Array.isArray(res.logs) ? res.logs : [];
        box.textContent = logs.length
            ? logs.slice(-DEBUG_LOG_DISPLAY_LIMIT).map(formatLogEntryLine).join("\n")
            : "暂无日志。请先在测试页或插件里触发一次操作。";
        if (status) {
            const shown = Math.min(logs.length, DEBUG_LOG_DISPLAY_LIMIT);
            status.textContent = `${logs.length} 条，显示 ${shown} 条，${formatTimelineTime(Date.now())} 已刷新`;
        }
    } catch (error) {
        box.textContent = `读取日志失败：${error.message || "未知错误"}`;
        if (status) status.textContent = "读取失败";
        logContent.error("cache_read_failed", {
            task: "logs",
            code: "LOG_READ_FAILED",
            detail: {
                key: "global_logs",
                error_message: error.message || "读取日志失败"
            }
        });
    }
}

function formatAsrUiTraceLine(item) {
    const detail = item?.detail && typeof item.detail === "object" ? item.detail : {};
    return `${item?.time || ""} ${item?.event || ""} | ${JSON.stringify(detail)}`;
}

function renderAsrUiTraceData() {
    const box = panelShadowRoot ? panelShadowRoot.getElementById("debug-asr-ui-log-body") : null;
    const status = panelShadowRoot ? panelShadowRoot.getElementById("debug-asr-ui-log-status") : null;
    if (!box) return;
    const logs = Array.isArray(appState.asrUiTraceLogs) ? appState.asrUiTraceLogs : [];
    box.textContent = logs.length
        ? logs.slice(-200).map(formatAsrUiTraceLine).join("\n")
        : "暂无转录 UI 状态日志。点击转录后这里会记录按钮/进度条状态。";
    if (status) {
        const shown = Math.min(logs.length, 200);
        status.textContent = `${logs.length} 条，显示 ${shown} 条，${formatTimelineTime(Date.now())} 已刷新`;
    }
}

function formatLogEntryLine(item) {
    const detail = item?.detail && typeof item.detail === "object" ? item.detail : {};
    const meta = [
        item?.task ? `task=${item.task}` : "",
        item?.bvid ? `bvid=${item.bvid}` : "",
        item?.provider ? `provider=${item.provider}` : "",
        item?.model ? `model=${item.model}` : "",
        item?.code ? `code=${item.code}` : "",
        item?.status ? `status=${item.status}` : "",
        item?.duration_ms ? `duration=${item.duration_ms}ms` : ""
    ].filter(Boolean).join(" ");
    const detailText = JSON.stringify(detail || {});
    return `${item?.time || ""} ${String(item?.level || "").toUpperCase()} [${item?.module || ""}] ${item?.event || ""}${meta ? ` | ${meta}` : ""} | ${detailText}`;
}

function copyAsrUiTraceData() {
    const box = panelShadowRoot ? panelShadowRoot.getElementById("debug-asr-ui-log-body") : null;
    const text = box?.textContent || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast("转录 UI 日志已复制");
    }).catch(() => {
        showToast("复制失败");
    });
}

function clearAsrUiTraceData() {
    appState.asrUiTraceLogs = [];
    renderAsrUiTraceData();
    showToast("转录 UI 日志已清空");
}

function copyRealtimeLogData() {
    const box = panelShadowRoot ? panelShadowRoot.getElementById("debug-log-body") : null;
    const text = box?.textContent || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast("日志已复制");
    }).catch((error) => {
        showToast("复制失败");
        logContent.error("task_abort", {
            task: "copy_logs",
            code: "LOG_COPY_FAILED",
            detail: { error_message: error.message || "复制失败" }
        });
    });
}

async function clearRealtimeLogs() {
    try {
        await chrome.runtime.sendMessage({ action: "CLEAR_LOGS" });
        await renderRealtimeLogData();
        showToast("日志已清空");
    } catch (error) {
        showToast("清空失败");
        logContent.error("task_abort", {
            task: "clear_logs",
            code: "LOG_CLEAR_FAILED",
            detail: { error_message: error.message || "清空失败" }
        });
    }
}

function copyLogWindowData() {
    const box = document.getElementById("plugin-log-body");
    const text = box?.textContent || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast("日志已复制");
    }).catch((error) => {
        showToast("复制失败");
        logContent.error("task_abort", {
            task: "copy_logs",
            code: "LOG_COPY_FAILED",
            detail: { error_message: error.message || "复制失败" }
        });
    });
}

function bindLogWindowEvents(win) {
    if (!win || win.dataset.bound === "1") return;
    win.dataset.bound = "1";
    const refreshBtn = win.querySelector('[data-action="logs-refresh"]');
    const copyBtn = win.querySelector('[data-action="logs-copy"]');
    const closeBtn = win.querySelector('[data-action="logs-close"]');
    refreshBtn?.addEventListener("click", () => {
        renderLogWindowData();
    });
    copyBtn?.addEventListener("click", () => {
        copyLogWindowData();
    });
    closeBtn?.addEventListener("click", () => {
        closeLogWindow();
    });
}

function startLogWindowPolling() {
    stopLogWindowPolling();
    appState.logPollTimer = setInterval(() => {
        if (!logWindowVisible) return;
        renderLogWindowData();
    }, 1000);
}

function stopLogWindowPolling() {
    if (!appState.logPollTimer) return;
    clearInterval(appState.logPollTimer);
    appState.logPollTimer = null;
}

function startRealtimeLogPolling() {
    stopRealtimeLogPolling();
    appState.debugLogPollTimer = setInterval(() => {
        if (appState.activePage !== "debug") {
            stopRealtimeLogPolling();
            return;
        }
        renderRealtimeLogData();
    }, 1000);
}

function stopRealtimeLogPolling() {
    if (!appState.debugLogPollTimer) return;
    clearInterval(appState.debugLogPollTimer);
    appState.debugLogPollTimer = null;
}

function syncPanelHeightMode() {
    const root = panelShadowRoot ? panelShadowRoot.querySelector(".ai-summary-plugin-box") : null;
    const main = root?.querySelector(".plugin-main-container");
    if (!root || !main) return;
    
    const summaryPanel = panelShadowRoot ? panelShadowRoot.getElementById("page-summary") : null;
    const isSummaryNoApiKey = appState.activePage === "summary" && summaryPanel?.classList.contains("summary-no-apikey");
    const isSummaryPage = appState.activePage === "summary" && !isSummaryNoApiKey;
    root.classList.toggle("summary-flex-mode", isSummaryPage);
    root.classList.toggle("fixed-lock-mode", !isSummaryPage);
    
    syncPluginHeight();
    if (isSummaryPage) {
        if (summaryPanel) requestAnimationFrame(() => applySummaryRatio(summaryPanel));
    }
}

function getLockedMainHeight() {
    // Deprecated by syncPluginHeight, but kept for compatibility if called elsewhere
    return 0; 
}

function getSummaryMaxHeightLimit() {
    // Deprecated
    return 0;
}

function findPlayerContainer() {
    return document.querySelector(".bpx-player-container")
        || document.querySelector("#bilibili-player")
        || document.querySelector(".video-player-container")
        || document.querySelector(".bili-video-player")
        || document.querySelector("video")?.closest("div");
}

function getRawSubtitleRows() {
    return getRawSubtitleRowsFromCache(appState.cache);
}

function getRawSubtitlePlainText() {
    return getRawSubtitlePlainTextFromCache(appState.cache);
}

async function handleCopyRawSubtitle(buttonNode) {
    const text = getRawSubtitlePlainText();
    if (!text) {
        showToast("暂无 RAW 字幕");
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast("复制成功");
        if (buttonNode) {
            const origin = buttonNode.dataset.originText || buttonNode.textContent || "";
            buttonNode.dataset.originText = origin;
            buttonNode.textContent = "OK";
            setTimeout(() => {
                buttonNode.textContent = origin;
            }, 1000);
        }
    } catch (_) {
        showToast("复制失败");
    }
}

function handleExportSrt(buttonNode) {
    const rows = getRawSubtitleRows();
    if (!rows.length) {
        showToast("暂无 RAW 字幕");
        return;
    }
    const srt = buildSrtContent(appState.cache);
    const bvid = resolveCurrentBvid() || "subtitle";
    const fileName = `${bvid}.srt`;
    downloadTextFile(fileName, srt, "application/x-subrip;charset=utf-8");
    showToast("导出成功");
    if (buttonNode) {
        setNavActionActive("export", 1000);
    }
}

function scheduleInjectRetry() {
    if (appState.injectReady) return;
    if (appState.injectRetryTimer) return;
    appState.injectRetryTimer = setInterval(() => {
        if (appState.injectReady) {
            clearInterval(appState.injectRetryTimer);
            appState.injectRetryTimer = null;
            return;
        }
        injectScriptBridge();
    }, 1500);
}

function startRouteWatcher() {
    if (appState.routeWatchTimer) return;
    appState.routeWatchBvid = getBvidFromUrl(location.href);
    appState.routeWatchTimer = setInterval(() => {
        const current = getBvidFromUrl(location.href);
        if (!current || current === appState.routeWatchBvid) return;
        const prev = appState.routeWatchBvid || "";
        appState.routeWatchBvid = current;
        pushSubtitleTimeline("route_switch", { from: prev, to: current });
        resetAllState();
        clearStreamCache();
        appState.pendingSubtitle = null;
        appState.activePage = resolveDefaultOpenPage(appState.settings?.defaultOpenPage);
        renderNav();
        appState.tabState = {
            ...(appState.tabState || {}),
            activeBvid: current,
            activeCid: 0,
            updatedAt: Date.now(),
            taskStatus: {
                ...(appState.tabState?.taskStatus || {}),
                summary: "idle",
                segments: "idle",
                rumors: "idle",
                chat: "idle"
            }
        };
        appState.injectBvid = current;
        appState.injectBvidChangedAt = Date.now();
        appState.isStateDirty = true;
        startSubtitleCheckTimer();
        beginSubtitleObservation(current);
        clearCCListImmediately();
        renderContent();
        syncCacheFromBackground(current);
        scheduleSubtitleFallbackWatchdog("route_switch");
    }, 500);
}

function clearStreamCache() {
    appState.playInfo = null;
    appState.playInfoUpdatedAt = 0;
    appState.isPlayInfoReady = false;
    window.postMessage({ type: "REFRESH_PLAYINFO" }, "*");
}

function clearCCListImmediately() {
    const container = panelShadowRoot ? panelShadowRoot.getElementById("page-CC") : null;
    if (!container || appState.activePage !== "CC") return;
    appState.renderedSubtitleIndex = -1;
    renderCC(container, []);
}

async function requestFromInject(timeoutMs = 500) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            window.removeEventListener("message", onMessage, false);
            resolve(null);
        }, Math.max(50, Number(timeoutMs) || 500));

        const onMessage = (event) => {
            if (event.source !== window) return;
            if (String(event?.data?.type || "") !== "SEND_PLAY_INFO") return;
            clearTimeout(timer);
            window.removeEventListener("message", onMessage, false);
            resolve(event.data?.data || null);
        };

        window.addEventListener("message", onMessage, false);
        window.postMessage({ type: "GET_PLAY_INFO" }, "*");
    });
}

async function waitForAlignedPlayInfo(targetBvid) {
    const expectedBvid = normalizeBvidCase(targetBvid || "");
    if (!expectedBvid) return null;
    logContent.info("playinfo_received", { source: "route_wait_start", bvid: expectedBvid });

    let freshData = null;
    for (let i = 0; i < 30; i++) {
        const info = await requestFromInject(500);
        if (hasUsablePlayInfoForBvid(info, expectedBvid)) {
            freshData = normalizeIncomingPlayInfo(info);
            break;
        }
        await sleep(200);
    }

    if (freshData && normalizeBvidCase(getBvidFromUrl(location.href) || "") === expectedBvid) {
        appState.playInfo = freshData;
        appState.playInfoUpdatedAt = Date.now();
        appState.isPlayInfoReady = true;
        logContent.info("playinfo_received", { source: "route_wait_ready", bvid: expectedBvid });
        return appState.playInfo;
    }

    appState.isPlayInfoReady = false;
    logContent.warn("playinfo_received", { source: "route_wait_timeout", bvid: expectedBvid });
    return null;
}

function isAsrPlayInfoFreshForBvid(info, targetBvid, maxAgeMs = 30000) {
    const expectedBvid = normalizeBvidCase(targetBvid || "");
    const normalized = normalizeIncomingPlayInfo(info);
    if (!hasUsablePlayInfoForBvid(normalized, expectedBvid)) return false;
    return true;
}

async function ensureAsrPlayInfoForBvid(targetBvid) {
    const expectedBvid = normalizeBvidCase(targetBvid || "");
    if (!expectedBvid) return null;
    if (isAsrPlayInfoFreshForBvid(appState.playInfo, expectedBvid)) {
        return appState.playInfo;
    }
    clearStreamCache();
    const fresh = await waitForAlignedPlayInfo(expectedBvid);
    if (isAsrPlayInfoFreshForBvid(fresh, expectedBvid)) {
        return fresh;
    }
    logContent.warn("asr_playinfo_not_fresh", {
        task: "asr",
        bvid: expectedBvid,
        code: "ASR_PLAYINFO_NOT_FRESH",
        detail: {
            playinfo_bvid: normalizeBvidCase(fresh?._bvid || appState.playInfo?._bvid || ""),
            playinfo_source: String(fresh?._source || appState.playInfo?._source || ""),
            playinfo_age_ms: Math.max(0, Date.now() - Number(fresh?._ts || appState.playInfo?._ts || 0))
        }
    });
    return fresh || appState.playInfo || null;
}

function scheduleSubtitleFallbackWatchdog(source) {
    if (appState.subtitleFallbackTimer) {
        clearTimeout(appState.subtitleFallbackTimer);
        appState.subtitleFallbackTimer = null;
    }
    const marker = Date.now();
    appState.subtitleFallbackTimer = setTimeout(() => {
        if (appState.lastSubtitleForwardAt >= marker) return;
        logContent.warn("subtitle_detected", { source: "fallback_trigger", reason: source });
        triggerDefaultSubtitleCapture();
    }, 2000);
}

async function forwardSubtitlePayload(payload, source) {
    const bvid = String(payload?.bvid || "").trim();
    const cid = Number(payload?.cid || 0);
    if (!bvid) return;
    const injectBefore = normalizeBvidCase(appState.injectBvid || "");
    appState.injectBvid = bvid;
    if (normalizeBvidCase(appState.injectBvid || "") !== injectBefore) {
        appState.injectBvidChangedAt = Date.now();
        startSubtitleCheckTimer();
    }
    appState.injectCid = Number.isFinite(cid) && cid > 0 ? cid : appState.injectCid;
    try {
        const res = await chrome.runtime.sendMessage({ action: "SUBTITLE_CAPTURED", payload: { ...payload, bvid, cid: appState.injectCid || 0 } });
        if (!res?.ok) throw new Error(res?.error || "转发字幕失败");
        appState.pendingSubtitle = null;
        appState.subtitleCapturedBvid = bvid;
        appState.lastSubtitleForwardAt = Date.now();
        pushSubtitleTimeline("subtitle_forwarded", {
            source,
            bvid,
            cid: appState.injectCid || 0,
            count: Array.isArray(payload.subtitle) ? payload.subtitle.length : 0
        });
        logContent.info("subtitle_detected", { bvid, cid: appState.injectCid || 0, count: Array.isArray(payload.subtitle) ? payload.subtitle.length : 0, source });
    } catch (error) {
        pushSubtitleTimeline("subtitle_forward_error", { source, bvid, error: error.message || "转发字幕失败" });
        logContent.error("task_abort", {
            task: "subtitle_forward",
            bvid,
            code: error?.code || "SUBTITLE_FORWARD_FAILED",
            detail: {
                source,
                error_message: error.message || "转发字幕失败"
            }
        });
        reportContentError?.(error, { task: "subtitle_forward", source });
    }
}

function flushPendingSubtitleIfReady() {
    if (!appState.pendingSubtitle) return;
    const resolvedBvid = resolveCurrentBvid();
    if (!resolvedBvid) return;
    const payload = {
        ...appState.pendingSubtitle,
        bvid: String(appState.pendingSubtitle.bvid || resolvedBvid).trim() || resolvedBvid
    };
    if (!payload.bvid) return;
    pushSubtitleTimeline("pending_flush", { bvid: payload.bvid });
    forwardSubtitlePayload(payload, "pending_flush");
}

async function syncActiveCacheByBvid(expectedBvid) {
    const target = normalizeBvidCase(expectedBvid);
    if (!target) return;
    try {
        const res = await chrome.storage.local.get([`cache_${target}`]);
        if (normalizeBvidCase(appState.tabState?.activeBvid || "") !== target) return;
        const nextCache = res?.[`cache_${target}`] || null;
        appState.cache = nextCache && normalizeBvidCase(nextCache?.bvid || "") === target ? nextCache : null;
        applyCacheSubtitleState(appState.cache, target);
        if (hasUsableSubtitleCache(appState.cache, target)) {
            appState.subtitleCapturedBvid = target;
            if (!isTranscriptionRunning()) {
                appState.transcriptionCapsuleVisible = false;
                appState.transcriptionCapsuleMeta = null;
            }
        }
        appState.isStateDirty = false;
        renderContent();
    } catch (_) {}
}

function hasSubtitleCacheForBvid(targetBvid) {
    return hasUsableSubtitleCache(appState.cache, targetBvid);
}

function reconcileTranscriptionState(targetBvid) {
    const target = normalizeBvidCase(targetBvid || getStableCurrentBvid() || "");
    if (isAsrSessionActiveForCurrent(target)) {
        const session = updateAsrSession({ bvid: target });
        patchTranscriptionState({
            phase: "running",
            bvid: session.bvid || target,
            progress: Number(session.progress || 0),
            statusText: session.statusText || getTranscriptionState().statusText || "正在转录音轨..."
        });
        return;
    }
    const requestBvid = getTranscriptionBvid();
    const subtitleSource = String(appState.tabState?.subtitleSource || "");
    const localState = getTranscriptionState();
    const stateProgress = Math.max(0, Math.min(100, Number(appState.tabState?.transcriptionProgress ?? 0)));
    const localProgress = Math.max(0, Math.min(100, Number(localState.progress ?? 0)));
    const progress = localState.phase === "running" ? Math.max(stateProgress, localProgress) : Math.max(stateProgress, localProgress);
    const hasSubtitle = hasSubtitleCacheForBvid(target);
    const sameTask = !!(target && requestBvid && target === requestBvid);

    if (hasSubtitle) {
        resetTranscriptionState();
        appState.transcriptionCapsuleVisible = false;
        appState.transcriptionCapsuleMeta = null;
        return;
    }

    const isAsrSubtitle = subtitleSource === "groq" || subtitleSource === "whisper" || subtitleSource === "siliconflow" || subtitleSource === "funasr";
    const shouldKeepRunning = localState.phase === "running" || (sameTask && isAsrSubtitle && progress > 0 && progress < 100);
    patchTranscriptionState({
        phase: shouldKeepRunning ? "running" : localState.phase,
        bvid: shouldKeepRunning && target ? target : localState.bvid,
        progress
    });
    if (!shouldKeepRunning && localState.phase === "running") {
        resetTranscriptionState();
    }
}

async function syncCacheFromBackground(bvid, options = {}) {
    const target = normalizeBvidCase(bvid || getBvidFromUrl(location.href) || "");
    if (!target) return;
    const now = Date.now();
    if (options.force !== true && !appState.isStateDirty && appState.lastCacheSyncBvid === target && now - Number(appState.lastCacheSyncTime || 0) < CACHE_SYNC_THROTTLE_MS) {
        return;
    }
    try {
        appState.lastCacheSyncTime = now;
        appState.lastCacheSyncBvid = target;
        const res = await chrome.runtime.sendMessage({
            action: "GET_CACHE",
            bvid: target,
            skipCloud: options.skipCloud !== false
        });
        if (!res?.ok) return;
        const routeBvid = normalizeBvidCase(getBvidFromUrl(location.href));
        if (routeBvid && routeBvid !== target) return;
        const cache = res.cache || null;
        if (!cache || normalizeBvidCase(cache?.bvid || "") !== target) {
            if (options.preserveCacheOnMiss !== true) {
                appState.cache = null;
            }
            reconcileTranscriptionState(target);
            appState.isStateDirty = false;
            renderContent();
            if (shouldAttemptCloudReadForVideo(target)) {
                startCloudReadForCurrentVideo({ bvid: target, silent: true });
            }
            return false;
        }
        appState.cache = cache;
        if (res.tabState) mergeIncomingTabState(res.tabState);
        applyCacheSubtitleState(cache, target);
        appState.subtitleCapturedBvid = target;
        reconcileTranscriptionState(target);
        appState.isStateDirty = false;
        renderContent();
        if (shouldAttemptCloudReadForVideo(target)) {
            startCloudReadForCurrentVideo({ bvid: target, silent: true });
        }
        return true;
    } catch (_) {}
    return false;
}

async function syncCacheFromBackgroundWithRetry(bvid, attempts = 6, delayMs = 250, options = {}) {
    const target = normalizeBvidCase(bvid || "");
    if (!target) return false;
    for (let i = 0; i < attempts; i++) {
        const ok = await syncCacheFromBackground(target, {
            preserveCacheOnMiss: true,
            force: true,
            skipCloud: options.skipCloud !== false
        });
        if (ok && hasSubtitleCacheForBvid(target)) {
            return true;
        }
        if (i < attempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    reconcileTranscriptionState(target);
    renderContent();
    return false;
}

function onBackgroundMessage(message) {
    const action = String(message?.action || "");
    if (action === "SHOW_TOAST") {
        const text = String(message?.text || message?.message || "").trim();
        if (text) showToast(text);
        return false;
    }
    if (action === "TRANSCRIBE_STATUS") {
        const messageBvid = normalizeBvidCase(message?.bvid || "");
        const currentBvid = normalizeBvidCase(getStableCurrentBvid() || appState.injectBvid || "");
        logAsrUiTrace("transcribe_status_received", {
            stage: String(message?.stage || ""),
            level: String(message?.level || ""),
            bvid: messageBvid,
            current_bvid: currentBvid,
            progress: Number(message?.progress || 0),
            text: String(message?.text || ""),
            session: {
                active: !!appState.asrSession?.active,
                bvid: appState.asrSession?.bvid || "",
                stage: appState.asrSession?.stage || "",
                progress: Number(appState.asrSession?.progress || 0)
            }
        });

        if (messageBvid && currentBvid && messageBvid !== currentBvid) {
            logContent.warn("transcription_stale_message_drop", {
            task: "asr",
            bvid: messageBvid,
            detail: { current_bvid: currentBvid, stage: message?.stage || "" }
            });
            return false;
}
        const activeTranscribeBvid = messageBvid || normalizeBvidCase(getTranscriptionBvid() || appState.injectBvid || currentBvid || "unknown");
        const progressTaskId = `transcribe:${activeTranscribeBvid}`;

        const text = String(message?.text || "").trim();
        const quotaLine = String(message?.quotaLine || "").trim();
        const isError = message?.level === "error";
        
        if (text) {
            patchTranscriptionState({ statusText: text });
        }
        if (isError) {
            clearAsrSession();
            if (appState.tabState && typeof appState.tabState === "object") {
                appState.tabState = {
                    ...appState.tabState,
                    transcriptionProgress: 0
                };
            }
            resetTranscriptionState();
            appState.transcriptionSuppressUntil = Date.now() + 30000;
            appState.transcriptionCapsuleVisible = true;
            updateProgress(0, progressTaskId, { force: true });
            renderContent();
            renderSubtitleTimelinePanel(document.getElementById("panel-body"));
            return false;
        }
        if (message?.stage !== "done") {
            const incomingProgress = Number.isFinite(Number(message?.progress))
                ? Math.max(0, Math.min(100, Number(message.progress)))
                : undefined;
            updateAsrSession({
                active: true,
                bvid: activeTranscribeBvid,
                stage: String(message?.stage || ""),
                statusText: text || getTranscriptionState().statusText || appState.asrSession?.statusText || "正在转录音轨...",
                progress: incomingProgress
            });
            patchTranscriptionState({
                phase: "running",
                bvid: activeTranscribeBvid,
                statusText: text || getTranscriptionState().statusText,
                ...(Number.isFinite(incomingProgress) ? { progress: Math.max(Number(getTranscriptionState().progress || 0), incomingProgress) } : {})
            });
        }

        if (Number.isFinite(Number(message?.progress))) {
            const incomingProgress = Math.max(0, Math.min(100, Number(message.progress)));
            const nextState = patchTranscriptionState({ progress: incomingProgress });
            const session = updateAsrSession({ bvid: activeTranscribeBvid, progress: incomingProgress });
            const progress = Math.max(incomingProgress, Number(nextState.progress || 0), Number(session?.progress || 0));
            updateProgress(Math.max(10, progress), progressTaskId);
        } else if (isTranscriptionRunning()) {
            updateProgress(20, progressTaskId);
        }
        const retryAfterSec = Number(message?.retryAfterSec || 0);
        if (appState.transcribeCountdownTimer && retryAfterSec <= 0) {
            clearInterval(appState.transcribeCountdownTimer);
            appState.transcribeCountdownTimer = null;
        }
        if (retryAfterSec > 0) {
            if (appState.transcribeCountdownTimer) {
                clearInterval(appState.transcribeCountdownTimer);
                appState.transcribeCountdownTimer = null;
            }
            let remain = retryAfterSec;
            appState.transcribeCountdownTimer = setInterval(() => {
                remain -= 1;
                if (remain <= 0) {
                    clearInterval(appState.transcribeCountdownTimer);
                    appState.transcribeCountdownTimer = null;
                    showToast("可以重试转录了");
                    return;
                }
                showToast(`请等待 ${remain} 秒后重试`);
            }, 1000);
        }
        if (message?.stage === "done") {
            const taskBvid = normalizeBvidCase(appState.asrSession?.bvid || getTranscriptionBvid() || "");
            const currentBvid = normalizeBvidCase(appState.injectBvid || getStableCurrentBvid() || "");
            
            if (taskBvid && currentBvid && taskBvid !== currentBvid) {
                logContent.warn("transcription_stale_result_drop", {
                    task: "asr",
                    bvid: taskBvid,
                    detail: { current_bvid: currentBvid }
                });
                return false;
            }
            
            appState.isStateDirty = true;
            updateAsrSession({
                active: true,
                bvid: activeTranscribeBvid,
                stage: "done",
                progress: 100,
                statusText: "转录成功，正在加载字幕..."
            });
            patchTranscriptionState({
                phase: "running",
                bvid: activeTranscribeBvid,
                progress: 100,
                statusText: "转录成功，正在加载字幕..."
            });
            appState.transcriptionCapsuleVisible = true;
            updateProgress(95, progressTaskId);
            
            const targetBvid = normalizeBvidCase(message?.bvid || currentBvid || "");
            const finishTranscriptionDone = (ok) => {
                if (ok && hasUsableSubtitleCache(appState.cache, targetBvid)) {
                    applyCacheSubtitleState(appState.cache, targetBvid);
                    clearAsrSession();
                    resetTranscriptionState({ phase: "done", progress: 100 });
                    appState.transcriptionCapsuleVisible = false;
                    appState.transcriptionCapsuleMeta = null;
                    updateProgress(100, progressTaskId);
                } else {
                    clearAsrSession();
                    resetTranscriptionState();
                }
                renderContent();
            };
            if (hasUsableSubtitleCache(appState.cache, targetBvid)) {
                finishTranscriptionDone(true);
            } else {
                renderContent();
                syncCacheFromBackgroundWithRetry(targetBvid).then(finishTranscriptionDone);
            }
            renderSubtitleTimelinePanel(document.getElementById("panel-body"));
        }
        if (message?.stage !== "done" && message?.level !== "error") {
            const msgBvid = normalizeBvidCase(message?.bvid || "");
            const currentBvid = normalizeBvidCase(appState.injectBvid || getStableCurrentBvid() || "");
            if (!msgBvid || !currentBvid || msgBvid === currentBvid) {
                renderContent();
            }
        }
        return false;
    }
    if (action !== "SUBTITLE_READY" && action !== "UPDATE_STATE") return false;
    const payloadBvid = normalizeBvidCase(message?.bvid || "");
    const routeBvid = normalizeBvidCase(getBvidFromUrl(location.href));
    if (payloadBvid && routeBvid && payloadBvid !== routeBvid) {
        pushSubtitleTimeline("drop_mismatch_bvid_bg", { payloadBvid, currentBvid: routeBvid });
        return false;
    }
    if (message?.tabState) {
        mergeIncomingTabState(message.tabState);
        syncStepProgressByTaskState(appState.tabState);
    }
    const cache = message?.cache || null;
    if (cache && payloadBvid && normalizeBvidCase(cache?.bvid || "") !== payloadBvid) return false;
    appState.pendingSubtitle = null;
    renderNav();
    const messageCacheBvid = normalizeBvidCase(cache?.bvid || "");
    appState.cache = cache && (!routeBvid || messageCacheBvid === routeBvid) ? cache : null;
    if (appState.cache) {
        applyCacheSubtitleState(appState.cache, payloadBvid || routeBvid);
    }
    if (cache?.rawSubtitle?.length || cache?.processedSubtitle?.length) {
        reconcileTranscriptionState(payloadBvid || routeBvid);
    }
    appState.isStateDirty = false;
    renderContent();
    return false;
}

function pushSubtitleTimeline(stage, detail) {
    const item = {
        ts: Date.now(),
        stage: String(stage || "unknown"),
        detail: detail && typeof detail === "object" ? detail : {}
    };
    appState.subtitleTimeline = [...(Array.isArray(appState.subtitleTimeline) ? appState.subtitleTimeline : []), item].slice(-40);
    renderSubtitleTimelinePanel(panelShadowRoot ? panelShadowRoot.getElementById("panel-body") : null);
}

function renderSubtitleTimelinePanel(panel) {
    if (!panel) return;
    const oldNode = panel.querySelector(".subtitle-timeline-panel");
    if (oldNode) oldNode.remove();
}

function renderTimelineRowsHtml(sourceRows, rawTerm, showCapsule) {
    const term = String(rawTerm || "").trim().toLowerCase();
    const filtered = term
        ? sourceRows.filter((item) => String(item.stage || "").toLowerCase().includes(term)
            || serializeTimelineDetail(item.detail).toLowerCase().includes(term))
        : sourceRows;
    if (!filtered.length) {
        if (term) return `<div class="subtitle-timeline-empty">未搜索到匹配字幕</div>`;
        if (showCapsule) return "";
        return `<div class="subtitle-timeline-empty">暂无字幕</div>`;
    }
    return filtered.slice(-12).reverse().map((item) => {
        const stage = highlightTimelineSearchText(String(item.stage || ""), term);
        const detail = highlightTimelineSearchText(serializeTimelineDetail(item.detail), term);
        return `<div class="subtitle-timeline-row"><span class="subtitle-timeline-time">${formatTimelineTime(item.ts)}</span><span class="subtitle-timeline-stage">${stage}</span><span class="subtitle-timeline-detail">${detail}</span></div>`;
    }).join("");
}

function highlightTimelineSearchText(text, term) {
    const safeText = escapeHtml(String(text || ""));
    if (!term) return safeText;
    return safeText.replace(new RegExp(escapeRegExp(term), "ig"), (match) => `<mark class="timeline-search-hit">${match}</mark>`);
}

function toggleExportMenu(buttonNode) {
    const existing = panelShadowRoot ? panelShadowRoot.getElementById("export-option-menu") : null;
    if (existing) {
        if (existing.dataset.streamLoading === "1") {
            return;
        }
        closeExportMenu();
        return;
    }
    
    const overlay = document.createElement("div");
    overlay.id = "export-option-menu";
    overlay.className = "copy-menu-overlay";
    
    const menu = document.createElement("div");
    menu.className = "copy-option-menu export-menu";
    overlay.appendChild(menu);
    
    renderExportMainMenu(menu);
    
    const rect = buttonNode?.getBoundingClientRect?.();
    const container = panelShadowRoot ? panelShadowRoot.querySelector(".ai-summary-plugin-box") : null;
    
    if (rect && container) {
        const containerRect = container.getBoundingClientRect();
        // Position relative to container
        // Place to the right of the button
        let left = rect.right - containerRect.left + 8;
        // Calculate bottom position: button top relative to container
        // We want the menu's bottom to be at the button's top
        // But since we use absolute positioning with 'bottom', we need distance from container bottom
        
        // Let's use 'bottom' style instead of 'top'
        // Distance from container bottom to button top
        let bottom = containerRect.bottom - rect.top + 5;
        
        // Boundary checks (basic)
        if (left + 200 > containerRect.width) {
            left = rect.left - containerRect.left - 200; // Flip to left if no space
        }
        
        menu.style.position = "absolute";
        menu.style.left = `${left}px`;
        menu.style.bottom = `${bottom}px`;
        menu.style.top = "auto"; // Unset top
    }
    
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeExportMenu();
    });
    
    if (container) {
        container.appendChild(overlay);
        setNavActionActive("export", 0);
    }
}

function renderExportLoadingState(menuContainer, type) {
    if (!menuContainer) return;
    const title = type === "audio" ? "正在获取音频流..." : "正在获取视频流...";
    menuContainer.dataset.streamLoading = type === "audio" ? "audio" : "video";
    menuContainer.innerHTML = `
        <div class="quality-list-header" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #eee;margin-bottom:4px;">
            <button class="back-btn" style="border:none;background:none;cursor:pointer;font-size:16px;padding:0 4px;">←</button>
            <span style="font-size:13px;font-weight:600;">${title}</span>
        </div>
        <div class="quality-list-body" style="padding:18px 16px 16px;color:#61666d;font-size:13px;line-height:1.7;">
            正在拉取当前视频的最新播放地址，请稍候...
        </div>
    `;
    menuContainer.querySelector(".back-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        menuContainer.dataset.streamLoading = "";
        renderExportMainMenu(menuContainer);
    });
}

function renderExportMainMenu(menuContainer) {
    if (!menuContainer) return;
    menuContainer.dataset.streamLoading = "";
    const pageBvid = normalizeBvidCase(getBvidFromUrl(location.href) || "");
    const downloadReady = hasUsablePlayInfoForBvid(appState.playInfo, pageBvid);
    appState.isPlayInfoReady = downloadReady;
    const downloadVideoLabel = "下载视频";
    const downloadAudioLabel = "下载音频";
    menuContainer.innerHTML = `
        <button type="button" class="copy-option-btn" data-action="download-video">${downloadVideoLabel}</button>
        <button type="button" class="copy-option-btn" data-action="download-audio">${downloadAudioLabel}</button>
        <div class="menu-divider" style="height:1px;background:#eee;margin:4px 0;"></div>
        <button type="button" class="copy-option-btn" data-action="export-srt">导出字幕 (SRT)</button>
    `;
    
    menuContainer.querySelector('[data-action="export-srt"]').addEventListener("click", () => {
        closeExportMenu();
        handleExportSrt();
    });
    
    menuContainer.querySelector('[data-action="download-video"]').addEventListener("click", async (e) => {
        e.stopPropagation();
        await renderCompatQualityList(menuContainer, "video");
    });

    menuContainer.querySelector('[data-action="download-audio"]').addEventListener("click", async (e) => {
        e.stopPropagation();
        await renderCompatQualityList(menuContainer, "audio");
    });
}

async function probeUrlInPage(url) {
    try {
        const res = await chrome.runtime.sendMessage({ action: "PROBE_URL", payload: { url } });
        return res?.status || "unknown";
    } catch (_) {
        return "unknown";
    }
}

function getStreamCandidateUrls(stream) {
    const urls = Array.isArray(stream?.urls) ? stream.urls : [];
    return [...urls, stream?.url]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
}

async function pickVerifiedDownloadUrl(stream) {
    const candidates = getStreamCandidateUrls(stream);
    for (const url of candidates) {
        const status = await probeUrlInPage(url);
        if (status === "ok") return url;
    }
    return "";
}

function buildCompatIdentityPayload(type, qn) {
    return {
        type,
        qn: Number(qn || 0) || undefined,
        bvid: normalizeBvidCase(resolveCurrentBvid() || getBvidFromUrl(location.href) || ""),
        cid: Number(resolveCid() || appState.injectCid || appState.tabState?.activeCid || 0),
        tid: appState.tabState?.activeTid || getTidFromUrl(location.href),
        title: cleanBilibiliTitle(document.title)
    };
}

async function fetchCompatPlayUrl(type, qn = 0) {
    const response = await chrome.runtime.sendMessage({
        action: "GET_COMPAT_PLAYURL",
        payload: buildCompatIdentityPayload(type, qn)
    });
    if (!response?.ok) throw new Error(response?.error || "获取兼容下载链接失败");
    return response;
}

async function renderCompatQualityList(menuContainer, type) {
    if (!menuContainer) return;
    if (!chrome.runtime?.id) {
        showToast("下载链接已经失效，请刷新页面后重试");
        return;
    }
    renderExportLoadingState(menuContainer, type);
    const pageBvid = normalizeBvidCase(getBvidFromUrl(location.href) || "");
    let compat;
    try {
        compat = await fetchCompatPlayUrl(type);
    } catch (error) {
        logDownload.error("download_compat_playurl_failed", {
            task: "download",
            bvid: pageBvid,
            code: error?.code || "DOWNLOAD_COMPAT_PLAYURL_FAILED",
            detail: { type, reason: error?.message || "获取兼容下载链接失败" }
        });
        notifyMappedError(error, "获取兼容下载链接失败: " + (error.message || ""));
        renderExportMainMenu(menuContainer);
        return;
    }
    const title = type === "video" ? "选择清晰度" : "选择音频";
    const bodyHtml = type === "video"
        ? (Array.isArray(compat.qualities) ? compat.qualities : []).map((item) => `
            <div class="quality-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;gap:12px;border-bottom:1px solid #f1f2f3;">
                <span class="quality-desc" style="font-size:13px;">${escapeHtml(item.desc || "")}</span>
                <button class="compat-video-download-btn" data-qn="${Number(item.quality || 0)}"
                   style="font-size:12px;padding:4px 10px;border:1px solid #fb7299;color:#fff;background:#fb7299;border-radius:4px;cursor:pointer;">
                   下载
                </button>
            </div>
        `).join("")
        : (Array.isArray(compat.streams) ? compat.streams : []).map((item, index) => `
            <div class="quality-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;gap:12px;border-bottom:1px solid #f1f2f3;">
                <span class="quality-desc" style="font-size:13px;">${escapeHtml(item.desc || "音频")}</span>
                <button class="compat-audio-download-btn" data-index="${index}"
                   style="font-size:12px;padding:4px 10px;border:1px solid #fb7299;color:#fff;background:#fb7299;border-radius:4px;cursor:pointer;">
                   下载
                </button>
            </div>
        `).join("");

    if (!bodyHtml) {
        showToast(type === "video" ? "未找到兼容视频流" : "未找到可用音频流");
        renderExportMainMenu(menuContainer);
        return;
    }

    menuContainer.innerHTML = `
        <div class="quality-list-header" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #eee;margin-bottom:4px;">
            <button class="back-btn" style="border:none;background:none;cursor:pointer;font-size:16px;padding:0 4px;">←</button>
            <span style="font-size:13px;font-weight:600;">${title}</span>
            <span style="font-size:11px;color:#9499a0;">兼容模式</span>
        </div>
        <div class="quality-list-body" style="max-height:300px;overflow-y:auto;padding-top:4px;">
            ${bodyHtml}
        </div>
    `;
    menuContainer.querySelector(".back-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        renderExportMainMenu(menuContainer);
    });

    menuContainer.querySelectorAll(".compat-video-download-btn").forEach((btn) => {
        btn.addEventListener("click", async (event) => {
            event.stopPropagation();
            const qn = Number(btn.dataset.qn || 0);
            const originalText = btn.textContent;
            btn.textContent = "准备中...";
            btn.disabled = true;
            try {
                const startedAt = Date.now();
                const fresh = await fetchCompatPlayUrl("video", qn);
                const stream = fresh?.stream || null;
                if (!stream?.url) throw new Error("未获取到该清晰度的 MP4 下载链接");
                const urlToDownload = await pickVerifiedDownloadUrl(stream) || stream.url;
                const safeTitle = sanitizeDownloadFileName(cleanBilibiliTitle(document.title));
                const filename = `${safeTitle}_${stream.desc || qn}_兼容.mp4`;
                logDownload.info("download_url_prepare_success", {
                    task: "download",
                    bvid: pageBvid,
                    duration_ms: Date.now() - startedAt,
                    detail: {
                        asset_type: "video",
                        download_mode: "compat_mp4",
                        quality: stream.desc || "",
                        quality_id: Number(stream.quality || qn || 0),
                        has_url: !!urlToDownload,
                        file_ext: "mp4"
                    }
                });
                await chrome.runtime.sendMessage({
                    action: "DOWNLOAD_STREAM",
                    payload: { url: urlToDownload, filename }
                });
                showToast("下载已触发，请查看浏览器下载");
            } catch (error) {
                logDownload.error("download_url_prepare_failed", {
                    task: "download",
                    bvid: pageBvid,
                    code: error?.code || "DOWNLOAD_COMPAT_FAILED",
                    detail: {
                        asset_type: "video",
                        download_mode: "compat_mp4",
                        quality_id: qn,
                        reason: error.message || "下载失败"
                    }
                });
                notifyMappedError(error, "下载失败: " + (error.message || ""));
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });
    });

    menuContainer.querySelectorAll(".compat-audio-download-btn").forEach((btn) => {
        btn.addEventListener("click", async (event) => {
            event.stopPropagation();
            const index = Number(btn.dataset.index || 0);
            const stream = Array.isArray(compat.streams) ? compat.streams[index] : null;
            if (!stream?.url) return;
            const originalText = btn.textContent;
            btn.textContent = "准备中...";
            btn.disabled = true;
            try {
                const urlToDownload = await pickVerifiedDownloadUrl(stream) || stream.url;
                const safeTitle = sanitizeDownloadFileName(cleanBilibiliTitle(document.title));
                const filename = `${safeTitle}_${stream.desc || "音频"}.m4a`;
                await chrome.runtime.sendMessage({
                    action: "DOWNLOAD_STREAM",
                    payload: { url: urlToDownload, filename }
                });
                showToast("下载已触发，请查看浏览器下载");
            } catch (error) {
                notifyMappedError(error, "下载失败: " + (error.message || ""));
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });
    });
}

function renderQualityList(menuContainer, type) {
    if (!menuContainer) return;
    menuContainer.dataset.streamLoading = "";
    if (!chrome.runtime?.id) {
        showToast("下载链接已经失效，请刷新页面后重试");
        return;
    }
    const pageBvid = normalizeBvidCase(getBvidFromUrl(location.href) || "");
    if (!hasUsablePlayInfoForBvid(appState.playInfo, pageBvid)) {
        appState.isPlayInfoReady = false;
        showToast("正在获取视频流，请稍候...");
        refreshPlayInfoNow(7000)
            .then((info) => {
                if (!hasUsablePlayInfoForBvid(info, pageBvid)) {
                    showToast("暂未拿到可用视频流，请稍后重试");
                    renderExportMainMenu(menuContainer);
                    return;
                }
                renderQualityList(menuContainer, type);
            })
            .catch(() => {
                showToast("暂未拿到可用视频流，请稍后重试");
                renderExportMainMenu(menuContainer);
            });
        return;
    }
    appState.isPlayInfoReady = true;
    const streams = appState.playInfo[type] || [];
    if (!streams.length) {
        showToast(`未找到${type === "video" ? "视频" : "音频"}流`);
        return;
    }
    
    const title = type === "video" ? "选择清晰度" : "选择音频";
    const qualityTipHtml = type === "video" ? `
            <span class="download-quality-info" aria-label="下载提示" tabindex="0"
                  style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid #c9ccd0;border-radius:50%;color:#9499a0;font-size:12px;line-height:1;cursor:help;">
                i
                <span class="download-quality-tooltip"
                      style="display:none;position:absolute;left:50%;top:22px;transform:translateX(-50%);z-index:10000;width:220px;padding:8px 10px;border-radius:6px;background:#2f3238;color:#fff;font-size:12px;font-weight:400;line-height:1.45;box-shadow:0 6px 18px rgba(0,0,0,0.16);">
                    请检查下载文件后缀，如为.htm请尝试其他编码或清晰度！
                </span>
            </span>` : "";
    
    // For video, streams are now grouped: { quality, desc, streams: [{codecName, url...}] }
    // For audio, it's still a flat array (unless we group audio too, but inject.js didn't change audio structure much)
    
    let listHtml = "";
    
    if (type === "video") {
        listHtml = streams.map((group, gIndex) => {
            const streamList = Array.isArray(group?.streams) ? group.streams : [];
            const firstCandidateIndex = streamList.findIndex((s) => String(s?.url || "").trim());
            const initialStreamIndex = firstCandidateIndex >= 0 ? firstCandidateIndex : 0;
            // group.streams has sub-options
            const subOptions = streamList.map((s, sIndex) => `
                <button class="codec-btn" data-group="${gIndex}" data-stream="${sIndex}" 
                   title="${escapeHtml(s.codecs || s.codecName)}"
                   style="font-size:11px;padding:2px 6px;border:1px solid #e3e8ec;background:#f6f7f8;color:#61666d;border-radius:4px;cursor:pointer;margin-left:4px;">
                   ${escapeHtml(s.codecName)}
                </button>
            `).join("");
            
            return `
                <div class="quality-group" style="padding:8px 12px;border-bottom:1px solid #f1f2f3;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <span class="quality-desc" style="font-size:13px;font-weight:500;color:#18191c;">${escapeHtml(group.desc)}</span>
                        <button class="download-default-btn" data-group="${gIndex}" data-stream="${initialStreamIndex}"
                           style="font-size:12px;padding:4px 10px;border:1px solid #fb7299;color:#fff;background:#fb7299;border-radius:4px;cursor:pointer;">
                           下载
                        </button>
                    </div>
                    <div class="codec-list" style="display:flex;flex-wrap:wrap;gap:4px;">
                        ${subOptions}
                    </div>
                </div>
            `;
        }).join("");
    } else {
        // Audio
        listHtml = streams.map((s, index) => `
            <div class="quality-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;gap:12px;border-bottom:1px solid #f1f2f3;">
                <span class="quality-desc" style="font-size:13px;">${escapeHtml(s.desc)}</span>
                <button class="download-stream-btn" data-index="${index}" 
                   style="font-size:12px;padding:4px 10px;border:1px solid #fb7299;color:#fff;background:#fb7299;border-radius:4px;cursor:pointer;">
                   下载
                </button>
            </div>
        `).join("");
    }
    
    menuContainer.innerHTML = `
        <div class="quality-list-header" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #eee;margin-bottom:4px;">
            <button class="back-btn" style="border:none;background:none;cursor:pointer;font-size:16px;padding:0 4px;">←</button>
            <span style="font-size:13px;font-weight:600;">${title}</span>
            ${qualityTipHtml}
        </div>
        <div class="quality-list-body" style="max-height:300px;overflow-y:auto;padding-top:4px;">
            <div class="download-unavailable-notice" style="display:none;margin:0 10px 8px;padding:8px 10px;border:1px solid #ffd7e5;background:#fff5f8;color:#8a4158;border-radius:6px;font-size:12px;line-height:1.45;">
                <div style="font-weight:600;margin-bottom:3px;">当前下载链接暂不可用</div>
                <div style="color:#93586a;">可能是链接过期或站点拒绝，请重新获取后再试。</div>
                <button type="button" data-action="download-retry-streams" style="margin-top:7px;border:1px solid #fb7299;background:#fb7299;color:#fff;border-radius:4px;padding:4px 8px;font-size:12px;cursor:pointer;">重新获取</button>
            </div>
            ${listHtml}
        </div>
    `;
    
    menuContainer.querySelector(".back-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        renderExportMainMenu(menuContainer);
    });
    const qualityInfo = menuContainer.querySelector(".download-quality-info");
    const qualityTooltip = qualityInfo?.querySelector(".download-quality-tooltip");
    if (qualityInfo && qualityTooltip) {
        const showQualityTip = () => { qualityTooltip.style.display = "block"; };
        const hideQualityTip = () => { qualityTooltip.style.display = "none"; };
        qualityInfo.addEventListener("mouseenter", showQualityTip);
        qualityInfo.addEventListener("mouseleave", hideQualityTip);
        qualityInfo.addEventListener("focus", showQualityTip);
        qualityInfo.addEventListener("blur", hideQualityTip);
    }
    menuContainer.querySelector('[data-action="download-retry-streams"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        menuContainer.dataset.expiredRefreshAttempted = "";
        renderExportLoadingState(menuContainer, type);
        const info = await refreshPlayInfoNow(7000).catch(() => null);
        const pageBvid = normalizeBvidCase(getBvidFromUrl(location.href) || "");
        if (!hasUsablePlayInfoForBvid(info, pageBvid)) {
            showToast("暂未拿到可用视频流，请稍后重试");
            renderExportMainMenu(menuContainer);
            return;
        }
        renderQualityList(menuContainer, type);
    });

    const isProbeTargetAlive = () => !!menuContainer && (panelShadowRoot ?? document).contains(menuContainer);
    const probeSessionId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    menuContainer.dataset.probeSessionId = probeSessionId;

    const setProbePending = (btn) => {
        if (!btn) return;
        if (!btn.dataset.probeOriginalText) btn.dataset.probeOriginalText = btn.textContent || "";
        if (!btn.dataset.probeOriginalOpacity) btn.dataset.probeOriginalOpacity = btn.style.opacity || "";
        if (!btn.dataset.probeOriginalCursor) btn.dataset.probeOriginalCursor = btn.style.cursor || "";
        if (!btn.dataset.probeOriginalColor) btn.dataset.probeOriginalColor = btn.style.color || "";
        if (!btn.dataset.probeOriginalBorderColor) btn.dataset.probeOriginalBorderColor = btn.style.borderColor || "";
        if (!btn.dataset.probeOriginalBackground) btn.dataset.probeOriginalBackground = btn.style.background || "";
        btn.dataset.probeStatus = "pending";
        btn.disabled = true;
        btn.textContent = "检测中…";
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";
    };

    const applyProbeState = (btn, status) => {
        if (!btn || !(panelShadowRoot ?? document).contains(btn)) return;
        const originalText = btn.dataset.probeOriginalText || "下载";
        if (status === "expired") {
            btn.dataset.probeStatus = "expired";
            btn.disabled = true;
            btn.textContent = "不可用";
            btn.style.opacity = "1";
            btn.style.cursor = "not-allowed";
            btn.style.color = "#999";
            btn.style.borderColor = "#ccc";
            btn.style.background = "#f5f5f5";
            return;
        }
        if (status === "ok") {
            btn.dataset.probeStatus = "ok";
            btn.disabled = false;
            btn.textContent = originalText;
            btn.style.opacity = btn.dataset.probeOriginalOpacity || "1";
            btn.style.cursor = "pointer";
            btn.style.color = btn.dataset.probeOriginalColor || "";
            btn.style.borderColor = btn.dataset.probeOriginalBorderColor || "";
            btn.style.background = btn.dataset.probeOriginalBackground || "";
            if (btn.classList.contains("download-default-btn") || btn.classList.contains("download-stream-btn")) {
                btn.style.opacity = "1";
                btn.style.color = "#fff";
                btn.style.borderColor = "#fb7299";
                btn.style.background = "#fb7299";
            }
            return;
        }
        btn.dataset.probeStatus = "unknown";
        btn.disabled = true;
        btn.textContent = "待刷新";
        btn.style.opacity = "1";
        btn.style.cursor = "not-allowed";
        btn.style.color = "#999";
        btn.style.borderColor = "#ccc";
        btn.style.background = "#f5f5f5";
    };

    const addProbeTarget = (urlToButtons, url, btn) => {
        const key = String(url || "").trim();
        if (!key || !btn) return;
        const list = urlToButtons.get(key) || [];
        list.push(btn);
        urlToButtons.set(key, list);
    };

    const refreshMenuWhenAllExpired = async () => {
        if (menuContainer.dataset.expiredRefreshAttempted === "1") return false;
        menuContainer.dataset.expiredRefreshAttempted = "1";
        try {
            const info = await refreshPlayInfoNow(7000).catch(() => null);
            const pageBvid = normalizeBvidCase(getBvidFromUrl(location.href) || "");
            if (!hasUsablePlayInfoForBvid(info, pageBvid)) {
                updateUnavailableNotice();
                return false;
            }
            renderQualityList(menuContainer, type);
            return true;
        } catch (_) {
            updateUnavailableNotice();
            return false;
        }
    };

    const hasAnyUsableButton = () => {
        const actionButtons = Array.from(menuContainer.querySelectorAll(".download-default-btn, .codec-btn, .download-stream-btn"));
        return actionButtons.some((btn) => String(btn?.dataset?.probeStatus || "") === "ok");
    };

    const updateUnavailableNotice = () => {
        const notice = menuContainer.querySelector(".download-unavailable-notice");
        if (!notice) return;
        const actionButtons = Array.from(menuContainer.querySelectorAll(".download-default-btn, .codec-btn, .download-stream-btn"));
        const hasPending = actionButtons.some((btn) => String(btn?.dataset?.probeStatus || "") === "pending");
        notice.style.display = actionButtons.length > 0 && !hasPending && !hasAnyUsableButton() ? "block" : "none";
    };

    const syncDefaultButtonState = (groupIndex) => {
        if (type !== "video") return;
        const defaultBtn = menuContainer.querySelector(`.download-default-btn[data-group="${groupIndex}"]`);
        if (!defaultBtn) return;
        const group = streams[groupIndex];
        const streamList = Array.isArray(group?.streams) ? group.streams : [];
        if (!streamList.length) {
            applyProbeState(defaultBtn, "expired");
            defaultBtn.dataset.stream = "-1";
            return;
        }
        let firstOkIndex = -1;
        let firstFallbackIndex = -1;
        let hasPending = false;
        for (let i = 0; i < streamList.length; i++) {
            const codecBtn = menuContainer.querySelector(`.codec-btn[data-group="${groupIndex}"][data-stream="${i}"]`);
            const status = String(codecBtn?.dataset?.probeStatus || "pending");
            if (status === "pending") hasPending = true;
            if (status === "ok" && firstOkIndex < 0) firstOkIndex = i;
            if (status === "ok" && firstFallbackIndex < 0) firstFallbackIndex = i;
        }
        if (firstOkIndex >= 0) {
            defaultBtn.dataset.stream = String(firstOkIndex);
            applyProbeState(defaultBtn, "ok");
            return;
        }
        if (firstFallbackIndex >= 0) {
            defaultBtn.dataset.stream = String(firstFallbackIndex);
            applyProbeState(defaultBtn, "unknown");
            return;
        }
        if (hasPending) {
            setProbePending(defaultBtn);
            return;
        }
        defaultBtn.dataset.stream = "-1";
        applyProbeState(defaultBtn, "expired");
    };

    const syncAllDefaultButtons = () => {
        if (type !== "video") return;
        const groups = appState.playInfo?.video || [];
        groups.forEach((_, gIndex) => syncDefaultButtonState(gIndex));
    };

    const collectProbeTargets = () => {
        const urlToButtons = new Map();
        if (type === "video") {
            const groups = appState.playInfo?.video || [];
            groups.forEach((group, gIndex) => {
                const streamList = Array.isArray(group?.streams) ? group.streams : [];
                streamList.forEach((stream, sIndex) => {
                    const urls = getStreamCandidateUrls(stream);
                    if (!urls.length) return;
                    const codecBtn = menuContainer.querySelector(`.codec-btn[data-group="${gIndex}"][data-stream="${sIndex}"]`);
                    urls.forEach((url) => addProbeTarget(urlToButtons, url, codecBtn));
                });
            });
            return urlToButtons;
        }
        const audioStreams = appState.playInfo?.audio || [];
        audioStreams.forEach((stream, index) => {
            const urls = getStreamCandidateUrls(stream);
            if (!urls.length) return;
            const btn = menuContainer.querySelector(`.download-stream-btn[data-index="${index}"]`);
            urls.forEach((url) => addProbeTarget(urlToButtons, url, btn));
        });
        return urlToButtons;
    };

    const pendingButtons = menuContainer.querySelectorAll(".download-default-btn, .codec-btn, .download-stream-btn");
    pendingButtons.forEach(setProbePending);
    syncAllDefaultButtons();

    const startProbeForCurrentMenu = async () => {
        if (!isProbeTargetAlive() || menuContainer.dataset.probeSessionId !== probeSessionId) return;
        const urlToButtons = collectProbeTargets();
        if (!urlToButtons.size) {
            pendingButtons.forEach((btn) => applyProbeState(btn, "unknown"));
            return;
        }

        try {
            await refreshPlayInfoNow(1500).catch(() => {});
            if (!isProbeTargetAlive() || menuContainer.dataset.probeSessionId !== probeSessionId) return;
            const freshUrlToButtons = collectProbeTargets();

            const buttonStatuses = new Map();
            const rememberStatus = (btn, status) => {
                if (!btn) return;
                const list = buttonStatuses.get(btn) || [];
                list.push(status);
                buttonStatuses.set(btn, list);
            };
            await Promise.all(
                Array.from(freshUrlToButtons.entries()).map(async ([url, btnList]) => {
                    const status = await probeUrlInPage(url);
                    if (!isProbeTargetAlive() || menuContainer.dataset.probeSessionId !== probeSessionId) return;
                    btnList.forEach((btn) => rememberStatus(btn, status));
                })
            );
            const touchedGroups = new Set();
            buttonStatuses.forEach((statuses, btn) => {
                const finalStatus = statuses.includes("ok")
                    ? "ok"
                    : statuses.every((status) => status === "expired")
                        ? "expired"
                        : "unknown";
                applyProbeState(btn, finalStatus);
                const groupIndex = Number(btn?.dataset?.group);
                if (Number.isFinite(groupIndex)) touchedGroups.add(groupIndex);
            });
            touchedGroups.forEach((gIndex) => syncDefaultButtonState(gIndex));

            pendingButtons.forEach((btn) => {
                if (btn.dataset.probeStatus === "pending") applyProbeState(btn, "unknown");
            });
            syncAllDefaultButtons();
            updateUnavailableNotice();
            if (!hasAnyUsableButton()) {
                await refreshMenuWhenAllExpired();
            }
        } catch (_) {
            if (!isProbeTargetAlive() || menuContainer.dataset.probeSessionId !== probeSessionId) return;
            pendingButtons.forEach((btn) => applyProbeState(btn, "unknown"));
            syncAllDefaultButtons();
            updateUnavailableNotice();
        }
    };

    startProbeForCurrentMenu();

    // Trigger download helper
    const triggerVideoDownload = async (btn, groupIndex, streamIndex) => {
        const group = streams[groupIndex];
        const stream = group?.streams?.[streamIndex];
        if (!stream) return;
        if (String(btn?.dataset?.probeStatus || "") !== "ok") {
            showToast("下载链接未确认有效，请刷新后重试");
            refreshMenuWhenAllExpired().catch(() => {});
            return;
        }

        logDownload.info("download_option_selected", {
            task: "download",
            bvid: getBvidFromUrl(location.href) || "",
            detail: {
                asset_type: "video",
                quality: group.desc || "",
                quality_id: Number(group.quality || 0),
                codec: stream.codecName || "",
                has_video: true,
                has_audio: true
            }
        });
        const originalText = btn.textContent;
        btn.textContent = "准备中...";
        btn.disabled = true;
        btn.style.opacity = "0.7";

        try {
            const prepareStartedAt = Date.now();
            logDownload.info("download_url_prepare_start", {
                task: "download",
                bvid: getBvidFromUrl(location.href) || "",
                detail: {
                    asset_type: "video",
                    quality: group.desc || "",
                    codec: stream.codecName || ""
                }
            });
            await refreshPlayInfoNow();
            // Re-find the matching stream from fresh data
            const freshGroups = appState.playInfo?.video || [];
            // Find group by quality
            const freshGroup = freshGroups.find(g => Number(g.quality) === Number(group.quality));
            // Find stream by codecName (best effort matching)
            const freshStream = freshGroup?.streams?.find(s => s.codecName === stream.codecName) 
                || freshGroup?.streams?.[0]; // Fallback to first if codec gone

            if (!freshStream) throw new Error("无法获取最新下载地址");
            
            const urlToDownload = await pickVerifiedDownloadUrl(freshStream);
            if (!urlToDownload) throw new Error("下载链接不可用，请刷新后重试");
            // Generate safe filename
            const currentTitle = cleanBilibiliTitle(document.title);
            const safeTitle = sanitizeDownloadFileName(currentTitle);
            const filename = `${safeTitle}_${freshGroup.desc}_${freshStream.codecName}.mp4`;
            if (!chrome.runtime?.id) {
                showToast("下载链接已经失效，请刷新页面后重试");
                return;
            }
            logDownload.info("download_url_prepare_success", {
                task: "download",
                bvid: getBvidFromUrl(location.href) || "",
                duration_ms: Date.now() - prepareStartedAt,
                detail: {
                    asset_type: "video",
                    quality: freshGroup.desc || group.desc || "",
                    codec: freshStream.codecName || "",
                    has_url: !!urlToDownload,
                    file_ext: "mp4"
                }
            });
            
            await chrome.runtime.sendMessage({
                action: "DOWNLOAD_STREAM",
                payload: { url: urlToDownload, filename }
            });
            showToast("下载已触发，请查看浏览器下载");
        } catch (err) {
            logDownload.error("download_url_prepare_failed", {
                task: "download",
                bvid: getBvidFromUrl(location.href) || "",
                code: err?.code || "DOWNLOAD_URL_PREPARE_FAILED",
                status: Number(err?.status || 0) || 0,
                detail: {
                    asset_type: "video",
                    quality: group.desc || "",
                    codec: stream.codecName || "",
                    reason: err.message || "下载失败"
                }
            });
            notifyMappedError({ ...err, code: err?.code || "DOWNLOAD_FAILED" }, "下载失败: " + (err.message || ""));
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.style.opacity = "1";
        }
    };

    if (type === "video") {
        menuContainer.querySelectorAll(".download-default-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const groupIndex = parseInt(btn.dataset.group, 10);
                const streamIndex = parseInt(btn.dataset.stream, 10);
                if (!Number.isFinite(groupIndex) || !Number.isFinite(streamIndex) || streamIndex < 0) {
                    refreshMenuWhenAllExpired().catch(() => {});
                    return;
                }
                if (String(btn.dataset.probeStatus || "") !== "ok") {
                    showToast("下载链接未确认有效，请刷新后重试");
                    refreshMenuWhenAllExpired().catch(() => {});
                    return;
                }
                triggerVideoDownload(btn, groupIndex, streamIndex);
            });
        });
        menuContainer.querySelectorAll(".codec-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (String(btn.dataset.probeStatus || "") !== "ok") {
                    showToast("下载链接未确认有效，请刷新后重试");
                    refreshMenuWhenAllExpired().catch(() => {});
                    return;
                }
                triggerVideoDownload(btn, parseInt(btn.dataset.group), parseInt(btn.dataset.stream));
            });
        });
    } else {
        // Audio handlers (legacy flat list)
        menuContainer.querySelectorAll(".download-stream-btn").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (String(btn.dataset.probeStatus || "") !== "ok") {
                    showToast("下载链接未确认有效，请刷新后重试");
                    refreshMenuWhenAllExpired().catch(() => {});
                    return;
                }
                const index = parseInt(btn.dataset.index, 10);
                const stream = streams[index];
                if (!stream) return;
                
                const originalText = btn.textContent;
                btn.textContent = "...";
                btn.disabled = true;
                
                try {
                    const prepareStartedAt = Date.now();
                    logDownload.info("download_url_prepare_start", {
                        task: "download",
                        bvid: getBvidFromUrl(location.href) || "",
                        detail: {
                            asset_type: "audio",
                            quality: stream.desc || "",
                            codec: stream.codecName || ""
                        }
                    });
                    await refreshPlayInfoNow();
                    const freshAudio = appState.playInfo?.audio || [];
                    const freshStream = freshAudio.find(a => a.id === stream.id) || freshAudio[index];
                    
                    if (!freshStream) throw new Error("无法获取最新音频地址");
                    
                    const currentTitle = cleanBilibiliTitle(document.title);
                    const safeTitle = sanitizeDownloadFileName(currentTitle);
                    const filename = `${safeTitle}_${freshStream.desc}.m4a`;
                    if (!chrome.runtime?.id) {
                        showToast("下载链接已经失效，请刷新页面后重试");
                        return;
                    }
                    logDownload.info("download_url_prepare_success", {
                        task: "download",
                        bvid: getBvidFromUrl(location.href) || "",
                        duration_ms: Date.now() - prepareStartedAt,
                        detail: {
                            asset_type: "audio",
                            quality: freshStream.desc || "",
                            codec: freshStream.codecName || "",
                            has_url: !!freshStream.url,
                            file_ext: "m4a"
                        }
                    });
                    
                    const urlToDownload = await pickVerifiedDownloadUrl(freshStream);
                    if (!urlToDownload) throw new Error("音频下载链接不可用，请刷新后重试");
                    await chrome.runtime.sendMessage({
                        action: "DOWNLOAD_STREAM",
                        payload: { url: urlToDownload, filename }
                    });
                    showToast("下载已触发，请查看浏览器下载");
                } catch (err) {
                    logDownload.error("download_url_prepare_failed", {
                        task: "download",
                        bvid: getBvidFromUrl(location.href) || "",
                        code: err?.code || "DOWNLOAD_URL_PREPARE_FAILED",
                        status: Number(err?.status || 0) || 0,
                        detail: {
                            asset_type: "audio",
                            reason: err.message || "下载失败"
                        }
                    });
                    notifyMappedError({ ...err, code: err?.code || "DOWNLOAD_FAILED" }, "失败: " + (err.message || ""));
                } finally {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            });
        });
    }
}

async function refreshPlayInfoNow(timeoutMs = 7000) {
    const waitTimeoutMs = Math.max(6000, Number(timeoutMs) || 0);
    const pageBvid = window.location.href.match(/BV[a-zA-Z0-9]{10}/)?.[0] || "";
    const hasUsableStream =
        appState.playInfo &&
        normalizeBvidCase(appState.playInfo._bvid) === normalizeBvidCase(pageBvid) &&
        (
            (Array.isArray(appState.playInfo.audio) && appState.playInfo.audio.length > 0) ||
            (Array.isArray(appState.playInfo.video) && appState.playInfo.video.length > 0)
        );

    if (!hasUsableStream) {
        appState.playInfo = null;
        appState.isPlayInfoReady = false;
        logDownload.info("download_capture_start", {
            task: "download",
            bvid: pageBvid,
            detail: {
                source_candidates: ["window_playinfo", "inject_bridge"],
                timeout_ms: waitTimeoutMs
            }
        });
        window.postMessage({ type: "PLAYER_WAKE_UP" }, "*");
        window.postMessage({ type: "REFRESH_PLAYINFO" }, "*");

        const startWait = Date.now();
        while (Date.now() - startWait < waitTimeoutMs) {
            const info = await requestFromInject(400);
            if (hasUsablePlayInfoForBvid(info, pageBvid)) {
                appState.playInfo = normalizeIncomingPlayInfo(info);
                appState.playInfoUpdatedAt = Date.now();
                appState.isPlayInfoReady = true;
                logDownload.info("download_playinfo_found", {
                    task: "download",
                    bvid: pageBvid,
                    duration_ms: Date.now() - startWait,
                    detail: {
                        source: "inject_bridge",
                        playinfo_source: String(appState.playInfo?._source || ""),
                        video_stream_count: Array.isArray(appState.playInfo?.video) ? appState.playInfo.video.length : 0,
                        audio_stream_count: Array.isArray(appState.playInfo?.audio) ? appState.playInfo.audio.length : 0
                    }
                });
                break;
            }
            await sleep(200);
        }
    }

    if (hasUsablePlayInfoForBvid(appState.playInfo, pageBvid)) {
        appState.isPlayInfoReady = true;
        logDownload.info("download_streams_parse_success", {
            task: "download",
            bvid: pageBvid,
            detail: {
                source: "playinfo",
                playinfo_source: String(appState.playInfo?._source || ""),
                video_group_count: Array.isArray(appState.playInfo?.video) ? appState.playInfo.video.length : 0,
                audio_stream_count: Array.isArray(appState.playInfo?.audio) ? appState.playInfo.audio.length : 0
            }
        });
        return appState.playInfo;
    }

    appState.isPlayInfoReady = false;
    logDownload.warn("download_playinfo_missing", {
        task: "download",
        bvid: pageBvid,
        code: "DOWNLOAD_PLAYINFO_MISSING",
        detail: {
            checked_sources: ["window_playinfo", "inject_bridge"]
        }
    });
    return null;
}

function closeExportMenu() {
    const menu = panelShadowRoot ? panelShadowRoot.getElementById("export-option-menu") : null;
    if (menu) menu.remove();
    if (appState.navActionActive === "export") {
        setNavActionActive("");
    }
}
