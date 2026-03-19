import SubtitleProcessor from "./utils/subtitleProcessor.js";
import { robustJSONParse } from "./utils/jsonParse.js";
import { callAI, callAIStream, PROVIDERS } from "./utils/providerAdapter.js";
import "./logger.js";

let IS_DEBUG_MODE = false;

const logger = {
    info: (...args) => { if (IS_DEBUG_MODE) console.log("[Background]", ...args); },
    warn: (...args) => { if (IS_DEBUG_MODE) console.warn("[Background]", ...args); },
    error: (...args) => { if (IS_DEBUG_MODE) console.error("[Background]", ...args); }
};

const MAX_GLOBAL_CONCURRENCY = 1;
const TASK_TIMEOUT_MS = 120000;
const MAX_SUBTITLE_CHARS = 36000;
const GROQ_AUDIO_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const TASK_KEYS = ["summary", "segments", "rumors"];
const TASK_PROMPT_FORMAT_RULES = {
    segments: "【技术规范】只输出 JSON 数组，严禁包含任何 Markdown 代码块或解释性文字。格式严格遵守：[{\"start\":数字,\"end\":数字,\"label\":\"字符串\",\"type\":\"content\"|\"ad\"}]。",
    rumors: "【技术规范】只输出 JSON 对象，严禁 Markdown。结构必须包含：{ \"overall_score\": 数字, \"overview\": \"字符串\", \"claims\": [{\"text\":\"内容\",\"timestamp\":数字,\"verdict\":布尔值,\"analysis\":\"原因\"}] }。",
    summary: "【技术规范】输出纯文本，严禁使用 Markdown 格式（如 #, **, > 等符号），严禁输出 JSON。"
};
const MERGED_SEGMENTS_FORMAT_RULE = `
【分段输出字段规范（必须匹配系统标准）】
SEGMENTS 部分必须输出 JSON 数组，每个对象必须且仅能包含以下字段：
- start: 数字（秒）
- end: 数字（秒，且必须大于 start）
- label: 字符串（章节标题）
- type: "content" 或 "ad"

禁止输出字段：time_start、time_end、start_time、end_time、title、name、summary、content 等。
示例：
[{"start":0,"end":105,"label":"案件引入与背景介绍","type":"content"}]
`.trim();
const OUTPUT_PROTOCOL = `
【输出协议 - 严格执行】
你必须严格按照以下格式输出，任何偏离都会导致解析失败：

<<<SUMMARY_START>>>
（总结正文，纯文本，不要 JSON 不要 Markdown）
<<<SUMMARY_END>>>

<<<SEGMENTS_START>>>
（分段 JSON 数组，不要任何其他文字）
<<<SEGMENTS_END>>>

禁止：
- 禁止在标签外输出任何解释文字
- 禁止修改标签格式（<<<和>>>必须保留）
- 禁止在 SEGMENTS 部分输出非 JSON 内容
- 禁止省略任何一个标签
`.trim();
const BASE_PROMPT = `
你是一个中文视频内容分析助手。请基于字幕内容完成分析。
如果字幕中存在明显识别错误，可根据上下文进行合理修正。
忽略无意义重复、口误和噪声内容。
`;
const TASK_PROMPTS = {
    summary: `
任务：总结视频核心内容。

要求：
1. 先概括视频主题和核心结论，让用户快速知道视频在讲什么。
2. 再输出视频中的主要观点、关键信息和重要细节。
3. 重点提炼信息，不要逐句复述字幕。
4. 忽略广告、赞助、推广和无关闲聊。
5. 如果字幕存在明显识别错误，可根据上下文合理修正。
`,
    segments: `
任务：根据字幕内容划分视频章节，并识别广告段落。

要求：
1. 按内容逻辑划分章节，通常为 5–10 个，具体数量可根据视频长度调整。
2. 每个章节需要有：
   - 一个简短清晰的小标题，像视频进度条章节标题
   - 一段精炼的内容概述，概括本段核心信息
3. 章节必须按时间顺序排列，并尽量连续覆盖视频内容，不要出现明显重叠或错序。
   - 但广告段例外：广告的 start 和 end 必须精确对应字幕中推广内容的实际边界，
   - 允许广告段与相邻 content 段之间存在小段空隙，不强求无缝衔接。

广告识别规则：
4. 广告通常具有以下特征：
   - 博主从讲述视频内容转为推荐产品或服务
   - 出现品牌介绍、购买、下载、注册链接、优惠等内容
   - 出现"感谢赞助 / 本期视频由…支持 / 推荐大家试试"
   - 视频主线突然中断，插入与主题无关的推广

5. 广告边界定义：
   - 广告开始：字幕中第一条出现明确产品名、品牌名或购买引导的那一句，以该句时间戳为准。过渡语（如"咱们先缓缓""起来活动活动"）不算广告开始。
   - 广告结束：字幕中第一条重新出现"当事人说""话说回来""好了说回正题"或明确回归故事叙述的那一句，以该句时间戳为准。
   - 广告段内出现的"用户好评""家人推荐""朋友使用体验"等内容，仍属于广告段的一部分，不视为回归主线。

6. 时间戳规则（严格执行）：
   - 输出的 start 和 end 必须直接来自字幕中对应那句话的时间戳，禁止自行估算。
   - 转换方法：[m:ss] 转秒数 = m×60+ss，例如 [6:47] = 6×60+47 = 407。
   - 如果找不到对应句子的精确时间戳，宁可缩小广告区间，不可扩大。

7. 其他规则：
   - 广告段标记为 ad，正常内容标记为 content。
   - 频道介绍、开场白、结尾感谢语不算广告。
   - 如果边界不确定，缩小广告区间，不要过度标记。
`,
    rumors: `
任务：识别视频中值得核查的重要声明，并评估其可信度。

筛选要求：
1. 只选择对视频核心结论、主要观点或关键判断有明显影响的声明。
2. 优先选择反直觉、争议性强、涉及事实判断，或需要验证的重要说法。
3. 忽略广告、情绪表达、主观感受、闲聊和无关描述。

分析要求：
4. 对每个声明进行简要分析，并判断其可信度。
5. 如果内容依赖实时信息、外部事实或当前无法确认的信息，可标记为 unknown。
6. 分析应尽量客观、简洁，不要展开过长论述。
7. 如果字幕存在明显识别错误，可结合上下文做合理理解，但不要凭空补充事实。
`
};
const TONE_PROMPTS = {
    casual: "输出风格更轻松自然，尽量通俗易懂，减少过于学术化表达。",
    balanced: "输出风格清晰自然，在易懂与信息密度之间保持平衡。",
    professional: "输出风格更严谨专业，优先使用准确、克制、结构清晰的表达。"
};
const DETAIL_PROMPTS = {
    brief: "内容尽量简洁，只保留最核心的信息和结论。",
    normal: "在简洁基础上补充主要观点和必要细节。",
    detailed: "尽量完整展开主要观点、背景、逻辑和结论，但保持结构清晰，不要冗长重复。"
};
const DEFAULT_PROMPT_SETTINGS = {
    mode: "guided",
    guided: {
        tone: "balanced",
        detail: "normal"
    },
    custom: {
        summary: TASK_PROMPTS.summary,
        segments: TASK_PROMPTS.segments,
        rumors: TASK_PROMPTS.rumors
    }
};

const DEFAULT_SETTINGS = {
    provider: "modelscope",
    model: "",
    apiKey: "",
    customBaseUrl: "",
    customProtocol: "openai",
    groqApiKey: "",
    groqModel: "whisper-large-v3-turbo",
    prefMode: "efficiency",
    debugMode: false
};

const queue = [];
let activeCount = 0;
const inFlight = new Map();
const globalLogs = [];
const MAX_LOGS = 500;
const lastSubtitleSync = new Map();
const chatAbortControllers = new Map();
const tabStateCache = new Map();
const tabStateWriteTimers = new Map();
const cacheMemory = new Map();
let currentDebugMode = false;
const logBackground = globalThis.AIPluginLogger.create("background", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});
const logAI = globalThis.AIPluginLogger.create("ai", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});
const logCache = globalThis.AIPluginLogger.create("cache", {
    getDebugMode: () => currentDebugMode,
    onEntry: (entry) => {
        pushGlobalLog(entry);
    }
});

syncDebugModeFromStorage();
if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(async () => {
    const { settings } = await chrome.storage.local.get(["settings"]);
    const normalized = normalizeSettings(settings);
    await chrome.storage.local.set({ settings: normalized });
    const promptSettings = await getPromptSettingsFromSync();
    await chrome.storage.sync.set({ promptSettings });
    currentDebugMode = !!normalized.debugMode;
    if (chrome.sidePanel?.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
    logBackground.info("storage_update", { source: "on_installed", debug_mode: currentDebugMode });
});

if (chrome.action?.onClicked) {
    chrome.action.onClicked.addListener(() => {
        chrome.tabs.create({ url: "https://github.com/erikzhuang55/" }).catch(() => {});
    });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    logBackground.debug("storage_listener_trigger", { keys: Object.keys(changes || {}) });
    if (changes.settings?.newValue) {
        currentDebugMode = !!changes.settings.newValue.debugMode;
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
        .catch((error) => sendResponse({ ok: false, error: error.message || "未知错误" }));
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
            safePortPost(port, {
                type: "error",
                messageId: String(msg?.messageId || ""),
                error: error.message || "聊天失败"
            });
        });
    });
});

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current) {
        if (delta.state.current === "interrupted") {
            console.error(`[DOWNLOAD] ID: ${delta.id} | 状态: Interrupted | 原因: ${delta.error?.current || "未知"}`);
        } else if (delta.state.current === "complete") {
            console.log(`[DOWNLOAD] ID: ${delta.id} | 状态: Complete`);
        } else {
            console.log(`[DOWNLOAD] ID: ${delta.id} | 状态: ${delta.state.current}`);
        }
    }
    // 简单的进度日志（如果有 bytesReceived 和 totalBytes 变化）
    // 注意：Chrome 可能不频繁触发 bytesReceived 更新，或者没有 totalBytes
    // 这里仅作示例，生产环境可能不需要过于频繁的日志
});

async function handleMessage(msg, sender) {
    if (msg.action === "DOWNLOAD_STREAM") {
        const { url, filename } = msg.payload || {};
        const tabId = msg.tabId || sender.tab?.id;
        if (!url) throw new Error("URL is required");

        // Step 1: URL 获取日志
        logger.info("[DOWNLOAD] Step 1: Received URL", { url, filename, tabId });
        
        // [Check] 预检逻辑
        logger.info("[Check] 正在校验链接有效性...");
        try {
            const response = await fetch(url, { method: "HEAD" });
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("text/html")) {
                logger.warn("[Download] 检测到失效链接 (HTML response)", url);
                const text = "链接已失效 (403/Redirect)，请刷新页面重试";
                if (tabId) {
                    try {
                        chrome.tabs.sendMessage(tabId, { action: "SHOW_TOAST", text });
                    } catch (_) {}
                }
                throw new Error(text);
            }
        } catch (error) {
            // 如果是网络错误导致无法连接，可能也意味着无法下载，或者只是 HEAD 被拒绝
            // 这里主要拦截明确的 HTML 响应（鉴权失败跳转）
            if (error.message.includes("链接已失效")) throw error;
            logger.warn("[Check] 预检请求异常（非致命），尝试继续下载", error);
        }

        try {
            // 直接使用 chrome.downloads.download，依赖 DNR 规则处理 Referer
            const downloadId = await chrome.downloads.download({
                url: url,
                filename: filename || "download.mp4",
                saveAs: true
            });

            // Step 2: 任务创建日志
            logger.info("[DOWNLOAD] Step 2: Task created", { downloadId });
            if (!downloadId && chrome.runtime.lastError) {
                logger.error("[DOWNLOAD] Creation failed", chrome.runtime.lastError);
                throw new Error(chrome.runtime.lastError.message);
            }

            // Step 3: 进度追踪
            // 注意：onChanged 是全局监听，为了简单起见，这里仅注册一次监听器（或依赖全局已有的监听器）
            // 实际工程中可能需要维护 downloadId 映射来过滤特定任务的日志
            // 这里为了演示“详细指标”，我们临时添加一个监听器，注意内存泄漏风险（仅作演示，或者建议在全局初始化时注册）
            
            // 更好的做法是：仅打印日志，不在此处动态添加全局监听器以免重复。
            // 假设我们只关心创建成功：
            return { success: true, downloadId };

        } catch (error) {
            logBackground.error("download_failed", { url, error: error.message });
            // Step 4: 健壮性 - 输出具体错误
            logger.error("[DOWNLOAD] Error:", error);
            throw error;
        }
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
        const cache = tabState?.activeBvid ? await getCache(tabState.activeBvid) : null;
        const settings = await getResolvedSettings();
        return { tabId, tabState, cache, settings, providers: PROVIDERS };
    }
    if (msg.action === "GET_CACHE") {
        const expected = normalizeBvid(msg.bvid);
        if (!expected) {
            if (!tabId) return { bvid: "", cache: null, tabState: null };
            const tabState = await getTabState(tabId);
            const bvid = normalizeBvid(tabState?.activeBvid);
            const cache = bvid ? await getCache(bvid) : null;
            return { bvid, cache, tabState };
        }
        const cache = await getCache(expected);
        const tabState = tabId ? await getTabState(tabId) : null;
        return { bvid: expected, cache, tabState };
    }
    if (msg.action === "RUN_TASKS") {
        if (!tabId) throw new Error("tabId 缺失");
        const tasks = Array.isArray(msg.tasks) ? msg.tasks.filter((task) => TASK_KEYS.includes(task)) : [];
        if (!tasks.length) throw new Error("任务为空");
        logBackground.info("task_enqueue", { tab_id: tabId, tasks, force: msg.force !== false });
        await runTasksForTab(tabId, tasks, msg.force !== false, normalizeTaskContext(msg.taskContext));
        return {};
    }
    if (msg.action === "RUN_CHAT") {
        if (!tabId) throw new Error("tabId 缺失");
        const text = String(msg.text || "").trim();
        const messageId = String(msg.messageId || "");
        if (!text || !messageId) throw new Error("聊天参数不完整");
        const result = await runChatForTab(tabId, text, messageId);
        return { answer: result.answer, metrics: result.metrics };
    }
    if (msg.action === "ABORT_TRANSCRIPTION") {
        // Need to find and abort the transcription fetch request if possible.
        // Currently, Groq/Whisper API calls might not be easily abortable from here if they don't use AbortController.
        // But we can at least log it or add abort logic to callAI if needed.
        logBackground.info("transcription_aborted", { tabId: tabId });
        return {};
    }
    if (msg.action === "SAVE_SETTINGS") {
        const incoming = msg.settings || {};
        const merged = await mergeSettings(incoming);
        currentDebugMode = !!merged.debugMode;
        logBackground.info("storage_update", { source: "save_settings", debug_mode: currentDebugMode });
        return { settings: merged };
    }
    if (msg.action === "GET_SETTINGS") {
        const settings = await getResolvedSettings();
        return { settings, providers: PROVIDERS };
    }
    throw new Error("未知 action");
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
        const groqApiKey = String(normalizedSettings.groqApiKey || "").trim();
        const groqModel = String(normalizedSettings.groqModel || "").trim() || "whisper-large-v3-turbo";
        if (!groqApiKey) throw new Error("请先在设置中填写 Groq API Key");
        try {
            await updateTabState(tabId, {
                subtitleSource: "groq",
                transcriptionProgress: 5,
                updatedAt: Date.now()
            });
            await notifyTranscribeStatus(tabId, { stage: "start", level: "info", text: "检测到无字幕，正在转录音轨...", progress: 5, bvid });
            const media = await this.extractAudioSourceFromTab(tabId);
            if (!media?.url) throw new Error("未提取到音轨地址，可能是付费视频、CDN 限制或页面未完成加载");
            await updateTabState(tabId, { transcriptionProgress: 20, updatedAt: Date.now() });
            await notifyTranscribeStatus(tabId, { stage: "download", level: "info", text: "正在下载音轨...", progress: 20, bvid });
            const audioBlob = await this.fetchResourceToBlob(media.url, tabId, bvid);
            if (audioBlob.size >= GROQ_MAX_AUDIO_BYTES) {
                throw new Error("该视频音轨文件大小超出限制（>=24MB），目前暂不支持");
            }
            const audioFile = new File([audioBlob], "audio.m4a", { type: audioBlob.type || "audio/mp4" });
            await updateTabState(tabId, { transcriptionProgress: 55, updatedAt: Date.now() });
            
            let fakeProgress = 55;
            await notifyTranscribeStatus(tabId, { stage: "upload", level: "info", text: "正在上传音轨到 Groq...", progress: fakeProgress, bvid });
            
            const progressTimer = setInterval(() => {
                const inc = 2 + Math.floor(Math.random() * 2); // 2-3%
                fakeProgress = Math.min(88, fakeProgress + inc);
                notifyTranscribeStatus(tabId, { 
                    stage: "upload", 
                    level: "info", 
                    text: "正在上传音轨到 Groq...", 
                    progress: fakeProgress,
                    bvid
                }).catch(() => {});
            }, 2000);

            let transcription;
            try {
                transcription = await this.requestGroqTranscription(audioFile, groqApiKey, groqModel, tabId, bvid);
            } finally {
                clearInterval(progressTimer);
            }

            await notifyTranscribeStatus(tabId, { stage: "parse", level: "info", text: "Groq 正在解析中文字幕...", progress: 90, bvid });
            await updateTabState(tabId, { transcriptionProgress: 90, updatedAt: Date.now() });
            const rows = this.mapTranscriptionToRows(transcription.data);
            if (!rows.length) throw new Error("转录返回为空，未生成可用字幕");
            await handleSubtitleCaptured(tabId, {
                bvid,
                cid: Number.isFinite(cid) ? cid : 0,
                tid,
                title: title || media.title || "",
                subtitle: rows,
                source: "groq"
            });
            await updateTabState(tabId, { subtitleSource: "groq", transcriptionProgress: 100, updatedAt: Date.now() });
            await notifyTranscribeStatus(tabId, {
                stage: "done",
                level: "success",
                text: "转录成功，已写入字幕",
                progress: 100,
                quotaLine: buildGroqQuotaLine(transcription.quota),
                bvid
            });
            return { rows: rows.length, quota: transcription.quota };
        } catch (error) {
            await updateTabState(tabId, { transcriptionProgress: 0, updatedAt: Date.now() });
            throw error;
        }
    }

    static async extractAudioSourceFromTab(tabId) {
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
                return {
                    url: first?.baseUrl || first?.base_url || "",
                    title
                };
            }
        });
        return results?.[0]?.result || null;
    }

    static async fetchResourceToBlob(url, tabId, bvid = "", skipSizeCheck = false) {
        const response = await fetch(url, {
            method: "GET",
            credentials: "omit",
            mode: "cors",
            headers: {
                "Referer": "https://www.bilibili.com/",
                "User-Agent": navigator.userAgent
            }
        });
        if (!response.ok) {
            if (response.status === 403) throw new Error("资源下载失败：CDN 返回 403，可能是付费/受限内容");
            throw new Error(`资源下载失败：HTTP ${response.status}`);
        }
        const total = Number(response.headers.get("content-length") || 0);
        if (!skipSizeCheck && Number.isFinite(total) && total >= GROQ_MAX_AUDIO_BYTES) {
            throw new Error("该文件大小超出限制（>=24MB），目前暂不支持");
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
            if (!skipSizeCheck && loaded >= GROQ_MAX_AUDIO_BYTES) {
                throw new Error("该文件大小超出限制（>=24MB），目前暂不支持");
            }
        }
        const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
        if (!skipSizeCheck) await notifyTranscribeStatus(tabId, { stage: "download", level: "info", text: "下载进度：100%", progress: 55, bvid });
        return blob;
    }

    static async requestGroqTranscription(audioFile, groqApiKey, groqModel, tabId, bvid = "") {
        const formData = new FormData();
        formData.append("file", audioFile);
        formData.append("model", groqModel);
        formData.append("response_format", "verbose_json");
        formData.append("prompt", "请输出带时间戳的中文字幕，尽量保留原句语义与标点。");
        formData.append("timestamp_granularities[]", "segment");
        const response = await fetch(GROQ_AUDIO_TRANSCRIBE_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${groqApiKey}` },
            body: formData
        });
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
            }
            throw new Error(`Groq 转录失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`);
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

    static mapTranscriptionToRows(data) {
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

function parseGroqQuotaHeaders(headers) {
    return {
        remainingTokens: Number(headers.get("x-ratelimit-remaining-tokens") || 0),
        remainingRequests: Number(headers.get("x-ratelimit-remaining-requests") || 0),
        resetTokensSec: Number(headers.get("x-ratelimit-reset-tokens") || 0)
    };
}

function buildGroqQuotaLine(quota) {
    if (!quota) return "";
    const req = Number.isFinite(quota.remainingRequests) ? quota.remainingRequests : 0;
    const tok = Number.isFinite(quota.remainingTokens) ? quota.remainingTokens : 0;
    const reset = Number.isFinite(quota.resetTokensSec) && quota.resetTokensSec > 0 ? `，Token 重置约 ${formatSecondsZh(quota.resetTokensSec)}` : "";
    return `剩余配额: ${req} 次 / ${tok} tokens${reset}`;
}

function parseRetryAfterSeconds(retryHeader, detailText) {
    const direct = Number(String(retryHeader || "").trim());
    if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct);
    const text = String(detailText || "");
    const m = text.match(/retry[_-\s]?after["'\s:]+([0-9.]+)/i);
    if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return Math.ceil(n);
    }
    return 0;
}

function formatSecondsZh(value) {
    const sec = Number(value || 0);
    if (!Number.isFinite(sec) || sec <= 0) return "0 秒";
    if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} 秒`;
    const minutes = Math.floor(sec / 60);
    const remain = Math.round(sec % 60);
    return `${minutes} 分 ${remain} 秒`;
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
        logBackground.error("task_abort", { task: "subtitle_capture", tab_id: tabId, error: "missing_bvid_in_payload" });
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
        await updateTabState(tabId, {
            activeBvid: bvid,
            activeCid: Number.isFinite(cid) ? cid : 0,
            activeTid: tid,
            subtitleSource,
            transcriptionProgress: subtitleSource === "groq" ? 100 : 0,
            updatedAt: Date.now()
        });
        await pushSubtitleSyncToTab(tabId, bvid, existing, "duplicate");
        return;
    }
    const processedSubtitle = SubtitleProcessor.process(rawSubtitle);
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
        transcriptionProgress: subtitleSource === "groq" ? 100 : 0,
        lastError: "",
        taskStatus: {
            summary: "idle",
            segments: "idle",
            rumors: "idle",
            chat: "idle"
        },
        updatedAt: Date.now()
    });
    const latestCache = await getCache(bvid);
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
            const text = String(item.content ?? item.text ?? "").trim();
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

async function runTasksForTab(tabId, tasks, force, taskContext = {}) {
    const tabState = await getTabState(tabId);
    const bvid = tabState?.activeBvid;
    if (!bvid) throw new Error("未获取到视频字幕");
    const resolvedSettings = await getResolvedSettings();
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
    const cache = await getCache(bvid);
    if (!force && cache?.[task]) return cache[task];
    const key = `${bvid}|${task}`;
    logBackground.info("task_start", { tab_id: tabId, bvid, task });
    try {
        const result = await runWithDedup(key, () => requestTaskResult(bvid, task, settings, taskContext));
        await mergeCacheByBvid(bvid, { [task]: result, updatedAt: Date.now() });
        return result;
    } catch (error) {
        const status = error?.code === "TIMEOUT" ? "timeout" : "error";
        if (status === "timeout") {
            logBackground.error("task_timeout", { tab_id: tabId, bvid, task, error: error.message || "任务超时", stack: error.stack || "" });
        } else {
            logBackground.error("task_abort", { tab_id: tabId, bvid, task, error: error.message || "任务失败", stack: error.stack || "" });
        }
        await setTaskStatus(tabId, [task], status, error.message || "任务失败");
        throw error;
    }
}

async function runSummarySegmentsTasks(tabId, bvid, force, settings, taskContext = {}) {
    const cache = await getCache(bvid);
    if (!force && cache?.summary && Array.isArray(cache?.segments) && cache.segments.length) {
        await setTaskStatus(tabId, ["summary", "segments"], "done");
        return {
            summary: { ok: true, data: cache.summary || "", error: null },
            segments: { ok: true, data: cache.segments, error: null }
        };
    }
    const key = `${bvid}|summary_segments`;
    logBackground.info("task_start", { tab_id: tabId, bvid, task: "summary_segments", mode: settings.prefMode });
    const runner = settings.prefMode === "efficiency"
        ? () => runSummarySegmentsInEfficiency(tabId, bvid, force, settings, taskContext)
        : () => runSummarySegmentsInQuality(tabId, bvid, force, settings, taskContext);
    const results = await runWithDedup(key, runner);
    const summaryOk = !!results?.summary?.ok;
    const segmentsOk = !!results?.segments?.ok;
    if (!summaryOk && !segmentsOk) {
        const error = results?.summary?.error || results?.segments?.error || new Error("生成失败");
        throw error;
    }
    return results;
}

async function runChatForTab(tabId, text, messageId) {
    const tabState = await getTabState(tabId);
    const bvid = tabState?.activeBvid;
    if (!bvid) throw new Error("未获取到视频字幕");
    await setTaskStatus(tabId, ["chat"], "processing");
    const resolvedSettings = await getResolvedSettings();
    const cache = await getCache(bvid);
    const history = Array.isArray(cache.history) ? cache.history : [];
    const key = `${bvid}|chat|${messageId}`;
    logBackground.info("task_enqueue", { tab_id: tabId, bvid, tasks: ["chat"] });
    logBackground.info("task_start", { tab_id: tabId, bvid, task: "chat" });
    try {
        let lastMetrics = null;
        const answer = await runWithDedup(key, async () => {
            const subtitleText = getSubtitlePayload(cache);
            if (!subtitleText) throw new Error("无字幕可供分析");
            const recent = history.slice(-8);
            const conversation = recent.map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${item.content}`).join("\n");
            const prompt = `你是 B 站视频助手。基于字幕回答用户的问题，回答要准确、简洁。\n字幕：\n${subtitleText}\n历史：\n${conversation}\n用户问题：${text}`;
            const aiRes = await callAIWithTimeout(resolvedSettings, [{ role: "user", content: prompt }], TASK_TIMEOUT_MS);
            lastMetrics = aiRes.metrics || null;
            await appendMetrics(bvid, tabId, "chat", aiRes.metrics);
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
        const status = error?.code === "TIMEOUT" ? "timeout" : "error";
        if (status === "timeout") {
            logBackground.error("task_timeout", { tab_id: tabId, bvid, task: "chat", error: error.message || "聊天超时", stack: error.stack || "" });
        } else {
            logBackground.error("task_abort", { tab_id: tabId, bvid, task: "chat", error: error.message || "聊天失败", stack: error.stack || "" });
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
    const bvid = tabState?.activeBvid;
    if (!bvid) throw new Error("未获取到视频字幕");
    await setTaskStatus(tabId, ["chat"], "processing");
    const resolvedSettings = await getResolvedSettings();
    const cache = await getCache(bvid);
    const history = Array.isArray(cache.history) ? cache.history : [];
    const key = `${bvid}|chat_stream|${messageId}`;
    const abortKey = `${tabId}|${messageId}`;
    const abortController = new AbortController();
    chatAbortControllers.set(abortKey, abortController);
    logBackground.info("task_enqueue", { tab_id: tabId, bvid, tasks: ["chat_stream"] });
    logBackground.info("task_start", { tab_id: tabId, bvid, task: "chat_stream" });
    try {
        let lastMetrics = null;
        const answer = await runWithDedup(key, async () => {
            const subtitleText = getSubtitlePayload(cache);
            if (!subtitleText) throw new Error("无字幕可供分析");
            const recent = history.slice(-8);
            const conversation = recent.map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${item.content}`).join("\n");
            const prompt = `你是 B 站视频助手。基于字幕回答用户的问题，回答要准确、简洁。\n字幕：\n${subtitleText}\n历史：\n${conversation}\n用户问题：${text}`;
            const aiRes = await callAIWithTimeoutStream(resolvedSettings, [{ role: "user", content: prompt }], TASK_TIMEOUT_MS, (delta) => {
                safePortPost(port, { type: "delta", messageId, delta });

            }, abortController);
            lastMetrics = aiRes.metrics || null;
            await appendMetrics(bvid, tabId, "chat", aiRes.metrics);
            return aiRes.text.trim();
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
            await setTaskStatus(tabId, ["chat"], "done");
            safePortPost(port, { type: "aborted", messageId });
            return;
        }
        const status = error?.code === "TIMEOUT" ? "timeout" : "error";
        if (status === "timeout") {
            logBackground.error("task_timeout", { tab_id: tabId, bvid, task: "chat_stream", error: error.message || "聊天超时", stack: error.stack || "" });
        } else {
            logBackground.error("task_abort", { tab_id: tabId, bvid, task: "chat_stream", error: error.message || "聊天失败", stack: error.stack || "" });
        }
        await setTaskStatus(tabId, ["chat"], status, error.message || "聊天失败");
        safePortPost(port, { type: "error", messageId, error: error.message || "聊天失败" });
        throw error;
    } finally {
        chatAbortControllers.delete(abortKey);
    }
}

async function requestTaskResult(bvid, task, settings, taskContext = {}) {
    const cache = await getCache(bvid);
    const subtitleText = getSubtitlePayload(cache);
    if (!subtitleText) throw new Error("无字幕可供分析");
    const prompt = buildPrompt({
        type: task,
        subtitle: subtitleText,
        mode: settings.promptSettings?.mode || "guided",
        guided: settings.promptSettings?.guided || {},
        customPrompts: settings.promptSettings?.custom || {},
        taskContext
    });
    logAIPromptBuilt({
        bvid,
        task,
        mode: "single",
        provider: settings.provider,
        prompt
    });
    logAI.info("ai_request_start", { bvid, task, provider: settings.provider });
    const aiRes = await callAIWithTimeout(settings, [{ role: "user", content: prompt }], TASK_TIMEOUT_MS);
    logAI.info("ai_request_success", { bvid, task, provider: settings.provider, latency_ms: aiRes.metrics?.latencyMs || 0, tokens: aiRes.metrics?.tokens || 0 });
    await appendMetrics(bvid, null, task, aiRes.metrics);
    if (task === "summary") {
        return aiRes.text.trim();
    }
    if (task === "segments") {
        const parsed = robustJSONParse(aiRes.text);
        if (parsed) {
            logBackground.info("json_parse_success", { task: "segments", bvid });
        } else {
            logBackground.error("json_parse_error", { task: "segments", bvid, reason: "empty_result" });
        }
        const normalized = normalizeSegments(parsed);
        if (!normalized.length) throw new Error("分段 JSON 解析失败");
        return normalized;
    }
    const parsed = robustJSONParse(aiRes.text);
    if (parsed) {
        logBackground.info("json_parse_success", { task: "rumors", bvid });
    } else {
        logBackground.error("json_parse_error", { task: "rumors", bvid, reason: "empty_result" });
    }
    const normalized = normalizeRumors(parsed);
    if (!normalized) throw new Error("验真 JSON 解析失败");
    return normalized;
}

function createSummarySegmentsResult() {
    return {
        summary: { ok: false, data: null, error: null },
        segments: { ok: false, data: null, error: null }
    };
}

function resolveStatusByError(error) {
    return error?.code === "TIMEOUT" ? "timeout" : "error";
}

async function setTaskStatusMap(tabId, statusMap, lastError = "") {
    const current = await getTabState(tabId);
    const taskStatus = { ...(current?.taskStatus || {}) };
    Object.keys(statusMap || {}).forEach((task) => {
        const status = statusMap[task];
        if (!status) return;
        taskStatus[task] = status;
    });
    await updateTabState(tabId, { taskStatus, lastError, updatedAt: Date.now() });
}

async function applySummarySegmentsResults(tabId, bvid, results, options = {}) {
    const summaryResult = results?.summary;
    const segmentsResult = results?.segments;
    const keepProcessingTasks = new Set(Array.isArray(options.keepProcessingTasks) ? options.keepProcessingTasks : []);
    const statusMap = {};
    const cachePatch = {};
    let lastError = "";

    if (summaryResult) {
        if (summaryResult.ok) {
            cachePatch.summary = String(summaryResult.data || "");
            statusMap.summary = "done";
        } else if (keepProcessingTasks.has("summary")) {
            statusMap.summary = "processing";
        } else if (summaryResult.error) {
            statusMap.summary = resolveStatusByError(summaryResult.error);
            lastError = lastError || summaryResult.error.message || "任务失败";
        }
    }

    if (segmentsResult) {
        if (segmentsResult.ok) {
            cachePatch.segments = Array.isArray(segmentsResult.data) ? segmentsResult.data : [];
            statusMap.segments = "done";
        } else if (keepProcessingTasks.has("segments")) {
            statusMap.segments = "processing";
        } else if (segmentsResult.error) {
            statusMap.segments = resolveStatusByError(segmentsResult.error);
            lastError = lastError || segmentsResult.error.message || "任务失败";
        }
    }

    if (Object.keys(cachePatch).length) {
        await mergeCacheByBvid(bvid, { ...cachePatch, updatedAt: Date.now() });
    }
    if (Object.keys(statusMap).length) {
        await setTaskStatusMap(tabId, statusMap, lastError);
    }
}

async function runSummarySegmentsInQuality(tabId, bvid, force, settings, taskContext = {}) {
    const cache = await getCache(bvid);
    const subtitleText = getSubtitlePayload(cache);
    if (!subtitleText) throw new Error("无字幕可供分析");
    const mode = settings.promptSettings?.mode || "guided";
    const guided = settings.promptSettings?.guided || {};
    const customPrompts = settings.promptSettings?.custom || {};
    const results = createSummarySegmentsResult();
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
        const summaryPrompt = buildPrompt({ type: "summary", subtitle: subtitleText, mode, guided, customPrompts, taskContext });
        logAIPromptBuilt({ bvid, task: "summary", provider: settings.provider, mode: "quality", prompt: summaryPrompt });
        tasks.push((async () => {
            try {
                logAI.info("ai_request_start", { bvid, task: "summary", provider: settings.provider, mode: "quality" });
                const aiRes = await callAIWithTimeout(settings, [{ role: "user", content: summaryPrompt }], TASK_TIMEOUT_MS, { bypassQueue: true });
                const summaryText = String(aiRes.text || "").trim();
                if (!summaryText) throw new Error("总结生成为空");
                await appendMetrics(bvid, null, "summary", aiRes.metrics);
                results.summary = { ok: true, data: summaryText, error: null };
                await applySummarySegmentsResults(tabId, bvid, { summary: results.summary });
                logAI.info("ai_request_success", { bvid, task: "summary", provider: settings.provider, mode: "quality", latency_ms: aiRes.metrics?.latencyMs || 0, tokens: aiRes.metrics?.tokens || 0 });
            } catch (error) {
                results.summary = { ok: false, data: null, error };
                await applySummarySegmentsResults(tabId, bvid, { summary: results.summary });
                logBackground.error("ai_request_fail", { task: "summary", bvid, mode: "quality", error: error.message || "请求失败", stack: error.stack || "" });
            }
        })());
    }

    if (segmentsExists) {
        results.segments = { ok: true, data: cache.segments, error: null };
    } else {
        const segmentsPrompt = buildPrompt({ type: "segments", subtitle: subtitleText, mode, guided, customPrompts, taskContext });
        logAIPromptBuilt({ bvid, task: "segments", provider: settings.provider, mode: "quality", prompt: segmentsPrompt });
        tasks.push((async () => {
            try {
                logAI.info("ai_request_start", { bvid, task: "segments", provider: settings.provider, mode: "quality" });
                const aiRes = await callAIWithTimeout(settings, [{ role: "user", content: segmentsPrompt }], TASK_TIMEOUT_MS, { bypassQueue: true });
                const parsed = robustJSONParse(aiRes.text);
                const normalized = normalizeSegments(parsed);
                if (!normalized.length) throw new Error("分段 JSON 解析失败");
                await appendMetrics(bvid, null, "segments", aiRes.metrics);
                results.segments = { ok: true, data: normalized, error: null };
                await applySummarySegmentsResults(tabId, bvid, { segments: results.segments });
                logAI.info("ai_request_success", { bvid, task: "segments", provider: settings.provider, mode: "quality", latency_ms: aiRes.metrics?.latencyMs || 0, tokens: aiRes.metrics?.tokens || 0 });
            } catch (error) {
                results.segments = { ok: false, data: null, error };
                await applySummarySegmentsResults(tabId, bvid, { segments: results.segments });
                logBackground.error("ai_request_fail", { task: "segments", bvid, mode: "quality", error: error.message || "请求失败", stack: error.stack || "" });
            }
        })());
    }

    if (tasks.length) {
        await Promise.allSettled(tasks);
    } else {
        await applySummarySegmentsResults(tabId, bvid, results);
    }
    return results;
}

async function runSummarySegmentsInEfficiency(tabId, bvid, force, settings, taskContext = {}) {
    const cache = await getCache(bvid);
    const subtitleText = getSubtitlePayload(cache);
    if (!subtitleText) throw new Error("无字幕可供分析");
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
    const prompt = buildMergedSummarySegmentsPrompt({ subtitle: subtitleText, mode, guided, customPrompts, taskContext });
    logAIPromptBuilt({
        bvid,
        task: "summary_segments_merged",
        provider: settings.provider,
        mode: "efficiency",
        prompt
    });

    const results = createSummarySegmentsResult();
    let streamBuffer = "";
    let summaryApplied = false;
    let summaryApplyPromise = Promise.resolve();
    try {
        logAI.info("ai_request_start", { bvid, task: "summary_segments_merged", provider: settings.provider, mode: "efficiency" });
        const aiRes = await callAIWithTimeoutStream(settings, [{ role: "user", content: prompt }], TASK_TIMEOUT_MS, (delta) => {
            streamBuffer += String(delta || "");
            if (summaryApplied) return;
            const section = extractProtocolSection(streamBuffer, "<<<SUMMARY_START>>>", "<<<SUMMARY_END>>>");
            if (!section.found) return;
            const summaryText = section.content.trim();
            if (!summaryText) return;
            summaryApplied = true;
            results.summary = { ok: true, data: summaryText, error: null };
            summaryApplyPromise = applySummarySegmentsResults(tabId, bvid, { summary: results.summary }, { keepProcessingTasks: ["segments"] });
        });
        await summaryApplyPromise;
        const fullText = String(streamBuffer || aiRes.text || "");
        // DEBUG
        logger.error("[DEBUG] streamBuffer length:", streamBuffer.length);
        logger.error("[DEBUG] aiRes.text length:", (aiRes?.text || "").length);
        logger.error("[DEBUG] fullText final length:", fullText.length);
        logger.error("[DEBUG] fullText first 500:", JSON.stringify(fullText.slice(0, 500)));
        const summarySection = extractProtocolSection(fullText, "<<<SUMMARY_START>>>", "<<<SUMMARY_END>>>");
        if (!results.summary.ok && summarySection.found) {
            const summaryText = summarySection.content.trim();
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
        if (segmentsSection && segmentsSection.found) {
            logger.error("[DEBUG] segmentsSection.content slice:", JSON.stringify(segmentsSection.content.slice(0, 200)));
            const parsed = robustJSONParse(segmentsSection.content);
            logger.error("[DEBUG] parsed:", JSON.stringify(parsed)?.slice(0, 200));
            const normalized = normalizeSegments(parsed);
            logger.error("[DEBUG] normalized length:", normalized.length);
            if (normalized.length) {
                results.segments = { ok: true, data: normalized, error: null };
                segmentsResolved = true;
                const cache = await getCache(bvid);
                const subtitleArray = Array.isArray(cache?.processedSubtitle) && cache.processedSubtitle.length
                    ? cache.processedSubtitle
                    : (Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : []);
                normalized.forEach((seg) => {
                    if (seg.type !== "ad") return;
                    const lines = subtitleArray
                        .filter((item) => {
                            const t = Number(item.from ?? item.start ?? 0);
                            return t >= seg.start && t <= seg.end;
                        })
                        .map((item) => `[${item.from ?? item.start}] ${item.content ?? item.text}`)
                        .join(" ");
                    logger.error(`[DEBUG AD ${seg.start}-${seg.end}] "${seg.label}" 对应字幕:`, lines || "⚠️ 无匹配字幕");
                });
            }
        }
        if (!segmentsResolved) {
            const jsonMatch = fullText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
            if (jsonMatch) {
                const parsed = robustJSONParse(jsonMatch[0]);
                const normalized = normalizeSegments(parsed);
                if (normalized.length) {
                    results.segments = { ok: true, data: normalized, error: null };
                    segmentsResolved = true;
                    const cache = await getCache(bvid);
                    const subtitleArray = Array.isArray(cache?.processedSubtitle) && cache.processedSubtitle.length
                        ? cache.processedSubtitle
                        : (Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : []);
                    normalized.forEach((seg) => {
                        if (seg.type !== "ad") return;
                        const lines = subtitleArray
                            .filter((item) => {
                                const t = Number(item.from ?? item.start ?? 0);
                                return t >= seg.start && t <= seg.end;
                            })
                            .map((item) => `[${item.from ?? item.start}] ${item.content ?? item.text}`)
                            .join(" ");
                        logger.error(`[DEBUG AD ${seg.start}-${seg.end}] "${seg.label}" 对应字幕:`, lines || "⚠️ 无匹配字幕");
                    });
                }
            }
        }
        if (!segmentsResolved) {
            logger.error("[DEBUG] fullText length:", fullText.length);
            logger.error("[DEBUG] fullText tail (last 2000):", JSON.stringify(fullText.slice(-2000)));
            logger.error("[DEBUG] SEGMENTS_START index:", fullText.indexOf("<<<SEGMENTS_START>>>"));
            logger.error("[DEBUG] SEGMENTS_END index:", fullText.indexOf("<<<SEGMENTS_END>>>"));
            throw new Error("分段输出缺失");
        }
        await appendMetrics(bvid, null, "summary", aiRes.metrics);
        await appendMetrics(bvid, null, "segments", aiRes.metrics);
        await applySummarySegmentsResults(tabId, bvid, results);
        logAI.info("ai_request_success", { bvid, task: "summary_segments_merged", provider: settings.provider, mode: "efficiency", latency_ms: aiRes.metrics?.latencyMs || 0, tokens: aiRes.metrics?.tokens || 0 });
    } catch (error) {
        await summaryApplyPromise.catch(() => {});
        if (!results.summary.ok) {
            results.summary = { ok: false, data: null, error };
        }
        results.segments = { ok: false, data: null, error };
        await applySummarySegmentsResults(tabId, bvid, results);
        logBackground.error("ai_request_fail", { task: "summary_segments_merged", bvid, mode: "efficiency", error: error.message || "请求失败", stack: error.stack || "" });
    }
    return results;
}

function getSubtitlePayload(cache) {
    const processed = Array.isArray(cache?.processedSubtitle) ? cache.processedSubtitle : [];
    if (processed.length) {
        // processedSubtitle 的 text 已含内嵌时间戳，直接拼接
        const text = processed.map((item) => String(item.text || "").trim()).filter(Boolean).join("\n");
        if (text) return text.slice(0, MAX_SUBTITLE_CHARS);
    }
    const raw = Array.isArray(cache?.rawSubtitle) ? cache.rawSubtitle : [];
    if (raw.length) {
        const text = raw.map((item) => {
            const sec = Number(item.from ?? item.start ?? 0);
            const min = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            const content = String(item.content ?? item.text ?? "").trim();
            return content ? `[${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}] ${content}` : null;
        }).filter(Boolean).join("\n");
        if (text) return text.slice(0, MAX_SUBTITLE_CHARS);
    }
    return "";
}

function parseTimeToSeconds(value) {
    if (value == null) return NaN;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const str = String(value).trim();
    const parts = str.split(":").map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return NaN;
}

function normalizeSegmentKeyName(key) {
    return String(key || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function hasUsableSegmentValue(value) {
    if (value == null) return false;
    if (typeof value === "string" && !value.trim()) return false;
    return true;
}

function resolveSegmentField(item, aliases, fuzzyMatchers) {
    const source = item && typeof item === "object" ? item : {};
    const keys = Object.keys(source);
    if (!keys.length) return { value: undefined, key: "" };
    const normalizedMap = new Map(keys.map((key) => [normalizeSegmentKeyName(key), key]));
    for (const alias of aliases) {
        const normalizedAlias = normalizeSegmentKeyName(alias);
        const key = normalizedMap.get(normalizedAlias);
        if (!key) continue;
        const value = source[key];
        if (!hasUsableSegmentValue(value)) continue;
        return { value, key };
    }
    for (const key of keys) {
        const normalized = normalizeSegmentKeyName(key);
        const matched = fuzzyMatchers.some((matcher) => matcher.test(normalized));
        if (!matched) continue;
        const value = source[key];
        if (!hasUsableSegmentValue(value)) continue;
        return { value, key };
    }
    return { value: undefined, key: "" };
}

function normalizeSegments(value) {
    if (!Array.isArray(value)) return [];
    const startFuzzyMatchers = [/start/, /^from$/, /begin/, /tsstart/, /timestart/];
    const endFuzzyMatchers = [/end/, /^to$/, /finish/, /tsend/, /timeend/];
    const labelPrimaryFuzzyMatchers = [/label/, /title/, /name/, /chapter/, /heading/, /topic/];
    const labelFallbackFuzzyMatchers = [/summary/, /content/, /desc/, /description/, /outline/];
    const dropped = [];
    const fuzzyHits = [];
    const mapped = value
        .map((item, index) => {
            const startField = resolveSegmentField(item, ["start", "start_time", "time_start"], startFuzzyMatchers);
            const endField = resolveSegmentField(item, ["end", "end_time", "time_end"], endFuzzyMatchers);
            let labelField = resolveSegmentField(item, ["label", "title", "name"], labelPrimaryFuzzyMatchers);
            if (!hasUsableSegmentValue(labelField.value)) {
                labelField = resolveSegmentField(item, ["summary", "content"], labelFallbackFuzzyMatchers);
            }
            const start = parseTimeToSeconds(startField.value);
            const end = parseTimeToSeconds(endField.value);
            const label = String(labelField.value || "").trim();
            const type = item?.type === "ad" ? "ad" : "content";
            const valid = Number.isFinite(start) && Number.isFinite(end) && start < end && !!label;
            const exactStart = ["start", "start_time", "time_start"].includes(String(startField.key || ""));
            const exactEnd = ["end", "end_time", "time_end"].includes(String(endField.key || ""));
            const exactLabel = ["label", "title", "name", "summary", "content"].includes(String(labelField.key || ""));
            if (startField.key && endField.key && labelField.key && (!exactStart || !exactEnd || !exactLabel)) {
                fuzzyHits.push({
                    index,
                    start_key: startField.key,
                    end_key: endField.key,
                    label_key: labelField.key
                });
            }
            if (!valid) {
                dropped.push({
                    index,
                    start,
                    end,
                    labelLength: label.length,
                    startKey: startField.key,
                    endKey: endField.key,
                    labelKey: labelField.key,
                    keys: Object.keys(item || {})
                });
                return null;
            }
            return { start, end, label, type };
        })
        .filter(Boolean);
    if (fuzzyHits.length) {
        logBackground.debug("segments_normalize_fuzzy_hit", {
            hit_count: fuzzyHits.length,
            total_count: value.length,
            sample: fuzzyHits.slice(0, 5)
        });
    }
    if (dropped.length) {
        logBackground.debug("segments_normalize_drop", {
            dropped_count: dropped.length,
            total_count: value.length,
            sample: dropped.slice(0, 3)
        });
    }
    mapped.sort((a, b) => a.start - b.start);
    return mapped;
}

function normalizeRumors(value) {
    if (!value || typeof value !== "object") return null;
    const claims = Array.isArray(value.claims) ? value.claims : [];
    return {
        overall_score: Number.isFinite(Number(value.overall_score)) ? Number(value.overall_score) : 0,
        overview: String(value.overview || ""),
        claims: claims.map((claim) => ({
            claim: String(claim.claim || claim.text || ""),
            verdict: String(claim.verdict || "unknown"),
            confidence: Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : 0,
            analysis: String(claim.analysis || ""),
            timestamp_sec: Number.isFinite(Number(claim.timestamp_sec ?? claim.timestamp)) ? Number(claim.timestamp_sec ?? claim.timestamp) : 0
        }))
    };
}

async function callAIWithTimeout(settings, messages, timeoutMs, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
    const start = performance.now();
    try {
        const requestRunner = () => callAI(settings.provider, settings, messages, controller.signal);
        const res = options?.bypassQueue ? await requestRunner() : await runQueued(requestRunner);
        const latencyMs = Math.round(performance.now() - start);
        const tokenInfo = resolveTokenInfo(res.usage, res.text, messages);
        const modelScopeRemaining = res.headers?.get?.("modelscope-ratelimit-model-requests-remaining") ?? null;
        logAI.debug("provider_response", { provider: settings.provider, latency_ms: latencyMs, ...tokenInfo, has_text: !!res.text });
        return { text: res.text || "", metrics: { latencyMs, tokens: tokenInfo.total, inputTokens: tokenInfo.input, outputTokens: tokenInfo.output, modelScopeRemaining } };
    } catch (error) {
        logAI.error("ai_request_fail", { provider: settings.provider, error: error.message || "请求失败", stack: error.stack || "" });
        if (controller.signal.aborted) {
            const timeoutError = new Error("任务超时（120 秒）");
            timeoutError.code = "TIMEOUT";
            logAI.error("ai_request_timeout", { provider: settings.provider, error: timeoutError.message, stack: timeoutError.stack || "" });
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function callAIWithTimeoutStream(settings, messages, timeoutMs, onDelta, externalController) {
    const controller = externalController || new AbortController();
    const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
    const start = performance.now();
    try {
        const res = await runQueued(() => callAIStream(settings.provider, settings, messages, controller.signal, onDelta));
        const latencyMs = Math.round(performance.now() - start);
        const tokenInfo = resolveTokenInfo(res.usage, res.text, messages);
        const modelScopeRemaining = res.headers?.get?.("modelscope-ratelimit-model-requests-remaining") ?? null;
        return { text: res.text || "", metrics: { latencyMs, tokens: tokenInfo.total, inputTokens: tokenInfo.input, outputTokens: tokenInfo.output, modelScopeRemaining } };
    } catch (error) {
        if (controller.signal.aborted) {
            if (controller.signal.reason === "aborted") {
                const aborted = new Error("已停止生成");
                aborted.code = "ABORTED";
                throw aborted;
            }
            const timeoutError = new Error("任务超时（120 秒）");
            timeoutError.code = "TIMEOUT";
            throw timeoutError;
        }
        throw error;
    } finally {
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
    tasks.forEach((task) => {
        taskStatus[task] = status;
    });
    await updateTabState(tabId, { taskStatus, lastError, updatedAt: Date.now() });
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

async function mergeCacheByBvid(bvid, patch) {
    const normalized = normalizeBvid(bvid);
    if (!normalized) return {};
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
    await chrome.storage.local.set({ [key]: merged });
    cacheMemory.set(normalized, cloneData(merged));
    logCache.debug("cache_write", { key });
    logCache.info("cache_merge", { key, fields: Object.keys(patch || {}) });
    logBackground.debug("storage_update", { key });
    return merged;
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
    const groqApiKey = String(base.groqApiKey || "").trim();
    const groqModel = String(base.groqModel || DEFAULT_SETTINGS.groqModel || "whisper-large-v3-turbo").trim() || "whisper-large-v3-turbo";
    const prefModeRaw = String(base.prefMode || DEFAULT_SETTINGS.prefMode || "quality").toLowerCase();
    const prefMode = prefModeRaw === "efficiency" ? "efficiency" : "quality";
    return {
        ...DEFAULT_SETTINGS,
        ...base,
        debugMode: !!base.debugMode,
        customProtocol,
        groqApiKey,
        groqModel,
        prefMode
    };
}

function normalizePromptSettings(raw) {
    const base = raw && typeof raw === "object" ? raw : {};
    const mode = base.mode === "custom" ? "custom" : "guided";
    const guidedRaw = base.guided && typeof base.guided === "object" ? base.guided : {};
    const customRaw = base.custom && typeof base.custom === "object" ? base.custom : {};
    const tone = Object.prototype.hasOwnProperty.call(TONE_PROMPTS, guidedRaw.tone) ? guidedRaw.tone : "balanced";
    const detail = Object.prototype.hasOwnProperty.call(DETAIL_PROMPTS, guidedRaw.detail) ? guidedRaw.detail : "normal";
    return {
        mode,
        guided: { tone, detail },
        custom: {
            summary: String(customRaw.summary || TASK_PROMPTS.summary),
            segments: String(customRaw.segments || TASK_PROMPTS.segments),
            rumors: String(customRaw.rumors || TASK_PROMPTS.rumors)
        }
    };
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

function formatDurationAsClock(totalSeconds) {
    const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function resolveDurationPromptContext(taskContext) {
    const totalSeconds = Number(taskContext?.videoDuration?.totalSeconds || 0);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
    const normalizedSec = Math.floor(totalSeconds);
    const formattedTime = String(taskContext?.videoDuration?.formattedTime || "").trim() || formatDurationAsClock(normalizedSec);
    return { totalSeconds: normalizedSec, formattedTime };
}

function buildVideoMetaBlock(taskContext) {
    const info = resolveDurationPromptContext(taskContext);
    if (!info) return "";
    return `【视频元数据】\n视频总时长为 ${info.totalSeconds} 秒 (${info.formattedTime})。`;
}

function buildDurationHardRule(taskContext) {
    const info = resolveDurationPromptContext(taskContext);
    if (!info) return "";
    return `核心强制：最后一个章节的 end 必须精确等于 ${info.totalSeconds}。禁止在覆盖全时长前提前收尾。请根据总时长将章节控制为 6-8 个并尽量均衡分布，确保 15 分钟后的内容（如结局和反转）不会被忽略。`;
}

function buildPrompt({
    type,
    subtitle,
    mode = "guided",
    guided = {},
    customPrompts = {},
    taskContext = {}
}) {
    const formatRule = TASK_PROMPT_FORMAT_RULES[type] || "";
    const videoMetaBlock = buildVideoMetaBlock(taskContext);
    const durationHardRule = type === "segments" ? buildDurationHardRule(taskContext) : "";
    const subtitleBlock = `【字幕内容】\n${subtitle}`.trim();
    if (mode === "custom") {
        const userPrompt = customPrompts[type] || TASK_PROMPTS[type] || "";
        return [
            BASE_PROMPT,
            userPrompt,
            durationHardRule,
            videoMetaBlock,
            subtitleBlock,
            formatRule
        ].filter(Boolean).join("\n\n");
    }
    const toneRule = TONE_PROMPTS[guided.tone || "balanced"] || "";
    const detailRule = DETAIL_PROMPTS[guided.detail || "normal"] || "";
    return [
        BASE_PROMPT,
        TASK_PROMPTS[type],
        "【输出风格要求】",
        toneRule,
        detailRule,
        durationHardRule,
        videoMetaBlock,
        subtitleBlock,
        formatRule
    ].filter(Boolean).join("\n\n");
}

function buildMergedSummarySegmentsPrompt({
    subtitle,
    mode = "guided",
    guided = {},
    customPrompts = {},
    taskContext = {}
}) {
    const videoMetaBlock = buildVideoMetaBlock(taskContext);
    const durationHardRule = buildDurationHardRule(taskContext);
    const subtitleBlock = `【字幕内容】\n${subtitle}`.trim();
    const summaryPrompt = mode === "custom"
        ? (customPrompts.summary || TASK_PROMPTS.summary || "")
        : (TASK_PROMPTS.summary || "");
    const segmentsPrompt = mode === "custom"
        ? (customPrompts.segments || TASK_PROMPTS.segments || "")
        : (TASK_PROMPTS.segments || "");
    const parts = [BASE_PROMPT];
    if (mode !== "custom") {
        const toneRule = TONE_PROMPTS[guided.tone || "balanced"] || "";
        const detailRule = DETAIL_PROMPTS[guided.detail || "normal"] || "";
        parts.push("【输出风格要求】", toneRule, detailRule);
    }
    parts.push("【任务1：视频总结】", summaryPrompt);
    parts.push("【任务2：视频分段】", segmentsPrompt, durationHardRule);
    parts.push(MERGED_SEGMENTS_FORMAT_RULE);
    parts.push(videoMetaBlock);
    parts.push(subtitleBlock);
    parts.push(OUTPUT_PROTOCOL);
    return parts.filter(Boolean).join("\n\n");
}

function extractProtocolSection(text, startTag, endTag) {
    const source = String(text || "");
    const startIndex = source.indexOf(startTag);
    if (startIndex < 0) {
        return { found: false, content: "" };
    }
    const contentStart = startIndex + startTag.length;
    const endIndex = source.indexOf(endTag, contentStart);
    if (endIndex < 0) {
        return { found: false, content: "" };
    }
    return {
        found: true,
        content: source.slice(contentStart, endIndex).trim()
    };
}

function extractFirstProtocolSection(text, tags) {
    const list = Array.isArray(tags) ? tags : [];
    for (const pair of list) {
        const startTag = pair?.[0];
        const endTag = pair?.[1];
        if (!startTag || !endTag) continue;
        const section = extractProtocolSection(text, startTag, endTag);
        if (section.found) return section;
    }
    return null;
}

function logAIPromptBuilt({ bvid, task, provider, mode, prompt }) {
    const text = String(prompt || "");
    logAI.info("ai_prompt_built", {
        bvid,
        task,
        provider,
        mode,
        prompt: text,
        promptLength: text.length,
        promptPreview: text.slice(0, 1000)
    });
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
    } catch (_) {}
}
