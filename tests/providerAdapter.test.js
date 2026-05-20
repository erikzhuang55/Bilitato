import { afterEach, describe, expect, it, vi } from "vitest";
import { callAI, callAIStream } from "../utils/providerAdapter.js";

function mockJsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

describe("providerAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds OpenAI-compatible chat completion requests", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "总结完成" } }],
      usage: { total_tokens: 12 }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test"
    }, [{ role: "user", content: "hello" }]);

    expect(result.text).toBe("总结完成");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
      stream: false
    });
  });

  it("builds Gemini generateContent requests with API key in the URL", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      candidates: [{ content: { parts: [{ text: "Gemini 返回" }] } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("gemini", {
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-test"
    }, [{ role: "user", content: "字幕内容" }]);

    expect(result.text).toBe("Gemini 返回");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent?key=gemini-key");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      contents: [{ parts: [{ text: "字幕内容" }] }]
    });
  });

  it("builds custom Claude-compatible requests", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      content: [{ text: "Claude 返回" }],
      usage: { input_tokens: 3, output_tokens: 4 }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("custom", {
      provider: "custom",
      customProtocol: "claude",
      customBaseUrl: "https://example.com",
      apiKey: "claude-key",
      model: "claude-test"
    }, [{ role: "assistant", content: "旧回答" }, { role: "user", content: "新问题" }]);

    expect(result.text).toBe("Claude 返回");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("claude-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "claude-test",
      messages: [
        { role: "assistant", content: "旧回答" },
        { role: "user", content: "新问题" }
      ]
    });
  });

  it("falls back to non-streaming calls for Gemini streaming requests", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      candidates: [{ content: { parts: [{ text: "一次性返回" }] } }]
    }));
    const onDelta = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAIStream("gemini", {
      provider: "gemini",
      apiKey: "key",
      model: "gemini-test"
    }, [{ role: "user", content: "hello" }], undefined, onDelta);

    expect(result.text).toBe("一次性返回");
    expect(onDelta).toHaveBeenCalledWith("一次性返回");
  });

  it("ignores reasoning_content in OpenAI-compatible streams", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"让我分析一下"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"正式总结"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: stream
    }));
    const onDelta = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAIStream("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test"
    }, [{ role: "user", content: "hello" }], undefined, onDelta);

    expect(result.text).toBe("正式总结");
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith("正式总结");
  });

  it("throws coded http errors", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ error: "unauthorized" }, false, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAI("openai", {
      provider: "openai",
      apiKey: "bad-key",
      model: "gpt-test"
    }, [{ role: "user", content: "hello" }])).rejects.toMatchObject({
      code: "HTTP_401",
      status: 401
    });
  });
});
