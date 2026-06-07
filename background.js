import SubtitleProcessor from "./utils/subtitleProcessor.js";
import { robustJSONParse } from "./utils/jsonParse.js";
import { callAI, callAIStream, PROVIDERS } from "./utils/providerAdapter.js";
import {
    buildGroqQuotaLine,
    buildGroqTranscriptionPrompt,
    parseGroqQuotaHeaders,
    parseRetryAfterSeconds
} from "./utils/asrTranscription.js";
import {
    DEFAULT_PROMPT_SETTINGS,
    SEGMENTS_AD_TEST_PROMPT,
    buildCompactSegmentsPrompt,
    buildSegmentsAdTestPrompt,
    buildMergedSummarySegmentsPrompt,
    buildPrompt,
    extractFirstProtocolSection,
    extractProtocolSection,
    normalizePromptSettings
} from "./utils/promptBuilder.js";
import { normalizeRumors as normalizeRumorsResult, normalizeSegments as normalizeSegmentsResult } from "./utils/resultNormalize.js";
import { reportToSentry } from "./utils/sentryReporter.js";
import { createAppError, createHttpError, serializeAppError } from "./utils/appError.js";
import { isSupabaseEnabled, supabaseRpc, supabaseSelect, supabaseWrite } from "./utils/supabaseClient.js";
import "./logger.js";

let IS_DEBUG_MODE = false;
const cacheWriteLocks = new Map();
const TIMEOUT_ERROR_CODES = new Set([
    "TIMEOUT",
    "AI_RESPONSE_TIMEOUT",
    "AI_STREAM_TIMEOUT",
    "ASR_REQUEST_TIMEOUT",
    "NETWORK_REQUEST_TIMEOUT"
]);
const STREAM_INITIAL_RETRY_DELAY_MS = 700;



function syncRuntimeDebugFlag(enabled) {
    IS_DEBUG_MODE = !!enabled;
    globalThis.AIPluginLogger?.setDebugEnabled?.(!!enabled);
}

async function captureBackgroundError(errorInput, context = {}) {
    try {
        const settings = await getResolvedSettings();
        const runtime = await getSentryRuntimeContext();
        return await reportToSentry(settings, errorInput, context, runtime);
    } catch (_) {
        return { sent: false, reason: "report_failed" };
    }
}

function attachSentryContext(errorInput, context = {}) {
    if (!errorInput || typeof errorInput !== "object") return errorInput;
    errorInput.sentryContext = {
        ...(errorInput.sentryContext && typeof errorInput.sentryContext === "object" ? errorInput.sentryContext : {}),
        ...(context && typeof context === "object" ? context : {})
    };
    return errorInput;
}

async function captureTaskFailureToSentry(errorInput, context = {}) {
    if (!errorInput || typeof errorInput !== "object") return { sent: false, reason: "invalid_error" };
    if (errorInput.__sentryCaptured) return { sent: false, reason: "already_captured" };
    const baseContext = {
        ...(errorInput.sentryContext && typeof errorInput.sentryContext === "object" ? errorInput.sentryContext : {}),
        ...(context && typeof context === "object" ? context : {})
    };
    const mergedContext = await enrichTaskFailureContext(baseContext);
    errorInput.__sentryCaptured = true;
    return captureBackgroundError(errorInput, mergedContext);
}

function isTimeoutError(errorInput) {
    const code = String(errorInput?.code || "").trim();
    return TIMEOUT_ERROR_CODES.has(code);
}

function buildAIResponseSentryContext({
    task,
    bvid,
    provider,
    model,
    mode,
    source,
    responseText,
    metrics,
    extra = {}
} = {}) {
    return {
        task: String(task || ""),
        bvid: String(bvid || ""),
        provider: String(provider || ""),
        model: String(model || ""),
        source: String(source || "ai_parse_failure"),
        ai_response_mode: String(mode || ""),
        ai_response_raw: String(responseText || ""),
        ...getSegmentsResponseDiagnostics(responseText, metrics),
        ...(extra && typeof extra === "object" ? extra : {})
    };
}

function buildProviderRequestTelemetry(settings, timeoutMs, options = {}) {
    return {
        provider: String(settings?.provider || ""),
        model: String(settings?.model || ""),
        pref_mode: String(settings?.prefMode || ""),
        segment_variant: String(settings?.segmentPromptVariant || ""),
        custom_protocol: String(settings?.customProtocol || ""),
        is_custom_provider: String(settings?.provider || "").toLowerCase() === "custom",
        timeout_ms: Number(timeoutMs || 0) || undefined,
        request_stream: !!options.stream,
        request_entry: options.stream ? "callAIStream" : "callAI",
        request_phase: options.requestPhase || "provider_request",
        bypass_queue: !!options.bypassQueue,
        queue_size_at_start: Number(options.queueSizeAtStart || 0),
        active_count_at_start: Number(options.activeCountAtStart || 0),
        elapsed_ms: Number(options.elapsedMs || 0) || undefined,
        first_response_received: options.firstResponseReceived === undefined ? undefined : !!options.firstResponseReceived
    };
}

function shouldRetryInitialStreamFailure(error, firstResponseReceived, attempt, maxAttempts) {
    return String(error?.code || "") === "PROVIDER_NETWORK_ERROR"
        && !firstResponseReceived
        && attempt < maxAttempts;
}

function decorateStreamRetryMetadata(error, attempt, maxAttempts, retryDelaysMs = []) {
    if (!error || typeof error !== "object") return error;
    error.requestAttempt = Number(attempt || 0);
    error.requestMaxAttempts = Number(maxAttempts || 0);
    error.retryDelaysMs = Array.isArray(retryDelaysMs) ? [...retryDelaysMs] : [];
    error.retryStrategy = "stream_initial_network_backoff";
    return error;
}

function waitForAbortableDelay(delayMs, signal) {
    if (!delayMs) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let timeoutId = 0;
        let cleanup = () => {};
        const handleAbort = () => {
            cleanup();
            reject(createUserAbortedError());
        };
        cleanup = () => {
            clearTimeout(timeoutId);
            signal?.removeEventListener?.("abort", handleAbort);
        };
        timeoutId = setTimeout(() => {
            cleanup();
            resolve();
        }, delayMs);
        if (signal?.aborted) {
            handleAbort();
            return;
        }
        signal?.addEventListener?.("abort", handleAbort, { once: true });
    });
}

async function enrichTaskFailureContext(context = {}) {
    const merged = context && typeof context === "object" ? { ...context } : {};
    const taskContext = merged.taskContext && typeof merged.taskContext === "object" ? merged.taskContext : {};
    const bvid = normalizeBvid(merged.bvid);
    if (!bvid) {
        return { ...merged, ...buildSubtitleStatsContext(null, taskContext) };
    }
    try {
        const cache = await getCache(bvid);
        return { ...merged, ...buildSubtitleStatsContext(cache, taskContext) };
    } catch (_) {
        return { ...merged, ...buildSubtitleStatsContext(null, taskContext) };
    }
}

function buildSubtitleStatsContext(cache = {}, taskContext = {}) {
    const rawRows = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    const processedRows = Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle : [];
    const rows = rawRows.length ? rawRows : processedRows;
    const subtitleTotalChars = rows.reduce((sum, row) => sum + String(row?.text || "").length, 0);
    const taskDuration = taskContext?.videoDuration && typeof taskContext.videoDuration === "object"
        ? taskContext.videoDuration
        : {};
    const videoDurationSec = Number(taskDuration.totalSeconds) > 0
        ? Math.floor(Number(taskDuration.totalSeconds))
        : Math.floor(resolveVideoDurationFromCache(cache));
    return removeEmptyValues({
        video_duration_sec: videoDurationSec > 0 ? videoDurationSec : undefined,
        video_duration_text: String(taskDuration.formattedTime || "").trim() || undefined,
        subtitle_line_count: rows.length || undefined,
        subtitle_total_chars: subtitleTotalChars || undefined
    });
}

function resolveVideoDurationFromCache(cache = {}) {
    const rows = Array.isArray(cache?.rawSubtitle) && cache.rawSubtitle.length
        ? cache.rawSubtitle
        : (Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle : []);
    let maxSec = 0;
    rows.forEach((row) => {
        const end = Number(row?.end);
        const start = Number(row?.start);
        const candidate = Number.isFinite(end) && end > 0
            ? end
            : (Number.isFinite(start) && start > 0 ? start : 0);
        if (candidate > maxSec) maxSec = candidate;
    });
    return maxSec;
}

function removeEmptyValues(value = {}) {
    return Object.fromEntries(
        Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== "")
    );
}

function shouldCaptureRuntimeMessageError(msg, error) {
    const action = String(msg?.action || "").trim();
    if (action === "RUN_TASKS") return false;
    return true;
}

async function getSentryRuntimeContext() {
    let platform = {};
    try {
        if (chrome?.runtime?.getPlatformInfo) {
            platform = await chrome.runtime.getPlatformInfo();
        }
    } catch (_) {}
    const manifest = chrome.runtime.getManifest();
    return {
        extensionVersion: manifest.version || "",
        manifestVersion: manifest.manifest_version || 3,
        language: navigator.language || "",
        userAgent: navigator.userAgent || "",
        platform
    };
}

function createFeedbackClientId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function getFeedbackClientId() {
    const key = "feedbackClientId";
    const stored = await chrome.storage.local.get([key]);
    const existing = String(stored?.[key] || "").trim();
    if (existing.length >= 16) return existing;
    const next = createFeedbackClientId();
    await chrome.storage.local.set({ [key]: next });
    return next;
}

function getFeedbackHeaders(clientId) {
    return { "x-feedback-client-id": String(clientId || "") };
}

function sanitizeFeedbackText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
}

function normalizeFeedbackRow(row = {}) {
    return {
        id: String(row.id || ""),
        type: String(row.type || "bug"),
        title: String(row.title || ""),
        content: String(row.content || ""),
        status: String(row.status || "open"),
        reply: String(row.reply || ""),
        bvid: String(row.bvid || ""),
        createdAt: String(row.created_at || ""),
        updatedAt: String(row.updated_at || ""),
        seenAt: String(row.seen_at || "")
    };
}

function isFeedbackDiagnosticLog(entry = {}) {
    const level = String(entry.level || "").toLowerCase();
    if (level === "warn" || level === "error") return true;
    const event = String(entry.event || "").toLowerCase();
    const code = String(entry.code || "").toLowerCase();
    return /error|failed|fail|timeout|exception|abort|denied|invalid/.test(event)
        || /error|failed|fail|timeout|exception|abort|denied|invalid/.test(code);
}

function getFeedbackUnreadCount(rows = []) {
    return rows.filter((row) => {
        const updatedAt = Date.parse(row.updatedAt || "");
        const seenAt = Date.parse(row.seenAt || "");
        if (!Number.isFinite(updatedAt)) return false;
        return !Number.isFinite(seenAt) || updatedAt > seenAt + 1000;
    }).length;
}

async function fetchFeedbackState(settings, { markSeen = false } = {}) {
    if (!isSupabaseEnabled(settings)) {
        return { rows: [], unreadCount: 0, clientId: "", enabled: false };
    }
    const clientId = await getFeedbackClientId();
    const table = settings.supabaseFeedbackTable || SUPABASE_DEFAULT_FEEDBACK_TABLE;
    let rows = [];
    try {
        rows = await supabaseSelect(settings, table, {
            select: "id,type,title,content,status,reply,bvid,created_at,updated_at,seen_at",
            client_id: `eq.${clientId}`,
            order: "updated_at.desc",
            limit: 20
        }, {
            headers: getFeedbackHeaders(clientId),
            requestName: "feedback_select",
            errorMessage: "读取反馈失败"
        });
    } catch (error) {
        logBackground.warn("feedback_select_unavailable", {
            task: "feedback",
            code: error?.code || "",
            detail: {
                error_message: error?.message || "读取反馈失败"
            }
        });
        return {
            rows: [],
            unreadCount: 0,
            clientId,
            enabled: false,
            errorText: "反馈服务暂时不可用",
            statusText: ""
        };
    }
    const normalizedRows = rows.map(normalizeFeedbackRow);
    if (markSeen && normalizedRows.length) {
        const seenAt = new Date().toISOString();
        try {
            await supabaseWrite(settings, table, { seen_at: seenAt }, {
                method: "PATCH",
                params: { client_id: `eq.${clientId}` },
                headers: getFeedbackHeaders(clientId),
                requestName: "feedback_mark_seen",
                errorMessage: "标记反馈已读失败"
            });
            normalizedRows.forEach((row) => {
                row.seenAt = seenAt;
            });
        } catch (error) {
            logBackground.warn("feedback_mark_seen_unavailable", {
                task: "feedback",
                code: error?.code || "",
                detail: {
                    error_message: error?.message || "标记反馈已读失败"
                }
            });
        }
    }
    return {
        rows: normalizedRows,
        unreadCount: getFeedbackUnreadCount(normalizedRows),
        clientId,
        enabled: true,
        errorText: "",
        statusText: ""
    };
}

async function submitFeedbackFromContent(msg, sender) {
    const settings = await getResolvedSettings();
    if (!isSupabaseEnabled(settings)) throw new Error("反馈服务暂不可用，请稍后重试");
    const clientId = await getFeedbackClientId();
    const tabId = msg.tabId || sender?.tab?.id || 0;
    const tabState = tabId ? await getTabState(tabId).catch(() => null) : null;
    const manifest = chrome.runtime.getManifest();
    const type = ["bug", "suggestion", "question"].includes(String(msg.type || "bug")) ? String(msg.type || "bug") : "bug";
    const title = sanitizeFeedbackText(msg.title, 120);
    const content = sanitizeFeedbackText(msg.content, 3000);
    if (!title) throw new Error("请填写反馈标题");
    if (!content) throw new Error("请填写反馈内容");
    const includeLogs = msg.includeLogs !== false;
    const contentLogs = Array.isArray(msg.logs) ? msg.logs.filter(isFeedbackDiagnosticLog).slice(-80) : [];
    const backgroundLogs = globalLogs.filter(isFeedbackDiagnosticLog).slice(-120);
    const logs = includeLogs ? [...backgroundLogs, ...contentLogs].slice(-160) : null;
    const now = new Date().toISOString();
    const table = settings.supabaseFeedbackTable || SUPABASE_DEFAULT_FEEDBACK_TABLE;
    await supabaseWrite(settings, table, {
        client_id: clientId,
        extension_version: manifest.version || "",
        provider: String(settings.provider || ""),
        model: getTaskModelName(settings),
        bvid: normalizeBvid(msg.bvid || tabState?.activeBvid || ""),
        type,
        title,
        content,
        logs,
        metadata: {
            tab_id: tabId || 0,
            url: sender?.tab?.url || "",
            user_agent: navigator.userAgent || ""
        },
        seen_at: now
    }, {
        headers: getFeedbackHeaders(clientId),
        requestName: "feedback_submit",
        errorMessage: "提交反馈失败"
    });
    return fetchFeedbackState(settings);
}

const MAX_GLOBAL_CONCURRENCY = 1;
const TASK_TIMEOUT_MS = 60000;
const EFFICIENCY_TASK_TIMEOUT_MS = 120000;
const MAX_SUBTITLE_CHARS = 36000;
const MAX_SEGMENTS_SUBTITLE_CHARS = 120000;
const GROQ_AUDIO_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const SILICONFLOW_AUDIO_TRANSCRIBE_URL = "https://api.siliconflow.cn/v1/audio/transcriptions";
const GROQ_MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const SILICONFLOW_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_HEADER_RULE_ID = 910001;
const BILI_PLAYURL_API = "https://api.bilibili.com/x/player/playurl";
const SUPABASE_DEFAULT_VIDEO_CACHE_TABLE = "video_cache";
const SUPABASE_DEFAULT_FEEDBACK_TABLE = "feedback";
const SUPABASE_DEFAULT_USAGE_DAILY_RPC = "increment_feature_usage_daily";
const DEFAULT_SENTRY_DSN = "https://04879b2bd5fc72eba741a402e26c4790@o4511384082055168.ingest.de.sentry.io/4511384299634768";
const TASK_KEYS = ["summary", "segments", "rumors"];
const CLOUD_CACHE_KEYS = ["subtitle", ...TASK_KEYS];
const CLOUD_TASK_FIELD_MAP = {
    summary: ["summary", "summary_model", "summary_upvotes", "summary_downvotes"],
    segments: ["segments", "segments_model", "segments_upvotes", "segments_downvotes"],
    rumors: ["rumors", "rumors_model", "rumors_upvotes", "rumors_downvotes"]
};
const DEFAULT_SETTINGS = {
    provider: "modelscope",
    model: "moonshotai/Kimi-K2.5",
    apiKey: "",
    providerApiKeys: {},
    providerModels: {},
    customBaseUrl: "",
    customModel: "",
    customProtocol: "openai",
    asrProvider: "groq",
    groqApiKey: "",
    groqModel: "whisper-large-v3-turbo",
    siliconFlowApiKey: "",
    siliconFlowAsrModel: "FunAudioLLM/SenseVoiceSmall",
    supabaseUrl: "https://qdksdauixnbgrgkilgac.supabase.co",
    supabaseAnonKey: "sb_publishable_55zwbZc_sQ0k4EDJBgpxsQ_1F86l1vT",
    supabaseVideoCacheTable: SUPABASE_DEFAULT_VIDEO_CACHE_TABLE,
    supabaseFeedbackTable: SUPABASE_DEFAULT_FEEDBACK_TABLE,
    supabaseUsageDailyRpcName: SUPABASE_DEFAULT_USAGE_DAILY_RPC,
    prefMode: "quality",
    segmentPromptVariant: "test",
    debugMode: false,
    sentryEnabled: true,
    sentryDsn: DEFAULT_SENTRY_DSN
};

const queue = [];
let activeCount = 0;
const inFlight = new Map();
const globalLogs = [];
const MAX_LOGS = 2000;
const lastSubtitleSync = new Map();
const chatAbortControllers = new Map();
const tabOperationAbortControllers = new Map();
const tabStateCache = new Map();
const tabStateWriteTimers = new Map();
const cacheMemory = new Map();
const recentAsrAudioFingerprints = new Map();
let currentDebugMode = false;
const fallbackLoggerFactory = {
    create() {
        return {
            info() {},
            warn() {},
            error() {},
            debug() {}
        };
    }
};
const loggerFactory = globalThis.AIPluginLogger?.create ? globalThis.AIPluginLogger : fallbackLoggerFactory;
const logBackground = loggerFactory.create("background", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});
const logAI = loggerFactory.create("ai", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});
const logCache = loggerFactory.create("cache", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});
const logDownload = loggerFactory.create("download", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});
const logASR = loggerFactory.create("asr", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});
const logSubtitle = loggerFactory.create("subtitle", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});

function isSegmentPromptTestEnabled(settings = {}) {
    return String(settings?.segmentPromptVariant || DEFAULT_SETTINGS.segmentPromptVariant || "test").toLowerCase() !== "original";
}

function createMissingSubtitleError(message = "无字幕可供分析") {
    return createAppError("MISSING_SUBTITLE", message);
}

function registerTabAbortController(tabId, controller) {
    const id = Number(tabId || 0);
    if (!id || !controller) return () => {};
    const set = tabOperationAbortControllers.get(id) || new Set();
    set.add(controller);
    tabOperationAbortControllers.set(id, set);
    return () => {
        const current = tabOperationAbortControllers.get(id);
        if (!current) return;
        current.delete(controller);
        if (!current.size) tabOperationAbortControllers.delete(id);
    };
}

function abortTabOperations(tabId, reason = "aborted") {
    const id = Number(tabId || 0);
    if (!id) return 0;
    let count = 0;
    const set = tabOperationAbortControllers.get(id);
    if (set) {
        [...set].forEach((controller) => {
            try {
                controller.abort(reason);
                count += 1;
            } catch (_) {}
        });
        tabOperationAbortControllers.delete(id);
    }
    [...chatAbortControllers.entries()].forEach(([key, controller]) => {
        if (!String(key).startsWith(`${id}:`)) return;
        try {
            controller.abort(reason);
            count += 1;
        } catch (_) {}
        chatAbortControllers.delete(key);
    });
    return count;
}

syncDebugModeFromStorage();

chrome.runtime.onInstalled.addListener(async () => {
    const { settings } = await chrome.storage.local.get(["settings"]);
    const normalized = normalizeSettings(settings);
    await chrome.storage.local.set({ settings: normalized });
    const promptSettings = await getPromptSettingsFromSync();
    await chrome.storage.sync.set({ promptSettings });
    currentDebugMode = !!normalized.debugMode;
    syncRuntimeDebugFlag(currentDebugMode);
    logBackground.info("storage_update", { source: "on_installed", debug_mode: currentDebugMode });
});

chrome.tabs.onRemoved?.addListener((tabId) => {
    abortTabOperations(tabId, "aborted");
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo?.status === "loading") {
        abortTabOperations(tabId, "aborted");
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    logBackground.debug("storage_listener_trigger", { keys: Object.keys(changes || {}) });
    if (changes.settings?.newValue) {
        currentDebugMode = !!changes.settings.newValue.debugMode;
        syncRuntimeDebugFlag(currentDebugMode);
    }
    Object.keys(changes || {}).forEach((key) => {
        const change = changes[key];
        if (!change) return;
        if (key.startsWith("tabState_")) {
            if (change.newValue) tabStateCache.set(key, cloneData(change.newValue));
            else tabStateCache.delete(key);
            return;
        }
        if (key.startsWith("cache_")) {
            const bvid = normalizeBvid(key.replace(/^cache_/i, ""));
            if (!bvid) return;
            if (change.newValue) cacheMemory.set(bvid, cloneData(change.newValue));
            else cacheMemory.delete(bvid);
        }
    });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => {
            if (shouldCaptureRuntimeMessageError(msg, error)) {
                captureBackgroundError(error, {
                    source: "runtime_message",
                    action: msg?.action || "",
                    tabId: sender?.tab?.id || 0
                });
            } else {
                logBackground.debug("runtime_message_capture_skipped", {
                    action: msg?.action || "",
                    code: error?.code || "",
                    message: error?.message || "unknown"
                });
            }
            sendResponse({ ok: false, error: error.message || "未知错误", ...serializeAppError(error) });
        });
    return true;
});

chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== "chat-stream") return;
    port.onMessage.addListener((msg) => {
        if (msg?.action === "ABORT_CHAT_STREAM") {
            abortChatForPort(port, msg);
            return;
        }
        if (msg?.action !== "RUN_CHAT_STREAM") return;
        runChatForPort(port, msg).catch((error) => {
            captureBackgroundError(error, {
                source: "chat_stream_port",
                task: "chat",
                messageId: msg?.messageId || ""
            });
            safePortPost(port, {
                type: "error",
                messageId: String(msg?.messageId || ""),
                error: error.message || "聊天失败",
                ...serializeAppError(error)
            });
        });
    });
});

globalThis.addEventListener?.("error", (event) => {
    captureBackgroundError(event.error || event.message, {
        source: "background_global_error",
        task: "global_error"
    });
});

globalThis.addEventListener?.("unhandledrejection", (event) => {
    captureBackgroundError(event.reason || "Unhandled rejection", {
        source: "background_unhandled_rejection",
        task: "global_rejection"
    });
});

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current) {
        if (delta.state.current === "interrupted") {
            logDownload.error("download_interrupted", {
                task: "download",
                code: "DOWNLOAD_INTERRUPTED",
                detail: {
                    download_id: delta.id,
                    reason: delta.error?.current || "unknown"
                }
            });
        } else if (delta.state.current === "complete") {
            logDownload.info("download_complete", {
                task: "download",
                detail: { download_id: delta.id }
            });
        } else {
            logDownload.debug("download_state_changed", {
                task: "download",
                detail: {
                    download_id: delta.id,
                    state: delta.state.current
                }
            });
        }
    }
});

async function handleMessage(msg, sender) {
    if (msg.action === "REPORT_ERROR") {
        await captureBackgroundError(msg.error || "Content error", {
            ...(msg.context || {}),
            source: msg.context?.source || "content_report",
            tabId: sender?.tab?.id || 0
        });
        return {};
    }
    if (msg.action === "DOWNLOAD_STREAM") {
        const { url, filename } = msg.payload || {};
        const tabId = msg.tabId || sender.tab?.id;
        if (!url) throw new Error("URL is required");
        const settings = await getResolvedSettings();
        const startedAt = Date.now();
        const urlMeta = getUrlMeta(url);
        const fileExt = getFileExtension(filename || "download.mp4");
        logDownload.info("download_chrome_api_start", {
            task: "download",
            source: "background",
            detail: {
                tab_id: tabId || 0,
                has_url: !!url,
                url_host: urlMeta.host,
                file_ext: fileExt,
                save_as: true,
                conflict_action: "uniquify"
            }
        });

        try {
            const status = await probeUrlStatus(url);
            if (status !== "ok") {
                const error = createAppError(
                    "DOWNLOAD_URL_UNVERIFIED",
                    status === "expired" ? "下载链接已失效，请刷新后重试" : "下载链接无法确认有效，请刷新后重试"
                );
                error.status = status;
                throw error;
            }
            await ensureDownloadHeaderRule(url);
            const downloadId = await chrome.downloads.download({
                url: url,
                filename: filename || "download.mp4",
                saveAs: true
            });
            if (!downloadId && chrome.runtime.lastError) {
                throw new Error(chrome.runtime.lastError.message);
            }
            logDownload.info("download_chrome_api_success", {
                task: "download",
                source: "background",
                detail: {
                    tab_id: tabId || 0,
                    download_id: downloadId,
                    file_ext: fileExt,
                    url_host: urlMeta.host
                }
            });
            return { success: true, downloadId };

        } catch (error) {
            const tabState = tabId ? await getTabState(tabId) : null;
            const usageContext = await getUsageVideoContext(tabState?.activeBvid || "", {
                title: tabState?.title || ""
            });
            await reportDailyFeatureUsage("download", settings, {
                durationMs: Date.now() - startedAt,
                tokens: 0
            }, resolveUsageStatusByError(error), resolveUsageErrorCode(error, "DOWNLOAD_CHROME_API_FAILED"), usageContext);
            logDownload.error("download_chrome_api_failed", {
                task: "download",
                source: "background",
                code: "DOWNLOAD_CHROME_API_FAILED",
                detail: {
                    tab_id: tabId || 0,
                    url_host: urlMeta.host,
                    file_ext: fileExt,
                    reason: error.message || "download failed"
                }
            });
            throw error;
        }
    }
    if (msg.action === "PROBE_URL") {
        const url = String(msg?.payload?.url || "").trim();
        if (!url) return { status: "unknown" };
        const status = await probeUrlStatus(url);
        return { status };
    }
    if (msg.action === "GET_COMPAT_PLAYURL") {
        if (!sender.tab?.id && !msg.tabId) throw new Error("tabId 缺失");
        const result = await getCompatPlayUrlForTab(msg.tabId || sender.tab.id, msg.payload || {});
        return result;
    }
    if (msg.action === "LOG_ENTRY") {
        if (msg.entry && typeof msg.entry === "object") {
            pushGlobalLog(msg.entry);
        }
        return {};
    }
    if (msg.action === "GET_LOGS") {
        return { logs: [...globalLogs] };
    }
    if (msg.action === "CLEAR_LOGS") {
        globalLogs.length = 0;
        return { cleared: true };
    }
    if (msg.action === "GET_FEEDBACK") {
        const settings = await getResolvedSettings();
        return { feedback: await fetchFeedbackState(settings, { markSeen: !!msg.markSeen }) };
    }
    if (msg.action === "SUBMIT_FEEDBACK") {
        return { feedback: await submitFeedbackFromContent(msg, sender) };
    }
    if (msg.action === "MARK_FEEDBACK_SEEN") {
        const settings = await getResolvedSettings();
        return { feedback: await fetchFeedbackState(settings, { markSeen: true }) };
    }
    if (msg.action === "SET_RUNTIME_DEBUG") {
        currentDebugMode = !!msg.enabled;
        syncRuntimeDebugFlag(currentDebugMode);
        if (currentDebugMode) {
            logBackground.info("runtime_debug_enabled", {
                task: "debug",
                detail: { source: msg.source || "content" }
            });
        }
        return { enabled: currentDebugMode };
    }
    const tabId = msg.tabId || sender.tab?.id;
    if (msg.action === "SUBTITLE_CAPTURED") {
        await handleSubtitleCaptured(tabId, msg.payload);
        return {};
    }
    if (msg.action === "RUN_TRANSCRIBE_FALLBACK" || msg.action === "GET_AUDIO_URL") {
        if (!tabId) throw new Error("tabId 缺失");
        const result = await ContentProvider.transcribeFallback(tabId, msg.payload || {});
        return result;
    }
    if (msg.action === "ABORT_TAB_OPERATIONS") {
        const count = abortTabOperations(tabId, "aborted");
        if (tabId) {
            await setTaskStatus(tabId, TASK_KEYS, "idle").catch(() => {});
            await updateTabState(tabId, { transcriptionProgress: 0, updatedAt: Date.now() }).catch(() => {});
        }
        logBackground.info("tab_operations_aborted", { tab_id: tabId || 0, detail: { controller_count: count } });
        return { aborted: count };
    }
    if (msg.action === "CLEAR_SUBTITLE_CACHE") {
        const bvid = normalizeBvid(msg.bvid);
        if (!bvid) return {};
        await mergeCacheByBvid(bvid, {
            rawSubtitle: [],
            processedSubtitle: [],
            rawHash: "",
            processedHash: "",
            updatedAt: Date.now()
        });
        if (tabId) {
            await updateTabState(tabId, {
                subtitleSource: "",
                transcriptionProgress: 0,
                updatedAt: Date.now()
            });
        }
        return {};
    }
    if (msg.action === "GET_BOOTSTRAP") {
        if (!tabId) return { tabState: null, cache: null };
        const tabState = await getTabState(tabId);
        const settings = await getResolvedSettings();
        if (tabState?.activeBvid && msg?.skipCloud !== true) {
            await hydrateCloudCacheIfNeeded(tabState.activeBvid, CLOUD_CACHE_KEYS, settings);
        }
        const cache = tabState?.activeBvid ? await getCache(tabState.activeBvid) : null;
        const feedback = await fetchFeedbackState(settings).catch(() => ({ rows: [], unreadCount: 0, enabled: false }));
        return { tabId, tabState, cache, settings, providers: PROVIDERS, feedback };
    }
    if (msg.action === "GET_CACHE") {
        const expected = normalizeBvid(msg.bvid);
        if (!expected) {
            if (!tabId) return { bvid: "", cache: null, tabState: null };
            const tabState = await getTabState(tabId);
            const bvid = normalizeBvid(tabState?.activeBvid);
            const settings = await getResolvedSettings();
            if (bvid && msg?.skipCloud !== true) {
                await hydrateCloudCacheIfNeeded(bvid, CLOUD_CACHE_KEYS, settings);
            }
            const cache = bvid ? await getCache(bvid) : null;
            return { bvid, cache, tabState };
        }
        const settings = await getResolvedSettings();
        if (msg?.skipCloud !== true) {
            await hydrateCloudCacheIfNeeded(expected, CLOUD_CACHE_KEYS, settings);
        }
        const cache = await getCache(expected);
        const tabState = tabId ? await getTabState(tabId) : null;
        return { bvid: expected, cache, tabState };
    }
    if (msg.action === "RUN_TASKS") {
        if (!tabId) throw new Error("tabId 缺失");
        const tasks = Array.isArray(msg.tasks) ? msg.tasks.filter((task) => TASK_KEYS.includes(task)) : [];
        if (!tasks.length) throw new Error("任务为空");
        const requestedBvid = normalizeBvid(msg.bvid);
        logBackground.info("task_enqueue", { tab_id: tabId, bvid: requestedBvid, tasks, force: msg.force !== false });
        await runTasksForTab(tabId, tasks, msg.force !== false, normalizeTaskContext(msg.taskContext), requestedBvid);
        return {};
    }
    if (msg.action === "RUN_CHAT") {
        if (!tabId) throw new Error("tabId 缺失");
        const text = String(msg.text || "").trim();
        const messageId = String(msg.messageId || "");
        if (!text || !messageId) throw new Error("聊天参数不完整");
        const result = await runChatForTab(tabId, text, messageId, normalizeBvid(msg.bvid));
        return { answer: result.answer, metrics: result.metrics };
    }
    if (msg.action === "ABORT_TRANSCRIPTION") {
        const count = abortTabOperations(tabId, "aborted");
        if (tabId) await updateTabState(tabId, { transcriptionProgress: 0, updatedAt: Date.now() }).catch(() => {});
        logBackground.info("transcription_aborted", { tab_id: tabId || 0, detail: { controller_count: count } });
        return { aborted: count };
    }
    if (msg.action === "SAVE_SETTINGS") {
        const incoming = msg.settings || {};
        const merged = await mergeSettings(incoming);
        currentDebugMode = !!merged.debugMode;
        syncRuntimeDebugFlag(currentDebugMode);
        logBackground.info("storage_update", { source: "save_settings", debug_mode: currentDebugMode });
        return { settings: merged };
    }
    if (msg.action === "GET_SETTINGS") {
        const settings = await getResolvedSettings();
        return { settings, providers: PROVIDERS };
    }
    if (msg.action === "ENSURE_OPTIONAL_ORIGIN_PERMISSION") {
        const baseUrl = String(msg?.baseUrl || "").trim();
        if (!baseUrl) throw new Error("缺少自定义 API 地址");
        let origin;
        try {
            const url = new URL(baseUrl);
            if (url.protocol !== "https:") {
                throw new Error("自定义 API 地址必须使用 https");
            }
            origin = url.origin;
        } catch (error) {
            throw new Error(error?.message || "自定义 API 地址格式无效");
        }
        const pattern = `${origin}/*`;
        const contains = await chrome.permissions.contains({ origins: [pattern] });
        if (contains) {
            return { granted: true, pattern };
        }
        if (msg?.request !== true) {
            return { granted: false, pattern };
        }
        const granted = await chrome.permissions.request({ origins: [pattern] });
        return { granted: !!granted, pattern };
    }
    if (msg.action === "OPEN_PERMISSION_REQUEST_PAGE") {
        const baseUrl = String(msg?.baseUrl || "").trim();
        if (!baseUrl) throw new Error("缺少自定义 API 地址");
        const authUrl = chrome.runtime.getURL(`permission-request.html?baseUrl=${encodeURIComponent(baseUrl)}`);
        if (chrome.windows?.create) {
            const created = await chrome.windows.create({
                url: authUrl,
                type: "popup",
                width: 420,
                height: 560,
                focused: true
            });
            return { ok: true, windowId: created?.id || null };
        }
        const createdTab = await chrome.tabs.create({ url: authUrl, active: true });
        return { ok: true, tabId: createdTab?.id || null };
    }
    throw new Error("未知 action");
}

function getUrlMeta(url) {
    try {
        const parsed = new URL(String(url || ""));
        return { host: parsed.host || "", protocol: parsed.protocol || "" };
    } catch (_) {
        return { host: "", protocol: "" };
    }
}

function bytesToHex(bytes) {
    return Array.from(bytes || [])
        .map((value) => Number(value || 0).toString(16).padStart(2, "0"))
        .join("");
}

async function sha256Hex(input) {
    try {
        const bytes = input instanceof ArrayBuffer
            ? input
            : new TextEncoder().encode(String(input || "")).buffer;
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return bytesToHex(new Uint8Array(digest));
    } catch (_) {
        return "";
    }
}

async function summarizeMediaLocator(locator) {
    const raw = String(locator || "").trim();
    if (!raw) return { audio_host: "", audio_path_sha256: "", audio_query_key_count: 0 };
    try {
        const parsed = new URL(raw);
        const queryKeys = [...parsed.searchParams.keys()].sort();
        return {
            audio_host: parsed.host || "",
            audio_protocol: parsed.protocol || "",
            audio_path_sha256: (await sha256Hex(`${parsed.pathname || ""}?${parsed.search || ""}`)).slice(0, 16),
            audio_query_key_count: queryKeys.length,
            audio_query_keys_sha256: (await sha256Hex(queryKeys.join("|"))).slice(0, 16)
        };
    } catch (_) {
        return {
            audio_host: "",
            audio_protocol: "",
            audio_path_sha256: (await sha256Hex(raw)).slice(0, 16),
            audio_query_key_count: 0,
            audio_query_keys_sha256: ""
        };
    }
}

async function summarizeAudioBlob(blob) {
    if (!blob) return { audio_sha256: "", audio_head_tail_sha256: "", audio_bytes: 0, audio_mime: "" };
    const size = Number(blob.size || 0);
    const mime = String(blob.type || "");
    try {
        const buffer = await blob.arrayBuffer();
        const fullHash = await sha256Hex(buffer);
        const bytes = new Uint8Array(buffer);
        const sampleSize = Math.min(65536, bytes.length);
        const sample = new Uint8Array(sampleSize * 2);
        sample.set(bytes.slice(0, sampleSize), 0);
        sample.set(bytes.slice(Math.max(0, bytes.length - sampleSize)), sampleSize);
        return {
            audio_sha256: fullHash.slice(0, 24),
            audio_head_tail_sha256: (await sha256Hex(sample.buffer)).slice(0, 24),
            audio_bytes: size,
            audio_mime: mime
        };
    } catch (_) {
        return { audio_sha256: "", audio_head_tail_sha256: "", audio_bytes: size, audio_mime: mime };
    }
}

function assertAsrAudioNotReused(bvid, audioDigest, context = {}) {
    const normalizedBvid = normalizeBvid(bvid);
    const audioHash = String(audioDigest?.audio_sha256 || "").trim();
    if (!normalizedBvid || !audioHash) return;
    const prev = recentAsrAudioFingerprints.get(audioHash);
    if (prev?.bvid && prev.bvid !== normalizedBvid) {
        logASR.error("asr_audio_reuse_blocked", {
            bvid: normalizedBvid,
            task: "asr",
            provider: context.provider || "",
            model: context.model || "",
            code: "ASR_AUDIO_REUSED_ACROSS_BVID",
            detail: {
                run_id: context.runId || "",
                previous_bvid: prev.bvid,
                previous_run_id: prev.runId || "",
                audio_sha256: audioHash,
                audio_bytes: Number(audioDigest?.audio_bytes || 0),
                audio_host: context.audioHost || ""
            }
        });
        throw createAppError("ASR_AUDIO_REUSED_ACROSS_BVID", "检测到当前视频音频和上一个视频重复，已阻止转录。请刷新页面后重试");
    }
    recentAsrAudioFingerprints.set(audioHash, {
        bvid: normalizedBvid,
        runId: context.runId || "",
        at: Date.now()
    });
    if (recentAsrAudioFingerprints.size > 30) {
        const entries = [...recentAsrAudioFingerprints.entries()].sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0));
        entries.slice(0, recentAsrAudioFingerprints.size - 30).forEach(([key]) => recentAsrAudioFingerprints.delete(key));
    }
}

function isAsrSubtitleSource(source) {
    const value = String(source || "").toLowerCase();
    return value === "groq" || value === "whisper" || value === "siliconflow" || value === "funasr";
}

function isNoTimestampSubtitleSource(source) {
    const value = String(source || "").toLowerCase();
    return value === "siliconflow" || value === "funasr";
}

function isNoTimestampSubtitleCache(cache = {}) {
    if (isNoTimestampSubtitleSource(cache?.subtitleSource)) return true;
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (!raw.length) return false;
    return raw.some((item) => item?.noTimestamp === true)
        || raw.every((item) => {
            const start = Number(item?.from ?? item?.start);
            const end = Number(item?.to ?? item?.end);
            return !Number.isFinite(start) && !Number.isFinite(end);
        });
}

function splitTranscriptionTextByPunctuation(text) {
    const normalized = stripEmojiFromText(text)
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return [];
    const pieces = normalized.match(/[^。！？!?；;，,、\n]+[。！？!?；;，,、]?/g) || [normalized];
    const rows = [];
    let buffer = "";
    const flush = () => {
        const value = buffer.trim();
        if (value) rows.push(value);
        buffer = "";
    };
    pieces.forEach((piece) => {
        const value = String(piece || "").trim();
        if (!value) return;
        if (!buffer) {
            buffer = value;
            if (/[。！？!?；;]$/.test(value) || value.length >= 80) flush();
            return;
        }
        if ((buffer + value).length <= 80 && !/[。！？!?；;]$/.test(buffer)) {
            buffer += value;
        } else {
            flush();
            buffer = value;
        }
        if (/[。！？!?；;]$/.test(buffer) || buffer.length >= 80) flush();
    });
    flush();
    return rows.length ? rows : [normalized];
}

function stripEmojiFromText(text) {
    return String(text || "")
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
        .replace(/[\uFE0E\uFE0F\u200D]/g, "")
        .trim();
}

function getFileExtension(filename) {
    const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]{1,8})(?:$|\?)/);
    return match ? match[1] : "";
}

function getBiliQualityDesc(quality) {
    const id = Number(quality || 0);
    const map = {
        6: "240P 极速",
        16: "360P 流畅",
        32: "480P 清晰",
        64: "720P 高清",
        74: "720P60 高帧率",
        80: "1080P 高清",
        112: "1080P+ 高码率",
        116: "1080P60 高帧率",
        120: "4K 超清",
        125: "HDR 真彩",
        126: "杜比视界",
        127: "8K 超高清"
    };
    return map[id] || (id ? `${id} 清晰度` : "默认清晰度");
}

function pickBiliQualityDesc(quality, acceptQuality = [], acceptDescription = []) {
    const id = Number(quality || 0);
    const index = Array.isArray(acceptQuality) ? acceptQuality.findIndex((item) => Number(item) === id) : -1;
    const fromApi = index >= 0 && Array.isArray(acceptDescription) ? String(acceptDescription[index] || "").trim() : "";
    return fromApi || getBiliQualityDesc(id);
}

function normalizeBiliUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.startsWith("//") ? `https:${raw}` : raw;
}

async function getCurrentBiliVideoIdentity(tabId, fallback = {}) {
    const fallbackBvid = normalizeBvid(fallback?.bvid);
    const fallbackCid = Number(fallback?.cid || 0);
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: (fallbackData) => {
                const state = globalThis.__INITIAL_STATE__ || {};
                const videoData = state.videoData || state?.reduxAsyncConnect?.videoData || {};
                const pages = Array.isArray(videoData.pages) ? videoData.pages : [];
                const params = new URLSearchParams(String(location?.search || ""));
                const pageIndex = Math.max(1, Number(state.p || params.get("p") || fallbackData.page || 1) || 1);
                const page = pages[pageIndex - 1] || pages.find((item) => Number(item?.cid || 0) === Number(fallbackData.cid || 0)) || pages[0] || {};
                const href = String(location?.href || "");
                const routeBvid = href.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || "";
                const title = String(videoData.title || document?.title || "").replace(/_哔哩哔哩_bilibili\s*$/i, "").trim();
                return {
                    aid: Number(videoData.aid || fallbackData.aid || 0),
                    bvid: String(videoData.bvid || routeBvid || fallbackData.bvid || "").trim(),
                    cid: Number(page.cid || fallbackData.cid || 0),
                    page: pageIndex,
                    title
                };
            },
            args: [{ bvid: fallbackBvid, cid: fallbackCid, aid: Number(fallback?.aid || 0), page: Number(fallback?.page || 1) }]
        });
        const identity = results?.[0]?.result || {};
        return {
            aid: Number(identity.aid || fallback?.aid || 0),
            rawBvid: String(identity.bvid || fallback?.bvid || "").trim(),
            bvid: normalizeBvid(identity.bvid || fallbackBvid),
            cid: Number(identity.cid || fallbackCid || 0),
            page: Number(identity.page || fallback?.page || 1),
            title: String(identity.title || fallback?.title || "").trim()
        };
    } catch (_) {
        return {
            aid: Number(fallback?.aid || 0),
            rawBvid: String(fallback?.bvid || "").trim(),
            bvid: fallbackBvid,
            cid: fallbackCid,
            page: Number(fallback?.page || 1),
            title: String(fallback?.title || "").trim()
        };
    }
}

async function fetchBiliPlayUrl(identity, options = {}) {
    const cid = Number(identity?.cid || 0);
    const aid = Number(identity?.aid || 0);
    const bvid = normalizeBvid(identity?.bvid || "");
    const rawBvid = String(identity?.rawBvid || identity?.bvid || "").trim();
    if (!cid || (!aid && !bvid)) {
        throw createAppError("DOWNLOAD_PLAYINFO_MISSING", "缺少当前视频 aid/cid，无法获取兼容下载链接");
    }
    const params = new URLSearchParams({
        otype: "json",
        platform: "html5",
        cid: String(cid),
        fnver: "0",
        high_quality: "1",
        fnval: String(options.fnval || 1)
    });
    if (aid) params.set("avid", String(aid));
    if (rawBvid) params.set("bvid", rawBvid);
    if (Number(options.qn || 0)) params.set("qn", String(Number(options.qn)));
    const response = await fetch(`${BILI_PLAYURL_API}?${params.toString()}`, {
        method: "GET",
        credentials: "include"
    });
    if (!response.ok) {
        const error = createHttpError(response.status, `B站播放接口请求失败：HTTP ${response.status}`);
        error.code = "DOWNLOAD_PLAYURL_API_FAILED";
        throw error;
    }
    const json = await response.json();
    if (Number(json?.code || 0) !== 0) {
        throw createAppError("DOWNLOAD_PLAYURL_API_FAILED", String(json?.message || "B站播放接口返回失败"));
    }
    return json?.data || {};
}

function buildCompatVideoPayload(data, identity, selectedQn = 0) {
    const acceptQuality = Array.isArray(data?.accept_quality) ? data.accept_quality.map(Number).filter(Boolean) : [];
    const acceptDescription = Array.isArray(data?.accept_description) ? data.accept_description : [];
    const qualities = acceptQuality.length
        ? acceptQuality.map((quality) => ({
            quality,
            desc: pickBiliQualityDesc(quality, acceptQuality, acceptDescription)
        }))
        : [Number(data?.quality || selectedQn || 80)].filter(Boolean).map((quality) => ({
            quality,
            desc: pickBiliQualityDesc(quality, acceptQuality, acceptDescription)
        }));
    const durlList = Array.isArray(data?.durl) ? data.durl : [];
    const first = durlList.find((item) => normalizeBiliUrl(item?.url)) || durlList[0] || null;
    const primaryUrl = normalizeBiliUrl(first?.url || "");
    const backupUrls = Array.isArray(first?.backup_url) ? first.backup_url : (Array.isArray(first?.backupUrl) ? first.backupUrl : []);
    const quality = Number(data?.quality || selectedQn || qualities[0]?.quality || 0);
    return {
        identity,
        qualities,
        stream: primaryUrl ? {
            quality,
            desc: pickBiliQualityDesc(quality, acceptQuality, acceptDescription),
            url: primaryUrl,
            urls: [primaryUrl, ...backupUrls.map(normalizeBiliUrl)].filter(Boolean),
            format: String(data?.format || "mp4").trim() || "mp4",
            type: "MP4_COMPAT"
        } : null
    };
}

function buildCompatAudioPayload(data, identity) {
    const audioList = Array.isArray(data?.dash?.audio) ? data.dash.audio : [];
    const streams = audioList
        .map((item) => {
            const primaryUrl = normalizeBiliUrl(item?.baseUrl || item?.base_url || item?.url || "");
            const backupUrls = Array.isArray(item?.backupUrl) ? item.backupUrl : (Array.isArray(item?.backup_url) ? item.backup_url : []);
            const bandwidth = Number(item?.bandwidth || 0);
            return {
                id: Number(item?.id || 0),
                desc: bandwidth ? `${Math.round(bandwidth / 1000)}kbps` : (item?.id ? `Audio ${item.id}` : "音频"),
                url: primaryUrl,
                urls: [primaryUrl, ...backupUrls.map(normalizeBiliUrl)].filter(Boolean),
                bandwidth,
                codecName: "m4a",
                type: "DASH_AUDIO_COMPAT"
            };
        })
        .filter((item) => item.url)
        .sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0));
    return { identity, streams };
}

async function getCompatPlayUrlForTab(tabId, payload = {}) {
    const type = String(payload?.type || "video") === "audio" ? "audio" : "video";
    const qn = Number(payload?.qn || 0);
    const identity = await getCurrentBiliVideoIdentity(tabId, payload);
    const data = await fetchBiliPlayUrl(identity, {
        fnval: type === "audio" ? 16 : 1,
        qn: type === "video" ? (qn || 80) : 0
    });
    const result = type === "audio"
        ? buildCompatAudioPayload(data, identity)
        : buildCompatVideoPayload(data, identity, qn);
    logDownload.info("download_compat_playurl_success", {
        task: "download",
        bvid: identity.bvid,
        detail: {
            type,
            qn: type === "video" ? Number(qn || data?.quality || 0) : 0,
            cid: identity.cid,
            has_stream: type === "video" ? !!result.stream?.url : Array.isArray(result.streams) && result.streams.length > 0,
            quality_count: Array.isArray(result.qualities) ? result.qualities.length : 0,
            audio_stream_count: Array.isArray(result.streams) ? result.streams.length : 0
        }
    });
    return { ok: true, type, ...result };
}

async function ensureDownloadHeaderRule(url) {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return false;
    const meta = getUrlMeta(url);
    const host = String(meta.host || "").toLowerCase();
    if (!host || !/(bilivideo|hdslb|bilibili)\.(com|cn)$/.test(host)) return false;
    try {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [DOWNLOAD_HEADER_RULE_ID],
            addRules: [{
                id: DOWNLOAD_HEADER_RULE_ID,
                priority: 1,
                action: {
                    type: "modifyHeaders",
                    requestHeaders: [
                        { header: "Referer", operation: "set", value: "https://www.bilibili.com/" },
                        { header: "Origin", operation: "set", value: "https://www.bilibili.com" }
                    ]
                },
                condition: {
                    urlFilter: `||${host}/`,
                    resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "media", "other"]
                }
            }]
        });
        logDownload.info("download_header_rule_enabled", {
            task: "download",
            detail: { url_host: host }
        });
        return true;
    } catch (error) {
        logDownload.warn("download_header_rule_failed", {
            task: "download",
            code: "DOWNLOAD_HEADER_RULE_FAILED",
            detail: {
                url_host: host,
                error: error.message || "failed to enable download headers"
            }
        });
        return false;
    }
}

async function probeDownloadContentType(url) {
    const target = String(url || "").trim();
    if (!target) return null;
    const tryFetch = async (method, headers) => {
        const response = await fetch(target, {
            method,
            headers: headers || undefined,
            redirect: "follow",
            cache: "no-store",
            credentials: "omit"
        });
        return response;
    };
    try {
        const res = await tryFetch("GET", { Range: "bytes=0-0" });
        if (res.type === "opaque") return null;
        const ct = String(res.headers.get("content-type") || "").toLowerCase();
        return { isHtml: res.ok && ct.includes("text/html"), contentType: ct, status: res.status };
    } catch (_) {
        try {
            const res = await tryFetch("HEAD");
            if (res.type === "opaque") return null;
            const ct = String(res.headers.get("content-type") || "").toLowerCase();
            return { isHtml: res.ok && ct.includes("text/html"), contentType: ct, status: res.status };
        } catch (_) {
            return null;
        }
    }
}

async function probeUrlStatus(url) {
    const target = String(url || "").trim();
    if (!target) return "unknown";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
        const htmlExtReg = /\.(s?html?|xhtml|mhtml)(?:$|[?#])/i;
        const isHtmlLikeResponse = (res) => {
            const ct = String(res.headers.get("content-type") || "").toLowerCase();
            const cd = String(res.headers.get("content-disposition") || "").toLowerCase();
            const finalUrl = String(res.url || "").toLowerCase();
            if (
                ct.includes("text/html")
                || ct.includes("application/xhtml+xml")
                || ct.includes("text/xhtml")
                || ct.includes("application/html")
            ) return true;
            if (htmlExtReg.test(finalUrl)) return true;
            if (htmlExtReg.test(cd)) return true;
            return false;
        };
        const evaluate = (res) => {
            if (isHtmlLikeResponse(res)) return "expired";
            if (res.status === 401 || res.status === 403) return "expired";
            if (res.ok || res.status === 206) return "ok";
            return "unknown";
        };
        const baseInit = {
            method: "GET",
            headers: { Range: "bytes=0-0" },
            referrer: "https://www.bilibili.com/",
            referrerPolicy: "strict-origin-when-cross-origin",
            redirect: "follow",
            cache: "no-store",
            credentials: "omit",
            signal: controller.signal
        };
        try {
            const res = await fetch(target, {
                ...baseInit,
                headers: {
                    ...baseInit.headers,
                    Referer: "https://www.bilibili.com/"
                }
            });
            return evaluate(res);
        } catch (_) {
            const res = await fetch(target, baseInit);
            return evaluate(res);
        }
    } catch (_) {
        return "unknown";
    } finally {
        clearTimeout(timeoutId);
    }
}

async function mergeSettings(patch) {
    const { settings } = await chrome.storage.local.get(["settings"]);
    const base = normalizeSettings(settings);
    const patchObject = patch && typeof patch === "object" ? patch : {};
    const mergedRaw = {
        ...base,
        ...patchObject
    };
    delete mergedRaw.prompts;
    delete mergedRaw.promptSettings;
    const merged = normalizeSettings(mergedRaw);
    const currentPromptSettings = await getPromptSettingsFromSync();
    let nextPromptSettings = currentPromptSettings;
    if (patchObject.promptSettings && typeof patchObject.promptSettings === "object") {
        nextPromptSettings = normalizePromptSettings(patchObject.promptSettings);
    } else if (patchObject.prompts && typeof patchObject.prompts === "object") {
        nextPromptSettings = normalizePromptSettings({
            mode: "custom",
            guided: currentPromptSettings.guided,
            custom: {
                ...currentPromptSettings.custom,
                ...patchObject.prompts
            }
        });
    }
    await chrome.storage.local.set({ settings: merged });
    await chrome.storage.sync.set({ promptSettings: nextPromptSettings });
    return withPromptSettings(merged, nextPromptSettings);
}

class ContentProvider {
    static async transcribeFallback(tabId, payload) {
        const tabState = await getTabState(tabId);
        const bvid = normalizeBvid(payload?.bvid || tabState?.activeBvid);
        if (!bvid) throw new Error("未找到视频标识，无法转录");
        const cid = Number(payload?.cid || tabState?.activeCid || 0);
        const tid = payload?.tid || tabState?.activeTid || null;
        const title = String(payload?.title || "").trim();
        const { settings } = await chrome.storage.local.get(["settings"]);
        const normalizedSettings = normalizeSettings(settings);
        const asrProvider = String(normalizedSettings.asrProvider || "groq").toLowerCase() === "siliconflow" ? "siliconflow" : "groq";
        const asrApiKey = asrProvider === "siliconflow"
            ? String(normalizedSettings.siliconFlowApiKey || "").trim()
            : String(normalizedSettings.groqApiKey || "").trim();
        const asrModel = asrProvider === "siliconflow"
            ? (String(normalizedSettings.siliconFlowAsrModel || "").trim() || "FunAudioLLM/SenseVoiceSmall")
            : (String(normalizedSettings.groqModel || "").trim() || "whisper-large-v3-turbo");
        const asrMaxAudioBytes = asrProvider === "siliconflow" ? SILICONFLOW_MAX_AUDIO_BYTES : GROQ_MAX_AUDIO_BYTES;
        const asrDisplayName = asrProvider === "siliconflow" ? "硅基流动" : "Groq";
        const subtitleSource = asrProvider === "siliconflow" ? "siliconflow" : "groq";
        const startedAt = Date.now();
        if (!asrApiKey) throw new Error(asrProvider === "siliconflow" ? "请先在设置中填写硅基流动 API Key" : "请先在设置中填写 Groq API Key");
        const asrRunId = String(payload?.asrRunId || `asr_${bvid}_${startedAt.toString(36)}`).trim();
        const payloadAudioSummary = await summarizeMediaLocator(payload?.audioUrl || "");
        const operationController = new AbortController();
        const unregisterAbort = registerTabAbortController(tabId, operationController);
        try {
            logASR.info("asr_start", {
                bvid,
                task: "asr",
                provider: asrProvider,
                model: asrModel,
                detail: {
                    run_id: asrRunId,
                    tab_id: tabId,
                    cid: Number.isFinite(cid) ? cid : 0,
                    has_payload_audio_locator: !!payload?.audioUrl,
                    ...payloadAudioSummary
                }
            });
            await updateTabState(tabId, {
                activeBvid: bvid,
                activeCid: Number.isFinite(cid) ? cid : 0,
                activeTid: tid || null,
                subtitleSource,
                transcriptionProgress: 5,
                updatedAt: Date.now()
            });
            await notifyTranscribeStatus(tabId, { stage: "start", level: "info", text: "检测到无字幕，正在转录音轨...", progress: 5, bvid });
            const media = await this.extractAudioSourceFromTab(tabId, { ...payload, asrProvider });
            if (!media?.url) throw new Error("未提取到音轨地址，可能是付费视频、CDN 限制或页面未完成加载");
            const mediaSummary = await summarizeMediaLocator(media.url);
            const mediaPageBvid = normalizeBvid(media?.pageBvid || "");
            logASR.info("asr_audio_source_selected", {
                bvid,
                task: "asr",
                provider: asrProvider,
                model: asrModel,
                detail: {
                    run_id: asrRunId,
                    tab_id: tabId,
                    media_source: String(media?.source || ""),
                    media_page_bvid: mediaPageBvid,
                    expected_bvid: bvid,
                    source_bvid_matched: !mediaPageBvid || mediaPageBvid === bvid,
                    ...mediaSummary
                }
            });
            if (mediaPageBvid && mediaPageBvid !== bvid) {
                logASR.warn("asr_audio_source_bvid_mismatch", {
                    bvid,
                    task: "asr",
                    provider: asrProvider,
                    model: asrModel,
                    code: "ASR_AUDIO_SOURCE_BVID_MISMATCH",
                    detail: {
                        run_id: asrRunId,
                        media_page_bvid: mediaPageBvid,
                        expected_bvid: bvid,
                        media_source: String(media?.source || "")
                    }
                });
            }
            await updateTabState(tabId, { activeBvid: bvid, transcriptionProgress: 20, updatedAt: Date.now() });
            await notifyTranscribeStatus(tabId, { stage: "download", level: "info", text: "正在下载音轨...", progress: 20, bvid });
            const audioFetchStartedAt = Date.now();
            const audioBlob = await this.fetchResourceToBlob(media.url, tabId, bvid, false, asrMaxAudioBytes, operationController.signal);
            await updateTabState(tabId, { activeBvid: bvid, transcriptionProgress: 56, updatedAt: Date.now() });
            await notifyTranscribeStatus(tabId, { stage: "prepare_upload", level: "info", text: `下载完成，正在准备上传到 ${asrDisplayName}...`, progress: 56, bvid });
            const audioFetchMs = Date.now() - audioFetchStartedAt;
            const audioDigest = await summarizeAudioBlob(audioBlob);
            assertAsrAudioNotReused(bvid, audioDigest, {
                runId: asrRunId,
                provider: asrProvider,
                model: asrModel,
                audioHost: getUrlMeta(media.url).host
            });
            logASR.info("asr_audio_fetch_success", {
                bvid,
                task: "asr",
                provider: asrProvider,
                model: asrModel,
                duration_ms: audioFetchMs,
                detail: {
                    run_id: asrRunId,
                    media_source: String(media?.source || ""),
                    ...audioDigest,
                    audio_host: getUrlMeta(media.url).host
                }
            });
            if (audioBlob.size >= asrMaxAudioBytes) {
                const limitMb = Math.floor(asrMaxAudioBytes / 1024 / 1024);
                throw createAppError("ASR_FILE_TOO_LARGE", `该视频音轨文件大小超出限制（>=${limitMb}MB），目前暂不支持`);
            }
            const audioFile = new File([audioBlob], "audio.m4a", { type: audioBlob.type || "audio/mp4" });
            await updateTabState(tabId, { activeBvid: bvid, transcriptionProgress: 55, updatedAt: Date.now() });
            
            let fakeProgress = 55;
            await notifyTranscribeStatus(tabId, { stage: "upload", level: "info", text: `正在上传音轨到 ${asrDisplayName}...`, progress: fakeProgress, bvid });
            
            let uploadStageActive = true;
            const progressTimer = setInterval(() => {
                if (!uploadStageActive || operationController.signal.aborted) return;
                const inc = 2 + Math.floor(Math.random() * 2); // 2-3%
                fakeProgress = Math.min(88, fakeProgress + inc);
                updateTabState(tabId, { activeBvid: bvid, transcriptionProgress: fakeProgress, updatedAt: Date.now() }).catch(() => {});
                notifyTranscribeStatus(tabId, { 
                    stage: "upload", 
                    level: "info", 
                    text: `正在上传音轨到 ${asrDisplayName}...`, 
                    progress: fakeProgress,
                    bvid
                }).catch(() => {});
            }, 2000);

            let transcription;
            const asrRequestStartedAt = Date.now();
            try {
                transcription = asrProvider === "siliconflow"
                    ? await this.requestSiliconFlowTranscription(audioFile, asrApiKey, asrModel, tabId, bvid, operationController.signal)
                    : await this.requestGroqTranscription(audioFile, asrApiKey, asrModel, tabId, bvid, title || media.title || "", operationController.signal);
                logASR.info("asr_request_success", {
                    bvid,
                    task: "asr",
                    provider: asrProvider,
                    model: asrModel,
                    duration_ms: Date.now() - asrRequestStartedAt,
                    detail: {
                        run_id: asrRunId,
                        audio_bytes: audioBlob.size || 0,
                        audio_sha256: audioDigest.audio_sha256,
                        quota: buildGroqQuotaLine(transcription.quota)
                    }
                });
            } finally {
                uploadStageActive = false;
                clearInterval(progressTimer);
            }

            await notifyTranscribeStatus(tabId, { stage: "parse", level: "info", text: `${asrDisplayName} 正在解析中文字幕...`, progress: 90, bvid });
            await updateTabState(tabId, { activeBvid: bvid, transcriptionProgress: 90, updatedAt: Date.now() });
            const rows = this.mapTranscriptionToRows(transcription.data, { noTimestamp: asrProvider === "siliconflow" });
            if (!rows.length) throw new Error("转录返回为空，未生成可用字幕");
            await handleSubtitleCaptured(tabId, {
                bvid,
                cid: Number.isFinite(cid) ? cid : 0,
                tid,
                title: title || media.title || "",
                subtitle: rows,
                source: subtitleSource
            });
            await updateTabState(tabId, { activeBvid: bvid, subtitleSource, transcriptionProgress: 100, updatedAt: Date.now() });
            await notifyTranscribeStatus(tabId, {
                stage: "done",
                level: "success",
                text: "转录成功，已写入字幕",
                progress: 100,
                quotaLine: buildGroqQuotaLine(transcription.quota),
                bvid
            });
            logASR.info("asr_success", {
                bvid,
                task: "asr",
                provider: asrProvider,
                model: asrModel,
                duration_ms: Date.now() - startedAt,
                detail: {
                    run_id: asrRunId,
                    rows: rows.length,
                    audio_bytes: audioBlob.size || 0,
                    audio_sha256: audioDigest.audio_sha256
                }
            });
            await reportFeatureUsage("transcribe", bvid, normalizedSettings, {
                tokens: 0,
                latencyMs: Math.max(0, Date.now() - startedAt),
                provider: asrProvider,
                model: asrModel,
                title: title || media.title || ""
            });
            return { rows: rows.length, quota: transcription.quota };
        } catch (error) {
            await updateTabState(tabId, { activeBvid: bvid, transcriptionProgress: 0, updatedAt: Date.now() });
            await notifyTranscribeStatus(tabId, {
                stage: "error",
                level: "error",
                text: error?.message || "转录失败，请重试",
                progress: 0,
                bvid
            });
            await reportDailyFeatureUsage("transcribe", normalizedSettings, {
                durationMs: Date.now() - startedAt,
                tokens: 0
            }, resolveUsageStatusByError(error), resolveUsageErrorCode(error, "ASR_FAILED"), {
                bvid,
                title: title || media.title || ""
            });
            logASR.error("asr_failed", buildFailureLog(error, {
                bvid,
                task: "asr",
                provider: asrProvider,
                model: asrModel,
                duration_ms: Date.now() - startedAt,
                detail: {
                    run_id: asrRunId,
                    tab_id: tabId,
                    cid: Number.isFinite(cid) ? cid : 0
                }
            }));
            throw error;
        } finally {
            unregisterAbort();
        }
    }

    static async extractAudioSourceFromTab(tabId, payload) {
        const provider = String(payload?.asrProvider || "").toLowerCase() === "siliconflow" ? "siliconflow" : "groq";
        // 优先按当前 tab 的 aid/cid 主动请求 B 站 playurl，避免 SPA 页面缓存音频串线。
        try {
            const result = await getCompatPlayUrlForTab(tabId, {
                ...payload,
                type: "audio"
            });
            const expectedBvid = normalizeBvid(payload?.bvid || "");
            const identityBvid = normalizeBvid(result?.identity?.bvid || "");
            const audio = Array.isArray(result?.streams) ? result.streams[0] : null;
            if (audio?.url && (!expectedBvid || !identityBvid || expectedBvid === identityBvid)) {
                return {
                    url: audio.url,
                    urls: audio.urls,
                    title: String(result?.identity?.title || payload?.title || "").trim(),
                    source: "playurl_api_audio",
                    pageBvid: identityBvid || expectedBvid
                };
            }
            if (expectedBvid && identityBvid && expectedBvid !== identityBvid) {
                logASR.warn("asr_playurl_identity_mismatch", {
                    bvid: expectedBvid,
                    task: "asr",
                    provider,
                    code: "ASR_PLAYURL_IDENTITY_MISMATCH",
                    detail: {
                        playurl_bvid: identityBvid,
                        expected_bvid: expectedBvid
                    }
                });
            }
        } catch (error) {
            logASR.warn("asr_playurl_audio_fetch_failed", {
                bvid: normalizeBvid(payload?.bvid || ""),
                task: "asr",
                provider,
                code: error?.code || "ASR_PLAYURL_AUDIO_FETCH_FAILED",
                detail: {
                    reason: error?.message || "playurl audio fetch failed"
                }
            });
        }

        // 降级使用 content.js 传来的音频地址。
        if (payload?.audioUrl) {
            const title = String(payload.title || "").trim();
            return {
                url: payload.audioUrl,
                title,
                source: "content_payload",
                pageBvid: normalizeBvid(payload?.bvid || "")
            };
        }
        // 降级：executeScript 读 __playinfo__（兜底，SPA 下可能是旧视频数据）
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: () => {
                const playinfo = globalThis.__playinfo__ || globalThis.window?.__playinfo__;
                const data = playinfo?.data || {};
                const dash = data?.dash || {};
                const audioList = Array.isArray(dash?.audio) ? dash.audio : [];
                const first = audioList.find((item) => item?.baseUrl || item?.base_url) || audioList[0] || null;
                const title = String(document?.title || "").replace(/_哔哩哔哩_bilibili\s*$/i, "").trim();
                const match = String(location?.href || "").match(/\/video\/(BV[a-zA-Z0-9]+)/i);
                return {
                    url: first?.baseUrl || first?.base_url || "",
                    title,
                    source: "main_world_playinfo",
                    pageBvid: match ? match[1] : ""
                };
            }
        });
        return results?.[0]?.result || null;
    }

    static async fetchResourceToBlob(url, tabId, bvid = "", skipSizeCheck = false, maxBytes = GROQ_MAX_AUDIO_BYTES, signal = null) {
        const response = await fetch(url, {
            method: "GET",
            credentials: "omit",
            mode: "cors",
            headers: {
                "Referer": "https://www.bilibili.com/",
                "User-Agent": navigator.userAgent
            },
            signal
        });
        if (!response.ok) {
            if (response.status === 403) throw createAppError("DOWNLOAD_FAILED", "资源下载失败：CDN 返回 403，可能是付费/受限内容", { status: 403 });
            throw createAppError("DOWNLOAD_FAILED", `资源下载失败：HTTP ${response.status}`, { status: response.status });
        }
        const total = Number(response.headers.get("content-length") || 0);
        const responseLocator = await summarizeMediaLocator(response.url || url);
        logASR.info("asr_audio_response_headers", {
            bvid,
            task: "asr",
            status: response.status,
            detail: {
                tab_id: tabId,
                byte_length_header: Number.isFinite(total) ? total : 0,
                mime_header: String(response.headers.get("content-type") || ""),
                range_supported: String(response.headers.get("accept-ranges") || ""),
                final_audio_host: responseLocator.audio_host,
                final_audio_path_sha256: responseLocator.audio_path_sha256
            }
        });
        if (!skipSizeCheck && Number.isFinite(total) && total >= maxBytes) {
            const limitMb = Math.floor(maxBytes / 1024 / 1024);
            throw createAppError("ASR_FILE_TOO_LARGE", `该文件大小超出限制（>=${limitMb}MB），目前暂不支持`);
        }
        const reader = response.body?.getReader?.();
        if (!reader) {
            const blob = await response.blob();
            if (!skipSizeCheck) await notifyTranscribeStatus(tabId, { stage: "download", level: "info", text: "下载进度：100%", progress: 55, bvid });
            return blob;
        }
        const chunks = [];
        let loaded = 0;
        let nextMark = 10;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                loaded += value.length;
            }
            if (!skipSizeCheck && total > 0) {
                const pct = Math.floor((loaded / total) * 100);
                if (pct >= nextMark) {
                    const clamped = Math.min(100, pct);
                    const progress = 20 + Math.round(clamped * 0.35);
                    await notifyTranscribeStatus(tabId, { stage: "download", level: "info", text: `下载进度：${clamped}%`, progress, bvid });
                    nextMark += 10;
                }
            }
            if (!skipSizeCheck && loaded >= maxBytes) {
                const limitMb = Math.floor(maxBytes / 1024 / 1024);
                throw createAppError("ASR_FILE_TOO_LARGE", `该文件大小超出限制（>=${limitMb}MB），目前暂不支持`);
            }
        }
        const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
        if (!skipSizeCheck) await notifyTranscribeStatus(tabId, { stage: "download", level: "info", text: "下载进度：100%", progress: 55, bvid });
        return blob;
    }

    static async requestGroqTranscription(audioFile, groqApiKey, groqModel, tabId, bvid = "", videoTitle = "", externalSignal = null) {
        const formData = new FormData();
        formData.append("file", audioFile);
        formData.append("model", groqModel);
        formData.append("response_format", "verbose_json");
        formData.append("prompt", buildGroqTranscriptionPrompt(videoTitle));
        formData.append("timestamp_granularities[]", "segment");
        const controller = new AbortController();
        const forwardAbort = () => controller.abort(externalSignal?.reason || "aborted");
        if (externalSignal) {
            if (externalSignal.aborted) forwardAbort();
            else externalSignal.addEventListener("abort", forwardAbort, { once: true });
        }
        const timeoutId = setTimeout(() => controller.abort("timeout"), TASK_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(GROQ_AUDIO_TRANSCRIBE_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${groqApiKey}` },
                body: formData,
                signal: controller.signal
            });
        } catch (error) {
            if (controller.signal.aborted) {
                if (controller.signal.reason === "timeout") {
                    const timeoutError = createTaskTimeoutError("ASR_REQUEST_TIMEOUT", "转录请求超时，请稍后重试");
                    attachSentryContext(timeoutError, {
                        provider: "groq_asr",
                        model: String(groqModel || ""),
                        timeout_ms: TASK_TIMEOUT_MS,
                        request_stream: false,
                        bypass_queue: true
                    });
                    throw timeoutError;
                }
                throw createUserAbortedError();
            }
            throw error;
        } finally {
            if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
            clearTimeout(timeoutId);
        }
        const quota = parseGroqQuotaHeaders(response.headers);
        await updateTabState(tabId, {
            quotaInfo: {
                ...quota,
                at: Date.now(),
                status: response.status
            },
            updatedAt: Date.now()
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            if (response.status === 429) {
                const retryAfterSec = parseRetryAfterSeconds(response.headers.get("retry-after"), detail);
                await updateTabState(tabId, {
                    quotaInfo: {
                        ...quota,
                        retryAfterSec,
                        at: Date.now(),
                        status: response.status
                    },
                    updatedAt: Date.now()
                });
                await notifyTranscribeStatus(tabId, {
                    stage: "error",
                    level: "error",
                    text: retryAfterSec > 0 ? `Groq 限流，请等待 ${retryAfterSec} 秒后重试` : "Groq 限流，请稍后重试",
                    progress: 0,
                    retryAfterSec,
                    quotaLine: buildGroqQuotaLine(quota),
                    bvid
                });
                throw createAppError("ASR_RATE_LIMIT", retryAfterSec > 0 ? `Groq 限流，请等待 ${retryAfterSec} 秒后重试` : "Groq 限流，请稍后重试", { status: response.status, retryAfterSec });
            }
            throw createHttpError(response.status, `Groq 转录失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`);
        }
        await notifyTranscribeStatus(tabId, {
            stage: "upload",
            level: "info",
            text: "上传进度：100%",
            progress: 70,
            quotaLine: buildGroqQuotaLine(quota),
            bvid
        });
        const data = await response.json().catch(() => null);
        return { data, quota };
    }

    static async requestSiliconFlowTranscription(audioFile, apiKey, model, tabId, bvid = "", externalSignal = null) {
        const formData = new FormData();
        formData.append("file", audioFile);
        formData.append("model", model || "FunAudioLLM/SenseVoiceSmall");
        const controller = new AbortController();
        const forwardAbort = () => controller.abort(externalSignal?.reason || "aborted");
        if (externalSignal) {
            if (externalSignal.aborted) forwardAbort();
            else externalSignal.addEventListener("abort", forwardAbort, { once: true });
        }
        const timeoutId = setTimeout(() => controller.abort("timeout"), TASK_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(SILICONFLOW_AUDIO_TRANSCRIBE_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}` },
                body: formData,
                signal: controller.signal
            });
        } catch (error) {
            if (controller.signal.aborted) {
                if (controller.signal.reason === "timeout") {
                    const timeoutError = createTaskTimeoutError("ASR_REQUEST_TIMEOUT", "转录请求超时，请稍后重试");
                    attachSentryContext(timeoutError, {
                        provider: "siliconflow_asr",
                        model: String(model || ""),
                        timeout_ms: TASK_TIMEOUT_MS,
                        request_stream: false,
                        bypass_queue: true
                    });
                    throw timeoutError;
                }
                throw createUserAbortedError();
            }
            throw error;
        } finally {
            if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
            clearTimeout(timeoutId);
        }
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            if (response.status === 429) {
                throw createAppError("ASR_RATE_LIMIT", "硅基流动限流，请稍后重试", { status: response.status });
            }
            const error = createHttpError(response.status, `硅基流动转录失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`);
            error.code = "ASR_SILICONFLOW_FAILED";
            throw error;
        }
        await notifyTranscribeStatus(tabId, {
            stage: "upload",
            level: "info",
            text: "上传进度：100%",
            progress: 70,
            bvid
        });
        const data = await response.json().catch(() => null);
        return { data, quota: null };
    }

    static mapTranscriptionToRows(data, options = {}) {
        if (options?.noTimestamp) {
            const plain = String(data?.text || data?.result || data?.data?.text || "").trim();
            if (!plain) return [];
            return splitTranscriptionTextByPunctuation(plain).map((text, index) => ({
                start: null,
                end: null,
                text,
                index,
                noTimestamp: true
            }));
        }
        const segments = Array.isArray(data?.segments) ? data.segments : [];
        if (segments.length) {
            return segments
                .map((item, index) => {
                    const start = Number(item?.start ?? 0);
                    const endRaw = Number(item?.end ?? start + 3);
                    const end = Number.isFinite(endRaw) ? endRaw : start + 3;
                    const text = String(item?.text || "").trim();
                    if (!text) return null;
                    return {
                        start: Number.isFinite(start) ? start : 0,
                        end: Math.max(Number.isFinite(start) ? start : 0, end),
                        text,
                        index
                    };
                })
                .filter(Boolean);
        }
        const plain = String(data?.text || "").trim();
        if (!plain) return [];
        return [{ start: 0, end: 10, text: plain, index: 0 }];
    }
}

async function notifyTranscribeStatus(tabId, payload) {
    if (!tabId) return;
    const message = { action: "TRANSCRIBE_STATUS", ...payload };
    try {
        await chrome.tabs.sendMessage(tabId, message);
    } catch (_) {}
    logBackground.info("transcribe_status", {
        tab_id: tabId,
        stage: payload?.stage || "",
        level: payload?.level || "",
        text: String(payload?.text || ""),
        quota: String(payload?.quotaLine || ""),
        retry_after: Number(payload?.retryAfterSec || 0)
    });
    if (Number(payload?.retryAfterSec || 0) > 0) {
        startRetryCountdown(tabId, Number(payload.retryAfterSec), payload?.bvid || "");
    }
}

function startRetryCountdown(tabId, retryAfterSec, bvid = "") {
    const maxSeconds = Math.max(0, Math.floor(retryAfterSec || 0));
    if (!maxSeconds) return;
    let remain = maxSeconds;
    const timer = setInterval(async () => {
        remain -= 1;
        if (remain <= 0) {
            clearInterval(timer);
            try {
                await chrome.tabs.sendMessage(tabId, {
                    action: "TRANSCRIBE_STATUS",
                    stage: "retry_countdown",
                    level: "info",
                    text: "可以重试转录了",
                    retryAfterSec: 0,
                    bvid
                });
            } catch (_) {}
            return;
        }
        try {
            await chrome.tabs.sendMessage(tabId, {
                action: "TRANSCRIBE_STATUS",
                stage: "retry_countdown",
                level: "info",
                text: `请等待 ${remain} 秒后重试`,
                retryAfterSec: remain,
                bvid
            });
        } catch (_) {
            clearInterval(timer);
        }
    }, 1000);
}

async function handleSubtitleCaptured(tabId, payload) {
    if (!tabId) return;
    const bvid = normalizeBvid(payload?.bvid);
    if (!bvid) {
        logBackground.error("task_abort", {
            task: "subtitle_capture",
            code: "MISSING_BVID",
            detail: {
                tab_id: tabId,
                reason: "missing_bvid_in_payload"
            }
        });
        return;
    }
    const cid = Number(payload.cid || 0);
    const tid = payload.tid || null;
    const subtitleSource = String(payload?.source || "official");
    logBackground.info("subtitle_detected", { tab_id: tabId, bvid, cid, tid });
    const existing = await getCache(bvid);
    const rawSubtitle = normalizeRawSubtitle(payload.subtitle || []);
    const rawHash = makeSubtitleHash(rawSubtitle);
    if (existing?.rawHash && existing.rawHash === rawHash) {
        logBackground.debug("subtitle_duplicate_ignore", { bvid, tab_id: tabId, raw_hash: rawHash });
        const existingSource = String(existing?.subtitleSource || "");
        let nextCache = existing;
        if (subtitleSource && existingSource !== subtitleSource) {
            await mergeCacheByBvid(bvid, {
                subtitleSource,
                updatedAt: Date.now()
            });
            nextCache = await getCache(bvid);
        }
        await updateTabState(tabId, {
            activeBvid: bvid,
            activeCid: Number.isFinite(cid) ? cid : 0,
            activeTid: tid,
            subtitleSource,
            transcriptionProgress: isAsrSubtitleSource(subtitleSource) ? 100 : 0,
            updatedAt: Date.now()
        });
        if (isAsrSubtitleSource(subtitleSource)) {
            const settings = await getResolvedSettings();
            await persistCloudSubtitlePatch(bvid, settings, nextCache, {
                title: payload.title || "",
                subtitleSource
            });
        }
        await pushSubtitleSyncToTab(tabId, bvid, nextCache, "duplicate");
        return;
    }
    const processedSubtitle = isNoTimestampSubtitleSource(subtitleSource)
        ? rawSubtitle
        : SubtitleProcessor.process(rawSubtitle);
    const processedHash = makeSubtitleHash(processedSubtitle);
    if (rawSubtitle.length > 0 && processedSubtitle.length === 0) {
        const first = rawSubtitle[0] || {};
        logBackground.warn("subtitle_parsed", {
            bvid,
            reason: "processed_empty",
            raw_count: rawSubtitle.length,
            sample_start: first.start ?? null,
            sample_end: first.end ?? null,
            sample_text_len: String(first.text || "").length
        });
    }
    logBackground.info("subtitle_parsed", { bvid, raw_count: rawSubtitle.length, processed_count: processedSubtitle.length });
    await mergeCacheByBvid(bvid, {
        bvid,
        cid: Number.isFinite(cid) ? cid : 0,
        tid,
        title: payload.title || "",
        subtitleSource,
        rawSubtitle,
        processedSubtitle,
        rawHash,
        processedHash,
        updatedAt: Date.now()
    });
    await updateTabState(tabId, {
        activeBvid: bvid,
        activeCid: Number.isFinite(cid) ? cid : 0,
        activeTid: tid,
        subtitleSource,
        transcriptionProgress: isAsrSubtitleSource(subtitleSource) ? 100 : 0,
        lastError: "",
        taskStatus: {
            summary: "idle",
            segments: "idle",
            rumors: "idle",
            chat: "idle"
        },
        taskErrors: {},
        updatedAt: Date.now()
    });
    const latestCache = await getCache(bvid);
    if (isAsrSubtitleSource(subtitleSource)) {
        const settings = await getResolvedSettings();
        await persistCloudSubtitlePatch(bvid, settings, latestCache, {
            title: payload.title || "",
            subtitleSource
        });
    }
    await pushSubtitleSyncToTab(tabId, bvid, latestCache, "fresh");
}

async function pushSubtitleSyncToTab(tabId, bvid, cache, reason) {
    if (!tabId || !bvid) return;
    const key = String(tabId);
    const normalizedBvid = normalizeBvid(bvid);
    const prev = lastSubtitleSync.get(key);
    if (reason !== "duplicate" && prev && prev.bvid === normalizedBvid && Date.now() - Number(prev.at || 0) < 300) return;
    lastSubtitleSync.set(key, { bvid: normalizedBvid, at: Date.now() });
    const tabState = await getTabState(tabId);
    try {
        const action = reason === "duplicate" ? "UPDATE_STATE" : "SUBTITLE_READY";
        const safeCache = normalizeCacheForUI(cache, normalizedBvid);
        await chrome.tabs.sendMessage(tabId, {
            action,
            bvid: normalizedBvid,
            cache: safeCache,
            subtitle: Array.isArray(safeCache?.rawSubtitle) ? safeCache.rawSubtitle : [],
            tabState: tabState || null,
            reason
        });
    } catch (_) {}
}

function normalizeCacheForUI(cache, bvid) {
    if (!cache || typeof cache !== "object") return null;
    const rawSubtitle = normalizeRawSubtitle(Array.isArray(cache.rawSubtitle) ? cache.rawSubtitle : []);
    const processedSubtitle = normalizeRawSubtitle(Array.isArray(cache.processedSubtitle) ? cache.processedSubtitle : []);
    return {
        ...cache,
        bvid: normalizeBvid(cache.bvid || bvid),
        rawSubtitle,
        processedSubtitle
    };
}

function normalizeRawSubtitle(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map((item) => {
            if (item && typeof item === "string") {
                return { start: 0, end: null, text: item.trim() };
            }
            const start = Number(item.from ?? item.start ?? 0);
            const endRaw = Number(item.to ?? item.end ?? NaN);
            const end = Number.isFinite(endRaw) ? endRaw : null;
        const text = stripEmojiFromText(item.content ?? item.text ?? "");
            return { start, end, text };
        })
        .filter((item) => item.text);
}

function normalizeBvid(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const matched = raw.match(/BV[0-9A-Za-z]+/i);
    if (!matched) return "";
    return matched[0].toLowerCase();
}

function normalizeTaskContext(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const duration = source.videoDuration && typeof source.videoDuration === "object" ? source.videoDuration : {};
    const totalSeconds = Number(duration.totalSeconds);
    const formattedTime = String(duration.formattedTime || "").trim();
    return {
        videoDuration: {
            totalSeconds: Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0,
            formattedTime
        }
    };
}

function makeSubtitleHash(list) {
    if (!Array.isArray(list) || !list.length) return "empty";
    const first = list[0];
    const last = list[list.length - 1];
    return `${list.length}|${first.start}|${last.end ?? last.start}|${first.text.slice(0, 24)}|${last.text.slice(0, 24)}`;
}

async function runTasksForTab(tabId, tasks, force, taskContext = {}, requestedBvid = "") {
    const tabState = await getTabState(tabId);
    const bvid = normalizeBvid(requestedBvid || tabState?.activeBvid);
    if (!bvid) throw new Error("未获取到视频字幕");
    if (normalizeBvid(tabState?.activeBvid) !== bvid) {
        await updateTabState(tabId, { activeBvid: bvid, updatedAt: Date.now() });
    }
    const resolvedSettings = await getResolvedSettings();
    const hydrateTasks = [...new Set([
        ...tasks,
        ...(tasks.some((task) => ["summary", "segments", "rumors"].includes(task)) ? ["subtitle"] : [])
    ])];
    await hydrateCloudCacheIfNeeded(bvid, hydrateTasks, resolvedSettings);
    const hasSummarySegments = tasks.includes("summary") && tasks.includes("segments");
    const otherTasks = tasks.filter((task) => !(hasSummarySegments && (task === "summary" || task === "segments")));

    if (hasSummarySegments) {
        await setTaskStatus(tabId, ["summary", "segments"], "processing");
        await runSummarySegmentsTasks(tabId, bvid, force, resolvedSettings, taskContext);
    }

    if (otherTasks.length) {
        await setTaskStatus(tabId, otherTasks, "processing");
        await Promise.all(otherTasks.map((task) => runSingleTask(tabId, bvid, task, force, resolvedSettings, taskContext)));
        await setTaskStatus(tabId, otherTasks, "done");
    }

    logBackground.info("task_finish", { tab_id: tabId, bvid, tasks });
}

async function runSingleTask(tabId, bvid, task, force, settings, taskContext = {}) {
    if (!force) {
        await hydrateCloudCacheIfNeeded(bvid, [task], settings);
    }
    const cache = await getCache(bvid);
    if (!force && cache?.[task]) return cache[task];
    const key = `${bvid}|${task}`;
    const startedAt = Date.now();
    logBackground.info("task_start", { tab_id: tabId, bvid, task });
    try {
        const result = await runWithDedup(key, () => requestTaskResult(bvid, task, settings, { ...taskContext, tabId }));
        await mergeCacheByBvid(bvid, {
            [task]: result,
            ...buildTaskSourcePatch([task], "local"),
            updatedAt: Date.now()
        });
        const cloudSaved = await persistCloudFeaturePatch(bvid, settings, { [task]: result });
        if (cloudSaved) {
            await incrementCloudVideoCallCount(bvid, settings, task);
        }
        return result;
    } catch (error) {
        const status = isTimeoutError(error) ? "timeout" : "error";
        await captureTaskFailureToSentry(error, {
            source: "task_failure",
            task,
            tabId,
            bvid,
            provider: settings?.provider || "",
            model: settings?.model || "",
            taskContext
        });
        await reportDailyFeatureUsage(task, settings, {
            durationMs: Date.now() - startedAt,
            tokens: 0
        }, resolveUsageStatusByError(error), resolveUsageErrorCode(error), {
            bvid,
            title: cache?.title || ""
        });
        if (status === "timeout") {
            logBackground.error("task_timeout", buildFailureLog(error, { tab_id: tabId, bvid, task, code: error?.code || "TIMEOUT" }));
        } else {
            logBackground.error("task_abort", buildFailureLog(error, { tab_id: tabId, bvid, task }));
        }
        await setTaskStatus(tabId, [task], status, error.message || "任务失败");
        throw error;
    }
}

async function runSummarySegmentsTasks(tabId, bvid, force, settings, taskContext = {}) {
    if (!force) {
        await hydrateCloudCacheIfNeeded(bvid, ["summary", "segments"], settings);
    }
    const cache = await getCache(bvid);
    if (!force && cache?.summary && Array.isArray(cache?.segments) && cache.segments.length) {
        await setTaskStatus(tabId, ["summary", "segments"], "done");
        return {
            summary: { ok: true, data: cache.summary || "", error: null },
            segments: { ok: true, data: cache.segments, error: null }
        };
    }
    const key = `${bvid}|summary_segments`;
    const startedAt = Date.now();
    logBackground.info("task_start", { tab_id: tabId, bvid, task: "summary_segments", mode: settings.prefMode });
    const runner = settings.prefMode === "efficiency"
        ? () => runSummarySegmentsInEfficiency(tabId, bvid, force, settings, taskContext)
        : () => runSummarySegmentsInQuality(tabId, bvid, force, settings, taskContext);
    const results = await runWithDedup(key, runner);
    const cloudPatch = {};
    if (results?.summary?.ok) cloudPatch.summary = results.summary.data;
    if (results?.segments?.ok) cloudPatch.segments = results.segments.data;
    if (Object.keys(cloudPatch).length) {
        const cloudSaved = await persistCloudFeaturePatch(bvid, settings, cloudPatch);
        if (cloudSaved) {
            if (Object.prototype.hasOwnProperty.call(cloudPatch, "summary")) {
                await incrementCloudVideoCallCount(bvid, settings, "summary");
            }
            if (Object.prototype.hasOwnProperty.call(cloudPatch, "segments")) {
                await incrementCloudVideoCallCount(bvid, settings, "segments");
            }
        }
    }
    const summaryOk = !!results?.summary?.ok;
    const segmentsOk = !!results?.segments?.ok;
    if (!summaryOk && !segmentsOk) {
        const error = pickSummarySegmentsFailureError(results);
        await reportDailyFeatureUsage("summary_segments_merged", settings, {
            durationMs: Date.now() - startedAt,
            tokens: 0
        }, resolveUsageStatusByError(error), resolveUsageErrorCode(error, "SUMMARY_SEGMENTS_FAILED"), {
            bvid,
            title: cache?.title || ""
        });
        throw error;
    }
    return results;
}

async function runChatForTab(tabId, text, messageId, requestedBvid = "") {
    const tabState = await getTabState(tabId);
    const bvid = normalizeBvid(requestedBvid || tabState?.activeBvid);
    if (!bvid) throw new Error("未获取到视频字幕");
    if (normalizeBvid(tabState?.activeBvid) !== bvid) {
        await updateTabState(tabId, { activeBvid: bvid, updatedAt: Date.now() });
    }
    await setTaskStatus(tabId, ["chat"], "processing");
    const resolvedSettings = await getResolvedSettings();
    await hydrateCloudCacheIfNeeded(bvid, ["subtitle"], resolvedSettings);
    const cache = await getCache(bvid);
    const history = Array.isArray(cache.history) ? cache.history : [];
    const key = `${bvid}|chat|${messageId}`;
    const startedAt = Date.now();
    logBackground.info("task_enqueue", { tab_id: tabId, bvid, tasks: ["chat"] });
    logBackground.info("task_start", { tab_id: tabId, bvid, task: "chat" });
    try {
        let lastMetrics = null;
        const answer = await runWithDedup(key, async () => {
            const subtitleText = getSubtitlePayload(cache);
            if (!subtitleText) throw createMissingSubtitleError();
            const recent = history.slice(-8);
            const conversation = recent.map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${item.content}`).join("\n");
            const prompt = `你是 B 站视频助手。基于字幕回答用户的问题，回答要准确、简洁。\n字幕：\n${subtitleText}\n历史：\n${conversation}\n用户问题：${text}`;
            logAIPromptBuilt({ bvid, task: "chat", provider: resolvedSettings.provider, mode: "chat", prompt, promptSettings: resolvedSettings.promptSettings });
            const aiRes = await callAIWithTimeout(resolvedSettings, [{ role: "user", content: prompt }], TASK_TIMEOUT_MS, { tabId });
            lastMetrics = aiRes.metrics || null;
            await appendMetrics(bvid, tabId, "chat", aiRes.metrics);
            await reportFeatureUsage("chat", bvid, resolvedSettings, aiRes.metrics);
            return aiRes.text.trim();
        });
        const mergedHistory = [
            ...history,
            { id: `u_${messageId}`, role: "user", content: text, createdAt: Date.now() },
            { id: `a_${messageId}`, role: "assistant", content: answer, metrics: lastMetrics || null, createdAt: Date.now() }
        ];
        await mergeCacheByBvid(bvid, { history: mergedHistory, updatedAt: Date.now() });
        await setTaskStatus(tabId, ["chat"], "done");
        logBackground.info("task_finish", { tab_id: tabId, bvid, tasks: ["chat"] });
        return { answer, metrics: lastMetrics || null };
    } catch (error) {
        const status = isTimeoutError(error) ? "timeout" : "error";
        await reportDailyFeatureUsage("chat", resolvedSettings, {
            durationMs: Date.now() - startedAt,
            tokens: 0
        }, resolveUsageStatusByError(error), resolveUsageErrorCode(error, "CHAT_FAILED"), {
            bvid,
            title: cache?.title || ""
        });
        if (status === "timeout") {
            logBackground.error("task_timeout", buildFailureLog(error, { tab_id: tabId, bvid, task: "chat", code: error?.code || "TIMEOUT" }));
        } else {
            logBackground.error("task_abort", buildFailureLog(error, { tab_id: tabId, bvid, task: "chat" }));
        }
        await setTaskStatus(tabId, ["chat"], status, error.message || "聊天失败");
        throw error;
    }
}

async function runChatForPort(port, msg) {
    const tabId = port?.sender?.tab?.id;
    if (!tabId) throw new Error("tabId 缺失");
    const text = String(msg?.text || "").trim();
    const messageId = String(msg?.messageId || "");
    if (!text || !messageId) throw new Error("聊天参数不完整");
    const tabState = await getTabState(tabId);
    const bvid = normalizeBvid(msg?.bvid || tabState?.activeBvid);
    if (!bvid) throw new Error("未获取到视频字幕");
    if (normalizeBvid(tabState?.activeBvid) !== bvid) {
        await updateTabState(tabId, { activeBvid: bvid, updatedAt: Date.now() });
    }
    await setTaskStatus(tabId, ["chat"], "processing");
    const resolvedSettings = await getResolvedSettings();
    await hydrateCloudCacheIfNeeded(bvid, ["subtitle"], resolvedSettings);
    const cache = await getCache(bvid);
    const history = Array.isArray(cache.history) ? cache.history : [];
    const key = `${bvid}|chat_stream|${messageId}`;
    const abortKey = `${tabId}|${messageId}`;
    const abortController = new AbortController();
    chatAbortControllers.set(abortKey, abortController);
    const startedAt = Date.now();
    logBackground.info("task_enqueue", { tab_id: tabId, bvid, tasks: ["chat_stream"] });
    logBackground.info("task_start", { tab_id: tabId, bvid, task: "chat_stream" });
    try {
        let lastMetrics = null;
        const answer = await runWithDedup(key, async () => {
            const subtitleText = getSubtitlePayload(cache);
            if (!subtitleText) throw createMissingSubtitleError();
            const recent = history.slice(-8);
            const conversation = recent.map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${item.content}`).join("\n");
            const prompt = `你是 B 站视频助手。基于字幕回答用户的问题，回答要准确、简洁。\n字幕：\n${subtitleText}\n历史：\n${conversation}\n用户问题：${text}`;
            logAIPromptBuilt({ bvid, task: "chat_stream", provider: resolvedSettings.provider, mode: "chat", prompt, promptSettings: resolvedSettings.promptSettings });
            let streamedAnswerText = "";
            const aiRes = await callAIWithTimeoutStream(resolvedSettings, [{ role: "user", content: prompt }], TASK_TIMEOUT_MS, (delta) => {
                const chunk = String(delta || "");
                streamedAnswerText += chunk;
                safePortPost(port, { type: "delta", messageId, delta: chunk });

            }, abortController, { tabId });
            lastMetrics = aiRes.metrics || null;
            await appendMetrics(bvid, tabId, "chat", aiRes.metrics);
            await reportFeatureUsage("chat", bvid, resolvedSettings, aiRes.metrics);
            return String(aiRes.text || streamedAnswerText || "").trim();
        });
        const mergedHistory = [
            ...history,
            { id: `u_${messageId}`, role: "user", content: text, createdAt: Date.now() },
            { id: `a_${messageId}`, role: "assistant", content: answer, metrics: lastMetrics || null, createdAt: Date.now() }
        ];
        await mergeCacheByBvid(bvid, { history: mergedHistory, updatedAt: Date.now() });
        await setTaskStatus(tabId, ["chat"], "done");
        safePortPost(port, { type: "done", messageId, answer, metrics: lastMetrics || null });
        logBackground.info("task_finish", { tab_id: tabId, bvid, tasks: ["chat_stream"] });
    } catch (error) {
        if (error?.code === "ABORTED") {
            await reportDailyFeatureUsage("chat", resolvedSettings, {
                durationMs: Date.now() - startedAt,
                tokens: 0
            }, "cancelled", "ABORTED", {
                bvid,
                title: cache?.title || ""
            });
            await setTaskStatus(tabId, ["chat"], "done");
            safePortPost(port, { type: "aborted", messageId });
            return;
        }
        const status = isTimeoutError(error) ? "timeout" : "error";
        await reportDailyFeatureUsage("chat", resolvedSettings, {
            durationMs: Date.now() - startedAt,
            tokens: 0
        }, resolveUsageStatusByError(error), resolveUsageErrorCode(error, "CHAT_STREAM_FAILED"), {
            bvid,
            title: cache?.title || ""
        });
        if (status === "timeout") {
            logBackground.error("task_timeout", buildFailureLog(error, { tab_id: tabId, bvid, task: "chat_stream", code: error?.code || "TIMEOUT" }));
        } else {
            logBackground.error("task_abort", buildFailureLog(error, { tab_id: tabId, bvid, task: "chat_stream" }));
        }
        await setTaskStatus(tabId, ["chat"], status, error.message || "聊天失败");
        safePortPost(port, { type: "error", messageId, error: error.message || "聊天失败" });
        throw error;
    } finally {
        chatAbortControllers.delete(abortKey);
    }
}

async function requestTaskResult(bvid, task, settings, taskContext = {}) {
    const cloudTasks = ["summary", "segments", "rumors"].includes(task) ? ["subtitle", task] : [task];
    await hydrateCloudCacheIfNeeded(bvid, cloudTasks, settings);
    const cache = await getCache(bvid);
    const subtitlePayloadOptions = task === "segments"
        ? { purpose: "segments", mode: "quality" }
        : { purpose: "general" };
    const subtitleText = getSubtitlePayload(cache, subtitlePayloadOptions);
    if (!subtitleText) throw createMissingSubtitleError();
    const promptTaskContext = { ...taskContext, noSubtitleTimestamps: isNoTimestampSubtitleCache(cache) };
    logSubtitlePayloadSelection(bvid, task, cache, subtitleText, subtitlePayloadOptions);
    const segmentPromptPlan = task === "segments"
        ? buildPrimarySegmentsPrompt({
            settings,
            cache,
            subtitleText,
            mode: settings.promptSettings?.mode || "guided",
            guided: settings.promptSettings?.guided || {},
            customPrompts: settings.promptSettings?.custom || {},
            taskContext,
            promptTaskContext
        })
        : null;
    const prompt = segmentPromptPlan?.prompt || buildPrompt({
            type: task,
            subtitle: subtitleText,
            mode: settings.promptSettings?.mode || "guided",
            guided: settings.promptSettings?.guided || {},
            customPrompts: settings.promptSettings?.custom || {},
            taskContext: promptTaskContext
        });
    logAIPromptBuilt({
        bvid,
        task,
        mode: "single",
        provider: settings.provider,
        prompt,
        promptSettings: settings.promptSettings
    });
    logAI.info("ai_request_start", {
        bvid,
        task,
        provider: settings.provider,
        model: settings.model || "",
        detail: {
            subtitle_chars: (segmentPromptPlan?.subtitleText || subtitleText).length,
            prompt_chars: prompt.length,
            prompt_mode: settings.promptSettings?.mode || "guided",
            pref_mode: settings.prefMode || "",
            compact_segments: !!segmentPromptPlan?.compact
        }
    });
    const aiRes = await callAIWithTimeout(settings, [{ role: "user", content: prompt }], TASK_TIMEOUT_MS, { tabId: taskContext.tabId });
    logAI.info("ai_request_success", {
        bvid,
        task,
        provider: settings.provider,
        model: settings.model || "",
        duration_ms: aiRes.metrics?.latencyMs || 0,
        detail: {
            tokens: aiRes.metrics?.tokens || 0,
            input_tokens: aiRes.metrics?.inputTokens || 0,
            output_tokens: aiRes.metrics?.outputTokens || 0,
            subtitle_chars: subtitleText.length,
            prompt_chars: prompt.length,
            output_chars: String(aiRes.text || "").length
        }
    });
    await appendMetrics(bvid, null, task, aiRes.metrics);
    await reportFeatureUsage(task, bvid, settings, aiRes.metrics);
    if (task === "summary") {
        const summaryText = sanitizeSummaryOutput(aiRes.text);
        if (!summaryText) throw createSummaryEmptyError();
        return summaryText;
    }
    if (task === "segments") {
        const parsed = robustJSONParse(aiRes.text);
        let finalParsed = parsed;
        let compactRetryNormalized = null;
        if (finalParsed) {
            logBackground.info("json_parse_success", { task: "segments", bvid });
        } else {
            const parseError = attachSentryContext(
                createSegmentsParseError(aiRes.text, aiRes.metrics),
                buildAIResponseSentryContext({
                    task: "segments",
                    bvid,
                    provider: settings.provider,
                    model: settings.model || "",
                    mode: "single",
                    source: "segments_single_parse",
                    responseText: aiRes.text,
                    metrics: aiRes.metrics
                })
            );
            logAI.error("json_parse_error", {
                task: "segments",
                bvid,
                code: parseError?.code || "JSON_PARSE_ERROR",
                detail: {
                    reason: "empty_result",
                    ...getSegmentsResponseDiagnostics(aiRes.text, aiRes.metrics)
                }
            });
            if (["SEGMENTS_OUTPUT_TRUNCATED", "SEGMENTS_EMPTY_RESPONSE"].includes(parseError?.code)) {
                compactRetryNormalized = await retrySegmentsWithCompactPrompt({
                    tabId: taskContext?.tabId || null,
                    bvid,
                    cache,
                    settings,
                    taskContext,
                    mode: "single",
                    originalError: parseError
                });
            } else {
                throw parseError;
            }
        }
        const normalized = compactRetryNormalized || normalizeSegments(finalParsed, cache, { bvid, task: "segments", mode: "single", allowLineOnly: shouldUseCompactSegmentsFirst(settings) });
        if (!normalized.length) {
            throw attachSentryContext(
                createSegmentsNormalizeError(parsed),
                buildAIResponseSentryContext({
                    task: "segments",
                    bvid,
                    provider: settings.provider,
                    model: settings.model || "",
                    mode: "single",
                    source: "segments_single_normalize",
                    responseText: aiRes.text,
                    metrics: aiRes.metrics
                })
            );
        }
        logSegmentQualitySummary(bvid, normalized, cache, { task: "segments", mode: "single", subtitlePayload: getSubtitlePayloadMeta(cache, subtitleText, subtitlePayloadOptions) });
        return normalized;
    }
    const parsed = robustJSONParse(aiRes.text);
    if (parsed) {
        logBackground.info("json_parse_success", { task: "rumors", bvid });
    } else {
        logAI.error("json_parse_error", { task: "rumors", bvid, code: "JSON_PARSE_ERROR", detail: { reason: "empty_result" } });
    }
    const normalized = normalizeRumors(parsed, cache);
    if (!normalized) {
        throw attachSentryContext(
            createAppError("JSON_PARSE_ERROR", "验真 JSON 解析失败"),
            buildAIResponseSentryContext({
                task: "rumors",
                bvid,
                provider: settings.provider,
                model: settings.model || "",
                mode: "single",
                source: "rumors_parse",
                responseText: aiRes.text,
                metrics: aiRes.metrics
            })
        );
    }
    logRumorsQualitySummary(bvid, normalized, { mode: "single", outputChars: String(aiRes.text || "").length });
    return normalized;
}

function createSummarySegmentsResult() {
    return {
        summary: { ok: false, data: null, error: null },
        segments: { ok: false, data: null, error: null }
    };
}

function sanitizeSummaryOutput(text) {
    let value = String(text || "").trim();
    if (!value) return "";
    value = value
        .replace(/<<<\s*SUMMARY_START\s*>>>/gi, "")
        .replace(/<<<\s*SUMMARY_END\s*>>>/gi, "")
        .replace(/<<<\s*SEGMENTS_START\s*>>>[\s\S]*$/gi, "")
        .replace(/【\s*SUMMARY_START\s*】/gi, "")
        .replace(/【\s*SUMMARY_END\s*】/gi, "")
        .trim();
    const firstBoldHeading = value.search(/\*\*[^*\n]{2,40}\*\*/);
    const leading = firstBoldHeading > 0 ? value.slice(0, firstBoldHeading) : "";
    const hasPlanningPreamble = /让我|我将|需要输出|下面(?:是|为)|根据字幕|视频的核心观点|先来分析|我来梳理/.test(leading);
    if (hasPlanningPreamble) {
        value = value.slice(firstBoldHeading).trim();
    }
    return value;
}

function isLikelyContextTooLongError(error) {
    const message = String(error?.message || error || "");
    return /context length|maximum context|max context|too many tokens|prompt too long|input too long|context_length_exceeded|上下文|提示词.*长|内容.*过长/i.test(message);
}

function isLikelyTruncatedSegmentOutput(text, metrics = {}) {
    const value = String(text || "").trim();
    const outputTokens = Number(metrics?.outputTokens || metrics?.output_tokens || 0);
    if (outputTokens >= 4000) return true;
    if (!value) return false;
    const opens = (value.match(/[\[{]/g) || []).length;
    const closes = (value.match(/[\]}]/g) || []).length;
    if (opens > closes) return true;
    if (/<<<\s*SEGMENTS_START\s*>>>/i.test(value) && !/<<<\s*SEGMENTS_END\s*>>>/i.test(value)) return true;
    if (/SEGMENTS_START/i.test(value) && !/SEGMENTS_END/i.test(value)) return true;
    return false;
}

function getSegmentCandidateList(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== "object") return null;
    const candidates = [
        parsed.segments,
        parsed.chapters,
        parsed.sections,
        parsed.items,
        parsed.data,
        parsed.result,
        parsed.分段,
        parsed.章节
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
        const nested = getSegmentCandidateList(candidate);
        if (nested) return nested;
    }
    return null;
}

function createSegmentsParseError(text, metrics = {}) {
    const value = String(text || "").trim();
    if (!value) {
        return createAppError("SEGMENTS_EMPTY_RESPONSE", "模型没有返回分段内容");
    }
    if (isLikelyTruncatedSegmentOutput(value, metrics)) {
        return createAppError("SEGMENTS_OUTPUT_TRUNCATED", "分段输出被截断");
    }
    return createAppError("SEGMENTS_JSON_PARSE_FAILED", "分段格式解析失败");
}

function getSegmentsResponseDiagnostics(text, metrics = {}) {
    const value = String(text || "");
    const trimmed = value.trim();
    return {
        response_chars: value.length,
        trimmed_chars: trimmed.length,
        line_count: trimmed ? trimmed.split(/\r?\n/).filter(Boolean).length : 0,
        output_tokens: Number(metrics?.outputTokens || 0) || 0,
        has_json_array_hint: /\[\s*\{/.test(trimmed),
        has_json_object_hint: /^\s*\{/.test(trimmed),
        has_protocol_markers: /SEGMENTS_START|SEGMENTS_END|<<<SEGMENTS_START>>>|<<<SEGMENTS_END>>>|【SEGMENTS_START】|【SEGMENTS_END】/i.test(trimmed),
        preview_head: trimmed.slice(0, 180),
        preview_tail: trimmed.length > 180 ? trimmed.slice(-180) : trimmed
    };
}

function createSegmentsNormalizeError(parsed) {
    const candidateList = getSegmentCandidateList(parsed);
    if (Array.isArray(candidateList) && candidateList.length === 0) {
        return createAppError("SEGMENTS_EMPTY_LIST", "模型没有生成有效分段");
    }
    return createAppError("SEGMENTS_INVALID_SCHEMA", "分段字段不完整");
}

function createSegmentsMissingProtocolError(fullText, metrics = {}) {
    if (isLikelyTruncatedSegmentOutput(fullText, metrics)) {
        return createAppError("SEGMENTS_OUTPUT_TRUNCATED", "分段输出被截断");
    }
    return createAppError("SEGMENTS_MISSING_PROTOCOL", "模型漏掉了分段部分");
}

function normalizeSegmentsTaskError(error) {
    if (isLikelyContextTooLongError(error)) {
        return createAppError("SEGMENTS_CONTEXT_TOO_LONG", "字幕内容过长，模型装不下", {
            cause: error
        });
    }
    return error;
}

function createSummaryEmptyError() {
    return createAppError("SUMMARY_EMPTY_RESPONSE", "模型没有返回总结内容");
}

function pickSummarySegmentsFailureError(results) {
    const summaryError = results?.summary?.error || null;
    const segmentsError = results?.segments?.error || null;
    const segmentsCode = String(segmentsError?.code || "");
    if (segmentsCode.startsWith("SEGMENTS_")) return segmentsError;
    return summaryError || segmentsError || new Error("生成失败");
}

function shouldUseCompactSegmentsFirst(settings = {}) {
    return String(settings?.provider || "").toLowerCase() === "openrouter"
        && String(settings?.model || "").toLowerCase() === "openrouter/free";
}

function buildPrimarySegmentsPrompt({ settings, cache, subtitleText, mode, guided, customPrompts, taskContext, promptTaskContext }) {
    if (shouldUseCompactSegmentsFirst(settings)) {
        const compactSubtitle = buildCompactSegmentsSubtitlePayload(cache, 40000) || subtitleText;
        return {
            prompt: buildCompactSegmentsPrompt({ subtitle: compactSubtitle, taskContext: promptTaskContext }),
            subtitleText: compactSubtitle,
            compact: true
        };
    }
    return {
        prompt: isSegmentPromptTestEnabled(settings)
            ? buildSegmentsAdTestPrompt({ subtitle: subtitleText, taskContext: promptTaskContext })
            : buildPrompt({ type: "segments", subtitle: subtitleText, mode, guided, customPrompts, taskContext: promptTaskContext }),
        subtitleText,
        compact: false
    };
}

async function retrySegmentsWithCompactPrompt({ tabId, bvid, cache, settings, taskContext, mode, originalError }) {
    const compactSubtitle = buildCompactSegmentsSubtitlePayload(cache, 40000);
    if (!compactSubtitle) throw originalError || createSegmentsParseError("");
    const promptTaskContext = { ...taskContext, noSubtitleTimestamps: isNoTimestampSubtitleCache(cache) };
    const compactPrompt = buildCompactSegmentsPrompt({ subtitle: compactSubtitle, taskContext: promptTaskContext });
    logAI.warn("segments_compact_retry_start", {
        bvid,
        task: "segments",
        provider: settings.provider,
        model: settings.model || "",
        code: originalError?.code || "",
        detail: {
            mode,
            subtitle_chars: compactSubtitle.length,
            prompt_chars: compactPrompt.length
        }
    });
    const aiRes = await callAIWithTimeout(settings, [{ role: "user", content: compactPrompt }], TASK_TIMEOUT_MS, { bypassQueue: true, tabId });
    const parsed = robustJSONParse(aiRes.text);
    if (!parsed) {
        const parseError = attachSentryContext(
            createSegmentsParseError(aiRes.text, aiRes.metrics),
            buildAIResponseSentryContext({
                task: "segments",
                bvid,
                provider: settings.provider,
                model: settings.model || "",
                mode: `${mode}_compact_retry`,
                source: "segments_compact_retry_parse",
                responseText: aiRes.text,
                metrics: aiRes.metrics
            })
        );
        logAI.error("segments_compact_retry_parse_error", {
            bvid,
            task: "segments",
            code: parseError?.code || "JSON_PARSE_ERROR",
            detail: {
                mode,
                ...getSegmentsResponseDiagnostics(aiRes.text, aiRes.metrics)
            }
        });
        throw parseError;
    }
    const normalized = normalizeSegments(parsed, cache, { bvid, task: "segments", mode: `${mode}_compact_retry`, allowLineOnly: true });
    if (!normalized.length) {
        throw attachSentryContext(
            createSegmentsNormalizeError(parsed),
            buildAIResponseSentryContext({
                task: "segments",
                bvid,
                provider: settings.provider,
                model: settings.model || "",
                mode: `${mode}_compact_retry`,
                source: "segments_compact_retry_normalize",
                responseText: aiRes.text,
                metrics: aiRes.metrics
            })
        );
    }
    logSegmentQualitySummary(bvid, normalized, cache, {
        task: "segments",
        mode: `${mode}_compact_retry`,
        subtitlePayload: {
            source: "raw_indexed_compact_retry",
            purpose: "segments",
            mode,
            payload_chars: compactSubtitle.length,
            max_chars: 40000,
            no_timestamp: isNoTimestampSubtitleCache(cache),
            raw_count: Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle.length : 0,
            processed_count: Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle.length : 0
        }
    });
    await appendMetrics(bvid, null, "segments", aiRes.metrics);
    await reportFeatureUsage("segments", bvid, settings, aiRes.metrics);
    logAI.info("segments_compact_retry_success", {
        bvid,
        task: "segments",
        provider: settings.provider,
        model: settings.model || "",
        duration_ms: aiRes.metrics?.latencyMs || 0,
        detail: {
            mode,
            output_chars: String(aiRes.text || "").length,
            segment_count: normalized.length
        }
    });
    return normalized;
}

function resolveStatusByError(error) {
    return isTimeoutError(error) ? "timeout" : "error";
}

function resolveUsageStatusByError(error) {
    if (error?.code === "ABORTED" || error?.code === "USER_CANCELLED") return "cancelled";
    if (isTimeoutError(error)) return "timeout";
    return "failed";
}

function resolveUsageErrorCode(error, fallback = "UNKNOWN") {
    return String(error?.code || fallback || "UNKNOWN").trim() || "UNKNOWN";
}

async function setTaskStatusMap(tabId, statusMap, lastError = "", errorMap = {}) {
    const current = await getTabState(tabId);
    const taskStatus = { ...(current?.taskStatus || {}) };
    const taskErrors = { ...(current?.taskErrors || {}) };
    for (const task of Object.keys(statusMap || {})) {
        const status = statusMap[task];
        if (!status) continue;
        taskStatus[task] = status;
        if (status === "error" || status === "timeout") {
            const taskError = errorMap?.[task];
            await captureTaskFailureToSentry(taskError, {
                source: "task_status_update",
                task,
                tabId,
                bvid: String(current?.activeBvid || ""),
                status
            });
            taskErrors[task] = taskError ? serializeAppError(taskError) : {
                message: String(lastError || "任务失败"),
                code: "",
                status: undefined,
                retryAfterSec: undefined
            };
        } else {
            delete taskErrors[task];
        }
    }
    await updateTabState(tabId, { taskStatus, taskErrors, lastError, updatedAt: Date.now() });
}

async function applySummarySegmentsResults(tabId, bvid, results, options = {}) {
    const summaryResult = results?.summary;
    const segmentsResult = results?.segments;
    const keepProcessingTasks = new Set(Array.isArray(options.keepProcessingTasks) ? options.keepProcessingTasks : []);
    const statusMap = {};
    const errorMap = {};
    const cachePatch = {};
    let lastError = "";

    if (summaryResult) {
        if (summaryResult.ok) {
            cachePatch.summary = String(summaryResult.data || "");
            cachePatch.summaryCacheSource = "local";
            statusMap.summary = "done";
        } else if (keepProcessingTasks.has("summary")) {
            statusMap.summary = "processing";
        } else if (summaryResult.error) {
            statusMap.summary = resolveStatusByError(summaryResult.error);
            errorMap.summary = summaryResult.error;
            lastError = lastError || summaryResult.error.message || "任务失败";
        }
    }

    if (segmentsResult) {
        if (segmentsResult.ok) {
            cachePatch.segments = Array.isArray(segmentsResult.data) ? segmentsResult.data : [];
            cachePatch.segmentsCacheSource = "local";
            statusMap.segments = "done";
        } else if (keepProcessingTasks.has("segments")) {
            statusMap.segments = "processing";
        } else if (segmentsResult.error) {
            statusMap.segments = resolveStatusByError(segmentsResult.error);
            errorMap.segments = segmentsResult.error;
            lastError = lastError || segmentsResult.error.message || "任务失败";
        }
    }

    if (Object.keys(cachePatch).length) {
        await mergeCacheByBvid(bvid, { ...cachePatch, updatedAt: Date.now() });
    }
    if (Object.keys(statusMap).length) {
        await setTaskStatusMap(tabId, statusMap, lastError, errorMap);
    }
}

async function runSummarySegmentsInQuality(tabId, bvid, force, settings, taskContext = {}) {
    const cache = await getCache(bvid);
    const summarySubtitleOptions = { purpose: "general" };
    const segmentsSubtitleOptions = { purpose: "segments", mode: "quality" };
    const summarySubtitleText = getSubtitlePayload(cache, summarySubtitleOptions);
    const segmentsSubtitleText = getSubtitlePayload(cache, segmentsSubtitleOptions);
    if (!summarySubtitleText && !segmentsSubtitleText) throw createMissingSubtitleError();
    const promptTaskContext = { ...taskContext, noSubtitleTimestamps: isNoTimestampSubtitleCache(cache) };
    logSubtitlePayloadSelection(bvid, "summary", cache, summarySubtitleText, summarySubtitleOptions);
    logSubtitlePayloadSelection(bvid, "segments", cache, segmentsSubtitleText, segmentsSubtitleOptions);
    const mode = settings.promptSettings?.mode || "guided";
    const guided = settings.promptSettings?.guided || {};
    const customPrompts = settings.promptSettings?.custom || {};
    const results = createSummarySegmentsResult();
    async function writeStreamingSummaryPartial(text, state, forceWrite = false) {
        const value = String(text || "").trim();
        if (!value) return;
        const now = Date.now();
        if (!forceWrite && now - Number(state.lastWriteAt || 0) < 350) return;
        state.lastWriteAt = now;
        await mergeCacheByBvid(bvid, {
            summary: value,
            summaryCacheSource: "local",
            updatedAt: now
        });
    }
    const summaryExists = !force && String(cache?.summary || "").trim();
    const segmentsExists = !force && Array.isArray(cache?.segments) && cache.segments.length > 0;
    if (summaryExists || segmentsExists) {
        if (summaryExists) {
            results.summary = { ok: true, data: String(cache.summary || ""), error: null };
        }
        if (segmentsExists) {
            results.segments = { ok: true, data: cache.segments, error: null };
        }
        const keepProcessingTasks = [];
        if (!summaryExists) keepProcessingTasks.push("summary");
        if (!segmentsExists) keepProcessingTasks.push("segments");
        await applySummarySegmentsResults(
            tabId,
            bvid,
            {
                summary: summaryExists ? results.summary : null,
                segments: segmentsExists ? results.segments : null
            },
            { keepProcessingTasks }
        );
    }

    const tasks = [];
    if (summaryExists) {
        results.summary = { ok: true, data: String(cache.summary || ""), error: null };
    } else {
        const summaryPrompt = buildPrompt({ type: "summary", subtitle: summarySubtitleText, mode, guided, customPrompts, taskContext: promptTaskContext });
        logAIPromptBuilt({ bvid, task: "summary", provider: settings.provider, mode: "quality", prompt: summaryPrompt, promptSettings: settings.promptSettings });
        tasks.push((async () => {
            try {
                logAI.info("ai_request_start", {
                    bvid,
                    task: "summary",
                    provider: settings.provider,
                    model: settings.model || "",
                    detail: {
                        mode: "quality",
                        subtitle_chars: summarySubtitleText.length,
                        prompt_chars: summaryPrompt.length,
                        prompt_mode: mode,
                        pref_mode: settings.prefMode || ""
                    }
                });
                let streamedSummaryText = "";
                let partialWritePromise = Promise.resolve();
                const partialState = { lastWriteAt: 0 };
                const aiRes = await callAIWithTimeoutStream(settings, [{ role: "user", content: summaryPrompt }], TASK_TIMEOUT_MS, (delta) => {
                    const chunk = String(delta || "");
                    if (!chunk) return;
                    streamedSummaryText += chunk;
                    partialWritePromise = partialWritePromise
                        .catch(() => {})
                        .then(() => writeStreamingSummaryPartial(streamedSummaryText, partialState, false));
                }, null, { tabId });
                await partialWritePromise.catch(() => {});
                const summaryText = sanitizeSummaryOutput(aiRes.text || streamedSummaryText);
                if (!summaryText) {
                    logAI.error("summary_empty", {
                        bvid,
                        task: "summary",
                        code: "SUMMARY_EMPTY_RESPONSE",
                        provider: settings.provider,
                        model: settings.model || "",
                        detail: {
                            mode: "quality",
                            response_text_chars: String(aiRes.text || "").length,
                            streamed_text_chars: String(streamedSummaryText || "").length,
                            subtitle_chars: summarySubtitleText.length,
                            prompt_chars: summaryPrompt.length
                        }
                    });
                    throw createSummaryEmptyError();
                }
                await writeStreamingSummaryPartial(summaryText, partialState, true);
                logSummaryQualitySummary(bvid, summaryText, {
                    subtitleChars: summarySubtitleText.length,
                    promptChars: summaryPrompt.length,
                    promptMode: mode,
                    fromCache: false
                });
                await appendMetrics(bvid, null, "summary", aiRes.metrics);
                await reportFeatureUsage("summary", bvid, settings, aiRes.metrics);
                results.summary = { ok: true, data: summaryText, error: null };
                await applySummarySegmentsResults(tabId, bvid, { summary: results.summary });
                logAI.info("ai_request_success", {
                    bvid,
                    task: "summary",
                    provider: settings.provider,
                    model: settings.model || "",
                    duration_ms: aiRes.metrics?.latencyMs || 0,
                    detail: {
                        mode: "quality",
                        tokens: aiRes.metrics?.tokens || 0,
                        input_tokens: aiRes.metrics?.inputTokens || 0,
                        output_tokens: aiRes.metrics?.outputTokens || 0,
                        subtitle_chars: summarySubtitleText.length,
                        prompt_chars: summaryPrompt.length,
                        output_chars: summaryText.length
                    }
                });
            } catch (error) {
                results.summary = { ok: false, data: null, error };
                await applySummarySegmentsResults(tabId, bvid, { summary: results.summary });
                logAI.error("ai_request_failed", buildFailureLog(error, {
                    task: "summary",
                    bvid,
                    provider: settings.provider,
                    model: settings.model || "",
                    detail: {
                        mode: "quality",
                        subtitle_chars: summarySubtitleText.length,
                        prompt_chars: summaryPrompt.length,
                        prompt_mode: mode
                    }
                }));
            }
        })());
    }

    if (segmentsExists) {
        results.segments = { ok: true, data: cache.segments, error: null };
    } else {
        const segmentPromptPlan = buildPrimarySegmentsPrompt({
            settings,
            cache,
            subtitleText: segmentsSubtitleText || summarySubtitleText,
            mode,
            guided,
            customPrompts,
            taskContext,
            promptTaskContext
        });
        const segmentsPrompt = segmentPromptPlan.prompt;
        const effectiveSegmentsSubtitleText = segmentPromptPlan.subtitleText || segmentsSubtitleText || summarySubtitleText;
        logAIPromptBuilt({ bvid, task: "segments", provider: settings.provider, mode: "quality", prompt: segmentsPrompt, promptSettings: settings.promptSettings });
        tasks.push((async () => {
            try {
                logAI.info("ai_request_start", {
                    bvid,
                    task: "segments",
                    provider: settings.provider,
                    model: settings.model || "",
                    detail: {
                        mode: "quality",
                        subtitle_chars: effectiveSegmentsSubtitleText.length,
                        prompt_chars: segmentsPrompt.length,
                        prompt_mode: mode,
                        pref_mode: settings.prefMode || "",
                        compact_segments: !!segmentPromptPlan.compact
                    }
                });
                const aiRes = await callAIWithTimeout(settings, [{ role: "user", content: segmentsPrompt }], TASK_TIMEOUT_MS, { bypassQueue: true, tabId });
                const parsed = robustJSONParse(aiRes.text);
                if (!parsed) {
                    throw attachSentryContext(
                        createSegmentsParseError(aiRes.text, aiRes.metrics),
                        buildAIResponseSentryContext({
                            task: "segments",
                            bvid,
                            provider: settings.provider,
                            model: settings.model || "",
                            mode: "quality",
                            source: segmentPromptPlan.compact ? "segments_quality_compact_primary_parse" : "segments_quality_parse",
                            responseText: aiRes.text,
                            metrics: aiRes.metrics,
                            extra: {
                                compact_segments: !!segmentPromptPlan.compact
                            }
                        })
                    );
                }
                const normalized = normalizeSegments(parsed, cache, { bvid, task: "segments", mode: "quality", allowLineOnly: !!segmentPromptPlan.compact });
                if (!normalized.length) {
                    throw attachSentryContext(
                        createSegmentsNormalizeError(parsed),
                        buildAIResponseSentryContext({
                            task: "segments",
                            bvid,
                            provider: settings.provider,
                            model: settings.model || "",
                            mode: "quality",
                            source: segmentPromptPlan.compact ? "segments_quality_compact_primary_normalize" : "segments_quality_normalize",
                            responseText: aiRes.text,
                            metrics: aiRes.metrics,
                            extra: {
                                compact_segments: !!segmentPromptPlan.compact
                            }
                        })
                    );
                }
                logSegmentQualitySummary(bvid, normalized, cache, {
                    task: "segments",
                    mode: segmentPromptPlan.compact ? "quality_compact_primary" : "quality",
                    subtitlePayload: segmentPromptPlan.compact
                        ? {
                            source: "raw_indexed_compact_primary",
                            purpose: "segments",
                            mode: "quality",
                            payload_chars: effectiveSegmentsSubtitleText.length,
                            max_chars: 40000,
                            no_timestamp: isNoTimestampSubtitleCache(cache),
                            raw_count: Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle.length : 0,
                            processed_count: Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle.length : 0
                        }
                        : getSubtitlePayloadMeta(cache, segmentsSubtitleText || summarySubtitleText, segmentsSubtitleOptions)
                });
                await appendMetrics(bvid, null, "segments", aiRes.metrics);
                await reportFeatureUsage("segments", bvid, settings, aiRes.metrics);
                results.segments = { ok: true, data: normalized, error: null };
                await applySummarySegmentsResults(tabId, bvid, { segments: results.segments });
                logAI.info("ai_request_success", {
                    bvid,
                    task: "segments",
                    provider: settings.provider,
                    model: settings.model || "",
                    duration_ms: aiRes.metrics?.latencyMs || 0,
                    detail: {
                        mode: "quality",
                        tokens: aiRes.metrics?.tokens || 0,
                        input_tokens: aiRes.metrics?.inputTokens || 0,
                        output_tokens: aiRes.metrics?.outputTokens || 0,
                        subtitle_chars: effectiveSegmentsSubtitleText.length,
                        prompt_chars: segmentsPrompt.length,
                        output_chars: String(aiRes.text || "").length,
                        compact_segments: !!segmentPromptPlan.compact
                    }
                });
            } catch (error) {
                let segmentError = normalizeSegmentsTaskError(error);
                if (["SEGMENTS_OUTPUT_TRUNCATED", "SEGMENTS_EMPTY_RESPONSE"].includes(segmentError?.code)) {
                    try {
                        const normalized = await retrySegmentsWithCompactPrompt({
                            tabId,
                            bvid,
                            cache,
                            settings,
                            taskContext,
                            mode: "quality",
                            originalError: segmentError
                        });
                        results.segments = { ok: true, data: normalized, error: null };
                        await applySummarySegmentsResults(tabId, bvid, { segments: results.segments });
                        return;
                    } catch (retryError) {
                        segmentError = normalizeSegmentsTaskError(retryError);
                        logAI.warn("segments_compact_retry_failed", buildFailureLog(segmentError, {
                            task: "segments",
                            bvid,
                            provider: settings.provider,
                            model: settings.model || "",
                            detail: {
                                mode: "quality"
                            }
                        }));
                    }
                }
                results.segments = { ok: false, data: null, error: segmentError };
                await applySummarySegmentsResults(tabId, bvid, { segments: results.segments });
                logAI.error("ai_request_failed", buildFailureLog(segmentError, {
                    task: "segments",
                    bvid,
                    provider: settings.provider,
                    model: settings.model || "",
                    detail: {
                        mode: "quality",
                        subtitle_chars: (segmentsSubtitleText || summarySubtitleText).length,
                        prompt_chars: segmentsPrompt.length,
                        prompt_mode: mode
                    }
                }));
            }
        })());
    }

    if (tasks.length) {
        await Promise.allSettled(tasks);
        if (results.summary?.error) {
            await reportDailyFeatureUsage("summary", settings, { tokens: 0 }, resolveUsageStatusByError(results.summary.error), resolveUsageErrorCode(results.summary.error, "SUMMARY_FAILED"), {
                bvid,
                title: cache?.title || ""
            });
        }
        if (results.segments?.error) {
            await reportDailyFeatureUsage("segments", settings, { tokens: 0 }, resolveUsageStatusByError(results.segments.error), resolveUsageErrorCode(results.segments.error, "SEGMENTS_FAILED"), {
                bvid,
                title: cache?.title || ""
            });
        }
    } else {
        await applySummarySegmentsResults(tabId, bvid, results);
    }
    return results;
}

async function runSummarySegmentsInEfficiency(tabId, bvid, force, settings, taskContext = {}) {
    const cache = await getCache(bvid);
    const subtitlePayloadOptions = { purpose: "segments", mode: "efficiency" };
    const subtitleText = getSubtitlePayload(cache, subtitlePayloadOptions);
    if (!subtitleText) throw createMissingSubtitleError();
    const promptTaskContext = { ...taskContext, noSubtitleTimestamps: isNoTimestampSubtitleCache(cache) };
    logSubtitlePayloadSelection(bvid, "summary_segments_merged", cache, subtitleText, subtitlePayloadOptions);
    if (!force && String(cache?.summary || "").trim() && Array.isArray(cache?.segments) && cache.segments.length) {
        const cached = {
            summary: { ok: true, data: String(cache.summary || ""), error: null },
            segments: { ok: true, data: cache.segments, error: null }
        };
        await applySummarySegmentsResults(tabId, bvid, cached);
        return cached;
    }

    const mode = settings.promptSettings?.mode || "guided";
    const guided = settings.promptSettings?.guided || {};
    const customPrompts = settings.promptSettings?.custom || {};
    const prompt = buildMergedSummarySegmentsPrompt({
        subtitle: subtitleText,
        mode,
        guided,
        customPrompts,
        taskContext: promptTaskContext,
        segmentsPromptOverride: isSegmentPromptTestEnabled(settings) ? SEGMENTS_AD_TEST_PROMPT : ""
    });
    logAIPromptBuilt({
        bvid,
        task: "summary_segments_merged",
        provider: settings.provider,
        mode: "efficiency",
        prompt,
        promptSettings: settings.promptSettings
    });

    const results = createSummarySegmentsResult();
    let streamBuffer = "";
    let summaryApplied = false;
    let summaryApplyPromise = Promise.resolve();
    const requestStartedAt = Date.now();
    let firstChunkMs = 0;
    try {
        logAI.info("ai_request_start", {
            bvid,
            task: "summary_segments_merged",
            provider: settings.provider,
            model: settings.model || "",
            detail: {
                mode: "efficiency",
                subtitle_chars: subtitleText.length,
                prompt_chars: prompt.length,
                prompt_mode: mode,
                pref_mode: settings.prefMode || ""
            }
        });
        const aiRes = await callAIWithTimeoutStream(settings, [{ role: "user", content: prompt }], EFFICIENCY_TASK_TIMEOUT_MS, (delta) => {
            if (!firstChunkMs) {
                firstChunkMs = Date.now() - requestStartedAt;
                logAI.info("ai_first_chunk", {
                    bvid,
                    task: "summary_segments_merged",
                    provider: settings.provider,
                    model: settings.model || "",
                    duration_ms: firstChunkMs,
                    detail: {
                        mode: "efficiency"
                    }
                });
            }
            streamBuffer += String(delta || "");
            if (summaryApplied) return;
            const section = extractProtocolSection(streamBuffer, "<<<SUMMARY_START>>>", "<<<SUMMARY_END>>>");
            if (!section.found) return;
            const summaryText = sanitizeSummaryOutput(section.content);
            if (!summaryText) return;
            summaryApplied = true;
            results.summary = { ok: true, data: summaryText, error: null };
            summaryApplyPromise = applySummarySegmentsResults(tabId, bvid, { summary: results.summary }, { keepProcessingTasks: ["segments"] });
        }, null, { tabId });
        await summaryApplyPromise;
        const fullText = String(streamBuffer || aiRes.text || "");
        logAI.debug("ai_stream_buffer_summary", {
            bvid,
            task: "summary_segments_merged",
            detail: {
                stream_buffer_chars: streamBuffer.length,
                response_text_chars: String(aiRes?.text || "").length,
                full_text_chars: fullText.length
            }
        });
        const summarySection = extractProtocolSection(fullText, "<<<SUMMARY_START>>>", "<<<SUMMARY_END>>>");
        if (!results.summary.ok && summarySection.found) {
            const summaryText = sanitizeSummaryOutput(summarySection.content);
            if (summaryText) {
                results.summary = { ok: true, data: summaryText, error: null };
                await applySummarySegmentsResults(tabId, bvid, { summary: results.summary }, { keepProcessingTasks: ["segments"] });
            }
        }
        const segmentsSection = extractFirstProtocolSection(fullText, [
            ["<<<SEGMENTS_START>>>", "<<<SEGMENTS_END>>>"],
            ["SEGMENTS_START", "SEGMENTS_END"],
            ["【SEGMENTS_START】", "【SEGMENTS_END】"]
        ]);
        let segmentsResolved = false;
        let segmentsFailureError = null;
        if (segmentsSection && segmentsSection.found) {
            const parsed = robustJSONParse(segmentsSection.content);
            if (!parsed) {
                segmentsFailureError = attachSentryContext(
                    createSegmentsParseError(segmentsSection.content, aiRes.metrics),
                    buildAIResponseSentryContext({
                        task: "segments",
                        bvid,
                        provider: settings.provider,
                        model: settings.model || "",
                        mode: "efficiency",
                        source: "segments_merged_protocol_section_parse",
                        responseText: segmentsSection.content,
                        metrics: aiRes.metrics
                    })
                );
                logAI.error("segments_merged_section_parse_error", {
                    bvid,
                    task: "segments",
                    code: segmentsFailureError?.code || "JSON_PARSE_ERROR",
                    detail: {
                        mode: "efficiency",
                        source: "protocol_section",
                        ...getSegmentsResponseDiagnostics(segmentsSection.content, aiRes.metrics)
                    }
                });
            } else {
                const cache = await getCache(bvid);
                const normalized = normalizeSegments(parsed, cache, { bvid, task: "segments", mode: "efficiency" });
                if (normalized.length) {
                    results.segments = { ok: true, data: normalized, error: null };
                    segmentsResolved = true;
                    segmentsFailureError = null;
                    logSegmentQualitySummary(bvid, normalized, cache, {
                        task: "segments",
                        mode: "efficiency",
                        subtitlePayload: getSubtitlePayloadMeta(cache, subtitleText, subtitlePayloadOptions)
                    });
                } else {
                    segmentsFailureError = attachSentryContext(
                        createSegmentsNormalizeError(parsed),
                        buildAIResponseSentryContext({
                            task: "segments",
                            bvid,
                            provider: settings.provider,
                            model: settings.model || "",
                            mode: "efficiency",
                            source: "segments_merged_protocol_section_normalize",
                            responseText: segmentsSection.content,
                            metrics: aiRes.metrics
                        })
                    );
                }
            }
        }
        if (!segmentsResolved) {
            const jsonMatch = fullText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
            if (jsonMatch) {
                const parsed = robustJSONParse(jsonMatch[0]);
                const cache = await getCache(bvid);
                const normalized = normalizeSegments(parsed, cache, { bvid, task: "segments", mode: "efficiency", fallback: "loose_json_array" });
                if (normalized.length) {
                    results.segments = { ok: true, data: normalized, error: null };
                    segmentsResolved = true;
                    segmentsFailureError = null;
                    logSegmentQualitySummary(bvid, normalized, cache, {
                        task: "segments",
                        mode: "efficiency",
                        fallback: "loose_json_array",
                        subtitlePayload: getSubtitlePayloadMeta(cache, subtitleText, subtitlePayloadOptions)
                    });
                }
            }
        }
        if (!segmentsResolved && !segmentsFailureError) {
            segmentsFailureError = attachSentryContext(
                createSegmentsMissingProtocolError(fullText, aiRes.metrics),
                buildAIResponseSentryContext({
                    task: "segments",
                    bvid,
                    provider: settings.provider,
                    model: settings.model || "",
                    mode: "efficiency",
                    source: "segments_merged_protocol_missing",
                    responseText: fullText,
                    metrics: aiRes.metrics
                })
            );
            logAI.error("segments_merged_protocol_missing", {
                bvid,
                task: "segments",
                code: segmentsFailureError?.code || "SEGMENTS_MISSING_PROTOCOL",
                detail: {
                    mode: "efficiency",
                    source: "merged_output",
                    ...getSegmentsResponseDiagnostics(fullText, aiRes.metrics)
                }
            });
        }
        if (!segmentsResolved) {
            try {
                const fallbackPrompt = isSegmentPromptTestEnabled(settings)
                    ? buildSegmentsAdTestPrompt({ subtitle: subtitleText, taskContext: promptTaskContext })
                    : buildPrompt({ type: "segments", subtitle: subtitleText, mode, guided, customPrompts, taskContext: promptTaskContext });
                logAI.warn("segments_merged_parse_fallback_start", {
                    bvid,
                    task: "segments",
                    provider: settings.provider,
                    model: settings.model || "",
                    detail: {
                        mode: "efficiency",
                        prompt_chars: fallbackPrompt.length,
                        merged_output_chars: fullText.length
                    }
                });
                const fallbackRes = await callAIWithTimeout(settings, [{ role: "user", content: fallbackPrompt }], TASK_TIMEOUT_MS, { bypassQueue: true, tabId });
                const parsed = robustJSONParse(fallbackRes.text);
                if (!parsed) {
                    segmentsFailureError = attachSentryContext(
                        createSegmentsParseError(fallbackRes.text, fallbackRes.metrics),
                        buildAIResponseSentryContext({
                            task: "segments",
                            bvid,
                            provider: settings.provider,
                            model: settings.model || "",
                            mode: "efficiency_fallback",
                            source: "segments_merged_fallback_parse",
                            responseText: fallbackRes.text,
                            metrics: fallbackRes.metrics
                        })
                    );
                    logAI.error("segments_merged_fallback_parse_error", {
                        bvid,
                        task: "segments",
                        code: segmentsFailureError?.code || "JSON_PARSE_ERROR",
                        detail: {
                            mode: "efficiency_fallback",
                            source: "fallback_prompt",
                            ...getSegmentsResponseDiagnostics(fallbackRes.text, fallbackRes.metrics)
                        }
                    });
                } else {
                    const cache = await getCache(bvid);
                    const normalized = normalizeSegments(parsed, cache, { bvid, task: "segments", mode: "efficiency_fallback" });
                    if (normalized.length) {
                        results.segments = { ok: true, data: normalized, error: null };
                        segmentsResolved = true;
                        segmentsFailureError = null;
                        logSegmentQualitySummary(bvid, normalized, cache, {
                            task: "segments",
                            mode: "efficiency_fallback",
                            subtitlePayload: getSubtitlePayloadMeta(cache, subtitleText, subtitlePayloadOptions)
                        });
                        await appendMetrics(bvid, null, "segments", fallbackRes.metrics);
                        await reportFeatureUsage("segments", bvid, settings, fallbackRes.metrics);
                        logAI.info("segments_merged_parse_fallback_success", {
                            bvid,
                            task: "segments",
                            provider: settings.provider,
                            model: settings.model || "",
                            duration_ms: fallbackRes.metrics?.latencyMs || 0,
                            detail: {
                                mode: "efficiency_fallback",
                                output_chars: String(fallbackRes.text || "").length,
                                segment_count: normalized.length
                            }
                        });
                    } else {
                        segmentsFailureError = attachSentryContext(
                            createSegmentsNormalizeError(parsed),
                            buildAIResponseSentryContext({
                                task: "segments",
                                bvid,
                                provider: settings.provider,
                                model: settings.model || "",
                                mode: "efficiency_fallback",
                                source: "segments_merged_fallback_normalize",
                                responseText: fallbackRes.text,
                                metrics: fallbackRes.metrics
                            })
                        );
                    }
                }
            } catch (fallbackError) {
                segmentsFailureError = normalizeSegmentsTaskError(fallbackError);
                logAI.warn("segments_merged_parse_fallback_failed", buildFailureLog(fallbackError, {
                    task: "segments",
                    bvid,
                    provider: settings.provider,
                    model: settings.model || "",
                    detail: {
                        mode: "efficiency_fallback"
                    }
                }));
            }
        }
        if (!segmentsResolved) {
            logAI.error("segments_parse_failed", {
                bvid,
                task: "segments",
                code: segmentsFailureError?.code || "SEGMENTS_MISSING_PROTOCOL",
                detail: {
                    mode: "efficiency",
                    full_text_chars: fullText.length,
                    segments_start_index: fullText.indexOf("<<<SEGMENTS_START>>>"),
                    segments_end_index: fullText.indexOf("<<<SEGMENTS_END>>>")
                }
            });
            throw (segmentsFailureError || createAppError("SEGMENTS_MISSING_PROTOCOL", "模型漏掉了分段部分"));
        }
        if (results.summary.ok) {
            logSummaryQualitySummary(bvid, String(results.summary.data || ""), {
                subtitleChars: subtitleText.length,
                promptChars: prompt.length,
                promptMode: mode,
                fromCache: false
            });
        }
        await appendMetrics(bvid, null, "summary", aiRes.metrics);
        await appendMetrics(bvid, null, "segments", aiRes.metrics);
        await reportFeatureUsage("summary_segments_merged", bvid, settings, aiRes.metrics);
        await applySummarySegmentsResults(tabId, bvid, results);
        logAI.info("ai_request_success", {
            bvid,
            task: "summary_segments_merged",
            provider: settings.provider,
            model: settings.model || "",
            duration_ms: aiRes.metrics?.latencyMs || 0,
            detail: {
                mode: "efficiency",
                first_chunk_ms: firstChunkMs,
                tokens: aiRes.metrics?.tokens || 0,
                input_tokens: aiRes.metrics?.inputTokens || 0,
                output_tokens: aiRes.metrics?.outputTokens || 0,
                subtitle_chars: subtitleText.length,
                prompt_chars: prompt.length,
                output_chars: String(aiRes.text || streamBuffer || "").length
            }
        });
    } catch (error) {
        const finalError = normalizeSegmentsTaskError(error);
        await summaryApplyPromise.catch(() => {});
        if (!results.summary.ok) {
            results.summary = { ok: false, data: null, error: finalError };
        }
        results.segments = { ok: false, data: null, error: finalError };
        await applySummarySegmentsResults(tabId, bvid, results);
        await reportDailyFeatureUsage("summary_segments_merged", settings, {
            durationMs: Date.now() - requestStartedAt,
            tokens: 0
        }, resolveUsageStatusByError(finalError), resolveUsageErrorCode(finalError, "SUMMARY_SEGMENTS_FAILED"), {
            bvid,
            title: cache?.title || ""
        });
        logAI.error("ai_request_failed", buildFailureLog(finalError, {
            task: "summary_segments_merged",
            bvid,
            provider: settings.provider,
            model: settings.model || "",
            duration_ms: Date.now() - requestStartedAt,
            detail: {
                mode: "efficiency",
                first_chunk_ms: firstChunkMs,
                subtitle_chars: subtitleText.length,
                prompt_chars: prompt.length,
                prompt_mode: mode
            }
        }));
    }
    return results;
}

function buildRawSubtitlePayload(cache, maxChars = MAX_SUBTITLE_CHARS) {
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (!raw.length) return "";
    const noTimestamp = isNoTimestampSubtitleCache(cache);
    const text = raw.map((item) => {
        const content = String(item.content ?? item.text ?? "").trim();
        if (!content) return null;
        if (noTimestamp) return content;
        const sec = Number(item.from ?? item.start ?? 0);
        const min = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `[${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}] ${content}`;
    }).filter(Boolean).join("\n");
    return text ? text.slice(0, maxChars) : "";
}

function formatSubtitleClock(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildIndexedRawSubtitlePayload(cache, maxChars = MAX_SUBTITLE_CHARS) {
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (!raw.length) return "";
    const noTimestamp = isNoTimestampSubtitleCache(cache);
    const lines = [];
    let usedChars = 0;
    for (let index = 0; index < raw.length; index += 1) {
        const item = raw[index] || {};
        const content = String(item.content ?? item.text ?? "").replace(/\s+/g, " ").trim();
        if (!content) continue;
        let line = `#${index} ${content}`;
        if (!noTimestamp) {
            const start = Number(item.from ?? item.start ?? 0);
            const end = Number(item.to ?? item.end ?? NaN);
            const time = Number.isFinite(end) && end > start
                ? `[${formatSubtitleClock(start)}-${formatSubtitleClock(end)}]`
                : `[${formatSubtitleClock(start)}]`;
            line = `#${index} ${time} ${content}`;
        }
        if (usedChars + line.length + 1 > maxChars) break;
        lines.push(line);
        usedChars += line.length + 1;
    }
    return lines.join("\n");
}

function buildProcessedSubtitlePayload(cache, maxChars = MAX_SUBTITLE_CHARS) {
    const processed = Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle : [];
    if (processed.length) {
        // processedSubtitle 的 text 已含内嵌时间戳，直接拼接
        const text = processed.map((item) => String(item.text || "").trim()).filter(Boolean).join("\n");
        if (text) return text.slice(0, maxChars);
    }
    return "";
}

function buildRawAdEvidencePayload(cache, maxChars = 8000) {
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (!raw.length) return "";
    const noTimestamp = isNoTimestampSubtitleCache(cache);
    const selected = new Set();
    raw.forEach((item, index) => {
        const text = String(item.content ?? item.text ?? "").trim();
        const matched = AD_DIAGNOSTIC_KEYWORDS.some((keyword) => text.toLowerCase().includes(String(keyword).toLowerCase()));
        if (!matched) return;
        for (let offset = -2; offset <= 2; offset += 1) {
            const nextIndex = index + offset;
            if (nextIndex >= 0 && nextIndex < raw.length) selected.add(nextIndex);
        }
    });
    if (!selected.size) return "";
    const lines = [...selected]
        .sort((a, b) => a - b)
        .slice(0, 140)
        .map((index) => {
            const item = raw[index] || {};
            const content = String(item.content ?? item.text ?? "").trim();
            if (!content) return "";
            if (noTimestamp) return `#${index} ${content}`;
            const start = Number(item.from ?? item.start ?? 0);
            const end = Number(item.to ?? item.end ?? NaN);
            const time = Number.isFinite(end) && end > start
                ? `[${formatSubtitleClock(start)}-${formatSubtitleClock(end)}]`
                : `[${formatSubtitleClock(start)}]`;
            return `#${index} ${time} ${content}`;
        })
        .filter(Boolean);
    return lines.join("\n").slice(0, maxChars);
}

function buildCompactSegmentsSubtitlePayload(cache, maxChars = 40000) {
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (!raw.length) return "";
    const lines = [];
    let usedChars = 0;
    for (let index = 0; index < raw.length; index += 1) {
        const item = raw[index] || {};
        const content = String(item.content ?? item.text ?? "").trim().replace(/\s+/g, " ").slice(0, 56);
        if (!content) continue;
        const line = `#${index} ${content}`;
        if (usedChars + line.length + 1 > maxChars) {
            const lastIndex = raw.length - 1;
            if (index < lastIndex) {
                const last = raw[lastIndex] || {};
                const lastContent = String(last.content ?? last.text ?? "").trim().replace(/\s+/g, " ").slice(0, 56);
                if (lastContent) lines.push(`#${lastIndex} ${lastContent}`);
            }
            break;
        }
        lines.push(line);
        usedChars += line.length + 1;
    }
    return [
        "【分段与广告逐句字幕（极简）】",
        "说明：每行开头 #数字 是 line_id。请只用这些 line_id 输出 start_line/end_line；不要逐句分段。",
        lines.join("\n")
    ].filter(Boolean).join("\n");
}

function getSegmentsSubtitlePayload(cache, options = {}) {
    const mode = String(options?.mode || "efficiency");
    const indexedRawText = buildIndexedRawSubtitlePayload(cache, MAX_SEGMENTS_SUBTITLE_CHARS);
    if (indexedRawText) {
        if (isNoTimestampSubtitleCache(cache)) {
            return [
                "【分段与广告逐句字幕（无真实时间轴）】",
                "说明：每行开头的 #数字 是 line_id。本字幕没有真实 start/end 秒数，禁止把所有行当作 00:00；普通分段和广告识别都必须基于 line_id。",
                "输出时 start_line/end_line/ad_start_line/ad_end_line 必须来自这些 #编号；start/end 可填写对应行号作为兼容字段，系统会按 line_id 生成无时间轴分段。",
                indexedRawText
            ].join("\n").slice(0, MAX_SEGMENTS_SUBTITLE_CHARS);
        }
        return [
            "【分段与广告逐句字幕】",
            "说明：每行开头的 #数字 是 line_id。普通分段和广告识别都必须基于这些逐句字幕；广告段必须输出 ad_start_line/ad_end_line，值必须来自这些 #编号。",
            indexedRawText
        ].join("\n").slice(0, MAX_SEGMENTS_SUBTITLE_CHARS);
    }
    return buildRawSubtitlePayload(cache, MAX_SEGMENTS_SUBTITLE_CHARS);
}

function getSubtitlePayload(cache, options = {}) {
    if (options?.purpose === "segments") return getSegmentsSubtitlePayload(cache, options);
    const processedText = buildProcessedSubtitlePayload(cache);
    if (processedText) return processedText;
    return buildRawSubtitlePayload(cache);
}

function getSubtitlePayloadMeta(cache, text, options = {}) {
    const rawCount = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle.length : 0;
    const processedCount = Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle.length : 0;
    const mode = String(options?.mode || "");
    const noTimestamp = isNoTimestampSubtitleCache(cache);
    const adEvidenceText = options?.purpose === "segments" ? buildRawAdEvidencePayload(cache, 8000) : "";
    const maxChars = options?.purpose === "segments" ? MAX_SEGMENTS_SUBTITLE_CHARS : MAX_SUBTITLE_CHARS;
    const payloadLines = String(text || "").split("\n");
    const indexedLines = payloadLines
        .map((line) => String(line || "").match(/^#(\d+)\s+\[([^\]]+)\]/))
        .filter(Boolean);
    const lastIndexedLine = indexedLines.length ? indexedLines[indexedLines.length - 1] : null;
    const source = options?.purpose === "segments"
        ? (rawCount ? "raw_indexed_full_segments_diagnostic" : "none")
        : (processedCount ? "processed" : (rawCount ? "raw_indexed" : "none"));
    return {
        source,
        purpose: String(options?.purpose || "general"),
        mode,
        no_timestamp: noTimestamp,
        raw_count: rawCount,
        processed_count: processedCount,
        ad_evidence_chars: adEvidenceText.length,
        ad_evidence_line_count: adEvidenceText ? adEvidenceText.split("\n").filter(Boolean).length : 0,
        payload_chars: String(text || "").length,
        max_chars: maxChars,
        indexed_line_count: indexedLines.length,
        last_indexed_line_id: lastIndexedLine ? Number(lastIndexedLine[1]) : null,
        last_indexed_time: lastIndexedLine ? String(lastIndexedLine[2] || "") : "",
        truncated: String(text || "").length >= maxChars
    };
}

function logSubtitlePayloadSelection(bvid, task, cache, subtitleText, options = {}) {
    logAI.info("subtitle_payload_selected", {
        bvid,
        task,
        detail: getSubtitlePayloadMeta(cache, subtitleText, options)
    });
}

function normalizeSegments(value, cache = {}, context = {}) {
    const noTimestamp = isNoTimestampSubtitleCache(cache);
    const normalized = normalizeSegmentsResult(value, {
        allowLineOnly: noTimestamp || context?.allowLineOnly === true,
        onFuzzyHit(fuzzyHits, totalCount) {
            logBackground.debug("segments_normalize_fuzzy_hit", {
                hit_count: fuzzyHits.length,
                total_count: totalCount,
                sample: fuzzyHits.slice(0, 5)
            });
        },
        onDrop(dropped, totalCount) {
            logBackground.debug("segments_normalize_drop", {
                dropped_count: dropped.length,
                total_count: totalCount,
                sample: dropped.slice(0, 3)
            });
        }
    });
    return applyLineRangesToSegments(normalized, cache, context);
}

function resolveSubtitleLine(rawRows, lineId) {
    const id = Number(lineId);
    if (!Array.isArray(rawRows) || !rawRows.length || !Number.isInteger(id)) return null;
    if (id >= 0 && id < rawRows.length) return { row: rawRows[id], index: id, adjusted: false };
    const fallback = id - 1;
    if (fallback >= 0 && fallback < rawRows.length) return { row: rawRows[fallback], index: fallback, adjusted: true };
    return null;
}

function getSubtitleEndTime(row, fallbackStart = 0) {
    const end = Number(row?.to ?? row?.end ?? NaN);
    if (Number.isFinite(end) && end > fallbackStart) return end;
    const start = Number(row?.from ?? row?.start ?? fallbackStart);
    if (Number.isFinite(start) && start > fallbackStart) return start;
    return fallbackStart;
}

function applyLineRangesToSegments(segments, cache = {}, context = {}) {
    const list = Array.isArray(segments) ? segments : [];
    const rawRows = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    const noTimestamp = isNoTimestampSubtitleCache(cache);
    if (!list.length || !rawRows.length) return removeAdOverlapFromContentSegments(list, context);
    const mapped = list.map((seg) => {
        const startLineId = Number(seg?.type === "ad" ? (seg.ad_start_line ?? seg.start_line) : seg.start_line);
        const endLineId = Number(seg?.type === "ad" ? (seg.ad_end_line ?? seg.end_line) : seg.end_line);
        if (!Number.isInteger(startLineId) || !Number.isInteger(endLineId)) return seg;
        const startLine = resolveSubtitleLine(rawRows, startLineId);
        const endLine = resolveSubtitleLine(rawRows, endLineId);
        if (!startLine || !endLine) {
            logAI.warn("segment_line_mapping_failed", {
                bvid: context.bvid || "",
                task: context.task || "segments",
                code: "SEGMENT_LINE_MAPPING_FAILED",
                detail: {
                    mode: context.mode || "",
                    type: String(seg.type || "content"),
                    label: String(seg.label || "").slice(0, 60),
                    start_line: Number.isFinite(startLineId) ? startLineId : null,
                    end_line: Number.isFinite(endLineId) ? endLineId : null,
                    raw_count: rawRows.length,
                    ai_start: Number(seg.start || 0),
                    ai_end: Number(seg.end || 0)
                }
            });
            return seg;
        }
        if (noTimestamp) {
            const virtualStart = Math.max(0, startLine.index);
            const virtualEnd = Math.max(virtualStart + 1, endLine.index + 1);
            const next = {
                ...seg,
                start: virtualStart,
                end: virtualEnd,
                start_line: startLine.index,
                end_line: endLine.index,
                ad_start_line: startLine.index,
                ad_end_line: endLine.index,
                line_mapped: true,
                no_timestamp: true,
                virtual_time: true
            };
            if (seg?.type !== "ad") {
                delete next.ad_start_line;
                delete next.ad_end_line;
            } else {
                next.ad_line_mapped = true;
            }
            logAI.info(seg?.type === "ad" ? "ad_line_range_mapped" : "segment_line_range_mapped", {
                bvid: context.bvid || "",
                task: context.task || "segments",
                detail: {
                    mode: context.mode || "",
                    type: String(seg.type || "content"),
                    label: String(seg.label || "").slice(0, 60),
                    no_timestamp: true,
                    mapped_start_line: startLine.index,
                    mapped_end_line: endLine.index,
                    adjusted_line_id: !!(startLine.adjusted || endLine.adjusted),
                    start_text: getSubtitleSnippet(startLine.row),
                    end_text: getSubtitleSnippet(endLine.row)
                }
            });
            return next;
        }
        const start = Number(startLine.row?.from ?? startLine.row?.start ?? 0);
        const endBase = Number(endLine.row?.from ?? endLine.row?.start ?? start);
        const end = getSubtitleEndTime(endLine.row, endBase);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return seg;
        const next = {
            ...seg,
            start,
            end,
            start_line: startLine.index,
            end_line: endLine.index,
            ad_start_line: startLine.index,
            ad_end_line: endLine.index,
            line_mapped: true
        };
        if (seg?.type !== "ad") {
            delete next.ad_start_line;
            delete next.ad_end_line;
        } else {
            next.ad_line_mapped = true;
        }
        delete next.no_timestamp;
        delete next.virtual_time;
        logAI.info(seg?.type === "ad" ? "ad_line_range_mapped" : "segment_line_range_mapped", {
            bvid: context.bvid || "",
            task: context.task || "segments",
            detail: {
                mode: context.mode || "",
                type: String(seg.type || "content"),
                label: String(seg.label || "").slice(0, 60),
                ai_start: Number(seg.start || 0),
                ai_end: Number(seg.end || 0),
                mapped_start: start,
                mapped_end: end,
                start_line: startLine.index,
                end_line: endLine.index,
                adjusted_line_id: !!(startLine.adjusted || endLine.adjusted),
                start_text: getSubtitleSnippet(startLine.row),
                end_text: getSubtitleSnippet(endLine.row)
            }
        });
        return next;
    });
    return removeAdOverlapFromContentSegments(mapped, context);
}

function cloneContentSegmentWithRange(seg, start, end, suffix = "") {
    const nextStart = Number(start);
    const nextEnd = Number(end);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextEnd - nextStart < 2) return null;
    return {
        start: nextStart,
        end: nextEnd,
        label: suffix ? `${String(seg.label || "内容").trim()}${suffix}` : String(seg.label || "内容").trim(),
        type: "content"
    };
}

function removeAdOverlapFromContentSegments(segments, context = {}) {
    const list = Array.isArray(segments) ? segments : [];
    const ads = list
        .filter((seg) => seg?.type === "ad")
        .map((seg) => ({ ...seg, start: Number(seg.start || 0), end: Number(seg.end || 0) }))
        .filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
        .sort((a, b) => a.start - b.start);
    if (!ads.length) {
        return list.sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
    }
    const output = [];
    let adjustedCount = 0;
    for (const seg of list) {
        if (seg?.type === "ad") {
            output.push(seg);
            continue;
        }
        const start = Number(seg?.start || 0);
        const end = Number(seg?.end || 0);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        let ranges = [{ start, end }];
        for (const ad of ads) {
            const overlaps = ranges.some((range) => ad.start < range.end && ad.end > range.start);
            if (!overlaps) continue;
            const nextRanges = [];
            for (const range of ranges) {
                if (ad.end <= range.start || ad.start >= range.end) {
                    nextRanges.push(range);
                    continue;
                }
                adjustedCount += 1;
                if (ad.start > range.start) nextRanges.push({ start: range.start, end: Math.min(ad.start, range.end) });
                if (ad.end < range.end) nextRanges.push({ start: Math.max(ad.end, range.start), end: range.end });
            }
            ranges = nextRanges;
        }
        ranges.forEach((range, index) => {
            const suffix = ranges.length > 1 ? (index === 0 ? "" : "（续）") : "";
            const clipped = cloneContentSegmentWithRange(seg, range.start, range.end, suffix);
            if (clipped) output.push(clipped);
        });
    }
    output.sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
    if (adjustedCount > 0) {
        logAI.info("segments_ad_overlap_resolved", {
            bvid: context.bvid || "",
            task: context.task || "segments",
            detail: {
                mode: context.mode || "",
                ad_count: ads.length,
                adjusted_overlap_count: adjustedCount,
                segment_count_before: list.length,
                segment_count_after: output.length
            }
        });
    }
    return smoothSegmentContinuity(output, context);
}

function smoothSegmentContinuity(segments, context = {}) {
    const list = Array.isArray(segments)
        ? segments
            .map((seg) => ({
                ...seg,
                start: Number(seg.start || 0),
                end: Number(seg.end || 0)
            }))
            .filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
            .sort((a, b) => a.start - b.start)
        : [];
    if (list.length < 2) return list;
    let adjustedCount = 0;
    let gapToPreviousContentCount = 0;
    let gapToNextContentCount = 0;
    let contentGapCount = 0;
    for (let index = 0; index < list.length - 1; index += 1) {
        const current = list[index];
        const next = list[index + 1];
        const gap = next.start - current.end;
        if (!Number.isFinite(gap) || gap <= 2) continue;
        if (current.type === "ad" && next.type !== "ad") {
            next.start = current.end;
            gapToNextContentCount += 1;
            adjustedCount += 1;
            continue;
        }
        if (current.type !== "ad" && next.type === "ad") {
            current.end = next.start;
            gapToPreviousContentCount += 1;
            adjustedCount += 1;
            continue;
        }
        if (current.type !== "ad" && next.type !== "ad") {
            current.end = next.start;
            contentGapCount += 1;
            adjustedCount += 1;
        }
    }
    if (adjustedCount > 0) {
        logAI.info("segments_continuity_smoothed", {
            bvid: context.bvid || "",
            task: context.task || "segments",
            detail: {
                mode: context.mode || "",
                adjusted_gap_count: adjustedCount,
                gap_to_previous_content_count: gapToPreviousContentCount,
                gap_to_next_content_count: gapToNextContentCount,
                content_gap_count: contentGapCount,
                strategy: "semantic_ad_boundary_preserved",
                segment_count: list.length
            }
        });
    }
    return list;
}

function normalizeRumors(value, cache = {}) {
    const normalized = normalizeRumorsResult(value);
    if (!normalized || !isNoTimestampSubtitleCache(cache)) return normalized;
    return {
        ...normalized,
        no_timestamp: true,
        claims: (normalized.claims || []).map((claim) => ({
            ...claim,
            timestamp_sec: 0,
            no_timestamp: true
        }))
    };
}

function buildFailureLog(error, base = {}) {
    const detail = {
        ...(base.detail || {}),
        error_name: String(error?.name || "Error"),
        error_message: String(error?.message || error || "请求失败"),
        stack_preview: String(error?.stack || "").split("\n").slice(0, 3).join("\n")
    };
    return {
        ...base,
        code: String(error?.code || base.code || ""),
        status: Number(error?.status || base.status || 0) || 0,
        detail
    };
}

function getSubtitleLineCount(cache = {}) {
    const processed = Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle : [];
    if (processed.length) return processed.length;
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    return raw.length;
}

function getSubtitleRowsForDiagnostics(cache = {}) {
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (raw.length) return raw;
    return Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle : [];
}

function countSubtitleMatchesForRange(rows, start, end) {
    return rows.filter((item) => {
        const time = Number(item?.from ?? item?.start ?? 0);
        return Number.isFinite(time) && time >= start && time <= end;
    }).length;
}

const AD_DIAGNOSTIC_KEYWORDS = [
    "广告", "赞助", "推广", "优惠", "购买", "下单", "链接", "注册", "扫码", "口令",
    "会员", "课程", "APP", "app下载", "下载", "品牌", "产品", "推荐", "试试", "支持"
];

function getSubtitleTime(row) {
    const time = Number(row?.from ?? row?.start ?? 0);
    return Number.isFinite(time) ? time : 0;
}

function getSubtitleSnippet(row) {
    const text = String(row?.content ?? row?.text ?? "").replace(/\s+/g, " ").trim();
    return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

function findNearestSubtitleLine(rows, targetTime) {
    const target = Number(targetTime);
    if (!Array.isArray(rows) || !rows.length || !Number.isFinite(target)) return null;
    let best = null;
    rows.forEach((row, index) => {
        const time = getSubtitleTime(row);
        const delta = Math.abs(time - target);
        if (!best || delta < best.delta_sec) {
            best = {
                index,
                time,
                delta_sec: Math.round(delta),
                snippet: getSubtitleSnippet(row)
            };
        }
    });
    return best;
}

function findAdEvidenceRows(rows, start, end) {
    const startSec = Number(start);
    const endSec = Number(end);
    if (!Array.isArray(rows) || !rows.length || !Number.isFinite(startSec) || !Number.isFinite(endSec)) return [];
    return rows
        .map((row, index) => {
            const time = getSubtitleTime(row);
            const text = getSubtitleSnippet(row);
            const keywordHits = AD_DIAGNOSTIC_KEYWORDS.filter((keyword) => text.toLowerCase().includes(String(keyword).toLowerCase()));
            return { index, time, text, keywordHits };
        })
        .filter((item) => item.time >= startSec - 20 && item.time <= endSec + 20 && item.keywordHits.length)
        .slice(0, 8);
}

function buildAdDecisionDiagnostics(segments, subtitleRows) {
    const list = Array.isArray(segments) ? segments : [];
    const rows = Array.isArray(subtitleRows) ? subtitleRows : [];
    return list
        .filter((seg) => seg?.type === "ad")
        .slice(0, 10)
        .map((seg) => {
            const start = Number(seg.start || 0);
            const end = Number(seg.end || 0);
            const startLine = findNearestSubtitleLine(rows, start);
            const endLine = findNearestSubtitleLine(rows, end);
            const evidence = findAdEvidenceRows(rows, start, end);
            const startDelta = Number(startLine?.delta_sec ?? 999);
            const endDelta = Number(endLine?.delta_sec ?? 999);
            const confidence = evidence.length && startDelta <= 10 && endDelta <= 10
                ? "high"
                : (evidence.length ? "medium" : "low");
            return {
                label: String(seg.label || "").slice(0, 40),
                start,
                end,
                duration_sec: Math.max(0, Math.round(end - start)),
                decision: "ad",
                confidence,
                ad_start_line: Number.isInteger(Number(seg.ad_start_line)) ? Number(seg.ad_start_line) : null,
                ad_end_line: Number.isInteger(Number(seg.ad_end_line)) ? Number(seg.ad_end_line) : null,
                ad_line_mapped: !!seg.ad_line_mapped,
                start_boundary: startLine,
                end_boundary: endLine,
                evidence
            };
        });
}

function logSummaryQualitySummary(bvid, summaryText, context = {}) {
    const outputChars = String(summaryText || "").length;
    const subtitleChars = Number(context.subtitleChars || 0);
    const isTooShort = subtitleChars > 3000 && outputChars < 120;
    const event = isTooShort ? "summary_quality_warning" : "summary_quality_check";
    logAI[isTooShort ? "warn" : "info"](event, {
        bvid,
        task: "summary",
        code: isTooShort ? "SUMMARY_TOO_SHORT" : "",
        detail: {
            subtitle_chars: subtitleChars,
            prompt_chars: Number(context.promptChars || 0),
            output_chars: outputChars,
            prompt_mode: context.promptMode || "",
            from_cache: !!context.fromCache
        }
    });
}

function logSegmentQualitySummary(bvid, segments, cache = {}, context = {}) {
    const list = Array.isArray(segments) ? segments : [];
    const subtitleRows = getSubtitleRowsForDiagnostics(cache);
    const adSegments = list.filter((seg) => seg?.type === "ad");
    const adDecisionDiagnostics = buildAdDecisionDiagnostics(list, subtitleRows);
    const adRanges = adSegments.slice(0, 10).map((seg) => {
        const start = Number(seg.start || 0);
        const end = Number(seg.end || 0);
        const matchCount = countSubtitleMatchesForRange(subtitleRows, start, end);
        return {
            start,
            end,
            matched: matchCount > 0,
            subtitle_line_count: matchCount
        };
    });
    const matchedAdCount = adRanges.filter((item) => item.matched).length;
    const unmatchedAdCount = Math.max(0, adSegments.length - matchedAdCount);
    logAI.info("ad_detection_summary", {
        bvid,
        task: context.task || "segments",
        detail: {
            mode: context.mode || "",
            fallback: context.fallback || "",
            segment_count: list.length,
            ad_segment_count: adSegments.length,
            subtitle_line_count: getSubtitleLineCount(cache),
            subtitle_payload: context.subtitlePayload || null,
            matched_ad_count: matchedAdCount,
            unmatched_ad_count: unmatchedAdCount,
            match_strategy: "time_range",
            ad_ranges: adRanges,
            ad_decisions: adDecisionDiagnostics
        }
    });
    if (!list.length || unmatchedAdCount > 0) {
        logAI.warn("segments_quality_warning", {
            bvid,
            task: context.task || "segments",
            code: !list.length ? "SEGMENTS_EMPTY" : "AD_MATCH_WEAK",
            detail: {
                mode: context.mode || "",
                segment_count: list.length,
                ad_segment_count: adSegments.length,
                unmatched_ad_count: unmatchedAdCount
            }
        });
    }
}

function logRumorsQualitySummary(bvid, rumors, context = {}) {
    const claims = Array.isArray(rumors?.claims) ? rumors.claims : [];
    const missingEvidenceCount = claims.filter((claim) => {
        const analysis = String(claim?.analysis || "").trim();
        const claimText = String(claim?.claim || "").trim();
        return !analysis || !claimText;
    }).length;
    logAI[missingEvidenceCount ? "warn" : "info"]("rumors_quality_check", {
        bvid,
        task: "rumors",
        code: missingEvidenceCount ? "RUMORS_MISSING_EVIDENCE" : "",
        detail: {
            mode: context.mode || "",
            claim_count: claims.length,
            missing_evidence_count: missingEvidenceCount,
            has_overview: !!String(rumors?.overview || "").trim(),
            output_chars: Number(context.outputChars || 0),
            parse_retry_count: Number(context.parseRetryCount || 0)
        }
    });
}

function createTaskTimeoutError(code = "AI_RESPONSE_TIMEOUT", message = "模型请求超时，请重试") {
    return createAppError(code, message);
}

function createUserAbortedError() {
    const error = new Error("已停止生成");
    error.code = "ABORTED";
    return error;
}

async function callAIWithTimeout(settings, messages, timeoutMs, options = {}) {
    const controller = new AbortController();
    const unregister = registerTabAbortController(options?.tabId, controller);
    const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
    const start = performance.now();
    const queueSizeAtStart = queue.length;
    const activeCountAtStart = activeCount;
    try {
        const requestRunner = () => callAI(settings.provider, settings, messages, controller.signal);
        const res = options?.bypassQueue ? await requestRunner() : await runQueued(requestRunner);
        const latencyMs = Math.round(performance.now() - start);
        const tokenInfo = resolveTokenInfo(res.usage, res.text, messages);
        const modelScopeRemaining = res.headers?.get?.("modelscope-ratelimit-model-requests-remaining") ?? null;
        logAI.debug("provider_response", {
            provider: settings.provider,
            model: settings.model || "",
            duration_ms: latencyMs,
            detail: { ...tokenInfo, has_text: !!res.text }
        });
        logAIResponseText({
            provider: settings.provider,
            model: settings.model || "",
            durationMs: latencyMs,
            text: res.text || ""
        });
        return { text: res.text || "", metrics: { latencyMs, tokens: tokenInfo.total, inputTokens: tokenInfo.input, outputTokens: tokenInfo.output, modelScopeRemaining } };
    } catch (error) {
        logAI.error("ai_request_failed", buildFailureLog(error, {
            task: "ai",
            provider: settings.provider,
            model: settings.model || ""
        }));
        if (controller.signal.aborted) {
            if (controller.signal.reason === "aborted") {
                throw createUserAbortedError();
            }
            const timeoutError = createTaskTimeoutError("AI_RESPONSE_TIMEOUT", "模型请求超时，请重试");
            attachSentryContext(timeoutError, buildProviderRequestTelemetry(settings, timeoutMs, {
                stream: false,
                bypassQueue: !!options?.bypassQueue,
                queueSizeAtStart,
                activeCountAtStart,
                elapsedMs: Math.round(performance.now() - start)
            }));
            logAI.error("ai_request_timeout", buildFailureLog(timeoutError, {
                task: "ai",
                provider: settings.provider,
                model: settings.model || "",
                code: timeoutError.code || "AI_RESPONSE_TIMEOUT"
            }));
            throw timeoutError;
        }
        attachSentryContext(error, buildProviderRequestTelemetry(settings, timeoutMs, {
            stream: false,
            bypassQueue: !!options?.bypassQueue,
            queueSizeAtStart,
            activeCountAtStart,
            elapsedMs: Math.round(performance.now() - start)
        }));
        throw error;
    } finally {
        unregister();
        clearTimeout(timeoutId);
    }
}

async function callAIWithTimeoutStream(settings, messages, timeoutMs, onDelta, externalController, options = {}) {
    const controller = externalController || new AbortController();
    const unregister = externalController ? () => {} : registerTabAbortController(options?.tabId, controller);
    let firstResponseReceived = false;
    const retryDelaysMs = [STREAM_INITIAL_RETRY_DELAY_MS];
    const maxAttempts = retryDelaysMs.length + 1;
    const timeoutId = setTimeout(() => {
        if (!firstResponseReceived) controller.abort("timeout");
    }, timeoutMs);
    const start = performance.now();
    const queueSizeAtStart = queue.length;
    const activeCountAtStart = activeCount;
    try {
        const wrappedOnDelta = (delta) => {
            if (!firstResponseReceived) {
                firstResponseReceived = true;
                clearTimeout(timeoutId);
            }
            if (typeof onDelta === "function") onDelta(delta);
        };
        let res = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                res = await runQueued(() => callAIStream(settings.provider, settings, messages, controller.signal, wrappedOnDelta));
                break;
            } catch (error) {
                decorateStreamRetryMetadata(error, attempt, maxAttempts, retryDelaysMs);
                if (controller.signal.aborted) throw error;
                if (!shouldRetryInitialStreamFailure(error, firstResponseReceived, attempt, maxAttempts)) throw error;
                const delayMs = retryDelaysMs[attempt - 1] || 0;
                logAI.warn("ai_stream_initial_retry", {
                    task: "ai",
                    provider: settings.provider,
                    model: settings.model || "",
                    code: error?.code || "",
                    detail: {
                        attempt,
                        max_attempts: maxAttempts,
                        next_delay_ms: delayMs,
                        first_response_received: firstResponseReceived
                    }
                });
                await waitForAbortableDelay(delayMs, controller.signal);
            }
        }
        const latencyMs = Math.round(performance.now() - start);
        const tokenInfo = resolveTokenInfo(res.usage, res.text, messages);
        const modelScopeRemaining = res.headers?.get?.("modelscope-ratelimit-model-requests-remaining") ?? null;
        logAIResponseText({
            provider: settings.provider,
            model: settings.model || "",
            durationMs: latencyMs,
            text: res.text || ""
        });
        return { text: res.text || "", metrics: { latencyMs, tokens: tokenInfo.total, inputTokens: tokenInfo.input, outputTokens: tokenInfo.output, modelScopeRemaining } };
    } catch (error) {
        if (controller.signal.aborted) {
            if (controller.signal.reason === "aborted") {
                throw createUserAbortedError();
            }
            const timeoutError = createTaskTimeoutError("AI_STREAM_TIMEOUT", "模型长时间没有开始返回内容，请重试");
            attachSentryContext(timeoutError, buildProviderRequestTelemetry(settings, timeoutMs, {
                stream: true,
                bypassQueue: false,
                queueSizeAtStart,
                activeCountAtStart,
                elapsedMs: Math.round(performance.now() - start),
                firstResponseReceived
            }));
            throw timeoutError;
        }
        attachSentryContext(error, buildProviderRequestTelemetry(settings, timeoutMs, {
            stream: true,
            bypassQueue: false,
            queueSizeAtStart,
            activeCountAtStart,
            elapsedMs: Math.round(performance.now() - start),
            firstResponseReceived
        }));
        throw error;
    } finally {
        unregister();
        clearTimeout(timeoutId);
    }
}

function resolveTokenInfo(usage, text, messages) {
    // Try to get explicit input/output
    const input = Number(usage?.prompt_tokens || usage?.input_tokens || usage?.promptTokens || 0);
    const output = Number(usage?.completion_tokens || usage?.output_tokens || usage?.completionTokens || 0);
    
    if (input > 0 || output > 0) {
        const total = Number.isFinite(Number(usage?.total_tokens || usage?.totalTokens || usage?.token_count || usage?.tokens)) 
            ? Number(usage?.total_tokens || usage?.totalTokens || usage?.token_count || usage?.tokens) 
            : (input + output);
        return { total, input, output };
    }

    // Fallback: estimate
    const inText = Array.isArray(messages) ? messages.map((m) => String(m?.content || "")).join("\n") : "";
    const outText = String(text || "");
    const inChars = inText.replace(/\s+/g, "");
    const outChars = outText.replace(/\s+/g, "");
    
    const estInput = Math.max(1, Math.round(inChars.length / 2));
    const estOutput = Math.max(1, Math.round(outChars.length / 2));
    
    return { total: estInput + estOutput, input: estInput, output: estOutput };
}

function abortChatForPort(port, msg) {
    const tabId = port?.sender?.tab?.id;
    const messageId = String(msg?.messageId || "");
    if (!tabId || !messageId) return;
    const abortKey = `${tabId}|${messageId}`;
    const controller = chatAbortControllers.get(abortKey);
    if (!controller) return;
    try {
        controller.abort("aborted");
    } catch (_) {}
}

function safePortPost(port, payload) {
    try {
        port.postMessage(payload);
    } catch (_) {}
}

function runQueued(taskFn) {
    return new Promise((resolve, reject) => {
        queue.push({ taskFn, resolve, reject });
        logBackground.debug("task_enqueue", { queue_size: queue.length, active_count: activeCount });
        flushQueue();
    });
}

function flushQueue() {
    while (activeCount < MAX_GLOBAL_CONCURRENCY && queue.length) {
        const next = queue.shift();
        activeCount += 1;
        Promise.resolve()
            .then(() => next.taskFn())
            .then((result) => next.resolve(result))
            .catch((error) => next.reject(error))
            .finally(() => {
                activeCount -= 1;
                flushQueue();
            });
    }
}

function runWithDedup(key, runner) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = Promise.resolve().then(runner).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
}

async function setTaskStatus(tabId, tasks, status, lastError = "") {
    const current = await getTabState(tabId);
    const taskStatus = { ...(current?.taskStatus || {}) };
    const taskErrors = { ...(current?.taskErrors || {}) };
    tasks.forEach((task) => {
        taskStatus[task] = status;
        if (status === "error" || status === "timeout") {
            taskErrors[task] = {
                message: String(lastError || "任务失败"),
                code: "",
                status: undefined,
                retryAfterSec: undefined
            };
        } else {
            delete taskErrors[task];
        }
    });
    await updateTabState(tabId, { taskStatus, taskErrors, lastError, updatedAt: Date.now() });
}

async function appendMetrics(bvid, tabId, task, metrics) {
    const cache = await getCache(bvid);
    const cacheMetrics = Array.isArray(cache.metrics) ? cache.metrics : [];
    const entry = { task, ...metrics, at: Date.now() };
    await mergeCacheByBvid(bvid, { metrics: [...cacheMetrics, entry].slice(-30), updatedAt: Date.now() });
    if (tabId) {
        const tabState = await getTabState(tabId);
        const tabMetrics = Array.isArray(tabState.metrics) ? tabState.metrics : [];
        await updateTabState(tabId, { metrics: [...tabMetrics, entry].slice(-20), updatedAt: Date.now() });
    }
}

async function getTabState(tabId) {
    const key = `tabState_${tabId}`;
    if (tabStateCache.has(key)) {
        return cloneData(tabStateCache.get(key));
    }
    const data = await chrome.storage.local.get([key]);
    if (data[key]) {
        tabStateCache.set(key, cloneData(data[key]));
    }
    logCache.debug("cache_read", { key, found: !!data[key] });
    return data[key] || null;
}

async function updateTabState(tabId, patch) {
    const key = `tabState_${tabId}`;
    const current = await getTabState(tabId);
    const merged = {
        tabId,
        activeBvid: null,
        activeCid: 0,
        activeTid: null,
        taskStatus: { summary: "idle", segments: "idle", rumors: "idle", chat: "idle" },
        lastError: "",
        metrics: [],
        ...current,
        ...patch
    };
    if (isEqualJSON(current, merged)) {
        tabStateCache.set(key, cloneData(merged));
        return merged;
    }
    tabStateCache.set(key, cloneData(merged));
    debounceFlushTabState(key, merged, tabId);
    return merged;
}

function debounceFlushTabState(key, tabState, tabId) {
    const prev = tabStateWriteTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(async () => {
        tabStateWriteTimers.delete(key);
        const latest = tabStateCache.get(key) || tabState;
        await chrome.storage.local.set({ [key]: latest });
        logCache.debug("cache_write", { key: `tabState_${tabId}` });
        logBackground.debug("storage_update", { key: `tabState_${tabId}` });
    }, 500);
    tabStateWriteTimers.set(key, timer);
}

async function getCache(bvid) {
    const normalized = normalizeBvid(bvid);
    if (!normalized) return {};
    if (cacheMemory.has(normalized)) {
        return cloneData(cacheMemory.get(normalized));
    }
    const key = `cache_${normalized}`;
    const legacyKey = `cache_${String(bvid || "").toUpperCase()}`;
    const keys = legacyKey !== key ? [key, legacyKey] : [key];
    const data = await chrome.storage.local.get(keys);
    const value = data[key] || data[legacyKey] || {};
    if (value && typeof value === "object") {
        cacheMemory.set(normalized, cloneData(value));
    }
    logCache.debug("cache_read", { key, found: !!value });
    if (!data[key] && data[legacyKey]) {
        await chrome.storage.local.set({ [key]: data[legacyKey] });
        cacheMemory.set(normalized, cloneData(data[legacyKey]));
    }
    return value;
}

function isStorageQuotaError(error) {
    const message = String(error?.message || "");
    return /QUOTA_BYTES|quota exceeded/i.test(message);
}

function buildQuotaSafeCacheFallback(current = {}, merged = {}) {
    const rawSubtitle = Array.isArray(merged?.rawSubtitle) ? merged.rawSubtitle : [];
    const processedSubtitle = Array.isArray(merged?.processedSubtitle) ? merged.processedSubtitle : [];
    if (!rawSubtitle.length || !processedSubtitle.length) return null;
    return {
        ...merged,
        processedSubtitle: [],
        processedHash: "",
        updatedAt: Date.now()
    };
}

async function mergeCacheByBvid(bvid, patch) {
    const normalized = normalizeBvid(bvid);
    if (!normalized) return {};
    const previous = cacheWriteLocks.get(normalized) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
        const key = `cache_${normalized}`;
        const current = await getCache(normalized);
        const merged = {
            bvid: normalized,
            cid: 0,
            tid: null,
            rawSubtitle: [],
            processedSubtitle: [],
            rawHash: "",
            processedHash: "",
            summary: "",
            segments: [],
            rumors: null,
            history: [],
            metrics: [],
            updatedAt: Date.now(),
            ...current,
            ...patch
        };
        if (isEqualJSON(current, merged)) {
            cacheMemory.set(normalized, cloneData(merged));
            return merged;
        }
        try {
            await chrome.storage.local.set({ [key]: merged });
            cacheMemory.set(normalized, cloneData(merged));
            logCache.debug("cache_write", { key });
            logCache.info("cache_merge", { key, fields: Object.keys(patch || {}) });
            logBackground.debug("storage_update", { key });
            return merged;
        } catch (error) {
            if (!isStorageQuotaError(error)) throw error;
            const fallback = buildQuotaSafeCacheFallback(current, merged);
            if (!fallback) throw error;
            await chrome.storage.local.set({ [key]: fallback });
            cacheMemory.set(normalized, cloneData(fallback));
            logCache.warn("cache_write_quota_fallback", {
                key,
                fields: Object.keys(patch || {}),
                dropped_fields: ["processedSubtitle", "processedHash"],
                raw_count: Array.isArray(fallback.rawSubtitle) ? fallback.rawSubtitle.length : 0
            });
            logBackground.warn("storage_quota_fallback", {
                bvid: normalized,
                reason: "drop_processed_subtitle"
            });
            return fallback;
        }
    });
    cacheWriteLocks.set(normalized, next);
    try {
        return await next;
    } finally {
        if (cacheWriteLocks.get(normalized) === next) {
            cacheWriteLocks.delete(normalized);
        }
    }
}

function cloneData(value) {
    if (value == null) return value;
    try {
        return structuredClone(value);
    } catch (_) {
        return JSON.parse(JSON.stringify(value));
    }
}

function isEqualJSON(a, b) {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch (_) {
        return false;
    }
}

function normalizeSettings(settings) {
    const base = settings && typeof settings === "object" ? settings : {};
    const customProtocol = String(base.customProtocol || "openai").toLowerCase() === "claude" ? "claude" : "openai";
    const customModel = String(base.customModel || "").trim();
    const provider = String(base.provider || DEFAULT_SETTINGS.provider || "modelscope").trim() || "modelscope";
    const providerApiKeysRaw = base.providerApiKeys && typeof base.providerApiKeys === "object" ? base.providerApiKeys : {};
    const providerApiKeys = Object.fromEntries(Object.entries(providerApiKeysRaw).map(([key, value]) => [
        String(key || "").trim(),
        String(value || "").trim()
    ]).filter(([key]) => key));
    const providerModelsRaw = base.providerModels && typeof base.providerModels === "object" ? base.providerModels : {};
    const providerModels = Object.fromEntries(Object.entries(providerModelsRaw).map(([key, value]) => [
        String(key || "").trim(),
        String(value || "").trim()
    ]).filter(([key]) => key));
    const asrProvider = String(base.asrProvider || DEFAULT_SETTINGS.asrProvider || "groq").toLowerCase() === "siliconflow" ? "siliconflow" : "groq";
    const apiKey = String(providerApiKeys[provider] || base.apiKey || "").trim();
    if (apiKey) providerApiKeys[provider] = apiKey;
    const groqApiKey = String(base.groqApiKey || "").trim();
    const groqModel = String(base.groqModel || DEFAULT_SETTINGS.groqModel || "whisper-large-v3-turbo").trim() || "whisper-large-v3-turbo";
    const siliconFlowApiKey = String(base.siliconFlowApiKey || "").trim();
    const siliconFlowAsrModel = String(base.siliconFlowAsrModel || DEFAULT_SETTINGS.siliconFlowAsrModel || "FunAudioLLM/SenseVoiceSmall").trim() || "FunAudioLLM/SenseVoiceSmall";
    const supabaseUrl = String(base.supabaseUrl || DEFAULT_SETTINGS.supabaseUrl || "").trim().replace(/\/+$/, "");
    const supabaseAnonKey = String(base.supabaseAnonKey || DEFAULT_SETTINGS.supabaseAnonKey || "").trim();
    const supabaseVideoCacheTable = String(base.supabaseVideoCacheTable || DEFAULT_SETTINGS.supabaseVideoCacheTable || SUPABASE_DEFAULT_VIDEO_CACHE_TABLE).trim() || SUPABASE_DEFAULT_VIDEO_CACHE_TABLE;
    const supabaseFeedbackTable = String(base.supabaseFeedbackTable || DEFAULT_SETTINGS.supabaseFeedbackTable || SUPABASE_DEFAULT_FEEDBACK_TABLE).trim() || SUPABASE_DEFAULT_FEEDBACK_TABLE;
    const supabaseUsageDailyRpcName = String(base.supabaseUsageDailyRpcName || DEFAULT_SETTINGS.supabaseUsageDailyRpcName || SUPABASE_DEFAULT_USAGE_DAILY_RPC).trim() || SUPABASE_DEFAULT_USAGE_DAILY_RPC;
    const prefModeRaw = String(base.prefMode || DEFAULT_SETTINGS.prefMode || "quality").toLowerCase();
    const prefMode = prefModeRaw === "efficiency" ? "efficiency" : "quality";
    const segmentPromptVariantRaw = String(base.segmentPromptVariant || DEFAULT_SETTINGS.segmentPromptVariant || "test").toLowerCase();
    const segmentPromptVariant = segmentPromptVariantRaw === "original" ? "original" : "test";
    const sentryDsn = String(base.sentryDsn || DEFAULT_SETTINGS.sentryDsn || "").trim();
    const sentryEnabled = Object.prototype.hasOwnProperty.call(base, "sentryEnabled")
        ? !!base.sentryEnabled
        : !!DEFAULT_SETTINGS.sentryEnabled;
    return {
        ...DEFAULT_SETTINGS,
        ...base,
        provider,
        debugMode: !!base.debugMode,
        apiKey,
        providerApiKeys,
        providerModels,
        sentryEnabled,
        sentryDsn,
        customProtocol,
        customModel,
        asrProvider,
        groqApiKey,
        groqModel,
        siliconFlowApiKey,
        siliconFlowAsrModel,
        supabaseUrl,
        supabaseAnonKey,
        supabaseVideoCacheTable,
        supabaseFeedbackTable,
        supabaseUsageDailyRpcName,
        prefMode,
        segmentPromptVariant
    };
}

function hasTaskResult(cache, task) {
    if (!cache || typeof cache !== "object") return false;
    if (task === "subtitle") {
        return (Array.isArray(cache.rawSubtitle) && cache.rawSubtitle.length > 0)
            || (Array.isArray(cache.processedSubtitle) && cache.processedSubtitle.length > 0);
    }
    if (task === "summary") return !!String(cache.summary || "").trim();
    if (task === "segments") return Array.isArray(cache.segments) && cache.segments.length > 0;
    if (task === "rumors") return !!normalizeRumors(cache.rumors);
    return false;
}

function getTaskModelName(settings) {
    const configured = String(settings?.model || "").trim();
    if (configured) return configured;
    const provider = PROVIDERS[settings?.provider] || {};
    return String(provider.model || "").trim();
}

function buildCloudSelectColumns(tasks) {
    const columns = new Set(["bvid", "updated_at"]);
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
        if (task === "subtitle") {
            [
                "title",
                "subtitle_source",
                "raw_subtitle",
                "processed_subtitle",
                "subtitle_upload_count",
                "subtitle_uploaded_at"
            ].forEach((field) => columns.add(field));
            return;
        }
        (CLOUD_TASK_FIELD_MAP[task] || []).forEach((field) => columns.add(field));
    });
    return [...columns];
}

function buildCloudPatchFromRow(row, tasks) {
    const patch = {
        cloudUpdatedAt: String(row?.updated_at || "").trim()
    };
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
        if (task === "subtitle") {
            const rawSubtitle = normalizeRawSubtitle(Array.isArray(row?.raw_subtitle) ? row.raw_subtitle : []);
            const processedSubtitle = normalizeRawSubtitle(Array.isArray(row?.processed_subtitle) ? row.processed_subtitle : []);
            if (!rawSubtitle.length && !processedSubtitle.length) return;
            patch.title = String(row?.title || "");
            patch.rawSubtitle = rawSubtitle;
            patch.processedSubtitle = processedSubtitle;
            patch.rawHash = makeSubtitleHash(rawSubtitle);
            patch.processedHash = makeSubtitleHash(processedSubtitle);
            patch.subtitleSource = String(row?.subtitle_source || "");
            patch.subtitleUploadCount = Math.max(0, Number(row?.subtitle_upload_count || 0));
            patch.subtitleUploadedAt = String(row?.subtitle_uploaded_at || "");
            return;
        }
        if (task === "summary") {
            const summary = String(row?.summary || "").trim();
            if (!summary) return;
            patch.summary = summary;
            patch.summaryModel = String(row?.summary_model || "");
            patch.summaryUpvotes = Number(row?.summary_upvotes || 0);
            patch.summaryDownvotes = Number(row?.summary_downvotes || 0);
            return;
        }
        if (task === "segments") {
            const segments = normalizeSegments(row?.segments);
            if (!segments.length) return;
            patch.segments = segments;
            patch.segmentsModel = String(row?.segments_model || "");
            patch.segmentsUpvotes = Number(row?.segments_upvotes || 0);
            patch.segmentsDownvotes = Number(row?.segments_downvotes || 0);
            return;
        }
        if (task === "rumors") {
            const rumors = normalizeRumors(row?.rumors);
            if (!rumors) return;
            patch.rumors = rumors;
            patch.rumorsModel = String(row?.rumors_model || "");
            patch.rumorsUpvotes = Number(row?.rumors_upvotes || 0);
            patch.rumorsDownvotes = Number(row?.rumors_downvotes || 0);
        }
    });
    return patch;
}

function buildTaskSourcePatch(tasks, source) {
    const patch = {};
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
        if (task === "subtitle") patch.subtitleCacheSource = source;
        if (task === "summary") patch.summaryCacheSource = source;
        if (task === "segments") patch.segmentsCacheSource = source;
        if (task === "rumors") patch.rumorsCacheSource = source;
    });
    return patch;
}

async function fetchCloudVideoCacheRow(bvid, tasks, settings) {
    if (!isSupabaseEnabled(settings)) return null;
    const normalizedBvid = normalizeBvid(bvid);
    if (!normalizedBvid) return null;
    const rows = await supabaseSelect(settings, settings.supabaseVideoCacheTable || SUPABASE_DEFAULT_VIDEO_CACHE_TABLE, {
        select: buildCloudSelectColumns(tasks).join(","),
        bvid: `eq.${normalizedBvid}`,
        limit: "1"
    }, {
        requestName: "cloud_video_cache_fetch",
        errorMessage: "Supabase 查询失败"
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function hydrateCloudCacheIfNeeded(bvid, tasks, settings) {
    const current = await getCache(bvid);
    if (!isSupabaseEnabled(settings)) return { hydratedTasks: [], cache: current };
    const missingTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => !hasTaskResult(current, task));
    if (!missingTasks.length) return { hydratedTasks: [], cache: current };
    try {
        const row = await fetchCloudVideoCacheRow(bvid, missingTasks, settings);
        if (!row) return { hydratedTasks: [], cache: current };
        const patch = buildCloudPatchFromRow(row, missingTasks);
        const hydratedTasks = missingTasks.filter((task) => hasTaskResult(patch, task));
        if (!hydratedTasks.length) return { hydratedTasks: [], cache: current };
        await mergeCacheByBvid(bvid, {
            ...patch,
            ...buildTaskSourcePatch(hydratedTasks, "cloud"),
            cloudSyncedAt: Date.now(),
            updatedAt: Date.now()
        });
        logCache.info("cloud_cache_backfill", { bvid: normalizeBvid(bvid), tasks: hydratedTasks });
        return { hydratedTasks, cache: await getCache(bvid) };
    } catch (error) {
        logBackground.error("cloud_cache_fetch_fail", {
            bvid: normalizeBvid(bvid),
            tasks: missingTasks,
            error: error.message || "cloud fetch failed"
        });
        return { hydratedTasks: [], cache: current };
    }
}

function buildSupabaseVideoPatch(bvid, settings, patch) {
    const row = { bvid: normalizeBvid(bvid) };
    const modelName = getTaskModelName(settings);
    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
        const title = String(patch.title || "").trim();
        if (title) row.title = title;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "rawSubtitle")) {
        row.raw_subtitle = normalizeRawSubtitle(Array.isArray(patch.rawSubtitle) ? patch.rawSubtitle : []);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "processedSubtitle")) {
        row.processed_subtitle = normalizeRawSubtitle(Array.isArray(patch.processedSubtitle) ? patch.processedSubtitle : []);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "subtitleSource")) {
        row.subtitle_source = String(patch.subtitleSource || "");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "subtitleUploadCount")) {
        row.subtitle_upload_count = Math.max(0, Number(patch.subtitleUploadCount || 0));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "subtitleUploadedAt")) {
        row.subtitle_uploaded_at = String(patch.subtitleUploadedAt || "");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "summaryCallCount")) {
        row.summary_call_count = Math.max(0, Number(patch.summaryCallCount || 0));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "segmentsCallCount")) {
        row.segments_call_count = Math.max(0, Number(patch.segmentsCallCount || 0));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "rumorsCallCount")) {
        row.rumors_call_count = Math.max(0, Number(patch.rumorsCallCount || 0));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "summary")) {
        row.summary = String(patch.summary || "");
        row.summary_model = modelName;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "segments")) {
        row.segments = Array.isArray(patch.segments) ? patch.segments : [];
        row.segments_model = modelName;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "rumors")) {
        row.rumors = patch.rumors && typeof patch.rumors === "object" ? JSON.stringify(patch.rumors) : null;
        row.rumors_model = modelName;
    }
    return row;
}

function hasEnoughSubtitleRows(list, minRows = 10) {
    return Array.isArray(list) && list.length >= minRows;
}

function hasEnoughSummaryText(text, minLength = 100) {
    return String(text || "").trim().length >= minLength;
}

function hasEnoughSegments(list, minCount = 3) {
    return Array.isArray(list) && list.length >= minCount;
}

function hasEnoughRumorsContent(value, minLength = 100) {
    if (!value || typeof value !== "object") return false;
    return String(JSON.stringify(value) || "").length >= minLength;
}

function filterCloudFeaturePatch(patch) {
    const next = {};
    if (Object.prototype.hasOwnProperty.call(patch, "summary") && hasEnoughSummaryText(patch.summary)) {
        next.summary = patch.summary;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "segments") && hasEnoughSegments(patch.segments)) {
        next.segments = patch.segments;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "rumors") && hasEnoughRumorsContent(patch.rumors)) {
        next.rumors = patch.rumors;
    }
    return next;
}

async function fetchVideoCacheMetaRow(bvid, settings, columns = []) {
    if (!isSupabaseEnabled(settings)) return null;
    const normalizedBvid = normalizeBvid(bvid);
    const fieldList = ["bvid", ...(Array.isArray(columns) ? columns : [])]
        .filter(Boolean)
        .filter((value, index, arr) => arr.indexOf(value) === index);
    if (!normalizedBvid) return null;
    const table = settings.supabaseVideoCacheTable || SUPABASE_DEFAULT_VIDEO_CACHE_TABLE;
    logCache.debug("cloud_meta_fetch_start", {
        bvid: normalizedBvid,
        detail: {
            table,
            fields: fieldList
        }
    });
    const rows = await supabaseSelect(settings, table, {
        select: fieldList.join(","),
        bvid: `eq.${normalizedBvid}`,
        limit: "1"
    }, {
        requestName: "video_cache_meta_fetch",
        errorMessage: "video_cache 查询失败"
    });
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    logCache.debug("cloud_meta_fetch_success", {
        bvid: normalizedBvid,
        detail: {
            table,
            found: !!row,
            fields: fieldList
        }
    });
    return row;
}

function getVideoCacheUploadFields(row) {
    return Object.keys(row || {}).filter((key) => key !== "bvid" && key !== "updated_at");
}

function isSupabaseDuplicateKeyError(error) {
    const text = [
        error?.code,
        error?.message,
        error?.responseText,
        error?.details
    ].filter(Boolean).join("\n");
    return /23505|duplicate key|already exists|violates unique constraint/i.test(text);
}

async function saveVideoCacheRow(bvid, settings, row, existingRow = null) {
    const normalizedBvid = normalizeBvid(bvid);
    if (!isSupabaseEnabled(settings) || !normalizedBvid || !row || typeof row !== "object") return false;
    const table = settings.supabaseVideoCacheTable || SUPABASE_DEFAULT_VIDEO_CACHE_TABLE;
    const hasExisting = !!(existingRow && typeof existingRow === "object" && String(existingRow.bvid || "").trim());
    const method = hasExisting ? "PATCH" : "POST";
    const fields = getVideoCacheUploadFields(row);
    logCache.info("cloud_cache_upload_start", {
        task: "cloud",
        bvid: normalizedBvid,
        detail: {
            table,
            method,
            has_existing: hasExisting,
            fields
        }
    });
    try {
        await supabaseWrite(settings, table, row, {
            method,
            params: hasExisting ? { bvid: `eq.${normalizedBvid}` } : {},
            requestName: "video_cache_write",
            errorMessage: `video_cache ${method} 失败`
        });
        logCache.info("cloud_cache_upload_success", {
            task: "cloud",
            bvid: normalizedBvid,
            detail: {
                table,
                method,
                fields
            }
        });
    } catch (error) {
        if (method === "POST" && isSupabaseDuplicateKeyError(error)) {
            logCache.warn("cloud_cache_upload_retry_update", {
                task: "cloud",
                bvid: normalizedBvid,
                code: "SUPABASE_DUPLICATE_POST_RETRY_PATCH",
                detail: {
                    table,
                    fields,
                    reason: "post_duplicate_key"
                }
            });
            await supabaseWrite(settings, table, row, {
                method: "PATCH",
                params: { bvid: `eq.${normalizedBvid}` },
                requestName: "video_cache_write_retry_patch",
                errorMessage: "video_cache POST 冲突后 PATCH 失败"
            });
            logCache.info("cloud_cache_upload_success", {
                task: "cloud",
                bvid: normalizedBvid,
                detail: {
                    table,
                    method: "PATCH",
                    retry_from: "POST_DUPLICATE",
                    fields
                }
            });
            return true;
        }
        logBackground.error("cloud_cache_upload_failed", {
            task: "cloud",
            bvid: normalizedBvid,
            code: "SUPABASE_VIDEO_CACHE_UPLOAD_FAILED",
            detail: {
                table,
                method,
                fields,
                error_message: error.message || "video_cache upload failed"
            }
        });
        throw error;
    }
    return true;
}

async function persistCloudSubtitlePatch(bvid, settings, cache, extra = {}) {
    if (!isSupabaseEnabled(settings)) return false;
    const normalizedBvid = normalizeBvid(bvid);
    if (!normalizedBvid) return false;
    const rawSubtitle = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    const processedSubtitle = Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle : [];
    const subtitleSource = String(extra.subtitleSource || cache?.subtitleSource || "");
    const minRows = isAsrSubtitleSource(subtitleSource) ? 1 : 10;
    if (!hasEnoughSubtitleRows(rawSubtitle, minRows) || !hasEnoughSubtitleRows(processedSubtitle, minRows)) {
        logCache.info("cloud_subtitle_skip", {
            bvid: normalizedBvid,
            raw_count: rawSubtitle.length,
            processed_count: processedSubtitle.length,
            reason: "subtitle_too_short",
            subtitle_source: subtitleSource,
            min_rows: minRows
        });
        return false;
    }
    try {
        const current = await fetchVideoCacheMetaRow(normalizedBvid, settings, ["subtitle_upload_count"]);
        const row = buildSupabaseVideoPatch(normalizedBvid, settings, {
            title: String(extra.title || cache?.title || ""),
            rawSubtitle,
            processedSubtitle,
            subtitleSource,
            subtitleUploadCount: Math.max(0, Number(current?.subtitle_upload_count || 0)) + 1,
            subtitleUploadedAt: new Date().toISOString()
        });
        const meaningfulKeys = Object.keys(row).filter((key) => key !== "bvid" && key !== "updated_at");
        if (!meaningfulKeys.length) return false;
        logCache.info("cloud_subtitle_write_start", {
            task: "cloud",
            bvid: normalizedBvid,
            detail: {
                fields: meaningfulKeys,
                raw_count: rawSubtitle.length,
                processed_count: processedSubtitle.length,
                subtitle_source: subtitleSource,
                next_upload_count: row.subtitle_upload_count || 0
            }
        });
        await saveVideoCacheRow(normalizedBvid, settings, row, current);
        logCache.info("cloud_subtitle_write", {
            task: "cloud",
            bvid: normalizedBvid,
            detail: {
                fields: meaningfulKeys,
                raw_count: rawSubtitle.length,
                processed_count: processedSubtitle.length,
                subtitle_source: subtitleSource,
                upload_count: row.subtitle_upload_count || 0
            }
        });
        return true;
    } catch (error) {
        logBackground.error("cloud_subtitle_write_fail", {
            bvid: normalizedBvid,
            error: error.message || "cloud subtitle write failed"
        });
        return false;
    }
}

async function incrementCloudVideoCallCount(bvid, settings, task) {
    if (!isSupabaseEnabled(settings)) return false;
    const normalizedTask = String(task || "").trim();
    const fieldMap = {
        summary: "summary_call_count",
        segments: "segments_call_count",
        rumors: "rumors_call_count"
    };
    const targetField = fieldMap[normalizedTask];
    const normalizedBvid = normalizeBvid(bvid);
    if (!targetField || !normalizedBvid) return false;
    try {
        const current = await fetchVideoCacheMetaRow(normalizedBvid, settings, [targetField]);
        const nextValue = Math.max(0, Number(current?.[targetField] || 0)) + 1;
        const patchKey = normalizedTask === "summary"
            ? "summaryCallCount"
            : normalizedTask === "segments"
                ? "segmentsCallCount"
                : "rumorsCallCount";
        const row = buildSupabaseVideoPatch(normalizedBvid, settings, {
            [patchKey]: nextValue
        });
        logCache.info("cloud_call_count_increment_start", {
            task: "cloud",
            bvid: normalizedBvid,
            detail: {
                feature: normalizedTask,
                field: targetField,
                previous_value: Math.max(0, Number(current?.[targetField] || 0)),
                next_value: nextValue
            }
        });
        await saveVideoCacheRow(normalizedBvid, settings, row, current);
        logCache.info("cloud_call_count_increment", {
            task: "cloud",
            bvid: normalizedBvid,
            detail: {
                feature: normalizedTask,
                field: targetField,
                value: nextValue
            }
        });
        return true;
    } catch (error) {
        logBackground.error("cloud_call_count_increment_fail", {
            bvid: normalizedBvid,
            task: normalizedTask,
            error: error.message || "cloud call count increment failed"
        });
        return false;
    }
}

async function persistCloudFeaturePatch(bvid, settings, patch) {
    if (!isSupabaseEnabled(settings)) return false;
    const filteredPatch = filterCloudFeaturePatch(patch || {});
    const cache = await getCache(bvid);
    const title = String(cache?.title || "").trim();
    const row = buildSupabaseVideoPatch(bvid, settings, {
        ...filteredPatch,
        ...(title ? { title } : {})
    });
    const meaningfulKeys = Object.keys(row).filter((key) => key !== "bvid" && key !== "updated_at");
    if (!row.bvid || !meaningfulKeys.length) {
        logCache.info("cloud_cache_skip", {
            bvid: normalizeBvid(bvid),
            fields: Object.keys(patch || {}),
            reason: "content_too_short"
        });
        return false;
    }
    try {
        const current = await fetchVideoCacheMetaRow(row.bvid, settings, ["updated_at"]);
        logCache.info("cloud_feature_write_start", {
            task: "cloud",
            bvid: row.bvid,
            detail: {
                fields: meaningfulKeys,
                feature_fields: Object.keys(filteredPatch),
                has_existing: !!current
            }
        });
        await saveVideoCacheRow(row.bvid, settings, row, current);
        logCache.info("cloud_cache_write", {
            task: "cloud",
            bvid: row.bvid,
            detail: {
                fields: meaningfulKeys,
                feature_fields: Object.keys(filteredPatch),
                has_existing: !!current
            }
        });
        return true;
    } catch (error) {
        logBackground.error("cloud_cache_write_fail", {
            bvid: row.bvid,
            fields: meaningfulKeys,
            error: error.message || "cloud write failed"
        });
        return false;
    }
}

async function getOrCreateAnonymousUserId() {
    const { anonymousUserId } = await chrome.storage.local.get(["anonymousUserId"]);
    const existing = String(anonymousUserId || "").trim();
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await chrome.storage.local.set({ anonymousUserId: created });
    return created;
}

function normalizeUsageTitle(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

async function getUsageVideoContext(bvid, metrics = {}) {
    const normalizedBvid = normalizeBvid(bvid || metrics?.bvid || "");
    let title = normalizeUsageTitle(metrics?.title || "");
    if (normalizedBvid && !title) {
        try {
            const cache = await getCache(normalizedBvid);
            title = normalizeUsageTitle(cache?.title || "");
        } catch (_) {}
    }
    return {
        bvid: normalizedBvid,
        title
    };
}

function shouldRetryUsageDailyLegacy(error) {
    const text = `${error?.message || ""}\n${error?.responseText || ""}`;
    if (!text) return false;
    return /Could not find the function|schema cache|PGRST202|parameter|v_bvid|v_title/i.test(text);
}

async function reportFeatureUsage(featureName, bvid, settings, metrics) {
    if (!isSupabaseEnabled(settings)) return false;
    const tokenCount = Math.max(0, Number(metrics?.tokens || 0));
    const normalizedFeature = String(featureName || "").trim();
    if (!normalizedFeature) return false;
    try {
        const usageContext = await getUsageVideoContext(bvid, metrics);
        await reportDailyFeatureUsage(normalizedFeature, settings, metrics, "success", "", usageContext);
        logAI.info("usage_reported", {
            feature: normalizedFeature,
            bvid: normalizeBvid(bvid),
            tokens: tokenCount
        });
        return true;
    } catch (error) {
        logBackground.error("usage_report_fail", {
            feature: String(featureName || ""),
            bvid: normalizeBvid(bvid),
            error: error.message || "usage report failed"
        });
        return false;
    }
}

async function reportDailyFeatureUsage(featureName, settings, metrics = {}, status = "success", errorCode = "", usageContext = {}) {
    if (!isSupabaseEnabled(settings)) return false;
    const normalizedFeature = String(featureName || "").trim();
    if (!normalizedFeature) return false;
    try {
        const manifest = chrome.runtime.getManifest();
        const userId = await getOrCreateAnonymousUserId();
        const normalizedContext = await getUsageVideoContext(usageContext?.bvid || metrics?.bvid || "", {
            title: usageContext?.title || metrics?.title || ""
        });
        const rpcName = settings.supabaseUsageDailyRpcName || SUPABASE_DEFAULT_USAGE_DAILY_RPC;
        const legacyPayload = {
            f_name: normalizedFeature,
            f_status: String(status || "success"),
            e_code: String(errorCode || ""),
            p_provider: String(metrics?.provider || settings.provider || ""),
            p_model: String(metrics?.model || getTaskModelName(settings) || settings.model || ""),
            ext_version: String(manifest.version || ""),
            t_count: Math.max(0, Number(metrics?.tokens || 0)),
            d_ms: Math.max(0, Number(metrics?.latencyMs || metrics?.durationMs || 0)),
            u_id: userId
        };
        const nextPayload = {
            ...legacyPayload,
            v_bvid: normalizedContext.bvid,
            v_title: normalizedContext.title
        };
        logAI.info("usage_daily_report_start", {
            task: "usage",
            bvid: normalizedContext.bvid,
            detail: {
                feature: normalizedFeature,
                status: String(status || "success"),
                error_code: String(errorCode || ""),
                provider: legacyPayload.p_provider,
                model: legacyPayload.p_model,
                extension_version: legacyPayload.ext_version,
                title: normalizedContext.title,
                tokens: legacyPayload.t_count,
                duration_ms: legacyPayload.d_ms
            }
        });
        try {
            await supabaseRpc(settings, rpcName, nextPayload, {
                requestName: "usage_daily_report",
                errorMessage: "Supabase daily usage RPC 失败"
            });
        } catch (error) {
            if (!shouldRetryUsageDailyLegacy(error)) throw error;
            await supabaseRpc(settings, rpcName, legacyPayload, {
                requestName: "usage_daily_report_legacy",
                errorMessage: "Supabase daily usage legacy RPC 失败"
            });
            logBackground.warn("usage_daily_legacy_payload", {
                task: "usage",
                bvid: normalizedContext.bvid,
                detail: {
                    feature: normalizedFeature,
                    reason: "rpc_schema_not_upgraded"
                }
            });
        }
        logAI.info("usage_daily_reported", {
            task: "usage",
            bvid: normalizedContext.bvid,
            detail: {
                feature: normalizedFeature,
                status: String(status || "success"),
                error_code: String(errorCode || ""),
                provider: legacyPayload.p_provider,
                model: legacyPayload.p_model,
                extension_version: legacyPayload.ext_version,
                title: normalizedContext.title,
                tokens: Math.max(0, Number(metrics?.tokens || 0)),
                duration_ms: legacyPayload.d_ms
            }
        });
        return true;
    } catch (error) {
        logBackground.error("usage_daily_report_fail", {
            task: "usage",
            code: "USAGE_DAILY_REPORT_FAILED",
            bvid: normalizeBvid(usageContext?.bvid || metrics?.bvid || ""),
            detail: {
                feature: normalizedFeature,
                status: String(status || "success"),
                error_code: String(errorCode || ""),
                error_message: error.message || "daily usage report failed"
            }
        });
        return false;
    }
}

async function getPromptSettingsFromSync() {
    const { promptSettings } = await chrome.storage.sync.get(["promptSettings"]);
    return normalizePromptSettings(promptSettings || DEFAULT_PROMPT_SETTINGS);
}

function withPromptSettings(settings, promptSettings) {
    const normalizedPromptSettings = normalizePromptSettings(promptSettings);
    return {
        ...settings,
        promptSettings: normalizedPromptSettings,
        prompts: {
            summary: normalizedPromptSettings.custom.summary,
            segments: normalizedPromptSettings.custom.segments,
            rumors: normalizedPromptSettings.custom.rumors
        }
    };
}

async function getResolvedSettings() {
    const { settings } = await chrome.storage.local.get(["settings"]);
    const normalizedSettings = normalizeSettings(settings);
    const { promptSettings } = await chrome.storage.sync.get(["promptSettings"]);
    let normalizedPromptSettings = normalizePromptSettings(promptSettings || DEFAULT_PROMPT_SETTINGS);
    if (!promptSettings && settings?.prompts && typeof settings.prompts === "object") {
        normalizedPromptSettings = normalizePromptSettings({
            mode: "custom",
            guided: DEFAULT_PROMPT_SETTINGS.guided,
            custom: settings.prompts
        });
        await chrome.storage.sync.set({ promptSettings: normalizedPromptSettings });
    }
    return withPromptSettings(normalizedSettings, normalizedPromptSettings);
}

function logAIPromptBuilt({ bvid, task, provider, mode, prompt, promptSettings }) {
    const text = String(prompt || "");
    const promptMeta = summarizePromptSettings(promptSettings);
    const safePromptMeta = {
        setting_mode: promptMeta.prompt_mode,
        tone: promptMeta.tone,
        detail_level: promptMeta.detail_level,
        custom_enabled: promptMeta.custom_prompt_enabled,
        custom_summary_chars: promptMeta.custom_summary_prompt_chars,
        custom_segments_chars: promptMeta.custom_segments_prompt_chars,
        custom_rumors_chars: promptMeta.custom_rumors_prompt_chars
    };
    logAI.info("ai_prompt_built", {
        bvid,
        task,
        provider,
        mode,
        detail: {
            prompt_chars: text.length,
            ...promptMeta
        }
    });
    logAI.info("ai_request_text_built", {
        bvid,
        task,
        provider,
        mode,
        detail: {
            request_chars: text.length,
            ...safePromptMeta
        }
    });
    if (!currentDebugMode) return;
    const chunkSize = 260;
    const chunks = [];
    for (let index = 0; index < text.length; index += chunkSize) {
        chunks.push(text.slice(index, index + chunkSize));
    }
    const total = Math.max(1, chunks.length);
    (chunks.length ? chunks : [""]).forEach((chunk, index) => {
        logAI.info("ai_request_text_chunk", {
            bvid,
            task,
            provider,
            mode,
            detail: {
                chunk_index: index + 1,
                chunk_total: total,
                chars_total: text.length,
                chunk_text: chunk
            }
        });
    });
}

function logAIResponseText({ provider, model, durationMs, text }) {
    const source = String(text || "");
    logAI.info("ai_response_text_built", {
        provider,
        model,
        duration_ms: durationMs,
        detail: {
            response_chars: source.length
        }
    });
    const chunkSize = 260;
    const chunks = [];
    for (let index = 0; index < source.length; index += chunkSize) {
        chunks.push(source.slice(index, index + chunkSize));
    }
    const total = Math.max(1, chunks.length);
    (chunks.length ? chunks : [""]).forEach((chunk, index) => {
        logAI.info("ai_response_text_chunk", {
            provider,
            model,
            duration_ms: durationMs,
            detail: {
                chunk_index: index + 1,
                chunk_total: total,
                chars_total: source.length,
                reply_chunk: chunk
            }
        });
    });
}

function summarizePromptSettings(promptSettings = {}) {
    const normalized = normalizePromptSettings(promptSettings || {});
    const mode = normalized.mode === "custom" ? "custom" : "guided";
    const custom = normalized.custom || {};
    return {
        prompt_mode: mode,
        tone: normalized.guided?.tone || "",
        detail_level: normalized.guided?.detail || "",
        custom_prompt_enabled: mode === "custom",
        custom_summary_prompt_chars: String(custom.summary || "").length,
        custom_segments_prompt_chars: String(custom.segments || "").length,
        custom_rumors_prompt_chars: String(custom.rumors || "").length
    };
}

function pushGlobalLog(entry) {
    if (!entry || typeof entry !== "object") return;
    globalLogs.push(entry);
    if (globalLogs.length > MAX_LOGS) {
        globalLogs.splice(0, globalLogs.length - MAX_LOGS);
    }
}

async function syncDebugModeFromStorage() {
    try {
        const { settings } = await chrome.storage.local.get(["settings"]);
        const normalized = normalizeSettings(settings);
        currentDebugMode = !!normalized.debugMode;
        syncRuntimeDebugFlag(currentDebugMode);
    } catch (_) {}
}
