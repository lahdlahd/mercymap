// Milestone 9: the two fixes carried forward from Milestone 2.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s, admin, invitee;
before(async () => {
  pool = await createTestDatabase('mercymap_test_polish');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
  // The Living Faith owner is also a platform administrator (as on the live project).
  admin = s.u.faithOwner;
  await pool.query('insert into public.platform_admins (user_id) values ($1)', [admin]);
  invitee = (await pool.query(`insert into auth.users (email) values ('Invitee@Grace.test') returning id`)).rows[0].id;
});
after(async () => { await pool.end(); });

describe('a platform administrator cannot review their own church', () => {
  test('verify, suspend and reset are all refused for a church they belong to', async () => {
    for (const status of ['verified', 'suspended', 'pending']) {
      await db.rejects(admin, 'select public.set_church_status($1, $2)', [s.faith, status], /own_church/);
    }
    assert.equal((await pool.query(`select count(*)::int n from public.audit_logs where action = 'church.status_changed' and church_id = $1`, [s.faith])).rows[0].n, 0);
  });
  test('a suspended membership still counts', async () => {
    // A coordinator (not the last owner) who is also a platform administrator.
    const coord = s.u.faithCoord;
    await pool.query('insert into public.platform_admins (user_id) values ($1)', [coord]);
    await pool.query(`update public.church_memberships set status = 'suspended' where church_id = $1 and user_id = $2`, [s.faith, coord]);
    try {
      await db.rejects(coord, 'select public.set_church_status($1, $2)', [s.faith, 'verified'], /own_church/);
    } finally {
      await pool.query(`update public.church_memberships set status = 'active' where church_id = $1 and user_id = $2`, [s.faith, coord]);
      await pool.query('delete from public.platform_admins where user_id = $1', [coord]);
    }
  });
  test('other churches can still be reviewed, and are audited', async () => {
    await db.run(admin, 'select public.set_church_status($1, $2)', [s.grace, 'verified']);
    const c = (await pool.query('select status, verified_by from public.churches where id = $1', [s.grace])).rows[0];
    assert.deepEqual(c, { status: 'verified', verified_by: admin });
  });
  test('the list says which churches are their own', async () => {
    const { rows } = await db.run(admin, 'select id, is_member from public.platform_list_churches()');
    assert.equal(rows.find((r) => r.id === s.faith).is_member, true);
    assert.equal(rows.find((r) => r.id === s.grace).is_member, false);
  });
  test('non-administrators are still refused', async () => {
    await db.rejects(s.u.graceOwner, 'select public.set_church_status($1, $2)', [s.faith, 'verified'], /forbidden/);
    await db.rejects(s.u.graceOwner, 'select * from public.platform_list_churches()', [], /forbidden/);
  });
});

describe('pending invitations on "Register your church"', () => {
  const mine = async (user) => (await db.run(user, 'select public.my_pending_invitations() as v')).rows[0].v;

  test('the invited person sees the church and role, never the token', async () => {
    const list = await mine(invitee);
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]).sort(), ['church_name', 'expires_at', 'role']);
    assert.equal(list[0].church_name, 'Grace Community Church');
    assert.equal(list[0].role, 'coordinator');
  });
  test('nobody else sees it', async () => {
    assert.deepEqual(await mine(s.u.faithCoord), []);
    await db.rejects('anon', 'select public.my_pending_invitations()', [], /permission denied/);
  });
  test('expired, accepted and already-joined invitations are not shown', async () => {
    await pool.query(`update public.invitations set expires_at = now() - interval '1 minute', created_at = now() - interval '8 days' where email = 'invitee@grace.test'`);
    assert.deepEqual(await mine(invitee), []);
    await pool.query(`update public.invitations set expires_at = now() + interval '7 days', created_at = now() where email = 'invitee@grace.test'`);
    assert.equal((await mine(invitee)).length, 1);
    await pool.query(`update public.invitations set accepted_at = now() where email = 'invitee@grace.test'`);
    assert.deepEqual(await mine(invitee), []);
    await pool.query(`update public.invitations set accepted_at = null where email = 'invitee@grace.test'`);
    await pool.query(`insert into public.church_memberships (church_id, user_id, role) values ($1, $2, 'coordinator')`, [s.grace, invitee]);
    assert.deepEqual(await mine(invitee), []);
  });
});
