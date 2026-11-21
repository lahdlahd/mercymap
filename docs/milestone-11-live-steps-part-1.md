# Milestone 11, part 1: clean-up, demo church, waiting AI analyses

Run these in order. Everything is tested locally first (database tests for
both scripts and the new functions, and a browser journey that loads the demo
data and checks every page).

Before anything else, in **Command Prompt**:

```
cd C:\Users\USER\mercymap
git fetch
git checkout milestone-11-final
git pull
npm install
git log --oneline -1
```

The last line must start with the commit shown on PR #10. Then `npm run dev`.

## A. Database (Supabase SQL Editor, a new snippet for each)

| # | Do this | Expected |
|---|---|---|
| A1 | Paste and run `supabase/maintenance/2026-11-cleanup-1-preview.sql` | A list of counts. Requests 1 or more, churches 1, user accounts 2, and the last row **0** |
| A2 | Paste and run `supabase/maintenance/2026-11-cleanup-2-remove.sql` (confirm the destructive-operation warning) | The final check shows `0`, `0`, `0` and `4` |
| A3 | Paste and run `supabase/migrations/20261121090000_ai_waiting.sql` | Success. No rows returned |
| A4 | **Authentication → Users → Add user → Create new user**, tick **Auto Confirm User**, three times: `owner@hopeharvest.example`, `admin@hopeharvest.example`, `coordinator@hopeharvest.example`, each with a password you will remember | Three users listed. If Supabase refuses the address, tell Claude; the seed's three account lines can be changed |
| A5 | Paste and run `supabase/maintenance/2026-11-demo-seed.sql` | A table of statuses: approved 1, awaiting_clarification 1, awaiting_match 2, cancelled 1, declined 2, fulfilled 14, in_progress 1, submitted 4, unable_to_fulfil 1, under_review 1 |

## B. App (`http://localhost:3000`)

| # | Do this | Expected |
|---|---|---|
| B1 | Sign in as the Grace owner, open Requests, search `MM-EEDC36` | No request found. Grace's other requests are still there |
| B2 | Sign in as **mikinaldo9@gmail.com**, open `/platform` | No "uguuu"; **Hope Harvest Chapel** is listed as Verified |
| B3 | In an InPrivate window, sign in as `owner@hopeharvest.example` | Overview: Needs attention 1, New 4, Open 10, Awaiting match 2, Approved 1, In delivery 1, Resources running low 1 |
| B4 | Requests | 10 open requests and a red "1 safeguarding concern needs review" box. (The "waiting for AI suggestions" card appears only once an Anthropic key is set) |
| B5 | Open any fulfilled request (Closed tab) | A full history from "Request received" to "Fulfilled", with dates over several days and the volunteer task |
| B6 | Reports & Impact, then Last 365 days | Figures and four charts; 365 days shows 28 received and 14 fulfilled |
| B7 | Resources and Volunteers | Nine resources (Baby care pack shows 2 available) and the volunteers |
| B8 | Open `http://localhost:3000/request/hope-harvest-chapel` | Hope Harvest Chapel's public request page |
| B9 | Sign in as `coordinator@hopeharvest.example` | Same requests; no Settings → Staff management |

## C. Once Anthropic credit is added (part 2)

Add `ANTHROPIC_API_KEY=...` to `.env.local` (never in chat), restart
`npm run dev`, sign in as the demo owner, Requests → **Analyse waiting
requests**. Expected: "AI suggestions added to 28 requests." Then the
Milestone 6 live steps 2–8 and 10–16.
