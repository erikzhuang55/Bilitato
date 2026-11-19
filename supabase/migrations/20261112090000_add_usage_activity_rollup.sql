create table if not exists public.usage_activity_daily (
  stat_date date not null,
  user_hash text not null,
  extension_version text not null default '',
  event_name text not null,
  feature_name text not null default '',
  status text not null default '',
  direct_event_count bigint not null default 0 check (direct_event_count >= 0),
  raw_event_count bigint not null default 0 check (raw_event_count >= 0),
  event_count bigint generated always as (direct_event_count + raw_event_count) stored,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (stat_date, user_hash, extension_version, event_name, feature_name, status),
  constraint usage_activity_daily_event_name_check
    check (event_name in (
      'extension_started', 'feature_viewed', 'panel_opened', 'task_started',
      'task_success', 'task_partial', 'task_failed', 'task_cancelled', 'task_blocked'
    ))
);

alter table public.usage_activity_daily
  drop constraint if exists usage_activity_daily_event_name_check;
alter table public.usage_activity_daily
  add constraint usage_activity_daily_event_name_check
  check (event_name in (
    'extension_started', 'feature_viewed', 'panel_opened', 'task_started',
    'task_success', 'task_partial', 'task_failed', 'task_cancelled', 'task_blocked'
  ));

create index if not exists usage_activity_daily_date_idx
  on public.usage_activity_daily (stat_date desc);

create index if not exists usage_activity_daily_version_date_idx
  on public.usage_activity_daily (extension_version, stat_date desc)
  where extension_version <> '';

alter table public.usage_activity_daily enable row level security;
revoke all on table public.usage_activity_daily from public, anon, authenticated;
grant select, insert, update, delete on table public.usage_activity_daily to service_role;

create or replace function public.record_usage_activity_daily(
  p_user_hash text,
  p_extension_version text default '',
  p_event_name text default '',
  p_feature_name text default '',
  p_status text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_hash text := left(btrim(coalesce(p_user_hash, '')), 128);
  v_extension_version text := left(btrim(coalesce(p_extension_version, '')), 40);
  v_event_name text := left(lower(btrim(coalesce(p_event_name, ''))), 80);
  v_feature_name text := left(btrim(coalesce(p_feature_name, '')), 80);
  v_status text := left(btrim(coalesce(p_status, '')), 40);
  v_now timestamptz := now();
  v_date date := (v_now at time zone 'Asia/Shanghai')::date;
begin
  if v_user_hash = '' then
    raise exception 'user hash is required' using errcode = '22023';
  end if;
  if v_event_name not in ('extension_started', 'feature_viewed') then
    raise exception 'unsupported daily activity event' using errcode = '22023';
  end if;

  insert into public.usage_activity_daily (
    stat_date,
    user_hash,
    extension_version,
    event_name,
    feature_name,
    status,
    direct_event_count,
    raw_event_count,
    first_seen_at,
    last_seen_at,
    updated_at
  ) values (
    v_date,
    v_user_hash,
    v_extension_version,
    v_event_name,
    v_feature_name,
    v_status,
    1,
    0,
    v_now,
    v_now,
    v_now
  )
  on conflict (stat_date, user_hash, extension_version, event_name, feature_name, status)
  do update set
    direct_event_count = public.usage_activity_daily.direct_event_count + 1,
    first_seen_at = least(public.usage_activity_daily.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.usage_activity_daily.last_seen_at, excluded.last_seen_at),
    updated_at = v_now;
end;
$$;

revoke all on function public.record_usage_activity_daily(text, text, text, text, text)
  from public;
grant execute on function public.record_usage_activity_daily(text, text, text, text, text)
  to anon, authenticated;

create or replace function private.rollup_usage_activity(
  p_before_date date default ((now() at time zone 'Asia/Shanghai')::date + 1)
)
returns bigint
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_rows bigint := 0;
begin
  insert into public.usage_activity_daily (
    stat_date,
    user_hash,
    extension_version,
    event_name,
    feature_name,
    status,
    direct_event_count,
    raw_event_count,
    first_seen_at,
    last_seen_at,
    updated_at
  )
  select
    (e.created_at at time zone 'Asia/Shanghai')::date,
    e.user_hash,
    coalesce(e.extension_version, ''),
    e.event_name,
    coalesce(e.feature_name, ''),
    coalesce(e.status, ''),
    0,
    count(*)::bigint,
    min(e.created_at),
    max(e.created_at),
    now()
  from public.usage_events e
  where e.event_name in (
      'extension_started', 'feature_viewed', 'panel_opened', 'task_started',
      'task_success', 'task_partial', 'task_failed', 'task_cancelled', 'task_blocked'
    )
    and e.created_at < (p_before_date::timestamp at time zone 'Asia/Shanghai')
  group by
    (e.created_at at time zone 'Asia/Shanghai')::date,
    e.user_hash,
    coalesce(e.extension_version, ''),
    e.event_name,
    coalesce(e.feature_name, ''),
    coalesce(e.status, '')
  on conflict (stat_date, user_hash, extension_version, event_name, feature_name, status)
  do update set
    raw_event_count = excluded.raw_event_count,
    first_seen_at = least(public.usage_activity_daily.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.usage_activity_daily.last_seen_at, excluded.last_seen_at),
    updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function private.rollup_usage_activity(date)
  from public, anon, authenticated;
grant execute on function private.rollup_usage_activity(date) to service_role;

-- These wide indexes consumed about 700 MB and had no recorded scans. Keep the
-- primary key, created_at, user/session, and funnel-user indexes available while
-- the activity rollup is built. Smaller diagnostic indexes are recreated after
-- retention has reduced the raw table.
drop index if exists public.usage_events_version_activity_idx;
drop index if exists public.usage_events_funnel_idx;
drop index if exists public.usage_events_model_created_idx;
drop index if exists public.usage_events_feature_name_created_idx;
drop index if exists public.usage_events_bvid_idx;
drop index if exists public.usage_events_task_id_created_idx;
drop index if exists public.usage_events_error_idx;
drop index if exists public.usage_events_recovery_created_idx;

create index if not exists usage_events_dashboard_task_recent_idx
  on public.usage_events (created_at desc, event_name)
  include (user_hash, extension_version, feature_name, status)
  where event_name in (
    'panel_opened', 'task_started', 'task_success', 'task_partial',
    'task_failed', 'task_cancelled', 'task_blocked'
  );

select private.rollup_usage_activity();

create or replace function private.compute_usage_dashboard_activity_v1(
  p_days integer default 30,
  p_version text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days, 30), 90));
  v_version text := nullif(btrim(coalesce(p_version, '')), '');
  v_payload jsonb;
begin
  with
  params as (
    select coalesce(
      greatest(
        (select max(stat_date) from public.usage_activity_daily),
        ((select max(created_at) from public.usage_events) at time zone 'Asia/Shanghai')::date
      ),
      (now() at time zone 'Asia/Shanghai')::date
    ) as anchor_date
  ),
  activity_recent as materialized (
    select
      a.stat_date as local_date,
      a.user_hash,
      a.extension_version,
      a.event_name,
      a.feature_name,
      a.status,
      a.event_count,
      a.first_seen_at,
      a.last_seen_at
    from public.usage_activity_daily a
    cross join params p
    where a.stat_date between p.anchor_date - (greatest(v_days, 30) - 1) and p.anchor_date
      and (v_version is null or a.extension_version = v_version)
  ),
  active_user_days as (
    select distinct local_date, user_hash from activity_recent
  ),
  kpis as (
    select
      count(distinct u.user_hash) filter (where u.local_date = p.anchor_date) as dau,
      count(distinct u.user_hash) filter (
        where u.local_date between p.anchor_date - 6 and p.anchor_date
      ) as wau,
      count(distinct u.user_hash) filter (
        where u.local_date between p.anchor_date - 29 and p.anchor_date
      ) as mau
    from params p
    left join active_user_days u
      on u.local_date between p.anchor_date - 29 and p.anchor_date
  ),
  observable_users as (
    select count(distinct user_hash) as users
    from public.usage_activity_daily
  ),
  user_funnel as (
    select
      a.user_hash,
      min(a.first_seen_at) filter (
        where a.event_name = 'extension_started'
      ) as extension_at,
      min(a.first_seen_at) filter (
        where a.event_name = 'panel_opened' and lower(a.feature_name) = 'summary'
      ) as panel_at,
      min(a.first_seen_at) filter (
        where a.event_name = 'task_started' and a.feature_name = 'summary_segments_merged'
      ) as started_at,
      min(a.first_seen_at) filter (
        where a.event_name = 'task_success' and a.feature_name = 'summary_segments_merged'
      ) as success_at
    from activity_recent a
    cross join params p
    where a.local_date between p.anchor_date - (v_days - 1) and p.anchor_date
    group by a.user_hash
  ),
  funnel_counts as (
    select 1 as sort_order, 'extension_started' as step, 'Extension started' as label,
      count(*) filter (where extension_at is not null) as users
    from user_funnel
    union all
    select 2, 'panel_opened_summary', 'Summary opened',
      count(*) filter (
        where extension_at is not null and panel_at >= extension_at
      )
    from user_funnel
    union all
    select 3, 'task_started_summary', 'Summary task started',
      count(*) filter (
        where extension_at is not null
          and panel_at >= extension_at
          and started_at >= panel_at
      )
    from user_funnel
    union all
    select 4, 'task_success_summary', 'Summary task succeeded',
      count(*) filter (
        where extension_at is not null
          and panel_at >= extension_at
          and started_at >= panel_at
          and success_at >= started_at
      )
    from user_funnel
  ),
  funnel as (
    select
      sort_order,
      step,
      label,
      users,
      lag(users) over (order by sort_order) as previous_users
    from funnel_counts
  ),
  calendar as (
    select generate_series(
      (select anchor_date - (v_days - 1) from params),
      (select anchor_date from params),
      interval '1 day'
    )::date as stat_date
  ),
  daily_users as (
    select
      u.local_date as stat_date,
      count(distinct u.user_hash) as dau
    from active_user_days u
    group by u.local_date
  ),
  daily_tasks as (
    select
      r.local_date as stat_date,
      coalesce(sum(r.event_count) filter (where r.event_name = 'task_started'), 0) as task_volume,
      coalesce(sum(r.event_count) filter (where r.event_name = 'task_success'), 0) as task_success,
      coalesce(sum(r.event_count) filter (
        where r.event_name in (
          'task_success', 'task_partial', 'task_failed', 'task_cancelled', 'task_blocked'
        )
      ), 0) as task_terminal
    from activity_recent r
    group by r.local_date
  ),
  daily as (
    select
      c.stat_date,
      coalesce(u.dau, 0) as dau,
      coalesce(t.task_volume, 0) as task_volume,
      coalesce(t.task_success, 0) as task_success,
      coalesce(t.task_terminal, 0) as task_terminal
    from calendar c
    left join daily_users u on u.stat_date = c.stat_date
    left join daily_tasks t on t.stat_date = c.stat_date
  )
  select jsonb_build_object(
    'overview', (
      select jsonb_build_object(
        'dau', k.dau,
        'wau', k.wau,
        'mau', k.mau,
        'wau_mau_percent', round(100.0 * k.wau / nullif(k.mau, 0), 1),
        'observable_users', o.users
      )
      from kpis k cross join observable_users o
    ),
    'funnel', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'step', step,
        'label', label,
        'users', users,
        'conversion_percent', case
          when previous_users is null then 100
          else round(100.0 * users / nullif(previous_users, 0), 1)
        end,
        'dropoff', case
          when previous_users is null then 0
          else greatest(previous_users - users, 0)
        end
      ) order by sort_order), '[]'::jsonb)
      from funnel
    ),
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', stat_date,
        'dau', dau,
        'task_volume', task_volume,
        'task_success_rate_percent', round(
          100.0 * task_success / nullif(task_terminal, 0),
          1
        )
      ) order by stat_date), '[]'::jsonb)
      from daily
    )
  )
  into v_payload;

  return v_payload;
end;
$$;

revoke all on function private.compute_usage_dashboard_activity_v1(integer, text)
  from public, anon, authenticated;
grant execute on function private.compute_usage_dashboard_activity_v1(integer, text)
  to service_role;

delete from private.usage_dashboard_cache;

notify pgrst, 'reload schema';
