// Milestone 11: the one-off test-data clean-up scripts in supabase/maintenance.
// Everything here is synthetic.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDatabase, makeRunner } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

const read = (f) => readFileSync(new URL(`../../supabase/maintenance/${f}`, import.meta.url), 'utf8');
const preview = read('2026-11-cleanup-1-preview.sql');
const remove = read('2026-11-cleanup-2-remove.sql');

let pool, db, s, target, otherReq;
const count = async (sql, params = []) => Number((await pool.query(sql, params)).rows[0].n);

before(async () => {
  pool = await createTestDatabase('mercymap_cleanup');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
  await pool.query(`update public.churches set slug = 'grace-community-church' where id = $1`, [s.grace]);

  // The Grace request to remove, with something in every dependent table.
  target = (await pool.query(
    `insert into public.requests (church_id, reference, channel, category_key, original_text,
                                  contact_method, contact_value, consent_given_at)
     values ($1, 'MM-EEDC36-BF43FA', 'public', 'food', 'Synthetic request to remove.',
             'phone_call', '0800 000 0000', now()) returning id`, [s.grace])).rows[0].id;
  otherReq = s.rows.grace.requests;
  await pool.query(`insert into public.request_events (church_id, request_id, event_type, to_status)
                    values ($1, $2, 'submitted', 'submitted')`, [s.grace, target]);
  await pool.query(`insert into public.ai_analyses (church_id, request_id, status, output, provider, model, prompt_version)
                    values ($1, $2, 'done', '{}', 'test', 'm', 'v1')`, [s.grace, target]);
  const alloc = (await pool.query(
    `insert into public.allocations (church_id, request_id, resource_id, quantity, approved_by)
     values ($1, $2, $3, 1, $4) returning id`, [s.grace, target, s.rows.grace.resources, s.u.graceOwner])).rows[0].id;
  const assign = (await pool.query(
    `insert into public.assignments (church_id, volunteer_id, request_id, task_brief, assigned_by)
     values ($1, $2, $3, 'Synthetic task', $4) returning id`,
    [s.grace, s.rows.grace.volunteers, target, s.u.graceOwner])).rows[0].id;
  await pool.query(`insert into public.notifications (church_id, recipient_user_id, type, request_id, title)
                    values ($1, $2, 'request_new', $3, 'New')`, [s.grace, s.u.graceOwner, target]);
  for (const [type, id] of [['request', target], ['allocation', alloc], ['assignment', assign]]) {
    await pool.query(`insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id)
                      values ($1, $2, 'request.viewed', $3, $4)`, [s.grace, s.u.graceOwner, type, id]);
  }
  // An audit entry for Grace's other request, which must stay.
  await pool.query(`insert into public.audit_logs (church_id, actor_user_id, action, entity_type, entity_id)
                    values ($1, $2, 'request.viewed', 'request', $3)`, [s.grace, s.u.graceOwner, otherReq]);

  // The test church and its two test accounts.
  const tester = (await pool.query(`insert into auth.users (email) values ('joeljess2026@gmail.com') returning id`)).rows[0].id;
  await pool.query(`insert into auth.users (email) values ('joeljess2026+m9@gmail.com')`);
  const uguuu = (await db.run(tester, `select public.create_church('uguuu', 'uguuu', null) as id`)).rows[0].id;
  const uReq = (await pool.query(
    `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at)
     values ($1, 'public', 'food', 'Synthetic', now()) returning id`, [uguuu])).rows[0].id;
  await pool.query(`insert into public.request_events (church_id, request_id, event_type) values ($1, $2, 'submitted')`, [uguuu, uReq]);
  await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
                    values ($1, 'Rice', 'food', 'bag', 3)`, [uguuu]);
  await pool.query(`insert into public.volunteers (church_id, full_name) values ($1, 'Synthetic')`, [uguuu]);
  await pool.query(
    `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
     values ($1, 'joeljess2026+m9@gmail.com', 'coordinator', $2, $3, now() + interval '7 days')`,
    [s.grace, 'z'.repeat(64), s.u.graceOwner]);
});
after(async () => { await pool?.end(); });

test('the preview lists what will go and changes nothing', async () => {
  const before = await count('select count(*) as n from public.requests');
  const rows = Object.fromEntries((await pool.query(preview)).rows.map((r) => [r.what, r.rows_to_remove]));
  assert.equal(rows.churches, 1);
  assert.equal(rows.requests, 2);
  assert.equal(rows['volunteer tasks'], 1);
  assert.equal(rows.invitations, 1);
  assert.equal(rows['user accounts'], 2);
  assert.equal(rows['memberships the accounts hold in OTHER churches (must be 0)'], 0);
  assert.equal(await count('select count(*) as n from public.requests'), before);
});

test('a test account belonging to a real church stops the removal', async () => {
  const m9 = (await pool.query(`select id from auth.users where email = 'joeljess2026+m9@gmail.com'`)).rows[0].id;
  await pool.query(`insert into public.church_memberships (church_id, user_id, role) values ($1, $2, 'coordinator')`, [s.grace, m9]);
  await assert.rejects(() => pool.query(remove), /a test account belongs to another church/);
  // Rolled back: the request is still there and the guards are still on.
  assert.equal(await count(`select count(*) as n from public.requests where reference = 'MM-EEDC36-BF43FA'`), 1);
  await assert.rejects(() => pool.query('delete from public.request_events'), /append_only/);
  await pool.query(`delete from public.church_memberships where user_id = $1`, [m9]);
});

test('the removal deletes exactly the targets and leaves everything else', async () => {
  const keep = async () => ({
    requests: await count('select count(*) as n from public.requests where id <> all ($1)', [[target]]),
    graceAudit: await count(`select count(*) as n from public.audit_logs where entity_id = $1`, [otherReq]),
    faith: await count('select count(*) as n from public.requests where church_id = $1', [s.faith]),
    graceAlloc: await count('select count(*) as n from public.allocations where request_id = $1', [otherReq]),
    users: await count(`select count(*) as n from auth.users where email not like 'joeljess2026%'`),
  });
  const kept = await keep();
  const results = await pool.query(remove);
  const check = Object.fromEntries(results.at(-1).rows.map((r) => [r.check, r.result]));
  assert.deepEqual(check, {
    'request MM-EEDC36-BF43FA': '0', 'church uguuu': '0', 'test accounts': '0',
    'guards switched on (expect 4)': '4',
  });

  assert.equal(await count(`select count(*) as n from public.requests where church_id not in (select id from public.churches)`), 0);
  for (const table of ['request_events', 'ai_analyses', 'allocations', 'assignments', 'notifications']) {
    assert.equal(await count(`select count(*) as n from public.${table} where request_id = $1`, [target]), 0, table);
  }
  assert.equal(await count(`select count(*) as n from public.audit_logs where entity_id = $1`, [target]), 0);
  assert.equal(await count(`select count(*) as n from public.invitations where email like 'joeljess2026%'`), 0);
  // Grace's real allocation was released stock-wise only for the removed request.
  const kept2 = await keep();
  assert.deepEqual(kept2, { ...kept, requests: kept.requests - 1 });

  const log = (await pool.query(`select * from public.audit_logs where action = 'data.purged'`)).rows;
  assert.equal(log.length, 1);
  assert.equal(log[0].metadata.removed.requests, 2);
  assert.equal(log[0].metadata.removed.churches, 1);
  assert.equal(log[0].metadata.removed.user_accounts, 2);
});

test('the guards are back on after the removal', async () => {
  await assert.rejects(() => pool.query('delete from public.request_events'), /append_only/);
  await assert.rejects(() => pool.query('delete from public.audit_logs'), /append_only/);
  await assert.rejects(() => pool.query('delete from public.allocations'), /append_only/);
  await assert.rejects(
    () => pool.query(`delete from public.church_memberships where user_id = $1`, [s.u.faithOwner]),
    /last_owner_required/);
});

test('running the removal again changes nothing', async () => {
  const before = await count('select count(*) as n from public.audit_logs');
  await pool.query(remove);
  assert.equal(await count('select count(*) as n from public.audit_logs'), before);
});
