-- MERCYMAP · Milestone 7 · Notifications and volunteer coordination
--
-- Notifications are in-app only and are created by the database itself, so
-- they also cover public requests. They carry only a reference and the kind of
-- help: never names, phone numbers, descriptions or safeguarding reasons.
--
--   new request        every active member except the person who recorded it
--   needs attention    every active member except the person who raised it
--   stock running low  owners, admins and the resource's responsible person,
--                      once, when available stock falls to 2 or fewer or below
--                      20% of the total; again only after it has recovered
--   task completed     the person who assigned the volunteer task
--
-- Volunteers never log in. Their phone number is kept only with their consent.
-- Writes to volunteers and assignments now go through checked functions that
-- write the audit log; direct table writes by staff are withdrawn.

alter table public.resources add column low_stock_notified_at timestamptz;

revoke insert, update on public.volunteers from authenticated;
revoke insert, update on public.assignments from authenticated;
drop policy volunteers_member_create on public.volunteers;
drop policy volunteers_member_update on public.volunteers;
drop policy assignments_member_create on public.assignments;
drop policy assignments_member_update on public.assignments;

-- History order: entries written in the same transaction shared one
-- timestamp (now()), so a request submitted and flagged in one step could show
-- the two entries in either order. Later entries now use the actual clock time.
create or replace function private.raise_auto_attention(p_request_id uuid, p_source text, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_row public.requests%rowtype;
begin
  select * into v_row from public.requests r where r.id = p_request_id for update;
  if not found or v_row.attention_flag or p_source not in ('ai', 'keyword') then
    return false;
  end if;
  update public.requests
     set attention_flag = true,
         attention_source = p_source,
         attention_reason = left(p_reason, 500),
         attention_acknowledged_by = null,
         attention_acknowledged_at = null,
         attention_note = null
   where id = v_row.id;
  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note, created_at)
  values (v_row.church_id, v_row.id, null, 'attention_flagged', left(p_reason, 500), clock_timestamp());
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create function private.notify(
  p_church_id  uuid,
  p_roles      text[],      -- null: every role
  p_extra      uuid[],      -- also notify these users if they are active members
  p_exclude    uuid,        -- never notify this user (the person who acted)
  p_type       text,
  p_request_id uuid,
  p_title      text,
  p_body       text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  insert into public.notifications (church_id, recipient_user_id, type, request_id, title, body)
  select m.church_id, m.user_id, p_type, p_request_id, left(p_title, 200), left(p_body, 500)
    from public.church_memberships m
   where m.church_id = p_church_id
     and m.status = 'active'
     and (p_roles is null or m.role = any (p_roles) or m.user_id = any (coalesce(p_extra, '{}')))
     and m.user_id is distinct from p_exclude;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function private.notify_new_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(
    new.church_id, null, null, new.created_by, 'new_request', new.id,
    'New request ' || new.reference,
    coalesce((select k.label from public.categories k where k.key = new.category_key), new.category_key)
      || case when new.channel = 'staff' then ' · recorded by staff' else ' · online form' end);
  return null;
end $$;

create trigger requests_notify_new
  after insert on public.requests
  for each row execute function private.notify_new_request();

create function private.notify_attention()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.attention_flag and new.attention_acknowledged_at is null
     and (not old.attention_flag or old.attention_acknowledged_at is not null) then
    perform private.notify(
      new.church_id, null, null,
      case when new.attention_source = 'staff' then (select auth.uid()) end,
      'needs_attention', new.id,
      'Needs attention: ' || new.reference,
      case new.attention_source
        when 'keyword' then 'Raised by the keyword check. A person should review it.'
        when 'ai' then 'Raised by the AI check. A person should review it.'
        else 'Raised by a staff member. A person should review it.' end);
  end if;
  return null;
end $$;

create trigger requests_notify_attention
  after update of attention_flag, attention_acknowledged_at on public.requests
  for each row execute function private.notify_attention();

-- Low stock: available <= 2, or under 20% of the total. Sent once; the marker
-- clears when stock recovers, so a later fall notifies again.
create function private.check_low_stock(p_resource_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_res       public.resources%rowtype;
  v_available integer;
  v_low       boolean;
begin
  select * into v_res from public.resources r where r.id = p_resource_id;
  if not found or v_res.status <> 'active' or v_res.total_quantity = 0 then
    return;
  end if;
  v_available := private.resource_available(v_res.id);
  v_low := v_available <= 2 or v_available * 5 < v_res.total_quantity;
  if v_low and v_res.low_stock_notified_at is null then
    update public.resources set low_stock_notified_at = now() where id = v_res.id;
    perform private.notify(
      v_res.church_id, array['owner', 'admin'],
      case when v_res.manager_user_id is not null then array[v_res.manager_user_id] end,
      null, 'low_stock', null,
      'Stock running low: ' || v_res.name,
      format('%s %s available of %s.', v_available, v_res.unit, v_res.total_quantity));
  elsif not v_low and v_res.low_stock_notified_at is not null then
    update public.resources set low_stock_notified_at = null where id = v_res.id;
  end if;
end $$;

create function private.low_stock_after_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_low_stock(new.resource_id);
  return null;
end $$;

create trigger allocations_check_low_stock
  after insert or update of status on public.allocations
  for each row execute function private.low_stock_after_allocation();

create function private.low_stock_after_resource()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_low_stock(new.id);
  return null;
end $$;

create trigger resources_check_low_stock
  after update of total_quantity, status on public.resources
  for each row execute function private.low_stock_after_resource();

-- The signed-in user's own notifications, newest first, for their current church.
create function public.list_notifications(p_church_id uuid, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications n
                where n.church_id = p_church_id and n.recipient_user_id = v_uid and n.read_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'type', x.type, 'request_id', x.request_id, 'title', x.title,
               'body', x.body, 'read_at', x.read_at, 'created_at', x.created_at)
             order by x.created_at desc, x.id desc)
        from (select n.* from public.notifications n
               where n.church_id = p_church_id and n.recipient_user_id = v_uid
               order by n.created_at desc, n.id desc
               limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb));
end $$;

create function public.unread_notification_count(p_church_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case when private.is_church_member(p_church_id) then
    (select count(*)::integer from public.notifications n
      where n.church_id = p_church_id and n.recipient_user_id = (select auth.uid()) and n.read_at is null)
  else 0 end;
$$;

-- Marks the given notifications (or all, when p_ids is null) as read. Only the
-- signed-in user's own.
create function public.mark_notifications_read(p_church_id uuid, p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update public.notifications n
     set read_at = now()
   where n.church_id = p_church_id
     and n.recipient_user_id = (select auth.uid())
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Volunteers
-- ---------------------------------------------------------------------------

create function public.save_volunteer(
  p_volunteer_id uuid,          -- null to add
  p_church_id    uuid,
  p_full_name    text,
  p_phone        text,
  p_skills       text[],
  p_availability text,
  p_consent      boolean,       -- the volunteer agreed to their phone number being kept
  p_status       text default 'active'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_name   text := private.clean_text(p_full_name, 200);
  v_phone  text := private.clean_text(p_phone, 60);
  v_notes  text := private.clean_text(p_availability, 1000);
  v_skills text[];
  v_old    public.volunteers%rowtype;
  v_id     uuid;
  v_action text;
begin
  if p_volunteer_id is not null then
    select * into v_old from public.volunteers v where v.id = p_volunteer_id for update;
    if not found or v_old.church_id is distinct from p_church_id then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
  end if;
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.churches c where c.id = p_church_id and c.status = 'suspended') then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if v_phone is not null then
    if v_phone !~ '^\+?[0-9(][0-9 ()-]{5,24}$'
       or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
      raise exception 'invalid_phone' using errcode = 'P0001';
    end if;
    if not coalesce(p_consent, false) then
      raise exception 'consent_required' using errcode = 'P0001';
    end if;
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'invalid_availability' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct s order by s), '{}') into v_skills
    from (select lower(private.clean_text(x, 80)) as s from unnest(coalesce(p_skills, '{}')) x) t
   where s is not null;
  if cardinality(v_skills) > 10 or exists (select 1 from unnest(v_skills) s where char_length(s) > 40) then
    raise exception 'invalid_skills' using errcode = 'P0001';
  end if;
  if coalesce(p_status, 'active') not in ('active', 'inactive') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  if p_volunteer_id is null then
    insert into public.volunteers (church_id, full_name, phone, skills, availability_notes, consent_given_at, status)
    values (p_church_id, v_name, v_phone, v_skills, v_notes,
            case when v_phone is not null then now() end, coalesce(p_status, 'active'))
    returning id into v_id;
    v_action := 'volunteer.created';
  else
    update public.volunteers
       set full_name = v_name, phone = v_phone, skills = v_skills, availability_notes = v_notes,
           consent_given_at = case when v_phone is null then null
                                   else coalesce(v_old.consent_given_at, now()) end,
           status = coalesce(p_status, 'active')
     where id = v_old.id
    returning id into v_id;
    v_action := case
      when v_old.status = 'active' and p_status = 'inactive' then 'volunteer.deactivated'
      when v_old.status = 'inactive' and p_status = 'active' then 'volunteer.reactivated'
      else 'volunteer.updated' end;
  end if;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id)
  values (p_church_id, v_uid, v_action, 'volunteer', v_id);
  return v_id;
end $$;

create function public.list_volunteers(p_church_id uuid, p_include_inactive boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'full_name', v.full_name, 'phone', v.phone, 'skills', v.skills,
             'availability_notes', v.availability_notes, 'consent_given_at', v.consent_given_at,
             'status', v.status, 'created_at', v.created_at,
             'open_tasks', (select count(*) from public.assignments a
                             where a.volunteer_id = v.id and a.church_id = v.church_id
                               and a.status in ('assigned', 'in_progress')),
             'completed_tasks', (select count(*) from public.assignments a
                                  where a.volunteer_id = v.id and a.church_id = v.church_id
                                    and a.status = 'completed'))
           order by v.status, lower(v.full_name), v.id)
      from public.volunteers v
     where v.church_id = p_church_id and (coalesce(p_include_inactive, false) or v.status = 'active')
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Volunteer tasks (assignments)
-- ---------------------------------------------------------------------------

-- A volunteer can be given a task once help is approved. p_from_status guards
-- against a stale page.
create function public.create_assignment(
  p_request_id   uuid,
  p_from_status  text,
  p_volunteer_id uuid,
  p_task_brief   text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_row   public.requests%rowtype;
  v_vol   public.volunteers%rowtype;
  v_brief text := private.trim_all(coalesce(p_task_brief, ''));
  v_id    uuid;
begin
  select * into v_row from public.requests r where r.id = p_request_id for update;
  if not found or not private.is_church_member(v_row.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.churches c where c.id = v_row.church_id and c.status = 'suspended') then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from p_from_status then
    raise exception 'status_changed' using errcode = 'P0001';
  end if;
  if v_row.status not in ('approved', 'in_progress') then
    raise exception 'not_approved' using errcode = 'P0001';
  end if;
  select * into v_vol from public.volunteers v
   where v.id = p_volunteer_id and v.church_id = v_row.church_id;
  if not found then
    raise exception 'volunteer_not_found' using errcode = 'P0001';
  end if;
  if v_vol.status <> 'active' then
    raise exception 'volunteer_inactive' using errcode = 'P0001';
  end if;
  if char_length(v_brief) < 1 or char_length(v_brief) > 2000 then
    raise exception 'invalid_brief' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.assignments a
              where a.request_id = v_row.id and a.volunteer_id = v_vol.id
                and a.status in ('assigned', 'in_progress')) then
    raise exception 'already_assigned' using errcode = 'P0001';
  end if;

  insert into public.assignments (church_id, volunteer_id, request_id, task_brief, assigned_by)
  values (v_row.church_id, v_vol.id, v_row.id, v_brief, v_uid)
  returning id into v_id;
  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note)
  values (v_row.church_id, v_row.id, v_uid, 'volunteer_assigned', 'Task given to ' || v_vol.full_name || '.');
  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_row.church_id, v_uid, 'assignment.created', 'assignment', v_id,
          jsonb_build_object('request_id', v_row.id, 'volunteer_id', v_vol.id));
  return v_id;
end $$;

-- assigned -> in_progress | completed | cancelled; in_progress -> completed | cancelled.
-- Completing a task does not fulfil the request; staff still record that.
create function public.update_assignment_status(p_assignment_id uuid, p_from_status text, p_to_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_a   public.assignments%rowtype;
  v_ref text;
  v_vol text;
begin
  select * into v_a from public.assignments a where a.id = p_assignment_id for update;
  if not found or not private.is_church_member(v_a.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.churches c where c.id = v_a.church_id and c.status = 'suspended') then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_a.status is distinct from p_from_status then
    raise exception 'status_changed' using errcode = 'P0001';
  end if;
  if not ((v_a.status = 'assigned' and p_to_status in ('in_progress', 'completed', 'cancelled'))
       or (v_a.status = 'in_progress' and p_to_status in ('completed', 'cancelled'))) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.assignments
     set status = p_to_status,
         completed_at = case when p_to_status = 'completed' then now() end
   where id = v_a.id;

  select r.reference into v_ref from public.requests r where r.id = v_a.request_id;
  select v.full_name into v_vol from public.volunteers v where v.id = v_a.volunteer_id;
  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note)
  values (v_a.church_id, v_a.request_id, v_uid, 'volunteer_task_updated',
          format('%s''s task: %s.', v_vol,
                 case p_to_status when 'in_progress' then 'started' when 'completed' then 'completed'
                                  else 'cancelled' end));
  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_a.church_id, v_uid, 'assignment.' || p_to_status, 'assignment', v_a.id,
          jsonb_build_object('request_id', v_a.request_id, 'from', v_a.status));

  if p_to_status = 'completed' and v_a.assigned_by is not null then
    perform private.notify(v_a.church_id, array[]::text[], array[v_a.assigned_by], v_uid,
                           'task_completed', v_a.request_id,
                           'Volunteer task completed: ' || v_ref,
                           'Record the delivery on the request when the help has been given.');
  end if;
end $$;

-- Declining, cancelling or closing a request as unable to fulfil cancels its
-- open volunteer tasks.
create function private.cancel_tasks_on_close()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if new.status in ('declined', 'cancelled', 'unable_to_fulfil') and old.status is distinct from new.status then
    update public.assignments a
       set status = 'cancelled', completed_at = null
     where a.request_id = new.id and a.church_id = new.church_id
       and a.status in ('assigned', 'in_progress');
    get diagnostics v_count = row_count;
    if v_count > 0 then
      insert into public.request_events (church_id, request_id, actor_user_id, event_type, note, created_at)
      values (new.church_id, new.id, (select auth.uid()), 'volunteer_task_updated',
              format('%s open volunteer %s cancelled because the request was closed.',
                     v_count, case when v_count = 1 then 'task' else 'tasks' end),
              clock_timestamp());
    end if;
  end if;
  return null;
end $$;

create trigger requests_cancel_tasks_on_close
  after update of status on public.requests
  for each row execute function private.cancel_tasks_on_close();

-- ---------------------------------------------------------------------------
-- Request detail: adds volunteer tasks
-- ---------------------------------------------------------------------------

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
               'released_at', a.released_at, 'release_reason', a.release_reason,
               'ai_recommended', a.ai_recommended)
        from public.allocations a
        join public.resources r on r.id = a.resource_id and r.church_id = a.church_id
        left join auth.users ua on ua.id = a.approved_by
        left join auth.users uf on uf.id = a.fulfilled_by
       where a.request_id = v_row.id and a.church_id = v_row.church_id
       order by a.created_at desc, a.id desc
       limit 1),
    'ai', jsonb_build_object(
      'status', v_row.ai_status,
      'can_rerun', v_row.ai_attempts < 10,
      'latest', (
        select jsonb_build_object(
                 'id', a.id, 'output', a.output, 'model', a.model, 'created_at', a.created_at,
                 'suggested_category_label',
                   (select k.label from public.categories k where k.key = a.output ->> 'suggested_category'),
                 'resource_name',
                   (select r.name from public.resources r
                     where r.church_id = v_row.church_id
                       and r.id::text = a.output -> 'resource' ->> 'resource_id'))
          from public.ai_analyses a
         where a.request_id = v_row.id and a.church_id = v_row.church_id and a.status = 'done'
         order by a.created_at desc, a.id desc
         limit 1)),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'status', a.status, 'task_brief', a.task_brief,
               'volunteer_id', v.id, 'volunteer_name', v.full_name, 'volunteer_phone', v.phone,
               'assigned_by_email', ub.email, 'created_at', a.created_at,
               'updated_at', a.updated_at, 'completed_at', a.completed_at)
             order by a.created_at desc, a.id desc)
        from public.assignments a
        join public.volunteers v on v.id = a.volunteer_id and v.church_id = a.church_id
        left join auth.users ub on ub.id = a.assigned_by
       where a.request_id = v_row.id and a.church_id = v_row.church_id
    ), '[]'::jsonb),
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
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.notify(uuid, text[], uuid[], uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function private.notify_new_request() from public, anon, authenticated;
revoke all on function private.notify_attention() from public, anon, authenticated;
revoke all on function private.check_low_stock(uuid) from public, anon, authenticated;
revoke all on function private.low_stock_after_allocation() from public, anon, authenticated;
revoke all on function private.low_stock_after_resource() from public, anon, authenticated;
revoke all on function private.cancel_tasks_on_close() from public, anon, authenticated;
revoke all on function public.list_notifications(uuid, integer) from public, anon, authenticated;
revoke all on function public.unread_notification_count(uuid) from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.save_volunteer(uuid, uuid, text, text, text[], text, boolean, text) from public, anon, authenticated;
revoke all on function public.list_volunteers(uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_assignment(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.update_assignment_status(uuid, text, text) from public, anon, authenticated;

grant execute on function public.list_notifications(uuid, integer) to authenticated;
grant execute on function public.unread_notification_count(uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid, uuid[]) to authenticated;
grant execute on function public.save_volunteer(uuid, uuid, text, text, text[], text, boolean, text) to authenticated;
grant execute on function public.list_volunteers(uuid, boolean) to authenticated;
grant execute on function public.create_assignment(uuid, text, uuid, text) to authenticated;
grant execute on function public.update_assignment_status(uuid, text, text) to authenticated;
