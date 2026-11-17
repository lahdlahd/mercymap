-- MERCYMAP · Milestone 5 · Resources, matching, approval, fulfilment
--
--   list_resources / get_resource / save_resource   resource management
--   list_matching_resources   which resources fit a request, and why others do not
--   approve_allocation        approve a request AND reserve its stock, atomically
--   record_fulfilment         mark help as delivered; stock moves to distributed
--   change_request_status     (replaced) now also handles Approved and In progress,
--                             returning reserved stock when a request leaves them
--   get_request_detail        (replaced) now includes the request's allocation
--
-- Matching rules are fixed (agreed 17 Nov 2026). A resource fits a request when
-- it belongs to the same church, has the same kind of help, is active, is within
-- its validity dates, has at least the quantity needed available, and covers
-- the request's area. A resource with no coverage areas serves any area; a
-- request with no area cannot be checked against coverage, so it is shown as
-- "coverage unconfirmed" and may still be approved.
--
-- Dates are judged in West Africa Time, the time zone of MERCYMAP's first churches.
--
-- Also fixes private.trim_all (Milestone 3): PostgreSQL has no \v escape, so
-- E'\v' meant the letter "v", and text starting or ending with "v" lost it
-- ("voucher" was saved as "oucher", "Viv" as "i"). chr(11) is the vertical tab.

create or replace function private.trim_all(p_value text)
returns text language sql immutable set search_path = '' as $$
  select btrim(p_value, E' \t\r\n\f' || chr(11));
$$;
revoke all on function private.trim_all(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.today_local()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Africa/Lagos')::date;
$$;

-- "Oke-Aro", "oke aro" and "OKE ARO" all compare equal.
create function private.normalize_area(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(coalesce(p_value, ''), '[^[:alnum:]]', '', 'g')), '');
$$;

create function private.resource_available(p_resource_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select (r.total_quantity - coalesce((
            select sum(a.quantity) from public.allocations a
             where a.resource_id = r.id and a.status in ('reserved', 'fulfilled')), 0))::integer
    from public.resources r where r.id = p_resource_id;
$$;

-- 'any' (resource serves every area), 'covered', 'unconfirmed' (request gave no
-- area) or 'not_covered'.
create function private.resource_coverage(p_coverage text[], p_area text)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(cardinality(p_coverage), 0) = 0 then 'any'
    when private.normalize_area(p_area) is null then 'unconfirmed'
    when exists (select 1 from unnest(p_coverage) c
                  where private.normalize_area(c) = private.normalize_area(p_area)) then 'covered'
    else 'not_covered'
  end;
$$;

-- Null when the resource fits the request; otherwise the first reason it does not.
create function private.resource_mismatch(p_resource public.resources, p_request public.requests, p_available integer)
returns text language sql stable set search_path = '' as $$
  select case
    when p_resource.church_id <> p_request.church_id then 'other_church'
    when p_resource.status <> 'active' then 'archived'
    when p_resource.category_key <> p_request.category_key then 'wrong_category'
    when p_resource.valid_from is not null and private.today_local() < p_resource.valid_from then 'not_yet_valid'
    when p_resource.valid_until is not null and private.today_local() > p_resource.valid_until then 'expired'
    when p_available < p_request.quantity_needed then 'not_enough'
    when private.resource_coverage(p_resource.coverage_areas, p_request.area) = 'not_covered' then 'area_not_covered'
    else null
  end;
$$;

-- The allocation guard from Milestone 1, now judging dates in West Africa Time.
create or replace function private.guard_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_resource  public.resources%rowtype;
  v_committed integer;
begin
  if tg_op = 'UPDATE' then
    if new.request_id <> old.request_id or new.resource_id <> old.resource_id
       or new.quantity <> old.quantity then
      raise exception 'allocation_immutable' using errcode = 'P0001';
    end if;
    if new.status <> old.status
       and not (old.status = 'reserved' and new.status in ('fulfilled', 'released')) then
      raise exception 'invalid_allocation_transition: % -> %', old.status, new.status
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status <> 'reserved' then
    raise exception 'allocation_must_start_reserved' using errcode = 'P0001';
  end if;

  select * into v_resource from public.resources r
   where r.id = new.resource_id and r.church_id = new.church_id
   for update;
  if not found then
    raise exception 'resource_not_found' using errcode = 'P0001';
  end if;
  if v_resource.status <> 'active' then
    raise exception 'resource_not_active' using errcode = 'P0001';
  end if;
  if (v_resource.valid_from is not null and private.today_local() < v_resource.valid_from)
     or (v_resource.valid_until is not null and private.today_local() > v_resource.valid_until) then
    raise exception 'resource_outside_validity' using errcode = 'P0001';
  end if;

  select coalesce(sum(a.quantity), 0) into v_committed
    from public.allocations a
   where a.resource_id = new.resource_id and a.status in ('reserved', 'fulfilled');
  if v_committed + new.quantity > v_resource.total_quantity then
    raise exception 'insufficient_available_quantity' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Status rules (replacing Milestone 4's)
-- ---------------------------------------------------------------------------

-- Keep in step with src/lib/request-transitions.json (a test compares them).
create or replace function private.request_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('submitted', 'under_review'), ('submitted', 'declined'), ('submitted', 'cancelled'),
    ('under_review', 'awaiting_clarification'), ('under_review', 'awaiting_match'),
    ('under_review', 'declined'), ('under_review', 'cancelled'), ('under_review', 'unable_to_fulfil'),
    ('awaiting_clarification', 'under_review'), ('awaiting_clarification', 'declined'),
    ('awaiting_clarification', 'cancelled'),
    ('awaiting_match', 'under_review'), ('awaiting_match', 'declined'),
    ('awaiting_match', 'cancelled'), ('awaiting_match', 'unable_to_fulfil'),
    ('approved', 'in_progress'), ('approved', 'awaiting_match'), ('approved', 'declined'),
    ('approved', 'cancelled'), ('approved', 'unable_to_fulfil'),
    ('in_progress', 'awaiting_match'), ('in_progress', 'cancelled'), ('in_progress', 'unable_to_fulfil')
  );
$$;

-- A note is required for the listed statuses, and whenever reserved stock is
-- being returned (leaving Approved or In progress other than to In progress).
create function private.request_change_needs_note(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select p_to in ('awaiting_clarification', 'declined', 'cancelled', 'unable_to_fulfil')
      or (p_from in ('approved', 'in_progress') and p_to <> 'in_progress');
$$;

create or replace function public.change_request_status(
  p_request_id  uuid,
  p_from_status text,
  p_to_status   text,
  p_note        text default null
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  public.requests%rowtype;
  v_note text := private.clean_text(p_note, 1000);
  v_released integer := 0;
begin
  v_row := private.lock_request_for_member(p_request_id);

  if (select c.status from public.churches c where c.id = v_row.church_id) = 'suspended' then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from p_from_status then
    raise exception 'status_changed' using errcode = 'P0001';
  end if;
  if p_to_status in ('approved', 'fulfilled') then
    raise exception 'requires_allocation' using errcode = 'P0001';
  end if;
  if not private.request_transition_allowed(v_row.status, p_to_status) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if private.request_change_needs_note(v_row.status, p_to_status) and (v_note is null or char_length(v_note) < 3) then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  -- Return reserved stock in the same transaction as the status change.
  if v_row.status in ('approved', 'in_progress') and p_to_status <> 'in_progress' then
    update public.allocations
       set status = 'released', released_by = v_uid, released_at = now(), release_reason = v_note
     where request_id = v_row.id and church_id = v_row.church_id and status = 'reserved';
    get diagnostics v_released = row_count;
  end if;

  update public.requests
     set status = p_to_status,
         outcome_reason = case when private.request_status_is_closed(p_to_status) then v_note else null end
   where id = v_row.id;

  insert into public.request_events (church_id, request_id, actor_user_id, event_type, from_status, to_status, note)
  values (v_row.church_id, v_row.id, v_uid, 'status_changed', v_row.status, p_to_status,
          case when v_released > 0 then concat_ws(' ', v_note, '(Reserved stock returned.)') else v_note end);

  return p_to_status;
end $$;

-- ---------------------------------------------------------------------------
-- Approval and fulfilment
-- ---------------------------------------------------------------------------

-- Approves the request and reserves its stock in one transaction. The request
-- row is locked first, then the resource row, so two people approving at once
-- (the same request, or different requests competing for the last units)
-- queue up and the loser gets a clear error. Nothing is half-done on failure.
create function public.approve_allocation(
  p_request_id  uuid,
  p_from_status text,
  p_resource_id uuid,
  p_note        text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_row       public.requests%rowtype;
  v_resource  public.resources%rowtype;
  v_available integer;
  v_reason    text;
  v_note      text := private.clean_text(p_note, 1000);
  v_alloc_id  uuid;
begin
  v_row := private.lock_request_for_member(p_request_id);

  if (select c.status from public.churches c where c.id = v_row.church_id) = 'suspended' then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from p_from_status then
    raise exception 'status_changed' using errcode = 'P0001';
  end if;
  if v_row.status <> 'awaiting_match' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  select * into v_resource from public.resources r
   where r.id = p_resource_id and r.church_id = v_row.church_id
   for update;
  if not found then
    raise exception 'resource_not_found' using errcode = 'P0001';
  end if;

  v_available := private.resource_available(v_resource.id);
  v_reason := private.resource_mismatch(v_resource, v_row, v_available);
  if v_reason is not null then
    raise exception 'resource_not_suitable: %', v_reason using errcode = 'P0001';
  end if;

  insert into public.allocations (church_id, request_id, resource_id, quantity, status,
                                  ai_recommended, recommendation_snapshot, approved_by)
  values (v_row.church_id, v_row.id, v_resource.id, v_row.quantity_needed, 'reserved', false,
          jsonb_build_object('resource_name', v_resource.name, 'unit', v_resource.unit,
                             'available_before', v_available,
                             'coverage', private.resource_coverage(v_resource.coverage_areas, v_row.area)),
          v_uid)
  returning id into v_alloc_id;

  update public.requests set status = 'approved', outcome_reason = null where id = v_row.id;

  insert into public.request_events (church_id, request_id, actor_user_id, event_type, from_status, to_status, note)
  values (v_row.church_id, v_row.id, v_uid, 'status_changed', 'awaiting_match', 'approved',
          concat_ws(' ', format('Reserved %s %s from "%s".', v_row.quantity_needed, v_resource.unit, v_resource.name), v_note));

  return v_alloc_id;
end $$;

create function public.record_fulfilment(p_request_id uuid, p_from_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  public.requests%rowtype;
  v_note text := private.clean_text(p_note, 1000);
begin
  v_row := private.lock_request_for_member(p_request_id);

  if (select c.status from public.churches c where c.id = v_row.church_id) = 'suspended' then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from p_from_status then
    raise exception 'status_changed' using errcode = 'P0001';
  end if;
  if v_row.status not in ('approved', 'in_progress') then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.allocations
     set status = 'fulfilled', fulfilled_by = v_uid, fulfilled_at = now()
   where request_id = v_row.id and church_id = v_row.church_id and status = 'reserved';
  if not found then
    raise exception 'no_reservation' using errcode = 'P0001';
  end if;

  update public.requests set status = 'fulfilled', outcome_reason = v_note where id = v_row.id;

  insert into public.request_events (church_id, request_id, actor_user_id, event_type, from_status, to_status, note)
  values (v_row.church_id, v_row.id, v_uid, 'status_changed', v_row.status, 'fulfilled', v_note);
end $$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create function public.list_matching_resources(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.requests%rowtype;
  v_result jsonb;
begin
  select * into v_row from public.requests r where r.id = p_request_id;
  if not found or not private.is_church_member(v_row.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(c.item order by (c.reason is null) desc, c.valid_until nulls last, c.available desc, c.name), '[]'::jsonb)
    into v_result
    from (
      select r.name, r.valid_until, a.available,
             private.resource_mismatch(r, v_row, a.available) as reason,
             jsonb_build_object(
               'id', r.id, 'name', r.name, 'unit', r.unit,
               'source_type', r.source_type, 'source_name', r.source_name,
               'available', a.available, 'total', r.total_quantity,
               'valid_from', r.valid_from, 'valid_until', r.valid_until,
               'coverage_areas', to_jsonb(r.coverage_areas),
               'coverage', private.resource_coverage(r.coverage_areas, v_row.area),
               'reason', private.resource_mismatch(r, v_row, a.available)) as item
        from public.resources r
        cross join lateral (select private.resource_available(r.id) as available) a
       where r.church_id = v_row.church_id
         and r.category_key = v_row.category_key
         and r.status = 'active'
    ) c;

  return jsonb_build_object('quantity_needed', v_row.quantity_needed, 'area', v_row.area, 'resources', v_result);
end $$;

create or replace function public.get_request_detail(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.requests%rowtype;
begin
  select * into v_row from public.requests r where r.id = p_request_id;
  if not found or not private.is_church_member(v_row.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id)
  values (v_row.church_id, v_uid, 'request.viewed', 'request', v_row.id);

  return jsonb_build_object(
    'request', to_jsonb(v_row) - 'ai_attempts',
    'category_label', (select k.label from public.categories k where k.key = v_row.category_key),
    'created_by_email', (select u.email from auth.users u where u.id = v_row.created_by),
    'attention_acknowledged_by_email',
      (select u.email from auth.users u where u.id = v_row.attention_acknowledged_by),
    'allocation', (
      select jsonb_build_object(
               'id', a.id, 'status', a.status, 'quantity', a.quantity,
               'resource_id', r.id, 'resource_name', r.name, 'unit', r.unit,
               'source_type', r.source_type, 'source_name', r.source_name,
               'approved_at', a.approved_at, 'approved_by_email', ua.email,
               'fulfilled_at', a.fulfilled_at, 'fulfilled_by_email', uf.email,
               'released_at', a.released_at, 'release_reason', a.release_reason)
        from public.allocations a
        join public.resources r on r.id = a.resource_id and r.church_id = a.church_id
        left join auth.users ua on ua.id = a.approved_by
        left join auth.users uf on uf.id = a.fulfilled_by
       where a.request_id = v_row.id and a.church_id = v_row.church_id
       order by a.created_at desc, a.id desc
       limit 1),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'event_type', e.event_type, 'from_status', e.from_status,
               'to_status', e.to_status, 'note', e.note, 'created_at', e.created_at,
               'actor_email', u.email)
             order by e.created_at, e.id)
        from public.request_events e
        left join auth.users u on u.id = e.actor_user_id
       where e.request_id = v_row.id and e.church_id = v_row.church_id
    ), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Resources
-- ---------------------------------------------------------------------------

create function private.resource_json(p_resource public.resources)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p_resource) || jsonb_build_object(
           'category_label', (select k.label from public.categories k where k.key = p_resource.category_key),
           'reserved', coalesce((select sum(a.quantity) from public.allocations a
                                  where a.resource_id = p_resource.id and a.status = 'reserved'), 0),
           'distributed', coalesce((select sum(a.quantity) from public.allocations a
                                     where a.resource_id = p_resource.id and a.status = 'fulfilled'), 0),
           'available', private.resource_available(p_resource.id),
           'manager_email', (select u.email from auth.users u where u.id = p_resource.manager_user_id),
           'expired', p_resource.valid_until is not null and private.today_local() > p_resource.valid_until,
           'not_yet_valid', p_resource.valid_from is not null and private.today_local() < p_resource.valid_from);
$$;

create function public.list_resources(p_church_id uuid, p_include_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(private.resource_json(r) order by r.status, k.sort_order, r.name), '[]'::jsonb)
    into v_result
    from public.resources r
    join public.categories k on k.key = r.category_key
   where r.church_id = p_church_id
     and (coalesce(p_include_archived, false) or r.status = 'active');
  return v_result;
end $$;

create function public.get_resource(p_resource_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_res public.resources%rowtype;
begin
  select * into v_res from public.resources r where r.id = p_resource_id;
  if not found or not private.is_church_member(v_res.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return private.resource_json(v_res) || jsonb_build_object(
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'status', a.status, 'quantity', a.quantity,
               'request_id', q.id, 'reference', q.reference,
               'approved_at', a.approved_at, 'fulfilled_at', a.fulfilled_at, 'released_at', a.released_at)
             order by a.created_at desc)
        from (select * from public.allocations x
               where x.resource_id = v_res.id and x.church_id = v_res.church_id
               order by x.created_at desc limit 50) a
        join public.requests q on q.id = a.request_id and q.church_id = a.church_id
    ), '[]'::jsonb));
end $$;

-- Creates (p_resource_id null) or updates a resource. Every change is audited.
create function public.save_resource(
  p_resource_id    uuid,
  p_church_id      uuid,
  p_name           text,
  p_category       text,
  p_description    text,
  p_unit           text,
  p_total_quantity integer,
  p_source_type    text,
  p_source_name    text,
  p_coverage_areas text[],
  p_valid_from     date,
  p_valid_until    date,
  p_manager        uuid,
  p_status         text default 'active'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_existing public.resources%rowtype;
  v_name     text := private.clean_text(p_name, 160);
  v_unit     text := private.clean_text(p_unit, 40);
  v_source   text := private.clean_text(p_source_name, 160);
  v_areas    text[];
  v_id       uuid;
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select c.status from public.churches c where c.id = p_church_id) = 'suspended' then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if p_resource_id is not null then
    select * into v_existing from public.resources r where r.id = p_resource_id for update;
    if not found or v_existing.church_id <> p_church_id then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
  end if;

  if v_name is null or char_length(v_name) < 2 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.categories k where k.key = p_category and k.is_active) then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;
  if v_unit is null then raise exception 'invalid_unit' using errcode = 'P0001'; end if;
  if p_total_quantity is null or p_total_quantity < 0 or p_total_quantity > 1000000 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;
  if p_source_type is null or p_source_type not in ('church', 'partner') then
    raise exception 'invalid_source' using errcode = 'P0001';
  end if;
  if p_source_type = 'partner' and v_source is null then
    raise exception 'partner_name_required' using errcode = 'P0001';
  end if;
  if p_valid_from is not null and p_valid_until is not null and p_valid_until < p_valid_from then
    raise exception 'invalid_dates' using errcode = 'P0001';
  end if;
  if coalesce(p_status, 'active') not in ('active', 'archived') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if p_manager is not null and not exists (
       select 1 from public.church_memberships m
        where m.church_id = p_church_id and m.user_id = p_manager and m.status = 'active') then
    raise exception 'invalid_manager' using errcode = 'P0001';
  end if;

  -- Trim, drop blanks and duplicates (ignoring case and punctuation), keep order.
  select coalesce(array_agg(a order by n), '{}') into v_areas
    from (select distinct on (private.normalize_area(x)) private.clean_text(x, 60) as a, n
            from unnest(coalesce(p_coverage_areas, '{}')) with ordinality as t(x, n)
           where private.normalize_area(x) is not null
           order by private.normalize_area(x), n) d;
  if cardinality(v_areas) > 20 then raise exception 'too_many_areas' using errcode = 'P0001'; end if;

  if p_resource_id is null then
    insert into public.resources (church_id, name, category_key, description, unit, total_quantity,
                                  source_type, source_name, coverage_areas, valid_from, valid_until,
                                  manager_user_id, status)
    values (p_church_id, v_name, p_category, private.clean_text(p_description, 2000), v_unit, p_total_quantity,
            p_source_type, case when p_source_type = 'partner' then v_source end, v_areas,
            p_valid_from, p_valid_until, p_manager, coalesce(p_status, 'active'))
    returning id into v_id;
    insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (p_church_id, v_uid, 'resource.created', 'resource', v_id,
            jsonb_build_object('name', v_name, 'total_quantity', p_total_quantity));
  else
    update public.resources
       set name = v_name, category_key = p_category, description = private.clean_text(p_description, 2000),
           unit = v_unit, total_quantity = p_total_quantity, source_type = p_source_type,
           source_name = case when p_source_type = 'partner' then v_source end,
           coverage_areas = v_areas, valid_from = p_valid_from, valid_until = p_valid_until,
           manager_user_id = p_manager, status = coalesce(p_status, 'active')
     where id = p_resource_id;
    v_id := p_resource_id;
    insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (p_church_id, v_uid,
            case when v_existing.status <> coalesce(p_status, 'active')
                 then case when p_status = 'archived' then 'resource.archived' else 'resource.restored' end
                 else 'resource.updated' end,
            'resource', v_id,
            jsonb_build_object('total_quantity_from', v_existing.total_quantity, 'total_quantity_to', p_total_quantity));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.today_local() from public, anon, authenticated;
revoke all on function private.normalize_area(text) from public, anon, authenticated;
revoke all on function private.resource_available(uuid) from public, anon, authenticated;
revoke all on function private.resource_coverage(text[], text) from public, anon, authenticated;
revoke all on function private.resource_mismatch(public.resources, public.requests, integer) from public, anon, authenticated;
revoke all on function private.request_change_needs_note(text, text) from public, anon, authenticated;
revoke all on function private.resource_json(public.resources) from public, anon, authenticated;
revoke all on function public.approve_allocation(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.record_fulfilment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_matching_resources(uuid) from public, anon, authenticated;
revoke all on function public.list_resources(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_resource(uuid) from public, anon, authenticated;
revoke all on function public.save_resource(uuid, uuid, text, text, text, text, integer, text, text, text[], date, date, uuid, text)
  from public, anon, authenticated;

grant execute on function public.approve_allocation(uuid, text, uuid, text) to authenticated;
grant execute on function public.record_fulfilment(uuid, text, text) to authenticated;
grant execute on function public.list_matching_resources(uuid) to authenticated;
grant execute on function public.list_resources(uuid, boolean) to authenticated;
grant execute on function public.get_resource(uuid) to authenticated;
grant execute on function public.save_resource(uuid, uuid, text, text, text, text, integer, text, text, text[], date, date, uuid, text)
  to authenticated;
