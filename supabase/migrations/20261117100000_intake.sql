-- MERCYMAP · Milestone 3 · Public and staff-assisted request intake
--
-- Both intake channels write through SECURITY DEFINER functions so that every
-- request gets the same validation and an initial history event.
--
--   get_public_intake      service role only: what a public request page shows
--   submit_public_request  service role only: the public form, with rate limits
--   staff_submit_request   signed-in staff: a request recorded on someone's behalf
--
-- The anonymous role still has no privileges anywhere. The public page talks
-- to the app's server, and the server alone holds the secret key.

-- ---------------------------------------------------------------------------
-- Staff no longer insert requests directly; they use staff_submit_request.
-- ---------------------------------------------------------------------------

drop policy if exists requests_staff_create on public.requests;
revoke insert on public.requests from authenticated;

-- ---------------------------------------------------------------------------
-- Shared field clean-up and validation
-- ---------------------------------------------------------------------------

-- Trims spaces, tabs and line breaks (plain btrim only removes spaces).
create function private.trim_all(p_value text)
returns text language sql immutable set search_path = '' as $$
  select btrim(p_value, E' \t\r\n\f\v');
$$;

create function private.clean_text(p_value text, p_max integer)
returns text language sql immutable set search_path = '' as $$
  select case
           when p_value is null or private.trim_all(p_value) = '' then null
           else left(private.trim_all(p_value), p_max)
         end;
$$;

-- Inserts one request plus its "submitted" event. Callers authorise first.
create function private.insert_request(
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
  v_text   text := private.trim_all(coalesce(p_text, ''));
  v_method text := coalesce(nullif(private.trim_all(p_contact_method), ''), 'none');
  v_value  text := private.clean_text(p_contact_value, 120);
  v_row    public.requests%rowtype;
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
    v_value := null; -- no number is kept unless it will be used
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

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Public page
-- ---------------------------------------------------------------------------

-- Only verified churches have a public page. Returns null otherwise, so the
-- page cannot be used to discover pending or suspended churches.
create function public.get_public_intake(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'church', jsonb_build_object(
             'name', c.name,
             'slug', c.slug,
             'area', c.area,
             'contact_phone', c.contact_phone,
             'emergency_guidance', c.emergency_guidance),
           'categories', (
             select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label) order by k.sort_order), '[]'::jsonb)
               from public.categories k where k.is_active))
    from public.churches c
   where c.slug = lower(btrim(p_slug)) and c.status = 'verified';
$$;

create function public.submit_public_request(
  p_slug           text,
  p_ip_hash        text,
  p_category       text,
  p_text           text,
  p_quantity       integer,
  p_name           text,
  p_contact_method text,
  p_contact_value  text,
  p_area           text
)
returns table (reference text, church_name text)
language plpgsql security definer set search_path = '' as $$
declare
  -- Limits for one network address (hashed) and for one church.
  c_per_ip_per_church_per_hour constant integer := 5;
  c_per_ip_per_hour            constant integer := 15;
  c_per_church_per_day         constant integer := 300;
  v_church  public.churches%rowtype;
  v_window  timestamptz := date_trunc('hour', now());
  v_hits    integer;
  v_total   integer;
  v_row     public.requests%rowtype;
begin
  if p_ip_hash is null or char_length(p_ip_hash) not between 32 and 128 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  select * into v_church from public.churches c
   where c.slug = lower(btrim(p_slug)) and c.status = 'verified';
  if not found then
    raise exception 'intake_unavailable' using errcode = 'P0001';
  end if;

  -- Housekeeping: counters older than two days are no longer needed.
  delete from public.intake_rate_limits where window_start < now() - interval '2 days';

  insert into public.intake_rate_limits as r (ip_hash, church_id, window_start, hits)
  values (p_ip_hash, v_church.id, v_window, 1)
  on conflict (ip_hash, church_id, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  select coalesce(sum(r.hits), 0) into v_total
    from public.intake_rate_limits r
   where r.ip_hash = p_ip_hash and r.window_start = v_window;

  if v_hits > c_per_ip_per_church_per_hour or v_total > c_per_ip_per_hour then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if (select count(*) from public.requests q
       where q.church_id = v_church.id and q.channel = 'public'
         and q.created_at > now() - interval '1 day') >= c_per_church_per_day then
    raise exception 'church_daily_limit' using errcode = 'P0001';
  end if;

  v_row := private.insert_request(v_church.id, 'public', null, p_category, p_text, p_quantity,
                                  p_name, p_contact_method, p_contact_value, p_area);

  return query select v_row.reference, v_church.name;
end $$;

-- ---------------------------------------------------------------------------
-- Staff-assisted intake
-- ---------------------------------------------------------------------------

create function public.staff_submit_request(
  p_church_id      uuid,
  p_category       text,
  p_text           text,
  p_quantity       integer,
  p_name           text,
  p_contact_method text,
  p_contact_value  text,
  p_area           text
)
returns table (id uuid, reference text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.requests%rowtype;
begin
  if v_uid is null or not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if (select c.status from public.churches c where c.id = p_church_id) = 'suspended' then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;

  v_row := private.insert_request(p_church_id, 'staff', v_uid, p_category, p_text, p_quantity,
                                  p_name, p_contact_method, p_contact_value, p_area);

  return query select v_row.id, v_row.reference;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.trim_all(text) from public, anon, authenticated;
revoke all on function private.clean_text(text, integer) from public, anon, authenticated;
revoke all on function private.insert_request(uuid, text, uuid, text, text, integer, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_public_intake(text) from public, anon, authenticated;
revoke all on function public.submit_public_request(text, text, text, text, integer, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.staff_submit_request(uuid, text, text, integer, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.get_public_intake(text) to service_role;
grant execute on function public.submit_public_request(text, text, text, text, integer, text, text, text, text)
  to service_role;
grant execute on function public.staff_submit_request(uuid, text, text, integer, text, text, text, text)
  to authenticated;
