// Milestone 5: resources, matching, atomic approval with reservation,
// fulfilment, and stock release on every way out of Approved / In progress.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner, DENIED } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;
before(async () => {
  pool = await createTestDatabase('mercymap_test_allocation');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
});
after(async () => { await pool.end(); });

const today = async () => (await pool.query('select private.today_local()::text as d')).rows[0].d;

async function resource(churchId = s.grace, o = {}) {
  const { rows } = await pool.query(
    `insert into public.resources (church_id, name, category_key, unit, total_quantity, coverage_areas,
                                   valid_from, valid_until, status, source_type, source_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [churchId, o.name ?? 'Food packages', o.category ?? 'food', o.unit ?? 'package', o.total ?? 10,
      o.areas ?? [], o.from ?? null, o.until ?? null, o.status ?? 'active', o.sourceType ?? 'church', o.sourceName ?? null]);
  return rows[0].id;
}
async function request(churchId = s.grace, o = {}) {
  const { rows } = await pool.query(
    `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at, status, quantity_needed, area)
     values ($1, 'public', $2, 'Synthetic request for testing.', now(), $3, $4, $5) returning id`,
    [churchId, o.category ?? 'food', o.status ?? 'awaiting_match', o.qty ?? 2, o.area ?? null]);
  return rows[0].id;
}
const approve = (actor, reqId, resId, from = 'awaiting_match', note = null) =>
  db.run(actor, 'select public.approve_allocation($1, $2, $3, $4) as id', [reqId, from, resId, note]);
const change = (actor, reqId, from, to, note = null) =>
  db.run(actor, 'select public.change_request_status($1, $2, $3, $4)', [reqId, from, to, note]);
const fulfil = (actor, reqId, from, note = null) =>
  db.run(actor, 'select public.record_fulfilment($1, $2, $3)', [reqId, from, note]);
const stock = async (resId) => {
  const { rows } = await pool.query('select * from public.resource_availability where resource_id = $1', [resId]);
  const r = rows[0];
  return { available: r.available_quantity, reserved: r.reserved_quantity, distributed: r.distributed_quantity };
};
const statusOf = async (id) => (await pool.query('select status from public.requests where id = $1', [id])).rows[0].status;
const allocs = async (reqId) => (await pool.query(
  'select status, quantity, released_by, release_reason, fulfilled_by from public.allocations where request_id = $1 order by created_at', [reqId])).rows;

describe('approval reserves stock in the same step', () => {
  test('approve: request becomes Approved, stock is reserved, history records what was reserved', async () => {
    const res = await resource(s.grace, { total: 10, name: 'Rice bags', unit: 'bag' });
    const req = await request(s.grace, { qty: 3 });
    const { rows } = await approve(s.u.graceCoord, req, res, 'awaiting_match', 'Collect on Saturday.');
    assert.ok(rows[0].id);
    assert.equal(await statusOf(req), 'approved');
    assert.deepEqual(await stock(res), { available: 7, reserved: 3, distributed: 0 });
    const a = (await pool.query('select * from public.allocations where id = $1', [rows[0].id])).rows[0];
    assert.equal(a.approved_by, s.u.graceCoord);
    assert.equal(a.ai_recommended, false);
    assert.equal(a.recommendation_snapshot.available_before, 10);
    const ev = (await pool.query(`select from_status, to_status, note, actor_user_id from public.request_events where request_id = $1`, [req])).rows;
    assert.deepEqual(ev, [{ from_status: 'awaiting_match', to_status: 'approved', note: 'Reserved 3 bag from "Rice bags". Collect on Saturday.', actor_user_id: s.u.graceCoord }]);
  });

  test('only requests awaiting a match can be approved', async () => {
    const res = await resource();
    for (const status of ['submitted', 'under_review', 'awaiting_clarification', 'declined', 'fulfilled']) {
      const req = await request(s.grace, { status });
      await db.rejects(s.u.graceCoord, 'select public.approve_allocation($1, $2, $3, null)', [req, status, res], /invalid_transition/, status);
    }
    assert.deepEqual(await stock(res), { available: 10, reserved: 0, distributed: 0 });
  });

  test('a stale page cannot approve', async () => {
    const res = await resource();
    const req = await request(s.grace, { status: 'under_review' });
    await db.rejects(s.u.graceCoord, 'select public.approve_allocation($1, $2, $3, null)', [req, 'awaiting_match', res], /status_changed/);
  });

  test('a resource that does not fit is refused, with the reason, and nothing changes', async () => {
    const t = await today();
    const cases = {
      wrong_category: await resource(s.grace, { category: 'clothing' }),
      archived: await resource(s.grace, { status: 'archived' }),
      expired: await resource(s.grace, { until: '2020-01-01' }),
      not_yet_valid: await resource(s.grace, { from: '2099-01-01' }),
      not_enough: await resource(s.grace, { total: 1 }),
      area_not_covered: await resource(s.grace, { areas: ['Ijapo', 'Alagbaka'] }),
    };
    for (const [reason, res] of Object.entries(cases)) {
      const req = await request(s.grace, { qty: 2, area: 'Oke-Aro' });
      await db.rejects(s.u.graceCoord, 'select public.approve_allocation($1, $2, $3, null)', [req, 'awaiting_match', res],
        new RegExp(`resource_not_suitable: ${reason}`), reason);
      assert.equal(await statusOf(req), 'awaiting_match');
      assert.deepEqual(await allocs(req), []);
    }
    // valid today, on its first and last day
    const edge = await resource(s.grace, { from: t, until: t });
    await approve(s.u.graceCoord, await request(), edge);
  });

  test('coverage: matching ignores case and punctuation; no areas means anywhere; no request area is allowed but unconfirmed', async () => {
    const res = await resource(s.grace, { areas: ['Oke Aro', 'Ijapo'] });
    await approve(s.u.graceCoord, await request(s.grace, { area: 'oke-aro' }), res);
    await approve(s.u.graceCoord, await request(s.grace, { area: null }), res);
    const anywhere = await resource(s.grace, { areas: [] });
    await approve(s.u.graceCoord, await request(s.grace, { area: 'Somewhere Else' }), anywhere);
  });

  test('another church\'s resource cannot be used, even by knowing its id', async () => {
    const theirs = await resource(s.faith);
    const req = await request(s.grace);
    await db.rejects(s.u.graceOwner, 'select public.approve_allocation($1, $2, $3, null)', [req, 'awaiting_match', theirs], /resource_not_found/);
    assert.deepEqual(await stock(theirs), { available: 10, reserved: 0, distributed: 0 });
  });

  test('other churches and outsiders cannot approve Grace\'s requests', async () => {
    const res = await resource();
    const req = await request();
    for (const actor of [s.u.faithOwner, s.u.outsider, s.u.platformAdmin]) {
      await db.rejects(actor, 'select public.approve_allocation($1, $2, $3, null)', [req, 'awaiting_match', res], /forbidden/);
    }
  });

  test('a request can hold only one active reservation', async () => {
    const res = await resource();
    const req = await request();
    await approve(s.u.graceCoord, req, res);
    await db.rejects(s.u.graceCoord, 'select public.approve_allocation($1, $2, $3, null)', [req, 'approved', res], /invalid_transition/);
    assert.equal((await allocs(req)).length, 1);
  });
});

describe('concurrency', () => {
  test('the same request approved by three people at once: one reservation, one history entry', async () => {
    const res = await resource(s.grace, { total: 10 });
    const req = await request(s.grace, { qty: 2 });
    const results = await Promise.allSettled([
      approve(s.u.graceCoord, req, res), approve(s.u.graceOwner, req, res), approve(s.u.graceAdmin, req, res),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results.filter((x) => x.status === 'rejected')) assert.match(r.reason.message, /status_changed/);
    assert.equal((await allocs(req)).length, 1);
    assert.deepEqual(await stock(res), { available: 8, reserved: 2, distributed: 0 });
    const ev = await pool.query('select count(*)::int as n from public.request_events where request_id = $1', [req]);
    assert.equal(ev.rows[0].n, 1);
  });

  test('different requests competing for the last units: never over-allocated', async () => {
    for (let round = 0; round < 5; round++) {
      const res = await resource(s.grace, { total: 3 });
      const reqs = [await request(s.grace, { qty: 2 }), await request(s.grace, { qty: 2 }), await request(s.grace, { qty: 1 })];
      const results = await Promise.allSettled(reqs.map((r, i) => approve([s.u.graceCoord, s.u.graceOwner, s.u.graceAdmin][i], r, res)));
      const st = await stock(res);
      assert.ok(st.reserved <= 3 && st.available >= 0, `round ${round}: ${JSON.stringify(st)}`);
      for (const [i, r] of results.entries()) {
        const status = await statusOf(reqs[i]);
        if (r.status === 'fulfilled') assert.equal(status, 'approved');
        else {
          assert.match(r.reason.message, /resource_not_suitable: not_enough|insufficient_available_quantity/);
          assert.equal(status, 'awaiting_match', 'a refused approval leaves the request untouched');
          assert.deepEqual(await allocs(reqs[i]), []);
        }
      }
      assert.ok(results.filter((r) => r.status === 'fulfilled').length >= 1);
    }
  });
});

describe('delivery and fulfilment', () => {
  test('approved → in progress → fulfilled: stock moves from reserved to distributed', async () => {
    const res = await resource(s.grace, { total: 5 });
    const req = await request(s.grace, { qty: 2 });
    await approve(s.u.graceCoord, req, res);
    await change(s.u.graceCoord, req, 'approved', 'in_progress');
    assert.equal(await statusOf(req), 'in_progress');
    assert.deepEqual(await stock(res), { available: 3, reserved: 2, distributed: 0 });
    await fulfil(s.u.graceAdmin, req, 'in_progress', 'Delivered by a volunteer.');
    assert.equal(await statusOf(req), 'fulfilled');
    assert.deepEqual(await stock(res), { available: 3, reserved: 0, distributed: 2 });
    const a = (await allocs(req))[0];
    assert.equal(a.status, 'fulfilled');
    assert.equal(a.fulfilled_by, s.u.graceAdmin);
  });

  test('fulfilled straight from approved', async () => {
    const res = await resource();
    const req = await request();
    await approve(s.u.graceCoord, req, res);
    await fulfil(s.u.graceCoord, req, 'approved');
    assert.deepEqual(await stock(res), { available: 8, reserved: 0, distributed: 2 });
  });

  test('cannot fulfil without approval, twice, from a stale page, or via change_request_status', async () => {
    const res = await resource();
    const req = await request();
    await db.rejects(s.u.graceCoord, 'select public.record_fulfilment($1, $2, null)', [req, 'awaiting_match'], /invalid_transition/);
    await approve(s.u.graceCoord, req, res);
    await db.rejects(s.u.graceCoord, 'select public.change_request_status($1, $2, $3, $4)', [req, 'approved', 'fulfilled', 'x'], /requires_allocation/);
    await db.rejects(s.u.graceCoord, 'select public.record_fulfilment($1, $2, null)', [req, 'in_progress'], /status_changed/);
    await fulfil(s.u.graceCoord, req, 'approved');
    await db.rejects(s.u.graceCoord, 'select public.record_fulfilment($1, $2, null)', [req, 'approved'], /status_changed/);
    await db.rejects(s.u.graceCoord, 'select public.record_fulfilment($1, $2, null)', [req, 'fulfilled'], /invalid_transition/);
    assert.deepEqual(await stock(res), { available: 8, reserved: 0, distributed: 2 });
  });

  test('an approved request with no reservation cannot be fulfilled', async () => {
    const req = await request(s.grace, { status: 'approved' });
    await db.rejects(s.u.graceCoord, 'select public.record_fulfilment($1, $2, null)', [req, 'approved'], /no_reservation/);
    assert.equal(await statusOf(req), 'approved');
  });

  test('two people recording fulfilment at once: counted once', async () => {
    const res = await resource();
    const req = await request();
    await approve(s.u.graceCoord, req, res);
    const results = await Promise.allSettled([fulfil(s.u.graceCoord, req, 'approved'), fulfil(s.u.graceOwner, req, 'approved')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.deepEqual(await stock(res), { available: 8, reserved: 0, distributed: 2 });
  });

  test('other churches cannot fulfil', async () => {
    const res = await resource();
    const req = await request();
    await approve(s.u.graceCoord, req, res);
    await db.rejects(s.u.faithOwner, 'select public.record_fulfilment($1, $2, null)', [req, 'approved'], /forbidden/);
  });
});

describe('stock is returned whenever an approved request does not go ahead', () => {
  const exits = [
    ['approved', 'declined'], ['approved', 'cancelled'], ['approved', 'unable_to_fulfil'], ['approved', 'awaiting_match'],
    ['in_progress', 'cancelled'], ['in_progress', 'unable_to_fulfil'], ['in_progress', 'awaiting_match'],
  ];
  for (const [from, to] of exits) {
    test(`${from} → ${to} releases the reservation`, async () => {
      const res = await resource(s.grace, { total: 4 });
      const req = await request(s.grace, { qty: 3 });
      await approve(s.u.graceCoord, req, res);
      if (from === 'in_progress') await change(s.u.graceCoord, req, 'approved', 'in_progress');
      assert.deepEqual(await stock(res), { available: 1, reserved: 3, distributed: 0 });

      await db.rejects(s.u.graceCoord, 'select public.change_request_status($1, $2, $3, $4)', [req, from, to, null], /reason_required/);
      assert.deepEqual(await stock(res), { available: 1, reserved: 3, distributed: 0 }, 'refused change keeps the reservation');

      await change(s.u.graceOwner, req, from, to, 'Family moved away.');
      assert.equal(await statusOf(req), to);
      assert.deepEqual(await stock(res), { available: 4, reserved: 0, distributed: 0 });
      const a = (await allocs(req))[0];
      assert.equal(a.status, 'released');
      assert.equal(a.released_by, s.u.graceOwner);
      assert.equal(a.release_reason, 'Family moved away.');
      const ev = (await pool.query(`select note from public.request_events where request_id = $1 and to_status = $2`, [req, to])).rows[0];
      assert.equal(ev.note, 'Family moved away. (Reserved stock returned.)');
    });
  }

  test('released stock can be reserved for someone else, and the request can be matched again', async () => {
    const res = await resource(s.grace, { total: 2 });
    const first = await request(s.grace, { qty: 2 });
    const second = await request(s.grace, { qty: 2 });
    await approve(s.u.graceCoord, first, res);
    await db.rejects(s.u.graceCoord, 'select public.approve_allocation($1, $2, $3, null)', [second, 'awaiting_match', res], /not_enough/);
    await change(s.u.graceCoord, first, 'approved', 'awaiting_match', 'Wrong resource chosen.');
    await approve(s.u.graceCoord, second, res);
    assert.deepEqual(await stock(res), { available: 0, reserved: 2, distributed: 0 });
    const other = await resource(s.grace, { total: 5, name: 'Food vouchers' });
    await approve(s.u.graceCoord, first, other);
    assert.deepEqual((await allocs(first)).map((a) => a.status), ['released', 'reserved']);
  });

  test('starting delivery keeps the reservation and needs no note', async () => {
    const res = await resource();
    const req = await request();
    await approve(s.u.graceCoord, req, res);
    await change(s.u.graceCoord, req, 'approved', 'in_progress');
    assert.deepEqual(await stock(res), { available: 8, reserved: 2, distributed: 0 });
  });

  test('fulfilled stock is never returned', async () => {
    const res = await resource();
    const req = await request();
    await approve(s.u.graceCoord, req, res);
    await fulfil(s.u.graceCoord, req, 'approved');
    await db.rejects(s.u.graceCoord, 'select public.change_request_status($1, $2, $3, $4)', [req, 'fulfilled', 'cancelled', 'x'], /invalid_transition/);
    assert.deepEqual(await stock(res), { available: 8, reserved: 0, distributed: 2 });
  });

  test('a suspended church cannot approve, fulfil or release', async () => {
    const res = await resource(s.faith);
    const req = await request(s.faith);
    const req2 = await request(s.faith);
    await approve(s.u.faithOwner, req2, res);
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'suspended')`, [s.faith]);
    await db.rejects(s.u.faithOwner, 'select public.approve_allocation($1, $2, $3, null)', [req, 'awaiting_match', res], /church_suspended/);
    await db.rejects(s.u.faithOwner, 'select public.record_fulfilment($1, $2, null)', [req2, 'approved'], /church_suspended/);
    await db.rejects(s.u.faithOwner, 'select public.change_request_status($1, $2, $3, $4)', [req2, 'approved', 'cancelled', 'x y z'], /church_suspended/);
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'pending')`, [s.faith]);
  });
});

describe('matching list', () => {
  test('lists every active resource of the right kind, fitting ones first, with the reason others do not fit', async () => {
    const hopeOwner = (await pool.query(`insert into auth.users (email) values ('owner@hope.test') returning id`)).rows[0].id;
    const hope = (await db.run(hopeOwner, `select public.create_church('Hope Chapel', 'hope-chapel') as id`)).rows[0].id;
    const good = await resource(hope, { name: 'B fits', total: 5, areas: ['Ijapo'] });
    const soon = await resource(hope, { name: 'A fits, expires sooner', total: 5, until: '2099-01-01' });
    const short = await resource(hope, { name: 'Too few', total: 1 });
    const far = await resource(hope, { name: 'Other area', total: 5, areas: ['Alagbaka'] });
    await resource(hope, { name: 'Wrong kind', category: 'clothing' });
    await resource(hope, { name: 'Archived', status: 'archived' });
    const req = await request(hope, { qty: 2, area: 'ijapo' });

    const { rows } = await db.run(hopeOwner, 'select public.list_matching_resources($1) as m', [req]);
    const m = rows[0].m;
    assert.equal(m.quantity_needed, 2);
    assert.equal(m.area, 'ijapo');
    assert.deepEqual(m.resources.map((r) => [r.id, r.reason, r.coverage]), [
      [soon, null, 'any'], [good, null, 'covered'], [far, 'area_not_covered', 'not_covered'], [short, 'not_enough', 'any'],
    ]);
    assert.equal(m.resources[0].available, 5);
    for (const actor of [s.u.graceOwner, s.u.outsider]) {
      await db.rejects(actor, 'select public.list_matching_resources($1)', [req], /forbidden/);
    }
  });
});

describe('resource management', () => {
  const save = (actor, o) => db.run(actor,
    'select public.save_resource($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id',
    [o.id ?? null, o.church ?? s.grace, o.name ?? 'School bags', o.category ?? 'education', o.description ?? null,
      o.unit ?? 'bag', o.total ?? 20, o.sourceType ?? 'church', o.sourceName ?? null, o.areas ?? [],
      o.from ?? null, o.until ?? null, o.manager ?? null, o.status ?? 'active']);

  test('create, with tidied coverage areas, partner source and manager; audited', async () => {
    const { rows } = await save(s.u.graceCoord, {
      name: '  School bags  ', areas: [' Ijapo ', 'ijapo', '', 'Oke-Aro', 'oke aro'], sourceType: 'partner',
      sourceName: 'Akure Stationers', manager: s.u.graceAdmin, from: '2026-11-01', until: '2026-12-31',
    });
    const r = (await pool.query('select * from public.resources where id = $1', [rows[0].id])).rows[0];
    assert.equal(r.name, 'School bags');
    assert.deepEqual(r.coverage_areas, ['Ijapo', 'Oke-Aro']);
    assert.equal(r.source_name, 'Akure Stationers');
    assert.equal(r.manager_user_id, s.u.graceAdmin);
    const audit = await pool.query(`select actor_user_id from public.audit_logs where action = 'resource.created' and entity_id = $1`, [rows[0].id]);
    assert.equal(audit.rows[0].actor_user_id, s.u.graceCoord);
  });

  test('validation', async () => {
    const cases = [
      [{ name: ' ' }, /invalid_name/], [{ category: 'weapons' }, /invalid_category/], [{ unit: '' }, /invalid_unit/],
      [{ total: -1 }, /invalid_quantity/], [{ total: 2000000 }, /invalid_quantity/], [{ sourceType: 'gift' }, /invalid_source/],
      [{ sourceType: 'partner', sourceName: ' ' }, /partner_name_required/], [{ from: '2026-12-01', until: '2026-11-01' }, /invalid_dates/],
      [{ manager: s.u.faithOwner }, /invalid_manager/], [{ status: 'deleted' }, /invalid_status/],
      [{ areas: Array.from({ length: 21 }, (_, i) => `Area ${i}`) }, /too_many_areas/],
    ];
    for (const [o, pattern] of cases) await assert.rejects(save(s.u.graceCoord, o), pattern, JSON.stringify(o));
  });

  test('a church partner name is dropped when the source is the church', async () => {
    const { rows } = await save(s.u.graceCoord, { sourceType: 'church', sourceName: 'Leftover' });
    assert.equal((await pool.query('select source_name from public.resources where id = $1', [rows[0].id])).rows[0].source_name, null);
  });

  test('update, archive and restore are audited; total cannot drop below what is committed', async () => {
    const { rows } = await save(s.u.graceCoord, { category: 'food', total: 5 });
    const id = rows[0].id;
    await approve(s.u.graceCoord, await request(s.grace, { qty: 3 }), id);
    await assert.rejects(save(s.u.graceCoord, { id, category: 'food', total: 2 }), /total_below_committed_quantity/);
    await save(s.u.graceCoord, { id, category: 'food', total: 8 });
    await save(s.u.graceCoord, { id, category: 'food', total: 8, status: 'archived' });
    await save(s.u.graceCoord, { id, category: 'food', total: 8, status: 'active' });
    const actions = (await pool.query(`select action from public.audit_logs where entity_id = $1 order by id`, [id])).rows.map((r) => r.action);
    assert.deepEqual(actions, ['resource.created', 'resource.updated', 'resource.archived', 'resource.restored']);
  });

  test('another church cannot read, edit or move a Grace resource', async () => {
    const id = (await save(s.u.graceCoord, {})).rows[0].id;
    await assert.rejects(save(s.u.faithOwner, { id, church: s.faith }), /forbidden/);
    await assert.rejects(save(s.u.faithOwner, { id, church: s.grace }), /forbidden/);
    await assert.rejects(save(s.u.graceOwner, { id, church: s.faith }), /forbidden/);
    await db.rejects(s.u.faithOwner, 'select public.get_resource($1)', [id], /forbidden/);
    await db.rejects(s.u.faithOwner, 'select public.list_resources($1)', [s.grace], /forbidden/);
  });

  test('list and detail show computed stock and the requests it went to', async () => {
    const id = (await save(s.u.graceCoord, { name: 'Detail test', category: 'food', total: 9 })).rows[0].id;
    const req = await request(s.grace, { qty: 4 });
    await approve(s.u.graceCoord, req, id);
    const { rows } = await db.run(s.u.graceCoord, 'select public.get_resource($1) as r', [id]);
    const r = rows[0].r;
    assert.deepEqual([r.total_quantity, r.reserved, r.distributed, r.available], [9, 4, 0, 5]);
    assert.equal(r.allocations[0].request_id, req);
    assert.equal(r.category_label, 'Food and groceries');
    const list = (await db.run(s.u.graceCoord, 'select public.list_resources($1) as l', [s.grace])).rows[0].l;
    assert.ok(list.every((x) => x.status === 'active'));
    const withArchived = (await db.run(s.u.graceCoord, 'select public.list_resources($1, true) as l', [s.grace])).rows[0].l;
    assert.ok(withArchived.length >= list.length);
  });

  test('request detail includes the allocation', async () => {
    const res = await resource(s.grace, { name: 'Detail rice', unit: 'bag' });
    const req = await request(s.grace, { qty: 2 });
    await approve(s.u.graceCoord, req, res);
    const d = (await db.run(s.u.graceCoord, 'select public.get_request_detail($1) as d', [req])).rows[0].d;
    assert.equal(d.allocation.status, 'reserved');
    assert.equal(d.allocation.resource_name, 'Detail rice');
    assert.equal(d.allocation.quantity, 2);
    assert.equal(d.allocation.approved_by_email, 'coordinator@grace.test');
  });
});

describe('the anonymous role', () => {
  const z = '00000000-0000-0000-0000-000000000000';
  for (const call of [
    `select public.approve_allocation('${z}', 'awaiting_match', '${z}')`,
    `select public.record_fulfilment('${z}', 'approved')`,
    `select public.list_matching_resources('${z}')`,
    `select public.list_resources('${z}')`,
    `select public.get_resource('${z}')`,
    `select public.save_resource(null, '${z}', 'x', 'food', null, 'x', 1, 'church', null, '{}', null, null, null)`,
  ]) {
    test(`cannot call: ${call.slice(14, 45)}`, async () => { await db.rejects('anon', call, [], DENIED); });
  }
});
