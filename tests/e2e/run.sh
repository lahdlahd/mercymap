#!/usr/bin/env bash
# Builds the app against the local mock Supabase API, starts it, runs the journey.
# Needs: TEST_DATABASE_URL (PostgreSQL 15+ superuser) and Chrome (CHROME_PATH).
set -euo pipefail
cd "$(dirname "$0")/../.."
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_e2e
export NEXT_PUBLIC_SITE_URL=http://localhost:3100
export NEXT_TELEMETRY_DISABLED=1
npx next build >/dev/null
npx next start -p 3100 >/tmp/mercymap-e2e-next.log 2>&1 &
NEXT_PID=$!
trap 'kill $NEXT_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 0.5; done
node tests/e2e/journey.mjs
