// Milestone 11: the fictional demo data script (supabase/maintenance/2026-11-demo-seed.sql).
// Runs it against a fresh database, then checks the story it tells through the
// same functions the app uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDatabase, makeRunner } from './harness.mjs';

const seed = readFileSync(new URL('../../supabase/maintenance/2026-11-demo-seed.sql', import.meta.url), 'utf8');
let pool, db, church, owner, admin, coord;

before(async () => {
  pool = await createTestDatabase('mercymap_demo_seed');
  db = makeRunner(pool);
  const user = async (email) =>
    (await pool.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
  owner = await user('owner@hopeharvest.example');
  admin = await user('admin@hopeharvest.example');
  coord = await user('coordinator@hopeharvest.example');
});
after(async () => { await pool?.end(); });

test('stops with a clear message when the demo accounts are missing', async () => {
  const fresh = await createTestDatabase('mercymap_demo_seed_empty');
  await assert.rejects(() => fresh.query(seed), /Create the three demo accounts first/);
  await fresh.end();
});

test('the seed runs and reports its status counts', async () => {
  const results = await pool.query(seed);
  const counts = Object.fromEntries(results.at(-1).rows.map((r) => [r.status, r.requests]));
  assert.deepEqual(counts, {
    approved: 1, awaiting_clarification: 1, awaiting_match: 2, cancelled: 1, declined: 2,
    fulfilled: 14, in_progress: 1, submitted: 4, unable_to_fulfil: 1, under_review: 1,
  });
  church = (await pool.query(`select * from public.churches where slug = 'hope-harvest-chapel'`)).rows[0];
  assert.equal(church.status, 'verified');
});

test('the guards it paused are back on', async () => {
  await assert.rejects(() => pool.query('delete from public.request_events'), /append_only/);
  await assert.rejects(() => pool.query('update public.audit_logs set action = action'), /append_only/);
  const off = await pool.query(`select tgrelid::regclass::text as t, tgname from pg_trigger
                                 where tgname in ('set_updated_at', 'append_only') and tgenabled <> 'O'`);
  assert.deepEqual(off.rows, []);
});

test('three staff with the right roles', async () => {
  const rows = (await pool.query(
    `select user_id, role from public.church_memberships where church_id = $1 order by role`, [church.id])).rows;
  assert.deepEqual(rows.map((r) => r.role), ['admin', 'coordinator', 'owner']);
});

test('nothing is in the future and each history reads in order', async () => {
  for (const [table, col] of [['requests', 'created_at'], ['requests', 'updated_at'], ['request_events', 'created_at'],
    ['allocations', 'approved_at'], ['allocations', 'fulfilled_at'], ['assignments', 'completed_at'],
    ['notifications', 'created_at'], ['audit_logs', 'created_at'], ['resources', 'created_at'], ['volunteers', 'created_at']]) {
    const n = (await pool.query(`select count(*)::int as n from public.${table} where church_id = $1 and ${col} > now()`, [church.id])).rows[0].n;
    assert.equal(n, 0, `${table}.${col} in the future`);
  }
  // Every request: first event is "submitted" at the request's own time, then
  // the events match the status path with strictly increasing times.
  const reqs = (await pool.query(`select id, created_at, status from public.requests where church_id = $1`, [church.id])).rows;
  assert.equal(reqs.length, 28);
  for (const r of reqs) {
    const ev = (await pool.query(
      `select event_type, to_status, created_at from public.request_events where request_id = $1 order by created_at, id`, [r.id])).rows;
    assert.equal(ev[0].to_status, 'submitted');
    assert.equal(ev[0].created_at.getTime(), r.created_at.getTime());
    const statusEvents = ev.filter((e) => e.to_status);
    assert.equal(statusEvents.at(-1).to_status, r.status, `last status event for ${r.id}`);
    for (let i = 1; i < statusEvents.length; i++) {
      assert.ok(statusEvents[i].created_at > statusEvents[i - 1].created_at, 'status events strictly increase');
    }
  }
});

test('dashboard tiles tell the demo story', async () => {
  const d = (await db.run(owner, 'select public.dashboard_summary($1) as d', [church.id])).rows[0].d;
  assert.equal(d.open, 10);
  assert.deepEqual(
    [d.new, d.attention, d.awaiting_match, d.approved, d.in_progress, d.low_stock],
    [4, 1, 2, 1, 1, 1]);
});

test('reports show activity in every period', async () => {
  for (const [days, minReceived] of [[7, 8], [30, 18], [90, 25], [365, 28]]) {
    const r = (await db.run(coord, 'select public.report_summary($1, $2) as r', [church.id, days])).rows[0].r;
    const received = r.totals.received;
    assert.ok(r.totals.fulfilled > 0, `${days} days: fulfilled`);
    assert.ok(received >= minReceived, `${days} days: received ${received}`);
  }
});

test('stock is consistent and baby care packs are running low', async () => {
  const res = (await db.run(admin, 'select public.list_resources($1) as j', [church.id])).rows[0].j;
  assert.equal(res.length, 9);
  const baby = res.find((r) => r.name === 'Baby care pack');
  assert.deepEqual([baby.total_quantity, baby.reserved, baby.distributed, baby.available], [8, 2, 4, 2]);
  for (const r of res) assert.equal(r.reserved + r.distributed + r.available, r.total_quantity, r.name);
  const low = (await pool.query(
    `select count(*)::int as n from public.notifications where church_id = $1 and type = 'low_stock'`, [church.id])).rows[0].n;
  assert.ok(low >= 1);
});

test('one open safeguarding flag, one acknowledged; recent notifications unread', async () => {
  const flags = (await pool.query(
    `select attention_source, attention_acknowledged_at is not null as ack from public.requests
      where church_id = $1 and attention_flag order by created_at`, [church.id])).rows;
  assert.deepEqual(flags, [{ attention_source: 'keyword', ack: true }, { attention_source: 'keyword', ack: false }]);
  const unread = (await db.run(owner, 'select public.unread_notification_count($1) as n', [church.id])).rows[0].n;
  assert.ok(unread >= 4 && unread <= 10, `unread ${unread}`);
});

test('every request still waits for real AI analysis', async () => {
  const rows = (await pool.query(
    `select ai_status, count(*)::int as n from public.requests where church_id = $1 group by ai_status`, [church.id])).rows;
  assert.deepEqual(rows, [{ ai_status: 'pending', n: 28 }]);
  assert.equal((await pool.query('select count(*)::int as n from public.ai_analyses')).rows[0].n, 0);
});

test('the public request page is live for the demo church', async () => {
  const r = (await db.run('service', `select public.get_public_intake('hope-harvest-chapel') as j`)).rows[0].j;
  assert.equal(r.church.name, 'Hope Harvest Chapel');
});

test('a second run changes nothing', async () => {
  const before = (await pool.query('select count(*)::int as n from public.requests')).rows[0].n;
  await assert.rejects(() => pool.query(seed), /already seeded/);
  assert.equal((await pool.query('select count(*)::int as n from public.requests')).rows[0].n, before);
});
