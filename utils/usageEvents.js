import { isSupabaseEnabled, supabaseRpc, supabaseWrite } from "./supabaseClient.js";

export const DEFAULT_USAGE_EVENTS_TABLE = "usage_events";
export const DAILY_ACTIVITY_EVENTS = Object.freeze(new Set(["extension_started", "feature_viewed"]));
export const DEFAULT_USAGE_ACTIVITY_RPC = "record_usage_activity_daily";

function cleanText(value, maxLength = 500) {
    return String(value || "").trim().slice(0, maxLength);
}

function cleanEventName(value) {
    return cleanText(value, 80)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function cleanNonNegativeInt(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.round(num);
}

function cleanMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value).slice(0, 40).map(([key, item]) => {
        const cleanKey = cleanText(key, 80);
        if (!cleanKey) return null;
        if (item === null || item === undefined) return [cleanKey, ""];
        if (typeof item === "number" || typeof item === "boolean") return [cleanKey, item];
        if (typeof item === "string") return [cleanKey, cleanText(item, 500)];
        return [cleanKey, cleanText(JSON.stringify(item), 1000)];
    }).filter(Boolean);
    return Object.fromEntries(entries);
}

export function normalizeUsageEventPayload(payload = {}) {
    const userHash = cleanText(payload.userHash, 128);
    const sessionId = cleanText(payload.sessionId, 128);
    const eventName = cleanEventName(payload.eventName);
    if (!userHash || !sessionId || !eventName) return null;
    return {
        user_hash: userHash,
        session_id: sessionId,
        extension_version: cleanText(payload.extensionVersion, 40),
        event_name: eventName,
        feature_name: cleanText(payload.featureName, 80),
        status: cleanText(payload.status, 40),
        error_code: cleanText(payload.errorCode, 80),
        provider: cleanText(payload.provider, 80),
        model: cleanText(payload.model, 160),
        bvid: cleanText(payload.bvid, 40),
        title: cleanText(payload.title, 300),
        duration_ms: cleanNonNegativeInt(payload.durationMs),
        token_count: cleanNonNegativeInt(payload.tokenCount),
        metadata: cleanMetadata(payload.metadata)
    };
}

export async function reportUsageEvent(settings, payload = {}) {
    if (!isSupabaseEnabled(settings)) return { sent: false, reason: "disabled" };
    const row = normalizeUsageEventPayload(payload);
    if (!row) return { sent: false, reason: "invalid_payload" };
    if (DAILY_ACTIVITY_EVENTS.has(row.event_name)) {
        try {
            await supabaseRpc(settings, settings?.supabaseUsageActivityRpcName || DEFAULT_USAGE_ACTIVITY_RPC, {
                p_user_hash: row.user_hash,
                p_extension_version: row.extension_version,
                p_event_name: row.event_name,
                p_feature_name: row.feature_name,
                p_status: row.status
            }, {
                requestName: "usage_activity_daily_report",
                errorMessage: "Supabase daily activity RPC 失败"
            });
            return { sent: true, aggregated: true };
        } catch (_) {
            // Older or temporarily unavailable backends still receive the raw event.
        }
    }
    const tableName = cleanText(settings?.supabaseUsageEventsTable, 80) || DEFAULT_USAGE_EVENTS_TABLE;
    await supabaseWrite(settings, tableName, row, {
        requestName: "usage_event_report",
        errorMessage: "Supabase usage event 写入失败"
    });
    return { sent: true };
}
