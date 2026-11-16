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
| 2 | Authentication, church creation, verification, staff invitations | Built and locally tested; **live Supabase testing outstanding** |
| 3 | Public and staff-assisted intake | Not started |
| 4 | Requests list, details, lifecycle, event history | Not started |
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

- **Milestone 2.** Tested locally only: 112 database tests, 45 unit tests and a
  60-check browser journey that drives the real app against a mock of Supabase's
  API backed by a real PostgreSQL. **Nothing in Milestone 2 has been run against
  the live Supabase project.** Real sign-up, email confirmation, sign-in,
  password reset and the Milestone 2 migration must be verified with
  [`docs/milestone-2-live-test.md`](docs/milestone-2-live-test.md) before
  authentication is treated as verified.

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
