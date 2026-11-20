# Deploying MERCYMAP (Vercel + Supabase)

Secrets go only into Vercel's Environment Variables screen and your own
`.env.local`. Never paste them into chat, issues, commits or screenshots.

## 0. Before you start

- Supabase migrations are all applied (the last is `20261121090000_ai_waiting.sql`).
- You know your Supabase project's **region** (Supabase → Project Settings → General).
- The code you deploy is `main`. Deploying `main` now is fine: everything
  merged later deploys automatically.

## 1. Cloudflare Turnstile (real keys for the public request page)

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Name: `MERCYMAP`. Hostnames: your Vercel address (for example
   `mercymap.vercel.app`; add it after step 3 if you do not know it yet) and
   `localhost`. Widget mode: **Managed**.
3. Keep the **Site key** and **Secret key** for step 3.

## 2. Email: Brevo SMTP (so confirmation and password-reset emails reach anyone)

1. Brevo → verify a sender address (for example a MERCYMAP Gmail).
2. Brevo → **SMTP & API** → **SMTP** → generate an **SMTP key**.
3. Supabase → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**:
   host `smtp-relay.brevo.com`, port `587`, username = the Brevo SMTP login,
   password = the SMTP key, sender email = the verified address, sender name
   `MERCYMAP`. Save.
4. Supabase → **Authentication → Rate Limits**: emails per hour about 30 (raise if needed).

## 3. Vercel project

1. vercel.com → **Add New → Project** → import `lahdlahd/mercymap`.
   Framework: Next.js (detected). Project name `mercymap` gives
   `https://mercymap.vercel.app` if that name is free.
2. **Environment Variables** (Production and Preview):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pwnldbvaoetqlqsxnney.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → publishable key |
| `NEXT_PUBLIC_SITE_URL` | Your Vercel address, e.g. `https://mercymap.vercel.app` (no trailing slash) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key (step 1) |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys → **secret** key |
| `INTAKE_HASH_SECRET` | A **new** random value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TURNSTILE_SECRET_KEY` | Turnstile secret key (step 1) |
| `ANTHROPIC_API_KEY` | Anthropic console key (with credit) |
| `AI_MODEL` | `claude-haiku-5-5` |

3. **Deploy**. If the address Vercel gives differs from what you put in
   `NEXT_PUBLIC_SITE_URL`, correct the variable and **Redeploy** (public
   variables are fixed at build time).
4. Vercel → Project → **Settings → Functions → Function Region**: choose the
   region closest to your Supabase project, then redeploy. This keeps every
   page fast.

## 4. Supabase Auth URLs

Supabase → **Authentication → URL Configuration**:

- **Site URL**: your Vercel address.
- **Redirect URLs**: add `https://<your-vercel-address>/**` and keep
  `http://localhost:3000/**` for local testing.

## 5. Check production

| # | Check | Expected |
|---|---|---|
| P1 | Open the Vercel address | Home page with the verse; padlock in the address bar |
| P2 | `/robots.txt` and `/opengraph-image` | Rules and the green preview picture |
| P3 | Share the address in WhatsApp to yourself | The preview card shows MERCYMAP and the verse |
| P4 | Sign in as the demo owner | Overview of Hope Harvest Chapel |
| P5 | Requests → **Analyse waiting requests** | "AI suggestions added to … requests." |
| P6 | In a private window open `/request/hope-harvest-chapel`, submit a request (the real Turnstile check appears) | A reference number; the request appears in the demo owner's list with AI suggestions after a few seconds |
| P7 | Sign up with a new real address you own | A confirmation email arrives (from Brevo); the link opens the Vercel site |
| P8 | As the demo owner, Settings → Staff, invite that address as coordinator, and open the link shown (MERCYMAP shows the link once; you send it yourself, for example by WhatsApp) | Signed in as that address, accepting the invitation joins the church |
| P9 | On a phone, open the Vercel address and the demo owner's overview | Everything fits; no sideways scrolling |
