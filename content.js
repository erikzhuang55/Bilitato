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
    createPendingChatMessages
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

function isDebugLoggingEnabled() {
    return !!(IS_DEBUG_MODE || appState?.settings?.debugMode);
}

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
    transcriptionDeclinedBvid: "",
    transcriptionSuppressUntil: 0,
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

function patchTranscriptionState(patch = {}) {
    const current = getTranscriptionState();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, "progress")) {
        const currentProgress = Number(current.progress || 0);
        const incomingProgress = Math.max(0, Math.min(100, Number(nextPatch.progress) || 0));
        const sameTask = !nextPatch.bvid || !current.bvid || normalizeBvidCase(nextPatch.bvid) === normalizeBvidCase(current.bvid);
        const stillRunning = current.phase === "running" || nextPatch.phase === "running";
        nextPatch.progress = sameTask && stillRunning && incomingProgress < currentProgress
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

function isTranscriptionRunning() {
    return getTranscriptionState().phase === "running";
}

function getTranscriptionBvid() {
    return normalizeBvidCase(getTranscriptionState().bvid || "");
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
    const view = mapErrorToView ? mapErrorToView(toErrorInput(error, fallbackMessage), fallbackMessage) : null;
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
    const view = mapErrorToView ? mapErrorToView(toErrorInput(error, fallbackMessage), fallbackMessage) : null;
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
        message: normalizedCode
    };
    const view = mapErrorToView ? mapErrorToView(error, "测试错误") : null;
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
    if (tabKey && changes[tabKey]?.newValue) appState.tabState = changes[tabKey].newValue;
    const afterBvid = normalizeBvidCase(appState.tabState?.activeBvid);
    const activeCid = Number(appState.tabState?.activeCid || 0);
    const routeMismatch = !!(routeBvid && afterBvid && String(afterBvid) !== routeBvid);
    const switched = !!(beforeBvid && beforeBvid !== afterBvid);
    if (beforeBvid && beforeBvid !== afterBvid) {
        pushSubtitleTimeline("bvid_switch", { from: beforeBvid, to: afterBvid || "" });
        resetPageStateByBvidSwitch();
        clearStreamCache();
        
        appState.activePage = resolveDefaultOpenPage(appState.settings?.defaultOpenPage);
        renderNav();
        clearCCListImmediately();
    }
    const beforeKey = beforeBvid ? `cache_${beforeBvid}` : "";
    const afterKey = afterBvid ? `cache_${afterBvid}` : "";
    if (!switched && !routeMismatch && beforeKey && changes[beforeKey]?.newValue) {
        const newCache = changes[beforeKey].newValue;
        const cacheBvid = normalizeBvidCase(newCache?.bvid || "");
        const currentRoute = normalizeBvidCase(getBvidFromUrl(location.href));
        if (!currentRoute || cacheBvid === currentRoute) {
            appState.cache = newCache;
        }
    }
    if (!routeMismatch && afterKey && changes[afterKey]?.newValue) appState.cache = changes[afterKey].newValue;
    if (routeMismatch) {
        appState.cache = null;
    }
    if (afterBvid && appState.cache?.bvid && normalizeBvidCase(appState.cache.bvid) !== afterBvid) {
        appState.cache = null;
    }
    if (routeBvid && appState.cache?.bvid && normalizeBvidCase(appState.cache.bvid) !== routeBvid) {
        appState.cache = null;
    }
    if (afterBvid && Array.isArray(appState.cache?.rawSubtitle) && appState.cache.rawSubtitle.length) {
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
        }, 520);
    }, 2000);
}

function updateProgress(percent, taskId, options) {
    const bar = panelShadowRoot ? panelShadowRoot.getElementById("step-progress-bar") : null;
    if (!bar) return;
    const opts = options && typeof options === "object" ? options : {};
    const nextTaskId = String(taskId || "global");
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    const hasActiveTask = !!appState.progressTaskId;
    if (appState.pseudoProgressTaskId && appState.pseudoProgressTaskId !== nextTaskId) {
        clearPseudoProgressTicker();
        appState.pseudoProgressTaskId = "";
        appState.pseudoProgressValue = 0;
        appState.pseudoProgressStartedAt = 0;
    }
    if (hasActiveTask && appState.progressTaskId !== nextTaskId) {
        resetStepProgressBar(bar);
    }
    clearStepProgressTimers();
    if (clamped <= 0) {
        if (!opts.force && hasActiveTask && appState.progressTaskId !== nextTaskId) return;
        resetStepProgressBar(bar);
        appState.progressTaskId = "";
        appState.progressLastTick = 0;
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
    // 首次加载固定展示 CC，让用户先看到字幕检测状态
    appState.activePage = "CC";
}

function renderApp() {
    bindPanelDelegatedEvents();
    renderNav();
    renderContent();
    renderTopRemaining();
    maybeAutoShowSetupGuideOnFirstRun();
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
        ...(IS_DEBUG_MODE ? [{ id: "debug", file: "settings.png", slot: "top", label: "测试" }] : []),
        { id: "copy", file: "copy.png", slot: "bottom", label: "复制" },
        { id: "export", file: "download.png", slot: "bottom", label: "导出" },
        { id: "settings", file: "settings.png", slot: "bottom", label: "设置" }
    ];

    const renderedNavIds = new Set();

    items.forEach((item) => {
        const shouldRender = (() => {
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
    const apiKey = String(appState.settings?.apiKey || "").trim();
    if (!apiKey) {
        panel.classList.remove("is-segments-expanded");
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
    const summary = appState.cache?.summary || "";
    const segments = Array.isArray(appState.cache?.segments) ? appState.cache.segments : [];
    const summaryStatus = appState.tabState?.taskStatus?.summary || "idle";
    const segmentsStatus = appState.tabState?.taskStatus?.segments || "idle";
    const isLoading = summaryStatus === "processing" || segmentsStatus === "processing";
    const hasContent = !!String(summary || "").trim() || segments.length > 0;

    const signature = JSON.stringify({
        summary,
        segmentsLength: segments.length,
        summaryStatus,
        segmentsStatus,
        summarySource: getTaskCacheSource(appState.cache, "summary"),
        segmentsSource: getTaskCacheSource(appState.cache, "segments"),
        sessionFresh: appState.sessionGeneratedTasks.has("summary") || appState.sessionGeneratedTasks.has("segments")
    });

    if (panel.dataset.lastSignature === signature && panel.innerHTML.trim()) return;
    panel.dataset.lastSignature = signature;

    const isFresh = appState.sessionGeneratedTasks.has("summary") || appState.sessionGeneratedTasks.has("segments");
    const cacheTag = buildCacheTagHtml(appState.cache, ["summary", "segments"], hasContent, isLoading, isFresh);
    const headerHtml = `
        <div class="page-header">
            <h3>总结 <div class="header-tags">${cacheTag}</div></h3>
        </div>
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
        const hasSubtitle = Array.isArray(appState.cache?.rawSubtitle) && appState.cache.rawSubtitle.length > 0;
        let btnDisabled = (!hasSubtitle && !isTranscriptionRunning()) ? "disabled" : "";
        let tipText = hasSubtitle ? "去除噪音，抓住重点。" : "当前视频未检测到字幕，无法总结";
        let btnOpacity = (hasSubtitle || isTranscriptionRunning()) ? "1" : "0.5";
        let btnText = "生成 AI 总结";

        if (isTranscriptionRunning()) {
            btnDisabled = "disabled";
            tipText = "正在生成字幕，请稍候...";
            btnOpacity = "0.5";
            btnText = "生成 AI 总结";
        }
        
        panel.innerHTML = `
            ${headerHtml}
            <div class="page-body subtitle-empty-container">
                <div class="action-container">
                    <p class="action-tip">${tipText}</p>
                    <button class="action-btn" data-action="run-summary" ${btnDisabled} style="opacity: ${btnOpacity}">${btnText}</button>
                </div>
            </div>
        `;
        return;
    }

    const summarySkeleton = renderSkeletonLines(4, "summary-skeleton");
    const segmentsSkeleton = renderSkeletonLines(5, "segments-skeleton");
    const summaryBody = isLoading
        ? summarySkeleton
        : (summary ? `<div class="result-text summary-result-text">${renderRichContent(summary)}</div>` : `<div class="empty-text">尚未生成总结</div>`);
    
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

    const hasSegments = segments.length > 0 || isLoading;
    const toggleBtn = hasSegments ? `
        <button class="segments-toggle-btn ${isExpanded ? "is-expanded" : ""}"
                data-action="summary-expand"
                title="${isExpanded ? "收起" : "展开完整分段"}">
            ${isExpanded ? "收起" : "展开"} ${chevron}
        </button>
    ` : "";

    const segmentListHtml = isLoading
        ? segmentsSkeleton
        : (segments.length
            ? `<div class="segment-list">${segments.map((item) => `
                <button class="segment-card ${item.type === "ad" ? "ad" : ""}"
                        data-action="segment-jump" data-start="${item.start}">
                    <span class="seg-time">${formatTime(item.start)}-${formatTime(item.end)}</span>
                    <span class="seg-label">${escapeHtml(item.label)}</span>
                    ${item.type === "ad" ? '<span class="ad-tag">广告片段</span>' : ""}
                </button>`).join("")}
              </div>`
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
    const rows = Array.isArray(rowsOverride) ? rowsOverride : (cacheReadyForCurrent && Array.isArray(appState.cache?.rawSubtitle) ? appState.cache.rawSubtitle : []);
    if (!Array.isArray(rowsOverride) && cacheBvid && currentBvid && cacheBvid !== currentBvid) {
        logContent.warn("cc_cache_mismatch_drop", {
            task: "subtitle",
            bvid: currentBvid,
            code: "CC_CACHE_BVID_MISMATCH",
            detail: {
                cache_bvid: cacheBvid,
                row_count: Array.isArray(appState.cache?.rawSubtitle) ? appState.cache.rawSubtitle.length : 0
            }
        });
    }
    const subtitleSource = String(appState.tabState?.subtitleSource || "");
    const transcription = getTranscriptionState();
    const stateProgress = Math.max(0, Math.min(100, Number(appState.tabState?.transcriptionProgress ?? 0)));
    const localProgress = Math.max(0, Math.min(100, Number(transcription.progress ?? 0)));
    const progress = isTranscriptionRunning() ? Math.max(stateProgress, localProgress) : Math.max(stateProgress, localProgress);
    const isAsrSubtitle = subtitleSource === "groq" || subtitleSource === "whisper" || subtitleSource === "siliconflow" || subtitleSource === "funasr";
    const isNoTimestampSubtitle = subtitleSource === "siliconflow" || subtitleSource === "funasr";
    const running = isTranscriptionRunning();
    const shouldShowRegenerate = rows.length > 0 && isAsrSubtitle && !running;

    const sourceText = rows.length ? (isAsrSubtitle ? "ASR转录生成" : "官方AI字幕") : "未检测到字幕";
    const refreshIconSrc = chrome.runtime.getURL(`${UI_ICON_BASE_DIR}/default/refresh.png`);
    const regenBtnHtml = shouldShowRegenerate ? `<button class="panel-icon-btn" data-action="cc-regenerate-transcribe" title="重新生成"><img src="${refreshIconSrc}" style="width:16px;height:16px;object-fit:contain;transform:scale(0.9);"></button>` : "";
    const searchBoxHtml = `<div class="cc-search-container"><input type="text" id="cc-search-input" class="cc-search-input" placeholder="搜索字幕..." /><button type="button" class="cc-search-clear" aria-label="清空">×</button></div>`;
    const progressBarHtml = '';

    const controlCenterHtml = `<div class="transcription-control-center"><div class="cc-transcribe-head">${searchBoxHtml}<div class="cc-header-right"><div class="cc-transcribe-status">${escapeHtml(sourceText)}</div><div class="cc-transcribe-actions">${regenBtnHtml}</div></div></div>${(rows.length > 0 || running) ? progressBarHtml : ''}</div>`;

    if (rows.length > 0) {
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
            : ((running && transcription.statusText)
                ? escapeHtml(transcription.statusText)
                : "未检测到字幕，可开启在线转录");
            
        const capsuleHtml = `<div class="subtitle-empty-container">
            <div class="action-container">
                <p class="action-tip">${statusText}</p>
                <button id="start-groq-transcribe" class="action-btn" data-action="transcription-start" ${capsuleDisabled}>${running ? "转录中..." : (isDetectingSubtitle ? "检测中..." : "开始在线转录")}</button>
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
    const rumorsStatus = appState.tabState?.taskStatus?.rumors || "idle";
    const hasRumorsCache = !!String(rumors?.overview || "").trim() || claims.length > 0;
    
    // Sort claims by timestamp
    const sortedClaims = [...claims].sort((a, b) => {
        return (Number(a.timestamp_sec) || 0) - (Number(b.timestamp_sec) || 0);
    });

    const signature = JSON.stringify({
        overview: rumors?.overview,
        claimsLength: sortedClaims.length,
        rumorsStatus,
        rumorsSource: getTaskCacheSource(appState.cache, "rumors"),
        sessionFresh: appState.sessionGeneratedTasks.has("rumors")
    });

    if (panel.dataset.lastSignature === signature && panel.innerHTML.trim()) return;
    panel.dataset.lastSignature = signature;
    
    const isFresh = appState.sessionGeneratedTasks.has("rumors");
    const rumorsCacheTag = buildCacheTagHtml(appState.cache, ["rumors"], hasRumorsCache, rumorsStatus === "processing", isFresh);

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

        const timeLabel = formatTime(item.timestamp_sec || 0);
        
        return `
            <div class="claim-card ${statusClass}">
                <div class="claim-header">
                    <button class="claim-time-btn" data-action="seek-video" data-time="${item.timestamp_sec}">${timeLabel}</button>
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
                ${renderErrorPanel(errorView, "run-rumors")}
            `;
            return;
        }
        panel.innerHTML = `
            <div class="page-header">
                <h3>验真助手 <div class="header-tags"><span class="beta-tag">Beta</span>${rumorsCacheTag}</div></h3>
            </div>
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

    const dots = (current, total) => Array.from({ length: total }, (_, i) => `<span class="guide-dot ${i + 1 === current ? "active" : ""}"></span>`).join("");

    const actions = (hasPrev) => `
        <div class="guide-card-actions">
            <button class="guide-btn-skip" data-guide="skip">跳过引导</button>
            <div class="guide-btn-group">
                ${hasPrev ? `<button class="guide-btn-secondary" data-guide="prev">← 上一步</button>` : ""}
                <button class="guide-btn-primary" data-guide="next">
                    ${step === 2 ? "完成 ✓" : "下一步 →"}
                </button>
            </div>
        </div>
    `;

    if (step === 1) {
        highlight('[data-action="settings-open-reg"]');
        overlay.insertAdjacentHTML("beforeend", `
            <div class="guide-card">
                <div class="guide-steps-dots">${dots(1, 2)}</div>
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
                <div class="guide-steps-dots">${dots(2, 2)}</div>
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

    const card = overlay.querySelector(".guide-card");
    card?.querySelector("[data-guide='skip']")?.addEventListener("click", () => {
        closeSetupGuide();
    });
    card?.querySelector("[data-guide='prev']")?.addEventListener("click", () => {
        renderGuideStep(step - 1);
    });
    card?.querySelector("[data-guide='next']")?.addEventListener("click", () => {
        if (step < 2) {
            renderGuideStep(step + 1);
        } else {
            closeSetupGuide();
        }
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
    const promptSettings = normalizePromptSettingsState(settings.promptSettings);
    const promptMode = promptSettings.mode === "custom" ? "custom" : "guided";
    const promptSummary = String(promptSettings.custom.summary || "");
    const promptSegments = String(promptSettings.custom.segments || "");
    const promptRumors = String(promptSettings.custom.rumors || "");
    const customProtocol = String(settings.customProtocol || "openai").toLowerCase() === "claude" ? "claude" : "openai";
    const defaultOpenPage = resolveDefaultOpenPage(settings.defaultOpenPage);
    const modelScopeModelOptions = [
        "MiniMax/MiniMax-M2.5",
        "moonshotai/Kimi-K2.5",
        "GLM-5.1",
        "deepseek-ai/DeepSeek-V3.2",
        "Qwen3.5-27B"
    ];
    const currentModel = String(settings.model || "").trim();
    const isModelScopeProvider = providerKey === "modelscope";
    const modelScopeSelectValue = modelScopeModelOptions.includes(currentModel) ? currentModel : "custom";
    const modelScopeCustomVisible = isModelScopeProvider && modelScopeSelectValue === "custom" ? "" : "settings-hidden";
    const modelScopeWrapVisible = isModelScopeProvider ? "" : "settings-hidden";
    const plainModelVisible = isModelScopeProvider ? "settings-hidden" : "";
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
            <h3>Settings</h3>
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
                <input id="settings-api-key" type="password" value="${escapeHtml(settings.apiKey || "")}" placeholder="示例：sk-xxxxx">
                <div class="error-message" id="settings-api-key-error">API Key 不能包含中文或空格</div>
                <label>Model</label>
                <div id="settings-modelscope-model-wrap" class="${modelScopeWrapVisible}">
                    ${renderCustomSelect("settings-modelscope-model", [
                        ...modelScopeModelOptions.map((model) => ({ value: model, label: model })),
                        { value: "custom", label: "自定义" }
                    ], modelScopeSelectValue)}
                    <input id="settings-modelscope-custom-model" class="${modelScopeCustomVisible}" type="text" value="${escapeHtml(currentModel)}" placeholder="请输入 ModelScope 模型名">
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
                    <input id="settings-groq-api-key" type="password" value="${escapeHtml(settings.groqApiKey || "")}" placeholder="示例：gsk_xxxxx">
                    <label>ASR 模型</label>
                    <input id="settings-groq-model" type="text" value="${escapeHtml(groqModel)}" placeholder="示例：whisper-large-v3-turbo">
                </div>
                <div id="settings-asr-siliconflow-wrap" class="settings-asr-provider-fields ${siliconFlowVisible}">
                    <label>硅基流动 API Key</label>
                    <input id="settings-siliconflow-api-key" type="password" value="${escapeHtml(settings.siliconFlowApiKey || "")}" placeholder="示例：sk-xxxxx">
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
                    <span class="settings-info-icon" data-tooltip="质量：总结和分段分别生成，更准但更慢。节流：一次生成总结+分段，更省次数。">i</span>
                </label>
                ${renderCustomSelect("settings-pref-mode", [
                    { value: "quality", label: "质量模式" },
                    { value: "efficiency", label: "节流模式" }
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
                    
                    // Update selection visual
                    selectOptions.querySelectorAll(".custom-option").forEach(opt => opt.classList.remove("selected"));
                    option.classList.add("selected");
                    
                    // Trigger hints update
                    updateSettingsProviderHint(panel);

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
    const modelScopeModelSelect = panel.querySelector("#settings-modelscope-model");
    const modelScopeCustomInput = panel.querySelector("#settings-modelscope-custom-model");
    const applyModelScopeModelVisibility = () => {
        if (modelScopeCustomInput) {
            modelScopeCustomInput.classList.toggle("settings-hidden", String(modelScopeModelSelect?.value || "") !== "custom");
        }
    };
    if (modelScopeModelSelect) {
        modelScopeModelSelect.addEventListener("change", () => {
            applyModelScopeModelVisibility();
            triggerAutoSave();
        });
    }
    applyModelScopeModelVisibility();
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

    const apiKeyInput = panel.querySelector("#settings-api-key");
    const apiKeyError = panel.querySelector("#settings-api-key-error");

    const validateApiKey = () => {
        if (!apiKeyInput) return true;
        const val = apiKeyInput.value;
        const invalid = /[ \u4e00-\u9fa5]/.test(val);
        if (invalid) {
            apiKeyInput.classList.add("input-error");
            if (apiKeyError) apiKeyError.classList.add("show");
            return false;
        }
        apiKeyInput.classList.remove("input-error");
        if (apiKeyError) apiKeyError.classList.remove("show");
        return true;
    };

    const inputs = panel.querySelectorAll("input, textarea");
    inputs.forEach(input => {
        if (input.type === "range") return;
        if (input.id === "settings-api-key") {
            input.addEventListener("input", () => {
                validateApiKey();
            });
        }
        input.addEventListener("blur", () => {
            if (input.id === "settings-api-key" && !validateApiKey()) return;
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
            <button type="button" class="panel-btn ghost error-demo-clear" data-action="debug-clear-errors">清空测试状态</button>
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
            ${renderErrorDemoControls()}
            ${renderRealtimeLogPanel()}
        </div>
    `;
    bindRealtimeLogPanel(panel);
    renderRealtimeLogData();
    startRealtimeLogPolling();
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
}

async function runTasks(tasks) {
    // Check for subtitle existence before running summary or segments
    if (!canRunTasksWithCache(tasks, resolveCurrentBvid(), appState.cache)) {
        const currentBvid = resolveCurrentBvid();
        if (!currentBvid || appState.cache?.bvid !== currentBvid || !hasSubtitleInCache(appState.cache)) showToast("当前视频暂无字幕，无法生成总结");
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
        const res = await chrome.runtime.sendMessage({ action: "RUN_TASKS", tasks, force: true, taskContext });
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
    }
}

async function handleSendChat() {
    const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-chat") : null;
    const input = panel?.querySelector("#chat-input");
    const text = String(input?.value || "").trim();
    if (!text) return;
    const messageId = createChatMessageId();
    const progressTaskId = buildChatProgressTaskId(messageId);
    
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
    port.postMessage({ action: "RUN_CHAT_STREAM", text, messageId });
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
    const metricLine = `用时: ${latency} · Tokens: ${tokenStr} · 剩余次数 ${remaining}`;
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
        appState.chatPending = (appState.chatPending || []).map((item) => {
            if (item.id !== assistantId) return item;
            return { ...item, status: "done", content: `请求失败：${error}`, metrics: null };
        });
        appState.chatStreamingId = "";
        appState.chatActiveMessageId = "";
        finishAsymptoticPseudoProgress(progressTaskId, true);
        rerenderChatKeepInputAndScroll("");
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
    if (appState.chatStreamTimer) {
        clearInterval(appState.chatStreamTimer);
        appState.chatStreamTimer = null;
    }
    appState.chatGuideHidden = false;
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
    appState.progressLastTick = 0;
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
    appState.subtitleDomDetected = false;
    resetTranscriptionState();
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
    return Date.now() >= Number(appState.chatAutoScrollPausedUntil || 0);
}

function isCloudReadLoadingForCurrentVideo() {
    return isCloudReadLoadingForVideo(appState.cloudReadState, resolveCurrentBvid());
}

function shouldAttemptCloudReadForVideo(bvid) {
    return shouldAttemptCloudReadForVideoState(appState.cache, appState.cloudReadState, bvid || resolveCurrentBvid());
}

function shouldAttemptCloudReadForPage(page) {
    return shouldAttemptCloudReadForPageState(appState.cache, appState.cloudReadState, resolveCurrentBvid(), page);
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
            }
            if (res?.tabState) appState.tabState = res.tabState;
            appState.cloudReadState = createCloudReadState(target, "success", nextRequestId);
            if (cacheUpdated || !silent) renderContent();
        })
        .catch((error) => {
            if (normalizeBvidCase(appState.cloudReadState?.bvid || "") !== target) return;
            if (Number(appState.cloudReadState?.requestId || 0) !== nextRequestId) return;
            appState.cloudReadState = createCloudReadState(target, "failed", nextRequestId);
            if (!silent) renderContent();
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
    const modelScopeWrap = panel?.querySelector("#settings-modelscope-model-wrap");
    const plainModelInput = panel?.querySelector("#settings-model");
    const modelScopeSelect = panel?.querySelector("#settings-modelscope-model");
    const modelScopeCustomInput = panel?.querySelector("#settings-modelscope-custom-model");
    const customBase = String(panel?.querySelector("#settings-base-url")?.value || "").trim();
    const isCustom = key === "custom";
    const isModelScope = key === "modelscope";
    if (customWrap) customWrap.classList.toggle("settings-hidden", !isCustom);
    if (modelScopeWrap) modelScopeWrap.classList.toggle("settings-hidden", !isModelScope);
    if (plainModelInput) plainModelInput.classList.toggle("settings-hidden", isModelScope);
    if (modelScopeCustomInput) {
        modelScopeCustomInput.classList.toggle("settings-hidden", !isModelScope || String(modelScopeSelect?.value || "") !== "custom");
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
    
    // Validate API Key globally before saving
    const apiKeyInput = panel.querySelector("#settings-api-key");
    if (apiKeyInput) {
        const val = apiKeyInput.value;
        const invalid = /[ \u4e00-\u9fa5]/.test(val);
        if (invalid) {
            const apiKeyError = panel.querySelector("#settings-api-key-error");
            apiKeyInput.classList.add("input-error");
            if (apiKeyError) apiKeyError.classList.add("show");
            return;
        }
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
    const modelScopeModelValue = String(panel.querySelector("#settings-modelscope-model")?.value || "").trim();
    const resolvedModelValue = providerValue === "modelscope"
        ? (modelScopeModelValue === "custom"
            ? String(panel.querySelector("#settings-modelscope-custom-model")?.value || "").trim()
            : modelScopeModelValue)
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
    const rows = Array.isArray(appState.cache?.rawSubtitle) ? appState.cache.rawSubtitle : [];
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
    const taskStatus = appState.tabState?.taskStatus || {};
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
    if (Array.isArray(appState.cache?.rawSubtitle) && appState.cache.rawSubtitle.length) {
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
    if (Array.isArray(appState.cache?.rawSubtitle) && appState.cache.rawSubtitle.length) return;
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
    patchTranscriptionState({
        phase: "running",
        bvid,
        progress: 0,
        statusText: "正在请求转录..."
    });
    appState.transcriptionCapsuleVisible = true;
    updateProgress(10, progressTaskId);
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
            .slice(-200)
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
            ? logs.slice(-200).map(formatLogEntryLine).join("\n")
            : "暂无日志。请先在测试页或插件里触发一次操作。";
        if (status) status.textContent = `${logs.length} 条，${formatTimelineTime(Date.now())} 已刷新`;
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
    
    const isSummaryPage = appState.activePage === "summary";
    root.classList.toggle("summary-flex-mode", isSummaryPage);
    root.classList.toggle("fixed-lock-mode", !isSummaryPage);
    
    syncPluginHeight();
    if (isSummaryPage) {
        const panel = panelShadowRoot ? panelShadowRoot.getElementById("page-summary") : null;
        if (panel) requestAnimationFrame(() => applySummaryRatio(panel));
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
        const cachedSubtitleSource = String(appState.cache?.subtitleSource || "");
        if (cachedSubtitleSource) {
            appState.tabState = {
                ...(appState.tabState || {}),
                subtitleSource: cachedSubtitleSource,
                transcriptionProgress: (cachedSubtitleSource === "groq" || cachedSubtitleSource === "whisper" || cachedSubtitleSource === "siliconflow" || cachedSubtitleSource === "funasr") ? 100 : Number(appState.tabState?.transcriptionProgress || 0)
            };
        }
        if (Array.isArray(appState.cache?.rawSubtitle) && appState.cache.rawSubtitle.length) {
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
    const target = normalizeBvidCase(targetBvid || "");
    const cacheBvid = normalizeBvidCase(appState.cache?.bvid || "");
    return !!(target && cacheBvid === target && Array.isArray(appState.cache?.rawSubtitle) && appState.cache.rawSubtitle.length);
}

function reconcileTranscriptionState(targetBvid) {
    const target = normalizeBvidCase(targetBvid || resolveCurrentBvid() || "");
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
    if (!appState.isStateDirty && appState.lastCacheSyncBvid === target && now - Number(appState.lastCacheSyncTime || 0) < CACHE_SYNC_THROTTLE_MS) {
        return;
    }
    try {
        appState.lastCacheSyncTime = now;
        appState.lastCacheSyncBvid = target;
        const res = await chrome.runtime.sendMessage({ action: "GET_CACHE", bvid: target, skipCloud: true });
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
        if (res.tabState) appState.tabState = res.tabState;
        const cachedSubtitleSource = String(cache?.subtitleSource || "");
        if (cachedSubtitleSource) {
            appState.tabState = {
                ...(appState.tabState || {}),
                subtitleSource: cachedSubtitleSource,
                transcriptionProgress: (cachedSubtitleSource === "groq" || cachedSubtitleSource === "whisper" || cachedSubtitleSource === "siliconflow" || cachedSubtitleSource === "funasr") ? 100 : Number(appState.tabState?.transcriptionProgress || 0)
            };
        }
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

async function syncCacheFromBackgroundWithRetry(bvid, attempts = 6, delayMs = 250) {
    const target = normalizeBvidCase(bvid || "");
    if (!target) return false;
    for (let i = 0; i < attempts; i++) {
        const ok = await syncCacheFromBackground(target, { preserveCacheOnMiss: true });
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
        const progressTaskId = `transcribe:${normalizeBvidCase(getTranscriptionBvid() || appState.injectBvid || resolveCurrentBvid() || "unknown")}`;
        const text = String(message?.text || "").trim();
        const quotaLine = String(message?.quotaLine || "").trim();
        const isError = message?.level === "error";
        
        if (text) {
            patchTranscriptionState({ statusText: text });
        }
        if (isError) {
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
            patchTranscriptionState({
                phase: "running",
                bvid: normalizeBvidCase(message?.bvid || getTranscriptionBvid() || appState.injectBvid || resolveCurrentBvid() || ""),
                statusText: text || getTranscriptionState().statusText
            });
        }

        if (Number.isFinite(Number(message?.progress))) {
            const incomingProgress = Math.max(0, Math.min(100, Number(message.progress)));
            const nextState = patchTranscriptionState({ progress: incomingProgress });
            const progress = Math.max(incomingProgress, Number(nextState.progress || 0));
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
            const taskBvid = getTranscriptionBvid();
            const currentBvid = normalizeBvidCase(appState.injectBvid || resolveCurrentBvid() || "");
            
            if (taskBvid && currentBvid && taskBvid !== currentBvid) {
                logContent.warn("transcription_stale_result_drop", {
                    task: "asr",
                    bvid: taskBvid,
                    detail: { current_bvid: currentBvid }
                });
                resetTranscriptionState({ phase: "done", progress: 100 });
                appState.transcriptionCapsuleVisible = false;
                appState.transcriptionCapsuleMeta = null;
                appState.isStateDirty = true;
                updateProgress(100, progressTaskId);
                return;
            }
            
            resetTranscriptionState({ phase: "done", progress: 100 });
            appState.transcriptionCapsuleVisible = false;
            appState.transcriptionCapsuleMeta = null;
            appState.isStateDirty = true;
            updateProgress(100, progressTaskId);
            
            const targetBvid = normalizeBvidCase(message?.bvid || currentBvid || "");
            syncCacheFromBackgroundWithRetry(targetBvid).then(() => renderContent());
            renderSubtitleTimelinePanel(document.getElementById("panel-body"));
        }
        if (message?.stage !== "done" && message?.level !== "error") {
            const msgBvid = normalizeBvidCase(message?.bvid || "");
            const currentBvid = normalizeBvidCase(appState.injectBvid || resolveCurrentBvid() || "");
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
        appState.tabState = message.tabState;
        syncStepProgressByTaskState(appState.tabState);
    }
    const cache = message?.cache || null;
    if (cache && payloadBvid && normalizeBvidCase(cache?.bvid || "") !== payloadBvid) return false;
    appState.pendingSubtitle = null;
    renderNav();
    const messageCacheBvid = normalizeBvidCase(cache?.bvid || "");
    appState.cache = cache && (!routeBvid || messageCacheBvid === routeBvid) ? cache : null;
    if (cache?.rawSubtitle?.length) {
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
    const isDebugMode = !!appState.settings?.debugMode;
    if (!isDebugMode) {
        if (oldNode) oldNode.remove();
        return;
    }
    const timelineRows = Array.isArray(appState.subtitleTimeline) ? appState.subtitleTimeline : [];
    const rows = timelineRows.slice(-12).reverse();
    const hadFocus = (panelShadowRoot && panelShadowRoot.activeElement && panelShadowRoot.activeElement.id === "subtitle-search");
    const activeInput = hadFocus ? panelShadowRoot.activeElement : null;
    const activeSelectionStart = activeInput ? Number(activeInput.selectionStart || 0) : 0;
    const activeSelectionEnd = activeInput ? Number(activeInput.selectionEnd || 0) : 0;
    const section = oldNode || document.createElement("section");
    section.className = "panel-section subtitle-timeline-panel";
    if (!oldNode) {
        section.innerHTML = `<div class="section-head"><h3>时序</h3><div class="timeline-search-box"><input type="text" id="subtitle-search" /><button type="button" id="clear-search" class="timeline-search-clear clear-btn" aria-label="清空">×</button></div></div><div class="subtitle-timeline-list"></div>`;
        panel.appendChild(section);
    }
    const searchInput = section.querySelector("#subtitle-search");
    const clearButton = section.querySelector("#clear-search");
    const listContainer = section.querySelector(".subtitle-timeline-list");
    if (!searchInput || !clearButton || !listContainer) return;
    const currentTerm = String(appState.timelineSearchTerm || "");
    if (searchInput.value !== currentTerm) searchInput.value = currentTerm;
    const renderListOnly = (rawTerm) => {
        const term = String(rawTerm || "");
        appState.timelineSearchTerm = term;
        clearButton.classList.toggle("visible", term.length > 0);
        const logsHtml = renderTimelineRowsHtml(timelineRows, term);
        listContainer.innerHTML = `<div class="timeline-logs-container">${logsHtml}</div>`;
    };
    renderListOnly(currentTerm);
    searchInput.oninput = () => {
        const nextTerm = String(searchInput.value || "");
        if (appState.timelineSearchDebounceTimer) {
            clearTimeout(appState.timelineSearchDebounceTimer);
            appState.timelineSearchDebounceTimer = null;
        }
        appState.timelineSearchDebounceTimer = setTimeout(() => {
            appState.timelineSearchDebounceTimer = null;
            renderListOnly(nextTerm);
        }, 100);
    };
    clearButton.onclick = () => {
        if (appState.timelineSearchDebounceTimer) {
            clearTimeout(appState.timelineSearchDebounceTimer);
            appState.timelineSearchDebounceTimer = null;
        }
        searchInput.value = "";
        renderListOnly("");
        searchInput.focus();
    };
    if (hadFocus) {
        searchInput.focus();
        if (typeof searchInput.setSelectionRange === "function") {
            const max = String(searchInput.value || "").length;
            const start = Math.max(0, Math.min(max, activeSelectionStart));
            const end = Math.max(0, Math.min(max, activeSelectionEnd));
            searchInput.setSelectionRange(start, end);
        }
    }
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
