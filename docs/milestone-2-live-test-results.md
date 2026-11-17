# Milestone 2 live test results

Run by the project owner on 16–17 Nov 2026 against the live Supabase project,
with the app running locally on Windows (Node 24.14) from branch
`milestone-2-auth-churches`. Script: [`milestone-2-live-test.md`](milestone-2-live-test.md).

## Setup

| Item | Result |
|---|---|
| Milestone 2 migration applied | Pass |
| Check: functions the anonymous role can execute / Milestone 2 functions present | 0 / 5 (expected 0 / 5) |
| Confirm email on; sign-ups allowed; anonymous sign-ins off | Confirmed |
| Site URL `http://localhost:3000`; redirect URL `http://localhost:3000/**` | Confirmed |
| Email templates | Left at Supabase defaults (editing requires custom SMTP) |

## Steps

| # | Step | Result |
|---|---|---|
| 1 | Signed-out visit to `/app` redirects to sign in | Pass |
| 2 | Sign-up; confirmation email arrives | Pass |
| 3 | Sign-in refused before confirming | Pass |
| 4 | Email link signs in and opens church registration | Pass |
| 5 | A used email link is rejected | Pass |
| 6 | Church registration; workspace shows "Awaiting verification" | Pass |
| 7 | `churches` row created as pending | Pass |
| 8 | Invitation link created and shown once | Pass |
| 9 | Invitation stored as a hash | Pass |
| 10 | Signed-out invitation page shows no church details | Pass |
| 11 | Invitation shows church and role once signed in | Pass. The automatic return to the invitation straight after the email link was not observed, because that link had already been used |
| 12 | Accept invitation; coordinator has no staff controls | Pass |
| 13 | Used invitation rejected | Pass |
| 14 | Invitation for another address blocked; revoked invitation rejected | Pass |
| 15 | Owner promotes to administrator; administrator may invite coordinators only | Pass |
| 16 | Owner removes member; access lost immediately | Pass |
| 17 | Sign-out; password reset email | Pass (reset retried after the hourly email limit cleared) |
| 18 | Reset link sets a new password | Pass |
| 19 | `/platform` shows "Page not found" to church staff | Pass |
| 20 to 23 | Platform administrator added by SQL; verifies church; owner sees "verified" | Pass |
| 25, 26 | Second church registered; its staff page shows nothing from the first | Pass. Registered by the platform administrator's account rather than a fresh user |

## Problems found and fixed during live testing

1. A wrong Supabase URL in `.env.local` produced only "Something went wrong". The app now says it could not reach the account service.
2. The role-change success banner crowded the staff row. Removed; the updated role badge is the confirmation.
3. The email rate-limit message said "wait a minute"; Supabase's built-in limit is hourly. Now says "try again later".
4. The reserved public link wrapped mid-word on the overview page.

## Known limitations carried forward

- Supabase's built-in email sender is for testing and limits emails per hour. Custom SMTP is needed before real use, and also to edit the email templates.
- An invited person who signs in from the normal sign-in page lands on "Register your church"; their pending invitation should be shown there.
- A platform administrator who also belongs to a church could verify that church. Block self-verification before real use.
- The Milestone 1 database test suite has not been run directly against the live project; Milestone 2's live tests exercised it through the app.
