// Milestone 2: invitation acceptance, staff directory, platform verification.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createTestDatabase, makeRunner, DENIED } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;

before(async () => {
  pool = await createTestDatabase('mercymap_test_invitations');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
});
after(async () => { await pool.end(); });

const sha256 = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
const newUser = async (email, confirmed = true) => (await pool.query(
  `insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`,
  [email, confirmed ? new Date() : null])).rows[0].id;

// Mirrors what the app does: random token, only its hash is stored.
async function invite(actor, churchId, email, role, { expires = '7 days' } = {}) {
  const token = randomBytes(32).toString('base64url');
  await db.run(actor,
    `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, $5, now() + $6::interval)`,
    [churchId, email, role, sha256(token), actor, expires]);
  return token;
}
const membership = async (churchId, userId) => (await pool.query(
  'select role, status, invited_by from public.church_memberships where church_id = $1 and user_id = $2',
  [churchId, userId])).rows[0];

describe('church registration requires a confirmed email', () => {
  test('an unconfirmed user cannot register a church', async () => {
    const u = await newUser('unconfirmed@example.test', false);
    await db.rejects(u, `select public.create_church('Hope Chapel', 'hope-chapel')`, [], /email_not_confirmed/);
  });
  test('a confirmed user can', async () => {
    const u = await newUser('pastor@hope.test');
    const { rows } = await db.run(u, `select public.create_church('Hope Chapel', 'Hope-Chapel ', 'Ondo') as id`);
    const church = await pool.query('select slug, status from public.churches where id = $1', [rows[0].id]);
    assert.deepEqual(church.rows[0], { slug: 'hope-chapel', status: 'pending' });
  });
  test('names that are blank or too short are refused', async () => {
    const u = await newUser('short@example.test');
    await db.rejects(u, `select public.create_church(' ', 'blank-name')`, [], /check constraint/);
  });
});

describe('accepting an invitation', () => {
  test('the invited person joins with the invited role, exactly once', async () => {
    const user = await newUser('newcoord@grace.test');
    const token = await invite(s.u.graceOwner, s.grace, 'newcoord@grace.test', 'coordinator');

    const preview = await db.run(user, 'select * from public.preview_invitation($1)', [token]);
    assert.deepEqual(preview.rows[0], {
      church_name: 'Grace Community Church', role: 'coordinator',
      invited_email: 'newcoord@grace.test', email_matches: true,
    });

    const accepted = await db.run(user, 'select public.accept_invitation($1) as church_id', [token]);
    assert.equal(accepted.rows[0].church_id, s.grace);
    assert.deepEqual(await membership(s.grace, user),
      { role: 'coordinator', status: 'active', invited_by: s.u.graceOwner });

    await db.rejects(user, 'select public.accept_invitation($1)', [token], /invitation_invalid_or_expired/);
    const audit = await pool.query(
      `select 1 from public.audit_logs where church_id = $1 and action = 'invitation.accepted' and actor_user_id = $2`,
      [s.grace, user]);
    assert.equal(audit.rowCount, 1);
  });

  test('the new member now sees Grace data and nothing of Living Faith', async () => {
    const { rows } = await pool.query(`select id from auth.users where email = 'newcoord@grace.test'`);
    const seen = await db.run(rows[0].id, 'select distinct church_id from public.requests');
    assert.deepEqual(seen.rows.map((r) => r.church_id), [s.grace]);
  });

  test('a different signed-in user cannot use someone else\'s invitation', async () => {
    const token = await invite(s.u.graceOwner, s.grace, 'intended@grace.test', 'admin');
    const preview = await db.run(s.u.outsider, 'select email_matches from public.preview_invitation($1)', [token]);
    assert.equal(preview.rows[0].email_matches, false);
    await db.rejects(s.u.outsider, 'select public.accept_invitation($1)', [token], /invitation_email_mismatch/);
    assert.equal(await membership(s.grace, s.u.outsider), undefined);
  });

  test('email matching ignores letter case', async () => {
    const user = await newUser('Mixed.Case@Grace.test');
    const token = await invite(s.u.graceOwner, s.grace, 'mixed.case@grace.test', 'coordinator');
    await db.run(user, 'select public.accept_invitation($1)', [token]);
    assert.equal((await membership(s.grace, user)).role, 'coordinator');
  });

  test('an unconfirmed email cannot accept', async () => {
    const user = await newUser('pending@grace.test', false);
    const token = await invite(s.u.graceOwner, s.grace, 'pending@grace.test', 'coordinator');
    await db.rejects(user, 'select public.accept_invitation($1)', [token], /email_not_confirmed/);
  });

  test('wrong, empty and null tokens are refused', async () => {
    for (const bad of ['not-a-real-token', '', null]) {
      await db.rejects(s.u.outsider, 'select public.accept_invitation($1)', [bad], /invitation_invalid_or_expired/);
      await db.rejects(s.u.outsider, 'select * from public.preview_invitation($1)', [bad], /invitation_invalid_or_expired/);
    }
  });

  test('the stored hash itself is not a usable token', async () => {
    const user = await newUser('hashuser@grace.test');
    const token = await invite(s.u.graceOwner, s.grace, 'hashuser@grace.test', 'coordinator');
    await db.rejects(user, 'select public.accept_invitation($1)', [sha256(token)], /invitation_invalid_or_expired/);
  });

  test('an expired invitation is refused', async () => {
    const user = await newUser('late@grace.test');
    const token = await invite(s.u.graceOwner, s.grace, 'late@grace.test', 'coordinator');
    await pool.query(
      `update public.invitations set created_at = now() - interval '9 days', expires_at = now() - interval '1 minute'
        where token_hash = $1`, [sha256(token)]);
    await db.rejects(user, 'select public.accept_invitation($1)', [token], /invitation_invalid_or_expired/);
  });

  test('a revoked invitation is refused', async () => {
    const user = await newUser('revoked@grace.test');
    const token = await invite(s.u.graceOwner, s.grace, 'revoked@grace.test', 'coordinator');
    const del = await db.run(s.u.graceAdmin, 'delete from public.invitations where token_hash = $1', [sha256(token)])
      .catch(() => null);
    // token_hash is not readable by staff, so revoke by email as the app does.
    if (!del) await db.run(s.u.graceAdmin, `delete from public.invitations where email = 'revoked@grace.test'`);
    await db.rejects(user, 'select public.accept_invitation($1)', [token], /invitation_invalid_or_expired/);
  });

  test('an invitation dies when its issuer loses the authority to issue it', async () => {
    const user = await newUser('orphan@grace.test');
    const token = await invite(s.u.graceAdmin, s.grace, 'orphan@grace.test', 'coordinator');
    await db.run(s.u.graceOwner, 'select public.remove_member($1)', [s.m.graceAdmin]);
    await db.rejects(user, 'select public.accept_invitation($1)', [token], /invitation_invalid_or_expired/);
    // restore the admin for later tests
    const { rows } = await pool.query(
      `insert into public.church_memberships (church_id, user_id, role) values ($1, $2, 'admin') returning id`,
      [s.grace, s.u.graceAdmin]);
    s.m.graceAdmin = rows[0].id;
  });

  test('an existing member cannot accept a second invitation to the same church', async () => {
    await pool.query(
      `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
       values ($1, 'coordinator@grace.test', 'admin', $2, $3, now() + interval '1 day')`,
      [s.grace, sha256('dup-token'), s.u.graceOwner]);
    await db.rejects(s.u.graceCoord, 'select public.accept_invitation($1)', ['dup-token'], /already_member/);
    assert.equal((await membership(s.grace, s.u.graceCoord)).role, 'coordinator');
  });

  test('two simultaneous acceptances create one membership', async () => {
    const user = await newUser('racer@grace.test');
    const token = await invite(s.u.graceOwner, s.grace, 'racer@grace.test', 'coordinator');
    const results = await Promise.allSettled([
      db.run(user, 'select public.accept_invitation($1)', [token]),
      db.run(user, 'select public.accept_invitation($1)', [token]),
      db.run(user, 'select public.accept_invitation($1)', [token]),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const count = await pool.query(
      'select count(*)::int as n from public.church_memberships where church_id = $1 and user_id = $2', [s.grace, user]);
    assert.equal(count.rows[0].n, 1);
  });

  test('only one open invitation per email per church', async () => {
    await invite(s.u.graceOwner, s.grace, 'twice@grace.test', 'coordinator');
    await assert.rejects(invite(s.u.graceOwner, s.grace, 'twice@grace.test', 'admin'), /invitations_one_pending_per_email/);
    // the same address may still be invited by a different church
    await invite(s.u.faithOwner, s.faith, 'twice@grace.test', 'coordinator');
  });

  test('email addresses must be stored in lower case', async () => {
    await assert.rejects(invite(s.u.graceOwner, s.grace, 'Upper@Grace.test', 'coordinator'), /check constraint/);
  });
});

describe('staff directory', () => {
  test('members see colleagues with email addresses, owners first', async () => {
    const { rows } = await db.run(s.u.graceCoord, 'select * from public.list_church_members($1)', [s.grace]);
    assert.equal(rows[0].role, 'owner');
    assert.equal(rows[0].email, 'owner@grace.test');
    assert.ok(rows.length >= 3);
  });
  test('other churches and outsiders cannot list Grace staff', async () => {
    for (const actor of [s.u.faithOwner, s.u.outsider]) {
      await db.rejects(actor, 'select * from public.list_church_members($1)', [s.grace], /forbidden/);
    }
  });
});

describe('platform administration', () => {
  test('only platform administrators can list churches', async () => {
    for (const actor of [s.u.graceOwner, s.u.outsider]) {
      await db.rejects(actor, 'select * from public.platform_list_churches()', [], /forbidden/);
      const flag = await db.run(actor, 'select public.is_platform_admin() as yes');
      assert.equal(flag.rows[0].yes, false);
    }
    const flag = await db.run(s.u.platformAdmin, 'select public.is_platform_admin() as yes');
    assert.equal(flag.rows[0].yes, true);
    const { rows } = await db.run(s.u.platformAdmin, 'select * from public.platform_list_churches()');
    assert.ok(rows.some((r) => r.slug === 'grace-community' && r.owner_email === 'owner@grace.test'));
    assert.equal(rows[0].status, 'pending');
  });
  test('a platform administrator has no access to a church\'s private records', async () => {
    const seen = await db.run(s.u.platformAdmin, 'select id from public.requests');
    assert.equal(seen.rowCount, 0);
  });
  test('verify, suspend and reject unknown statuses', async () => {
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'verified')`, [s.faith]);
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'suspended')`, [s.faith]);
    const { rows } = await pool.query('select status, verified_at from public.churches where id = $1', [s.faith]);
    assert.equal(rows[0].status, 'suspended');
    assert.ok(rows[0].verified_at);
    await db.rejects(s.u.platformAdmin, `select public.set_church_status($1, 'approved')`, [s.faith], /invalid_status/);
    await db.rejects(s.u.platformAdmin, `select public.set_church_status($1, 'verified')`,
      ['00000000-0000-0000-0000-000000000000'], /church_not_found/);
  });
  test('nobody can add themselves to the platform administrators', async () => {
    await db.rejects(s.u.graceOwner, 'insert into public.platform_admins (user_id) values ($1)', [s.u.graceOwner], DENIED);
  });
});

describe('the anonymous role and the new functions', () => {
  for (const call of [
    `select public.accept_invitation('x')`, `select * from public.preview_invitation('x')`,
    `select public.is_platform_admin()`, `select * from public.platform_list_churches()`,
  ]) {
    test(`cannot call: ${call}`, async () => { await db.rejects('anon', call, [], DENIED); });
  }
});
