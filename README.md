# MERCYMAP

**Helping churches turn compassion into coordinated community impact.**

MERCYMAP is a multi-church platform for receiving assistance requests, matching
them to church resources, coordinating volunteers and reporting impact. Churches
and their staff log in; people asking for help never need an account.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Supabase
(PostgreSQL, Auth, Storage) · Zod · Recharts · Vercel · Cloudflare Turnstile

## Build status

| # | Milestone | Status |
|---|---|---|
| 1 | Database schema, RLS, tenant isolation, security tests | Complete (see verification notes) |
| 2 | Authentication, church creation, verification, staff invitations | Complete; live tests passed (see verification notes) |
| 3 | Public and staff-assisted intake | Complete; live tests passed (see verification notes) |
| 4 | Requests list, details, lifecycle, event history | Complete; live tests passed (see verification notes) |
| 5 | Resources, matching, transactional allocation | Complete; migration applied live, live test steps skipped (see verification notes) |
| 6 | AI analysis, summaries, recommendations, safeguarding flags | Complete; migration applied live, partly tested live (no Anthropic key yet; see verification notes) |
| 7 | Notifications and volunteer coordination | Complete; all live tests passed 20 Nov 2026 |
| 8 | Dashboard, Reports & Impact, exports | Complete; live tests passed 20 Nov 2026 |
| 9 | Landing page and polish | Complete; all live tests passed 20 Nov 2026 |
| 10 | Voice recording and transcription | Deferred (decision of 20 Nov 2026): stays on the roadmap as an accessibility feature, to be built after the main product and demo are ready |
| 11 | Demo data, regression testing, demo preparation | Not started |

### Verification notes

- **Milestone 1.** The 85 database tests pass on a local PostgreSQL 16 using a
  stand-in for Supabase's `auth` schema and roles. The migrations were applied to
  the live Supabase project on 16 Nov 2026 and a structural check passed there
  (RLS on all 15 tables, no anonymous grants, no anonymous function access,
  24 policies, 9 categories). **The behavioural test suite has not been run
  against the live Supabase project; that verification is still outstanding.**

- **Milestone 2.** Locally: 112 database tests, 45 unit tests and a 60-check
  browser journey against a mock Supabase API. Live: the full test script was run
  against the live Supabase project on 16–17 Nov 2026 and every step passed; see
  [`docs/milestone-2-live-test-results.md`](docs/milestone-2-live-test-results.md),
  including the limitations carried forward.

- **Milestone 3.** Locally: 128 database tests, 84 unit tests and two browser
  journeys (60 and 54 checks), including a scan for secrets in browser code.
  Live: every step of the test script passed against the live Supabase project
  on 17 Nov 2026; see [`docs/milestone-3-live-test-results.md`](docs/milestone-3-live-test-results.md).

- **Milestone 4.** Locally: 154 database tests, 99 unit tests and three browser
  journeys (60, 54 and 54 checks). Live: every step of the test script passed
  against the live Supabase project on 17 Nov 2026; see
  [`docs/milestone-4-live-test-results.md`](docs/milestone-4-live-test-results.md).

- **Milestone 5.** Locally: 197 database tests (including concurrent approvals
  of the same request and of competing requests for the last stock), 126 unit
  tests and four browser journeys (60, 54, 54 and 77 checks). Approval and
  reservation happen in one database transaction that locks the request and the
  resource; leaving Approved or In progress for any outcome other than delivery
  returns the stock and needs a note. Matching rules are fixed: same church,
  same kind of help, active, within its dates, enough available, covers the
  area (no areas = any area). Also fixes a Milestone 3 bug where text lost a
  leading or trailing letter "v". Live: the migration was applied and its check
  passed on 17 Nov 2026, but **the 25 live test steps were skipped by decision of
  the project owner**; see [`docs/milestone-5-live-test-results.md`](docs/milestone-5-live-test-results.md).
  They are to be run in the Milestone 11 regression pass.

- **Milestone 6.** AI suggestions with Anthropic Claude (default model
  `claude-haiku-5-5`). The AI gives a summary, key facts, questions to ask,
  urgency, a possible different kind of help, a possible safeguarding concern
  and, when a request awaits a resource, which fitting resource to consider. It
  never changes a status, approves, reserves or declines; the only thing it can
  do on its own is raise "needs attention" on a never-flagged request, and only
  a person can clear that. Only the description (with names, phone numbers and
  emails removed), kind of help, quantity and area are sent; resources are
  described without names or ids. A database keyword check flags safeguarding
  words on every new request even when the AI is off. Accepting a suggested kind
  of help is a staff action recorded in history and the audit log. Locally: 228
  database tests (mutation-checked), 149 unit tests and five browser journeys
  (60, 54, 54, 77 and 44 checks) against a fake Claude endpoint. Live, 17 Nov
  2026: migration check, the no-key panel and the keyword safeguarding flag
  passed; **the real Claude API has not been tested yet (no key with credit) and
  the other steps were skipped by decision of the project owner**; see
  [`docs/milestone-6-live-test-results.md`](docs/milestone-6-live-test-results.md).

- **Milestone 7.** In-app notifications created by the database (new request,
  needs attention, stock running low, volunteer task completed) with a bell,
  unread count and mark read; they carry only a reference and the kind of help.
  Volunteers (no logins; phone kept only with their consent) and volunteer tasks
  on approved requests with a minimal brief (no name or story; the person's
  phone only if staff tick it), Copy brief and Send on WhatsApp. Declining,
  cancelling or closing a request cancels its open tasks. Volunteer and task
  changes go through checked functions and the audit log; direct staff writes
  were withdrawn. Also fixes the order of history entries written in one step.
  Locally: 251 database tests (four rules mutation-checked), 161 unit tests and
  six browser journeys (60, 54, 54, 77, 44 and 50 checks). Live, 20 Nov 2026:
  every step passed against the real Supabase project; see
  [`docs/milestone-7-live-test-results.md`](docs/milestone-7-live-test-results.md).

- **Milestone 8.** Overview tiles (needs attention, new, open, awaiting a
  resource, approved, in delivery, helped and units given this month,
  resources running low), each linking to the list it counts. Reports & Impact
  for the last 7, 30 (default), 90 or 365 Lagos days: five figures, four charts
  (requests over time, by kind of help, outcomes, stock given out) with a table
  view, and the share of approvals that used the AI-suggested resource. CSV
  exports (requests, stock given out, volunteer tasks) for owners and admins
  only, with no names, phone numbers or descriptions, protected against
  spreadsheet formula injection, posted from this site only, and every download
  in the audit log. All figures are computed from the church's own records by
  membership-checked database functions. Locally: 268 database tests (exact
  figures for every period and boundary; four rules mutation-checked), 169 unit
  tests and seven browser journeys (60, 54, 54, 77, 44, 50 and 47 checks).
  Live, 20 Nov 2026: passed against the real Supabase project (coordinator view
  and SQL comparison skipped); see
  [`docs/milestone-8-live-test-results.md`](docs/milestone-8-live-test-results.md).

- **Milestone 9.** Landing page with Matthew 25:40 (World English Bible, public
  domain) and its reference, How it works, features, safety and a "Looking for
  help?" section that sends people to their church's own link (no public
  directory of churches). Polish: page titles on every page, link previews
  (Open Graph and Twitter tags, a generated 1200×630 image), robots rules that
  keep request pages and the app out of search, a skip link and focusable main
  region, a contrast-safe wordmark, a valid structure for the overview tiles,
  and the 404 title. Milestone 2 fixes: a platform administrator cannot change
  the status of a church they belong to, and "Register your church" shows any
  live invitation to the person's own email. Locally: 276 database tests, 169
  unit tests and eight browser journeys, including axe-core accessibility
  checks with no violations on 18 public and staff pages and phone-layout
  checks on each. Live, 20 Nov 2026: every step passed
  ([`docs/milestone-9-live-test-results.md`](docs/milestone-9-live-test-results.md)).

## Secrets

Server-only values (`SUPABASE_SECRET_KEY`, `INTAKE_HASH_SECRET`,
`TURNSTILE_SECRET_KEY`, `ANTHROPIC_API_KEY`) live only in `.env.local` locally
and in the hosting provider's environment settings. They have no `NEXT_PUBLIC_`
prefix, are read only in `server-only` modules, and `.env*` files other than
`.env.example` are ignored by Git. The Supabase secret key is used only for
database functions granted to the service role, each of which validates its own
input: `get_public_intake`, `submit_public_request`, `ai_claim` and `ai_save`.
The Anthropic key is sent only in the `x-api-key` header to the Anthropic API;
AI errors are stored as short codes, never response bodies.

## Repository layout

```
src/app/               Pages, route handlers and server actions
src/components/        Shared interface components
src/lib/               Validation, auth helpers, Supabase clients
src/proxy.ts           Refreshes the session on every request
supabase/migrations/   SQL migrations, applied in filename order
tests/db/              Database security and integrity tests
tests/unit/            Unit tests
tests/e2e/             Browser journey against a mock Supabase API
docs/                  Live test scripts
```

## Database security model

- Every tenant-owned table carries `church_id` and has Row Level Security enabled.
- The anonymous role has no privileges and no policies. Public intake goes
  through a server endpoint, never straight to the database.
- Child tables use composite `(church_id, id)` foreign keys, so a row cannot
  reference another church's record, even when written by the server.
- Roles live in `church_memberships`. Memberships, request status, allocations,
  AI output, events, notifications and audit logs have no direct write path for
  staff; they change only through functions that check authorisation themselves.
- Stock is never stored as a counter: `available = total - reserved - fulfilled`,
  computed from `allocations` and guarded by a row lock on the resource.

## Running locally

```bash
npm install
cp .env.example .env.local   # project URL and publishable key only
npm run dev
```

## Tests

```bash
npm run lint && npm run typecheck
npm test                                  # unit tests
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:e2e   # also needs Chrome (CHROME_PATH)
```

The database and end-to-end tests need any PostgreSQL 15+ server you can create
databases on. They build throwaway databases, apply a small stand-in for
Supabase's `auth` schema and roles, then apply every migration. The end-to-end
journey fakes Supabase Auth, so it does not replace live testing.

## Applying the migrations to Supabase

With the Supabase CLI linked to your project: `supabase db push`, or paste each
file into the SQL Editor in filename order.
All demo and test data in this repository is fictional.
