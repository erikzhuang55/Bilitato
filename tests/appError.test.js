import { describe, expect, it } from "vitest";
import {
  createAppError,
  createHttpError,
  inferErrorCode,
  normalizeHttpErrorCode,
  serializeAppError
} from "../utils/appError.js";

describe("appError", () => {
  it("normalizes common http status codes", () => {
    expect(normalizeHttpErrorCode(401)).toBe("HTTP_401");
    expect(normalizeHttpErrorCode(503)).toBe("HTTP_5XX");
  });

  it("creates and serializes app errors", () => {
    const error = createHttpError(404, "not found", { provider: "custom" });

    expect(error.code).toBe("HTTP_404");
    expect(error.status).toBe(404);
    expect(serializeAppError(error)).toMatchObject({
      message: "not found",
      code: "HTTP_404",
      status: 404
    });
  });

  it("infers error codes from messages", () => {
    expect(inferErrorCode(new Error("API Error 429: rate limit"))).toBe("HTTP_429_RATE_LIMIT");
    expect(inferErrorCode(new Error('API Error 429: {"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}'))).toBe("HTTP_429_INSUFFICIENT_QUOTA");
    expect(inferErrorCode(new Error('API Error 429: {"error":{"code":"queue_exceeded","message":"queue_exceeded"}}'))).toBe("HTTP_429_QUEUE_EXCEEDED");
    expect(inferErrorCode(new Error('API Error 402: {"error":{"message":"Insufficient Balance"}}'))).toBe("HTTP_402_INSUFFICIENT_BALANCE");
    expect(inferErrorCode(new Error('API Error 400: {"error":{"message":"Invalid API key"}}'))).toBe("HTTP_401");
    expect(inferErrorCode(createAppError("TIMEOUT", "任务超时"))).toBe("TIMEOUT");
    expect(inferErrorCode(new Error("User location is not supported for the API use."))).toBe("API_LOCATION_UNSUPPORTED");
    expect(inferErrorCode(new Error('API Error 400: {"error":{"message":"User location is not supported for the API use."}}'))).toBe("API_LOCATION_UNSUPPORTED");
    expect(inferErrorCode(new Error('API Error 403: {"error":{"message":"To use API-Inference, please make sure your associated Aliyun account is real-name verified."}}'))).toBe("ALIYUN_REALNAME_REQUIRED");
    expect(inferErrorCode(new Error('API Error 400: {"error":{"message":"Invalid model id: GLM-5.1"}}'))).toBe("INVALID_MODEL_ID");
    expect(inferErrorCode(new Error("Groq 转录失败（403）：Illegal operation"))).toBe("ASR_FORBIDDEN");
    expect(inferErrorCode(new Error("Groq 服务器拒绝了当前网络请求（Forbidden），请检查代理或设备是否能正常访问国际互联网后重试。"))).toBe("ASR_GROQ_ACCESS_BLOCKED");
    expect(inferErrorCode(new Error("无法连接 Groq 服务器，请检查设备是否能正常访问国际互联网。"))).toBe("ASR_GROQ_UNREACHABLE");
    expect(inferErrorCode(new Error("验真 JSON 解析失败"))).toBe("RUMORS_JSON_PARSE_FAILED");
    expect(inferErrorCode(new Error("总结生成为空"))).toBe("SUMMARY_EMPTY_RESPONSE");
    expect(inferErrorCode(new Error("分段 JSON 解析失败"))).toBe("SEGMENTS_JSON_PARSE_FAILED");
    expect(inferErrorCode({ code: "HTTP_403", message: 'API Error 403: {"error":{"message":"To use API-Inference, please make sure your associated Aliyun account is real-name verified."}}' })).toBe("ALIYUN_REALNAME_REQUIRED");
    expect(inferErrorCode({ code: "HTTP_400", message: 'API Error 400: {"error":{"message":"Invalid model id: GLM-5.1"}}' })).toBe("INVALID_MODEL_ID");
    expect(inferErrorCode({ code: "NETWORK_ERROR", message: "provider network error: failed to fetch" })).toBe("PROVIDER_NETWORK_ERROR");
    expect(inferErrorCode({ code: "JSON_PARSE_ERROR", message: "验真 JSON 解析失败" })).toBe("RUMORS_JSON_PARSE_FAILED");
    expect(inferErrorCode({ code: "TIMEOUT", message: "模型请求超时，请重试" })).toBe("AI_RESPONSE_TIMEOUT");
    expect(inferErrorCode({ code: "TIMEOUT", message: "模型长时间没有开始返回内容，请重试" })).toBe("AI_STREAM_TIMEOUT");
    expect(inferErrorCode(new Error("转录请求超时，请稍后重试"))).toBe("ASR_REQUEST_TIMEOUT");
    expect(inferErrorCode(new Error("网络请求超时，请稍后重试"))).toBe("NETWORK_REQUEST_TIMEOUT");
  });
});
