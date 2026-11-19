create or replace function private.prune_usage_events(
  p_batch_size integer default 25000,
  p_max_batches integer default 4
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_batch_size integer := greatest(1000, least(coalesce(p_batch_size, 25000), 100000));
  v_max_batches integer := greatest(1, least(coalesce(p_max_batches, 4), 20));
  v_activity_cutoff timestamptz := (
    ((now() at time zone 'Asia/Shanghai')::date - 7)::timestamp
    at time zone 'Asia/Shanghai'
  );
  v_detail_cutoff timestamptz := (
    ((now() at time zone 'Asia/Shanghai')::date - 90)::timestamp
    at time zone 'Asia/Shanghai'
  );
  v_deleted integer := 0;
  v_total_deleted bigint := 0;
  v_batches integer := 0;
  v_rolled_up bigint := 0;
  v_rollup_deleted bigint := 0;
begin
  v_rolled_up := private.rollup_usage_activity(
    (now() at time zone 'Asia/Shanghai')::date + 1
  );

  delete from public.usage_activity_daily
  where stat_date < (now() at time zone 'Asia/Shanghai')::date - 90;
  get diagnostics v_rollup_deleted = row_count;

  loop
    exit when v_batches >= v_max_batches;

    with doomed as materialized (
      select e.ctid
      from public.usage_events e
      where (
          e.event_name in ('extension_started', 'feature_viewed')
          and e.created_at < v_activity_cutoff
        )
        or (
          e.event_name not in ('extension_started', 'feature_viewed')
          and e.created_at < v_detail_cutoff
        )
      order by e.created_at
      limit v_batch_size
    )
    delete from public.usage_events e
    using doomed d
    where e.ctid = d.ctid;

    get diagnostics v_deleted = row_count;
    v_total_deleted := v_total_deleted + v_deleted;
    v_batches := v_batches + 1;
    exit when v_deleted < v_batch_size;
  end loop;

  return jsonb_build_object(
    'rolled_up_rows', v_rolled_up,
    'deleted_rollup_rows', v_rollup_deleted,
    'deleted_rows', v_total_deleted,
    'batches', v_batches,
    'activity_cutoff', v_activity_cutoff,
    'detail_cutoff', v_detail_cutoff
  );
end;
$$;

revoke all on function private.prune_usage_events(integer, integer)
  from public, anon, authenticated;
grant execute on function private.prune_usage_events(integer, integer)
  to service_role;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into v_job_id
    from cron.job
    where jobname = 'bilitato-usage-events-retention'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'bilitato-usage-events-retention',
      '30 18 * * *',
      $schedule$select private.prune_usage_events(25000, 4);$schedule$
    );
  end if;
end;
$$;
