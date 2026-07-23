import { describe, expect, it } from "vitest";
import { getAsrAudioCandidateUrls } from "../utils/asrAudioCandidates.js";

describe("ASR audio candidates", () => {
  it("keeps the primary URL first and deduplicates backup CDN URLs", () => {
    expect(getAsrAudioCandidateUrls({
      url: "https://primary.example/audio.m4s",
      urls: [
        "https://primary.example/audio.m4s",
        "https://backup-a.example/audio.m4s",
        "https://backup-b.example/audio.m4s"
      ]
    })).toEqual([
      "https://primary.example/audio.m4s",
      "https://backup-a.example/audio.m4s",
      "https://backup-b.example/audio.m4s"
    ]);
  });

  it("drops empty, invalid, and duplicate candidates", () => {
    expect(getAsrAudioCandidateUrls({
      url: "",
      urls: ["javascript:alert(1)", "https://backup.example/audio.m4s", "https://backup.example/audio.m4s"]
    })).toEqual(["https://backup.example/audio.m4s"]);
  });
});
