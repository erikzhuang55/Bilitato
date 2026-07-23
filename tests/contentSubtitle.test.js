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

  it("splits long Groq segments into short timed playback cues", () => {
    const cues = subtitle.buildPlaybackSubtitleCues([
      { start: 10, end: 16, text: "这是第一句话，内容稍微有一点长，需要切开。然后继续展示第二句话。" }
    ], { maxChars: 12 });

    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => cue.text.length <= 13)).toBe(true);
    expect(cues[0].start).toBe(10);
    expect(cues.at(-1).end).toBe(16);
  });

  it("rejects a long single-row fallback without a reliable timeline", () => {
    const cues = subtitle.buildPlaybackSubtitleCues([
      { start: 0, end: 10, text: "这是一整段没有分段时间戳的转录文本。".repeat(8) }
    ]);

    expect(cues).toEqual([]);
  });
});
