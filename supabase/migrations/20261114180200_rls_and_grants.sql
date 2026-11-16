-- MERCYMAP · Milestone 1 · Row Level Security and privileges
--
-- Rules
--   1. RLS is enabled on every table in public.
--   2. The anonymous role has no privileges and no policies anywhere. The public
--      intake page talks to a server endpoint, never to the database directly.
--   3. Signed-in staff get the narrowest table and column privileges that work,
--      and RLS then limits them to rows of a church they are an active member of.
--   4. Anything that changes workflow state (request status, allocations,
--      memberships, AI output, events, notifications, audit) has no direct
--      write path for staff; it goes through authorised functions.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.platform_admins     enable row level security;
alter table public.categories          enable row level security;
alter table public.churches            enable row level security;
alter table public.church_memberships  enable row level security;
alter table public.invitations         enable row level security;
alter table public.requests            enable row level security;
alter table public.ai_analyses         enable row level security;
alter table public.request_events      enable row level security;
alter table public.resources           enable row level security;
alter table public.allocations         enable row level security;
alter table public.volunteers          enable row level security;
alter table public.assignments         enable row level security;
alter table public.notifications       enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.intake_rate_limits  enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Start from zero privileges for API roles
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon;

-- Tables added by later migrations also start locked down.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.is_church_member(uuid)       to authenticated;
grant execute on function private.has_church_role(uuid, text[]) to authenticated;
grant execute on function private.is_platform_admin()           to authenticated;

grant execute on function public.create_church(text, text, text) to authenticated;
grant execute on function public.set_member_role(uuid, text)     to authenticated;
grant execute on function public.remove_member(uuid)             to authenticated;
grant execute on function public.set_church_status(uuid, text)   to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies and column-level privileges
--    platform_admins and intake_rate_limits deliberately have none.
-- ---------------------------------------------------------------------------

-- categories: shared lookup list, read-only
grant select on public.categories to authenticated;
create policy categories_read on public.categories
  for select to authenticated using (true);

-- churches: members read; owners and admins edit profile fields only.
-- slug, status and verification fields are not updatable by staff at all.
grant select on public.churches to authenticated;
grant update (name, area, contact_phone, contact_email, emergency_guidance)
  on public.churches to authenticated;
create policy churches_member_read on public.churches
  for select to authenticated using (private.is_church_member(id));
create policy churches_admin_update on public.churches
  for update to authenticated
  using (private.has_church_role(id, array['owner', 'admin']))
  with check (private.has_church_role(id, array['owner', 'admin']));

-- church_memberships: read-only; changes go through functions
grant select on public.church_memberships to authenticated;
create policy memberships_member_read on public.church_memberships
  for select to authenticated using (private.is_church_member(church_id));

-- invitations: owners and admins manage; token_hash is never readable
grant select (id, church_id, email, role, invited_by, expires_at, accepted_at, created_at)
  on public.invitations to authenticated;
grant insert (church_id, email, role, token_hash, invited_by, expires_at)
  on public.invitations to authenticated;
grant delete on public.invitations to authenticated;
create policy invitations_admin_read on public.invitations
  for select to authenticated
  using (private.has_church_role(church_id, array['owner', 'admin']));
create policy invitations_admin_create on public.invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (
      private.has_church_role(church_id, array['owner'])
      or (role = 'coordinator' and private.has_church_role(church_id, array['admin']))
    )
  );
create policy invitations_admin_revoke on public.invitations
  for delete to authenticated
  using (accepted_at is null and private.has_church_role(church_id, array['owner', 'admin']));

-- requests: members read; staff-assisted submissions only. Status, attention
-- and AI columns cannot be set on insert, and there is no direct update.
grant select on public.requests to authenticated;
grant insert (church_id, channel, created_by, category_key, input_method, original_text,
              quantity_needed, requester_name, contact_method, contact_value, area, consent_given_at)
  on public.requests to authenticated;
create policy requests_member_read on public.requests
  for select to authenticated using (private.is_church_member(church_id));
create policy requests_staff_create on public.requests
  for insert to authenticated
  with check (
    channel = 'staff'
    and created_by = (select auth.uid())
    and private.is_church_member(church_id)
  );

-- ai_analyses, request_events, allocations: read-only for members
grant select on public.ai_analyses to authenticated;
create policy ai_analyses_member_read on public.ai_analyses
  for select to authenticated using (private.is_church_member(church_id));

grant select on public.request_events to authenticated;
create policy request_events_member_read on public.request_events
  for select to authenticated using (private.is_church_member(church_id));

grant select on public.allocations to authenticated;
create policy allocations_member_read on public.allocations
  for select to authenticated using (private.is_church_member(church_id));

-- resources: members read, create and edit; archived, never deleted
grant select on public.resources to authenticated;
grant insert (church_id, name, category_key, description, unit, total_quantity, source_type,
              source_name, coverage_areas, valid_from, valid_until, manager_user_id)
  on public.resources to authenticated;
grant update (name, category_key, description, unit, total_quantity, source_type, source_name,
              coverage_areas, valid_from, valid_until, manager_user_id, status)
  on public.resources to authenticated;
create policy resources_member_read on public.resources
  for select to authenticated using (private.is_church_member(church_id));
create policy resources_member_create on public.resources
  for insert to authenticated with check (private.is_church_member(church_id));
create policy resources_member_update on public.resources
  for update to authenticated
  using (private.is_church_member(church_id))
  with check (private.is_church_member(church_id));
grant select on public.resource_availability to authenticated;

-- volunteers
grant select on public.volunteers to authenticated;
grant insert (church_id, full_name, phone, skills, availability_notes, consent_given_at)
  on public.volunteers to authenticated;
grant update (full_name, phone, skills, availability_notes, consent_given_at, status)
  on public.volunteers to authenticated;
create policy volunteers_member_read on public.volunteers
  for select to authenticated using (private.is_church_member(church_id));
create policy volunteers_member_create on public.volunteers
  for insert to authenticated with check (private.is_church_member(church_id));
create policy volunteers_member_update on public.volunteers
  for update to authenticated
  using (private.is_church_member(church_id))
  with check (private.is_church_member(church_id));

-- assignments
grant select on public.assignments to authenticated;
grant insert (church_id, volunteer_id, request_id, task_brief, assigned_by)
  on public.assignments to authenticated;
grant update (task_brief, status, completed_at) on public.assignments to authenticated;
create policy assignments_member_read on public.assignments
  for select to authenticated using (private.is_church_member(church_id));
create policy assignments_member_create on public.assignments
  for insert to authenticated
  with check (assigned_by = (select auth.uid()) and private.is_church_member(church_id));
create policy assignments_member_update on public.assignments
  for update to authenticated
  using (private.is_church_member(church_id))
  with check (private.is_church_member(church_id));

-- notifications: only the recipient, and only while still a member; may mark read
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_recipient_read on public.notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()) and private.is_church_member(church_id));
create policy notifications_recipient_mark_read on public.notifications
  for update to authenticated
  using (recipient_user_id = (select auth.uid()) and private.is_church_member(church_id))
  with check (recipient_user_id = (select auth.uid()) and private.is_church_member(church_id));

-- audit_logs: owners and admins read their own church's trail
grant select on public.audit_logs to authenticated;
create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated
  using (church_id is not null and private.has_church_role(church_id, array['owner', 'admin']));
