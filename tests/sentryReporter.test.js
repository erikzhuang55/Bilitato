import { describe, expect, it, vi } from "vitest";
import {
  createSentryEvent,
  parseSentryDsn,
  reportToSentry,
  sanitizeForSentry,
  shouldReportToSentry
} from "../utils/sentryReporter.js";

describe("sentryReporter", () => {
  it("parses sentry dsn into envelope endpoint", () => {
    const parsed = parseSentryDsn("https://public123@example.ingest.sentry.io/456");

    expect(parsed.endpoint).toBe("https://example.ingest.sentry.io/api/456/envelope/?sentry_key=public123&sentry_version=7");
  });

  it("filters sensitive fields before sending", () => {
    const sanitized = sanitizeForSentry({
      apiKey: "sk-secret",
      groqApiKey: "gsk-secret",
      prompt: "完整 Prompt",
      subtitle: "完整字幕",
      customBaseUrl: "https://api.example.com/v1",
      bvid: "BV1"
    });

    expect(sanitized).toMatchObject({
      apiKey: "[Filtered]",
      groqApiKey: "[Filtered]",
      prompt: "[Filtered]",
      subtitle: "[Filtered]",
      customBaseUrl: "[Filtered]",
      bvid: "BV1"
    });
  });

  it("keeps useful runtime environment fields", () => {
    const event = createSentryEvent(new Error("boom"), {
      task: "summary",
      provider: "deepseek",
      bvid: "BV1",
      code: "HTTP_401",
      status: 401,
      pageType: "video"
    }, {
      extensionVersion: "1.0.0",
      manifestVersion: 3,
      language: "zh-CN",
      userAgent: "Chrome Test",
      platform: { os: "win", arch: "x86-64" }
    });

    expect(event.release).toBe("bilitato@1.0.0");
    expect(event.tags).toMatchObject({
      task: "summary",
      provider: "deepseek",
      bvid: "BV1",
      code: "HTTP_401",
      status: 401,
      page_type: "video",
      extension_version: "1.0.0"
    });
    expect(event.extra).toMatchObject({
      code: "HTTP_401",
      status: 401
    });
    expect(event.contexts.runtime.userAgent).toBe("Chrome Test");
    expect(event.contexts.platform.os).toBe("win");
  });

  it("promotes error code and retry metadata from error objects", () => {
    const error = new Error("Groq 限流，请稍后重试");
    error.code = "ASR_RATE_LIMIT";
    error.status = 429;
    error.retryAfterSec = 9;

    const event = createSentryEvent(error, { task: "asr" }, {});

    expect(event.tags).toMatchObject({
      code: "ASR_RATE_LIMIT",
      status: 429,
      task: "asr"
    });
    expect(event.extra.retryAfterSec).toBe(9);
  });

  it("does not send when disabled or dsn is invalid", async () => {
    const fetchImpl = vi.fn();

    expect(await reportToSentry({ sentryEnabled: false, sentryDsn: "" }, new Error("boom"), {}, {}, fetchImpl)).toMatchObject({
      sent: false,
      reason: "disabled"
    });
    expect(await reportToSentry({ sentryEnabled: true, sentryDsn: "bad" }, new Error("boom"), {}, {}, fetchImpl)).toMatchObject({
      sent: false,
      reason: "invalid_dsn"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores user configuration and validation errors", async () => {
    const fetchImpl = vi.fn();

    expect(shouldReportToSentry(new Error("请先配置 API Key"))).toBe(false);
    expect(shouldReportToSentry(new Error("当前视频暂无字幕，无法生成总结"))).toBe(false);
    expect(shouldReportToSentry({ message: "用户取消授权", code: "USER_CANCELLED" })).toBe(false);
    expect(shouldReportToSentry(new Error("Cannot read properties of undefined"))).toBe(true);

    const result = await reportToSentry(
      { sentryEnabled: true, sentryDsn: "https://public123@example.ingest.sentry.io/456" },
      new Error("请先配置 API Key"),
      {},
      {},
      fetchImpl
    );

    expect(result).toMatchObject({ sent: false, reason: "ignored" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends sentry envelope when enabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await reportToSentry(
      { sentryEnabled: true, sentryDsn: "https://public123@example.ingest.sentry.io/456" },
      new Error("provider failed with sk-1234567890 https://secret.example/path"),
      { task: "chat", apiKey: "sk-secret" },
      { extensionVersion: "1.0.0" },
      fetchImpl
    );

    expect(result.sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.body).toContain("chat");
    expect(options.body).toContain("[Filtered]");
    expect(options.body).not.toContain("sk-secret");
    expect(options.body).not.toContain("secret.example");
  });
});
