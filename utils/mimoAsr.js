export const MIMO_ASR_BASE_URL = "https://api.xiaomimimo.com/v1";
export const MIMO_ASR_TRANSCRIBE_URL = `${MIMO_ASR_BASE_URL}/chat/completions`;
export const MIMO_ASR_MODEL = "mimo-v2.5-asr";
export const MIMO_ASR_CHUNK_SECONDS = 600;
export const MIMO_TOKEN_PLAN_BASE_URLS = Object.freeze({
    cn: "https://token-plan-cn.xiaomimimo.com/v1",
    sgp: "https://token-plan-sgp.xiaomimimo.com/v1",
    ams: "https://token-plan-ams.xiaomimimo.com/v1"
});
export const MIMO_TOKEN_PLAN_REGIONS = Object.freeze(Object.keys(MIMO_TOKEN_PLAN_BASE_URLS));

export function isMimoTokenPlanKey(apiKey) {
    return /^(?:tp|ttp)-/i.test(String(apiKey || "").trim());
}

export function normalizeMimoTokenPlanRegion(region) {
    const normalized = String(region || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(MIMO_TOKEN_PLAN_BASE_URLS, normalized) ? normalized : "cn";
}

export function normalizeMimoTokenPlanRegionMode(mode) {
    return String(mode || "").trim().toLowerCase() === "manual" ? "manual" : "auto";
}

export function getMimoTokenPlanRegionCandidates(apiKey, region = "cn", mode = "auto") {
    const preferred = normalizeMimoTokenPlanRegion(region);
    if (!isMimoTokenPlanKey(apiKey) || normalizeMimoTokenPlanRegionMode(mode) === "manual") {
        return [preferred];
    }
    return [preferred, ...MIMO_TOKEN_PLAN_REGIONS.filter((item) => item !== preferred)];
}

export function shouldTryNextMimoTokenPlanRegion(status, detail = "") {
    const normalizedStatus = Number(status || 0);
    if (normalizedStatus === 401 || normalizedStatus === 403) return true;
    if (normalizedStatus !== 400) return false;
    return /(?:region|区域|token[\s_-]*plan).*(?:mismatch|invalid|incorrect|unsupported|not\s+(?:match|available)|不匹配|无效|不支持|不可用)/i.test(String(detail || ""));
}

export function resolveMimoApiBaseUrl(apiKey, region = "cn") {
    if (!isMimoTokenPlanKey(apiKey)) return MIMO_ASR_BASE_URL;
    return MIMO_TOKEN_PLAN_BASE_URLS[normalizeMimoTokenPlanRegion(region)];
}

export function resolveMimoChatCompletionsUrl(apiKey, region = "cn") {
    return `${resolveMimoApiBaseUrl(apiKey, region)}/chat/completions`;
}

export function buildMimoAsrAuthHeaders(apiKey) {
    const normalizedKey = String(apiKey || "").trim();
    return isMimoTokenPlanKey(normalizedKey)
        ? { "api-key": normalizedKey }
        : { Authorization: `Bearer ${normalizedKey}` };
}

export function buildMimoAsrRequestBody(audioDataUrl, model = MIMO_ASR_MODEL) {
    return {
        model: String(model || MIMO_ASR_MODEL).trim() || MIMO_ASR_MODEL,
        messages: [{
            role: "user",
            content: [{
                type: "input_audio",
                input_audio: {
                    data: String(audioDataUrl || "")
                }
            }]
        }],
        asr_options: {
            language: "auto"
        }
    };
}

export function extractMimoAsrText(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
        .map((item) => typeof item === "string" ? item : String(item?.text || ""))
        .join("")
        .trim();
}

export async function blobToBase64DataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return `data:${blob.type || "audio/mp4"};base64,${btoa(binary)}`;
}
