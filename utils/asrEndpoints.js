export const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";

export function normalizeAsrBaseUrl(value, fallback) {
    const raw = String(value || "").trim() || String(fallback || "").trim();
    let url;
    try {
        url = new URL(raw);
    } catch (_) {
        throw new Error("Base URL 格式不正确");
    }
    if (url.protocol !== "https:") throw new Error("Base URL 必须使用 https://");
    if (url.username || url.password || url.search || url.hash) {
        throw new Error("Base URL 不能包含账号、参数或锚点");
    }
    const pathname = url.pathname.replace(/\/+$/, "");
    if (/\/(?:models|audio\/transcriptions)$/i.test(pathname)) {
        throw new Error("Base URL 只填写基础地址，不要包含具体接口路径");
    }
    return `${url.origin}${pathname}`;
}

export function buildAsrEndpoint(baseUrl, route, fallback) {
    return `${normalizeAsrBaseUrl(baseUrl, fallback)}/${String(route || "").replace(/^\/+/, "")}`;
}
