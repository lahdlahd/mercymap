// Milestone 8: dashboard, reports and exports. A fixed, back-dated set of
// records gives exact expected figures for every period.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s, church, owner, admin, coord, food, clothes;
const ids = {};

before(async () => {
  pool = await createTestDatabase('mercymap_test_reports');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
  const user = async (email) => (await pool.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
  owner = await user('owner@report.test');
  admin = await user('admin@report.test');
  coord = await user('coord@report.test');
  church = (await pool.query(`insert into public.churches (name, slug, area, status) values ('Report Chapel', 'report-chapel', 'Akure', 'verified') returning id`)).rows[0].id;
  for (const [u, role] of [[owner, 'owner'], [admin, 'admin'], [coord, 'coordinator']]) {
    await pool.query('insert into public.church_memberships (church_id, user_id, role) values ($1, $2, $3)', [church, u, role]);
  }

  // Seed with triggers off so dates can be set exactly.
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("set local session_replication_role = 'replica'");
    const noon = `(((select private.today_local())::timestamp + interval '12 hours') at time zone 'Africa/Lagos')`;
    const ago = (days) => `(${noon} - interval '${days} days')`;
    food = (await c.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity) values ($1, 'Food pack', 'food', 'pack', 15) returning id`, [church])).rows[0].id;
    clothes = (await c.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity) values ($1, 'Clothes', 'clothing', 'set', 100) returning id`, [church])).rows[0].id;
    const vol = (await c.query(`insert into public.volunteers (church_id, full_name) values ($1, 'Report Volunteer') returning id`, [church])).rows[0].id;

    const req = async (key, category, status, createdSql, extra = {}) => {
      const { rows } = await c.query(
        `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at, status, created_at,
                                      requester_name, contact_method, contact_value, area, quantity_needed)
         values ($1, $2, $3, $4, now(), $5, ${createdSql}, 'Zainab Secret', 'phone_call', '0803 999 0000', 'Ijapo', 2) returning id, reference`,
        [church, extra.channel ?? 'public', category, `A secret story for ${key}.`, status]);
      ids[key] = rows[0];
      await c.query(`insert into public.request_events (church_id, request_id, event_type, to_status, created_at) values ($1, $2, 'submitted', 'submitted', ${createdSql})`, [church, rows[0].id]);
      return rows[0].id;
    };
    const event = (id, to, whenSql) => c.query(
      `insert into public.request_events (church_id, request_id, event_type, to_status, created_at) values ($1, $2, 'status_changed', $3, ${whenSql})`, [church, id, to]);
    const alloc = (id, res, qty, status, approvedSql, fulfilledSql, ai = false) => c.query(
      `insert into public.allocations (church_id, request_id, resource_id, quantity, status, approved_at, fulfilled_at, ai_recommended)
       values ($1, $2, $3, $4, $5, ${approvedSql}, ${fulfilledSql ?? 'null'}, $6)`, [church, id, res, qty, status, ai]);

    const A = await req('A', 'food', 'fulfilled', ago(2));
    await event(A, 'fulfilled', ago(1));
    await alloc(A, food, 3, 'fulfilled', ago(2), ago(1), true);
    const B = await req('B', 'food', 'fulfilled', ago(20));
    await event(B, 'fulfilled', ago(10));
    await alloc(B, food, 2, 'fulfilled', ago(15), ago(10));
    const C = await req('C', 'clothing', 'fulfilled', ago(60));
    await event(C, 'fulfilled', ago(50));
    await alloc(C, clothes, 5, 'fulfilled', ago(55), ago(50));
    const D = await req('D', 'education', 'declined', ago(200));
    await event(D, 'declined', ago(190));
    await req('E', 'food', 'awaiting_match', ago(5));
    const F = await req('F', 'clothing', 'cancelled', ago(3));
    await event(F, 'cancelled', ago(3));
    const G = await req('G', 'food', 'fulfilled', ago(400));
    await event(G, 'fulfilled', ago(399));
    // Exactly on the first moment of the 7-day period, and one minute before it.
    await req('H', 'food', 'submitted', `private.period_start(7)`, { channel: 'staff' });
    await req('I', 'food', 'submitted', `(private.period_start(7) - interval '1 minute')`);
    // Something approved and still reserved, for low stock: 15 - 5 given - 9 held = 1 left.
    const J = await req('J', 'food', 'approved', ago(1));
    await alloc(J, food, 9, 'reserved', ago(1), null);
    await c.query(`insert into public.assignments (church_id, volunteer_id, request_id, task_brief, status, completed_at, created_at)
                   values ($1, $2, $3, 'x', 'completed', ${ago(4)}, ${ago(4)}), ($1, $2, $4, 'x', 'completed', ${ago(40)}, ${ago(41)})`,
      [church, vol, A, C]);
    await c.query('commit');
  } finally {
    c.release();
  }
});
after(async () => { await pool.end(); });

const report = async (days, actor = coord) => (await db.run(actor, 'select public.report_summary($1, $2) as v', [church, days])).rows[0].v;
const sum = (rows, key) => rows.reduce((t, r) => t + Number(r[key]), 0);

describe('report figures for each period', () => {
  // J (received 1 day ago, approved) counts as received and open everywhere.
  const expected = {
    7: { received: 5, fulfilled: 1, units: 3, median: 1, tasks: 1, approvals: 2, ai: 1, food: 4, clothing: 1, open: 3, cancelled: 1, declined: 0 },
    30: { received: 7, fulfilled: 2, units: 5, median: 5.5, tasks: 1, approvals: 3, ai: 1, food: 6, clothing: 1, open: 4, cancelled: 1, declined: 0 },
    90: { received: 8, fulfilled: 3, units: 10, median: 10, tasks: 2, approvals: 4, ai: 1, food: 6, clothing: 2, open: 4, cancelled: 1, declined: 0 },
    365: { received: 9, fulfilled: 3, units: 10, median: 10, tasks: 2, approvals: 4, ai: 1, food: 6, clothing: 2, open: 4, cancelled: 1, declined: 1 },
  };
  for (const [days, e] of Object.entries(expected)) {
    test(`${days} days`, async () => {
      const r = await report(Number(days));
      assert.equal(r.totals.received, e.received, 'received');
      assert.equal(r.totals.fulfilled, e.fulfilled, 'fulfilled');
      assert.equal(Number(r.totals.units_given), e.units, 'units');
      assert.equal(Number(r.totals.median_days_to_fulfil), e.median, 'median days');
      assert.equal(r.totals.tasks_completed, e.tasks, 'tasks');
      assert.equal(r.totals.approvals, e.approvals, 'approvals');
      assert.equal(r.totals.approvals_ai_suggested, e.ai, 'ai');
      const kind = Object.fromEntries(r.by_kind.map((k) => [k.key, k.count]));
      assert.equal(kind.food ?? 0, e.food, 'food');
      assert.equal(kind.clothing ?? 0, e.clothing, 'clothing');
      const out = Object.fromEntries(r.outcomes.map((o) => [o.key, o.count]));
      assert.equal(out.open, e.open, 'open');
      assert.equal(out.cancelled, e.cancelled, 'cancelled');
      assert.equal(out.declined, e.declined, 'declined');
      assert.equal(sum(r.outcomes, 'count'), e.received, 'outcomes add up to requests received');
      assert.equal(sum(r.by_kind, 'count'), e.received, 'kinds add up to requests received');
      assert.equal(sum(r.over_time, 'received'), e.received, 'chart buckets add up to requests received');
      assert.equal(sum(r.over_time, 'fulfilled'), e.fulfilled, 'chart buckets add up to requests fulfilled');
      assert.equal(sum(r.given_by_resource, 'quantity'), e.units, 'resource chart adds up to units given');
    });
  }
  test('buckets: one per day up to 30 days, weekly for 90, monthly for 365, all inside the period', async () => {
    for (const [days, bucket, min, max] of [[7, 'day', 7, 7], [30, 'day', 30, 30], [90, 'week', 13, 14], [365, 'month', 12, 13]]) {
      const r = await report(days);
      assert.equal(r.bucket, bucket);
      assert.ok(r.over_time.length >= min && r.over_time.length <= max, `${days}: ${r.over_time.length} buckets`);
      assert.ok(r.over_time.every((b) => b.bucket >= r.from && b.bucket <= r.to), `${days}: buckets inside the period`);
      assert.equal(r.over_time[0].bucket, r.from);
    }
  });
  test('the boundary: the first moment of the period counts, one minute earlier does not', async () => {
    const seven = await report(7);
    const day0 = seven.over_time[0];
    assert.equal(day0.received, 1, 'H, at 00:00 on the first day');
  });
  test('stock given out by resource, largest first', async () => {
    const r = await report(90);
    assert.deepEqual(r.given_by_resource.map((x) => [x.name, Number(x.quantity)]), [['Clothes', 5], ['Food pack', 5]]);
  });
  test('only 7, 30, 90 and 365 days are accepted', async () => {
    for (const days of [0, 1, 31, 1000, null]) {
      await db.rejects(coord, 'select public.report_summary($1, $2)', [church, days], /invalid_period/);
    }
  });
});

describe('dashboard tiles', () => {
  test('counts come from the records', async () => {
    const d = (await db.run(coord, 'select public.dashboard_summary($1) as v', [church])).rows[0].v;
    assert.equal(d.open, 4, 'E, H, I, J');
    assert.equal(d.new, 2, 'H, I');
    assert.equal(d.awaiting_match, 1);
    assert.equal(d.approved, 1);
    assert.equal(d.in_progress, 0);
    assert.equal(d.attention, 0);
    assert.equal(d.low_stock, 1, 'Food pack: 1 of 15 left');
    const expectFulfilled = (await pool.query(
      `select count(distinct e.request_id)::int n from public.request_events e join public.requests r on r.id = e.request_id
        where e.church_id = $1 and e.to_status = 'fulfilled' and r.status = 'fulfilled'
          and e.created_at >= (date_trunc('month', private.today_local()::timestamp) at time zone 'Africa/Lagos')`, [church])).rows[0].n;
    assert.equal(d.fulfilled_this_month, expectFulfilled);
  });
  test('tiles match the request list filters they link to', async () => {
    const d = (await db.run(coord, 'select public.dashboard_summary($1) as v', [church])).rows[0].v;
    const list = async (status, attention = false) => (await db.run(coord,
      'select public.list_requests($1, $2, null, null, null, $3, 100, 0) as v', [church, status, attention])).rows[0].v;
    for (const [tile, status] of [['open', 'open'], ['new', 'submitted'], ['awaiting_match', 'awaiting_match'], ['approved', 'approved'], ['in_progress', 'in_progress']]) {
      const l = await list(status);
      assert.equal(l.total, d[tile], `${tile} tile = ?status=${status} list`);
    }
    assert.equal((await list('all', true)).total, d.attention, 'attention tile = ?status=attention list');
  });
});

describe('who can see what', () => {
  test("members of another church get nothing; anonymous callers are refused", async () => {
    await db.rejects(s.u.graceOwner, 'select public.report_summary($1, 30)', [church], /forbidden/);
    await db.rejects(s.u.graceOwner, 'select public.dashboard_summary($1)', [church], /forbidden/);
    await db.rejects(s.u.graceOwner, `select public.export_report($1, 'requests', 30)`, [church], /forbidden/);
    await db.rejects('anon', 'select public.report_summary($1, 30)', [church], /permission denied/);
  });
  test("another church's records never enter the figures", async () => {
    const before = await report(365);
    await pool.query(`insert into public.requests (church_id, channel, category_key, original_text, consent_given_at)
                      values ($1, 'public', 'food', 'Another church request.', now())`, [s.grace]);
    const after = await report(365);
    assert.equal(after.totals.received, before.totals.received);
  });
  test('coordinators can view reports but not export', async () => {
    assert.ok(await report(30, coord));
    await db.rejects(coord, `select public.export_report($1, 'requests', 30)`, [church], /forbidden/);
  });
});

describe('exports', () => {
  const exportRows = async (kind, days, actor = owner) =>
    (await db.run(actor, 'select public.export_report($1, $2, $3) as v', [church, kind, days])).rows[0].v;

  test('requests export: only the agreed columns, no names, phones or descriptions', async () => {
    const rows = await exportRows('requests', 30);
    assert.equal(rows.length, 7);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['area', 'channel', 'closed', 'kind_of_help', 'quantity', 'received', 'reference', 'status']);
    const text = JSON.stringify(rows);
    assert.ok(!/Zainab|Secret|0803|secret story/i.test(text));
    const a = rows.find((r) => r.reference === ids.A.reference);
    assert.equal(a.status, 'fulfilled');
    assert.match(a.closed, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(rows.find((r) => r.reference === ids.E.reference).closed, '');
  });
  test('stock and tasks exports', async () => {
    const stock = await exportRows('stock', 90, admin);
    assert.equal(stock.length, 3);
    assert.deepEqual(Object.keys(stock[0]).sort(), ['ai_suggested', 'given_out', 'quantity', 'reference', 'resource', 'source', 'unit']);
    assert.equal(stock.find((r) => r.reference === ids.A.reference).ai_suggested, 'yes');
    const tasks = await exportRows('tasks', 90);
    assert.equal(tasks.length, 2);
    assert.deepEqual(Object.keys(tasks[0]).sort(), ['completed', 'given', 'reference', 'status']);
    assert.ok(!JSON.stringify(tasks).includes('Report Volunteer'), 'no volunteer names');
  });
  test('every export is audited with who, what, period and row count', async () => {
    const before = (await pool.query(`select count(*)::int n from public.audit_logs where action = 'report.exported' and church_id = $1`, [church])).rows[0].n;
    await exportRows('requests', 7, admin);
    const logs = (await pool.query(`select actor_user_id, metadata from public.audit_logs where action = 'report.exported' and church_id = $1 order by id`, [church])).rows;
    assert.equal(logs.length, before + 1);
    assert.equal(logs.at(-1).actor_user_id, admin);
    assert.deepEqual(logs.at(-1).metadata, { kind: 'requests', days: 7, rows: 5 });
  });
  test('unknown kinds and periods are refused and not audited', async () => {
    const count = async () => (await pool.query(`select count(*)::int n from public.audit_logs where action = 'report.exported' and church_id = $1`, [church])).rows[0].n;
    const before = await count();
    await db.rejects(owner, `select public.export_report($1, 'people', 30)`, [church], /invalid_kind/);
    await db.rejects(owner, `select public.export_report($1, 'requests', 31)`, [church], /invalid_period/);
    assert.equal(await count(), before);
  });
});
