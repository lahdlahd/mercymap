#!/usr/bin/env bash
# Builds the app against the local mock Supabase API, starts it, and runs the
# browser journeys. Needs TEST_DATABASE_URL (PostgreSQL 15+ superuser) and
# Chrome (CHROME_PATH). All keys below are fake values for local testing only.
set -euo pipefail
cd "$(dirname "$0")/../.."
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_e2e
export NEXT_PUBLIC_SITE_URL=http://localhost:3100
export NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
export SUPABASE_SECRET_KEY=sb_secret_local_e2e
export INTAKE_HASH_SECRET=e2e-intake-hash-secret-0123456789
export TURNSTILE_SECRET_KEY=e2e-turnstile-secret
export TURNSTILE_VERIFY_URL=http://127.0.0.1:54400/turnstile/siteverify
export ANTHROPIC_API_KEY=e2e-anthropic-key
export ANTHROPIC_BASE_URL=http://127.0.0.1:54400/anthropic
export AI_MODEL=claude-haiku-5-5
export NEXT_TELEMETRY_DISABLED=1
npx next build >/dev/null
npx next start -p 3100 >/tmp/mercymap-e2e-next.log 2>&1 &
NEXT_PID=$!
trap 'kill $NEXT_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 0.5; done
journeys=("${@:-tests/e2e/journey.mjs tests/e2e/intake-journey.mjs tests/e2e/requests-journey.mjs tests/e2e/resources-journey.mjs tests/e2e/ai-journey.mjs tests/e2e/volunteers-journey.mjs tests/e2e/reports-journey.mjs}")
for j in ${journeys[@]}; do
  echo "== $j"
  node "$j"
done
