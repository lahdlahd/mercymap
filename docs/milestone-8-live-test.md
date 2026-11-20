# Milestone 8 live test script

Dashboard, Reports & Impact and CSV exports. Tested locally against a fixed set
of back-dated records with exact expected figures; not verified until the steps
below pass on the live Supabase project. Use made-up data only.

## A. Setup

### A1. Apply the migration

In the Supabase SQL Editor, in a new snippet, paste the whole of
`supabase/migrations/20261120150000_reports.sql` and run it. Expected:
"Success. No rows returned". Then run:

```sql
select 'functions anon can execute' as check, count(*)::text as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
union all
select 'milestone 8 functions present', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('dashboard_summary', 'report_summary', 'export_report');
```

Expected: `0`, `3`.

### A2. Update the code

In **Command Prompt**: `cd C:\Users\USER\mercymap`, stop the app (Ctrl+C), then
`git fetch`, `git checkout milestone-8-reports`, `git pull`, `npm install`
(new chart library) and `npm run dev`.

## B. Test steps

| # | Do this | Expected |
|---|---|---|
| 1 | Open **Overview** | "At a glance" with nine tiles: Needs attention, New, Open, Awaiting a resource, Approved, In delivery, Helped this month, Units given this month, Resources running low |
| 2 | Click **Open**, note the "N requests" count; go back and do the same for **New**, **Needs attention**, **Awaiting a resource**, **Approved**, **In delivery** | Each opens the matching Requests tab and its count equals the number on the tile |
| 3 | Click **Resources running low** | Opens Resources; the number of resources with 2 or fewer available (or under 20% left) equals the tile |
| 4 | Click **Reports** in the sidebar | "Last 30 days" is selected; the dates under the buttons end today; five figures and four charts (Requests over time, Requests by kind of help, Outcomes, Stock given out) |
| 5 | Click **Last 7 days**, **Last 90 days**, **Last 365 days** | The dates and figures change; "Requests received" never goes down as the period gets longer |
| 6 | On **Last 365 days**, open **Show the figures as tables** | The tables list the same numbers as the charts; Outcomes rows add up to Requests received |
| 7 | Compare with the records: in SQL run `select count(*) from public.requests where church_id = (select id from public.churches where slug = 'grace-community-church') and created_at >= now() - interval '30 days';` | Close to the 30-day "Requests received" (the report counts whole Lagos days, so a request from 30 days ago this morning may differ by one) |
| 8 | Under **Download**, click **Requests (CSV)** | A file `mercymap-requests-last-30-days-….csv` downloads. Open it: columns Reference, Received, Kind of help, Status, Quantity, Area, Received through, Closed. No names, phone numbers or descriptions |
| 9 | Download **Stock given out (CSV)** and **Volunteer tasks (CSV)** | Both download; the tasks file has no volunteer names |
| 10 | In the InPrivate window, sign in as a **coordinator** of Grace if you have one (otherwise skip) and open Reports | Reports visible; "Only owners and administrators can download exports."; no download buttons |
| 11 | In the InPrivate window as the Living Faith owner, open **Overview** and **Reports → Last 365 days** | Only Living Faith's own numbers (zero or near zero); nothing from Grace |
| 12 | SQL: `select a.created_at, u.email, a.metadata from public.audit_logs a join auth.users u on u.id = a.actor_user_id where a.action = 'report.exported' order by a.id desc limit 5;` | One row per download in steps 8–9, with your email, the kind, the days and the number of rows |

## C. What to send back

Pass or fail for each step, and for any failure the step number, what you saw
and any error text.
