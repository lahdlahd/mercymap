-- MERCYMAP · Milestone 2 · Church registration, staff invitations, platform verification
--
-- Everything here is a SECURITY DEFINER function that authorises the caller
-- itself. Nothing is granted to the anonymous role.

-- Only one open invitation per email address per church.
create unique index invitations_one_pending_per_email
  on public.invitations (church_id, email) where accepted_at is null;

-- ---------------------------------------------------------------------------
-- create_church: now also requires a confirmed email address
-- ---------------------------------------------------------------------------

create or replace function public.create_church(p_name text, p_slug text, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_church_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email_not_confirmed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.churches c where c.created_by = v_uid and c.status = 'pending') then
    raise exception 'pending_church_exists' using errcode = 'P0001';
  end if;

  insert into public.churches (name, slug, area, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), nullif(btrim(p_area), ''), v_uid)
  returning id into v_church_id;

  insert into public.church_memberships (church_id, user_id, role)
  values (v_church_id, v_uid, 'owner');

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id)
  values (v_church_id, v_uid, 'church.created', 'church', v_church_id);

  return v_church_id;
end $$;

-- ---------------------------------------------------------------------------
-- Staff directory (memberships joined to email addresses)
-- ---------------------------------------------------------------------------

create function public.list_church_members(p_church_id uuid)
returns table (membership_id uuid, user_id uuid, email text, role text, status text, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_church_member(p_church_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return query
    select m.id, m.user_id, u.email::text, m.role, m.status, m.created_at
      from public.church_memberships m
      join auth.users u on u.id = m.user_id
     where m.church_id = p_church_id
     order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations
--   The app generates a random token, stores only its SHA-256 hash, and shows
--   the raw token once inside the invitation link.
-- ---------------------------------------------------------------------------

create function private.hash_invitation_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- An invitation is honoured only while the person who issued it still has
-- the authority to issue it.
create function private.invitation_is_live(p_inv public.invitations)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_inv.accepted_at is null
     and p_inv.expires_at > now()
     and exists (
       select 1 from public.church_memberships m
        where m.church_id = p_inv.church_id and m.user_id = p_inv.invited_by and m.status = 'active'
          and (m.role = 'owner' or (m.role = 'admin' and p_inv.role = 'coordinator'))
     );
$$;

-- What a signed-in person sees before accepting. Knowing the token is what
-- entitles them to see the church name; nothing else is revealed.
create function public.preview_invitation(p_token text)
returns table (church_name text, role text, invited_email text, email_matches boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_inv from public.invitations i
   where i.token_hash = private.hash_invitation_token(p_token);
  if not found or not private.invitation_is_live(v_inv) then
    raise exception 'invitation_invalid_or_expired' using errcode = 'P0001';
  end if;
  return query
    select c.name, v_inv.role, v_inv.email,
           exists (select 1 from auth.users u where u.id = v_uid and lower(u.email) = v_inv.email)
      from public.churches c where c.id = v_inv.church_id;
end $$;

create function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Lock the invitation so it can be used exactly once.
  select * into v_inv from public.invitations i
   where i.token_hash = private.hash_invitation_token(p_token)
   for update;
  if not found or not private.invitation_is_live(v_inv) then
    raise exception 'invitation_invalid_or_expired' using errcode = 'P0001';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
    from auth.users u where u.id = v_uid;
  if v_confirmed is null then
    raise exception 'email_not_confirmed' using errcode = 'P0001';
  end if;
  if v_email is distinct from v_inv.email then
    raise exception 'invitation_email_mismatch' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.church_memberships m
              where m.church_id = v_inv.church_id and m.user_id = v_uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.church_memberships (church_id, user_id, role, invited_by)
  values (v_inv.church_id, v_uid, v_inv.role, v_inv.invited_by);

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_inv.church_id, v_uid, 'invitation.accepted', 'invitation', v_inv.id,
          jsonb_build_object('role', v_inv.role));

  return v_inv.church_id;
end $$;

-- ---------------------------------------------------------------------------
-- Platform administration
-- ---------------------------------------------------------------------------

create function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin();
$$;

create function public.platform_list_churches()
returns table (id uuid, name text, slug text, status text, area text,
               owner_email text, created_at timestamptz, verified_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return query
    select c.id, c.name, c.slug, c.status, c.area, u.email::text, c.created_at, c.verified_at
      from public.churches c
      left join auth.users u on u.id = c.created_by
     order by case c.status when 'pending' then 0 when 'verified' then 1 else 2 end, c.created_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: signed-in staff only
-- ---------------------------------------------------------------------------

revoke all on function public.list_church_members(uuid)   from public, anon, authenticated;
revoke all on function public.preview_invitation(text)    from public, anon, authenticated;
revoke all on function public.accept_invitation(text)     from public, anon, authenticated;
revoke all on function public.is_platform_admin()         from public, anon, authenticated;
revoke all on function public.platform_list_churches()    from public, anon, authenticated;
revoke all on function private.hash_invitation_token(text)          from public, anon, authenticated;
revoke all on function private.invitation_is_live(public.invitations) from public, anon, authenticated;

grant execute on function public.list_church_members(uuid) to authenticated;
grant execute on function public.preview_invitation(text)  to authenticated;
grant execute on function public.accept_invitation(text)   to authenticated;
grant execute on function public.is_platform_admin()       to authenticated;
grant execute on function public.platform_list_churches()  to authenticated;
