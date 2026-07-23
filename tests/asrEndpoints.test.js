import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROQ_BASE_URL,
  buildAsrEndpoint,
  ensureHttpsUrlPrefix,
  normalizeAsrBaseUrl
} from "../utils/asrEndpoints.js";

describe("ASR endpoints", () => {
  it("uses the official Groq base URL by default", () => {
    expect(normalizeAsrBaseUrl("", DEFAULT_GROQ_BASE_URL)).toBe(DEFAULT_GROQ_BASE_URL);
    expect(buildAsrEndpoint("", "models", DEFAULT_GROQ_BASE_URL))
      .toBe("https://api.groq.com/openai/v1/models");
  });

  it("routes Groq requests through a configured HTTPS base URL", () => {
    const baseUrl = normalizeAsrBaseUrl("https://groq.example.workers.dev/openai/v1/", DEFAULT_GROQ_BASE_URL);
    expect(baseUrl).toBe("https://groq.example.workers.dev/openai/v1");
    expect(buildAsrEndpoint(baseUrl, "/audio/transcriptions", DEFAULT_GROQ_BASE_URL))
      .toBe("https://groq.example.workers.dev/openai/v1/audio/transcriptions");
  });

  it("adds https:// when the user enters a host without a protocol", () => {
    expect(ensureHttpsUrlPrefix("api.example.com/v1")).toBe("https://api.example.com/v1");
    expect(normalizeAsrBaseUrl("api.example.com/v1/", "")).toBe("https://api.example.com/v1");
  });

  it("rejects unsafe or endpoint-level values", () => {
    expect(() => normalizeAsrBaseUrl("http://proxy.example.com/v1", DEFAULT_GROQ_BASE_URL)).toThrow("https://");
    expect(() => normalizeAsrBaseUrl("https://proxy.example.com/v1?token=x", DEFAULT_GROQ_BASE_URL)).toThrow("参数");
    expect(() => normalizeAsrBaseUrl("https://proxy.example.com/v1/audio/transcriptions", DEFAULT_GROQ_BASE_URL)).toThrow("基础地址");
  });
});
