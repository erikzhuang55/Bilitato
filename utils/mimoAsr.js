export const MIMO_ASR_BASE_URL = "https://api.xiaomimimo.com/v1";
export const MIMO_ASR_TRANSCRIBE_URL = `${MIMO_ASR_BASE_URL}/chat/completions`;
export const MIMO_ASR_MODEL = "mimo-v2.5-asr";
export const MIMO_ASR_CHUNK_SECONDS = 600;

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
