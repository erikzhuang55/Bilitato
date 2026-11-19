import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20261112100000_rebuild_usage_event_indexes.sql", import.meta.url),
  "utf8",
);

describe("usage event index rebuild migration", () => {
  it("limits broad dashboard indexes to task events", () => {
    expect(migration).toContain("event_name like 'task_%'");
    expect(migration).toContain("usage_events_model_created_idx");
    expect(migration).toContain("usage_events_feature_name_created_idx");
  });

  it("removes redundant wide session and version indexes", () => {
    expect(migration).toContain("drop index if exists public.usage_events_user_session_created_idx");
    expect(migration).toContain("drop index if exists public.usage_events_version_activity_idx");
    expect(migration).toContain("drop index if exists public.usage_activity_daily_version_date_idx");
  });

  it("keeps task lifecycle, error, and recovery lookup indexes", () => {
    expect(migration).toContain("usage_events_task_id_created_idx");
    expect(migration).toContain("usage_events_error_idx");
    expect(migration).toContain("usage_events_recovery_created_idx");
  });

  it("does not recreate retired bvid or wide funnel indexes", () => {
    expect(migration).not.toContain("usage_events_bvid_idx");
    expect(migration).not.toContain("usage_events_funnel_idx");
  });
});
