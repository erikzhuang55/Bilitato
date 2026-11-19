import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const permissionRequest = readFileSync(new URL("../permission-request.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");

describe("feedback fixes", () => {
  it("requests optional origin permission directly from the user click", () => {
    expect(permissionRequest).toContain("const granted = await chrome.permissions.request");
    expect(permissionRequest).not.toContain("chrome.permissions.contains");
  });

  it("shows line numbers when subtitles have no real timestamps", () => {
    expect(content).toContain('aria-label="第 ${index + 1} 行"');
    expect(content).toContain('>#${index + 1}</span>');
    expect(content).not.toContain('color:transparent;">--</span>');
  });
});
