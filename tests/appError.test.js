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
    expect(inferErrorCode(new Error("API Error 429: rate limit"))).toBe("HTTP_429");
    expect(inferErrorCode(createAppError("TIMEOUT", "任务超时"))).toBe("TIMEOUT");
  });
});
