# Milestone 9 live test results

Tested 20 Nov 2026 by the project owner on Windows (Chrome and Edge InPrivate
windows, `http://localhost:3000`) against the live Supabase project.

| Step | Result |
|---|---|
| A1 Apply `20261120170000_polish.sql` | Pass. Functions present; `platform_list_churches` returns `is_member` |
| A2 Update the code | Pass after a correction. The first attempt left the machine on the Milestone 8 branch; after `git checkout milestone-9-landing-polish` the commit was `7ea3b89`. Every step below was rerun on the right code |
| 1 Home page | Pass |
| 2 Verse: Matthew 25:40, World English Bible, reference shown | Pass |
| 3 No church names or request links on the public site | Pass |
| 4 Skip link by keyboard | Pass |
| 5 Phone width: no sideways scroll, one header button | Pass |
| 6 `robots.txt` disallows `/request/` and `/app/` | Pass |
| 7 Link preview image | Pass |
| 8 404 page and its tab title | Pass |
| 9 Tab titles on app pages; wordmark contrast | Pass |
| 10 Invitation notice on Register your church (`joeljess2026+m9@gmail.com` invited to Grace as coordinator) | Pass: "You have been invited to join Grace Community Church", "as a coordinator, until 27 Nov", "open the invitation link you were sent" |
| 11 `/platform` as mikinaldo9@gmail.com | Pass: Living Faith Church shows "You belong to this church, so another platform administrator must review it." and no buttons; Grace shows Suspend; other pending church shows Verify and Suspend |

## Notes

- Supabase's built-in email service only delivers to members of the Supabase
  organisation (and two emails an hour), so test accounts were confirmed with
  `update auth.users set email_confirmed_at = now()`. Before real churches use
  MERCYMAP, connect a custom SMTP provider (for example Brevo) under
  Authentication → Emails → SMTP Settings.
- Test data created: church "uguuu" (pending, owner joeljess2026@gmail.com) and
  account joeljess2026+m9@gmail.com with an open Grace invitation. Remove both
  in the Milestone 11 clean-up.

**Result: Milestone 9 passes.**
