# Milestone 5 live test script

Milestone 5 (resources, matching, approval by reservation, delivery, fulfilment
and stock release) has been tested locally against a mock of Supabase's API and
a real PostgreSQL. It is **not** verified until every step below passes against
the live Supabase project. Record pass or fail for each step. Never send keys.
Use made-up names and data only.

## A. Setup

### A1. Apply the migration

In the Supabase SQL Editor, in a new snippet, paste the whole of
`supabase/migrations/20261117150000_resources_allocation.sql` and run it.
Expected: "Success. No rows returned". Then run:

```sql
select 'functions anon can execute' as check, count(*)::text as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
union all
select 'milestone 5 functions present', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('list_resources', 'get_resource', 'save_resource', 'list_matching_resources',
                     'approve_allocation', 'record_fulfilment')
union all
select 'letter v kept', private.clean_text(' voucher ', 40);
```

Expected: `0`, `6` and `voucher`.

### A2. Update the code

Stop the app (Ctrl+C), then run `git fetch`, `git checkout milestone-5-resources`,
`git pull`, and `npm run dev`. No new settings are needed.

### A3. Two test requests

Use the public form for Grace (`/r/grace-community-church`) to send two made-up
food requests: **R1** needing 2, area **Ijapo**; **R2** needing 2, area
**Alagbaka**. Note both references. On each, use **Start review** then
**Ready for a resource** so both are "Awaiting match".

## B. Test steps

Use your normal window signed in as the Grace owner, unless a step says otherwise.

| # | Do this | Expected |
|---|---|---|
| 1 | Click **Resources** in the sidebar | "There are no active resources yet" and an **Add a resource** button |
| 2 | **Add a resource**, then click **Add resource** with nothing filled in | Errors for name, kind of help, unit and quantity. Nothing is saved |
| 3 | Fill: name **Food package**, kind **Food and groceries**, unit **package**, total **5**, areas `Ijapo, Oke-Aro` (leave source as The church). Click **Add resource** | Opens the resource page: "Resource added", Available 5, Reserved 0, Given out 0, Total 5. Coverage shows Ijapo, Oke-Aro |
| 4 | Add **Hope Foods voucher**: food, unit **voucher**, total **1**, choose **A partner** but leave the partner name empty, click **Add resource**; then enter **Hope Foods** and add | First: "Name the partner that provides it". Then it is saved, and the list shows "From Hope Foods" and the unit spelled **voucher** |
| 5 | Add **Old rice stock**: food, package, total 10, **Available until** 31 Jan 2020 | The Resources list shows it as "Past end date" |
| 6 | Open **R1** | Under "Approve and reserve stock": **Food package** with "5 package available · church stock · Covers their area". Under "Cannot be used": Hope Foods voucher (not enough left, 1 voucher left) and Old rice stock (past its end date). There is no "Approved" option in the status choices |
| 7 | Click **Approve and reserve** without choosing | "Choose a resource to reserve." Still Awaiting match |
| 8 | Choose **Food package**, write `Collect on Saturday`, click **Approve and reserve**, confirm | Status "Approved". A blue "Stock reserved" box: 2 package from Food package, with your email. History: `Reserved 2 package from "Food package". Collect on Saturday` |
| 9 | Open **Resources** | Food package: Available 3, Reserved 2, Given out 0 |
| 10 | Back on R1, choose **Start delivery**, **Update status** (no note) | Status "In progress"; the stock is still reserved (Resources still shows 3 / 2 / 0) |
| 11 | On R1, write `Handed over by the welfare team` in **Delivery note** and click **Mark as fulfilled**, confirm | Status "Fulfilled", green "Help given" box, no further actions. Resources: Available 3, Reserved 0, Given out 2 |
| 12 | Open **R2** (area Alagbaka) | No resource can be chosen: "No resource can meet this request right now", and "Food package: Does not cover their area". No **Approve and reserve** button |
| 13 | Open **Food package**, change areas to `Ijapo, Oke-Aro, Alagbaka`, **Save changes**; reopen R2 | "Changes saved"; R2 now offers Food package |
| 14 | Approve R2 on Food package. Then choose **Decline** with no note and update | Approved, Resources shows Available 1. The decline is refused: "Please add a short note"; still Approved |
| 15 | Choose **Decline**, write `Found help elsewhere`, update | Status "Declined". History ends with "Found help elsewhere (Reserved stock returned.)". Resources: Food package Available 3 again |
| 16 | Send a third made-up request **R3** (food, 1, area Oke-Aro), move it to Awaiting match, approve it on Food package, **Start delivery**, then **Cancel** with a reason | Cancelled; Resources shows Food package back to Available 3 |
| 17 | Send **R4** (food, 1, no area), move to Awaiting match | Food package shows "Area not given: check coverage"; Hope Foods voucher shows "Serves any area" |
| 18 | Approve R4 on Food package. Choose **Release and choose another resource**, update with no note; then with note `Partner is closer` | First refused (note needed). Then back to "Awaiting match" and Food package back to Available 3 |
| 19 | Approve R4 on **Hope Foods voucher** | Approved; the box says "from Hope Foods voucher (Hope Foods)"; the voucher now shows Available 0, "None left" |
| 20 | Open **Food package**, set total to **1**, **Save changes** | "That is less than is already reserved or given out." Total stays 5 |
| 21 | Open the **Food package** resource page | "Requests using it" lists R1 (Given out), R2 and R3 (Returned) |
| 22 | **Two tabs.** Send **R5** (food, 3, Ijapo) and move it to Awaiting match. Open R5 in two tabs. In tab 1, approve on Food package. In tab 2 (not refreshed), approve on Food package | Tab 1 approves (Available 0). Tab 2 shows "Someone else changed this request a moment ago" at the top and the current status. Stock is reserved once only: Resources shows Reserved 3, not 6 |
| 23 | On Food package, click **Archive**, confirm; open any Awaiting match food request | "Archived"; it is gone from the list (shown with **Show archived resources**) and is not offered on the request. Then **Restore** it |
| 24 | In the InPrivate window (Living Faith owner), open **Resources**, then paste the address of Grace's Food package page | Living Faith's list does not show Grace's resources; the Grace page shows "not found" |
| 25 | In the SQL Editor run `select action, count(*) from public.audit_logs where action like 'resource.%' group by action order by action;` | resource.created 3, resource.updated 1, resource.archived 1, resource.restored 1 |

## C. What to send back

Pass or fail for each step, and for any failure the step number, what you saw
and any error text from the page or the terminal.

## D. A bug fixed in this milestone

Milestone 3's text cleaning removed the letter "v" from the start and end of
text (PostgreSQL has no `\v` escape, so it read as the letter). Anything typed
since Milestone 3 that began or ended with "v", such as a name, area or note,
may be missing that letter. All live data so far is made-up test data, so
nothing needs repairing; new text is stored correctly from this migration on.
