-- MERCYMAP test-data clean-up, part 2: REMOVE.
--
-- Removes, in one transaction:
--   * request MM-EEDC36-BF43FA (Grace Community Church; may hold a real phone number)
--   * the test church "uguuu" and everything inside it
--   * test accounts joeljess2026@gmail.com and joeljess2026+m9@gmail.com,
--     and any invitation sent to them
-- Nothing else is touched. Row counts for every other church are checked
-- before and after; if anything else changed, or a safety check fails,
-- the whole transaction rolls back and nothing is removed.
--
-- History and audit rows are normally append-only. Their guards are switched
-- off only inside this transaction and switched back on before it commits.
-- One audit entry ('data.purged') records that the clean-up happened.
--
-- Safe to run twice: a second run finds nothing and changes nothing.

begin;

alter table public.request_events     disable trigger append_only;
alter table public.audit_logs         disable trigger append_only;
alter table public.allocations        disable trigger no_delete;
alter table public.church_memberships disable trigger protect_last_owner;

do $$
declare
  c_reference constant text   := 'MM-EEDC36-BF43FA';
  c_church    constant text   := 'uguuu';
  c_emails    constant text[] := array['joeljess2026@gmail.com', 'joeljess2026+m9@gmail.com'];

  v_grace    uuid;
  v_req      record;
  v_test     record;
  v_churches uuid[] := '{}';
  v_requests uuid[] := '{}';
  v_users    uuid[] := '{}';
  v_assigns  uuid[] := '{}';
  v_allocs   uuid[] := '{}';
  v_before   jsonb;
  v_after    jsonb;
  v_n        integer;
  v_removed  jsonb := '{}';
begin
  -- Safety checks ---------------------------------------------------------
  select id into v_grace from public.churches where slug = 'grace-community-church';
  if v_grace is null then
    raise exception 'safety: Grace Community Church not found; nothing removed';
  end if;

  select id, church_id into v_req from public.requests where reference = c_reference;
  if v_req.id is not null then
    if v_req.church_id <> v_grace then
      raise exception 'safety: % is not a Grace request; nothing removed', c_reference;
    end if;
    v_requests := v_requests || v_req.id;
  end if;

  select id, status into v_test from public.churches where slug = c_church;
  if v_test.id is not null then
    if v_test.status = 'verified' then
      raise exception 'safety: % is verified; nothing removed', c_church;
    end if;
    if exists (select 1 from public.church_memberships m
                 join auth.users u on u.id = m.user_id
                where m.church_id = v_test.id and lower(u.email) <> all (c_emails)) then
      raise exception 'safety: % has members who are not test accounts; nothing removed', c_church;
    end if;
    v_churches := v_churches || v_test.id;
    v_requests := v_requests || array(select id from public.requests where church_id = v_test.id);
  end if;

  v_users := array(select id from auth.users where lower(email) = any (c_emails));
  if exists (select 1 from public.church_memberships
              where user_id = any (v_users) and church_id <> all (v_churches)) then
    raise exception 'safety: a test account belongs to another church; nothing removed';
  end if;

  if cardinality(v_requests) = 0 and cardinality(v_churches) = 0 and cardinality(v_users) = 0
     and not exists (select 1 from public.invitations where lower(email) = any (c_emails)) then
    raise notice 'Nothing to remove: the clean-up has already been done.';
    return;
  end if;

  -- Snapshot every other church ------------------------------------------
  select coalesce(jsonb_object_agg(c.id, jsonb_build_array(
           (select count(*) from public.requests       x where x.church_id = c.id and x.id <> all (v_requests)),
           (select count(*) from public.request_events x where x.church_id = c.id and x.request_id <> all (v_requests)),
           (select count(*) from public.resources      x where x.church_id = c.id),
           (select count(*) from public.volunteers     x where x.church_id = c.id),
           (select count(*) from public.allocations    x where x.church_id = c.id and x.request_id <> all (v_requests)),
           (select count(*) from public.assignments    x where x.church_id = c.id and x.request_id <> all (v_requests)),
           (select count(*) from public.church_memberships x where x.church_id = c.id))), '{}')
    into v_before
    from public.churches c where c.id <> all (v_churches);

  v_assigns := array(select id from public.assignments
                      where request_id = any (v_requests) or church_id = any (v_churches));
  v_allocs  := array(select id from public.allocations
                      where request_id = any (v_requests) or church_id = any (v_churches));

  -- Remove, children first ------------------------------------------------
  delete from public.notifications
   where request_id = any (v_requests) or church_id = any (v_churches);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('notifications', v_n);

  delete from public.audit_logs
   where church_id = any (v_churches)
      or entity_id = any (v_requests) or entity_id = any (v_assigns) or entity_id = any (v_allocs);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('audit_logs', v_n);

  delete from public.assignments where id = any (v_assigns);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('assignments', v_n);

  delete from public.allocations where id = any (v_allocs);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('allocations', v_n);

  delete from public.ai_analyses where request_id = any (v_requests);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('ai_analyses', v_n);

  delete from public.request_events where request_id = any (v_requests);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('request_events', v_n);

  delete from public.requests where id = any (v_requests);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('requests', v_n);

  delete from public.resources  where church_id = any (v_churches);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('resources', v_n);

  delete from public.volunteers where church_id = any (v_churches);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('volunteers', v_n);

  delete from public.invitations
   where church_id = any (v_churches) or lower(email) = any (c_emails);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('invitations', v_n);

  delete from public.church_memberships
   where church_id = any (v_churches) or user_id = any (v_users);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('church_memberships', v_n);

  delete from public.churches where id = any (v_churches);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('churches', v_n);

  delete from auth.users where id = any (v_users);
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('user_accounts', v_n);

  -- Every other church must be exactly as it was --------------------------
  select coalesce(jsonb_object_agg(c.id, jsonb_build_array(
           (select count(*) from public.requests       x where x.church_id = c.id),
           (select count(*) from public.request_events x where x.church_id = c.id),
           (select count(*) from public.resources      x where x.church_id = c.id),
           (select count(*) from public.volunteers     x where x.church_id = c.id),
           (select count(*) from public.allocations    x where x.church_id = c.id),
           (select count(*) from public.assignments    x where x.church_id = c.id),
           (select count(*) from public.church_memberships x where x.church_id = c.id))), '{}')
    into v_after
    from public.churches c;
  if v_after is distinct from v_before then
    raise exception 'safety: other churches changed (before %, after %); rolled back', v_before, v_after;
  end if;

  insert into public.audit_logs (church_id, actor_user_id, action, entity_type, metadata)
  values (null, null, 'data.purged', 'maintenance',
          jsonb_build_object('reason', 'test data removed before the demo',
                             'reference', case when v_req.id is not null then c_reference end,
                             'removed', v_removed));

  raise notice 'Removed: %', v_removed;
end $$;

alter table public.request_events     enable trigger append_only;
alter table public.audit_logs         enable trigger append_only;
alter table public.allocations        enable trigger no_delete;
alter table public.church_memberships enable trigger protect_last_owner;

commit;

-- Check: expect 0 everywhere and the four guards back on.
select 'request MM-EEDC36-BF43FA' as check, count(*)::text as result
  from public.requests where reference = 'MM-EEDC36-BF43FA'
union all select 'church uguuu', count(*)::text from public.churches where slug = 'uguuu'
union all select 'test accounts', count(*)::text from auth.users
 where lower(email) in ('joeljess2026@gmail.com', 'joeljess2026+m9@gmail.com')
union all select 'guards switched on (expect 4)', count(*)::text
  from pg_trigger
 where tgname in ('append_only', 'no_delete', 'protect_last_owner') and tgenabled = 'O'
   and tgrelid in ('public.request_events'::regclass, 'public.audit_logs'::regclass,
                   'public.allocations'::regclass, 'public.church_memberships'::regclass);
