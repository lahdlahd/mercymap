// Milestone 11: analysing the requests still waiting for AI suggestions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;
before(async () => {
  pool = await createTestDatabase('mercymap_test_ai_waiting');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
  await pool.query(`update public.churches set status = 'verified' where id in ($1, $2)`, [s.grace, s.faith]);
  // Grace: the fixture request is pending. Add one failed with attempts left,
  // one failed with none left, one done, and one anonymised.
  const add = async (fields) => (await pool.query(
    `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at,
                                  ai_status, ai_attempts, anonymized_at)
     values ($1, 'public', 'food', 'Synthetic', now(), $2, $3, $4) returning reference`,
    [s.grace, fields.status, fields.attempts ?? 0, fields.anonymized ? new Date() : null])).rows[0].reference;
  s.failedRetry = await add({ status: 'failed', attempts: 1 });
  s.failedSpent = await add({ status: 'failed', attempts: 3 });
  s.done = await add({ status: 'done', attempts: 1 });
  s.anon = await add({ status: 'pending', anonymized: true });
});
after(async () => { await pool.end(); });

const count = (actor, church) => db.run(actor, 'select public.ai_waiting_count($1) as n', [church]);
const start = (actor, church, limit = 30) => db.run(actor, 'select public.ai_start_waiting($1, $2) as refs', [church, limit]);

test('owners and admins see how many requests are waiting', async () => {
  for (const actor of [s.u.graceOwner, s.u.graceAdmin]) {
    assert.equal((await count(actor, s.grace)).rows[0].n, 2);
  }
});

test('coordinators, other churches, outsiders and the public cannot', async () => {
  for (const actor of [s.u.graceCoord, s.u.faithOwner, s.u.outsider]) {
    await db.rejects(actor, 'select public.ai_waiting_count($1)', [s.grace], /forbidden/);
    await db.rejects(actor, 'select public.ai_start_waiting($1, 30)', [s.grace], /forbidden/);
  }
  await db.rejects('anon', 'select public.ai_start_waiting($1, 30)', [s.grace], /permission denied/);
});

test('starting returns pending and retryable requests only, newest first, and is audited', async () => {
  const refs = (await start(s.u.graceAdmin, s.grace)).rows[0].refs;
  const pendingRef = (await pool.query('select reference from public.requests where id = $1', [s.rows.grace.requests])).rows[0].reference;
  assert.deepEqual(refs, [s.failedRetry, pendingRef]);
  assert.ok(!refs.includes(s.failedSpent) && !refs.includes(s.done) && !refs.includes(s.anon));
  const log = (await pool.query(
    `select actor_user_id, metadata from public.audit_logs where action = 'request.ai_waiting_started'`)).rows;
  assert.deepEqual(log, [{ actor_user_id: s.u.graceAdmin, metadata: { count: 2 } }]);
});

test('each returned reference can then be claimed by the server for analysis', async () => {
  const refs = (await start(s.u.graceOwner, s.grace)).rows[0].refs;
  for (const ref of refs) {
    const claimed = (await db.run('service', 'select public.ai_claim($1, false) as v', [ref])).rows[0].v;
    assert.ok(claimed, `claim ${ref}`);
  }
  // Now processing, so nothing is waiting and a second start returns nothing.
  assert.equal((await count(s.u.graceOwner, s.grace)).rows[0].n, 0);
  assert.deepEqual((await start(s.u.graceOwner, s.grace)).rows[0].refs, []);
});

test('the limit is capped at 30', async () => {
  const values = Array.from({ length: 35 }, (_, i) => `($1, 'public', 'food', 'Synthetic ${i}', now())`).join(',');
  await pool.query(`insert into public.requests (church_id, channel, category_key, original_text, consent_given_at) values ${values}`, [s.faith]);
  assert.equal((await start(s.u.faithOwner, s.faith, 500)).rows[0].refs.length, 30);
});

test('a suspended church cannot start analyses', async () => {
  await pool.query(`update public.churches set status = 'suspended' where id = $1`, [s.faith]);
  await db.rejects(s.u.faithOwner, 'select public.ai_start_waiting($1, 30)', [s.faith], /church_suspended/);
  await pool.query(`update public.churches set status = 'verified' where id = $1`, [s.faith]);
});
