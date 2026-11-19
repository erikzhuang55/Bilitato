import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20261112093000_add_usage_event_retention.sql", import.meta.url),
  "utf8",
);

describe("usage event retention migration", () => {
  it("rolls up before deleting any raw events", () => {
    expect(migration.indexOf("private.rollup_usage_activity")).toBeLessThan(
      migration.indexOf("delete from public.usage_events"),
    );
  });

  it("retains activity for 7 days and diagnostics for 90 days", () => {
    expect(migration).toContain("::date - 7");
    expect(migration).toContain("::date - 90");
    expect(migration).toContain("'extension_started', 'feature_viewed'");
  });

  it("deletes in bounded batches", () => {
    expect(migration).toContain("limit v_batch_size");
    expect(migration).toContain("v_batches >= v_max_batches");
    expect(migration).toContain("least(coalesce(p_batch_size, 25000), 100000)");
  });

  it("schedules maintenance before the dashboard refresh window", () => {
    expect(migration).toContain("bilitato-usage-events-retention");
    expect(migration).toContain("30 18 * * *");
  });
});
