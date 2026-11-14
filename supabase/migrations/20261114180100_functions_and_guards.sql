-- MERCYMAP · Milestone 1 · Helper functions, integrity guards, staff management
--
-- Conventions
--   * private.*  : helpers used by RLS policies and triggers; not exposed over the API.
--   * public.*   : callable by signed-in staff. Each one is SECURITY DEFINER and
--                  performs its own authorisation check before doing anything.
--   * Every function pins search_path to '' and uses fully qualified names.

-- ---------------------------------------------------------------------------
-- Membership helpers (used by RLS)
-- ---------------------------------------------------------------------------

create function private.is_church_member(p_church_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.church_memberships m
    where m.church_id = p_church_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create function private.has_church_role(p_church_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.church_memberships m
    where m.church_id = p_church_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

create function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins a where a.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function private.prevent_church_id_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.church_id is distinct from old.church_id then
    raise exception 'church_id_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

create function private.forbid_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'append_only: % rows cannot be changed or deleted', tg_table_name
    using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  foreach t in array array['churches','church_memberships','requests','resources','volunteers','assignments'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['church_memberships','invitations','requests','ai_analyses','request_events',
                           'resources','allocations','volunteers','assignments','notifications','audit_logs'] loop
    execute format('create trigger prevent_church_id_change before update on public.%I
                    for each row execute function private.prevent_church_id_change()', t);
  end loop;
  foreach t in array array['request_events','audit_logs'] loop
    execute format('create trigger append_only before update or delete on public.%I
                    for each row execute function private.forbid_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- A church must always keep at least one active owner
-- ---------------------------------------------------------------------------

create function private.protect_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    -- Serialise concurrent owner changes for this church.
    perform 1 from public.churches c where c.id = old.church_id for update;
    if not exists (
      select 1 from public.church_memberships m
      where m.church_id = old.church_id and m.id <> old.id
        and m.role = 'owner' and m.status = 'active'
    ) then
      raise exception 'last_owner_required' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger protect_last_owner before update or delete on public.church_memberships
  for each row execute function private.protect_last_owner();

-- ---------------------------------------------------------------------------
-- Inventory integrity
--   available = total_quantity - reserved - fulfilled
-- These triggers hold the invariant no matter which code path writes the row.
-- ---------------------------------------------------------------------------

create function private.guard_allocation()
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

  -- Lock the resource row so concurrent approvals queue up here.
  select * into v_resource from public.resources r
   where r.id = new.resource_id and r.church_id = new.church_id
   for update;
  if not found then
    raise exception 'resource_not_found' using errcode = 'P0001';
  end if;
  if v_resource.status <> 'active' then
    raise exception 'resource_not_active' using errcode = 'P0001';
  end if;
  if (v_resource.valid_from is not null and current_date < v_resource.valid_from)
     or (v_resource.valid_until is not null and current_date > v_resource.valid_until) then
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

create trigger guard_allocation before insert or update on public.allocations
  for each row execute function private.guard_allocation();

-- Allocations are history; they are released, never deleted.
create trigger no_delete before delete on public.allocations
  for each row execute function private.forbid_change();

create function private.guard_resource_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_committed integer;
begin
  if new.total_quantity < old.total_quantity then
    select coalesce(sum(a.quantity), 0) into v_committed
      from public.allocations a
     where a.resource_id = new.id and a.status in ('reserved', 'fulfilled');
    if new.total_quantity < v_committed then
      raise exception 'total_below_committed_quantity' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger guard_resource_total before update of total_quantity on public.resources
  for each row execute function private.guard_resource_total();

-- Quantities are always computed from allocations, never stored.
create view public.resource_availability with (security_invoker = true) as
select r.id as resource_id,
       r.church_id,
       r.total_quantity,
       coalesce(sum(a.quantity) filter (where a.status = 'reserved'), 0)::integer  as reserved_quantity,
       coalesce(sum(a.quantity) filter (where a.status = 'fulfilled'), 0)::integer as distributed_quantity,
       (r.total_quantity
         - coalesce(sum(a.quantity) filter (where a.status in ('reserved', 'fulfilled')), 0))::integer
         as available_quantity
  from public.resources r
  left join public.allocations a on a.resource_id = r.id and a.church_id = r.church_id
 group by r.id;

-- ---------------------------------------------------------------------------
-- Staff-callable functions
-- ---------------------------------------------------------------------------

-- Registers a church (status 'pending') and makes the caller its owner.
create function public.create_church(p_name text, p_slug text, p_area text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_church_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
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

-- Only an owner may change roles, and never their own.
create function public.set_member_role(p_membership_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_target public.church_memberships%rowtype;
begin
  select * into v_target from public.church_memberships m where m.id = p_membership_id;
  -- Same error for "not found" and "not yours" so nothing leaks across churches.
  if not found or not private.has_church_role(v_target.church_id, array['owner']) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_target.user_id = v_uid then
    raise exception 'cannot_change_own_role' using errcode = 'P0001';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'coordinator') then
    raise exception 'invalid_role' using errcode = 'P0001';
  end if;

  update public.church_memberships set role = p_role where id = p_membership_id;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_target.church_id, v_uid, 'member.role_changed', 'church_membership', p_membership_id,
          jsonb_build_object('from', v_target.role, 'to', p_role));
end $$;

-- Owners may remove anyone else; admins may remove coordinators only.
create function public.remove_member(p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_target public.church_memberships%rowtype;
begin
  select * into v_target from public.church_memberships m where m.id = p_membership_id;
  if not found or not private.has_church_role(v_target.church_id, array['owner', 'admin']) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_target.user_id = v_uid then
    raise exception 'cannot_remove_self' using errcode = 'P0001';
  end if;
  if v_target.role <> 'coordinator'
     and not private.has_church_role(v_target.church_id, array['owner']) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  delete from public.church_memberships where id = p_membership_id;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_target.church_id, v_uid, 'member.removed', 'church_membership', p_membership_id,
          jsonb_build_object('role', v_target.role));
end $$;

-- Platform administrators activate (or suspend) a church's public intake.
create function public.set_church_status(p_church_id uuid, p_status text)
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
