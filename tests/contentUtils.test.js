import { describe, expect, it } from "vitest";
import "../content/contentUtils.js";

const utils = globalThis.BilitatoContentUtils;

describe("contentUtils", () => {
  it("extracts and normalizes BVID values", () => {
    expect(utils.getBvidFromUrl("https://www.bilibili.com/video/BV1AbCdEfGh1/?p=2")).toBe("BV1AbCdEfGh1");
    expect(utils.normalizeBvidCase("https://www.bilibili.com/video/BV1AbCdEfGh1/")).toBe("bv1abcdefgh1");
  });

  it("reads page or time parameters from Bilibili URLs", () => {
    expect(utils.getTidFromUrl("https://www.bilibili.com/video/BVxxx?p=3")).toBe("3");
    expect(utils.getTidFromUrl("https://www.bilibili.com/video/BVxxx?t=120")).toBe("120");
  });

  it("formats playback and SRT timestamps", () => {
    expect(utils.formatTime(65)).toBe("01:05");
    expect(utils.formatTime(3661)).toBe("01:01:01");
    expect(utils.toSrtTime(65.432)).toBe("00:01:05,432");
  });

  it("escapes HTML and regex text", () => {
    expect(utils.escapeHtml('<a title="x">Tom & Jerry</a>')).toBe("&lt;a title=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;");
    expect(utils.escapeRegExp("a+b?")).toBe("a\\+b\\?");
  });

  it("formats UTC+8 dates and timeline rows", () => {
    expect(utils.formatUtc8DateTime("2026-05-12T00:00:00.000Z")).toBe("2026-05-12 08:00:00 UTC+8");
    expect(utils.formatTimelineTime(new Date("2026-05-12T01:02:03.004Z").getTime())).toMatch(/\d{2}:\d{2}:\d{2}\.004/);
    expect(utils.serializeTimelineDetail({ stage: "ok", count: 2 })).toBe("stage=ok count=2");
  });

  it("resolves default pages", () => {
    expect(utils.resolveDefaultOpenPage("chat")).toBe("chat");
    expect(utils.resolveDefaultOpenPage("settings")).toBe("CC");
  });

  it("isolates horizontal cursor keys used in the chat input", () => {
    expect(utils.shouldIsolateChatInputKey("ArrowLeft")).toBe(true);
    expect(utils.shouldIsolateChatInputKey("ArrowRight")).toBe(true);
    expect(utils.shouldIsolateChatInputKey("ArrowUp")).toBe(false);
  });
});
