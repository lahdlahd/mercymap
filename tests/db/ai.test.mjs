// Milestone 6: AI analysis. The AI only suggests; the only thing it can change
// is raising "needs attention" on a never-flagged request, and only a person
// can clear that. Keyword checks run in the database on every new request.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;
before(async () => {
  pool = await createTestDatabase('mercymap_test_ai');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
  await pool.query(`update public.churches set status = 'verified' where id in ($1, $2)`, [s.grace, s.faith]);
});
after(async () => { await pool.end(); });

const staffSubmit = async (text, o = {}) => (await db.run(s.u.graceCoord,
  'select * from public.staff_submit_request($1,$2,$3,$4,$5,$6,$7,$8)',
  [o.church ?? s.grace, o.category ?? 'food', text, o.qty ?? 2, o.name ?? 'Ada Sample',
    o.phone ? 'phone_call' : 'none', o.phone ?? null, o.area ?? null])).rows[0];
const row = async (id) => (await pool.query('select * from public.requests where id = $1', [id])).rows[0];
const events = async (id) => (await pool.query(
  'select event_type, actor_user_id, note from public.request_events where request_id = $1 order by created_at, id', [id])).rows;
const claim = async (reference, force = false) =>
  (await db.run('service', 'select public.ai_claim($1, $2) as v', [reference, force])).rows[0].v;
const output = (o = {}) => ({
  summary: 'A family of four needs food this week.',
  key_facts: ['Family of four', 'Needs food this week'],
  missing_info: ['How many children'],
  suggested_category: null,
  urgency: 'medium',
  safeguarding: { concern: false, reason: null },
  resource: null,
  ...o,
});
const save = (id, ok, out, err = null) => db.run('service',
  'select public.ai_save($1,$2,$3,$4,$5,$6,$7) as id', [id, ok, out ? JSON.stringify(out) : null, err, 'anthropic', 'claude-haiku-5-5', 'v1']);

describe('keyword safeguarding check', () => {
  test('flags a new request that mentions harm, with the word and no actor', async () => {
    const r = await staffSubmit('My husband beats me and we have no food at home.');
    const q = await row(r.id);
    assert.equal(q.attention_flag, true);
    assert.equal(q.attention_source, 'keyword');
    assert.match(q.attention_reason, /mentions "beats me"/);
    const e = await events(r.id);
    assert.deepEqual(e.map((x) => x.event_type), ['submitted', 'attention_flagged']);
    assert.equal(e[1].actor_user_id, null);
  });
  test('works for the public form too, and matches whole words in any case', async () => {
    const { rows } = await db.run('service', 'select * from public.submit_public_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      ['grace-community', 'a'.repeat(64), 'food', 'I feel SUICIDAL and have not eaten.', 1, null, 'none', null, null]);
    const q = (await pool.query('select * from public.requests where reference = $1', [rows[0].reference])).rows[0];
    assert.equal(q.attention_source, 'keyword');
  });
  test('no flag for ordinary requests or words that only contain a keyword', async () => {
    for (const text of ['We need school fees for two children.', 'Grape juice and bread for a rapeseed farmer family.', 'Abusers? No. Just rent help.']) {
      const r = await staffSubmit(text);
      assert.equal((await row(r.id)).attention_flag, false, text);
    }
  });
  test('phrases', async () => {
    const { rows } = await pool.query(`select private.safeguarding_keyword('she is not safe at home') a,
      private.safeguarding_keyword('worried about self-harm') b, private.safeguarding_keyword('selfharm') c, private.safeguarding_keyword(null) d`);
    assert.deepEqual(rows[0], { a: 'not safe at home', b: 'self-harm', c: null, d: null });
  });
});

describe('claiming a request for analysis', () => {
  test('returns only what the AI may see, plus redaction values, and marks it processing', async () => {
    const r = await staffSubmit('We need food for the week please.', { name: 'Ada Sample', phone: '0803 555 0101', area: 'Ijapo' });
    const v = await claim(r.reference.toLowerCase());
    assert.deepEqual(Object.keys(v).sort(),
      ['area', 'categories', 'category_key', 'description', 'quantity', 'redact', 'request_id', 'resource_options', 'status'].sort());
    assert.equal(v.description, 'We need food for the week please.');
    assert.deepEqual(v.redact, { name: 'Ada Sample', contact: '0803 555 0101' });
    assert.ok(!JSON.stringify({ ...v, redact: null }).includes('Ada'));
    assert.ok(!JSON.stringify({ ...v, redact: null }).includes('0803'));
    const q = await row(r.id);
    assert.equal(q.ai_status, 'processing');
    assert.equal(q.ai_attempts, 1);
    assert.equal(await claim(r.reference), null, 'a running analysis cannot be claimed twice');
  });
  test('automatic runs stop after 3 attempts; staff runs after 10 in total', async () => {
    const r = await staffSubmit('We need food for the week please.');
    for (let i = 0; i < 3; i += 1) {
      assert.ok(await claim(r.reference));
      await save(r.id, false, null, 'timeout');
    }
    assert.equal(await claim(r.reference), null);
    for (let i = 0; i < 7; i += 1) {
      assert.ok(await claim(r.reference, true));
      await save(r.id, false, null, 'timeout');
    }
    assert.equal(await claim(r.reference, true), null);
    assert.equal((await row(r.id)).ai_attempts, 10);
  });
  test('a finished request is not analysed again automatically, but staff can ask', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await claim(r.reference);
    await save(r.id, true, output());
    assert.equal(await claim(r.reference), null);
    assert.ok(await claim(r.reference, true));
  });
  test('an abandoned run can be taken again after 2 minutes', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await claim(r.reference);
    await pool.query(`update public.requests set ai_claimed_at = now() - interval '3 minutes' where id = $1`, [r.id]);
    assert.ok(await claim(r.reference));
  });
  test('suspended churches and unknown references are skipped', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await pool.query(`update public.churches set status = 'suspended' where id = $1`, [s.grace]);
    try { assert.equal(await claim(r.reference), null); } finally {
      await pool.query(`update public.churches set status = 'verified' where id = $1`, [s.grace]);
    }
    assert.equal(await claim('MM-NOPE'), null);
  });
  test('resource options are only fitting resources, without names, and only when awaiting a resource', async () => {
    const res = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity, coverage_areas)
      values ($1, 'Secret Name Pack', 'food', 'pack', 5, '{Ijapo}') returning id`, [s.grace])).rows[0].id;
    await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Too small', 'food', 'pack', 1)`, [s.grace]);
    await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Faith food', 'food', 'pack', 50)`, [s.faith]);
    const r = await staffSubmit('We need food for the week please.', { area: 'Ijapo', qty: 2 });
    assert.deepEqual((await claim(r.reference)).resource_options, []);
    await save(r.id, true, output());
    await pool.query(`update public.requests set status = 'awaiting_match' where id = $1`, [r.id]);
    const v = await claim(r.reference, true);
    const ids = v.resource_options.map((o) => o.resource_id);
    assert.ok(ids.includes(res));
    assert.ok(v.resource_options.every((o) => o.available >= 2));
    assert.ok(!JSON.stringify(v.resource_options).includes('Secret Name Pack'));
    assert.ok(!JSON.stringify(v.resource_options).includes('Faith'));
    assert.equal(v.resource_options.find((o) => o.resource_id === res).coverage, 'covered');
  });
  test('only the trusted server can claim or save', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await db.rejects(s.u.graceOwner, 'select public.ai_claim($1)', [r.reference], /permission denied/);
    await db.rejects('anon', 'select public.ai_claim($1)', [r.reference], /permission denied/);
    await db.rejects(s.u.graceOwner, 'select public.ai_save($1,true,$2,null,$3,$4,$5)',
      [r.id, JSON.stringify(output()), 'x', 'y', 'z'], /permission denied/);
  });
});

describe('saving results', () => {
  test('stores the output, marks done, audits without an actor, and adds no history entry', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await claim(r.reference);
    const id = (await save(r.id, true, output())).rows[0].id;
    const a = (await pool.query('select * from public.ai_analyses where id = $1', [id])).rows[0];
    assert.equal(a.status, 'done');
    assert.equal(a.model, 'claude-haiku-5-5');
    assert.equal(a.output.summary, 'A family of four needs food this week.');
    assert.equal((await row(r.id)).ai_status, 'done');
    assert.deepEqual((await events(r.id)).map((e) => e.event_type), ['submitted']);
    const log = (await pool.query(`select actor_user_id, metadata from public.audit_logs where action = 'request.ai_analysed' and entity_id = $1`, [r.id])).rows[0];
    assert.equal(log.actor_user_id, null);
    assert.equal(log.metadata.analysis_id, id);
  });
  test('the AI never changes status, category or anything else on the request', async () => {
    const r = await staffSubmit('We need food for the week please.');
    const before = await row(r.id);
    await claim(r.reference);
    await save(r.id, true, output({ suggested_category: 'clothing', urgency: 'high', status: 'approved' }));
    const after = await row(r.id);
    for (const k of ['status', 'category_key', 'quantity_needed', 'original_text', 'attention_flag', 'outcome_reason']) {
      assert.deepEqual(after[k], before[k], k);
    }
  });
  test('a failure is recorded without output', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await claim(r.reference);
    await save(r.id, false, output(), 'timeout');
    const a = (await pool.query('select status, output, error from public.ai_analyses where request_id = $1', [r.id])).rows[0];
    assert.deepEqual(a, { status: 'failed', output: null, error: 'timeout' });
    assert.equal((await row(r.id)).ai_status, 'failed');
  });
  test('cannot save without a claim, or save twice', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await db.rejects('service', 'select public.ai_save($1,true,$2,null,$3,$4,$5)', [r.id, JSON.stringify(output()), 'a', 'b', 'c'], /not_claimed/);
    await claim(r.reference);
    await save(r.id, true, output());
    await db.rejects('service', 'select public.ai_save($1,true,$2,null,$3,$4,$5)', [r.id, JSON.stringify(output()), 'a', 'b', 'c'], /not_claimed/);
  });
  test('output without a summary is refused', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await claim(r.reference);
    await db.rejects('service', 'select public.ai_save($1,true,$2,null,$3,$4,$5)', [r.id, JSON.stringify({ summary: 5 }), 'a', 'b', 'c'], /invalid_output/);
  });
  test('an unknown or unchanged suggested category is dropped', async () => {
    for (const cat of ['weapons', 'food']) {
      const r = await staffSubmit('We need food for the week please.');
      await claim(r.reference);
      const id = (await save(r.id, true, output({ suggested_category: cat }))).rows[0].id;
      assert.equal((await pool.query('select output from public.ai_analyses where id = $1', [id])).rows[0].output.suggested_category, null, cat);
    }
  });
  test("another church's resource, or one that does not fit, is dropped", async () => {
    const theirs = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Theirs', 'food', 'pack', 50) returning id`, [s.faith])).rows[0].id;
    const small = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Small', 'food', 'pack', 1) returning id`, [s.grace])).rows[0].id;
    for (const rid of [theirs, small]) {
      const r = await staffSubmit('We need food for the week please.', { qty: 3 });
      await pool.query(`update public.requests set status = 'awaiting_match' where id = $1`, [r.id]);
      await claim(r.reference);
      const id = (await save(r.id, true, output({ resource: { resource_id: rid, explanation: 'Fits.' } }))).rows[0].id;
      assert.equal((await pool.query('select output from public.ai_analyses where id = $1', [id])).rows[0].output.resource, null);
    }
  });
});

describe('AI safeguarding flag', () => {
  test('raises needs attention with the reason and no actor', async () => {
    const r = await staffSubmit('Please help, things are hard at home lately.');
    await claim(r.reference);
    await save(r.id, true, output({ safeguarding: { concern: true, reason: 'Mentions difficulty at home that may mean risk.' } }));
    const q = await row(r.id);
    assert.equal(q.attention_flag, true);
    assert.equal(q.attention_source, 'ai');
    assert.match(q.attention_reason, /^AI check: Mentions difficulty at home that may mean risk\. A person should review it\.$/);
    const e = (await events(r.id)).at(-1);
    assert.equal(e.event_type, 'attention_flagged');
    assert.equal(e.actor_user_id, null);
  });
  test('only a person can clear it, and the AI does not raise it again afterwards', async () => {
    const r = await staffSubmit('Please help, things are hard at home lately.');
    await claim(r.reference);
    await save(r.id, true, output({ safeguarding: { concern: true, reason: 'Possible risk.' } }));
    await db.rejects('service', 'select public.acknowledge_request_attention($1, $2)', [r.id, 'Checked'], /permission denied|forbidden/);
    await db.run(s.u.graceCoord, 'select public.acknowledge_request_attention($1, $2)', [r.id, 'Called them; safe.']);
    await claim(r.reference, true);
    await save(r.id, true, output({ safeguarding: { concern: true, reason: 'Possible risk.' } }));
    const q = await row(r.id);
    assert.ok(q.attention_acknowledged_at, 'stays acknowledged');
    assert.equal((await events(r.id)).filter((e) => e.event_type === 'attention_flagged').length, 1);
  });
  test('does not overwrite a keyword or staff flag', async () => {
    const r = await staffSubmit('He threatened me last night, we need food.');
    await claim(r.reference);
    await save(r.id, true, output({ safeguarding: { concern: true, reason: 'Threat.' } }));
    const q = await row(r.id);
    assert.equal(q.attention_source, 'keyword');
  });
  test('no concern means no flag', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await claim(r.reference);
    await save(r.id, true, output());
    assert.equal((await row(r.id)).attention_flag, false);
  });
});

describe('staff: run again', () => {
  test('a member may ask; it is audited and returns the reference', async () => {
    const r = await staffSubmit('We need food for the week please.');
    const ref = (await db.run(s.u.graceCoord, 'select public.ai_request_rerun($1) as v', [r.id])).rows[0].v;
    assert.equal(ref, r.reference);
    assert.equal((await pool.query(`select count(*)::int n from public.audit_logs where action = 'request.ai_rerun_requested' and entity_id = $1 and actor_user_id = $2`, [r.id, s.u.graceCoord])).rows[0].n, 1);
  });
  test('other churches, anonymous callers, running analyses and the limit are refused', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await db.rejects(s.u.faithCoord, 'select public.ai_request_rerun($1)', [r.id], /forbidden/);
    await db.rejects('anon', 'select public.ai_request_rerun($1)', [r.id], /permission denied/);
    await claim(r.reference);
    await db.rejects(s.u.graceCoord, 'select public.ai_request_rerun($1)', [r.id], /ai_running/);
    await pool.query('update public.requests set ai_attempts = 10, ai_status = $2 where id = $1', [r.id, 'failed']);
    await db.rejects(s.u.graceCoord, 'select public.ai_request_rerun($1)', [r.id], /ai_limit_reached/);
  });
});

describe('staff: use suggested category', () => {
  async function analysed(category, o = {}) {
    const r = await staffSubmit('Our child needs a school uniform and shoes.', { category: o.from ?? 'food' });
    await claim(r.reference);
    const id = (await save(r.id, true, output({ suggested_category: category }))).rows[0].id;
    return { ...r, analysis: id };
  }
  const apply = (actor, r, from = 'food') =>
    db.run(actor, 'select public.apply_ai_category($1,$2,$3) as v', [r.id, from, r.analysis]);

  test('changes the category, records history and audit with the person who did it', async () => {
    const r = await analysed('clothing');
    assert.equal((await apply(s.u.graceCoord, r)).rows[0].v, 'clothing');
    assert.equal((await row(r.id)).category_key, 'clothing');
    const e = (await events(r.id)).at(-1);
    assert.equal(e.event_type, 'category_changed');
    assert.equal(e.actor_user_id, s.u.graceCoord);
    assert.equal(e.note, 'Kind of help changed from Food and groceries to Clothing (AI suggestion accepted).');
    const log = (await pool.query(`select actor_user_id, metadata from public.audit_logs where action = 'request.category_changed' and entity_id = $1`, [r.id])).rows[0];
    assert.equal(log.actor_user_id, s.u.graceCoord);
    assert.deepEqual(log.metadata, { from: 'food', to: 'clothing', source: 'ai', analysis_id: r.analysis });
  });
  test('a stale page or a second click is refused', async () => {
    const r = await analysed('clothing');
    await apply(s.u.graceCoord, r);
    await db.rejects(s.u.graceCoord, 'select public.apply_ai_category($1,$2,$3)', [r.id, 'food', r.analysis], /category_changed/);
    await db.rejects(s.u.graceCoord, 'select public.apply_ai_category($1,$2,$3)', [r.id, 'clothing', r.analysis], /no_suggestion/);
  });
  test('a newer analysis replaces the suggestion that was shown', async () => {
    const r = await analysed('clothing');
    await claim(r.reference, true);
    await save(r.id, true, output({ suggested_category: 'education' }));
    await db.rejects(s.u.graceCoord, 'select public.apply_ai_category($1,$2,$3)', [r.id, 'food', r.analysis], /suggestion_changed/);
  });
  test('no suggestion, other church, anonymous, locked statuses', async () => {
    const none = await analysed(null);
    await db.rejects(s.u.graceCoord, 'select public.apply_ai_category($1,$2,$3)', [none.id, 'food', none.analysis], /no_suggestion/);
    const r = await analysed('clothing');
    await db.rejects(s.u.faithCoord, 'select public.apply_ai_category($1,$2,$3)', [r.id, 'food', r.analysis], /forbidden/);
    await db.rejects('anon', 'select public.apply_ai_category($1,$2,$3)', [r.id, 'food', r.analysis], /permission denied/);
    for (const status of ['approved', 'in_progress', 'fulfilled', 'declined']) {
      await pool.query('update public.requests set status = $2 where id = $1', [r.id, status]);
      await db.rejects(s.u.graceCoord, 'select public.apply_ai_category($1,$2,$3)', [r.id, 'food', r.analysis], /category_locked/);
    }
  });
});

describe('request detail and recommendation tracking', () => {
  test('detail shows the latest successful analysis with labels, never the error text', async () => {
    const res = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Detail pack', 'food', 'pack', 20) returning id`, [s.grace])).rows[0].id;
    const r = await staffSubmit('Our child needs a school uniform and shoes.', { qty: 1 });
    await pool.query(`update public.requests set status = 'awaiting_match' where id = $1`, [r.id]);
    await claim(r.reference);
    await save(r.id, true, output({ suggested_category: 'clothing', resource: { resource_id: res, explanation: 'Plenty left.' } }));
    await claim(r.reference, true);
    await save(r.id, false, null, 'secret upstream error text');
    const d = (await db.run(s.u.graceCoord, 'select public.get_request_detail($1) as v', [r.id])).rows[0].v;
    assert.equal(d.ai.status, 'failed');
    assert.equal(d.ai.can_rerun, true);
    assert.equal(d.ai.latest.output.summary, 'A family of four needs food this week.');
    assert.equal(d.ai.latest.suggested_category_label, 'Clothing');
    assert.equal(d.ai.latest.resource_name, 'Detail pack');
    assert.ok(!JSON.stringify(d).includes('secret upstream error text'));
    assert.equal(d.request.ai_attempts, undefined);

    await db.run(s.u.graceCoord, 'select public.approve_allocation($1,$2,$3,null)', [r.id, 'awaiting_match', res]);
    const a = (await pool.query('select ai_recommended from public.allocations where request_id = $1', [r.id])).rows[0];
    assert.equal(a.ai_recommended, true);
  });
  test('reserving a different resource is not marked as recommended', async () => {
    const other = (await pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity)
      values ($1, 'Other pack', 'food', 'pack', 20) returning id`, [s.grace])).rows[0].id;
    const r = await staffSubmit('We need food for the week please.', { qty: 1 });
    await pool.query(`update public.requests set status = 'awaiting_match' where id = $1`, [r.id]);
    await db.run(s.u.graceCoord, 'select public.approve_allocation($1,$2,$3,null)', [r.id, 'awaiting_match', other]);
    assert.equal((await pool.query('select ai_recommended from public.allocations where request_id = $1', [r.id])).rows[0].ai_recommended, false);
  });
  test('members of another church cannot read analyses', async () => {
    const r = await staffSubmit('We need food for the week please.');
    await claim(r.reference);
    await save(r.id, true, output());
    const { rows } = await db.run(s.u.faithCoord, 'select count(*)::int n from public.ai_analyses where request_id = $1', [r.id]);
    assert.equal(rows[0].n, 0);
    await db.blocked(s.u.graceCoord, `update public.ai_analyses set output = '{}' where request_id = $1`, [r.id]);
  });
});
