-- MERCYMAP · Milestone 6 · AI analysis (assistive only)
--
-- The AI reads a request and suggests: a short summary, key facts, missing
-- information, a kind of help, a possible safeguarding concern and, when the
-- request is awaiting a resource, which fitting resource to consider.
--
-- What the AI may change on its own: nothing except raising the "needs
-- attention" flag on a request that has never been flagged. Only a person can
-- acknowledge (clear) that flag. The AI never changes a status, approves,
-- reserves stock, or declines anyone.
--
-- The app's server runs the analysis with the secret key (service role):
--   ai_claim               service role: take a request for analysis and
--                          return the minimum it needs
--   ai_save                service role: store the result (or the failure)
-- Signed-in staff:
--   ai_request_rerun       check a member may ask for a fresh analysis
--   apply_ai_category      accept the suggested kind of help
--
-- A keyword check for safeguarding runs inside the database on every new
-- request, so it works even when the AI is switched off or failing.

alter table public.requests add column ai_claimed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Keyword safeguarding check
-- ---------------------------------------------------------------------------

-- Returns the first phrase found, or null. Whole words only, any case.
create function private.safeguarding_keyword(p_text text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_phrase text;
begin
  if p_text is null then
    return null;
  end if;
  foreach v_phrase in array array[
    'suicide', 'suicidal', 'kill myself', 'end my life', 'take my life', 'self-harm', 'self harm',
    'hurt myself', 'abuse', 'abused', 'abusing', 'rape', 'raped', 'molest', 'molested',
    'assault', 'assaulted', 'beats me', 'beating me', 'beat me', 'hits me', 'violence', 'violent',
    'threatened', 'threatening me', 'trafficked', 'trafficking', 'kidnap', 'kidnapped',
    'not safe at home', 'unsafe at home', 'forced marriage', 'child marriage', 'exploited', 'exploitation'
  ] loop
    if p_text ~* ('\m' || replace(v_phrase, '-', '\-') || '\M') then
      return v_phrase;
    end if;
  end loop;
  return null;
end $$;

-- Raises the flag only on a request that has never been flagged. Once a person
-- has acknowledged a flag, automatic checks do not raise it again; staff can.
create function private.raise_auto_attention(p_request_id uuid, p_source text, p_reason text)
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
  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note)
  values (v_row.church_id, v_row.id, null, 'attention_flagged', left(p_reason, 500));
  return true;
end $$;

-- Same as Milestone 3, plus the keyword check after the "submitted" event.
create or replace function private.insert_request(
  p_church_id      uuid,
  p_channel        text,
  p_created_by     uuid,
  p_category       text,
  p_text           text,
  p_quantity       integer,
  p_name           text,
  p_contact_method text,
  p_contact_value  text,
  p_area           text
)
returns public.requests
language plpgsql security definer set search_path = '' as $$
declare
  v_text    text := private.trim_all(coalesce(p_text, ''));
  v_method  text := coalesce(nullif(private.trim_all(p_contact_method), ''), 'none');
  v_value   text := private.clean_text(p_contact_value, 120);
  v_row     public.requests%rowtype;
  v_keyword text;
begin
  if not exists (select 1 from public.categories c where c.key = p_category and c.is_active) then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;
  if char_length(v_text) < 10 or char_length(v_text) > 5000 then
    raise exception 'invalid_description' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;
  if v_method not in ('phone_call', 'sms', 'in_person', 'none') then
    raise exception 'invalid_contact_method' using errcode = 'P0001';
  end if;
  if v_method in ('phone_call', 'sms') then
    if v_value is null or v_value !~ '^\+?[0-9(][0-9 ()-]{5,24}$'
       or char_length(regexp_replace(v_value, '[^0-9]', '', 'g')) not between 7 and 15 then
      raise exception 'invalid_phone' using errcode = 'P0001';
    end if;
  else
    v_value := null;
  end if;

  insert into public.requests (
    church_id, channel, created_by, category_key, language, input_method, original_text,
    quantity_needed, requester_name, contact_method, contact_value, area, consent_given_at
  ) values (
    p_church_id, p_channel, p_created_by, p_category, 'en', 'text', v_text,
    p_quantity, private.clean_text(p_name, 120), v_method, v_value,
    private.clean_text(p_area, 120), now()
  )
  returning * into v_row;

  insert into public.request_events (church_id, request_id, actor_user_id, event_type, to_status, note)
  values (v_row.church_id, v_row.id, p_created_by, 'submitted', 'submitted',
          case when p_channel = 'staff' then 'Recorded by staff on the person''s behalf'
               else 'Submitted through the public request page' end);

  v_keyword := private.safeguarding_keyword(v_text);
  if v_keyword is not null then
    perform private.raise_auto_attention(
      v_row.id, 'keyword',
      format('Keyword check: the request mentions "%s". A person should review it.', v_keyword));
    select * into v_row from public.requests r where r.id = v_row.id;
  end if;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Running an analysis (service role only)
-- ---------------------------------------------------------------------------

-- Takes a request for analysis and returns only what the AI may see, plus the
-- name and contact value so the server can remove them from the description if
-- the person typed them there. Those two are never sent to the AI.
--
-- Automatic runs: up to 3 attempts. Runs asked for by staff (p_force): up to
-- 10 attempts in total per request. A run left "processing" for 2 minutes is
-- treated as abandoned.
create function public.ai_claim(p_reference text, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_auto_attempts  constant integer := 3;
  c_total_attempts constant integer := 10;
  v_row     public.requests%rowtype;
  v_church  public.churches%rowtype;
  v_stale   boolean;
  v_options jsonb := '[]'::jsonb;
begin
  select * into v_row from public.requests r where r.reference = upper(btrim(p_reference)) for update;
  if not found then
    return null;
  end if;
  select * into v_church from public.churches c where c.id = v_row.church_id;
  if v_church.status = 'suspended' or v_row.anonymized_at is not null then
    return null;
  end if;

  v_stale := v_row.ai_status = 'processing'
             and (v_row.ai_claimed_at is null or v_row.ai_claimed_at < now() - interval '2 minutes');
  if v_row.ai_status = 'processing' and not v_stale then
    return null;
  end if;
  if coalesce(p_force, false) then
    if v_row.ai_attempts >= c_total_attempts then
      return null;
    end if;
  elsif not (v_row.ai_status in ('pending', 'failed') or v_stale) or v_row.ai_attempts >= c_auto_attempts then
    return null;
  end if;

  update public.requests
     set ai_status = 'processing', ai_attempts = ai_attempts + 1, ai_claimed_at = now()
   where id = v_row.id;

  -- Fitting resources, described without names: the server numbers them and
  -- maps the AI's choice back to an id.
  if v_row.status = 'awaiting_match' then
    select coalesce(jsonb_agg(o.item order by o.valid_until nulls last, o.available desc, o.id), '[]'::jsonb)
      into v_options
      from (
        select r.id, r.valid_until, a.available,
               jsonb_build_object(
                 'resource_id', r.id, 'unit', r.unit, 'available', a.available,
                 'source_type', r.source_type,
                 'coverage', private.resource_coverage(r.coverage_areas, v_row.area),
                 'valid_until', r.valid_until) as item
          from public.resources r
          cross join lateral (select private.resource_available(r.id) as available) a
         where r.church_id = v_row.church_id
           and r.category_key = v_row.category_key
           and r.status = 'active'
           and private.resource_mismatch(r, v_row, a.available) is null
         limit 10
      ) o;
  end if;

  return jsonb_build_object(
    'request_id', v_row.id,
    'description', v_row.original_text,
    'category_key', v_row.category_key,
    'quantity', v_row.quantity_needed,
    'area', v_row.area,
    'status', v_row.status,
    'categories', (select jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label) order by k.sort_order)
                     from public.categories k where k.is_active),
    'resource_options', v_options,
    'redact', jsonb_build_object('name', v_row.requester_name, 'contact', v_row.contact_value));
end $$;

-- Stores one result. The output has already been checked by the server; the
-- database checks again that the suggested kind of help exists and that a
-- suggested resource belongs to this church and still fits, and drops either
-- if not. A safeguarding concern raises the flag if the request was never
-- flagged before.
create function public.ai_save(
  p_request_id     uuid,
  p_ok             boolean,
  p_output         jsonb,
  p_error          text,
  p_provider       text,
  p_model          text,
  p_prompt_version text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row      public.requests%rowtype;
  v_output   jsonb := p_output;
  v_resource public.resources%rowtype;
  v_id       uuid;
  v_reason   text;
begin
  select * into v_row from public.requests r where r.id = p_request_id for update;
  if not found or v_row.ai_status <> 'processing' then
    raise exception 'not_claimed' using errcode = 'P0001';
  end if;

  if p_ok then
    if v_output is null or jsonb_typeof(v_output) <> 'object' or jsonb_typeof(v_output -> 'summary') <> 'string' then
      raise exception 'invalid_output' using errcode = 'P0001';
    end if;
    if v_output ->> 'suggested_category' is not null
       and (not exists (select 1 from public.categories k
                         where k.key = v_output ->> 'suggested_category' and k.is_active)
            or v_output ->> 'suggested_category' = v_row.category_key) then
      v_output := jsonb_set(v_output, '{suggested_category}', 'null'::jsonb);
    end if;
    if v_output -> 'resource' ->> 'resource_id' is not null then
      select * into v_resource from public.resources r
       where r.id = (v_output -> 'resource' ->> 'resource_id')::uuid and r.church_id = v_row.church_id;
      if not found or v_row.status <> 'awaiting_match'
         or private.resource_mismatch(v_resource, v_row, private.resource_available(v_resource.id)) is not null then
        v_output := jsonb_set(v_output, '{resource}', 'null'::jsonb);
      end if;
    end if;
  end if;

  insert into public.ai_analyses (church_id, request_id, status, output, error, provider, model, prompt_version)
  values (v_row.church_id, v_row.id, case when p_ok then 'done' else 'failed' end,
          case when p_ok then v_output end, left(p_error, 1000), p_provider, p_model, p_prompt_version)
  returning id into v_id;

  update public.requests set ai_status = case when p_ok then 'done' else 'failed' end where id = v_row.id;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_row.church_id, null, case when p_ok then 'request.ai_analysed' else 'request.ai_failed' end,
          'request', v_row.id, jsonb_build_object('analysis_id', v_id, 'model', p_model, 'prompt_version', p_prompt_version));

  if p_ok and coalesce((v_output -> 'safeguarding' ->> 'concern')::boolean, false) then
    v_reason := 'AI check: ' || coalesce(nullif(private.trim_all(v_output -> 'safeguarding' ->> 'reason'), ''),
                                         'possible safeguarding concern') || ' A person should review it.';
    perform private.raise_auto_attention(v_row.id, 'ai', v_reason);
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Staff actions
-- ---------------------------------------------------------------------------

-- Checks that the signed-in member may ask for a fresh analysis. The server
-- then runs it with the secret key. Recorded in the audit log.
create function public.ai_request_rerun(p_request_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.requests%rowtype;
begin
  select * into v_row from public.requests r where r.id = p_request_id;
  if not found or not private.is_church_member(v_row.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.churches c where c.id = v_row.church_id and c.status = 'suspended') then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_row.ai_attempts >= 10 then
    raise exception 'ai_limit_reached' using errcode = 'P0001';
  end if;
  if v_row.ai_status = 'processing' and v_row.ai_claimed_at > now() - interval '2 minutes' then
    raise exception 'ai_running' using errcode = 'P0001';
  end if;
  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id)
  values (v_row.church_id, v_uid, 'request.ai_rerun_requested', 'request', v_row.id);
  return v_row.reference;
end $$;

-- Accepts the latest analysis's suggested kind of help. Not allowed once stock
-- is reserved or the request is closed, because the reservation was made for
-- the current kind. p_from_category guards against a stale page.
create function public.apply_ai_category(p_request_id uuid, p_from_category text, p_analysis_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_row       public.requests%rowtype;
  v_analysis  public.ai_analyses%rowtype;
  v_suggested text;
  v_from      text;
  v_to        text;
begin
  select * into v_row from public.requests r where r.id = p_request_id for update;
  if not found or not private.is_church_member(v_row.church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.churches c where c.id = v_row.church_id and c.status = 'suspended') then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  if v_row.category_key is distinct from p_from_category then
    raise exception 'category_changed' using errcode = 'P0001';
  end if;
  if v_row.status not in ('submitted', 'under_review', 'awaiting_clarification', 'awaiting_match') then
    raise exception 'category_locked' using errcode = 'P0001';
  end if;

  select * into v_analysis from public.ai_analyses a
   where a.request_id = v_row.id and a.church_id = v_row.church_id and a.status = 'done'
   order by a.created_at desc, a.id desc limit 1;
  if not found or v_analysis.id is distinct from p_analysis_id then
    raise exception 'suggestion_changed' using errcode = 'P0001';
  end if;
  v_suggested := v_analysis.output ->> 'suggested_category';
  if v_suggested is null or v_suggested = v_row.category_key
     or not exists (select 1 from public.categories k where k.key = v_suggested and k.is_active) then
    raise exception 'no_suggestion' using errcode = 'P0001';
  end if;

  select k.label into v_from from public.categories k where k.key = v_row.category_key;
  select k.label into v_to from public.categories k where k.key = v_suggested;

  update public.requests set category_key = v_suggested where id = v_row.id;
  insert into public.request_events (church_id, request_id, actor_user_id, event_type, note)
  values (v_row.church_id, v_row.id, v_uid, 'category_changed',
          format('Kind of help changed from %s to %s (AI suggestion accepted).', v_from, v_to));
  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_row.church_id, v_uid, 'request.category_changed', 'request', v_row.id,
          jsonb_build_object('from', v_row.category_key, 'to', v_suggested, 'source', 'ai',
                             'analysis_id', v_analysis.id));
  return v_suggested;
end $$;

-- Marks an allocation as AI-recommended when staff reserve the resource the
-- latest analysis suggested. Used later for reporting; it changes nothing else.
create function private.mark_ai_recommended()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.ai_recommended := exists (
    select 1 from (
      select a.output from public.ai_analyses a
       where a.request_id = new.request_id and a.church_id = new.church_id and a.status = 'done'
       order by a.created_at desc, a.id desc limit 1) latest
     where latest.output -> 'resource' ->> 'resource_id' = new.resource_id::text);
  return new;
end $$;

create trigger allocations_mark_ai_recommended
  before insert on public.allocations
  for each row execute function private.mark_ai_recommended();

-- ---------------------------------------------------------------------------
-- Request detail: adds the latest analysis
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

revoke all on function private.safeguarding_keyword(text) from public, anon, authenticated;
revoke all on function private.raise_auto_attention(uuid, text, text) from public, anon, authenticated;
revoke all on function private.mark_ai_recommended() from public, anon, authenticated;
revoke all on function public.ai_claim(text, boolean) from public, anon, authenticated;
revoke all on function public.ai_save(uuid, boolean, jsonb, text, text, text, text) from public, anon, authenticated;
revoke all on function public.ai_request_rerun(uuid) from public, anon, authenticated;
revoke all on function public.apply_ai_category(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.ai_claim(text, boolean) to service_role;
grant execute on function public.ai_save(uuid, boolean, jsonb, text, text, text, text) to service_role;
grant execute on function public.ai_request_rerun(uuid) to authenticated;
grant execute on function public.apply_ai_category(uuid, text, uuid) to authenticated;
