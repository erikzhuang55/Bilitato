import { afterEach, describe, expect, it, vi } from "vitest";
import { callAI, callAIStream, getModelCapability, resolveProviderScopedModel } from "../utils/providerAdapter.js";

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

  it("prefers the model saved for the active provider", () => {
    const result = resolveProviderScopedModel("gemini", {
      provider: "gemini",
      model: "Qwen/Qwen3-30B-A3B-Instruct-2507",
      providerModels: {
        modelscope: "Qwen/Qwen3-30B-A3B-Instruct-2507",
        gemini: "gemini-2.5-flash"
      }
    });

    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.providerModels.gemini).toBe("gemini-2.5-flash");
  });

  it("repairs a known ModelScope model left under Gemini", () => {
    const result = resolveProviderScopedModel("gemini", {
      provider: "gemini",
      model: "Qwen/Qwen3-30B-A3B-Instruct-2507",
      providerModels: {
        modelscope: "Qwen/Qwen3-30B-A3B-Instruct-2507"
      }
    });

    expect(result.model).toBe("gemini-3.8-flash");
    expect(result.providerModels.gemini).toBe("gemini-3.8-flash");
    expect(result.repaired).toBe(true);
  });

  it("repairs a foreign model again at the request boundary", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      candidates: [{ content: { parts: [{ text: "已修复" }] }, finishReason: "STOP" }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("gemini", {
      provider: "gemini",
      apiKey: "gemini-key",
      model: "Qwen/Qwen3-30B-A3B-Instruct-2507",
      providerModels: { modelscope: "Qwen/Qwen3-30B-A3B-Instruct-2507" }
    }, [{ role: "user", content: "test" }]);

    expect(fetchMock.mock.calls[0][0]).toContain("/models/gemini-3.8-flash:generateContent");
  });

  it("preserves an unknown custom model for a built-in provider", () => {
    const result = resolveProviderScopedModel("gemini", {
      provider: "gemini",
      model: "gemini-experimental-user-model"
    });

    expect(result.model).toBe("gemini-experimental-user-model");
    expect(result.repaired).toBe(false);
  });

  it("never rewrites a custom provider model", () => {
    const result = resolveProviderScopedModel("custom", {
      provider: "custom",
      model: "Qwen/Qwen3-30B-A3B-Instruct-2507"
    });

    expect(result.model).toBe("Qwen/Qwen3-30B-A3B-Instruct-2507");
    expect(result.repaired).toBe(false);
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
    expect(result.responseMeta).toMatchObject({
      contentState: "text",
      choiceCount: 1,
      reasoningChars: 0
    });
    expect(JSON.parse(result.responseMeta.rawResponse)).toMatchObject({
      choices: [{ message: { content: "总结完成" } }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
      max_completion_tokens: 4096,
      temperature: 0.3,
      stream: false
    });
  });

  it("reports when a non-streaming response starts", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" } }]
    }));
    const onResponseStart = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await callAI("modelscope", {
      provider: "modelscope",
      apiKey: "ms-test",
      model: "Qwen/Qwen3.5-35B-A3B"
    }, [{ role: "user", content: "生成分段" }], undefined, { onResponseStart });

    expect(onResponseStart).toHaveBeenCalledTimes(1);
  });

  it("uses a remotely supplied provider catalog for requests", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "remote" } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("remote-provider", {
      provider: "remote-provider",
      apiKey: "remote-key",
      model: "remote-model",
      providerCatalog: {
        "remote-provider": {
          name: "Remote Provider",
          baseUrl: "https://remote.example.com/v1",
          model: "remote-model",
          headerKey: "Authorization",
          tokenPrefix: "Bearer "
        }
      }
    }, [{ role: "user", content: "hello" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://remote.example.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer remote-key");
  });

  it("allows a one-off higher output token limit", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完整分段" }, finish_reason: "stop" }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test",
      maxOutputTokens: 8192
    }, [{ role: "user", content: "生成分段" }]);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).max_completion_tokens).toBe(8192);
  });

  it("disables thinking only for an explicitly retried DeepSeek V4 request", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" }, finish_reason: "stop" }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const baseConfig = {
      provider: "modelscope",
      apiKey: "ms-test",
      model: "deepseek-ai/DeepSeek-V4-Pro"
    };
    await callAI("modelscope", baseConfig, [{ role: "user", content: "生成分段" }]);
    await callAI("modelscope", {
      ...baseConfig,
      deepSeekV4ThinkingDisabled: true
    }, [{ role: "user", content: "生成分段" }]);
    await callAI("modelscope", {
      ...baseConfig,
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      deepSeekV4ThinkingDisabled: true
    }, [{ role: "user", content: "生成分段" }]);
    await callAI("modelscope", {
      ...baseConfig,
      model: "Qwen/Qwen3-30B-A3B-Instruct-2507",
      deepSeekV4ThinkingDisabled: true
    }, [{ role: "user", content: "生成分段" }]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).thinking).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).thinking).toEqual({ type: "disabled" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).thinking).toEqual({ type: "disabled" });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).thinking).toBeUndefined();
  });

  it("keeps the raw provider response when OpenAI-compatible content is empty", async () => {
    const responseBody = {
      id: "chatcmpl-empty",
      choices: [{
        message: { content: null, reasoning_content: "只返回了推理过程" },
        finish_reason: "length"
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    };
    vi.stubGlobal("fetch", vi.fn(async () => mockJsonResponse(responseBody)));

    const result = await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test"
    }, [{ role: "user", content: "生成分段" }]);

    expect(result.text).toBe("");
    expect(result.responseMeta).toMatchObject({
      contentState: "null",
      finishReason: "length",
      choiceCount: 1,
      reasoningChars: 8
    });
    expect(JSON.parse(result.responseMeta.rawResponse)).toEqual(responseBody);
  });

  it("retries provider network failures for non-stream requests and then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockJsonResponse({
        choices: [{ message: { content: "第三次成功" } }],
        usage: { total_tokens: 12 }
      }));
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, delay, ...args) => {
      fn(...args);
      return 0;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test"
    }, [{ role: "user", content: "hello" }]);

    expect(result.text).toBe("第三次成功");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 700);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1600);
  });

  it("keeps retry metadata on final provider network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, delay, ...args) => {
      fn(...args);
      return 0;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test"
    }, [{ role: "user", content: "hello" }])).rejects.toMatchObject({
      code: "PROVIDER_NETWORK_ERROR",
      requestEntry: "callAI",
      requestPhase: "initial_fetch",
      requestAttempt: 3,
      requestMaxAttempts: 3,
      retryStrategy: "provider_network_backoff",
      retryDelaysMs: [700, 1600]
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("builds OpenRouter OpenAI-compatible requests", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "OpenRouter 返回" } }],
      usage: { total_tokens: 18 }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("openrouter", {
      provider: "openrouter",
      apiKey: "or-key",
      model: "openrouter/auto"
    }, [{ role: "user", content: "hello" }]);

    expect(result.text).toBe("OpenRouter 返回");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer or-key");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "openrouter/auto",
      messages: [{ role: "user", content: "hello" }],
      stream: false
    });
    expect(JSON.parse(init.body).reasoning).toBeUndefined();
    expect(JSON.parse(init.body).temperature).toBeUndefined();
  });

  it("uses reasoning effort instead of temperature for current OpenAI models", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-6.1-sol"
    }, [{ role: "user", content: "hello" }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("medium");
    expect(body.temperature).toBeUndefined();
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
  });

  it("applies a matching remote request policy and logs its source", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" } }]
    }));
    const metadata = [];
    vi.stubGlobal("fetch", fetchMock);

    await callAI("modelscope", {
      provider: "modelscope",
      apiKey: "ms-key",
      model: "Qwen/Qwen3.8-Flash-Next",
      requestTask: "summary",
      remoteConfig: {
        requestPolicies: {
          schemaVersion: 1,
          enabled: true,
          rules: [{
            id: "qwen-summary-off",
            provider: "modelscope",
            modelPattern: "^Qwen/Qwen3\\.",
            tasks: ["summary"],
            mode: "disabled",
            transport: "enable_thinking"
          }]
        }
      }
    }, [{ role: "user", content: "总结" }], undefined, {
      onRequestMetadata: (value) => metadata.push(value)
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).enable_thinking).toBe(false);
    expect(metadata[0]).toMatchObject({
      reasoning_policy_source: "remote",
      reasoning_policy_rule_id: "qwen-summary-off",
      thinking_disabled: true
    });
  });

  it("uses the explicit chat reasoning effort without changing structured task defaults", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-6.1-sol",
      requestTask: "chat",
      reasoningEffort: "high"
    }, [{ role: "user", content: "聊天" }]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe("high");
  });

  it("maintains explicit parameter modes for representative model families", () => {
    expect(getModelCapability("openai", "gpt-5.6").parameterMode).toBe("openai_reasoning");
    expect(getModelCapability("openai", "gpt-4o").parameterMode).toBe("temperature");
    expect(getModelCapability("deepseek", "deepseek-flash")).toMatchObject({
      parameterMode: "openai_reasoning",
      defaultEffort: "high"
    });
    expect(getModelCapability("kimi", "kimi-k3")).toMatchObject({
      parameterMode: "openai_reasoning",
      defaultEffort: "low"
    });
    expect(getModelCapability("kimi", "kimi-k2.6").parameterMode).toBe("provider_default");
    expect(getModelCapability("modelscope", "Qwen/Qwen3.8-Flash-Next")).toMatchObject({
      parameterMode: "provider_default",
      thinkingControl: "enable_thinking"
    });
    expect(getModelCapability("modelscope", "deepseek-ai/DeepSeek-V4.1-Flash").thinkingControl).toBe("thinking_type");
    expect(getModelCapability("mimo", "mimo-v2.6-pro").thinkingControl).toBe("");
    expect(getModelCapability("openrouter", "openrouter/auto").parameterMode).toBe("provider_default");
    expect(getModelCapability("claude", "claude-sonnet-5-5").parameterMode).toBe("claude_effort");
  });

  it("sets Gemini thinking level without a sampling temperature", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      candidates: [{ content: { parts: [{ text: "完成" }] } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("gemini", {
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-3.8-flash"
    }, [{ role: "user", content: "hello" }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: "medium" }
    });
    expect(body.generationConfig.temperature).toBeUndefined();
  });

  it("uses low reasoning effort for Kimi K3", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("kimi", {
      provider: "kimi",
      apiKey: "kimi-key",
      model: "kimi-k3"
    }, [{ role: "user", content: "hello" }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("low");
    expect(body.temperature).toBeUndefined();
  });

  it("reduces reasoning only for summary and segment tasks when the model supports it", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("modelscope", {
      provider: "modelscope",
      apiKey: "ms-key",
      model: "Qwen/Qwen3.8-Flash-Next",
      requestTask: "summary"
    }, [{ role: "user", content: "总结" }]);
    await callAI("deepseek", {
      provider: "deepseek",
      apiKey: "ds-key",
      model: "deepseek-v4-pro",
      requestTask: "segments"
    }, [{ role: "user", content: "分段" }]);
    await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-6.1-sol",
      requestTask: "summary"
    }, [{ role: "user", content: "总结" }]);
    await callAI("mimo", {
      provider: "mimo",
      apiKey: "mimo-key",
      model: "mimo-v2.6-pro",
      requestTask: "summary"
    }, [{ role: "user", content: "总结" }]);
    await callAI("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-6.1-sol",
      requestTask: "chat"
    }, [{ role: "user", content: "聊天" }]);

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0].enable_thinking).toBe(false);
    expect(bodies[0].reasoning_effort).toBeUndefined();
    expect(bodies[1].thinking).toEqual({ type: "disabled" });
    expect(bodies[1].reasoning_effort).toBeUndefined();
    expect(bodies[2].reasoning_effort).toBe("none");
    expect(bodies[3].thinking).toEqual({ type: "disabled" });
    expect(bodies[3].reasoning_effort).toBeUndefined();
    expect(bodies[4].reasoning_effort).toBe("medium");
  });

  it("reports safe request metadata without exposing request text", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "完成" } }]
    }));
    const onRequestMetadata = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await callAI("modelscope", {
      provider: "modelscope",
      apiKey: "ms-key",
      model: "Qwen/Qwen3.8-Flash-Next",
      requestTask: "summary",
      maxOutputTokens: 2048
    }, [{ role: "user", content: "这是不能写入日志的总结原文" }], undefined, { onRequestMetadata });

    expect(onRequestMetadata).toHaveBeenCalledTimes(1);
    const metadata = onRequestMetadata.mock.calls[0][0];
    expect(metadata).toMatchObject({
      request_task: "summary",
      stream_requested: false,
      turn_count: 1,
      input_chars: 13,
      output_limit: 2048,
      reasoning_policy: "thinking_disabled",
      thinking_disabled: true,
      reasoning_effort: ""
    });
    expect(metadata.parameter_names).toContain("enable_thinking");
    expect(JSON.stringify(metadata)).not.toContain("不能写入日志");
  });

  it("builds Gemini generateContent requests with API key in the URL", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      candidates: [{ content: { parts: [{ text: "Gemini " }, { text: "返回" }] } }]
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
      contents: [{ parts: [{ text: "字幕内容" }] }],
      generationConfig: { maxOutputTokens: 4096 }
    });
  });

  it("builds custom OpenAI-compatible requests", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "自定义 OpenAI 返回" } }],
      usage: { total_tokens: 16 }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("custom", {
      provider: "custom",
      customProtocol: "openai",
      customBaseUrl: "https://api.example.com/v1",
      apiKey: "custom-key",
      model: "custom-model"
    }, [{ role: "user", content: "hello" }]);

    expect(result.text).toBe("自定义 OpenAI 返回");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer custom-key");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "custom-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false
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

  it("builds built-in Claude provider requests", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      content: [{ text: "内置 Claude 返回" }],
      usage: { input_tokens: 5, output_tokens: 6 }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("claude", {
      provider: "claude",
      apiKey: "anthropic-key",
      model: "claude-sonnet-4-6"
    }, [{ role: "user", content: "总结" }]);

    expect(result.text).toBe("内置 Claude 返回");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("anthropic-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: "总结" }]
    });
  });

  it("builds Xiaomi MiMo OpenAI-compatible requests with api-key auth", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "MiMo 返回" } }],
      usage: { total_tokens: 11 }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("mimo", {
      provider: "mimo",
      apiKey: "mimo-key",
      model: "mimo-v2.6-pro"
    }, [{ role: "user", content: "总结" }]);

    expect(result.text).toBe("MiMo 返回");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(init.headers["api-key"]).toBe("mimo-key");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({
      model: "mimo-v2.6-pro",
      messages: [{ role: "user", content: "总结" }],
      stream: false
    });
    expect(JSON.parse(init.body).temperature).toBeUndefined();
  });

  it("routes Xiaomi MiMo Token Plan keys to the selected regional endpoint", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      choices: [{ message: { content: "Token Plan 返回" } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callAI("mimo", {
      provider: "mimo",
      apiKey: "tp-test",
      model: "mimo-v2.6-pro",
      mimoTokenPlanRegion: "sgp"
    }, [{ role: "user", content: "总结" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://token-plan-sgp.xiaomimimo.com/v1/chat/completions");
    expect(init.headers["api-key"]).toBe("tp-test");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("auto-detects and remembers the working Xiaomi MiMo Token Plan region", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ error: "unauthorized" }, false, 401))
      .mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: "新加坡可用" } }] }));
    const onRegionResolved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI("mimo", {
      provider: "mimo",
      apiKey: "tp-test",
      model: "mimo-v2.6-pro",
      mimoTokenPlanRegion: "cn",
      mimoTokenPlanRegionMode: "auto"
    }, [{ role: "user", content: "总结" }], undefined, {
      onMimoTokenPlanRegionResolved: onRegionResolved
    });

    expect(result.text).toBe("新加坡可用");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://token-plan-cn.xiaomimimo.com/v1/chat/completions",
      "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions"
    ]);
    expect(onRegionResolved).toHaveBeenCalledWith("sgp");
  });

  it("respects manual Xiaomi MiMo Token Plan region selection", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ error: "unauthorized" }, false, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAI("mimo", {
      provider: "mimo",
      apiKey: "tp-test",
      model: "mimo-v2.6-pro",
      mimoTokenPlanRegion: "ams",
      mimoTokenPlanRegionMode: "manual"
    }, [{ role: "user", content: "总结" }])).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://token-plan-ams.xiaomimimo.com/v1/chat/completions");
  });

  it("auto-detects Token Plan region before streaming content", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ error: "forbidden" }, false, 403))
      .mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: "流式回退成功" } }] }));
    const onDelta = vi.fn();
    const onRegionResolved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAIStream("mimo", {
      provider: "mimo",
      apiKey: "ttp-test",
      model: "mimo-v2.6-pro",
      mimoTokenPlanRegion: "cn",
      mimoTokenPlanRegionMode: "auto"
    }, [{ role: "user", content: "聊天" }], undefined, onDelta, {
      onMimoTokenPlanRegionResolved: onRegionResolved
    });

    expect(result.text).toBe("流式回退成功");
    expect(onDelta).toHaveBeenCalledWith("流式回退成功");
    expect(onRegionResolved).toHaveBeenCalledWith("sgp");
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

  it("streams Gemini generateContent chunks", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"第一"}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"第二"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}\n\n'));
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

    const result = await callAIStream("gemini", {
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-test"
    }, [{ role: "user", content: "hello" }], undefined, onDelta);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?key=gemini-key&alt=sse");
    expect(JSON.parse(init.body)).toEqual({
      contents: [{ parts: [{ text: "hello" }] }],
      generationConfig: { maxOutputTokens: 4096 }
    });
    expect(result.text).toBe("第一第二");
    expect(result.usage).toEqual({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
    expect(onDelta).toHaveBeenNthCalledWith(1, "第一");
    expect(onDelta).toHaveBeenNthCalledWith(2, "第二");
  });

  it("streams Gemini chunks separated with CRLF", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"CRLF"}]}}]}\r\n\r\n'));
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":" 流式"}]}}]}\r\n\r\n'));
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

    const result = await callAIStream("gemini", {
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-test"
    }, [{ role: "user", content: "hello" }], undefined, onDelta);

    expect(result.text).toBe("CRLF 流式");
    expect(onDelta).toHaveBeenNthCalledWith(1, "CRLF");
    expect(onDelta).toHaveBeenNthCalledWith(2, " 流式");
  });

  it("parses Gemini SSE events with multiline data payloads", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[\n'));
        controller.enqueue(encoder.encode('data: {"text":"多行"}]}}]}\r\n\r\n'));
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

    const result = await callAIStream("gemini", {
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-test"
    }, [{ role: "user", content: "hello" }], undefined, onDelta);

    expect(result.text).toBe("多行");
    expect(onDelta).toHaveBeenCalledWith("多行");
  });

  it("streams built-in Claude text deltas", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4,"output_tokens":0}}}\n\n'));
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude "}}\n\n'));
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"流式"}}\n\n'));
        controller.enqueue(encoder.encode('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":6}}\n\n'));
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

    const result = await callAIStream("claude", {
      provider: "claude",
      apiKey: "anthropic-key",
      model: "claude-sonnet-4-6"
    }, [{ role: "user", content: "hello" }], undefined, onDelta);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("anthropic-key");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "claude-sonnet-4-6",
      stream: true,
      messages: [{ role: "user", content: "hello" }]
    });
    expect(result.text).toBe("Claude 流式");
    expect(result.usage).toEqual({ input_tokens: 4, output_tokens: 6 });
    expect(onDelta).toHaveBeenNthCalledWith(1, "Claude ");
    expect(onDelta).toHaveBeenNthCalledWith(2, "流式");
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
    const callbacks = {
      onResponseHeaders: vi.fn(),
      onFirstStreamEvent: vi.fn()
    };
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAIStream("openai", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-test"
    }, [{ role: "user", content: "hello" }], undefined, onDelta, callbacks);

    expect(result.text).toBe("正式总结");
    expect(callbacks.onResponseHeaders).toHaveBeenCalledTimes(1);
    expect(callbacks.onFirstStreamEvent).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith("正式总结");
    expect(result.responseMeta.reasoningChars).toBe(6);
    expect(result.responseMeta.rawResponse).toContain("让我分析一下");
    expect(result.responseMeta.contentState).toBe("text");
  });

  it("parses the final OpenAI-compatible stream event without trailing blank line", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"最后一段"}}]}'));
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

    expect(result.text).toBe("最后一段");
    expect(onDelta).toHaveBeenCalledWith("最后一段");
  });

  it("parses newline-only custom OpenAI-compatible stream events", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode([
          'data: {"choices":[{"delta":{"content":"Mistral "}}]}',
          'data: {"choices":[{"delta":{"content":"返回"}}]}',
          "data: [DONE]"
        ].join("\n")));
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

    const result = await callAIStream("custom", {
      provider: "custom",
      customProtocol: "openai",
      customBaseUrl: "https://api.mistral.ai/v1",
      apiKey: "mistral-key",
      model: "mistral-small-latest"
    }, [{ role: "user", content: "hello" }], undefined, onDelta);

    expect(result.text).toBe("Mistral 返回");
    expect(onDelta).toHaveBeenNthCalledWith(1, "Mistral ");
    expect(onDelta).toHaveBeenNthCalledWith(2, "返回");
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

  it("maps a custom provider HTML response to an actionable error", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => "<!doctype html><html><body>Proxy landing page</body></html>"
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAI("custom", {
      provider: "custom",
      customProtocol: "openai",
      customBaseUrl: "https://proxy.example.com",
      apiKey: "custom-key",
      model: "custom-model"
    }, [{ role: "user", content: "hello" }])).rejects.toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE",
      responseKind: "html",
      responseContentType: "text/html; charset=utf-8",
      isCustomProvider: true,
      requestEntry: "callAI"
    });
  });

  it("maps a custom provider HTTP error page to the same actionable error", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html><body>Not Found</body></html>"
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAI("custom", {
      provider: "custom",
      customProtocol: "openai",
      customBaseUrl: "https://proxy.example.com/wrong-path",
      apiKey: "custom-key",
      model: "custom-model"
    }, [{ role: "user", content: "hello" }])).rejects.toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE",
      status: 404,
      responseKind: "html"
    });
  });
});
