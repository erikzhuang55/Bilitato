import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20261112090000_add_usage_activity_rollup.sql", import.meta.url),
  "utf8",
);

describe("usage activity rollup migration", () => {
  it("stores activity counts separately from idempotent raw backfills", () => {
    expect(migration).toContain("direct_event_count bigint");
    expect(migration).toContain("raw_event_count bigint");
    expect(migration).toContain("direct_event_count + raw_event_count");
    expect(migration).toContain("raw_event_count = excluded.raw_event_count");
  });

  it("only accepts the two high-volume activity events", () => {
    expect(migration).toContain("'extension_started', 'feature_viewed'");
    expect(migration).toContain("unsupported daily activity event");
  });

  it("keeps dashboard activity and funnel metrics backed by the rollup", () => {
    expect(migration).toContain("create or replace function private.compute_usage_dashboard_activity_v1");
    expect(migration).toContain("from public.usage_activity_daily");
    expect(migration).toContain("'observable_users'");
    expect(migration).toContain("'funnel'");
    expect(migration).toContain("'trend'");
  });

  it("does not delete raw events before validation", () => {
    expect(migration).not.toContain("delete from public.usage_events");
  });
});
