# Milestone 7 live test script

Notifications, volunteers and volunteer tasks. Tested locally against the mock
Supabase API and a real PostgreSQL; not verified until the steps below pass on
the live Supabase project. Use made-up names and numbers only. No AI key is
needed for this milestone.

## A. Setup

### A1. Apply the migration

In the Supabase SQL Editor, in a new snippet, paste the whole of
`supabase/migrations/20261120110000_notifications_volunteers.sql` and run it.
Expected: "Success. No rows returned". Then run:

```sql
select 'functions anon can execute' as check, count(*)::text as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
union all
select 'milestone 7 functions present', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('list_notifications', 'unread_notification_count', 'mark_notifications_read',
       'save_volunteer', 'list_volunteers', 'create_assignment', 'update_assignment_status')
union all
select 'staff can write volunteers directly', has_table_privilege('authenticated', 'public.volunteers', 'insert')::text;
```

Expected: `0`, `7`, `false`.

### A2. Update the code

Stop the app (Ctrl+C), then run `git fetch`, `git checkout milestone-7-notifications-volunteers`,
`git pull`, and `npm run dev`.

## B. Test steps

Grace owner in your normal window; Living Faith owner in the InPrivate window.

| # | Do this | Expected |
|---|---|---|
| 1 | In the InPrivate window, send a made-up food request on `http://localhost:3000/request/grace-community-church` | — |
| 2 | In your normal window, refresh any page | The bell (top right) shows a red number. **Notifications** lists "New request MM-…" with "Food and groceries · online form" and no name or description |
| 3 | Click **Open request** on it | Opens the request; the bell number goes down by one |
| 4 | Click **Mark all as read** on Notifications | "You are all caught up."; no number on the bell |
| 5 | **Volunteers** → **Add a volunteer**: name **Bola Driver**, phone **0803 000 0001**, leave the consent box empty, **Add volunteer** | "Tick this to keep their phone number, or leave the number out." Nothing saved |
| 6 | Tick the consent box, skills `Driving, has a car`, **Add volunteer**. Then add **Chi Helper** with no phone | "Volunteer added"; the list shows both, Bola with "driving, has a car" |
| 7 | **Resources**: add **Rice bags** (Food and groceries, unit bag, total 10). Send a public request for food, quantity **8**, with a made-up phone number; take it to **Awaiting match** and approve it on Rice bags | Approved. Notifications shows "Stock running low: Rice bags — 2 bag available of 10" |
| 8 | On that request, look at **Volunteer tasks** | A brief with the reference, "Help: 8 bag (Rice bags)" and the area, but no name, story or phone. Ticking "Include the person's phone number" adds a Contact line; unticking removes it |
| 9 | Choose **Bola Driver**, **Give task** | The task appears with **Copy brief** and **Send on WhatsApp**; History shows "Volunteer given the task … Task given to Bola Driver." |
| 10 | Click **Send on WhatsApp** (on your phone, or check the link) | WhatsApp opens to 2348030000001 with the brief filled in. Do not send it |
| 11 | **Mark as started**, then **Mark as completed** | Task shows Completed; the request is still **Approved** (record delivery separately) |
| 12 | Give a task to **Chi Helper**, then **Decline** the request with a note | History: "1 open volunteer task cancelled because the request was closed." Bola's completed task is unchanged; Rice bags back to 10 available |
| 13 | In the InPrivate window (Living Faith owner) open **Volunteers** and **Notifications** | Neither shows anything from Grace |
| 14 | SQL: `select action, count(*) from public.audit_logs where action like 'volunteer.%' or action like 'assignment.%' group by action order by action;` | `assignment.completed` 1, `assignment.created` 2, `assignment.in_progress` 1, `volunteer.created` 2 |

Note for step 14: the task cancelled by declining is recorded in the request's
history, not as a separate `assignment.cancelled` audit entry.

## C. What to send back

Pass or fail for each step, and for any failure the step number, what you saw
and any error text.
