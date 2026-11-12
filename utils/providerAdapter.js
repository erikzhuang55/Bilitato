import { createAppError, createHttpError } from "./appError.js";
import {
    getMimoTokenPlanRegionCandidates,
    isMimoTokenPlanKey,
    normalizeMimoTokenPlanRegion,
    normalizeMimoTokenPlanRegionMode,
    shouldTryNextMimoTokenPlanRegion,
    resolveMimoApiBaseUrl
} from "./mimoAsr.js";

export const PROVIDERS = {
    modelscope: {
        name: "ModelScope (魔搭)",
        baseUrl: "https://api-inference.modelscope.cn/v1/",
        model: "Qwen/Qwen3.8-Flash-Next",
        models: [
            "Qwen/Qwen3.8-Flash-Next",
            "Qwen/Qwen3.8-27B",
            "Qwen/Qwen3.5-397B-A17B",
            "Qwen/Qwen3.5-122B-A10B",
            "Qwen/Qwen3.5-35B-A3B",
            "Qwen/Qwen3.5-27B",
            "deepseek-ai/DeepSeek-V4.1-Flash",
            "deepseek-ai/DeepSeek-V4-Pro",
            "deepseek-ai/DeepSeek-V4-Pro-0813",
            "deepseek-ai/DeepSeek-V4-Flash-0731"
        ],
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://modelscope.cn/my/myaccesstoken"
    },
    zhipu: {
        name: "智谱 AI",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
        model: "glm-5-turbo",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://open.bigmodel.cn/usercenter/apikeys"
    },
    gemini: {
        name: "Google Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
        model: "gemini-3.8-flash",
        type: "google",
        regUrl: "https://aistudio.google.com/apikey"
    },
    openai: {
        name: "OpenAI / 兼容",
        baseUrl: "https://api.openai.com/v1/",
        model: "gpt-6.1-sol",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://platform.openai.com/api-keys"
    },
    openrouter: {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1/",
        model: "openrouter/auto",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://openrouter.ai/settings/keys"
    },
    deepseek: {
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/",
        model: "deepseek-flash",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://platform.deepseek.com/api_keys"
    },
    kimi: {
        name: "Moonshot (Kimi)",
        baseUrl: "https://api.moonshot.cn/v1/",
        model: "kimi-k3",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://platform.moonshot.cn/console/api-keys"
    },
    mimo: {
        name: "小米 MiMo",
        baseUrl: "https://api.xiaomimimo.com/v1/",
        model: "mimo-v2.6-flash",
        headerKey: "api-key",
        tokenPrefix: "",
        regUrl: "https://mimo.mi.com/platform"
    },
    claude: {
        name: "Claude",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-5-5",
        type: "claude",
        regUrl: "https://console.anthropic.com/settings/keys"
    },
    custom: {
        name: "自定义",
        baseUrl: "",
        model: "",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: ""
    }
};

export const MODEL_CAPABILITY_RULES = Object.freeze([
    { providers: ["openai"], pattern: /^gpt-(?:5|6)(?:[.-]|$)/i, parameterMode: "openai_reasoning", defaultEffort: "medium" },
    { providers: ["deepseek"], pattern: /^deepseek-(?:flash|v4(?:[.-]pro)?(?:[.-]|$))/i, parameterMode: "openai_reasoning", defaultEffort: "high", thinkingControl: "thinking_type" },
    { providers: ["gemini"], pattern: /^gemini-(?:2\.5|3(?:\.|-))/i, parameterMode: "gemini_thinking", defaultEffort: "medium" },
    { providers: ["claude"], pattern: /^claude-(?:(?:sonnet|opus)-5-5|sonnet-4-6|opus-4-5)$/i, parameterMode: "claude_effort", defaultEffort: "medium" },
    { providers: ["openrouter"], pattern: /^(?:openai\/gpt-(?:5|6)|deepseek\/|qwen\/qwen3|moonshotai\/kimi-k[23]|z-ai\/glm-5|anthropic\/claude-(?:sonnet|opus)-(?:5|4\.7))/i, parameterMode: "openrouter_reasoning", defaultEffort: "medium" },
    { providers: ["kimi"], pattern: /^kimi-k3(?:[-.]|$)/i, parameterMode: "openai_reasoning", defaultEffort: "low" },
    { providers: ["modelscope"], pattern: /^qwen\/qwen3\.(?:5|6|7|8)-/i, parameterMode: "provider_default", thinkingControl: "enable_thinking" },
    { providers: ["modelscope"], pattern: /^deepseek-ai\/deepseek-v4(?:[.-]|$)/i, parameterMode: "provider_default", thinkingControl: "thinking_type" },
    { providers: ["modelscope", "zhipu", "mimo"], pattern: /./, parameterMode: "provider_default" },
    { providers: ["kimi"], pattern: /^(?:kimi-k|moonshot-v1)/i, parameterMode: "provider_default" },
    { providers: ["openrouter"], pattern: /./, parameterMode: "provider_default" },
    { providers: ["openai", "claude", "custom"], pattern: /./, parameterMode: "temperature" }
]);

export function getModelCapability(providerKey, model) {
    const provider = String(providerKey || "").trim().toLowerCase();
    const modelId = String(model || "").trim();
    const rule = MODEL_CAPABILITY_RULES.find((item) => item.providers.includes(provider) && item.pattern.test(modelId));
    return rule
        ? { parameterMode: rule.parameterMode, defaultEffort: rule.defaultEffort || "", thinkingControl: rule.thinkingControl || "" }
        : { parameterMode: "provider_default", defaultEffort: "", thinkingControl: "" };
}

function resolveReasoningEffort(config, capability) {
    const configured = String(config?.reasoningEffort || "").trim().toLowerCase();
    return ["none", "low", "medium", "high"].includes(configured)
        ? configured
        : capability.defaultEffort || "medium";
}

function usesReducedTaskReasoning(config = {}) {
    return ["summary", "segments", "summary_segments_merged"].includes(String(config?.requestTask || "").trim());
}

function getRemoteRequestPolicy(config, providerKey, model) {
    const policies = config?.requestPolicies || config?.remoteConfig?.requestPolicies;
    if (!policies?.enabled || Number(policies?.schemaVersion || 0) !== 1 || !Array.isArray(policies.rules)) return null;
    const provider = String(providerKey || "").trim().toLowerCase();
    const task = String(config?.requestTask || config?.task || "").trim().toLowerCase();
    return policies.rules.find((rule) => {
        if (!rule || (rule.provider !== "*" && rule.provider !== provider) || !rule.tasks?.includes(task)) return false;
        try {
            return new RegExp(rule.modelPattern, "i").test(String(model || ""));
        } catch {
            return false;
        }
    }) || null;
}

function resolveRequestPolicy(config, providerKey, model) {
    const localCapability = getModelCapability(providerKey, model);
    const remoteRule = getRemoteRequestPolicy(config, providerKey, model);
    if (!remoteRule) {
        return { capability: localCapability, source: "local", ruleId: "", mode: "" };
    }
    const transport = String(remoteRule.transport || "provider_default");
    const parameterModeByTransport = {
        reasoning_effort: "openai_reasoning",
        openrouter_reasoning: "openrouter_reasoning",
        gemini_thinking: "gemini_thinking",
        claude_effort: "claude_effort",
    };
    const thinkingControl = ["enable_thinking", "thinking_type", "chat_template_enable_thinking"].includes(transport)
        ? transport
        : "";
    return {
        capability: {
            parameterMode: parameterModeByTransport[transport] || "provider_default",
            defaultEffort: ["none", "low", "medium", "high"].includes(remoteRule.mode) ? remoteRule.mode : "",
            thinkingControl,
        },
        source: "remote",
        ruleId: String(remoteRule.id || ""),
        mode: String(remoteRule.mode || "provider_default"),
    };
}

function buildProviderRequestMetadata(config, requestBody = {}, messages = [], streaming = false, requestPolicy = {}) {
    const thinkingDisabled = requestBody.thinking?.type === "disabled"
        || requestBody.enable_thinking === false
        || requestBody.chat_template_kwargs?.enable_thinking === false;
    const reasoningEffort = String(requestBody.reasoning_effort || requestBody.reasoning?.effort || requestBody.output_config?.effort || requestBody.generationConfig?.thinkingConfig?.thinkingLevel || "");
    const outputLimit = Number(requestBody.max_tokens || requestBody.max_completion_tokens || requestBody.generationConfig?.maxOutputTokens || 0);
    const inputChars = (Array.isArray(messages) ? messages : []).reduce((sum, item) => (
        sum + normalizeTextContent(item?.content).length
    ), 0);
    return {
        request_task: String(config?.requestTask || ""),
        stream_requested: !!streaming,
        turn_count: Array.isArray(messages) ? messages.length : 0,
        input_chars: inputChars,
        output_limit: outputLimit,
        parameter_names: Object.keys(requestBody).filter((key) => !["messages", "contents"].includes(key)).sort(),
        sampling_temperature: Number.isFinite(Number(requestBody.temperature)) ? Number(requestBody.temperature) : undefined,
        top_p: Number.isFinite(Number(requestBody.top_p)) ? Number(requestBody.top_p) : undefined,
        top_k: Number.isFinite(Number(requestBody.top_k)) ? Number(requestBody.top_k) : undefined,
        response_format_type: String(requestBody.response_format?.type || ""),
        stream_usage_requested: requestBody.stream_options?.include_usage === true,
        reasoning_policy: thinkingDisabled ? "thinking_disabled" : (reasoningEffort ? "reasoning_effort" : "provider_default"),
        thinking_disabled: thinkingDisabled,
        reasoning_effort: reasoningEffort,
        reasoning_policy_source: String(requestPolicy?.source || "local"),
        reasoning_policy_rule_id: String(requestPolicy?.ruleId || ""),
        custom_protocol: String(config?.customProtocol || "")
    };
}

function getKnownProviderModels(provider = {}) {
    return new Set([
        String(provider?.model || "").trim(),
        ...(Array.isArray(provider?.models) ? provider.models : []).map((model) => String(model || "").trim())
    ].filter(Boolean));
}

export function resolveProviderScopedModel(providerKey, settings = {}, providerCatalog = PROVIDERS) {
    const currentProvider = String(providerKey || settings?.provider || "").trim().toLowerCase();
    const providerModels = settings?.providerModels && typeof settings.providerModels === "object"
        ? Object.fromEntries(Object.entries(settings.providerModels).map(([key, value]) => [
            String(key || "").trim().toLowerCase(),
            String(value || "").trim()
        ]).filter(([key]) => key))
        : {};
    const scopedModel = String(providerModels[currentProvider] || "").trim();
    const globalModel = String(settings?.model || "").trim();
    let model = scopedModel || globalModel;

    if (currentProvider !== "custom") {
        const currentModels = getKnownProviderModels(providerCatalog?.[currentProvider]);
        const knownForCurrentProvider = currentModels.has(model);
        const knownForOtherProvider = !knownForCurrentProvider && !!model && Object.entries(providerCatalog || {}).some(([key, provider]) => (
            String(key || "").trim().toLowerCase() !== currentProvider
            && String(key || "").trim().toLowerCase() !== "custom"
            && getKnownProviderModels(provider).has(model)
        ));
        const savedForOtherProvider = !knownForCurrentProvider && !!model && Object.entries(providerModels).some(([key, value]) => (
            key !== currentProvider && key !== "custom" && value === model
        ));
        if (!model || knownForOtherProvider || savedForOtherProvider) {
            model = String(providerCatalog?.[currentProvider]?.model || "").trim();
        }
    }

    if (currentProvider && model) providerModels[currentProvider] = model;
    return {
        model,
        providerModels,
        repaired: model !== (scopedModel || globalModel)
    };
}

const DEFAULT_PROVIDER_RETRY_DELAYS_MS = [700, 1600];
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

function resolveMaxOutputTokens(config = {}) {
    const value = Math.floor(Number(config?.maxOutputTokens || 0));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_OUTPUT_TOKENS;
}

function isDebugEnabled() {
    return !!globalThis.AIPluginLogger?.isDebugEnabled?.();
}

function getProviderLogger() {
    return globalThis.AIPluginLogger?.create?.("ai", {
        getDebugMode: isDebugEnabled,
        onEntry: () => {},
        printConsole: true
    });
}

function getProviderRetryDelays(config = {}) {
    if (Array.isArray(config?.providerRetryDelaysMs) && config.providerRetryDelaysMs.length) {
        return config.providerRetryDelaysMs
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 0);
    }
    return [...DEFAULT_PROVIDER_RETRY_DELAYS_MS];
}

function shouldRetryProviderRequest(error, attempt, maxAttempts) {
    return String(error?.code || "") === "PROVIDER_NETWORK_ERROR" && attempt < maxAttempts;
}

function decorateRetryMetadata(error, attempt, maxAttempts, retryDelaysMs = []) {
    if (!error || typeof error !== "object") return error;
    error.requestAttempt = Number(attempt || 0);
    error.requestMaxAttempts = Number(maxAttempts || 0);
    error.retryDelaysMs = Array.isArray(retryDelaysMs) ? [...retryDelaysMs] : [];
    error.retryStrategy = "provider_network_backoff";
    return error;
}

function createRetryAbortError(signal) {
    const error = new Error("provider retry aborted");
    if (signal?.reason === "aborted") error.code = "ABORTED";
    return error;
}

function sleepWithSignal(delayMs, signal) {
    if (!delayMs) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let timeoutId = 0;
        let cleanup = () => {};
        const handleAbort = () => {
            cleanup();
            reject(createRetryAbortError(signal));
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

function isQwenModel(model) {
    return /qwen/i.test(String(model || ""));
}

function isDeepSeekV4Model(model) {
    return /(?:^|\/)(?:deepseek-v4(?:[.-]|$)|deepseek-flash$)/i.test(String(model || "").trim());
}

function isOpenAIModelSupportingNoReasoning(model) {
    const normalized = String(model || "").trim().toLowerCase();
    if (/(?:^|-)pro(?:-|$)/.test(normalized)) return false;
    const match = normalized.match(/^gpt-(\d+)\.(\d+)(?:-|$)/);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > 5 || (major === 5 && minor >= 1);
}

function isModelScopeGlmThinkingModel(model) {
    return /(?:^|\/)glm-(?:4\.(?:5|6|7)|5(?:\.|-|$))/i.test(String(model || "").trim());
}

function isMiMoModel(model) {
    return /(?:^|\/)mimo-v2(?:\.|-|$)/i.test(String(model || "").trim());
}

function shouldUseJsonResponseFormat(messages) {
    const text = Array.isArray(messages)
        ? messages.map((item) => String(item?.content || "")).join("\n")
        : "";
    return /json|json_object|json数组|json 对象|只输出\s*json/i.test(text);
}

function appendJsonFormatHint(messages) {
    const list = Array.isArray(messages) ? messages.map((item) => ({ ...item })) : [];
    if (!list.length) return list;
    const hint = "Please output in JSON format.";
    const lastUserIndex = [...list].reverse().findIndex((item) => String(item?.role || "") === "user");
    const index = lastUserIndex >= 0 ? list.length - 1 - lastUserIndex : list.length - 1;
    const target = list[index] || { role: "user", content: "" };
    target.content = `${String(target.content || "").trim()}\n${hint}`.trim();
    list[index] = target;
    return list;
}

function shouldIncludeStreamUsage(providerKey, isCustom, protocol) {
    if (isCustom && protocol === "claude") return false;
    const normalized = String(providerKey || "").toLowerCase();
    return normalized === "openai" || normalized === "deepseek" || normalized === "custom";
}

function isClaudeRequest(req) {
    return req?.provider?.type === "claude" || (req?.isCustom && req?.protocol === "claude");
}

function normalizeTextContent(content) {
    if (Array.isArray(content)) {
        return content.map((item) => {
            if (typeof item === "string") return item;
            return item?.text || "";
        }).join("");
    }
    return String(content || "");
}

function extractGeminiText(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    return candidates.map((candidate) => {
        const parts = candidate?.content?.parts;
        if (Array.isArray(parts)) return parts.map((part) => part?.text || "").join("");
        return "";
    }).join("");
}

function extractOpenAIMessageText(data) {
    return normalizeTextContent(data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "");
}

const MAX_PROVIDER_RESPONSE_DEBUG_CHARS = 100000;
const MAX_INVALID_RESPONSE_PREVIEW_CHARS = 300;

function getResponseContentType(response) {
    return String(response?.headers?.get?.("content-type") || "").toLowerCase();
}

function looksLikeHtmlResponse(value) {
    return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(String(value || ""));
}

function createInvalidProviderResponseError(req, response, rawResponse = "", requestStream = false) {
    const contentType = getResponseContentType(response);
    const isHtml = contentType.includes("text/html") || looksLikeHtmlResponse(rawResponse);
    const message = isHtml
        ? "模型服务返回了网页内容，请检查自定义 Provider 的 Base URL 是否填写为 API 地址。"
        : "模型服务返回的内容不是有效 JSON，请检查自定义 Provider 的接口兼容性。";
    return createAppError("PROVIDER_INVALID_RESPONSE", message, {
        provider: req?.isCustom ? "custom" : "",
        model: req?.model || "",
        status: Number(response?.status || 0) || undefined,
        responseContentType: contentType,
        responseKind: isHtml ? "html" : "invalid_json",
        responsePreview: String(rawResponse || "").slice(0, MAX_INVALID_RESPONSE_PREVIEW_CHARS),
        requestEndpoint: req?.finalUrl || "",
        requestHost: safeUrlHost(req?.finalUrl),
        requestProtocol: req?.protocol || "",
        isCustomProvider: !!req?.isCustom,
        requestStream: !!requestStream,
        requestMethod: "POST",
        requestEntry: requestStream ? "callAIStream" : "callAI",
        requestPhase: "parse_response"
    });
}

async function parseProviderJsonResponse(response, req, requestStream = false) {
    const rawResponse = await response.text();
    if (getResponseContentType(response).includes("text/html") || looksLikeHtmlResponse(rawResponse)) {
        throw createInvalidProviderResponseError(req, response, rawResponse, requestStream);
    }
    try {
        return JSON.parse(rawResponse);
    } catch (_) {
        throw createInvalidProviderResponseError(req, response, rawResponse, requestStream);
    }
}

function serializeProviderResponseForDebug(data) {
    try {
        const serialized = JSON.stringify(data);
        if (serialized.length <= MAX_PROVIDER_RESPONSE_DEBUG_CHARS) return serialized;
        return `${serialized.slice(0, MAX_PROVIDER_RESPONSE_DEBUG_CHARS)}...[truncated]`;
    } catch (_) {
        return String(data || "").slice(0, MAX_PROVIDER_RESPONSE_DEBUG_CHARS);
    }
}

function getResponseContentState(content) {
    if (content === undefined) return "missing";
    if (content === null) return "null";
    return normalizeTextContent(content).trim() ? "text" : "empty";
}

function buildProviderResponseMeta(data, req, text = "") {
    if (req.provider.type === "google") {
        const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
        return {
            rawResponse: serializeProviderResponseForDebug(data),
            contentState: String(text || "").trim() ? "text" : (candidates.length ? "empty" : "missing"),
            finishReason: String(candidates[0]?.finishReason || ""),
            choiceCount: candidates.length,
            reasoningChars: 0
        };
    }
    if (isClaudeRequest(req)) {
        const content = data?.content;
        return {
            rawResponse: serializeProviderResponseForDebug(data),
            contentState: getResponseContentState(content),
            finishReason: String(data?.stop_reason || ""),
            choiceCount: Array.isArray(content) ? content.length : 0,
            reasoningChars: 0
        };
    }
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    const message = choices[0]?.message;
    const content = message && Object.prototype.hasOwnProperty.call(message, "content")
        ? message.content
        : choices[0]?.text;
    return {
        rawResponse: serializeProviderResponseForDebug(data),
        contentState: getResponseContentState(content),
        finishReason: String(choices[0]?.finish_reason || ""),
        choiceCount: choices.length,
        reasoningChars: String(message?.reasoning_content || message?.reasoning || "").length
    };
}

function splitSseEvents(buffer) {
    const parts = String(buffer || "").split(/\r?\n\r?\n/);
    return {
        events: parts.slice(0, -1),
        rest: parts[parts.length - 1] || ""
    };
}

function getSseDataPayloads(part) {
    const payloads = String(part || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
    if (!payloads.length) return [];
    if (payloads.length === 1) return payloads;
    const everyLineIsStandalonePayload = payloads.every((payload) => {
        if (payload === "[DONE]") return true;
        try {
            JSON.parse(payload);
            return true;
        } catch (_) {
            return false;
        }
    });
    return everyLineIsStandalonePayload ? payloads : [payloads.join("\n").trim()].filter(Boolean);
}

function resolveProviderRequest(providerKey, config, messages, streaming) {
    const providerCatalog = config?.providerCatalog && typeof config.providerCatalog === "object"
        ? config.providerCatalog
        : {};
    const provider = providerCatalog[providerKey]
        || providerCatalog[config.provider]
        || PROVIDERS[providerKey]
        || PROVIDERS[config.provider]
        || PROVIDERS.modelscope
        || PROVIDERS.default;
    const resolvedProviderKey = providerKey || config.provider;
    const isCustom = resolvedProviderKey === "custom";
    const protocol = String(config.customProtocol || "openai").toLowerCase() === "claude" ? "claude" : "openai";
    const apiKey = config.apiKey || "";
    const baseUrl = isCustom
        ? String(config.customBaseUrl || "").trim()
        : resolvedProviderKey === "mimo" && isMimoTokenPlanKey(apiKey)
            ? resolveMimoApiBaseUrl(apiKey, config.mimoTokenPlanRegion)
            : (provider.baseUrl || "").trim();
    const { model } = resolveProviderScopedModel(providerKey || config.provider, config, {
        ...PROVIDERS,
        ...providerCatalog
    });
    if (!baseUrl) throw new Error("自定义 Provider 需要填写 Base URL");
    if (!model) throw new Error("请填写模型名称");

    let finalUrl = baseUrl;
    if (provider.type === "google") {
        if (!finalUrl.includes(":generateContent") && !finalUrl.includes(":streamGenerateContent")) {
             finalUrl = finalUrl.replace(/\/+$/, "") + `/models/${model}:${streaming ? "streamGenerateContent" : "generateContent"}`;
        } else if (streaming && finalUrl.includes(":generateContent")) {
            finalUrl = finalUrl.replace(":generateContent", ":streamGenerateContent");
        } else if (!streaming && finalUrl.includes(":streamGenerateContent")) {
            finalUrl = finalUrl.replace(":streamGenerateContent", ":generateContent");
        }
    } else if (provider.type === "claude" || (isCustom && protocol === "claude")) {
        if (!/\/v1\/messages$/.test(finalUrl)) {
            finalUrl = finalUrl.replace(/\/+$/, "") + "/v1/messages";
        }
    } else {
        if (!finalUrl.includes('/chat/completions')) {
             finalUrl = finalUrl.replace(/\/+$/, '') + '/chat/completions';
        }
    }

    getProviderLogger()?.debug("provider_request_resolved", {
        task: "ai",
        provider: providerKey || config.provider,
        model,
        detail: {
            provider_name: provider.name,
            protocol,
            is_custom: isCustom,
            url_host: safeUrlHost(finalUrl),
            credential_type: resolvedProviderKey === "mimo"
                ? (isMimoTokenPlanKey(apiKey) ? "token_plan" : "standard")
                : "provider_default",
            token_plan_region: resolvedProviderKey === "mimo" && isMimoTokenPlanKey(apiKey)
                ? normalizeMimoTokenPlanRegion(config.mimoTokenPlanRegion)
                : "",
            token_plan_region_mode: resolvedProviderKey === "mimo" && isMimoTokenPlanKey(apiKey)
                ? normalizeMimoTokenPlanRegionMode(config.mimoTokenPlanRegionMode)
                : ""
        }
    });

    const headers = {
        "Content-Type": "application/json"
    };

    if (provider.type === "claude" || (isCustom && protocol === "claude")) {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
    } else if (provider.headerKey && provider.type !== "google") {
        headers[provider.headerKey] = (provider.tokenPrefix || "") + apiKey;
    }

    const maxOutputTokens = resolveMaxOutputTokens(config);
    const requestPolicy = resolveRequestPolicy(config, providerKey || config.provider, model);
    const capability = requestPolicy.capability;
    const reducedTaskReasoning = usesReducedTaskReasoning(config);
    const remoteThinkingDisabled = requestPolicy.source === "remote" && requestPolicy.mode === "disabled";
    const thinkingDisabled = remoteThinkingDisabled || (requestPolicy.source !== "remote" && reducedTaskReasoning && !!capability.thinkingControl);
    const reasoningEffort = remoteThinkingDisabled && capability.parameterMode === "openai_reasoning"
        ? "none"
        : requestPolicy.source === "remote" && ["none", "low", "medium", "high"].includes(requestPolicy.mode)
            ? (String(config?.requestTask || "").toLowerCase() === "chat" ? resolveReasoningEffort(config, capability) : requestPolicy.mode)
            : reducedTaskReasoning && !thinkingDisabled
        ? "low"
        : resolveReasoningEffort(config, capability);
    let body = {};
    if (provider.type === "google") {
        body = {
            contents: [{ parts: [{ text: messages[messages.length-1].content }] }],
            generationConfig: { maxOutputTokens }
        };
        if (capability.parameterMode === "gemini_thinking") {
            body.generationConfig.thinkingConfig = { thinkingLevel: reasoningEffort };
        }
        const urlObj = new URL(finalUrl);
        urlObj.searchParams.set('key', apiKey);
        if (streaming) urlObj.searchParams.set("alt", "sse");
        return {
            provider,
            isCustom,
            protocol,
            model,
            headers,
            body,
            requestPolicy,
            finalUrl: urlObj.toString()
        };
    } else if (provider.type === "claude" || (isCustom && protocol === "claude")) {
        body = {
            model,
            max_tokens: maxOutputTokens,
            messages: (messages || []).map((item) => ({
                role: item.role === "assistant" ? "assistant" : "user",
                content: String(item.content || "")
            }))
        };
        if (capability.parameterMode === "claude_effort") {
            body.output_config = { effort: reasoningEffort };
        } else if (capability.parameterMode === "temperature") {
            body.temperature = 0.3;
        }
        if (streaming) body.stream = true;
        return {
            provider,
            isCustom,
            protocol,
            model,
            headers,
            body,
            requestPolicy,
            finalUrl
        };
    } else {
        const qwenModel = isQwenModel(model);
        const jsonMode = shouldUseJsonResponseFormat(messages);
        const normalizedMessages = qwenModel && jsonMode ? appendJsonFormatHint(messages) : messages;
        body = {
            model: model,
            messages: normalizedMessages,
            max_tokens: maxOutputTokens,
            stream: !!streaming
        };
        if (thinkingDisabled && capability.thinkingControl === "enable_thinking") {
            body.enable_thinking = false;
        } else if (thinkingDisabled && capability.thinkingControl === "thinking_type") {
            body.thinking = { type: "disabled" };
        } else if (thinkingDisabled && capability.thinkingControl === "chat_template_enable_thinking") {
            body.chat_template_kwargs = { enable_thinking: false };
        } else if (capability.parameterMode === "temperature") {
            body.temperature = 0.3;
        } else if (capability.parameterMode === "openai_reasoning") {
            body.reasoning_effort = reasoningEffort;
        } else if (capability.parameterMode === "openrouter_reasoning") {
            body.reasoning = { effort: reasoningEffort, exclude: true };
        }
        if ((providerKey || config.provider) === "openai") {
            body.max_completion_tokens = body.max_tokens;
            delete body.max_tokens;
        }
        if (requestPolicy.source !== "remote" && config?.deepSeekV4ThinkingDisabled === true && isDeepSeekV4Model(model)) {
            body.thinking = { type: "disabled" };
            delete body.reasoning_effort;
        }
        const requestTask = String(config?.requestTask || config?.task || "").trim().toLowerCase();
        const isStructuredTask = requestTask === "summary" || requestTask === "segments";
        const normalizedProviderKey = String(providerKey || config?.provider || "").trim().toLowerCase();
        if (requestPolicy.source !== "remote" && isMiMoModel(model) && isStructuredTask) {
            body.thinking = { type: "disabled" };
        }
        if (requestPolicy.source !== "remote" && normalizedProviderKey === "openai" && isOpenAIModelSupportingNoReasoning(model) && isStructuredTask) {
            body.reasoning_effort = "none";
        }
        if (requestPolicy.source !== "remote" && normalizedProviderKey === "modelscope" && isModelScopeGlmThinkingModel(model) && isStructuredTask) {
            body.chat_template_kwargs = {
                ...(body.chat_template_kwargs || {}),
                enable_thinking: false
            };
        }
        if (streaming && shouldIncludeStreamUsage(providerKey || config.provider, isCustom, protocol)) {
            body.stream_options = { include_usage: true };
        }
        return {
            provider,
            isCustom,
            protocol,
            model,
            headers,
            body,
            requestPolicy,
            finalUrl
        };
    }
}

export async function callAI(providerKey, config, messages, signal, callbacks = {}) {
    const resolvedProviderKey = providerKey || config?.provider;
    if (resolvedProviderKey === "mimo"
        && isMimoTokenPlanKey(config?.apiKey)
        && normalizeMimoTokenPlanRegionMode(config?.mimoTokenPlanRegionMode) === "auto"
        && config?.mimoTokenPlanRegionProbe !== true) {
        const regions = getMimoTokenPlanRegionCandidates(
            config.apiKey,
            config.mimoTokenPlanRegion,
            config.mimoTokenPlanRegionMode
        );
        let lastError = null;
        for (let index = 0; index < regions.length; index += 1) {
            const region = regions[index];
            try {
                const result = await callAI(providerKey, {
                    ...config,
                    mimoTokenPlanRegion: region,
                    mimoTokenPlanRegionMode: "manual",
                    mimoTokenPlanRegionProbe: true
                }, messages, signal, callbacks);
                await Promise.resolve(callbacks?.onMimoTokenPlanRegionResolved?.(region)).catch(() => {});
                return result;
            } catch (error) {
                lastError = error;
                const hasNext = index < regions.length - 1;
                if (!hasNext || !shouldTryNextMimoTokenPlanRegion(error?.status, error?.message)) throw error;
                getProviderLogger()?.warn("mimo_token_plan_region_retry", {
                    task: "ai",
                    provider: "mimo",
                    model: config?.model || "",
                    status: Number(error?.status || 0) || undefined,
                    detail: { failed_region: region, next_region: regions[index + 1] }
                });
            }
        }
        throw lastError;
    }
    const req = resolveProviderRequest(providerKey, config, messages, false);
    const requestBody = req.body || {};
    const retryDelaysMs = getProviderRetryDelays(config);
    const maxAttempts = retryDelaysMs.length + 1;
    if (typeof callbacks?.onRequestMetadata === "function") {
        callbacks.onRequestMetadata(buildProviderRequestMetadata(config, requestBody, messages, false, req.requestPolicy));
    }
    getProviderLogger()?.debug("provider_request_body_built", {
        task: "ai",
        provider: providerKey,
        model: requestBody.model || "",
        detail: {
            message_count: Array.isArray(requestBody.messages) ? requestBody.messages.length : 0,
            max_tokens: Number(requestBody.max_tokens || 0),
            stream: !!requestBody.stream,
            request_task: String(config?.requestTask || ""),
            thinking_disabled: requestBody.thinking?.type === "disabled" || requestBody.enable_thinking === false,
            reasoning_effort: String(requestBody.reasoning_effort || requestBody.reasoning?.effort || requestBody.output_config?.effort || requestBody.generationConfig?.thinkingConfig?.thinkingLevel || ""),
            reasoning_policy_source: String(req.requestPolicy?.source || "local"),
            reasoning_policy_rule_id: String(req.requestPolicy?.ruleId || "")
        }
    });
    let res;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            res = await fetch(req.finalUrl, {
                method: "POST",
                headers: req.headers,
                body: JSON.stringify(req.body),
                signal
            });
            break;
        } catch (error) {
            const wrappedError = error?.code ? error : createAppError("PROVIDER_NETWORK_ERROR", "模型服务连接失败，请稍后重试", {
                cause: error,
                provider: providerKey,
                model: req.model || "",
                requestEndpoint: req.finalUrl,
                requestHost: safeUrlHost(req.finalUrl),
                requestProtocol: req.protocol,
                isCustomProvider: !!req.isCustom,
                requestStream: false,
                requestMethod: "POST",
                requestEntry: "callAI",
                requestPhase: "initial_fetch"
            });
            decorateRetryMetadata(wrappedError, attempt, maxAttempts, retryDelaysMs);
            if (!shouldRetryProviderRequest(wrappedError, attempt, maxAttempts)) throw wrappedError;
            const delayMs = retryDelaysMs[attempt - 1] || 0;
            getProviderLogger()?.warn("provider_request_retry", {
                task: "ai",
                provider: providerKey,
                model: req.model || "",
                code: wrappedError.code || "",
                detail: {
                    attempt,
                    max_attempts: maxAttempts,
                    next_delay_ms: delayMs,
                    request_entry: "callAI",
                    request_phase: "initial_fetch",
                    url_host: safeUrlHost(req.finalUrl)
                }
            });
            await sleepWithSignal(delayMs, signal);
        }
    }
    if (typeof callbacks?.onResponseStart === "function") callbacks.onResponseStart();
    if (!res.ok) {
        const errText = await res.text();
        if (req.isCustom && (getResponseContentType(res).includes("text/html") || looksLikeHtmlResponse(errText))) {
            throw createInvalidProviderResponseError(req, res, errText, false);
        }
        throw createHttpError(res.status, `API Error ${res.status}: ${errText}`, {
            responseHeaders: res.headers,
            provider: providerKey,
            model: req.model || "",
            requestEndpoint: req.finalUrl,
            requestHost: safeUrlHost(req.finalUrl),
            requestProtocol: req.protocol,
            isCustomProvider: !!req.isCustom,
            requestStream: false,
            requestMethod: "POST",
            requestEntry: "callAI",
            requestPhase: "initial_fetch"
        });
    }
    const data = await parseProviderJsonResponse(res, req, false);
    if (req.provider.type === "google") {
        const text = extractGeminiText(data);
        return {
            text,
            headers: res.headers,
            responseMeta: buildProviderResponseMeta(data, req, text)
        };
    }
    if (isClaudeRequest(req)) {
        const text = Array.isArray(data.content)
            ? data.content.map((item) => item?.text || "").join("\n").trim()
            : "";
        return {
            text,
            headers: res.headers,
            usage: data.usage,
            responseMeta: buildProviderResponseMeta(data, req, text)
        };
    }
    const text = extractOpenAIMessageText(data);
    return {
        text,
        headers: res.headers,
        usage: data.usage,
        responseMeta: buildProviderResponseMeta(data, req, text)
    };
}

export async function callAIStream(providerKey, config, messages, signal, onDelta, callbacks = {}) {
    const resolvedProviderKey = providerKey || config?.provider;
    if (resolvedProviderKey === "mimo"
        && isMimoTokenPlanKey(config?.apiKey)
        && normalizeMimoTokenPlanRegionMode(config?.mimoTokenPlanRegionMode) === "auto"
        && config?.mimoTokenPlanRegionProbe !== true) {
        const regions = getMimoTokenPlanRegionCandidates(
            config.apiKey,
            config.mimoTokenPlanRegion,
            config.mimoTokenPlanRegionMode
        );
        let lastError = null;
        for (let index = 0; index < regions.length; index += 1) {
            const region = regions[index];
            try {
                const result = await callAIStream(providerKey, {
                    ...config,
                    mimoTokenPlanRegion: region,
                    mimoTokenPlanRegionMode: "manual",
                    mimoTokenPlanRegionProbe: true
                }, messages, signal, onDelta, callbacks);
                await Promise.resolve(callbacks?.onMimoTokenPlanRegionResolved?.(region)).catch(() => {});
                return result;
            } catch (error) {
                lastError = error;
                const hasNext = index < regions.length - 1;
                if (!hasNext || !shouldTryNextMimoTokenPlanRegion(error?.status, error?.message)) throw error;
                getProviderLogger()?.warn("mimo_token_plan_region_retry", {
                    task: "ai",
                    provider: "mimo",
                    model: config?.model || "",
                    status: Number(error?.status || 0) || undefined,
                    detail: { failed_region: region, next_region: regions[index + 1] }
                });
            }
        }
        throw lastError;
    }
    const req = resolveProviderRequest(providerKey, config, messages, true);
    const requestBody = req.body || {};
    if (typeof callbacks?.onRequestMetadata === "function") {
        callbacks.onRequestMetadata(buildProviderRequestMetadata(config, requestBody, messages, true, req.requestPolicy));
    }
    getProviderLogger()?.debug("provider_request_body_built", {
        task: "ai",
        provider: providerKey,
        model: requestBody.model || "",
        detail: {
            message_count: Array.isArray(requestBody.messages) ? requestBody.messages.length : 0,
            max_tokens: Number(requestBody.max_tokens || 0),
            stream: !!requestBody.stream,
            request_task: String(config?.requestTask || ""),
            thinking_disabled: requestBody.thinking?.type === "disabled" || requestBody.enable_thinking === false,
            reasoning_effort: String(requestBody.reasoning_effort || requestBody.reasoning?.effort || requestBody.output_config?.effort || requestBody.generationConfig?.thinkingConfig?.thinkingLevel || "")
        }
    });
    let res;
    try {
        res = await fetch(req.finalUrl, {
            method: "POST",
            headers: req.headers,
            body: JSON.stringify(req.body),
            signal
        });
    } catch (error) {
        if (error?.code) throw error;
        throw createAppError("PROVIDER_NETWORK_ERROR", "模型服务连接失败，请稍后重试", {
            cause: error,
            provider: providerKey,
            model: req.model || "",
            requestEndpoint: req.finalUrl,
            requestHost: safeUrlHost(req.finalUrl),
            requestProtocol: req.protocol,
            isCustomProvider: !!req.isCustom,
            requestStream: true,
            requestMethod: "POST",
            requestEntry: "callAIStream",
            requestPhase: "initial_fetch"
        });
    }
    if (typeof callbacks?.onResponseHeaders === "function") callbacks.onResponseHeaders();
    if (!res.ok) {
        const errText = await res.text();
        if (req.isCustom && (getResponseContentType(res).includes("text/html") || looksLikeHtmlResponse(errText))) {
            throw createInvalidProviderResponseError(req, res, errText, true);
        }
        throw createHttpError(res.status, `API Error ${res.status}: ${errText}`, {
            responseHeaders: res.headers,
            provider: providerKey,
            model: req.model || "",
            requestEndpoint: req.finalUrl,
            requestHost: safeUrlHost(req.finalUrl),
            requestProtocol: req.protocol,
            isCustomProvider: !!req.isCustom,
            requestStream: true,
            requestMethod: "POST",
            requestEntry: "callAIStream",
            requestPhase: "initial_fetch"
        });
    }
    if (getResponseContentType(res).includes("text/html")) {
        const rawResponse = typeof res.text === "function" ? await res.text().catch(() => "") : "";
        throw createInvalidProviderResponseError(req, res, rawResponse, true);
    }
    const reader = res.body?.getReader?.();
    if (!reader) {
        const data = await parseProviderJsonResponse(res, req, true);
        let text = extractOpenAIMessageText(data);
        if (req.provider.type === "google") text = extractGeminiText(data);
        if (isClaudeRequest(req)) {
            text = Array.isArray(data.content)
                ? data.content.map((item) => item?.text || "").join("\n").trim()
                : "";
        }
        if (typeof onDelta === "function" && text) onDelta(text);
        return { text, headers: res.headers, usage: data.usage, responseMeta: buildProviderResponseMeta(data, req, text) };
    }
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";
    let usage = null;
    let rawResponse = "";
    let finishReason = "";
    let choiceCount = 0;
    let reasoningChars = 0;
    let firstStreamEventReceived = false;
    const notifyFirstStreamEvent = () => {
        if (firstStreamEventReceived) return;
        firstStreamEventReceived = true;
        if (typeof callbacks?.onFirstStreamEvent === "function") callbacks.onFirstStreamEvent();
    };
    const appendRawResponse = (value) => {
        if (rawResponse.length >= MAX_PROVIDER_RESPONSE_DEBUG_CHARS) return;
        const next = `${rawResponse ? "\n" : ""}${String(value || "")}`;
        rawResponse += next.slice(0, MAX_PROVIDER_RESPONSE_DEBUG_CHARS - rawResponse.length);
    };
    const emitToken = (token) => {
        const text = String(token || "");
        if (!text) return;
        fullText += text;
        if (typeof onDelta === "function") onDelta(text);
    };
    const consumeOpenAISsePart = (part) => {
        for (const dataPart of getSseDataPayloads(part)) {
            if (!dataPart || dataPart === "[DONE]") continue;
            notifyFirstStreamEvent();
            let parsed;
            try {
                parsed = JSON.parse(dataPart);
            } catch (_) {
                continue;
            }
            appendRawResponse(dataPart);
            if (parsed?.usage) usage = parsed.usage;
            choiceCount = Math.max(choiceCount, Array.isArray(parsed?.choices) ? parsed.choices.length : 0);
            finishReason = String(parsed?.choices?.[0]?.finish_reason || finishReason || "");
            const delta = parsed?.choices?.[0]?.delta || parsed?.choices?.[0]?.message || {};
            const content = delta?.content ?? delta?.text ?? "";
            reasoningChars += String(delta?.reasoning_content || delta?.reasoning || "").length;
            if (delta?.reasoning_content && delta?.content == null && delta?.text == null) {
                getProviderLogger()?.debug("provider_stream_reasoning_delta_ignored", {
                    task: "ai",
                    provider: providerKey,
                    model: req.model || "",
                    detail: {
                        reasoning_chars: String(delta.reasoning_content || "").length
                    }
                });
                continue;
            }
            if (delta?.content == null && delta?.text == null) {
                getProviderLogger()?.debug("provider_stream_empty_delta", {
                    task: "ai",
                    provider: providerKey,
                    model: req.model || "",
                    detail: {
                        has_usage: !!parsed?.usage,
                        choice_count: Array.isArray(parsed?.choices) ? parsed.choices.length : 0
                    }
                });
            }
            const token = normalizeTextContent(content);
            emitToken(token);
        }
    };
    const consumeGeminiSsePart = (part) => {
        for (const dataPart of getSseDataPayloads(part)) {
            if (!dataPart || dataPart === "[DONE]") continue;
            notifyFirstStreamEvent();
            let parsed;
            try {
                parsed = JSON.parse(dataPart);
            } catch (_) {
                continue;
            }
            appendRawResponse(dataPart);
            const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
            choiceCount = Math.max(choiceCount, candidates.length);
            finishReason = String(candidates[0]?.finishReason || finishReason || "");
            if (parsed?.usageMetadata) {
                usage = {
                    prompt_tokens: parsed.usageMetadata.promptTokenCount,
                    completion_tokens: parsed.usageMetadata.candidatesTokenCount,
                    total_tokens: parsed.usageMetadata.totalTokenCount
                };
            }
            emitToken(extractGeminiText(parsed));
        }
    };
    const consumeClaudeSsePart = (part) => {
        const event = {};
        String(part || "").split("\n").forEach((line) => {
            const value = String(line || "").trim();
            if (!value) return;
            if (value.startsWith("event:")) event.type = value.slice(6).trim();
            if (value.startsWith("data:")) event.data = `${event.data || ""}${value.slice(5).trim()}`;
        });
        if (!event.data || event.data === "[DONE]") return;
        notifyFirstStreamEvent();
        let parsed;
        try {
            parsed = JSON.parse(event.data);
        } catch (_) {
            return;
        }
        appendRawResponse(event.data);
        finishReason = String(parsed?.stop_reason || parsed?.delta?.stop_reason || finishReason || "");
        if (Array.isArray(parsed?.content)) choiceCount = Math.max(choiceCount, parsed.content.length);
        if (parsed?.type === "message_start" && parsed?.message?.usage) usage = parsed.message.usage;
        if (parsed?.type === "message_delta" && parsed?.usage) usage = { ...(usage || {}), ...parsed.usage };
        const text = parsed?.type === "content_block_delta" && parsed?.delta?.type === "text_delta"
            ? parsed.delta.text
            : "";
        emitToken(text);
    };
    const consumeSsePart = (part) => {
        if (req.provider.type === "google") {
            consumeGeminiSsePart(part);
            return;
        }
        if (isClaudeRequest(req)) {
            consumeClaudeSsePart(part);
            return;
        }
        consumeOpenAISsePart(part);
    };
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (!fullText && looksLikeHtmlResponse(buffer)) {
                throw createInvalidProviderResponseError(req, res, buffer, true);
            }
            const { events, rest } = splitSseEvents(buffer);
            buffer = rest;
            for (const part of events) {
                consumeSsePart(part);
            }
        }
    if (buffer.trim()) consumeSsePart(buffer);
    return {
        text: fullText,
        headers: res.headers,
        usage,
        responseMeta: {
            rawResponse,
            contentState: fullText.trim() ? "text" : (rawResponse ? "empty" : "missing"),
            finishReason,
            choiceCount,
            reasoningChars
        }
    };
}

function safeUrlHost(url) {
    try {
        return new URL(String(url || "")).host;
    } catch (_) {
        return "";
    }
}
