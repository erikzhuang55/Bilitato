import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const staticRules = JSON.parse(readFileSync(new URL("../rules.json", import.meta.url), "utf8"));
const ruleSource = backgroundSource.slice(
  backgroundSource.indexOf("async function ensureDownloadHeaderRule"),
  backgroundSource.indexOf("async function probeDownloadContentType")
);
const asrFetchSource = backgroundSource.slice(
  backgroundSource.indexOf("static async fetchAudioResourceWithFallback"),
  backgroundSource.indexOf("static async ensureGroqConnectivity")
);

describe("Bilibili media header rule", () => {
  it("sets Referer without rewriting the immutable request Origin", () => {
    expect(ruleSource).toContain('{ header: "Referer", operation: "set", value: "https://www.bilibili.com/" }');
    expect(ruleSource).not.toMatch(/header:\s*["']Origin["']/i);
    expect(staticRules.flatMap((rule) => rule.action?.requestHeaders || []))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ header: "Origin" })
      ]));
  });

  it("refreshes the safe rule before ASR audio fetching", () => {
    expect(asrFetchSource).toContain("await ensureDownloadHeaderRule(url);");
  });

  it("uses the original extension fetch before the page fallback", () => {
    const extensionFetch = asrFetchSource.indexOf("this.fetchResourceToBlob(url");
    const pageFetch = asrFetchSource.indexOf("this.fetchResourceToBlobFromTab(url");
    expect(extensionFetch).toBeGreaterThan(-1);
    expect(pageFetch).toBeGreaterThan(extensionFetch);
    expect(asrFetchSource).toContain('fallback: "page_fetch"');
  });
});
