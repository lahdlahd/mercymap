-- MERCYMAP · Milestone 4 · Request management
--
-- Staff read, move and annotate requests only through these functions. Each
-- one checks that the caller is an active member of the request's church.
--
--   list_requests              filtered, paged list for the Requests page
--   request_status_counts      counts for the tabs and the overview
--   get_request_detail         one request with its history; every call is
--                              written to the audit log
--   change_request_status      manual status changes (see the transition list)
--   add_request_note           a note in the request's history
--   flag_request_attention     staff raise a safeguarding concern
--   acknowledge_request_attention  a named person records that it was reviewed
--
-- Approved, In Progress and Fulfilled cannot be set here. They arrive in
-- Milestone 5, where approval always reserves a resource in the same step.

-- ---------------------------------------------------------------------------
-- Status rules
-- ---------------------------------------------------------------------------

-- Keep in step with src/lib/request-transitions.json (a test compares them).
create function private.request_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('submitted', 'under_review'), ('submitted', 'declined'), ('submitted', 'cancelled'),
    ('under_review', 'awaiting_clarification'), ('under_review', 'awaiting_match'),
    ('under_review', 'declined'), ('under_review', 'cancelled'), ('under_review', 'unable_to_fulfil'),
    ('awaiting_clarification', 'under_review'), ('awaiting_clarification', 'declined'),
    ('awaiting_clarification', 'cancelled'),
    ('awaiting_match', 'under_review'), ('awaiting_match', 'declined'),
    ('awaiting_match', 'cancelled'), ('awaiting_match', 'unable_to_fulfil')
  );
$$;

create function private.request_status_needs_note(p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select p_to in ('awaiting_clarification', 'declined', 'cancelled', 'unable_to_fulfil');
$$;

create function private.request_status_is_closed(p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('fulfilled', 'declined', 'cancelled', 'unable_to_fulfil');
$$;

-- Locks the request and confirms the caller may work on it. "forbidden" is
-- raised for both "not found" and "another church", so nothing leaks.
create function private.lock_request_for_member(p_request_id uuid)
returns public.requests language plpgsql security definer set search_path = '' as $$
declare v_row public.requests%rowtype;
begin
  select * into v_row from public.requests r where r.id = p_request_id for update;
  if not found or not private.is_church_member(v_row.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create function public.list_requests(
  p_church_id uuid,
  p_status    text    default 'open',
  p_category  text    default null,
  p_channel   text    default null,
  p_search    text    default null,
  p_attention boolean default false,
  p_limit     integer default 25,
  p_offset    integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(upper(private.trim_all(coalesce(p_search, ''))), '');
  v_result jsonb;
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  with filtered as (
    select r.*
      from public.requests r
     where r.church_id = p_church_id
       and case coalesce(p_status, 'all')
             when 'all' then true
             when 'open' then not private.request_status_is_closed(r.status)
             when 'closed' then private.request_status_is_closed(r.status)
             else r.status = p_status
           end
       and (p_category is null or r.category_key = p_category)
       and (p_channel is null or r.channel = p_channel)
       and (v_search is null or position(v_search in r.reference) > 0)
       and (not coalesce(p_attention, false)
            or (r.attention_flag and r.attention_acknowledged_at is null))
  )
  select jsonb_build_object(
           'total', (select count(*) from filtered),
           'rows', coalesce((
             select jsonb_agg(row_data order by sort_at desc)
               from (
                 select f.created_at as sort_at,
                        jsonb_build_object(
                          'id', f.id,
                          'reference', f.reference,
                          'status', f.status,
                          'category_key', f.category_key,
                          'category_label', k.label,
                          'channel', f.channel,
                          'quantity_needed', f.quantity_needed,
                          'attention_open', f.attention_flag and f.attention_acknowledged_at is null,
                          'created_at', f.created_at) as row_data
                   from filtered f
                   join public.categories k on k.key = f.category_key
                  order by f.created_at desc
                  limit v_limit offset v_offset
               ) page
           ), '[]'::jsonb))
    into v_result;
  return v_result;
end $$;

create function public.request_status_counts(p_church_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'total', count(*),
           'open', count(*) filter (where not private.request_status_is_closed(r.status)),
           'closed', count(*) filter (where private.request_status_is_closed(r.status)),
           'attention_open', count(*) filter (where r.attention_flag and r.attention_acknowledged_at is null),
           'by_status', (select coalesce(jsonb_object_agg(g.status, g.n), '{}'::jsonb)
                           from (select q.status, count(*) as n from public.requests q
                                  where q.church_id = p_church_id group by q.status) g))
    into v_result
    from public.requests r
   where r.church_id = p_church_id;
  return v_result;
end $$;

-- Volatile on purpose: each call records who opened which request.
create function public.get_request_detail(p_request_id uuid)
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
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id,
               'event_type', e.event_type,
               'from_status', e.from_status,
               'to_status', e.to_status,
               'note', e.note,
               'created_at', e.created_at,
               'actor_email', u.email)
             order by e.created_at, e.id)
        from public.request_events e
        left join auth.users u on u.id = e.actor_user_id
       where e.request_id = v_row.id and e.church_id = v_row.church_id
    ), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Changing
-- ---------------------------------------------------------------------------

-- p_from_status is the status the person was looking at. If someone else has
-- changed the request since, the change is refused rather than overwritten.
create function public.change_request_status(
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
begin
  v_row := private.lock_request_for_member(p_request_id);

  if (select c.status from public.churches c where c.id = v_row.church_id) = 'suspended' then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from p_from_status then
    raise exception 'status_changed' using errcode = 'P0001';
  end if;
  if p_to_status in ('approved', 'in_progress', 'fulfilled') then
    raise exception 'requires_allocation' using errcode = 'P0001';
  end if;
  if not private.request_transition_allowed(v_row.status, p_to_status) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if private.request_status_needs_note(p_to_status) and (v_note is null or char_length(v_note) < 3) then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  update public.requests
     set status = p_to_status,
         outcome_reason = case when private.request_status_is_closed(p_to_status) then v_note else null end
   where id = v_row.id;

  insert into public.request_events (church_id, request_id, actor_user_id, event_type, from_status, to_status, note)
  values (v_row.church_id, v_row.id, v_uid, 'status_changed', v_row.status, p_to_status, v_note);

  return p_to_status;
end $$;

create function public.add_request_note(p_request_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row  public.requests%rowtype;
  v_note text := private.clean_text(p_note, 2000);
begin
  v_row := private.lock_request_for_member(p_request_id);
  if v_note is null then
    raise exception 'note_required' using errcode = 'P0001';
  end if;
  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note)
  values (v_row.church_id, v_row.id, (select auth.uid()), 'note_added', v_note);
end $$;

-- Raising a concern is never blocked by the request's status.
create function public.flag_request_attention(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row    public.requests%rowtype;
  v_reason text := private.clean_text(p_reason, 500);
begin
  v_row := private.lock_request_for_member(p_request_id);
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_row.attention_flag and v_row.attention_acknowledged_at is null then
    raise exception 'already_flagged' using errcode = 'P0001';
  end if;

  update public.requests
     set attention_flag = true,
         attention_source = 'staff',
         attention_reason = v_reason,
         attention_acknowledged_by = null,
         attention_acknowledged_at = null,
         attention_note = null
   where id = v_row.id;

  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note)
  values (v_row.church_id, v_row.id, (select auth.uid()), 'attention_flagged', v_reason);
end $$;

create function public.acknowledge_request_attention(p_request_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  public.requests%rowtype;
  v_note text := private.clean_text(p_note, 1000);
begin
  v_row := private.lock_request_for_member(p_request_id);
  if not v_row.attention_flag or v_row.attention_acknowledged_at is not null then
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'note_required' using errcode = 'P0001';
  end if;

  update public.requests
     set attention_acknowledged_by = v_uid,
         attention_acknowledged_at = now(),
         attention_note = v_note
   where id = v_row.id;

  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note)
  values (v_row.church_id, v_row.id, v_uid, 'attention_acknowledged', v_note);

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id)
  values (v_row.church_id, v_uid, 'request.attention_acknowledged', 'request', v_row.id);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.request_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function private.request_status_needs_note(text) from public, anon, authenticated;
revoke all on function private.request_status_is_closed(text) from public, anon, authenticated;
revoke all on function private.lock_request_for_member(uuid) from public, anon, authenticated;
revoke all on function public.list_requests(uuid, text, text, text, text, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.request_status_counts(uuid) from public, anon, authenticated;
revoke all on function public.get_request_detail(uuid) from public, anon, authenticated;
revoke all on function public.change_request_status(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.add_request_note(uuid, text) from public, anon, authenticated;
revoke all on function public.flag_request_attention(uuid, text) from public, anon, authenticated;
revoke all on function public.acknowledge_request_attention(uuid, text) from public, anon, authenticated;

grant execute on function public.list_requests(uuid, text, text, text, text, boolean, integer, integer) to authenticated;
grant execute on function public.request_status_counts(uuid) to authenticated;
grant execute on function public.get_request_detail(uuid) to authenticated;
grant execute on function public.change_request_status(uuid, text, text, text) to authenticated;
grant execute on function public.add_request_note(uuid, text) to authenticated;
grant execute on function public.flag_request_attention(uuid, text) to authenticated;
grant execute on function public.acknowledge_request_attention(uuid, text) to authenticated;
