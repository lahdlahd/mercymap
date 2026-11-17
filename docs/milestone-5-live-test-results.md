# Milestone 5 live test results

**Status: live test steps skipped by the project owner on 17 Nov 2026.**
Milestone 5 was merged on the strength of the local test suites only.

## What was checked against the live Supabase project

| Step | Result |
|---|---|
| A1. Migration `20261117150000_resources_allocation.sql` applied | Pass: "Success. No rows returned" |
| A1. Check query | Pass: anon-executable functions `0`, Milestone 5 functions present `6`, `private.clean_text(' voucher ', 40)` returns `voucher` |
| A2. Code updated to the `milestone-5-resources` branch | Done |
| A3. Two public test requests sent | Done: `MM-0C2840-43ACAE` (food, 2, Ijapo) and `MM-530B84-11113A` (food, 2, Alagbaka) |
| B1–B25. Resources, matching, approval, delivery, fulfilment, release, concurrency, archiving, isolation, audit | **Not run** (skipped by decision of the project owner) |

## What this means

The behaviour in steps B1–B25 is covered locally by 197 database tests
(including concurrent approvals of the same request and of competing requests),
126 unit tests and a 77-check browser journey against real PostgreSQL. It has
not been confirmed through the app against the live Supabase project. The
script in [`milestone-5-live-test.md`](milestone-5-live-test.md) can still be
run at any time, and should be before the demo (Milestone 11 regression pass).
