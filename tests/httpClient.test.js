import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "../utils/httpClient.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("httpClient", () => {
  it("parses json responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await requestJson("https://example.com/api");

    expect(result.data).toEqual({ ok: true });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("throws normalized http errors", async () => {
    globalThis.fetch = vi.fn(async () => new Response("missing", { status: 404 }));

    await expect(requestJson("https://example.com/api", { requestName: "test_request" }))
      .rejects
      .toMatchObject({ code: "HTTP_404", status: 404, requestName: "test_request" });
  });

  it("throws json parse errors", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{bad", { status: 200 }));

    await expect(requestJson("https://example.com/api"))
      .rejects
      .toMatchObject({ code: "JSON_PARSE_ERROR" });
  });

  it("marks feedback network failures with a dedicated code", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(requestJson("https://example.com/api", { requestName: "feedback_select" }))
      .rejects
      .toMatchObject({ code: "FEEDBACK_SERVICE_UNAVAILABLE", requestName: "feedback_select" });
  });

  it("marks aborted requests as network request timeout", async () => {
    globalThis.fetch = vi.fn(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });

    await expect(requestJson("https://example.com/api", { requestName: "supabase_select:feedback", timeoutMs: 1 }))
      .rejects
      .toMatchObject({ code: "NETWORK_REQUEST_TIMEOUT", requestName: "supabase_select:feedback" });
  });
});
