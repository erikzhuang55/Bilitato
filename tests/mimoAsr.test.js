import { describe, expect, it } from "vitest";
import {
  MIMO_ASR_CHUNK_SECONDS,
  MIMO_ASR_MODEL,
  MIMO_ASR_TRANSCRIBE_URL,
  buildMimoAsrAuthHeaders,
  buildMimoAsrRequestBody,
  extractMimoAsrText,
  getMimoTokenPlanRegionCandidates,
  isMimoTokenPlanKey,
  normalizeMimoTokenPlanRegion,
  resolveMimoChatCompletionsUrl,
  shouldTryNextMimoTokenPlanRegion
} from "../utils/mimoAsr.js";

describe("Xiaomi MiMo ASR", () => {
  it("builds the official chat audio request shape", () => {
    const body = buildMimoAsrRequestBody("data:audio/mp4;base64,AAAA");

    expect(MIMO_ASR_TRANSCRIBE_URL).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(MIMO_ASR_CHUNK_SECONDS).toBe(600);
    expect(body.model).toBe(MIMO_ASR_MODEL);
    expect(body.messages[0].content[0]).toEqual({
      type: "input_audio",
      input_audio: { data: "data:audio/mp4;base64,AAAA" }
    });
    expect(body.asr_options).toEqual({ language: "auto" });
  });

  it("extracts transcription text from the response", () => {
    expect(extractMimoAsrText({
      choices: [{ message: { content: " 你好，世界。 " } }]
    })).toBe("你好，世界。");
  });

  it("routes tp and ttp keys to the selected Token Plan region", () => {
    expect(isMimoTokenPlanKey("tp-example")).toBe(true);
    expect(isMimoTokenPlanKey("ttp-example")).toBe(true);
    expect(isMimoTokenPlanKey("sk-example")).toBe(false);
    expect(normalizeMimoTokenPlanRegion("unknown")).toBe("cn");
    expect(resolveMimoChatCompletionsUrl("tp-example", "sgp"))
      .toBe("https://token-plan-sgp.xiaomimimo.com/v1/chat/completions");
    expect(resolveMimoChatCompletionsUrl("ttp-example", "ams"))
      .toBe("https://token-plan-ams.xiaomimimo.com/v1/chat/completions");
  });

  it("keeps standard ASR auth while using api-key for Token Plan", () => {
    expect(buildMimoAsrAuthHeaders("sk-example")).toEqual({ Authorization: "Bearer sk-example" });
    expect(buildMimoAsrAuthHeaders("tp-example")).toEqual({ "api-key": "tp-example" });
  });

  it("defaults auto detection to China and prioritizes the remembered region", () => {
    expect(getMimoTokenPlanRegionCandidates("tp-example", "cn", "auto")).toEqual(["cn", "sgp", "ams"]);
    expect(getMimoTokenPlanRegionCandidates("tp-example", "sgp", "auto")).toEqual(["sgp", "cn", "ams"]);
    expect(getMimoTokenPlanRegionCandidates("tp-example", "ams", "manual")).toEqual(["ams"]);
  });

  it("only switches regions for authentication or explicit region mismatch errors", () => {
    expect(shouldTryNextMimoTokenPlanRegion(401, "unauthorized")).toBe(true);
    expect(shouldTryNextMimoTokenPlanRegion(403, "forbidden")).toBe(true);
    expect(shouldTryNextMimoTokenPlanRegion(400, "Token Plan region mismatch")).toBe(true);
    expect(shouldTryNextMimoTokenPlanRegion(400, "invalid request body")).toBe(false);
    expect(shouldTryNextMimoTokenPlanRegion(429, "rate limited")).toBe(false);
  });
});
