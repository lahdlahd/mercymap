# Milestone 11 live test results

## Part 1: clean-up, demo church (20 Nov 2026)

Tested by the project owner on Windows against the live Supabase project,
code `milestone-11-final` (`4e1a1ec`, then `638d64a`).

| Step | Result |
|---|---|
| A1 Clean-up preview | Pass: 1 church, 1 request, 1 history event, 2 invitations, 1 audit entry, 1 membership, 2 accounts; accounts in other churches **0** |
| A2 Clean-up removal | Pass: request, church and test accounts 0; guards switched on 4 |
| A3 Migration `20261121090000_ai_waiting.sql` | Pass |
| A4 Demo accounts | Pass. The owner used three Gmail addresses instead of `@hopeharvest.example`; the seed's three account lines were edited before running (owner, admin, coordinator) |
| A5 Demo seed | Pass on the second run (the first stopped, as designed, because the accounts did not exist yet; nothing was changed). Status counts exactly as expected |
| B1 `MM-EEDC36` gone from Grace | Pass |
| B2 `/platform`: no "uguuu", Hope Harvest Chapel verified | Pass |
| B3 Demo overview tiles (1 / 4 / 10 / 2 / 1 / 1 / low stock 1) | Pass |
| B4 Requests: 10 open, one safeguarding concern | Pass |
| B5 Fulfilled request history over several days with volunteer task | Pass |
| B6 Reports, 365 days: 28 received, 14 fulfilled, charts | Pass |
| B7 Nine resources (Baby care pack 2 available), five active volunteers | Pass |
| B8 Public request page | Pass |
| B9 Coordinator view | Pass |

### Found and fixed during the live run

- **Endless reload loop in development.** A stray `package-lock.json` in the
  Windows home folder made Turbopack treat the home folder as the project
  root and react to constant changes there. Fixed by pinning
  `turbopack.root` to the project folder (`638d64a`); `.next` was cleared.
- The seed's header comment mentioned a command that does not exist; it now
  points to Requests → "Analyse waiting requests" (`ef6b91e`).

Pending: part 2 (real Claude analysis), Brevo email, deployment and the full
live regression.
