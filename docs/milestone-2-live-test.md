# Milestone 2 live test script

Milestone 2 has been tested locally against a mock of Supabase's API. It has
**not** been tested against the real Supabase project. Authentication is not
considered verified until every step below passes on the live project.

Record the result of each step (pass / fail and what you saw) and send it back.

## A. One-time setup

### A1. Apply the Milestone 2 migration

In the Supabase SQL Editor, create a new snippet, paste the whole of
`supabase/migrations/20261116120000_auth_churches_invitations.sql` and run it.
Expected: "Success. No rows returned".

Then run this check:

```sql
select 'functions anon can execute' as check, count(*)::text as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
union all
select 'milestone 2 functions present', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('accept_invitation', 'preview_invitation', 'list_church_members',
                     'platform_list_churches', 'is_platform_admin');
```

Expected: `0` and `5`.

### A2. Supabase Auth settings (Dashboard → Authentication)

1. **Sign In / Providers → Email:** "Confirm email" must be **on**.
2. **URL Configuration → Site URL:** `http://localhost:3000` for local testing
   (change to the deployed address later).
3. **URL Configuration → Redirect URLs:** add `http://localhost:3000/**`.
4. **Email templates: leave as they are for now.** Supabase only allows the
   templates to be edited once a custom SMTP provider is set up (confirmed on
   the live project, 16 Nov 2026). The app accepts Supabase's default links,
   with two limits during testing:
   - Open each email link in the **same browser window** you signed up in
     (for a private window, copy the link from the email and paste it there).
   - A link from "Send the email again" may land on the sign-in page saying the
     link expired. The address is still confirmed; sign in normally.

   When custom SMTP is configured before real use, switch the templates to:
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`

Supabase's built-in email sender is intended for testing and limits how many
emails it sends per hour. If confirmation emails stop arriving during testing,
that limit is the likely cause.

### A3. Run the app

```bash
git checkout milestone-2-auth-churches
npm install
cp .env.example .env.local   # then fill in the project URL and publishable key
npm run dev
```

Use only the **publishable** key. The secret key is not used in this milestone.

## B. Test steps

Use three email inboxes you control (call them OWNER, STAFF and OTHER) and a
private/incognito window for each person so sessions do not mix.

| # | Step | Expected |
|---|---|---|
| 1 | Open `http://localhost:3000/app` while signed out | Redirected to Sign in |
| 2 | Create an account with OWNER | "Check your email" page; an email arrives |
| 3 | Try to sign in as OWNER before confirming | Message asking you to confirm your email |
| 4 | Click the link in the email | Signed in and taken to "Register your church" |
| 5 | Click the same email link again | Sign-in page saying the link expired or was used |
| 6 | Register "Grace Community Church"; accept the suggested link name | Workspace opens; badge says "Awaiting verification" |
| 7 | In Supabase Table Editor, open `churches` | One row, `status = pending`, `created_by` is OWNER's user id |
| 8 | Open Staff; invite STAFF as Coordinator | A private link is shown once |
| 9 | In Table Editor, open `invitations` | `token_hash` is 64 hex characters and does not appear in the link |
| 10 | In a second private window, open the invitation link | Neutral "You have been invited" page; no church name shown |
| 11 | Create an account with STAFF from that page; confirm by email | Returned to the invitation, now showing church name and role |
| 12 | Accept | Workspace opens as Coordinator; Staff page shows no invite or role controls |
| 13 | Open the same invitation link again | "This invitation is not valid" |
| 14 | As OWNER, invite OTHER's address; open that link while signed in as STAFF | "Different email address" message; no Accept button |
| 15 | As OWNER, change STAFF to Administrator | Role updates; STAFF can now invite coordinators only |
| 16 | As OWNER, remove STAFF | STAFF disappears; STAFF's next page load goes to "Register your church" |
| 17 | Sign out as OWNER, then use "Forgot your password?" | Neutral message; reset email arrives |
| 18 | Follow the reset link and set a new password | Signed in; old password no longer works, new one does |
| 19 | Open `http://localhost:3000/platform` as OWNER | "Page not found" |

### Platform administrator (church verification)

20. Create and confirm a fourth account for yourself as platform administrator.
21. In the SQL Editor run, with that account's email:

    ```sql
    insert into public.platform_admins (user_id)
    select id from auth.users where email = 'YOUR-ADMIN-EMAIL';
    ```

22. Open `/platform` as that account. Expected: the church list, with Grace
    Community Church awaiting verification.
23. Click **Verify**. Expected: badge changes to Verified.
24. As OWNER, reload the workspace. Expected: "Your church is verified".

### Isolation with a second church

25. With OTHER's account, register "Living Faith Church".
26. Check its Staff page lists only OTHER, and nothing from Grace Community.

## C. What to send back

- The pass/fail result for each numbered step.
- For any failure: the step number, what you saw, and any error text from the
  page or from the terminal running `npm run dev`. Do not send keys or passwords.
