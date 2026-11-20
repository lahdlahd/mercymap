# Milestone 8 live test results

**Status: passed on the live Supabase project, 20 November 2026.**
Tested by the project owner on Windows (Command Prompt in
`C:\Users\USER\mercymap`, app at `http://localhost:3000`), Grace Community
Church owner in the normal window and Living Faith Church owner in InPrivate.

| Step | Result |
|---|---|
| A1. Migration `20261120150000_reports.sql` applied; check query | Pass: `0`, `3` |
| A2. Code on `milestone-8-reports`; `npm install` (chart library); app running | Done. `npm install` reported 7 moderate advisories in third-party packages; not fixed here, to be reviewed before deployment (Milestone 11) |
| 1. Overview tiles | Pass: nine tiles. Needs attention 1, New 10, Open 10, Awaiting a resource 0, Approved 0, In delivery 0, Helped this month 0, Units given this month 0, Resources running low 0, consistent with the live data |
| 2–3. Tiles link to the matching lists | Pass: tile links go to `?status=attention`, `submitted`, `awaiting_match`, `approved`, `in_progress`, `/app/requests`, `/app/resources` |
| 4. Reports, default 30 days | Pass: "22 Oct 2026 to 20 Nov 2026"; received 12, fulfilled 0, units 0, typical days "—", tasks completed 1; "0 of 1 approvals" AI-suggested |
| 5. Other periods | Pass: 365 days "21 Nov 2025 to 20 Nov 2026", received 12 (all test data is from this week), monthly buckets |
| 6. Charts and outcomes | Pass: by kind Food and groceries 12; outcomes Still open 10, Declined 1, Unable to fulfil 1 (= 12 received); stock given out empty ("Nothing has been given out in this period.") |
| 7. SQL comparison | Skipped (figures already reconciled against the records above) |
| 8. Requests CSV (365 days) | Pass: 12 rows, columns Reference, Received, Kind of help, Status, Quantity, Area, Received through, Closed; no names, phone numbers or descriptions (including `MM-EEDC36-BF43FA`); closed dates only on the two closed requests |
| 9. Stock and tasks CSVs | Pass: stock headings only (nothing fulfilled yet); tasks 2 rows (completed, cancelled) with no volunteer names |
| 10. Coordinator view | Skipped (no coordinator account on the live project); covered by the local browser journey |
| 11. Living Faith | Pass: sees only its own 1 request; nothing from Grace |
| 12. Audit log | Pass: three `report.exported` rows by joeladeleye5@gmail.com: tasks/365/2, stock/365/0, requests/365/12 |

No defects found.
