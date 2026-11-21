// Milestone 11: the daily AI cap counts analyses in the last 24 hours.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;
before(async () => {
  pool = await createTestDatabase('mercymap_test_ai_daily');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
});
after(async () => { await pool.end(); });

const runs = async () => (await db.run('service', 'select public.ai_runs_last_day() as n')).rows[0].n;
const add = (church, request, age) => pool.query(
  `insert into public.ai_analyses (church_id, request_id, status, provider, model, prompt_version, created_at, error)
   values ($1, $2, 'failed', 'test', 'm', 'v1', now() - $3::interval, 'x')`, [church, request, age]);

test('counts analyses from every church in the last 24 hours only', async () => {
  const base = await runs();
  await add(s.grace, s.rows.grace.requests, '1 hour');
  await add(s.faith, s.rows.faith.requests, '23 hours');
  await add(s.grace, s.rows.grace.requests, '25 hours');
  await add(s.faith, s.rows.faith.requests, '3 days');
  assert.equal(await runs(), base + 2);
});

test('only the server (service role) can ask', async () => {
  for (const actor of [s.u.graceOwner, s.u.platformAdmin ?? s.u.graceAdmin, 'anon']) {
    await db.rejects(actor, 'select public.ai_runs_last_day()', [], /permission denied/);
  }
});
