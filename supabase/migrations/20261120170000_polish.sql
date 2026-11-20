-- MERCYMAP · Milestone 9 · Two fixes carried forward from Milestone 2
--
-- 1. A platform administrator may not change the status of a church they
--    belong to (verify, suspend or reset). Someone else must review it.
-- 2. A signed-in person who has been invited to a church can see that
--    invitation on "Register your church", so they open it instead of
--    registering a second church by mistake. Only church name, role and
--    expiry are shown, and only for invitations to their own email address.

create or replace function public.set_church_status(p_church_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_old text;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('pending', 'verified', 'suspended') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  -- Conflict of interest: any membership, active or suspended, counts.
  if exists (select 1 from public.church_memberships m where m.church_id = p_church_id and m.user_id = v_uid) then
    raise exception 'own_church' using errcode = 'P0001';
  end if;

  select c.status into v_old from public.churches c where c.id = p_church_id for update;
  if not found then
    raise exception 'church_not_found' using errcode = 'P0001';
  end if;

  update public.churches
     set status = p_status,
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         verified_by = case when p_status = 'verified' then v_uid else verified_by end
   where id = p_church_id;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_church_id, v_uid, 'church.status_changed', 'church', p_church_id,
          jsonb_build_object('from', v_old, 'to', p_status));
end $$;

-- Adds is_member so the page can say why there is no button.
drop function public.platform_list_churches();
create function public.platform_list_churches()
returns table (id uuid, name text, slug text, status text, area text,
               owner_email text, created_at timestamptz, verified_at timestamptz, is_member boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return query
    select c.id, c.name, c.slug, c.status, c.area, u.email::text, c.created_at, c.verified_at,
           exists (select 1 from public.church_memberships m where m.church_id = c.id and m.user_id = (select auth.uid()))
      from public.churches c
      left join auth.users u on u.id = c.created_by
     order by case c.status when 'pending' then 0 when 'verified' then 1 else 2 end, c.created_at desc;
end $$;
revoke all on function public.platform_list_churches() from public, anon, authenticated;
grant execute on function public.platform_list_churches() to authenticated;

-- Live (not accepted, not expired) invitations for the signed-in person's
-- own email address. The token is never returned: they still need the link.
create function public.my_pending_invitations()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'church_name', c.name, 'role', i.role, 'expires_at', i.expires_at)
           order by i.created_at desc), '[]'::jsonb)
    from public.invitations i
    join public.churches c on c.id = i.church_id
    join auth.users u on u.id = (select auth.uid())
   where i.email = lower(u.email)
     and i.accepted_at is null
     and i.expires_at > now()
     and c.status <> 'suspended'
     and not exists (select 1 from public.church_memberships m where m.church_id = i.church_id and m.user_id = u.id);
$$;
revoke all on function public.my_pending_invitations() from public, anon, authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
