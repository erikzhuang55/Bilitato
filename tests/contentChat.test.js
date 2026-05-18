import { describe, expect, it } from "vitest";
import "../content/contentUtils.js";
import "../content/contentRichText.js";
import "../content/contentChat.js";

const chat = globalThis.BilitatoContentChat;

describe("contentChat", () => {
  it("formats runtime metrics", () => {
    expect(chat.formatMetricText({
      latencyMs: 1234,
      tokens: 30,
      inputTokens: 10,
      outputTokens: 20,
      modelScopeRemaining: 5
    })).toBe("用时 1.2s · Tokens 30 (In 10 / Out 20) · 该模型当天剩余次数 5");
  });

  it("renders user chat items with escaped content", () => {
    const html = chat.renderChatHistoryItem({
      role: "user",
      content: "<hello>"
    });

    expect(html).toBe('<div class="chat-item user">&lt;hello&gt;</div>');
  });

  it("renders assistant bubbles with copy button and metrics", () => {
    const html = chat.renderAssistantBubble("回答", {
      latencyMs: 1000,
      tokens: 7
    });

    expect(html).toContain('class="chat-item assistant"');
    expect(html).toContain('data-action="chat-copy"');
    expect(html).toContain("用时 1.0s");
  });

  it("can hide metrics while tasks are running", () => {
    const html = chat.renderAssistantBubble("回答", {
      latencyMs: 1000,
      tokens: 7
    }, { hideMetrics: true });

    expect(html).not.toContain("chat-item-meta");
  });

  it("renders empty assistant fallback", () => {
    expect(chat.renderAssistantBubble("", null)).toContain("(无内容)");
  });
});
