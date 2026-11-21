-- MERCYMAP demo tidy-up before recording (run once in the SQL Editor).
--
-- Removes the Brevo test sign-up antyamoke78@gmail.com, but only if that
-- account belongs to no church and has no pending invitation; otherwise it
-- changes nothing and says why. Nothing else is touched.
--
-- The welfare flag on MM-E4373B-066893 is NOT cleared here: only a person
-- may clear a safeguarding flag, in the app, with a note (see
-- docs/final-live-check.md step B6).

do $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = 'antyamoke78@gmail.com';
  if v_id is null then
    raise notice 'Test account not found: nothing to remove.';
    return;
  end if;
  if exists (select 1 from public.church_memberships where user_id = v_id) then
    raise notice 'Not removed: the test account belongs to a church.';
    return;
  end if;
  if exists (select 1 from public.churches where created_by = v_id) then
    raise notice 'Not removed: the test account registered a church.';
    return;
  end if;
  delete from auth.users where id = v_id;
  raise notice 'Removed the test account antyamoke78@gmail.com.';
end $$;

select count(*) as test_accounts_left from auth.users where lower(email) = 'antyamoke78@gmail.com';
