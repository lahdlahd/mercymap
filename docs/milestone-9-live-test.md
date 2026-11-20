# Milestone 9 live test script

Landing page, polish, accessibility and the two fixes carried forward from
Milestone 2. Tested locally (axe accessibility checks on every page, phone
layout, titles, link previews); not verified until the steps below pass on the
live Supabase project.

## A. Setup

### A1. Apply the migration

In the Supabase SQL Editor, in a new snippet, paste the whole of
`supabase/migrations/20261120170000_polish.sql` and run it. Expected:
"Success. No rows returned". Then run:

```sql
select 'functions anon can execute' as check, count(*)::text as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
union all
select 'pending invitations function present', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'my_pending_invitations';
```

Expected: `0`, `1`.

### A2. Update the code

In **Command Prompt**: `cd C:\Users\USER\mercymap`, stop the app (Ctrl+C), then
`git fetch`, `git checkout milestone-9-landing-polish`, `git pull`, `npm install`
and `npm run dev`.

## B. Test steps

| # | Do this | Expected |
|---|---|---|
| 1 | In an InPrivate window (signed out), open `http://localhost:3000` | The new home page: headline, Register your church / Staff sign in, the verse panel, How it works, What your church gets, Safe, private and human, Looking for help? |
| 2 | Read the verse panel | "The King will answer them, 'Most certainly I tell you, because you did it to one of the least of these my brothers, you did it to me.'" with **Matthew 25:40 · World English Bible** underneath |
| 3 | Look for any church name or request link on the home page | None. "Looking for help?" tells people to ask their church for its MERCYMAP link |
| 4 | Press **Tab** once on the home page | A "Skip to main content" button appears top left; pressing **Enter** jumps past the header |
| 5 | Make the window narrow (or open it on your phone on the same Wi-Fi at `http://<your PC's network address>:3000`) | Everything fits with no sideways scrolling; the header shows only "Staff sign in" |
| 6 | Open `http://localhost:3000/robots.txt` | Lines `Disallow: /request/` and `Disallow: /app/` |
| 7 | Open `http://localhost:3000/opengraph-image` | A green 1200×630 picture with MERCYMAP, the headline and Matthew 25:40 (WEB): the picture shown when the link is shared |
| 8 | Open `http://localhost:3000/no-such-page` | "Page not found"; the browser tab says "Page not found · MERCYMAP" |
| 9 | As the Grace owner, open a few app pages (Overview, Requests, Reports, Volunteers) | Each browser tab has its own title ("Overview · MERCYMAP", …); the gold "MAP" in the logo is a little darker on light pages and lighter in the green sidebar |
| 10 | As the Grace owner, **Settings → Staff**, invite a made-up address you can sign up with (for example a `+test` alias of your own email) as a coordinator. In a fresh InPrivate window, **sign up** with that address (not through the invitation link), confirm it, and you land on **Register your church** | A yellow box: "You have been invited to join Grace Community Church", "as a coordinator, until …", and "open the invitation link you were sent" |
| 11 | As **mikinaldo9@gmail.com** (platform administrator and owner of Living Faith), open `/platform` | Living Faith Church shows "You belong to this church, so another platform administrator must review it." and no buttons; Grace Community Church still shows Suspend |

## C. What to send back

Pass or fail for each step, and for any failure the step number, what you saw
and any error text.
