# Milestone 4 live test results

Run by the project owner on 17 Nov 2026 against the live Supabase project, with
the app running locally on Windows from branch `milestone-4-requests`. Script:
[`milestone-4-live-test.md`](milestone-4-live-test.md).

## Setup

| Item | Result |
|---|---|
| Migration `20261117130000_request_management.sql` applied | Pass |
| Check: anon-executable functions / Milestone 4 functions present | 0 / 7 (as expected) |

## Steps

| # | Step | Result |
|---|---|---|
| 1 | Requests page lists requests newest first with tabs and counts; no personal details in rows | Pass |
| 2 | Closed tab, kind-of-help and channel filters, lower-case reference search, Clear | Pass |
| 3 | Request page shows description, contact details, consent time, history | Pass |
| 4 | Opening a request is written to the audit log with the viewer's email | Pass |
| 5 | Empty choice and decline-without-note are refused; status unchanged | Pass |
| 6 to 9 | New → Under review → Awaiting clarification (with question) → note → Return to review → Awaiting match; no manual approval; approval explanation shown | Pass |
| 10 | Stale second tab refused with "Someone else changed this request"; not cancelled | Pass |
| 11 | Unable to fulfil with reason; request closed and listed under Closed | Pass |
| 12 | Safeguarding concern raised; required description; shown on request and overview | Pass |
| 13 | Concern recorded as reviewed with who, when and note | Pass |
| 14 | Another church gets "Request not found" for a Grace request address; its list shows only its own request | Pass |
| 15 | No audit view recorded for the other church's refused attempt | Pass |
| 16 | Staff-recorded request opens from "Open this request", marked "Recorded by staff" | Pass |

## Fixed during live testing

- After a conflicting change refreshed the page, the note label still described
  the earlier choice ("Why is it being cancelled?"). The choice is now dropped
  when the status changes; covered by a new browser check.
