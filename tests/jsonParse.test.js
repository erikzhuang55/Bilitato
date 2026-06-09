import { describe, expect, it } from "vitest";
import { robustJSONParse } from "../utils/jsonParse.js";

describe("robustJSONParse", () => {
  it("parses plain JSON objects", () => {
    expect(robustJSONParse('{"summary":"ok","count":2}')).toEqual({
      summary: "ok",
      count: 2
    });
  });

  it("extracts JSON from markdown code fences", () => {
    const input = '```json\n[{"start":0,"end":10,"label":"开场"}]\n```';

    expect(robustJSONParse(input)).toEqual([
      { start: 0, end: 10, label: "开场" }
    ]);
  });

  it("repairs trailing commas", () => {
    expect(robustJSONParse('{"a":1, "b":[2,],}')).toEqual({
      a: 1,
      b: [2]
    });
  });

  it("repairs invalid bare tokens in segment numeric fields", () => {
    expect(robustJSONParse('[{"start":0,"end":III,"start_line":0,"end_line":38,"label":"开场","type":"content"}]')).toEqual([
      {
        start: 0,
        end: null,
        start_line: 0,
        end_line: 38,
        label: "开场",
        type: "content"
      }
    ]);
  });

  it("returns null when no JSON exists", () => {
    expect(robustJSONParse("这不是 JSON")).toBeNull();
  });
});
