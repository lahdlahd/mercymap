-- MERCYMAP test-data clean-up, part 1: PREVIEW. Changes nothing.
--
-- Shows exactly what part 2 will remove:
--   * request MM-EEDC36-BF43FA (Grace Community Church; may hold a real phone number)
--   * the test church "uguuu" and everything inside it
--   * test accounts joeljess2026@gmail.com and joeljess2026+m9@gmail.com,
--     and any invitation sent to them
-- Run this in the Supabase SQL Editor, check the numbers, then run part 2.

with
  target_churches as (
    select id from public.churches where slug = 'uguuu'
  ),
  target_requests as (
    select id, church_id from public.requests
     where reference = 'MM-EEDC36-BF43FA'
        or church_id in (select id from target_churches)
  ),
  target_users as (
    select id from auth.users
     where lower(email) in ('joeljess2026@gmail.com', 'joeljess2026+m9@gmail.com')
  )
select 'churches' as what, count(*)::int as rows_to_remove from target_churches
union all select 'requests', count(*)::int from target_requests
union all select 'request history events', count(*)::int
  from public.request_events where request_id in (select id from target_requests)
union all select 'AI analyses', count(*)::int
  from public.ai_analyses where request_id in (select id from target_requests)
union all select 'allocations', count(*)::int
  from public.allocations where request_id in (select id from target_requests)
     or church_id in (select id from target_churches)
union all select 'volunteer tasks', count(*)::int
  from public.assignments where request_id in (select id from target_requests)
     or church_id in (select id from target_churches)
union all select 'notifications', count(*)::int
  from public.notifications where request_id in (select id from target_requests)
     or church_id in (select id from target_churches)
union all select 'resources', count(*)::int
  from public.resources where church_id in (select id from target_churches)
union all select 'volunteers', count(*)::int
  from public.volunteers where church_id in (select id from target_churches)
union all select 'invitations', count(*)::int
  from public.invitations where church_id in (select id from target_churches)
     or lower(email) in ('joeljess2026@gmail.com', 'joeljess2026+m9@gmail.com')
union all select 'audit log entries', count(*)::int
  from public.audit_logs where church_id in (select id from target_churches)
     or entity_id in (select id from target_requests)
union all select 'church memberships', count(*)::int
  from public.church_memberships where church_id in (select id from target_churches)
     or user_id in (select id from target_users)
union all select 'user accounts', count(*)::int from target_users
union all select 'memberships the accounts hold in OTHER churches (must be 0)', count(*)::int
  from public.church_memberships
 where user_id in (select id from target_users)
   and church_id not in (select id from target_churches);
