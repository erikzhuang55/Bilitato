import { describe, expect, it } from "vitest";
import { normalizeSegments, parseTimeToSeconds } from "../utils/resultNormalize.js";

describe("normalizeSegments", () => {
  it("keeps valid segment fields and sorts by start time", () => {
    const result = normalizeSegments([
      { start: 20, end: 30, label: "第二段", type: "ad" },
      { start: 0, end: 10, label: "第一段", type: "content" }
    ]);

    expect(result).toEqual([
      { start: 0, end: 10, label: "第一段", type: "content" },
      { start: 20, end: 30, label: "第二段", type: "ad" }
    ]);
  });

  it("accepts common AI field name variants", () => {
    const result = normalizeSegments([
      { start_time: "01:05", end_time: "01:30", title: "字段别名" },
      { beginAt: "00:02:00", finishAt: "00:03:00", chapterTitle: "模糊字段" }
    ]);

    expect(result).toEqual([
      { start: 65, end: 90, label: "字段别名", type: "content" },
      { start: 120, end: 180, label: "模糊字段", type: "content" }
    ]);
  });

  it("drops invalid segments", () => {
    const result = normalizeSegments([
      { start: 10, end: 5, label: "结束早于开始" },
      { start: 0, end: 10, label: "" },
      { start: 1, end: 2, label: "有效段落" }
    ]);

    expect(result).toEqual([
      { start: 1, end: 2, label: "有效段落", type: "content" }
    ]);
  });

  it("keeps ad subtitle line ids for local boundary mapping", () => {
    const result = normalizeSegments([
      { start: 100, end: 160, label: "品牌推广", type: "ad", start_line: 12, end_line: 18, ad_start_line: 12, ad_end_line: 18 }
    ]);

    expect(result).toEqual([
      { start: 100, end: 160, label: "品牌推广", type: "ad", start_line: 12, end_line: 18, ad_start_line: 12, ad_end_line: 18 }
    ]);
  });

  it("keeps content subtitle line ids for local boundary mapping", () => {
    const result = normalizeSegments([
      { start: 5, end: 20, label: "正文段落", type: "content", start_line: 2, end_line: 8 }
    ]);

    expect(result).toEqual([
      { start: 5, end: 20, label: "正文段落", type: "content", start_line: 2, end_line: 8 }
    ]);
  });
});

describe("parseTimeToSeconds", () => {
  it("converts numeric, mm:ss, and hh:mm:ss values", () => {
    expect(parseTimeToSeconds(42)).toBe(42);
    expect(parseTimeToSeconds("02:03")).toBe(123);
    expect(parseTimeToSeconds("01:02:03")).toBe(3723);
  });
});
