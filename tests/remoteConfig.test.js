import { describe, expect, it } from "vitest";
import {
  buildEffectiveProviderCatalog,
  isRemoteConfigCacheFresh,
  isRemoteFeatureEnabled,
  normalizeRemoteConfigRow,
} from "../utils/remoteConfig.js";

describe("remote configuration", () => {
  it("defaults to a bounded multi-model fallback chain", () => {
    const fallback = normalizeRemoteConfigRow({ payload: {} }).modelFallback;
    expect(fallback.maxAttempts).toBe(4);
    expect(fallback.tasks.summary).toEqual([
      "Qwen/Qwen3.8-Flash-Next",
      "Qwen/Qwen3.5-27B",
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "deepseek-ai/DeepSeek-V4-Pro",
    ]);
    expect(normalizeRemoteConfigRow({
      payload: { model_fallback: { max_attempts: 99 } },
    }).modelFallback.maxAttempts).toBe(6);
  });

  it("normalizes public feature and model configuration", () => {
    const config = normalizeRemoteConfigRow({
      config_key: "production",
      revision: 7,
      updated_at: "2026-08-02T00:00:00Z",
      payload: {
        feature_flags: { summary_empty_retry: false, modelscope_model_fallback: false },
        model_fallback: {
          enabled: true,
          max_attempts: 5,
          tasks: { segments: ["model-segments", "model-segments"] },
        },
        providers: {
          openai: {
            base_url: "https://proxy.example.com/v1/",
            default_model: "gpt-test",
            models: ["gpt-test", "gpt-test", "gpt-small"],
          },
          unsafe: { base_url: "http://example.com/v1", models: ["bad"] },
        },
      },
    });

    expect(config.revision).toBe(7);
    expect(config.featureFlags.summary_empty_retry).toBe(false);
    expect(config.featureFlags.segments_compact_retry).toBe(true);
    expect(config.featureFlags.segments_ai_json_repair).toBe(true);
    expect(config.featureFlags.modelscope_model_fallback).toBe(false);
    expect(config.modelFallback).toMatchObject({
      enabled: true,
      maxAttempts: 5,
      tasks: { segments: ["model-segments"] },
    });
    expect(config.providers.openai).toMatchObject({
      baseUrl: "https://proxy.example.com/v1",
      model: "gpt-test",
      models: ["gpt-test", "gpt-small"],
    });
    expect(config.providers.unsafe.baseUrl).toBe("");
  });

  it("accepts only valid versioned request policies", () => {
    const config = normalizeRemoteConfigRow({
      payload: {
        request_policies: {
          schema_version: 1,
          rules: [
            {
              id: "modelscope-qwen-summary",
              provider: "modelscope",
              model_pattern: "^Qwen/Qwen3\\.",
              tasks: ["summary", "segments", "unknown"],
              reasoning: { mode: "disabled", transport: "enable_thinking" },
            },
            {
              id: "invalid-regex",
              provider: "modelscope",
              model_pattern: "[",
              tasks: ["summary"],
              reasoning: { mode: "disabled", transport: "enable_thinking" },
            },
          ],
        },
      },
    });

    expect(config.requestPolicies).toEqual({
      schemaVersion: 1,
      enabled: true,
      rules: [{
        id: "modelscope-qwen-summary",
        provider: "modelscope",
        modelPattern: "^Qwen/Qwen3\\.",
        tasks: ["summary", "segments"],
        mode: "disabled",
        transport: "enable_thinking",
      }],
    });
    expect(normalizeRemoteConfigRow({ payload: { request_policies: { schema_version: 2, rules: [{}] } } }).requestPolicies)
      .toEqual({ schemaVersion: 2, enabled: false, rules: [] });
  });

  it("updates the catalog without discarding an existing disabled selection", () => {
    const staticProviders = {
      openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1/", model: "old" },
      deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/", model: "old" },
      custom: { name: "自定义", baseUrl: "" },
    };
    const remoteConfig = normalizeRemoteConfigRow({
      revision: 2,
      payload: {
        providers: {
          openai: { enabled: false, models: ["new"] },
          deepseek: { enabled: true, default_model: "new", models: ["new"] },
        },
      },
    });

    expect(buildEffectiveProviderCatalog(staticProviders, remoteConfig)).not.toHaveProperty("openai");
    expect(buildEffectiveProviderCatalog(staticProviders, remoteConfig, "openai").openai.disabled).toBe(true);
    expect(buildEffectiveProviderCatalog(staticProviders, remoteConfig).deepseek.models).toEqual(["new"]);
  });

  it("falls back safely when a feature flag is absent", () => {
    expect(isRemoteFeatureEnabled({}, "unknown", false)).toBe(false);
    expect(isRemoteFeatureEnabled({ featureFlags: { enabled: true } }, "enabled", false)).toBe(true);
  });

  it("refreshes remote configuration only after the three-day cache expires", () => {
    const now = Date.UTC(2026, 7, 4, 0, 0, 0);
    expect(isRemoteConfigCacheFresh(now - 71 * 60 * 60 * 1000, now)).toBe(true);
    expect(isRemoteConfigCacheFresh(now - 72 * 60 * 60 * 1000, now)).toBe(false);
    expect(isRemoteConfigCacheFresh(0, now)).toBe(false);
    expect(isRemoteConfigCacheFresh(now + 1, now)).toBe(false);
  });

  it("can normalize its cached camelCase representation again", () => {
    const first = normalizeRemoteConfigRow({
      config_key: "production",
      revision: 9,
      payload: {
        request_policies: {
          schema_version: 1,
          rules: [{
            id: "cached",
            provider: "openai",
            model_pattern: "^gpt-6",
            tasks: ["chat"],
            reasoning: { mode: "low", transport: "reasoning_effort" },
          }],
        },
      },
    });
    expect(normalizeRemoteConfigRow(first).requestPolicies).toEqual(first.requestPolicies);
  });
});
