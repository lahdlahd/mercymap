# Milestone 6 live test results

**Status: partly tested live on 17 Nov 2026; the remaining steps were skipped
by the project owner.** No Anthropic API key is configured yet (no credit), so
nothing has been sent to the real Claude API. Milestone 6 was merged on the
strength of the local test suites plus the live checks below.

## Checked against the live Supabase project

| Step | Result |
|---|---|
| A1. Migration `20261118090000_ai_analysis.sql` applied | Pass: "Success. No rows returned" |
| A1. Check query | Pass: anon-executable functions `0`, Milestone 6 functions `4`, staff cannot run `ai_claim` `true`, keyword check `beats me` |
| A3. Code on the `milestone-6-ai` branch, app running | Done |
| 1. AI panel with no key configured | Pass: "AI suggestions are not set up for this workspace. Everything else works as normal." on `MM-0C2840-43ACAE`; rest of the page works |
| 9. Keyword safeguarding check | Pass: staff-recorded `MM-40D416-BD87B0` ("My husband beats me…") flagged **Needs attention** automatically; Requests page shows "1 safeguarding concern needs review" |
| 2–8, 10–16 | **Not run** (2–8, 11, 12, 14–16 need a funded Anthropic key; 10 and 13 skipped by decision of the project owner) |

## Notes

- A "Cannot redefine property: ethereum" overlay seen during testing comes from
  a crypto-wallet browser extension (`evmAsk.js`), not from MERCYMAP.
- `MM-40D416-BD87B0` still has an open safeguarding flag from this test.
- Before the demo: add `ANTHROPIC_API_KEY` (with credit) to `.env.local` and
  Vercel, and run steps 2–8 and 10–16 of
  [`milestone-6-live-test.md`](milestone-6-live-test.md) in the Milestone 11
  regression pass.
