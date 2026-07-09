import { describe, expect, it } from "vitest";
import "../content/contentUtils.js";
import "../content/contentPage.js";

const page = globalThis.BilitatoContentPage;

describe("contentPage", () => {
  it("resolves current bvid from url first", () => {
    expect(page.resolveCurrentBvidFromState({
      injectBvid: "BVinject",
      tabState: { activeBvid: "BVtab" }
    }, "https://www.bilibili.com/video/BVurl1234567")).toBe("BVurl1234567");
  });

  it("falls back to inject and tab state when url has no bvid", () => {
    expect(page.resolveCurrentBvidFromState({
      injectBvid: "BVinject",
      tabState: { activeBvid: "BVtab" }
    }, "https://www.bilibili.com/")).toBe("BVinject");
    expect(page.resolveCurrentBvidFromState({
      tabState: { activeBvid: "BVtab" }
    }, "https://www.bilibili.com/")).toBe("BVtab");
  });

  it("resolves cid from inject, cache, then tab state", () => {
    expect(page.resolveCidFromState({ injectCid: 12, cache: { cid: 34 }, tabState: { activeCid: 56 } })).toBe(12);
    expect(page.resolveCidFromState({ cache: { cid: 34 }, tabState: { activeCid: 56 } })).toBe(34);
    expect(page.resolveCidFromState({ tabState: { activeCid: 56 } })).toBe(56);
  });

  it("picks Chinese subtitles first", () => {
    const picked = page.pickSubtitle([
      { lan: "en", subtitle_url: "en.json" },
      { lan_doc: "中文", subtitle_url: "zh.json" }
    ]);

    expect(picked.url).toBe("zh.json");
  });

  it("normalizes subtitle language options", () => {
    expect(page.normalizeSubtitleOptions([
      { lan: "en", lan_doc: "English", subtitle_url: "//example.com/en.json" },
      { lan_doc: "中文", subtitle_url: "zh.json" }
    ])).toEqual([
      { id: "en", label: "English", url: "https://example.com/en.json", lan: "en", lanDoc: "English" },
      { id: "中文", label: "中文", url: "zh.json", lan: "", lanDoc: "中文" }
    ]);
  });

  it("cleans bilibili title suffix", () => {
    expect(page.cleanBilibiliTitle("视频标题_哔哩哔哩_bilibili")).toBe("视频标题");
  });

  it("checks whether storage changes require rerender", () => {
    expect(page.isStorageChangeStateDirty({ settings: { newValue: {} } })).toBe(true);
    expect(page.isStorageChangeStateDirty({ cache_BV1: { newValue: {} } }, { afterBvid: "BV1" })).toBe(true);
    expect(page.isStorageChangeStateDirty({}, { switched: false, routeMismatch: false })).toBe(false);
  });
});
