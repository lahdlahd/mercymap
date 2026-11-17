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
| 5 | Resources, matching, transactional allocation | Not started |
| 6 | AI analysis, summaries, recommendations, safeguarding flags | Not started |
| 7 | Notifications and volunteer coordination | Not started |
| 8 | Dashboard, Reports & Impact, exports | Not started |
| 9 | Landing page and polish | Not started |
| 10 | Optional voice recording and transcription | Not started |
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

## Secrets

Server-only values (`SUPABASE_SECRET_KEY`, `INTAKE_HASH_SECRET`,
`TURNSTILE_SECRET_KEY`) live only in `.env.local` locally and in the hosting
provider's environment settings. They have no `NEXT_PUBLIC_` prefix, are read
only in `server-only` modules, and `.env*` files other than `.env.example` are
ignored by Git. The Supabase secret key is used for exactly two database
functions, both of which validate their own input.

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
