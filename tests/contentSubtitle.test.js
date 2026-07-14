import { describe, expect, it } from "vitest";
import "../content/contentUtils.js";
import "../content/contentSubtitle.js";

const subtitle = globalThis.BilitatoContentSubtitle;

describe("contentSubtitle", () => {
  it("reads subtitle rows from rawSubtitle first", () => {
    const cache = {
      rawSubtitle: [{ start: 1, text: "RAW" }],
      rows: [{ start: 2, text: "ROWS" }]
    };

    expect(subtitle.getRawSubtitleRows(cache)).toEqual([{ start: 1, text: "RAW" }]);
  });

  it("falls back to cached rows", () => {
    const cache = {
      rows: [{ start: 2, text: "fallback" }]
    };

    expect(subtitle.getRawSubtitlePlainText(cache)).toBe("fallback");
  });

  it("falls back to processed subtitles when raw subtitles are missing", () => {
    const cache = {
      processedSubtitle: [{ start: 2, text: "processed fallback" }]
    };

    expect(subtitle.getRawSubtitleRows(cache)).toEqual([{ start: 2, text: "processed fallback" }]);
    expect(subtitle.getRawSubtitlePlainText(cache)).toBe("processed fallback");
  });

  it("builds plain text without empty subtitle lines", () => {
    const text = subtitle.getRawSubtitlePlainText({
      rawSubtitle: [
        { start: 1, text: "第一句" },
        { start: 2, text: " " },
        { start: 3, content: "第二句" }
      ]
    });

    expect(text).toBe("第一句\n第二句");
  });

  it("builds timestamped subtitle text", () => {
    const text = subtitle.buildTimestampedSubtitleText({
      rawSubtitle: [
        { start: 1.5, text: "第一句" },
        { from: 3, content: "第二句" }
      ]
    });

    expect(text).toContain("[00:00:01.500] 第一句");
    expect(text).toContain("[00:00:03.000] 第二句");
  });

  it("builds srt content and fills missing end time", () => {
    const srt = subtitle.buildSrtContent({
      rawSubtitle: [
        { start: 1, end: 2, text: "第一句" },
        { from: 5, content: "第二句" }
      ]
    });

    expect(srt).toContain("1\n00:00:01,000 --> 00:00:02,000\n第一句");
    expect(srt).toContain("2\n00:00:05,000 --> 00:00:08,000\n第二句");
  });

  it("tracks official subtitle rows that use from/to timestamps", () => {
    const rows = [
      { from: 0, to: 2, content: "第一句" },
      { from: 2, to: 5, content: "第二句" },
      { from: 5, to: 8, content: "第三句" }
    ];

    expect(subtitle.getActiveSubtitleIndex(rows, 0.5)).toBe(0);
    expect(subtitle.getActiveSubtitleIndex(rows, 3)).toBe(1);
    expect(subtitle.getActiveSubtitleIndex(rows, 6)).toBe(2);
  });

  it("does not jump to the last row when timestamps do not progress", () => {
    const rows = [
      { from: 0, to: 0, content: "第一句" },
      { from: 0, to: 0, content: "第二句" },
      { from: 0, to: 0, content: "第三句" }
    ];

    expect(subtitle.getActiveSubtitleIndex(rows, 1)).toBe(-1);
  });
});
