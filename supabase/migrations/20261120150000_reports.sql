-- MERCYMAP · Milestone 8 · Dashboard, Reports & Impact, exports
--
-- Every figure is computed from the church's own records at the moment it is
-- asked for: requests, their history, allocations and volunteer tasks. Nothing
-- is cached or estimated. Each function checks membership of the church it is
-- asked about, so one church never sees another's numbers.
--
-- Periods are whole days in Lagos time (the church's local day): "last 30
-- days" is today plus the 29 days before it.
--
-- Exports contain no names, phone numbers or descriptions, may be downloaded
-- only by owners and admins, and every download is written to the audit log.

-- When a request reached a status, from its history. Used for "fulfilled in
-- the period" and for the closing date of a request.
create function private.status_reached_at(p_request_id uuid, p_statuses text[])
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(e.created_at) from public.request_events e
   where e.request_id = p_request_id and e.to_status = any (p_statuses);
$$;

create function private.period_start(p_days integer)
returns timestamptz language sql stable set search_path = '' as $$
  select ((private.today_local() - (p_days - 1))::timestamp at time zone 'Africa/Lagos');
$$;

-- ---------------------------------------------------------------------------
-- Dashboard tiles
-- ---------------------------------------------------------------------------

create function public.dashboard_summary(p_church_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_month_start timestamptz := (date_trunc('month', private.today_local()::timestamp) at time zone 'Africa/Lagos');
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'open', (select count(*) from public.requests r
              where r.church_id = p_church_id and not private.request_status_is_closed(r.status)),
    'new', (select count(*) from public.requests r where r.church_id = p_church_id and r.status = 'submitted'),
    'attention', (select count(*) from public.requests r
                   where r.church_id = p_church_id and r.attention_flag and r.attention_acknowledged_at is null),
    'awaiting_match', (select count(*) from public.requests r where r.church_id = p_church_id and r.status = 'awaiting_match'),
    'approved', (select count(*) from public.requests r where r.church_id = p_church_id and r.status = 'approved'),
    'in_progress', (select count(*) from public.requests r where r.church_id = p_church_id and r.status = 'in_progress'),
    'fulfilled_this_month', (
      select count(distinct e.request_id) from public.request_events e
        join public.requests r on r.id = e.request_id and r.church_id = e.church_id
       where e.church_id = p_church_id and e.to_status = 'fulfilled'
         and e.created_at >= v_month_start and r.status = 'fulfilled'),
    'units_given_this_month', (
      select coalesce(sum(a.quantity), 0) from public.allocations a
       where a.church_id = p_church_id and a.status = 'fulfilled' and a.fulfilled_at >= v_month_start),
    'low_stock', (
      select count(*) from public.resources s
        cross join lateral (select private.resource_available(s.id) as available) x
       where s.church_id = p_church_id and s.status = 'active' and s.total_quantity > 0
         and (x.available <= 2 or x.available * 5 < s.total_quantity)),
    'month_start', v_month_start);
end $$;

-- ---------------------------------------------------------------------------
-- Reports & Impact
-- ---------------------------------------------------------------------------

create function public.report_summary(p_church_id uuid, p_days integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from   timestamptz;
  v_bucket text;
  v_start  date;
  v_end    date := private.today_local();
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_days is null or p_days not in (7, 30, 90, 365) then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  v_from := private.period_start(p_days);
  v_start := v_end - (p_days - 1);
  -- Day buckets for short periods, weeks for 90 days, months for a year.
  v_bucket := case when p_days <= 30 then 'day' when p_days = 90 then 'week' else 'month' end;

  return jsonb_build_object(
    'days', p_days,
    'from', v_start,
    'to', v_end,
    'bucket', v_bucket,
    'totals', (
      with fulfilled as (
        select r.id, r.created_at, private.status_reached_at(r.id, array['fulfilled']) as done_at
          from public.requests r
         where r.church_id = p_church_id and r.status = 'fulfilled')
      select jsonb_build_object(
        'received', (select count(*) from public.requests r where r.church_id = p_church_id and r.created_at >= v_from),
        'fulfilled', (select count(*) from fulfilled f where f.done_at >= v_from),
        'units_given', (select coalesce(sum(a.quantity), 0) from public.allocations a
                         where a.church_id = p_church_id and a.status = 'fulfilled' and a.fulfilled_at >= v_from),
        'median_days_to_fulfil', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from f.done_at - f.created_at)) / 86400)::numeric, 1)
            from fulfilled f where f.done_at >= v_from),
        'tasks_completed', (select count(*) from public.assignments t
                             where t.church_id = p_church_id and t.status = 'completed' and t.completed_at >= v_from),
        'approvals', (select count(*) from public.allocations a where a.church_id = p_church_id and a.approved_at >= v_from),
        'approvals_ai_suggested', (select count(*) from public.allocations a
                                    where a.church_id = p_church_id and a.approved_at >= v_from and a.ai_recommended))),
    -- Chart 1: requests received and fulfilled per bucket (every bucket present, zeros included).
    'over_time', (
      with buckets as (
        select g::date as bucket_start
          from generate_series(date_trunc(v_bucket, v_start::timestamp), v_end::timestamp, ('1 ' || v_bucket)::interval) g),
      received as (
        select date_trunc(v_bucket, (r.created_at at time zone 'Africa/Lagos'))::date as b, count(*) as n
          from public.requests r where r.church_id = p_church_id and r.created_at >= v_from group by 1),
      done as (
        select date_trunc(v_bucket, (private.status_reached_at(r.id, array['fulfilled']) at time zone 'Africa/Lagos'))::date as b, count(*) as n
          from public.requests r
         where r.church_id = p_church_id and r.status = 'fulfilled'
           and private.status_reached_at(r.id, array['fulfilled']) >= v_from
         group by 1)
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', greatest(b.bucket_start, v_start), 'received', coalesce(rc.n, 0), 'fulfilled', coalesce(d.n, 0))
             order by b.bucket_start), '[]'::jsonb)
        from buckets b
        left join received rc on rc.b = b.bucket_start
        left join done d on d.b = b.bucket_start),
    -- Chart 2: requests received in the period by kind of help.
    'by_kind', (
      select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label, 'count', x.n)
                                order by x.n desc, x.label), '[]'::jsonb)
        from (select k.key, k.label, count(*) as n
                from public.requests r join public.categories k on k.key = r.category_key
               where r.church_id = p_church_id and r.created_at >= v_from
               group by k.key, k.label) x),
    -- Chart 3: where the requests received in the period stand now.
    'outcomes', (
      select jsonb_build_array(
        jsonb_build_object('key', 'fulfilled', 'label', 'Fulfilled', 'count', count(*) filter (where r.status = 'fulfilled')),
        jsonb_build_object('key', 'open', 'label', 'Still open', 'count', count(*) filter (where not private.request_status_is_closed(r.status))),
        jsonb_build_object('key', 'declined', 'label', 'Declined', 'count', count(*) filter (where r.status = 'declined')),
        jsonb_build_object('key', 'unable_to_fulfil', 'label', 'Unable to fulfil', 'count', count(*) filter (where r.status = 'unable_to_fulfil')),
        jsonb_build_object('key', 'cancelled', 'label', 'Cancelled', 'count', count(*) filter (where r.status = 'cancelled')))
        from public.requests r where r.church_id = p_church_id and r.created_at >= v_from),
    -- Chart 4: stock given out in the period, by resource (top 10).
    'given_by_resource', (
      select coalesce(jsonb_agg(jsonb_build_object('resource_id', x.id, 'name', x.name, 'unit', x.unit, 'quantity', x.q)
                                order by x.q desc, x.name), '[]'::jsonb)
        from (select s.id, s.name, s.unit, sum(a.quantity) as q
                from public.allocations a join public.resources s on s.id = a.resource_id and s.church_id = a.church_id
               where a.church_id = p_church_id and a.status = 'fulfilled' and a.fulfilled_at >= v_from
               group by s.id, s.name, s.unit
               order by q desc, s.name
               limit 10) x));
end $$;

-- ---------------------------------------------------------------------------
-- Exports (owners and admins; audited; no names, phones or descriptions)
-- ---------------------------------------------------------------------------

create function public.export_report(p_church_id uuid, p_kind text, p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_from timestamptz;
  v_rows jsonb;
begin
  if not private.has_church_role(p_church_id, array['owner', 'admin']) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_days is null or p_days not in (7, 30, 90, 365) then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  v_from := private.period_start(p_days);

  if p_kind = 'requests' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'reference', r.reference,
             'received', to_char(r.created_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'),
             'kind_of_help', k.label,
             'status', r.status,
             'quantity', r.quantity_needed,
             'area', coalesce(r.area, ''),
             'channel', r.channel,
             'closed', coalesce(to_char(private.status_reached_at(r.id, array['fulfilled', 'declined', 'cancelled', 'unable_to_fulfil'])
                                          at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'), ''))
             order by r.created_at, r.reference), '[]'::jsonb)
      into v_rows
      from public.requests r join public.categories k on k.key = r.category_key
     where r.church_id = p_church_id and r.created_at >= v_from;
  elsif p_kind = 'stock' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'given_out', to_char(a.fulfilled_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'),
             'reference', r.reference,
             'resource', s.name,
             'quantity', a.quantity,
             'unit', s.unit,
             'source', case when s.source_type = 'partner' then 'Partner: ' || coalesce(s.source_name, '') else 'Church' end,
             'ai_suggested', case when a.ai_recommended then 'yes' else 'no' end)
             order by a.fulfilled_at, r.reference), '[]'::jsonb)
      into v_rows
      from public.allocations a
      join public.requests r on r.id = a.request_id and r.church_id = a.church_id
      join public.resources s on s.id = a.resource_id and s.church_id = a.church_id
     where a.church_id = p_church_id and a.status = 'fulfilled' and a.fulfilled_at >= v_from;
  elsif p_kind = 'tasks' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'given', to_char(t.created_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'),
             'reference', r.reference,
             'status', t.status,
             'completed', coalesce(to_char(t.completed_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI'), ''))
             order by t.created_at, r.reference), '[]'::jsonb)
      into v_rows
      from public.assignments t join public.requests r on r.id = t.request_id and r.church_id = t.church_id
     where t.church_id = p_church_id and t.created_at >= v_from;
  else
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_church_id, v_uid, 'report.exported', 'church', p_church_id,
          jsonb_build_object('kind', p_kind, 'days', p_days, 'rows', jsonb_array_length(v_rows)));
  return v_rows;
end $$;

revoke all on function private.status_reached_at(uuid, text[]) from public, anon, authenticated;
revoke all on function private.period_start(integer) from public, anon, authenticated;
revoke all on function public.dashboard_summary(uuid) from public, anon, authenticated;
revoke all on function public.report_summary(uuid, integer) from public, anon, authenticated;
revoke all on function public.export_report(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.dashboard_summary(uuid) to authenticated;
grant execute on function public.report_summary(uuid, integer) to authenticated;
grant execute on function public.export_report(uuid, text, integer) to authenticated;
