import { describe, expect, it, vi } from "vitest";
import "../content/contentAi.js";

const ai = globalThis.BilitatoContentAi;

describe("contentAi", () => {
  it("builds stable progress ids for task groups", () => {
    expect(ai.buildTasksProgressTaskId(["segments", "summary"])).toBe("tasks:segments,summary");
    expect(ai.buildTasksProgressTaskId([])).toBe("tasks:unknown");
  });

  it("requires subtitles for summary and segment tasks", () => {
    expect(ai.canRunTasksWithCache(["summary"], "BV1", { bvid: "BV1", rawSubtitle: [{ text: "字幕" }] })).toBe(true);
    expect(ai.canRunTasksWithCache(["summary"], "BV1", { bvid: "BV1", rawSubtitle: [] })).toBe(false);
    expect(ai.canRunTasksWithCache(["rumors"], "BV1", null)).toBe(false);
    expect(ai.canRunTasksWithCache(["rumors"], "BV1", { bvid: "BV1", processedSubtitle: [{ text: "字幕" }] })).toBe(true);
  });

  it("creates pending chat messages", () => {
    const messages = ai.createPendingChatMessages("这段讲了什么？", "m1", 123);

    expect(messages).toEqual([
      { id: "u_m1", role: "user", content: "这段讲了什么？", status: "done", createdAt: 123 },
      { id: "a_m1", role: "assistant", content: "", metrics: null, status: "loading", messageId: "m1", createdAt: 123 }
    ]);
  });

  it("creates chat message ids", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    expect(ai.createChatMessageId(1000)).toBe("1000_4fzzzx");
    Math.random.mockRestore();
  });
});
