# Milestone 3 live test results

Run by the project owner on 17 Nov 2026 against the live Supabase project, with
the app running locally on Windows from branch `milestone-3-intake`. Script:
[`milestone-3-live-test.md`](milestone-3-live-test.md).

## Setup

| Item | Result |
|---|---|
| Migration `20261117100000_intake.sql` applied | Pass |
| Check: anon-executable functions / Milestone 3 functions / staff direct insert / server role can submit / staff can submit public | 0 / 3 / false / true / false (all as expected) |
| `.env.local`: Turnstile test keys, Supabase secret key, intake hash secret | Configured; the real Cloudflare widget loaded and showed "Success" |

## Steps

| # | Step | Result |
|---|---|---|
| 1 | Public page shows church, emergency notice and form; no sign-in | Pass |
| 2 | Pending church and unknown link both show "not available", naming no church | Pass |
| 3 | Empty submission shows field errors | Pass |
| 4 | Valid request: confirmation with reference (`MM-EEDC36-BF43FA`) | Pass |
| 5 to 7 | Saved as public, submitted, no staff author, correct church, consent recorded; "submitted" history event; address stored only as a 64-character hash | Pass (checked by SQL) |
| 8 | Grace owner records a staff-assisted request | Pass |
| 9 | Living Faith (awaiting verification) records one in its own workspace | Pass |
| 10, 11 | Church profile saved; public page shows the church's emergency guidance and phone | Pass |
| 12 | Sixth request from one connection within the hour refused with a clear message; form contents kept | Pass |
| 13 | `findstr "sb_secret" .next\static\*.js` after a production build | Pass (nothing found) |
| 14 | `git status`: `.env.local` not tracked | Pass |

## Notes

- One live public request was entered with what may be a real phone number.
  Delete it before the demonstration; use made-up numbers only.
- Local testing uses Cloudflare's always-pass Turnstile test keys. Real keys are
  needed at deployment.
