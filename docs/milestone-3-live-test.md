# Milestone 3 live test script

Milestone 3 (public assistance requests and staff-assisted intake) has been
tested locally against a mock of Supabase's API. It is **not** verified until
every step below passes against the live Supabase project.

Record pass or fail for each step and send the results back. Never send keys.

## A. Setup

### A1. Apply the migration

In the Supabase SQL Editor, in a new snippet, paste the whole of
`supabase/migrations/20261117100000_intake.sql` and run it. Expected:
"Success. No rows returned".

Then run this check:

```sql
select 'functions anon can execute' as check, count(*)::text as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
union all
select 'milestone 3 functions present', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('get_public_intake', 'submit_public_request', 'staff_submit_request')
union all
select 'staff can insert requests directly',
       has_table_privilege('authenticated', 'public.requests', 'insert')::text
union all
select 'server role can submit public requests',
       has_function_privilege('service_role',
         'public.submit_public_request(text,text,text,text,integer,text,text,text,text)', 'execute')::text
union all
select 'signed-in staff can submit public requests',
       has_function_privilege('authenticated',
         'public.submit_public_request(text,text,text,text,integer,text,text,text,text)', 'execute')::text;
```

Expected, top to bottom: `0`, `3`, `false`, `true`, `false`.

### A2. Update the code

Stop the app (Ctrl+C), then:

```
git fetch
git checkout milestone-3-intake
git pull
npm install
```

### A3. Add four settings to `.env.local`

Open it with `notepad .env.local` and add these lines at the end:

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SUPABASE_SECRET_KEY=
INTAKE_HASH_SECRET=
```

- The two Turnstile values are Cloudflare's public **test** keys, which always
  pass. Real keys replace them when the app is deployed.
- **SUPABASE_SECRET_KEY:** Supabase dashboard → Project Settings → API Keys →
  Secret keys. Copy the key starting `sb_secret_` (create one if there is none)
  and paste it after the `=`. This key bypasses all database security rules:
  keep it only in this file and, later, in Vercel. Never paste it anywhere else.
- **INTAKE_HASH_SECRET:** run this in Command Prompt and paste the output after
  the `=`:

  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Save, then start the app with `npm run dev`.

## B. Test steps

Use your normal window for the Grace Community Church owner, the InPrivate
window for the Living Faith owner, and a **new InPrivate window that is not
signed in** for the public visitor.

| # | Window | Do this | Expected |
|---|---|---|---|
| 1 | Visitor | Open `http://localhost:3000/request/grace-community-church` | Church name, a red "This is not an emergency service" box, and the request form. No sign-in, no account |
| 2 | Visitor | Open `http://localhost:3000/request/living-faith` (or its actual link name) and `http://localhost:3000/request/no-such-church` | Both say "This request page is not available" and name no church |
| 3 | Visitor | On Grace's page, click **Send my request** without filling anything | Errors for kind of help, description, phone number and the consent box |
| 4 | Visitor | Fill the form: Food, a description, quantity 3, "Call me" with a phone number, tick the box. Wait for the security check to show success, then send | "Your request has been sent" with a reference like `MM-XXXXXX-XXXXXX` |
| 5 | Supabase | Table Editor → `requests` | A new row: `channel` public, `status` submitted, `created_by` empty, `church_id` matching Grace in `churches` |
| 6 | Supabase | Table Editor → `request_events` | A `submitted` row for that request |
| 7 | Supabase | Table Editor → `intake_rate_limits` | One row whose `ip_hash` is a long string of letters and digits, not an IP address |
| 8 | Owner | Sidebar → **Record a request**. Record one for someone "in person" | "Request recorded" with a reference. In `requests`: `channel` staff, `created_by` is your user id |
| 9 | Living Faith | Record a request from its own workspace | Recorded; its `church_id` is Living Faith's, not Grace's |
| 10 | Owner | Settings → Church profile: add a public phone number and emergency guidance, then **Save details** | "Church details saved" |
| 11 | Visitor | Reload Grace's request page | The red box shows your guidance and the phone number |
| 12 | Visitor | Send requests until **five** have been sent from this computer within the hour, then try a sixth | The sixth says "Too many requests have been sent from this connection" |
| 13 | Owner (Command Prompt) | Stop the app, run `npm run build`, then `findstr /s /i /m "sb_secret" .next\static\*.js` | No file names printed (the secret key is not in any browser code). Then `npm run dev` again |
| 14 | Owner (Command Prompt) | `git status` | `.env.local` is not listed (it is never committed) |

Optional, to see a failed security check: change `TURNSTILE_SECRET_KEY` to
`2x0000000000000000000000000000000AA` (always fails), restart, and send a
request. Expected: "Please complete the security check". Change it back after.

## C. What to send back

Pass or fail for each step, and for any failure the step number, what you saw,
and any error text from the page or the terminal. Do not send keys.
