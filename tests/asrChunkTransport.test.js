import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const offscreenSource = readFileSync(new URL("../offscreen.js", import.meta.url), "utf8");

describe("ASR chunk audio transport", () => {
  it("uses the downloaded blob without fetching the same URL again", () => {
    const groqChunking = backgroundSource.slice(
      backgroundSource.indexOf("static async requestGroqChunkedTranscription"),
      backgroundSource.indexOf("static async requestSiliconFlowChunkedTranscription")
    );
    const siliconFlowChunking = backgroundSource.slice(
      backgroundSource.indexOf("static async requestSiliconFlowChunkedTranscription"),
      backgroundSource.indexOf("static async requestSiliconFlowTranscription")
    );
    expect(groqChunking).toContain("audioBlob,");
    expect(groqChunking).toContain("audioUrl:");
    expect(siliconFlowChunking).toContain("audioBlob,");
    expect(siliconFlowChunking).toContain("audioUrl:");
    const prepareSource = backgroundSource.slice(
      backgroundSource.indexOf("async function requestOffscreenAudioChunkingPrepare(payload"),
      backgroundSource.indexOf("async function requestOffscreenAudioChunkingPrepareFromBlob(payload")
    );
    expect(prepareSource.indexOf("payload?.audioBlob instanceof Blob")).toBeLessThan(
      prepareSource.indexOf("if (audioUrl)")
    );
  });

  it("streams the blob into the offscreen document in bounded messages", () => {
    expect(backgroundSource).toContain('action: "OFFSCREEN_CHUNK_AUDIO_UPLOAD_START"');
    expect(backgroundSource).toContain('action: "OFFSCREEN_CHUNK_AUDIO_UPLOAD_APPEND"');
    expect(backgroundSource).toContain('action: "OFFSCREEN_CHUNK_AUDIO_UPLOAD_FINISH"');
    expect(offscreenSource).toContain('action === "OFFSCREEN_CHUNK_AUDIO_UPLOAD_APPEND"');
  });

  it("waits for the offscreen receiver and shows a friendly load failure", () => {
    expect(offscreenSource).toContain('action === "OFFSCREEN_PING"');
    expect(offscreenSource).toContain('chrome.runtime.sendMessage({ action: "OFFSCREEN_READY" })');
    expect(backgroundSource).toContain('msg?.action === "OFFSCREEN_READY"');
    expect(backgroundSource).toContain("await waitForOffscreenReady()");
    expect(backgroundSource).toContain('"音频处理组件加载失败，请刷新页面后重试"');
  });
});
