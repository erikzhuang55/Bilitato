import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");

describe("product analytics instrumentation", () => {
  it("adds a task id and schema version to task event metadata", () => {
    expect(background).toContain("function createUsageTaskId");
    expect(background).toContain("event_schema_version: 1");
    expect(background).toContain('task_id: String(payload.taskId || "").trim() || undefined');

    const taskEventCount = [...background.matchAll(/eventName:\s*["']task_[a-z_]+["']/g)].length;
    const correlatedEventCount = [...background.matchAll(/^\s+taskId,$/gm)].length;
    expect(taskEventCount).toBeGreaterThan(10);
    expect(correlatedEventCount).toBeGreaterThanOrEqual(taskEventCount);
  });

  it("records installation and meaningful feature views", () => {
    expect(background).toContain('eventName: "extension_installed"');
    expect(background).toContain('install_source: "unknown"');
    expect(content).toContain('eventName: "feature_viewed"');
    expect(content).toContain('reportActiveFeatureViewed("bootstrap")');
    expect(content).toContain('reportActiveFeatureViewed("navigation")');
  });
});
