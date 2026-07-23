import { describe, expect, it } from "vitest";
import {
  MIMO_ASR_CHUNK_SECONDS,
  MIMO_ASR_MODEL,
  MIMO_ASR_TRANSCRIBE_URL,
  buildMimoAsrRequestBody,
  extractMimoAsrText
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
});
