import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/httpClient.js", () => ({
    requestNoContent: vi.fn(async () => undefined),
    requestJson: vi.fn()
}));

import { requestNoContent } from "../utils/httpClient.js";
import { normalizeUsageEventPayload, reportUsageEvent } from "../utils/usageEvents.js";

describe("usageEvents", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requestNoContent.mockResolvedValue(undefined);
    });

    it("normalizes payload for Supabase insert", () => {
        const row = normalizeUsageEventPayload({
            userHash: " user_123 ",
            sessionId: " session_123 ",
            extensionVersion: "1.4.0",
            eventName: "Task Started!",
            featureName: "summary",
            status: "success",
            durationMs: "123.4",
            tokenCount: 88,
            metadata: {
                source: "panel",
                nested: { a: 1 }
            }
        });

        expect(row).toMatchObject({
            user_hash: "user_123",
            session_id: "session_123",
            extension_version: "1.4.0",
            event_name: "task_started",
            feature_name: "summary",
            status: "success",
            duration_ms: 123,
            token_count: 88,
            metadata: {
                source: "panel",
                nested: "{\"a\":1}"
            }
        });
    });

    it("rejects payloads without required identifiers", () => {
        expect(normalizeUsageEventPayload({ sessionId: "s", eventName: "started" })).toBeNull();
        expect(normalizeUsageEventPayload({ userHash: "u", eventName: "started" })).toBeNull();
        expect(normalizeUsageEventPayload({ userHash: "u", sessionId: "s" })).toBeNull();
    });

    it("writes to usage_events by default", async () => {
        await reportUsageEvent({
            supabaseUrl: "https://example.supabase.co",
            supabaseAnonKey: "anon"
        }, {
            userHash: "u",
            sessionId: "s",
            eventName: "task_success",
            featureName: "chat"
        });

        expect(requestNoContent).toHaveBeenCalledWith(
            "https://example.supabase.co/rest/v1/usage_events",
            expect.objectContaining({
                method: "POST",
                requestName: "usage_event_report",
                timeoutMs: 2000
            })
        );
    });

    it("aggregates high-volume activity events through the daily RPC", async () => {
        const result = await reportUsageEvent({
            supabaseUrl: "https://example.supabase.co",
            supabaseAnonKey: "anon"
        }, {
            userHash: "u",
            sessionId: "s",
            extensionVersion: "1.6.5",
            eventName: "feature_viewed",
            featureName: "summary",
            status: "content"
        });

        expect(result).toEqual({ sent: true, aggregated: true });
        expect(requestNoContent).toHaveBeenCalledTimes(1);
        expect(requestNoContent).toHaveBeenCalledWith(
            "https://example.supabase.co/rest/v1/rpc/record_usage_activity_daily",
            expect.objectContaining({
                method: "POST",
                requestName: "usage_activity_daily_report",
                body: JSON.stringify({
                    p_user_hash: "u",
                    p_extension_version: "1.6.5",
                    p_event_name: "feature_viewed",
                    p_feature_name: "summary",
                    p_status: "content"
                })
            })
        );
    });

    it("falls back to the raw table when the daily RPC is unavailable", async () => {
        requestNoContent
            .mockRejectedValueOnce(new Error("RPC unavailable"))
            .mockResolvedValueOnce(undefined);

        const result = await reportUsageEvent({
            supabaseUrl: "https://example.supabase.co",
            supabaseAnonKey: "anon"
        }, {
            userHash: "u",
            sessionId: "s",
            eventName: "extension_started",
            featureName: "extension"
        });

        expect(result).toEqual({ sent: true });
        expect(requestNoContent).toHaveBeenNthCalledWith(
            2,
            "https://example.supabase.co/rest/v1/usage_events",
            expect.objectContaining({ requestName: "usage_event_report" })
        );
    });
});
