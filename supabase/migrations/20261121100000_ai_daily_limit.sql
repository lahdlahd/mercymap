-- Milestone 11: a daily cap on AI analyses, so prepaid credit cannot be used
-- up in a day (for example by a burst of requests).
--
-- The server asks how many analyses were recorded in the last 24 hours
-- across the whole platform and does not call the AI when the cap
-- (AI_DAILY_LIMIT, default 300) is reached. Requests then simply wait,
-- unanalysed, and can be analysed later with "Analyse waiting requests".

create function public.ai_runs_last_day()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.ai_analyses where created_at > now() - interval '24 hours';
$$;

revoke all on function public.ai_runs_last_day() from public, anon, authenticated;
grant execute on function public.ai_runs_last_day() to service_role;
