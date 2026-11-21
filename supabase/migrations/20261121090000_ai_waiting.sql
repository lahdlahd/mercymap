-- Milestone 11: analyse the requests still waiting for AI suggestions.
--
-- Requests that arrive while the AI is not set up, or while the provider is
-- unreachable, stay "pending" or "failed". Owners and administrators can now
-- start the analysis for all of them from the Requests page. The analysis
-- itself still goes through ai_claim / ai_save (service role), with the same
-- privacy rules and attempt limit as before.

-- How many requests are waiting. Owners and administrators only.
create function public.ai_waiting_count(p_church_id uuid)
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_church_role(p_church_id, array['owner', 'admin']) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return (select count(*) from public.requests r
           where r.church_id = p_church_id and r.anonymized_at is null
             and (r.ai_status = 'pending' or (r.ai_status = 'failed' and r.ai_attempts < 3)));
end $$;

-- The references to analyse now (newest first, at most p_limit), recorded in
-- the audit log. Owners and administrators of an active church only.
create function public.ai_start_waiting(p_church_id uuid, p_limit integer default 30)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_refs text[];
begin
  if not private.has_church_role(p_church_id, array['owner', 'admin']) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.churches c where c.id = p_church_id and c.status = 'suspended') then
    raise exception 'church_suspended' using errcode = 'P0001';
  end if;
  v_refs := array(
    select r.reference from public.requests r
     where r.church_id = p_church_id and r.anonymized_at is null
       and (r.ai_status = 'pending' or (r.ai_status = 'failed' and r.ai_attempts < 3))
     order by r.created_at desc
     limit greatest(1, least(coalesce(p_limit, 30), 30)));
  if cardinality(v_refs) > 0 then
    insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (p_church_id, v_uid, 'request.ai_waiting_started', 'church', p_church_id,
            jsonb_build_object('count', cardinality(v_refs)));
  end if;
  return v_refs;
end $$;

revoke all on function public.ai_waiting_count(uuid) from public, anon, authenticated;
revoke all on function public.ai_start_waiting(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_waiting_count(uuid) to authenticated;
grant execute on function public.ai_start_waiting(uuid, integer) to authenticated;
