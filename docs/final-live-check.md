# Final live check (production)

Run on https://mercymap.vercel.app (the main address, not a per-deployment
address). About 25 minutes. Use only fictional data. Each row is pass or
fail; send failures with the step number, what you saw and a screenshot.

Local verification before this check (21 Nov 2026, `main` at 0738dc6):
301 database tests, 186 unit tests, 9 browser journeys (480 checks), lint,
typecheck and `npm audit` (0 vulnerabilities) all pass.

## A. Public side (InPrivate window)

| # | Do this | Expected |
|---|---|---|
| A1 | Open the home page | Headline, Matthew 25:40 (World English Bible), no church names |
| A2 | Open `/request/hope-harvest-chapel`, submit a fictional request (Clothing, "My two daughters need school uniforms", Isikan, no phone) | Cloudflare "Success!", then a reference number |
| A3 | Open `/request/no-such-church` | A clear "not found" page, no error |

## B. Staff flow (owner: theretiredblues@gmail.com)

| # | Do this | Expected |
|---|---|---|
| B1 | Requests, open the A2 request | AI suggestions appear within seconds (refresh once) |
| B2 | Update status to Under review, then Awaiting match; click Run again | The AI now names a resource (most likely Children's clothing bundle) with a reason |
| B3 | Approve and reserve with Children's clothing bundle | Status Approved; Resources shows the bundle reserved |
| B4 | Update status to In progress; Give task to Ngozi Eze; open Send on WhatsApp (do not send) | Task brief has the reference and area, no phone unless ticked |
| B5 | Mark as fulfilled with a short note | Status Fulfilled; the reservation becomes "given out"; history lists every step |
| B6 | Open MM-E4373B-066893 (welfare flag), write "Added to the weekly visiting list", Mark as reviewed | Flag cleared; Needs attention count drops by one |
| B7 | Reports & Impact, Last 30 days, Download CSV | File opens; no names, phone numbers or descriptions |

## C. Permissions and separation

| # | Do this | Expected |
|---|---|---|
| C1 | Sign in as the coordinator (j47908136@gmail.com), open Reports | Figures shown; no CSV download; Settings has no staff role changes |
| C2 | As the coordinator, copy a request's address; sign in as the Grace owner (joeladeleye5@gmail.com) and open that address | "Not found": Grace cannot see Hope Harvest's requests |
| C3 | As mikinaldo9@gmail.com open `/platform` | Hope Harvest verified; Living Faith shows the own-church note; any new church (your partner's) can be verified here |

## D. Phone

| # | Do this | Expected |
|---|---|---|
| D1 | On a phone, open the home page and the demo Overview | Everything fits; no sideways scrolling |
