import { beforeEach, describe, expect, it, vi } from "vitest";
import "../content/contentErrorReporter.js";

const reporter = globalThis.BilitatoContentErrorReporter;

describe("contentErrorReporter", () => {
  beforeEach(() => {
    globalThis.BilitatoAppState = {
      injectBvid: "BV1",
      settings: {
        provider: "deepseek",
        model: "deepseek-chat",
        groqApiKey: "gsk-secret"
      },
      cache: {
        rawSubtitle: [{ text: "字幕" }, { text: "字幕2" }]
      }
    };
  });

  it("builds safe page context", () => {
    const context = reporter.buildPageContext({ task: "summary" });

    expect(context).toMatchObject({
      source: "content",
      pageType: "video",
      bvid: "BV1",
      provider: "deepseek",
      model: "deepseek-chat",
      hasSubtitle: true,
      subtitleCount: 2,
      subtitle_total_chars: 5,
      asrEnabled: true,
      task: "summary"
    });
    expect(context.video_duration_sec).toBeUndefined();
  });

  it("forwards normalized errors to background", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    globalThis.chrome = {
      runtime: { sendMessage }
    };

    await reporter.reportContentError(new Error("boom"), { task: "chat" });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: "REPORT_ERROR",
      error: expect.objectContaining({ message: "boom" }),
      context: expect.objectContaining({ task: "chat", bvid: "BV1" })
    }));
  });

  it("keeps error code metadata when forwarding", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    globalThis.chrome = {
      runtime: { sendMessage }
    };
    const error = new Error("API Error 401");
    error.code = "HTTP_401";
    error.status = 401;

    await reporter.reportContentError(error, { task: "summary" });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: "HTTP_401",
        status: 401
      })
    }));
  });

  it("does not forward user configuration errors", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    globalThis.chrome = {
      runtime: { sendMessage }
    };

    const result = await reporter.reportContentError(new Error("请先配置 API Key"), { task: "summary" });

    expect(result).toMatchObject({ ignored: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(reporter.shouldReportContentError(new Error("Cannot read properties of undefined"))).toBe(true);
  });
});
