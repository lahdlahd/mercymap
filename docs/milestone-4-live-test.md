# Milestone 4 live test script

Milestone 4 (request management) has been tested locally against a mock of
Supabase's API. It is **not** verified until every step below passes against
the live Supabase project. Record pass or fail for each step. Never send keys.

## A. Setup

### A1. Apply the migration

In the Supabase SQL Editor, in a new snippet, paste the whole of
`supabase/migrations/20261117130000_request_management.sql` and run it.
Expected: "Success. No rows returned". Then run:

```sql
select 'functions anon can execute' as check, count(*)::text as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
union all
select 'milestone 4 functions present', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('list_requests', 'request_status_counts', 'get_request_detail', 'change_request_status',
                     'add_request_note', 'flag_request_attention', 'acknowledge_request_attention');
```

Expected: `0` and `7`.

### A2. Update the code

Stop the app (Ctrl+C), then run `git fetch`, `git checkout milestone-4-requests`,
`git pull`, and `npm run dev`. No new settings are needed.

## B. Test steps

Use your normal window signed in as the Grace owner, unless a step says otherwise.

| # | Do this | Expected |
|---|---|---|
| 1 | Click **Requests** in the sidebar | The requests from Milestone 3 are listed, newest first, with tabs and counts. Rows show reference, status, kind of help and how it arrived, but no names, phone numbers or descriptions |
| 2 | Try the **Closed** tab, the **Kind of help** filter, **Received through → Recorded by staff**, and type part of a reference (lower case is fine) then **Filter** | Each shows only matching requests; **Clear** resets the filters |
| 3 | Open any request | Full description, contact details, consent time, and a History starting "Request received" |
| 4 | In the SQL Editor run `select a.created_at, u.email from public.audit_logs a join auth.users u on u.id = a.actor_user_id where a.action = 'request.viewed' order by a.created_at desc limit 3;` | Your email, at the time you opened it |
| 5 | On the request, click **Update status** without choosing; then choose **Decline** with no note and click it | First: "Choose what happens next". Second: "Please add a short note". The status does not change |
| 6 | Choose **Start review**, then **Update status** | Badge shows "Under review"; History shows "New → Under review" with your email |
| 7 | Choose **Ask for more information**, write a question, update | Status "Awaiting clarification"; the question is in History |
| 8 | Write something in **Add a note** and click **Add note** | It appears in History and the box clears |
| 9 | **Return to review**, then **Ready for a resource** | Status "Awaiting match"; there is no option to approve, and a line explains that approval happens when a resource is reserved |
| 10 | Open the same request in a **second tab** of the same window. In tab 1 choose **Return to review** and update. In tab 2 (not refreshed) choose **Cancel** with a reason and update | Tab 2 says "Someone else changed this request a moment ago" and shows the current status; it is not cancelled |
| 11 | Choose **Unable to fulfil** with a reason and update | The reason is shown at the top, "This request is closed", no more status options; it now appears under **Closed** |
| 12 | On another open request, click **Raise a safeguarding concern**, then **Raise concern** with nothing written; then write a made-up concern and raise it | First an error. Then a red panel at the top. The Requests page shows a red "needs review" banner, the request is under **Needs attention**, and Overview shows 1 needing attention |
| 13 | On that request, write what was done and click **Mark as reviewed** | Panel changes to "Safeguarding concern reviewed" with your email, time and note; **Needs attention** is empty |
| 14 | In the InPrivate window (Living Faith owner), paste the address of a Grace request page | "Request not found", with none of Grace's details. Its own Requests page lists only Living Faith's request |
| 15 | Re-run the query from step 4 | No `request.viewed` entry for the Living Faith owner |
| 16 | **Record a request** for a made-up visitor | The confirmation has **Open this request**, which opens it, marked "Recorded by staff" |

## C. What to send back

Pass or fail for each step, and for any failure the step number, what you saw
and any error text from the page or the terminal.
