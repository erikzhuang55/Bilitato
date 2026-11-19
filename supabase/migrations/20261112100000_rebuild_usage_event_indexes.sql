drop index if exists public.usage_events_user_session_created_idx;
drop index if exists public.usage_events_version_activity_idx;
drop index if exists public.usage_activity_daily_version_date_idx;

create index if not exists usage_events_model_created_idx
  on public.usage_events (model, created_at desc)
  where model <> '' and event_name like 'task_%';

create index if not exists usage_events_feature_name_created_idx
  on public.usage_events (feature_name, created_at desc)
  where feature_name <> '' and event_name like 'task_%';

create index if not exists usage_events_task_id_created_idx
  on public.usage_events ((metadata->>'task_id'), created_at desc)
  where metadata ? 'task_id';

create index if not exists usage_events_error_idx
  on public.usage_events (error_code, provider, model, created_at desc)
  where error_code <> '';

create index if not exists usage_events_recovery_created_idx
  on public.usage_events (created_at, event_name)
  where event_name in ('task_attempt_failed', 'task_recovery_finished');

analyze public.usage_events;
