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

## Email: Brevo SMTP (20 Nov 2026)

Pass. Sign-up at `localhost:3000/sign-up` sent the confirmation email through
Brevo and the link worked. Setup issues met and fixed on the way:

- The Supabase SMTP username was first entered as placeholder text; it must be
  the **Login** shown on Brevo's SMTP page (`…@smtp-brevo.com`).
- Brevo blocked Supabase's sending IP (Stockholm, AWS) as a "new IP". The IP
  was authorised and IP blocking for SMTP keys was switched off, because
  Supabase may send from other addresses.
- The sender is a Gmail address (no own domain yet), so Brevo warns about
  DMARC; emails may land in Spam until a custom domain is added.
- The app's message for a failed sign-up said "check your internet
  connection" although the server had answered with an error; reworded
  (`b16fff4`).

Test account created: antyamoke78@gmail.com (no church). Remove before the
demo if not needed.

## Deployment: Vercel (20–21 Nov 2026)

Production: **https://mercymap.vercel.app** (Vercel Hobby, production branch
`main`, function region Stockholm arn1 to sit next to Supabase).

| Check | Result |
|---|---|
| Build and deploy from GitHub | Pass (about 40 s to 1 min 11 s) |
| Supabase Site URL and redirect URLs (production and localhost) | Set |
| Sign in on production as the demo owner; overview figures | Pass |
| Real Cloudflare Turnstile keys (widget `MERCYMAP`, hostnames `mercymap.vercel.app` and `localhost`, Managed) | Pass: "Success!" on the live form |
| Public request on production (fictional: food, family of three, Oke-Aro, no phone) | Pass: `MM-D6E59E-2FF340`, listed first as New; Open 11, New 5 |

Notes:
- Vercel will not switch a saved Secret variable to Config, and warns when a
  `NEXT_PUBLIC_` variable is Secret. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` was
  removed and re-added as Config; server secrets stay Secret.
- `ANTHROPIC_API_KEY` is not set yet, so the live AI panel says suggestions
  are not set up.
- Production runs `main` (through Milestone 9) until PR #10 is merged.
- Test request `MM-D6E59E-2FF340` is in the demo church; decline or keep
  before recording the demo.

## Real AI: Claude Haiku 5.5 (21 Nov 2026, local against the live database)

First run: every request failed with HTTP 400. Claude Haiku 5.5 rejects
non-default sampling parameters, and the request sent `temperature: 0`.
Fixed in `02f3843` (temperature removed; forced tool choice kept for Haiku,
`auto` for Sonnet/Opus 5.5; Anthropic's error type and message now logged for
rejected requests). Daily cap migration `20261121100000_ai_daily_limit.sql`
applied.

| Check | Result |
|---|---|
| "Analyse waiting requests" on the demo church | Pass: "AI suggestions added to 29 requests." |
| Brief request (MM-D6E59E-2FF340, family of three, Oke Aro) | Pass: summary sticks to what was said and notes it is brief; correct key facts; sensible questions (urgency, dietary needs or infants, safe contact); medium urgency |
| Safeguarding (teenage girl not safe at home) | Pass: keyword flag shown with the review form; AI high urgency, risk described accurately; a person must review |
| Resource suggestion (student nurse, Ijapo Estate, awaiting match) | Pass: suggests Family food package with a correct reason and "You still choose and approve below"; asks for household size, which the request lacks; no safeguarding concern |
| Welfare concern raised by AI on a closed request (elderly bereaved man, MM-E4373B-066893) | Observed: AI raised "Needs attention"; to be reviewed and cleared by a person (demo moment) |
