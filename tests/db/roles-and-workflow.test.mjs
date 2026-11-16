// Role rules, column-level protection, and the integrity guards that hold
// regardless of which code path writes a row.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner, DENIED } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;

before(async () => {
  pool = await createTestDatabase('mercymap_test_roles');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
});
after(async () => { await pool.end(); });

const roleOf = async (membershipId) =>
  (await pool.query('select role from public.church_memberships where id = $1', [membershipId])).rows[0]?.role;

describe('church registration and verification', () => {
  test('a new church starts pending and its creator becomes owner', async () => {
    const { rows } = await pool.query('select status, created_by from public.churches where id = $1', [s.grace]);
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].created_by, s.u.graceOwner);
    assert.equal(await roleOf(s.m.graceOwner), 'owner');
  });
  test('a user with a pending church cannot register another', async () => {
    await db.rejects(s.u.graceOwner, `select public.create_church('Second', 'second-church')`, [], /pending_church_exists/);
  });
  test('slugs must be unique and well formed', async () => {
    await db.rejects(s.u.outsider, `select public.create_church('Copy', 'grace-community')`, [], /duplicate key/);
    await db.rejects(s.u.outsider, `select public.create_church('Bad', 'Bad Slug!')`, [], /check constraint/);
  });
  test('staff cannot verify their own church or change its slug', async () => {
    await db.rejects(s.u.graceOwner, `update public.churches set status = 'verified' where id = $1`, [s.grace], DENIED);
    await db.rejects(s.u.graceOwner, `update public.churches set slug = 'new-slug' where id = $1`, [s.grace], DENIED);
    await db.rejects(s.u.graceOwner, `select public.set_church_status($1, 'verified')`, [s.grace], /forbidden/);
  });
  test('owners and admins edit the profile; coordinators cannot', async () => {
    const ok = await db.run(s.u.graceAdmin,
      `update public.churches set emergency_guidance = 'Call 112 in an emergency.' where id = $1`, [s.grace]);
    assert.equal(ok.rowCount, 1);
    await db.blocked(s.u.graceCoord, `update public.churches set name = 'Renamed' where id = $1`, [s.grace]);
  });
  test('a platform administrator verifies a church and the action is audited', async () => {
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'verified')`, [s.grace]);
    const { rows } = await pool.query('select status, verified_by from public.churches where id = $1', [s.grace]);
    assert.equal(rows[0].status, 'verified');
    assert.equal(rows[0].verified_by, s.u.platformAdmin);
    const audit = await pool.query(
      `select 1 from public.audit_logs where church_id = $1 and action = 'church.status_changed'`, [s.grace]);
    assert.equal(audit.rowCount, 1);
  });
});

describe('roles', () => {
  test('nobody can write memberships directly', async () => {
    await db.rejects(s.u.graceOwner,
      `update public.church_memberships set role = 'owner' where id = $1`, [s.m.graceCoord], DENIED);
    await db.rejects(s.u.graceCoord,
      `update public.church_memberships set role = 'owner' where user_id = $1`, [s.u.graceCoord], DENIED);
    await db.rejects(s.u.outsider,
      `insert into public.church_memberships (church_id, user_id, role) values ($1, $2, 'owner')`,
      [s.grace, s.u.outsider], DENIED);
  });
  test('coordinators and admins cannot change roles, including their own', async () => {
    await db.rejects(s.u.graceCoord, `select public.set_member_role($1, 'owner')`, [s.m.graceCoord], /forbidden/);
    await db.rejects(s.u.graceAdmin, `select public.set_member_role($1, 'owner')`, [s.m.graceAdmin], /forbidden/);
    await db.rejects(s.u.graceAdmin, `select public.set_member_role($1, 'admin')`, [s.m.graceCoord], /forbidden/);
    assert.equal(await roleOf(s.m.graceCoord), 'coordinator');
    assert.equal(await roleOf(s.m.graceAdmin), 'admin');
  });
  test('an owner cannot change their own role', async () => {
    await db.rejects(s.u.graceOwner, `select public.set_member_role($1, 'admin')`, [s.m.graceOwner], /cannot_change_own_role/);
  });
  test('an owner of another church cannot change or remove Grace members', async () => {
    await db.rejects(s.u.faithOwner, `select public.set_member_role($1, 'coordinator')`, [s.m.graceAdmin], /forbidden/);
    await db.rejects(s.u.faithOwner, `select public.remove_member($1)`, [s.m.graceCoord], /forbidden/);
    await db.rejects(s.u.faithOwner, `select public.set_member_role($1, 'owner')`, ['00000000-0000-0000-0000-000000000000'], /forbidden/);
  });
  test('an owner can promote a colleague, and the change is audited', async () => {
    await db.run(s.u.faithOwner, `select public.set_member_role($1, 'admin')`, [s.m.faithCoord]);
    assert.equal(await roleOf(s.m.faithCoord), 'admin');
    const audit = await pool.query(
      `select metadata from public.audit_logs where church_id = $1 and action = 'member.role_changed'`, [s.faith]);
    assert.deepEqual(audit.rows[0].metadata, { from: 'coordinator', to: 'admin' });
    await db.run(s.u.faithOwner, `select public.set_member_role($1, 'coordinator')`, [s.m.faithCoord]);
  });
  test('an admin can remove a coordinator but not an owner or another admin', async () => {
    await db.rejects(s.u.graceAdmin, `select public.remove_member($1)`, [s.m.graceOwner], /forbidden/);
    await db.rejects(s.u.graceAdmin, `select public.remove_member($1)`, [s.m.graceAdmin], /cannot_remove_self/);
    await db.rejects(s.u.graceCoord, `select public.remove_member($1)`, [s.m.graceAdmin], /forbidden/);
  });
  test('the last owner cannot be removed, demoted or suspended by anyone', async () => {
    await db.rejects('service', 'delete from public.church_memberships where id = $1', [s.m.graceOwner], /last_owner_required/);
    await db.rejects('service', `update public.church_memberships set role = 'admin' where id = $1`, [s.m.graceOwner], /last_owner_required/);
    await db.rejects('service', `update public.church_memberships set status = 'suspended' where id = $1`, [s.m.graceOwner], /last_owner_required/);
    await assert.rejects(pool.query('delete from auth.users where id = $1', [s.u.graceOwner]), /last_owner_required/);
  });
  test('with two owners, one can step the other down, but not both', async () => {
    await db.run(s.u.graceOwner, `select public.set_member_role($1, 'owner')`, [s.m.graceAdmin]);
    await db.run(s.u.graceAdmin, `select public.set_member_role($1, 'admin')`, [s.m.graceOwner]);
    assert.equal(await roleOf(s.m.graceOwner), 'admin');
    await db.rejects('service', `update public.church_memberships set role = 'admin' where id = $1`, [s.m.graceAdmin], /last_owner_required/);
    // restore
    await db.run(s.u.graceAdmin, `select public.set_member_role($1, 'owner')`, [s.m.graceOwner]);
    await db.run(s.u.graceOwner, `select public.set_member_role($1, 'admin')`, [s.m.graceAdmin]);
  });
});

describe('invitations', () => {
  const invite = (actor, churchId, role, n) => db.run(actor,
    `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, $5, now() + interval '7 days')`,
    [churchId, `new${n}@grace.test`, role, String(n).repeat(64).slice(0, 64), actor]);

  test('an owner can invite an admin or a coordinator', async () => {
    await invite(s.u.graceOwner, s.grace, 'admin', 1);
    await invite(s.u.graceOwner, s.grace, 'coordinator', 2);
  });
  test('an admin can invite a coordinator but not an admin', async () => {
    await invite(s.u.graceAdmin, s.grace, 'coordinator', 3);
    await assert.rejects(invite(s.u.graceAdmin, s.grace, 'admin', 4), DENIED);
  });
  test('a coordinator cannot invite anyone', async () => {
    await assert.rejects(invite(s.u.graceCoord, s.grace, 'coordinator', 5), DENIED);
  });
  test('nobody can be invited straight to owner', async () => {
    await assert.rejects(invite(s.u.graceOwner, s.grace, 'owner', 6), /check constraint/);
  });
  test('an invitation cannot be issued in someone else\'s name', async () => {
    await db.rejects(s.u.graceAdmin,
      `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
       values ($1, 'x@grace.test', 'coordinator', $2, $3, now() + interval '1 day')`,
      [s.grace, '7'.repeat(64), s.u.graceOwner], DENIED);
  });
  test('the stored token hash is never readable by staff', async () => {
    await db.rejects(s.u.graceOwner, 'select token_hash from public.invitations', [], DENIED);
    const coord = await db.run(s.u.graceCoord, 'select id from public.invitations');
    assert.equal(coord.rowCount, 0);
  });
});

describe('requests', () => {
  const insert = (actor, extraCols = '', extraVals = '', params = []) => db.run(actor,
    `insert into public.requests (church_id, channel, created_by, category_key, original_text, consent_given_at${extraCols})
     values ($1, $2, $3, 'food', 'Visitor needs groceries.', now()${extraVals}) returning id, status, reference`, params);

  test('staff-assisted submission is recorded with its author and starts as submitted', async () => {
    const { rows } = await insert(s.u.graceCoord, '', '', [s.grace, 'staff', s.u.graceCoord]);
    assert.equal(rows[0].status, 'submitted');
    assert.match(rows[0].reference, /^MM-[0-9A-F]{6}-[0-9A-F]{6}$/);
  });
  test('staff cannot pose as the public channel or as another author', async () => {
    await assert.rejects(insert(s.u.graceCoord, '', '', [s.grace, 'public', null]), DENIED);
    await assert.rejects(insert(s.u.graceCoord, '', '', [s.grace, 'staff', s.u.graceOwner]), DENIED);
  });
  test('status, reference and attention fields cannot be set on insert', async () => {
    await assert.rejects(insert(s.u.graceCoord, ', status', `, 'fulfilled'`, [s.grace, 'staff', s.u.graceCoord]), DENIED);
    await assert.rejects(insert(s.u.graceCoord, ', reference', `, 'MM-CHOSEN'`, [s.grace, 'staff', s.u.graceCoord]), DENIED);
    await assert.rejects(insert(s.u.graceCoord, ', attention_flag', `, true`, [s.grace, 'staff', s.u.graceCoord]), DENIED);
  });
  test('members cannot update or delete requests directly', async () => {
    await db.rejects(s.u.graceOwner, `update public.requests set status = 'fulfilled' where church_id = $1`, [s.grace], DENIED);
    await db.rejects(s.u.graceOwner, 'delete from public.requests where church_id = $1', [s.grace], DENIED);
  });
  test('consent is mandatory and a phone contact method needs a number', async () => {
    await db.rejects('service',
      `insert into public.requests (church_id, channel, category_key, original_text) values ($1, 'public', 'food', 'x')`,
      [s.grace], /consent_given_at/);
    await db.rejects('service',
      `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at, contact_method)
       values ($1, 'public', 'food', 'x', now(), 'sms')`, [s.grace], /check constraint/);
  });
  test('request references are unique and not sequential', async () => {
    const { rows } = await pool.query('select reference from public.requests');
    assert.equal(new Set(rows.map((r) => r.reference)).size, rows.length);
  });
});

describe('notifications', () => {
  test('only the recipient sees a notification, even inside the same church', async () => {
    const mine = await db.run(s.u.graceOwner, 'select id from public.notifications');
    assert.equal(mine.rowCount, 1);
    const colleague = await db.run(s.u.graceAdmin, 'select id from public.notifications');
    assert.equal(colleague.rowCount, 0);
  });
  test('the recipient can mark it read but cannot change its content', async () => {
    const read = await db.run(s.u.graceOwner, 'update public.notifications set read_at = now()');
    assert.equal(read.rowCount, 1);
    await db.rejects(s.u.graceOwner, `update public.notifications set title = 'edited'`, [], DENIED);
    await db.rejects(s.u.graceOwner, 'delete from public.notifications', [], DENIED);
  });
});

describe('audit trail and event history', () => {
  test('only owners and admins read the audit trail', async () => {
    const owner = await db.run(s.u.graceOwner, 'select id from public.audit_logs');
    assert.ok(owner.rowCount >= 1);
    const coord = await db.run(s.u.graceCoord, 'select id from public.audit_logs');
    assert.equal(coord.rowCount, 0);
  });
  test('audit logs and request events are append-only for everyone', async () => {
    for (const table of ['audit_logs', 'request_events']) {
      await db.rejects('service', `update public.${table} set created_at = now()`, [], /append_only/);
      await db.rejects('service', `delete from public.${table}`, [], /append_only/);
    }
  });
});

describe('inventory integrity', () => {
  let resource, requests;
  const availability = async () => (await pool.query(
    'select * from public.resource_availability where resource_id = $1', [resource])).rows[0];
  const allocate = (requestId, quantity, run = db.run) => run('service',
    `insert into public.allocations (church_id, request_id, resource_id, quantity)
     values ($1, $2, $3, $4) returning id`, [s.grace, requestId, resource, quantity]);

  before(async () => {
    resource = (await pool.query(
      `insert into public.resources (church_id, name, category_key, unit, total_quantity)
       values ($1, 'Rice bags', 'food', 'bag', 3) returning id`, [s.grace])).rows[0].id;
    requests = [];
    for (let i = 0; i < 6; i++) {
      requests.push((await pool.query(
        `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at)
         values ($1, 'public', 'food', 'Synthetic request ${i}', now()) returning id`, [s.grace])).rows[0].id);
    }
  });

  test('members cannot write allocations directly', async () => {
    await db.rejects(s.u.graceOwner,
      `insert into public.allocations (church_id, request_id, resource_id, quantity) values ($1, $2, $3, 1)`,
      [s.grace, requests[0], resource], DENIED);
    await db.rejects(s.u.graceOwner, `update public.allocations set status = 'fulfilled'`, [], DENIED);
  });

  test('reserving holds stock; fulfilling moves it to distributed; releasing returns it', async () => {
    const a = (await allocate(requests[0], 2)).rows[0].id;
    assert.deepEqual(await availability(), {
      resource_id: resource, church_id: s.grace, total_quantity: 3,
      reserved_quantity: 2, distributed_quantity: 0, available_quantity: 1,
    });
    await pool.query(`update public.allocations set status = 'fulfilled', fulfilled_at = now() where id = $1`, [a]);
    const afterFulfil = await availability();
    assert.equal(afterFulfil.reserved_quantity, 0);
    assert.equal(afterFulfil.distributed_quantity, 2);
    assert.equal(afterFulfil.available_quantity, 1);

    const b = (await allocate(requests[1], 1)).rows[0].id;
    assert.equal((await availability()).available_quantity, 0);
    await pool.query(`update public.allocations set status = 'released', released_at = now() where id = $1`, [b]);
    assert.equal((await availability()).available_quantity, 1);
  });

  test('over-allocation is refused', async () => {
    await assert.rejects(allocate(requests[2], 2), /insufficient_available_quantity/);
    assert.equal((await availability()).available_quantity, 1);
  });

  test('a request cannot hold two active allocations', async () => {
    await assert.rejects(allocate(requests[0], 1), /allocations_one_active_per_request/);
  });

  test('a fulfilled or released allocation cannot be reopened, edited or deleted', async () => {
    const { rows } = await pool.query(
      'select id, status from public.allocations where resource_id = $1 order by created_at', [resource]);
    const fulfilled = rows.find((r) => r.status === 'fulfilled').id;
    const released = rows.find((r) => r.status === 'released').id;
    await db.rejects('service', `update public.allocations set status = 'reserved' where id = $1`, [fulfilled], /invalid_allocation_transition/);
    await db.rejects('service', `update public.allocations set status = 'reserved' where id = $1`, [released], /invalid_allocation_transition/);
    await db.rejects('service', 'update public.allocations set quantity = 1 where id = $1', [fulfilled], /allocation_immutable/);
    await db.rejects('service', 'delete from public.allocations where id = $1', [released], /append_only/);
  });

  test('total quantity cannot be cut below what is already committed', async () => {
    await db.rejects(s.u.graceCoord, 'update public.resources set total_quantity = 1 where id = $1', [resource], /total_below_committed_quantity/);
    await db.run(s.u.graceCoord, 'update public.resources set total_quantity = 2 where id = $1', [resource]);
    assert.equal((await availability()).available_quantity, 0);
    await db.run(s.u.graceCoord, 'update public.resources set total_quantity = 3 where id = $1', [resource]);
  });

  test('expired, not-yet-valid and archived resources cannot be reserved', async () => {
    const make = async (extra) => (await pool.query(
      `insert into public.resources (church_id, name, category_key, unit, total_quantity ${extra.cols})
       values ($1, 'Vouchers', 'food', 'voucher', 5 ${extra.vals}) returning id`, [s.grace])).rows[0].id;
    const cases = {
      resource_outside_validity: [
        await make({ cols: ', valid_until', vals: `, current_date - 1` }),
        await make({ cols: ', valid_from', vals: `, current_date + 1` }),
      ],
      resource_not_active: [await make({ cols: ', status', vals: `, 'archived'` })],
    };
    for (const [error, ids] of Object.entries(cases)) {
      for (const id of ids) {
        await db.rejects('service',
          `insert into public.allocations (church_id, request_id, resource_id, quantity) values ($1, $2, $3, 1)`,
          [s.grace, requests[3], id], new RegExp(error));
      }
    }
  });

  test('concurrent approvals for the last unit: exactly one succeeds', async () => {
    assert.equal((await availability()).available_quantity, 1);
    for (let round = 0; round < 5; round++) {
      const results = await Promise.allSettled([
        allocate(requests[3], 1), allocate(requests[4], 1), allocate(requests[5], 1),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      assert.equal(won.length, 1, `round ${round}: ${won.length} approvals succeeded`);
      for (const l of lost) assert.match(l.reason.message, /insufficient_available_quantity/);
      const a = await availability();
      assert.equal(a.available_quantity, 0);
      assert.ok(a.reserved_quantity + a.distributed_quantity <= a.total_quantity);
      await pool.query(`update public.allocations set status = 'released' where id = $1`, [won[0].value.rows[0].id]);
    }
  });
});
