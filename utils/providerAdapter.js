export const PROVIDERS = {
    modelscope: {
        name: "ModelScope (魔搭)",
        baseUrl: "https://api-inference.modelscope.cn/v1/",
        model: "Qwen/Qwen2.5-72B-Instruct",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://modelscope.cn/my/myaccesstoken"
    },
    zhipu: {
        name: "智谱 AI",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
        model: "glm-4-flash",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://open.bigmodel.cn/usercenter/apikeys"
    },
    gemini: {
        name: "Google Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
        model: "gemini-2.0-flash",
        type: "google",
        regUrl: "https://aistudio.google.com/apikey"
    },
    openai: {
        name: "OpenAI / 兼容",
        baseUrl: "https://api.openai.com/v1/",
        model: "gpt-4o-mini",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://platform.openai.com/api-keys"
    },
    deepseek: {
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/",
        model: "deepseek-chat",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://platform.deepseek.com/api_keys"
    },
    kimi: {
        name: "Moonshot (Kimi)",
        baseUrl: "https://api.moonshot.cn/v1/",
        model: "moonshot-v1-8k",
        headerKey: "Authorization",
        tokenPrefix: "Bearer ",
        regUrl: "https://platform.moonshot.cn/console/api-keys"
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

function isQwenModel(model) {
    return /qwen/i.test(String(model || ""));
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

function resolveProviderRequest(providerKey, config, messages, streaming) {
    const provider = PROVIDERS[providerKey] || PROVIDERS[config.provider] || PROVIDERS.modelscope || PROVIDERS.default;
    const isCustom = (providerKey || config.provider) === "custom";
    const protocol = String(config.customProtocol || "openai").toLowerCase() === "claude" ? "claude" : "openai";
    const baseUrl = isCustom
        ? String(config.customBaseUrl || "").trim()
        : (provider.baseUrl || "").trim();
    const model = (config.model && config.model.trim() !== "") ? config.model : provider.model;
    const apiKey = config.apiKey || "";
    if (!baseUrl) throw new Error("自定义 Provider 需要填写 Base URL");
    if (!model) throw new Error("请填写模型名称");

    let finalUrl = baseUrl;
    if (provider.type === "google") {
        if (!finalUrl.includes(':generateContent')) {
             finalUrl = finalUrl.replace(/\/+$/, '') + `/models/${model}:generateContent`;
        }
    } else if (isCustom && protocol === "claude") {
        if (!/\/v1\/messages$/.test(finalUrl)) {
            finalUrl = finalUrl.replace(/\/+$/, "") + "/v1/messages";
        }
    } else {
        if (!finalUrl.includes('/chat/completions')) {
             finalUrl = finalUrl.replace(/\/+$/, '') + '/chat/completions';
        }
    }

    console.log(`[Provider] Calling ${provider.name} at ${finalUrl} (Base: ${baseUrl}) with model ${model}`);

    const headers = {
        "Content-Type": "application/json"
    };

    if (isCustom && protocol === "claude") {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
    } else if (provider.headerKey && provider.type !== "google") {
        headers[provider.headerKey] = (provider.tokenPrefix || "") + apiKey;
    }

    let body = {};
    if (provider.type === "google") {
        body = {
            contents: [{ parts: [{ text: messages[messages.length-1].content }] }]
        };
        const urlObj = new URL(finalUrl);
        urlObj.searchParams.set('key', apiKey);
        return {
            provider,
            isCustom,
            protocol,
            model,
            headers,
            body,
            finalUrl: urlObj.toString()
        };
    } else if (isCustom && protocol === "claude") {
        body = {
            model,
            max_tokens: 4096,
            messages: (messages || []).map((item) => ({
                role: item.role === "assistant" ? "assistant" : "user",
                content: String(item.content || "")
            }))
        };
        return {
            provider,
            isCustom,
            protocol,
            model,
            headers,
            body,
            finalUrl
        };
    } else {
        const qwenModel = isQwenModel(model);
        const jsonMode = shouldUseJsonResponseFormat(messages);
        const normalizedMessages = qwenModel && jsonMode ? appendJsonFormatHint(messages) : messages;
        body = {
            model: model,
            messages: normalizedMessages,
            temperature: 0.3,
            max_tokens: 4096,
            stream: !!streaming
        };
        return {
            provider,
            isCustom,
            protocol,
            model,
            headers,
            body,
            finalUrl
        };
    }
}

export async function callAI(providerKey, config, messages, signal) {
    const req = resolveProviderRequest(providerKey, config, messages, false);
    const requestBody = req.body || {};
    console.log("[DEBUG request body]", JSON.stringify(requestBody));
    const res = await fetch(req.finalUrl, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API Error ${res.status}: ${errText}`);
    }
    const data = await res.json();
    if (req.provider.type === "google") {
        return {
            text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
            headers: res.headers
        };
    }
    if (req.isCustom && req.protocol === "claude") {
        const text = Array.isArray(data.content)
            ? data.content.map((item) => item?.text || "").join("\n").trim()
            : "";
        return {
            text,
            headers: res.headers,
            usage: data.usage
        };
    }
    return {
        text: data.choices?.[0]?.message?.content || "",
        headers: res.headers,
        usage: data.usage
    };
}

export async function callAIStream(providerKey, config, messages, signal, onDelta) {
    const req = resolveProviderRequest(providerKey, config, messages, true);
    const requestBody = req.body || {};
    console.log("[DEBUG request body]", JSON.stringify(requestBody));
    if (req.provider.type === "google" || (req.isCustom && req.protocol === "claude")) {
        const once = await callAI(providerKey, config, messages, signal);
        if (typeof onDelta === "function" && once.text) onDelta(once.text);
        return once;
    }
    const res = await fetch(req.finalUrl, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API Error ${res.status}: ${errText}`);
    }
    const reader = res.body?.getReader?.();
    if (!reader) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        if (typeof onDelta === "function" && text) onDelta(text);
        return { text, headers: res.headers, usage: data.usage };
    }
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";
    let usage = null;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
            const lines = String(part || "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("data:"));
            for (const line of lines) {
                const dataPart = line.slice(5).trim();
                if (!dataPart || dataPart === "[DONE]") continue;
                let parsed;
                try {
                    parsed = JSON.parse(dataPart);
                } catch (_) {
                    continue;
                }
                if (parsed?.usage) usage = parsed.usage;
                const delta = parsed?.choices?.[0]?.delta || parsed?.choices?.[0]?.message || {};
                const content = delta?.content || delta?.reasoning_content || delta?.text || "";
                if (!delta?.content && !delta?.reasoning_content && !delta?.text) {
                    console.error("[DEBUG SSE chunk]", JSON.stringify(parsed).slice(0, 300));
                }
                const token = Array.isArray(content) ? content.map((item) => item?.text || "").join("") : String(content || "");
                if (!token) continue;
                fullText += String(token);
                if (typeof onDelta === "function") onDelta(String(token));
            }
        }
    }
    return {
        text: fullText,
        headers: res.headers,
        usage
    };
}
