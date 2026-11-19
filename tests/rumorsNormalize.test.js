import { describe, expect, it } from "vitest";
import { isValidRumorsResult, normalizeRumors } from "../utils/resultNormalize.js";

describe("normalizeRumors", () => {
  it("normalizes rumor overview and claims", () => {
    const result = normalizeRumors({
      overall_score: "78",
      overview: "整体可信",
      claims: [
        {
          text: "某个说法",
          verdict: "real",
          confidence: "0.8",
          analysis: "理由",
          timestamp: "12"
        }
      ]
    });

    expect(result).toEqual({
      overall_score: 78,
      overview: "整体可信",
      claims: [
        {
          claim: "某个说法",
          verdict: "real",
          confidence: 0.8,
          analysis: "理由",
          timestamp_sec: 12
        }
      ]
    });
  });

  it("uses safe defaults when fields are missing or malformed", () => {
    const result = normalizeRumors({
      overall_score: "不是数字",
      claims: [{ claim: "缺少判断" }]
    });

    expect(result).toEqual({
      overall_score: 0,
      overview: "",
      claims: [
        {
          claim: "缺少判断",
          verdict: "unknown",
          confidence: null,
          analysis: "",
          timestamp_sec: 0
        }
      ]
    });
  });

  it("parses cached JSON string values", () => {
    const result = normalizeRumors(JSON.stringify({
      overall_score: 61,
      overview: "需要核查",
      claims: [{ claim: "一个说法", verdict: "uncertain" }]
    }));

    expect(result).toMatchObject({
      overall_score: 61,
      overview: "需要核查",
      claims: [{ claim: "一个说法", verdict: "uncertain" }]
    });
  });

  it("returns null for non-object inputs", () => {
    expect(normalizeRumors(null)).toBeNull();
    expect(normalizeRumors("nope")).toBeNull();
  });

  it("accepts a complete no-claim result and rejects empty or malformed schemas", () => {
    expect(isValidRumorsResult({
      overall_score: 100,
      overview: "未发现值得核查的重要声明",
      claims: []
    })).toBe(true);
    expect(isValidRumorsResult({})).toBe(false);
    expect(isValidRumorsResult({ overall_score: 100, overview: "", claims: [] })).toBe(false);
    expect(isValidRumorsResult({
      overall_score: 60,
      overview: "需要核查",
      claims: [{ text: "说法", verdict: true, confidence: 101, analysis: "", timestamp_sec: 0 }]
    })).toBe(false);
  });

  it("accepts claims without an optional confidence value", () => {
    const response = {
      overall_score: 8,
      overview: "需要核查",
      claims: [{ text: "某个说法", verdict: false, analysis: "理由", timestamp_sec: 24 }]
    };
    expect(isValidRumorsResult(response)).toBe(true);
    expect(normalizeRumors(response).claims[0].confidence).toBeNull();
    expect(normalizeRumors(response).claims[0].verdict).toBe("false");
  });
});
