import { describe, expect, it } from "vitest";
import "../content/contentUtils.js";
import "../content/contentDownload.js";

const download = globalThis.BilitatoContentDownload;

describe("contentDownload", () => {
  it("normalizes missing play info lists", () => {
    expect(download.normalizeIncomingPlayInfo({ _bvid: "bv1abc" })).toMatchObject({
      _bvid: "bv1abc",
      video: [],
      audio: []
    });
  });

  it("maps dash audio when normalized audio is missing", () => {
    const result = download.normalizeIncomingPlayInfo({
      _bvid: "bv1abc",
      dash: {
        audio: [
          { id: 30280, baseUrl: "https://audio.example/a.m4s", bandwidth: 128000 },
          { id: 30216, base_url: "", bandwidth: 64000 }
        ]
      }
    });

    expect(result.audio).toEqual([
      {
        id: 30280,
        desc: "Audio 30280",
        url: "https://audio.example/a.m4s",
        urls: ["https://audio.example/a.m4s"],
        bandwidth: 128000
      }
    ]);
  });

  it("checks whether play info belongs to the current BVID", () => {
    expect(download.hasUsablePlayInfoForBvid({
      _bvid: "BV1AbCdEfGh1",
      audio: [{ url: "https://audio.example/a.m4s" }]
    }, "bv1abcdefgh1")).toBe(true);

    expect(download.hasUsablePlayInfoForBvid({
      _bvid: "BVother",
      audio: [{ url: "https://audio.example/a.m4s" }]
    }, "bv1abcdefgh1")).toBe(false);
  });

  it("sanitizes download file names", () => {
    expect(download.sanitizeDownloadFileName('标题:/\\*?"<>|')).toBe("标题_________");
    expect(download.sanitizeDownloadFileName("")).toBe("download");
  });
});
