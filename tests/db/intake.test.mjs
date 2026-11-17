// Milestone 3: public and staff-assisted request intake.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestDatabase, makeRunner, DENIED } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;
const ip = (n) => createHash('sha256').update(`ip-${n}`).digest('hex');

before(async () => {
  pool = await createTestDatabase('mercymap_test_intake');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
  await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'verified')`, [s.grace]);
});
after(async () => { await pool.end(); });

const TEXT = 'We have run out of food for the children this week.';
const submit = (args = {}) => {
  const a = {
    slug: 'grace-community', ip: ip(1), category: 'food', text: TEXT, quantity: 1,
    name: 'Sample Person', method: 'phone_call', value: '+234 801 234 5678', area: 'Oke-Aro', ...args,
  };
  return db.run('service', 'select * from public.submit_public_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [a.slug, a.ip, a.category, a.text, a.quantity, a.name, a.method, a.value, a.area]);
};
const staffSubmit = (actor, churchId, args = {}) => {
  const a = { category: 'clothing', text: 'Walked in asking for school uniforms.', quantity: 2,
    name: null, method: 'in_person', value: null, area: null, ...args };
  return db.run(actor, 'select * from public.staff_submit_request($1,$2,$3,$4,$5,$6,$7,$8)',
    [churchId, a.category, a.text, a.quantity, a.name, a.method, a.value, a.area]);
};
const requestByRef = async (ref) => (await pool.query('select * from public.requests where reference = $1', [ref])).rows[0];

describe('public page details', () => {
  test('a verified church returns its public details and the categories', async () => {
    const { rows } = await db.run('service', 'select public.get_public_intake($1) as v', [' Grace-Community ']);
    const v = rows[0].v;
    assert.equal(v.church.name, 'Grace Community Church');
    assert.equal(v.church.slug, 'grace-community');
    assert.equal(v.categories.length, 9);
    assert.deepEqual(v.categories[0], { key: 'food', label: 'Food and groceries' });
    assert.deepEqual(Object.keys(v.church).sort(), ['area', 'contact_phone', 'emergency_guidance', 'name', 'slug']);
  });
  test('pending, suspended and unknown churches return nothing', async () => {
    for (const slug of ['living-faith', 'no-such-church', '']) {
      const { rows } = await db.run('service', 'select public.get_public_intake($1) as v', [slug]);
      assert.equal(rows[0].v, null, slug);
    }
  });
  test('only the server role can call it', async () => {
    await db.rejects('anon', `select public.get_public_intake('grace-community')`, [], DENIED);
    await db.rejects(s.u.graceOwner, `select public.get_public_intake('grace-community')`, [], DENIED);
  });
});

describe('public submission', () => {
  test('creates a public request for the church named by the link, with a history event', async () => {
    const { rows } = await submit();
    assert.equal(rows[0].church_name, 'Grace Community Church');
    assert.match(rows[0].reference, /^MM-[0-9A-F]{6}-[0-9A-F]{6}$/);
    const r = await requestByRef(rows[0].reference);
    assert.equal(r.church_id, s.grace);
    assert.equal(r.channel, 'public');
    assert.equal(r.created_by, null);
    assert.equal(r.status, 'submitted');
    assert.equal(r.contact_value, '+234 801 234 5678');
    assert.equal(r.language, 'en');
    assert.ok(r.consent_given_at);
    const ev = await pool.query('select event_type, to_status, actor_user_id from public.request_events where request_id = $1', [r.id]);
    assert.deepEqual(ev.rows, [{ event_type: 'submitted', to_status: 'submitted', actor_user_id: null }]);
  });
  test('the new request is visible to Grace staff only', async () => {
    const ref = (await submit({ ip: ip(2) })).rows[0].reference;
    const grace = await db.run(s.u.graceCoord, 'select id from public.requests where reference = $1', [ref]);
    assert.equal(grace.rowCount, 1);
    for (const actor of [s.u.faithOwner, s.u.outsider]) {
      const other = await db.run(actor, 'select id from public.requests where reference = $1', [ref]);
      assert.equal(other.rowCount, 0);
    }
  });
  test('pending, suspended and unknown churches cannot receive requests', async () => {
    await assert.rejects(submit({ slug: 'living-faith' }), /intake_unavailable/);
    await assert.rejects(submit({ slug: 'nope' }), /intake_unavailable/);
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'suspended')`, [s.grace]);
    await assert.rejects(submit({ ip: ip(3) }), /intake_unavailable/);
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'verified')`, [s.grace]);
  });
  test('fields are validated', async () => {
    const cases = [
      [{ category: 'weapons' }, /invalid_category/],
      [{ category: null }, /invalid_category/],
      [{ text: 'too short' }, /invalid_description/],
      [{ text: 'x'.repeat(5001) }, /invalid_description/],
      [{ quantity: 0 }, /invalid_quantity/],
      [{ quantity: 1001 }, /invalid_quantity/],
      [{ method: 'carrier_pigeon' }, /invalid_contact_method/],
      [{ method: 'sms', value: null }, /invalid_phone/],
      [{ method: 'sms', value: '12345' }, /invalid_phone/],
      [{ method: 'phone_call', value: 'call me maybe' }, /invalid_phone/],
      [{ ip: 'short' }, /invalid_request/],
    ];
    for (const [args, pattern] of cases) await assert.rejects(submit({ ip: ip(4), ...args }), pattern, JSON.stringify(args));
  });
  test('no number is stored when the contact method does not need one', async () => {
    const { rows } = await submit({ ip: ip(5), method: 'none', value: '+234 801 000 0000', name: '  ', area: '' });
    const r = await requestByRef(rows[0].reference);
    assert.equal(r.contact_method, 'none');
    assert.equal(r.contact_value, null);
    assert.equal(r.requester_name, null);
    assert.equal(r.area, null);
  });
  test('description is trimmed and kept exactly otherwise', async () => {
    const { rows } = await submit({ ip: ip(6), text: `   ${TEXT}\n  ` });
    assert.equal((await requestByRef(rows[0].reference)).original_text, TEXT);
  });
  test('one network address is limited to 5 requests per church per hour', async () => {
    for (let i = 0; i < 5; i++) await submit({ ip: ip(7) });
    await assert.rejects(submit({ ip: ip(7) }), /rate_limited/);
    await assert.rejects(submit({ ip: ip(7) }), /rate_limited/);
    await submit({ ip: ip(8) }); // a different address is unaffected
  });
  test('rejected submissions do not use up the allowance', async () => {
    for (let i = 0; i < 6; i++) await assert.rejects(submit({ ip: ip(9), text: 'short' }), /invalid_description/);
    await submit({ ip: ip(9) });
  });
  test('only the server role can submit', async () => {
    const call = `select * from public.submit_public_request('grace-community', '${ip(10)}', 'food', '${TEXT}', 1, null, 'none', null, null)`;
    await db.rejects('anon', call, [], DENIED);
    await db.rejects(s.u.graceOwner, call, [], DENIED);
  });
});

describe('staff-assisted submission', () => {
  test('a member records a request; it is marked as staff-assisted with its author', async () => {
    const { rows } = await staffSubmit(s.u.graceCoord, s.grace);
    const r = await requestByRef(rows[0].reference);
    assert.equal(r.id, rows[0].id);
    assert.equal(r.channel, 'staff');
    assert.equal(r.created_by, s.u.graceCoord);
    assert.equal(r.church_id, s.grace);
    assert.equal(r.quantity_needed, 2);
    const ev = await pool.query('select event_type, actor_user_id from public.request_events where request_id = $1', [r.id]);
    assert.deepEqual(ev.rows, [{ event_type: 'submitted', actor_user_id: s.u.graceCoord }]);
  });
  test('works for a church still awaiting verification', async () => {
    const { rows } = await staffSubmit(s.u.faithCoord, s.faith);
    assert.equal((await requestByRef(rows[0].reference)).church_id, s.faith);
  });
  test('nobody can record a request for another church', async () => {
    await assert.rejects(staffSubmit(s.u.faithOwner, s.grace), /forbidden/);
    await assert.rejects(staffSubmit(s.u.outsider, s.grace), /forbidden/);
    await assert.rejects(staffSubmit(s.u.platformAdmin, s.grace), /forbidden/);
  });
  test('a suspended church cannot record requests', async () => {
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'suspended')`, [s.faith]);
    await assert.rejects(staffSubmit(s.u.faithCoord, s.faith), /church_suspended/);
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'pending')`, [s.faith]);
  });
  test('the same validation applies', async () => {
    await assert.rejects(staffSubmit(s.u.graceCoord, s.grace, { method: 'sms', value: null }), /invalid_phone/);
    await assert.rejects(staffSubmit(s.u.graceCoord, s.grace, { text: 'hi' }), /invalid_description/);
  });
  test('the anonymous role cannot call it', async () => {
    await db.rejects('anon', 'select * from public.staff_submit_request($1, $2, $3, 1, null, $4, null, null)',
      [s.grace, 'food', TEXT, 'none'], DENIED);
  });
});
