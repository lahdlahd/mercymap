// Milestone 7: in-app notifications, volunteers and volunteer tasks.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner, DENIED } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;
before(async () => {
  pool = await createTestDatabase('mercymap_test_notify');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
  await pool.query(`update public.churches set status = 'verified' where id in ($1, $2)`, [s.grace, s.faith]);
});
after(async () => { await pool.end(); });

const staffSubmit = async (text, o = {}) => (await db.run(o.actor ?? s.u.graceCoord,
  'select * from public.staff_submit_request($1,$2,$3,$4,$5,$6,$7,$8)',
  [o.church ?? s.grace, o.category ?? 'food', text, o.qty ?? 1, o.name ?? 'Ada Sample', 'none', null, o.area ?? null])).rows[0];
const notes = async (user, type, requestId) => (await pool.query(
  `select * from public.notifications where recipient_user_id = $1 and type = $2 and ($3::uuid is null or request_id = $3)
   order by created_at`, [user, type, requestId ?? null])).rows;
const graceMembers = () => [s.u.graceOwner, s.u.graceAdmin, s.u.graceCoord];
const events = async (id) => (await pool.query(
  'select event_type, actor_user_id, note from public.request_events where request_id = $1 order by created_at, id', [id])).rows;

describe('notifications: new requests', () => {
  test('a staff-recorded request notifies every other active member, with no personal details', async () => {
    const r = await staffSubmit('Please help, I am Ada and my number is 0803 555 0101. We need rice.');
    assert.equal((await notes(s.u.graceCoord, 'new_request', r.id)).length, 0, 'not the person who recorded it');
    for (const u of [s.u.graceOwner, s.u.graceAdmin]) {
      const [n] = await notes(u, 'new_request', r.id);
      assert.equal(n.title, `New request ${r.reference}`);
      assert.equal(n.body, 'Food and groceries · recorded by staff');
      assert.ok(!/Ada|0803|rice/.test(n.title + n.body));
    }
    for (const u of [s.u.faithOwner, s.u.faithCoord]) assert.equal((await notes(u, 'new_request', r.id)).length, 0);
  });
  test('a public request notifies every active member; suspended members get nothing', async () => {
    await pool.query(`update public.church_memberships set status = 'suspended' where id = $1`, [s.m.graceAdmin]);
    try {
      const { rows } = await db.run('service', 'select * from public.submit_public_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['grace-community', 'b'.repeat(64), 'clothing', 'Two school uniforms please.', 2, null, 'none', null, null]);
      const id = (await pool.query('select id from public.requests where reference = $1', [rows[0].reference])).rows[0].id;
      assert.equal((await notes(s.u.graceOwner, 'new_request', id))[0].body, 'Clothing · online form');
      assert.equal((await notes(s.u.graceCoord, 'new_request', id)).length, 1);
      assert.equal((await notes(s.u.graceAdmin, 'new_request', id)).length, 0);
    } finally {
      await pool.query(`update public.church_memberships set status = 'active' where id = $1`, [s.m.graceAdmin]);
    }
  });
});

describe('notifications: needs attention', () => {
  test('a keyword flag notifies every member, without the reason text', async () => {
    const r = await staffSubmit('My husband beats me and we have no food.');
    for (const u of graceMembers()) {
      const [n] = await notes(u, 'needs_attention', r.id);
      assert.equal(n.title, `Needs attention: ${r.reference}`);
      assert.equal(n.body, 'Raised by the keyword check. A person should review it.');
    }
  });
  test('a staff flag skips the person who raised it; acknowledging sends nothing; raising again notifies again', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await db.run(s.u.graceAdmin, 'select public.flag_request_attention($1, $2)', [r.id, 'Sounds worried about home.']);
    assert.equal((await notes(s.u.graceAdmin, 'needs_attention', r.id)).length, 0);
    const [n] = await notes(s.u.graceOwner, 'needs_attention', r.id);
    assert.equal(n.body, 'Raised by a staff member. A person should review it.');
    assert.ok(!n.body.includes('worried'));
    await db.run(s.u.graceOwner, 'select public.acknowledge_request_attention($1, $2)', [r.id, 'Called; fine.']);
    assert.equal((await notes(s.u.graceCoord, 'needs_attention', r.id)).length, 1);
    await db.run(s.u.graceOwner, 'select public.flag_request_attention($1, $2)', [r.id, 'New concern.']);
    assert.equal((await notes(s.u.graceCoord, 'needs_attention', r.id)).length, 2);
  });
  test('history lists "submitted" before the keyword flag every time', async () => {
    for (let i = 0; i < 8; i += 1) {
      const r = await staffSubmit('He threatened me again last night, we need food.');
      assert.deepEqual((await events(r.id)).map((e) => e.event_type), ['submitted', 'attention_flagged']);
    }
  });
});

describe('notifications: low stock', () => {
  let res;
  const approve = async (qty) => {
    const r = await staffSubmit('We need food for the week please.', { qty });
    await pool.query(`update public.requests set status = 'awaiting_match' where id = $1`, [r.id]);
    await db.run(s.u.graceCoord, 'select public.approve_allocation($1, $2, $3, null)', [r.id, 'awaiting_match', res]);
    return r;
  };
  before(async () => {
    res = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity, manager_user_id)
      values ($1, 'Rice bags', 'food', 'bag', 10, $2) returning id`, [s.grace, s.u.graceCoord])).rows[0].id;
  });
  const low = (u) => pool.query(`select * from public.notifications where recipient_user_id = $1 and type = 'low_stock' and title = 'Stock running low: Rice bags'`, [u]).then((x) => x.rows);

  test('nothing while stock is healthy', async () => {
    await approve(7);
    for (const u of graceMembers()) assert.equal((await low(u)).length, 0);
  });
  test('owner, admin and the responsible person are told once when it falls to 2', async () => {
    await approve(1);
    for (const u of graceMembers()) {
      const n = await low(u);
      assert.equal(n.length, 1, u);
      assert.equal(n[0].body, '2 bag available of 10.');
    }
    await approve(1);
    for (const u of graceMembers()) assert.equal((await low(u)).length, 1, 'not repeated');
  });
  test('after a restock it can notify again', async () => {
    await db.run(s.u.graceOwner, `select public.save_resource($1,$2,'Rice bags','food',null,'bag',30,'church',null,'{}',null,null,$3,'active')`,
      [res, s.grace, s.u.graceCoord]);
    assert.equal((await pool.query('select low_stock_notified_at from public.resources where id = $1', [res])).rows[0].low_stock_notified_at, null);
    await approve(18);
    assert.equal((await low(s.u.graceOwner)).length, 2);
  });
  test('a coordinator who is not responsible for the resource is not told', async () => {
    const other = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Beans', 'food', 'bag', 3) returning id`, [s.grace])).rows[0].id;
    const r = await staffSubmit('We need food for the week please.', { qty: 2 });
    await pool.query(`update public.requests set status = 'awaiting_match' where id = $1`, [r.id]);
    await db.run(s.u.graceOwner, 'select public.approve_allocation($1, $2, $3, null)', [r.id, 'awaiting_match', other]);
    const q = `select count(*)::int n from public.notifications where recipient_user_id = $1 and title = 'Stock running low: Beans'`;
    assert.equal((await pool.query(q, [s.u.graceOwner])).rows[0].n, 1);
    assert.equal((await pool.query(q, [s.u.graceCoord])).rows[0].n, 0);
  });
});

describe('reading notifications', () => {
  test('a member sees only their own, with an unread count, and can mark some or all read', async () => {
    const r = await staffSubmit('We need food for the week please.', { actor: s.u.graceOwner });
    const list = (await db.run(s.u.graceCoord, 'select public.list_notifications($1) as v', [s.grace])).rows[0].v;
    assert.ok(list.items.length > 0 && list.unread > 0);
    const mine = (await pool.query('select id from public.notifications where recipient_user_id = $1', [s.u.graceCoord])).rows.map((x) => x.id);
    assert.ok(list.items.every((i) => mine.includes(i.id)));
    const first = list.items.find((i) => i.request_id === r.id);
    assert.equal((await db.run(s.u.graceCoord, 'select public.mark_notifications_read($1, $2) as n', [s.grace, [first.id]])).rows[0].n, 1);
    const count = async () => (await db.run(s.u.graceCoord, 'select public.unread_notification_count($1) as n', [s.grace])).rows[0].n;
    assert.equal(await count(), list.unread - 1);
    await db.run(s.u.graceCoord, 'select public.mark_notifications_read($1)', [s.grace]);
    assert.equal(await count(), 0);
    assert.ok((await pool.query('select count(*)::int n from public.notifications where recipient_user_id = $1 and read_at is null', [s.u.graceOwner])).rows[0].n > 0,
      "marking all read does not touch other people's");
  });
  test("another church's list, someone else's ids and anonymous callers get nothing", async () => {
    await db.rejects(s.u.faithCoord, 'select public.list_notifications($1)', [s.grace], /forbidden/);
    assert.equal((await db.run(s.u.faithCoord, 'select public.unread_notification_count($1) as n', [s.grace])).rows[0].n, 0);
    const theirs = (await pool.query('select id from public.notifications where recipient_user_id = $1 and read_at is null limit 1', [s.u.graceOwner])).rows[0].id;
    assert.equal((await db.run(s.u.graceAdmin, 'select public.mark_notifications_read($1, $2) as n', [s.grace, [theirs]])).rows[0].n, 0);
    await db.rejects('anon', 'select public.list_notifications($1)', [s.grace], /permission denied/);
    await db.rejects(s.u.graceOwner, `insert into public.notifications (church_id, recipient_user_id, type, title) values ($1,$2,'x_y','x')`,
      [s.grace, s.u.graceOwner], DENIED);
  });
});

describe('volunteers', () => {
  const save = (actor, id, name, phone, skills, notes, consent, status = 'active', church = s.grace) =>
    db.run(actor, 'select public.save_volunteer($1,$2,$3,$4,$5,$6,$7,$8) as id', [id, church, name, phone, skills, notes, consent, status]);

  test('adding a volunteer with a phone needs their consent, which is recorded', async () => {
    await db.rejects(s.u.graceCoord, 'select public.save_volunteer($1,$2,$3,$4,$5,$6,$7)',
      [null, s.grace, 'Bola Driver', '0803 000 0001', [], null, false], /consent_required/);
    const id = (await save(s.u.graceCoord, null, '  Bola Driver ', '0803 000 0001', ['Driving', 'driving', ' Cooking '], 'Weekends', true)).rows[0].id;
    const v = (await pool.query('select * from public.volunteers where id = $1', [id])).rows[0];
    assert.equal(v.full_name, 'Bola Driver');
    assert.ok(v.consent_given_at);
    assert.deepEqual(v.skills, ['cooking', 'driving']);
    const log = (await pool.query(`select actor_user_id from public.audit_logs where action = 'volunteer.created' and entity_id = $1`, [id])).rows;
    assert.equal(log[0].actor_user_id, s.u.graceCoord);
  });
  test('without a phone no consent is needed; removing the phone clears the consent', async () => {
    const id = (await save(s.u.graceCoord, null, 'Chi Helper', null, [], null, false)).rows[0].id;
    assert.equal((await pool.query('select consent_given_at from public.volunteers where id = $1', [id])).rows[0].consent_given_at, null);
    await save(s.u.graceCoord, id, 'Chi Helper', '0803 000 0002', [], null, true);
    await save(s.u.graceCoord, id, 'Chi Helper', null, [], null, false);
    const v = (await pool.query('select phone, consent_given_at from public.volunteers where id = $1', [id])).rows[0];
    assert.deepEqual(v, { phone: null, consent_given_at: null });
  });
  test('validation', async () => {
    for (const [args, err] of [
      [['X', null, [], null, false], /invalid_name/],
      [['Dayo', '12ab', [], null, true], /invalid_phone/],
      [['Dayo', null, Array.from({ length: 11 }, (_, i) => `skill ${i}`), null, false], /invalid_skills/],
      [['Dayo', null, ['x'.repeat(41)], null, false], /invalid_skills/],
      [['Dayo', null, [], 'n'.repeat(501), false], /invalid_availability/],
    ]) {
      await db.rejects(s.u.graceCoord, 'select public.save_volunteer(null,$1,$2,$3,$4,$5,$6)', [s.grace, ...args], err);
    }
    await db.rejects(s.u.graceCoord, 'select public.save_volunteer(null,$1,$2,null,$3,null,false,$4)', [s.grace, 'Dayo', [], 'retired'], /invalid_status/);
  });
  test('deactivating and reactivating are audited; inactive volunteers are hidden from the default list', async () => {
    const id = (await save(s.u.graceAdmin, null, 'Efe Runner', null, [], null, false)).rows[0].id;
    await save(s.u.graceAdmin, id, 'Efe Runner', null, [], null, false, 'inactive');
    const list = (await db.run(s.u.graceAdmin, 'select public.list_volunteers($1) as v', [s.grace])).rows[0].v;
    assert.ok(!list.some((v) => v.id === id));
    const all = (await db.run(s.u.graceAdmin, 'select public.list_volunteers($1, true) as v', [s.grace])).rows[0].v;
    assert.equal(all.find((v) => v.id === id).status, 'inactive');
    await save(s.u.graceAdmin, id, 'Efe Runner', null, [], null, false, 'active');
    const actions = (await pool.query(`select action from public.audit_logs where entity_id = $1 order by id`, [id])).rows.map((x) => x.action);
    assert.deepEqual(actions, ['volunteer.created', 'volunteer.deactivated', 'volunteer.reactivated']);
  });
  test('other churches, direct writes and anonymous callers are refused', async () => {
    await db.rejects(s.u.faithCoord, 'select public.save_volunteer(null,$1,$2,null,$3,null,false)', [s.grace, 'Planted', []], /forbidden/);
    await db.rejects(s.u.faithCoord, 'select public.save_volunteer($1,$2,$3,null,$4,null,false)',
      [s.rows.grace.volunteers, s.faith, 'Moved', []], /forbidden/);
    await db.rejects(s.u.faithCoord, 'select public.list_volunteers($1)', [s.grace], /forbidden/);
    await db.rejects(s.u.graceCoord, `insert into public.volunteers (church_id, full_name) values ($1, 'Direct')`, [s.grace], DENIED);
    await db.rejects('anon', 'select public.list_volunteers($1)', [s.grace], /permission denied/);
  });
});

describe('volunteer tasks', () => {
  let vol, other;
  before(async () => {
    vol = (await db.run(s.u.graceCoord, `select public.save_volunteer(null,$1,'Funmi Rider',null,'{}',null,false) as id`, [s.grace])).rows[0].id;
    other = (await db.run(s.u.graceCoord, `select public.save_volunteer(null,$1,'Gbenga Walker',null,'{}',null,false) as id`, [s.grace])).rows[0].id;
  });
  const approved = async (status = 'approved') => {
    const r = await staffSubmit('We need food for the week please.');
    await pool.query('update public.requests set status = $2 where id = $1', [r.id, status]);
    return r;
  };
  const assign = (actor, r, v, from = 'approved', brief = 'Deliver one food package to the church hall.') =>
    db.run(actor, 'select public.create_assignment($1,$2,$3,$4) as id', [r.id, from, v, brief]);
  const move = (actor, id, from, to) => db.run(actor, 'select public.update_assignment_status($1,$2,$3)', [id, from, to]);

  test('assigning records history and audit with who did it', async () => {
    const r = await approved();
    const id = (await assign(s.u.graceCoord, r, vol)).rows[0].id;
    const a = (await pool.query('select * from public.assignments where id = $1', [id])).rows[0];
    assert.equal(a.status, 'assigned');
    assert.equal(a.assigned_by, s.u.graceCoord);
    const e = (await events(r.id)).at(-1);
    assert.deepEqual([e.event_type, e.actor_user_id, e.note], ['volunteer_assigned', s.u.graceCoord, 'Task given to Funmi Rider.']);
    assert.equal((await pool.query(`select count(*)::int n from public.audit_logs where action = 'assignment.created' and entity_id = $1`, [id])).rows[0].n, 1);
  });
  test('only approved or in-progress requests, from a current page', async () => {
    for (const status of ['submitted', 'awaiting_match', 'fulfilled', 'declined']) {
      const r = await approved(status);
      await db.rejects(s.u.graceCoord, 'select public.create_assignment($1,$2,$3,$4)', [r.id, status, vol, 'x'], /not_approved/);
    }
    const r = await approved('in_progress');
    await db.rejects(s.u.graceCoord, 'select public.create_assignment($1,$2,$3,$4)', [r.id, 'approved', vol, 'x'], /status_changed/);
    assert.ok((await assign(s.u.graceCoord, r, vol, 'in_progress')).rows[0].id);
  });
  test('volunteer must be active and from this church; brief required; no duplicate open task', async () => {
    const r = await approved();
    await db.rejects(s.u.graceCoord, 'select public.create_assignment($1,$2,$3,$4)', [r.id, 'approved', s.rows.faith.volunteers, 'x'], /volunteer_not_found/);
    const sleepy = (await db.run(s.u.graceCoord, `select public.save_volunteer(null,$1,'Hauwa Away',null,'{}',null,false,'inactive') as id`, [s.grace])).rows[0].id;
    await db.rejects(s.u.graceCoord, 'select public.create_assignment($1,$2,$3,$4)', [r.id, 'approved', sleepy, 'x'], /volunteer_inactive/);
    await db.rejects(s.u.graceCoord, 'select public.create_assignment($1,$2,$3,$4)', [r.id, 'approved', vol, '   '], /invalid_brief/);
    await assign(s.u.graceCoord, r, vol);
    await db.rejects(s.u.graceCoord, 'select public.create_assignment($1,$2,$3,$4)', [r.id, 'approved', vol, 'again'], /already_assigned/);
    assert.ok((await assign(s.u.graceCoord, r, other)).rows[0].id, 'a second volunteer is fine');
  });
  test('status moves forward only; completing tells the person who assigned it', async () => {
    const r = await approved();
    const id = (await assign(s.u.graceCoord, r, vol)).rows[0].id;
    await db.rejects(s.u.graceAdmin, 'select public.update_assignment_status($1,$2,$3)', [id, 'in_progress', 'completed'], /status_changed/);
    await move(s.u.graceAdmin, id, 'assigned', 'in_progress');
    await db.rejects(s.u.graceAdmin, 'select public.update_assignment_status($1,$2,$3)', [id, 'in_progress', 'assigned'], /invalid_transition/);
    await move(s.u.graceAdmin, id, 'in_progress', 'completed');
    const a = (await pool.query('select status, completed_at from public.assignments where id = $1', [id])).rows[0];
    assert.equal(a.status, 'completed');
    assert.ok(a.completed_at);
    const [n] = await notes(s.u.graceCoord, 'task_completed', r.id);
    assert.equal(n.title, `Volunteer task completed: ${r.reference}`);
    assert.equal((await notes(s.u.graceAdmin, 'task_completed', r.id)).length, 0);
    await db.rejects(s.u.graceAdmin, 'select public.update_assignment_status($1,$2,$3)', [id, 'completed', 'cancelled'], /invalid_transition/);
    assert.deepEqual((await events(r.id)).filter((e) => e.event_type === 'volunteer_task_updated').map((e) => e.note),
      ["Funmi Rider's task: started.", "Funmi Rider's task: completed."]);
    assert.equal((await pool.query('select status from public.requests where id = $1', [r.id])).rows[0].status, 'approved', 'request not fulfilled by this');
  });
  test('completing your own task sends no notification', async () => {
    const r = await approved();
    const id = (await assign(s.u.graceCoord, r, vol)).rows[0].id;
    await move(s.u.graceCoord, id, 'assigned', 'completed');
    assert.equal((await notes(s.u.graceCoord, 'task_completed', r.id)).length, 0);
  });
  test('declining an approved request cancels open tasks, leaves completed ones, and returns stock', async () => {
    const res = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Task test pack', 'food', 'pack', 50) returning id`, [s.grace])).rows[0].id;
    const r = await staffSubmit('We need food for the week please.');
    await pool.query(`update public.requests set status = 'awaiting_match' where id = $1`, [r.id]);
    await db.run(s.u.graceCoord, 'select public.approve_allocation($1,$2,$3,null)', [r.id, 'awaiting_match', res]);
    const open = (await assign(s.u.graceCoord, r, vol)).rows[0].id;
    const done = (await assign(s.u.graceCoord, r, other)).rows[0].id;
    await move(s.u.graceCoord, done, 'assigned', 'completed');
    await db.run(s.u.graceCoord, 'select public.change_request_status($1,$2,$3,$4)', [r.id, 'approved', 'declined', 'Helped elsewhere.']);
    const st = async (id) => (await pool.query('select status from public.assignments where id = $1', [id])).rows[0].status;
    assert.equal(await st(open), 'cancelled');
    assert.equal(await st(done), 'completed');
    const last = (await events(r.id)).at(-1);
    assert.equal(last.note, '1 open volunteer task cancelled because the request was closed.');
  });
  test('request detail lists tasks with the volunteer; other churches and anonymous callers are refused', async () => {
    const r = await approved();
    await assign(s.u.graceCoord, r, vol, 'approved', 'Collect from the hall at 4pm.');
    const d = (await db.run(s.u.graceOwner, 'select public.get_request_detail($1) as v', [r.id])).rows[0].v;
    assert.equal(d.assignments.length, 1);
    assert.equal(d.assignments[0].volunteer_name, 'Funmi Rider');
    assert.equal(d.assignments[0].task_brief, 'Collect from the hall at 4pm.');
    assert.ok('ai' in d && 'allocation' in d && 'events' in d, 'earlier parts kept');
    await db.rejects(s.u.faithCoord, 'select public.create_assignment($1,$2,$3,$4)', [r.id, 'approved', vol, 'x'], /forbidden/);
    const id = (await pool.query('select id from public.assignments where request_id = $1', [r.id])).rows[0].id;
    await db.rejects(s.u.faithCoord, 'select public.update_assignment_status($1,$2,$3)', [id, 'assigned', 'cancelled'], /forbidden/);
    await db.rejects('anon', 'select public.create_assignment($1,$2,$3,$4)', [r.id, 'approved', vol, 'x'], /permission denied/);
    await db.rejects(s.u.graceCoord, `update public.assignments set status = 'completed' where id = $1`, [id], DENIED);
  });
});
