// Milestone 4: listing, viewing, status changes, notes and safeguarding flags.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDatabase, makeRunner, DENIED } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

const RULES = JSON.parse(readFileSync(new URL('../../src/lib/request-transitions.json', import.meta.url), 'utf8'));
const ALL_STATUSES = ['submitted', 'under_review', 'awaiting_clarification', 'awaiting_match', 'approved',
  'in_progress', 'fulfilled', 'declined', 'cancelled', 'unable_to_fulfil'];

let pool, db, s;
before(async () => {
  pool = await createTestDatabase('mercymap_test_requests');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
});
after(async () => { await pool.end(); });

const newRequest = async (churchId = s.grace, status = 'submitted', extra = {}) => {
  const { rows } = await pool.query(
    `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at, status, created_at)
     values ($1, 'public', $3, 'Synthetic request for testing.', now(), $2, coalesce($4, now())) returning id, reference`,
    [churchId, status, extra.category ?? 'food', extra.createdAt ?? null]);
  return rows[0];
};
const change = (actor, id, from, to, note = null) =>
  db.run(actor, 'select public.change_request_status($1, $2, $3, $4) as s', [id, from, to, note]);
const statusOf = async (id) => (await pool.query('select status, outcome_reason from public.requests where id = $1', [id])).rows[0];

describe('the transition rules', () => {
  test('the database and the app agree on every possible status change', async () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const { rows } = await pool.query('select private.request_transition_allowed($1, $2) as ok', [from, to]);
        const expected = (RULES.transitions[from] ?? []).includes(to);
        assert.equal(rows[0].ok, expected, `${from} -> ${to}`);
      }
      for (const to of ALL_STATUSES) {
        const { rows: n } = await pool.query('select private.request_change_needs_note($1, $2) as n', [from, to]);
        const expectedNote = RULES.noteRequired.includes(to) || (RULES.allocatedStatuses.includes(from) && to !== 'in_progress');
        assert.equal(n[0].n, expectedNote, `note for ${from} -> ${to}`);
      }
    }
  });

  test('every allowed change works and is recorded with who, from, to and note', async () => {
    for (const [from, targets] of Object.entries(RULES.transitions)) {
      for (const to of targets) {
        const r = await newRequest(s.grace, from);
        const needs = RULES.noteRequired.includes(to) || (RULES.allocatedStatuses.includes(from) && to !== 'in_progress');
        const note = needs ? `Reason for ${to}` : null;
        const { rows } = await change(s.u.graceCoord, r.id, from, to, note);
        assert.equal(rows[0].s, to);
        const now = await statusOf(r.id);
        assert.equal(now.status, to);
        assert.equal(now.outcome_reason, ['declined', 'cancelled', 'unable_to_fulfil'].includes(to) ? note : null);
        const ev = await pool.query(
          `select event_type, from_status, to_status, note, actor_user_id from public.request_events where request_id = $1`, [r.id]);
        assert.deepEqual(ev.rows, [{ event_type: 'status_changed', from_status: from, to_status: to, note, actor_user_id: s.u.graceCoord }]);
      }
    }
  });

  test('approved and fulfilled cannot be set by hand; in progress only from approved', async () => {
    const r = await newRequest(s.grace, 'awaiting_match');
    for (const to of ['approved', 'fulfilled']) {
      await db.rejects(s.u.graceOwner, 'select public.change_request_status($1, $2, $3, $4)',
        [r.id, 'awaiting_match', to, 'x'], /requires_allocation/);
    }
    await db.rejects(s.u.graceOwner, 'select public.change_request_status($1, $2, $3, $4)',
      [r.id, 'awaiting_match', 'in_progress', 'x'], /invalid_transition/);
    assert.equal((await statusOf(r.id)).status, 'awaiting_match');
  });

  test('changes outside the rules are refused, including from closed requests', async () => {
    const cases = [['submitted', 'awaiting_match'], ['submitted', 'unable_to_fulfil'], ['awaiting_clarification', 'awaiting_match'],
      ['in_progress', 'declined'], ['in_progress', 'under_review'], ['fulfilled', 'cancelled'], ['approved', 'under_review'],
      ['declined', 'under_review'], ['cancelled', 'submitted'], ['unable_to_fulfil', 'under_review'], ['submitted', 'nonsense']];
    for (const [from, to] of cases) {
      const r = await newRequest(s.grace, from);
      await db.rejects(s.u.graceCoord, 'select public.change_request_status($1, $2, $3, $4)',
        [r.id, from, to, 'A reason'], /invalid_transition/, `${from} -> ${to}`);
    }
  });

  test('a reason is required to decline, cancel, close or ask for clarification', async () => {
    for (const to of ['declined', 'cancelled', 'unable_to_fulfil', 'awaiting_clarification']) {
      const r = await newRequest(s.grace, 'under_review');
      for (const note of [null, '', '  \n ', 'ok']) {
        await db.rejects(s.u.graceCoord, 'select public.change_request_status($1, $2, $3, $4)',
          [r.id, 'under_review', to, note], /reason_required/, `${to} with ${JSON.stringify(note)}`);
      }
    }
  });

  test('a stale page cannot overwrite someone else\'s change', async () => {
    const r = await newRequest(s.grace, 'submitted');
    await change(s.u.graceCoord, r.id, 'submitted', 'under_review');
    await db.rejects(s.u.graceOwner, 'select public.change_request_status($1, $2, $3, $4)',
      [r.id, 'submitted', 'declined', 'Not eligible'], /status_changed/);
    assert.equal((await statusOf(r.id)).status, 'under_review');
  });

  test('two people acting at once: exactly one change wins', async () => {
    const r = await newRequest(s.grace, 'under_review');
    const results = await Promise.allSettled([
      change(s.u.graceCoord, r.id, 'under_review', 'awaiting_match'),
      change(s.u.graceOwner, r.id, 'under_review', 'declined', 'Duplicate request'),
      change(s.u.graceAdmin, r.id, 'under_review', 'cancelled', 'Withdrawn'),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    for (const x of results.filter((y) => y.status === 'rejected')) assert.match(x.reason.message, /status_changed/);
    const ev = await pool.query('select count(*)::int as n from public.request_events where request_id = $1', [r.id]);
    assert.equal(ev.rows[0].n, 1);
  });

  test('other churches and outsiders cannot change a request', async () => {
    const r = await newRequest(s.grace, 'submitted');
    for (const actor of [s.u.faithOwner, s.u.faithCoord, s.u.outsider, s.u.platformAdmin]) {
      await db.rejects(actor, 'select public.change_request_status($1, $2, $3, $4)', [r.id, 'submitted', 'under_review', null], /forbidden/);
    }
    await db.rejects(s.u.graceOwner, 'select public.change_request_status($1, $2, $3, $4)',
      ['00000000-0000-0000-0000-000000000000', 'submitted', 'under_review', null], /forbidden/);
    assert.equal((await statusOf(r.id)).status, 'submitted');
  });

  test('a suspended church cannot change statuses', async () => {
    const r = await newRequest(s.faith, 'submitted');
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'suspended')`, [s.faith]);
    await db.rejects(s.u.faithOwner, 'select public.change_request_status($1, $2, $3, $4)', [r.id, 'submitted', 'under_review', null], /church_suspended/);
    await db.run(s.u.platformAdmin, `select public.set_church_status($1, 'pending')`, [s.faith]);
  });
});

describe('viewing a request', () => {
  test('a member gets the request, its category and its full history, and the view is audited', async () => {
    const r = await newRequest(s.grace, 'submitted');
    await change(s.u.graceCoord, r.id, 'submitted', 'under_review');
    await db.run(s.u.graceCoord, 'select public.add_request_note($1, $2)', [r.id, 'Called and left a message.']);
    const before = (await pool.query(`select count(*)::int as n from public.audit_logs where action = 'request.viewed' and entity_id = $1`, [r.id])).rows[0].n;
    const { rows } = await db.run(s.u.graceAdmin, 'select public.get_request_detail($1) as d', [r.id]);
    const d = rows[0].d;
    assert.equal(d.request.reference, r.reference);
    assert.equal(d.request.status, 'under_review');
    assert.equal(d.category_label, 'Food and groceries');
    assert.deepEqual(d.events.map((e) => e.event_type), ['status_changed', 'note_added']);
    assert.equal(d.events[0].actor_email, 'coordinator@grace.test');
    assert.equal(d.request.ai_attempts, undefined);
    const audit = await pool.query(
      `select actor_user_id, church_id from public.audit_logs where action = 'request.viewed' and entity_id = $1 order by id desc`, [r.id]);
    assert.equal(audit.rowCount, before + 1);
    assert.equal(audit.rows[0].actor_user_id, s.u.graceAdmin);
    assert.equal(audit.rows[0].church_id, s.grace);
  });

  test('other churches, outsiders and unknown ids get the same "forbidden", and nothing is logged', async () => {
    const r = await newRequest(s.grace, 'submitted');
    for (const actor of [s.u.faithOwner, s.u.outsider, s.u.platformAdmin]) {
      await db.rejects(actor, 'select public.get_request_detail($1)', [r.id], /forbidden/);
    }
    await db.rejects(s.u.graceOwner, 'select public.get_request_detail($1)', ['00000000-0000-0000-0000-000000000000'], /forbidden/);
    const audit = await pool.query(`select count(*)::int as n from public.audit_logs where entity_id = $1`, [r.id]);
    assert.equal(audit.rows[0].n, 0);
  });
});

describe('listing', () => {
  let ids, hope, hopeOwner;
  before(async () => {
    // A fresh church, so the counts are exact.
    hopeOwner = (await pool.query(`insert into auth.users (email) values ('owner@hope.test') returning id`)).rows[0].id;
    hope = (await db.run(hopeOwner, `select public.create_church('Hope Chapel', 'hope-chapel') as id`)).rows[0].id;
    ids = {
      newest: await newRequest(hope, 'submitted', { createdAt: '2026-11-17T10:00:00Z' }),
      review: await newRequest(hope, 'under_review', { category: 'clothing', createdAt: '2026-11-16T10:00:00Z' }),
      match: await newRequest(hope, 'awaiting_match', { createdAt: '2026-11-15T10:00:00Z' }),
      declined: await newRequest(hope, 'declined', { createdAt: '2026-11-14T10:00:00Z' }),
      faith: await newRequest(s.faith, 'submitted'),
    };
    await pool.query(`update public.requests set channel = 'staff' where id = $1`, [ids.review.id]);
    await pool.query(`update public.requests set attention_flag = true, attention_source = 'staff', attention_reason = 'x' where id = $1`, [ids.match.id]);
  });
  const list = (actor, args = {}) => db.run(actor,
    'select public.list_requests($1, $2, $3, $4, $5, $6, $7, $8) as l',
    [args.church ?? hope, args.status ?? 'open', args.category ?? null, args.channel ?? null,
      args.search ?? null, args.attention ?? false, args.limit ?? 25, args.offset ?? 0]).then((r) => r.rows[0].l);

  test('open requests, newest first, from the caller\'s church only', async () => {
    const l = await list(hopeOwner);
    assert.equal(l.total, 3);
    assert.deepEqual(l.rows.map((r) => r.reference), [ids.newest.reference, ids.review.reference, ids.match.reference]);
    assert.deepEqual(Object.keys(l.rows[0]).sort(),
      ['attention_open', 'category_key', 'category_label', 'channel', 'created_at', 'id', 'quantity_needed', 'reference', 'status']);
  });
  test('status, closed, all, category, channel, attention and search filters', async () => {
    assert.equal((await list(hopeOwner, { status: 'closed' })).total, 1);
    assert.equal((await list(hopeOwner, { status: 'all' })).total, 4);
    assert.equal((await list(hopeOwner, { status: 'under_review' })).rows[0].reference, ids.review.reference);
    assert.equal((await list(hopeOwner, { status: 'all', category: 'clothing' })).total, 1);
    assert.equal((await list(hopeOwner, { status: 'all', channel: 'staff' })).total, 1);
    const flagged = await list(hopeOwner, { status: 'all', attention: true });
    assert.equal(flagged.total, 1);
    assert.equal(flagged.rows[0].attention_open, true);
    const part = ids.declined.reference.slice(3, 9).toLowerCase();
    const found = await list(hopeOwner, { status: 'all', search: `  ${part} ` });
    assert.deepEqual(found.rows.map((r) => r.reference), [ids.declined.reference]);
    assert.equal((await list(hopeOwner, { status: 'all', search: ids.faith.reference })).total, 0);
  });
  test('paging, with limits kept in range', async () => {
    const p1 = await list(hopeOwner, { status: 'all', limit: 2, offset: 0 });
    const p2 = await list(hopeOwner, { status: 'all', limit: 2, offset: 2 });
    assert.equal(p1.total, 4);
    assert.equal(p1.rows.length + p2.rows.length, 4);
    assert.equal((await list(hopeOwner, { status: 'all', limit: 5000, offset: -3 })).rows.length, 4);
    assert.equal((await list(hopeOwner, { status: 'all', limit: 0 })).rows.length, 1);
  });
  test('counts', async () => {
    const { rows } = await db.run(hopeOwner, 'select public.request_status_counts($1) as c', [hope]);
    assert.deepEqual(rows[0].c, {
      total: 4, open: 3, closed: 1, attention_open: 1,
      by_status: { submitted: 1, under_review: 1, awaiting_match: 1, declined: 1 },
    });
  });
  test('another church cannot list or count Hope\'s requests', async () => {
    for (const actor of [s.u.graceOwner, s.u.faithOwner, s.u.outsider]) {
      await db.rejects(actor, 'select public.list_requests($1)', [hope], /forbidden/);
      await db.rejects(actor, 'select public.request_status_counts($1)', [hope], /forbidden/);
    }
  });
});

describe('notes and safeguarding', () => {
  test('notes are added to the history and must not be empty', async () => {
    const r = await newRequest(s.grace, 'declined');
    await db.run(s.u.graceCoord, 'select public.add_request_note($1, $2)', [r.id, '  Spoke to them in person.  ']);
    const ev = await pool.query('select event_type, note, actor_user_id from public.request_events where request_id = $1', [r.id]);
    assert.deepEqual(ev.rows, [{ event_type: 'note_added', note: 'Spoke to them in person.', actor_user_id: s.u.graceCoord }]);
    await db.rejects(s.u.graceCoord, 'select public.add_request_note($1, $2)', [r.id, ' \n '], /note_required/);
    await db.rejects(s.u.faithOwner, 'select public.add_request_note($1, $2)', [r.id, 'spying'], /forbidden/);
  });

  test('flag, acknowledge, then flag again', async () => {
    const r = await newRequest(s.grace, 'submitted');
    await db.rejects(s.u.graceCoord, 'select public.acknowledge_request_attention($1, $2)', [r.id, 'nothing to see'], /not_flagged/);
    await db.rejects(s.u.graceCoord, 'select public.flag_request_attention($1, $2)', [r.id, ''], /reason_required/);
    await db.run(s.u.graceCoord, 'select public.flag_request_attention($1, $2)', [r.id, 'Mentions a child left alone at night.']);
    await db.rejects(s.u.graceOwner, 'select public.flag_request_attention($1, $2)', [r.id, 'again'], /already_flagged/);
    let row = (await pool.query('select * from public.requests where id = $1', [r.id])).rows[0];
    assert.equal(row.attention_flag, true);
    assert.equal(row.attention_source, 'staff');
    assert.equal(row.attention_acknowledged_at, null);

    await db.rejects(s.u.graceOwner, 'select public.acknowledge_request_attention($1, $2)', [r.id, ''], /note_required/);
    await db.run(s.u.graceOwner, 'select public.acknowledge_request_attention($1, $2)', [r.id, 'Pastor visited; family is safe.']);
    row = (await pool.query('select * from public.requests where id = $1', [r.id])).rows[0];
    assert.equal(row.attention_acknowledged_by, s.u.graceOwner);
    assert.ok(row.attention_acknowledged_at);
    assert.equal(row.attention_note, 'Pastor visited; family is safe.');
    await db.rejects(s.u.graceOwner, 'select public.acknowledge_request_attention($1, $2)', [r.id, 'twice'], /not_flagged/);

    await db.run(s.u.graceCoord, 'select public.flag_request_attention($1, $2)', [r.id, 'New concern raised on follow-up call.']);
    row = (await pool.query('select * from public.requests where id = $1', [r.id])).rows[0];
    assert.equal(row.attention_acknowledged_at, null);
    assert.equal(row.attention_note, null);
    const ev = await pool.query(`select event_type from public.request_events where request_id = $1 order by created_at, id`, [r.id]);
    assert.deepEqual(ev.rows.map((e) => e.event_type).sort(), ['attention_acknowledged', 'attention_flagged', 'attention_flagged']);
    const audit = await pool.query(`select count(*)::int as n from public.audit_logs where action = 'request.attention_acknowledged' and entity_id = $1`, [r.id]);
    assert.equal(audit.rows[0].n, 1);
  });

  test('other churches cannot flag or acknowledge', async () => {
    const r = await newRequest(s.grace, 'submitted');
    await db.rejects(s.u.faithOwner, 'select public.flag_request_attention($1, $2)', [r.id, 'not mine'], /forbidden/);
    await db.run(s.u.graceCoord, 'select public.flag_request_attention($1, $2)', [r.id, 'Real concern here.']);
    await db.rejects(s.u.faithOwner, 'select public.acknowledge_request_attention($1, $2)', [r.id, 'not mine'], /forbidden/);
  });
});

describe('the anonymous role', () => {
  for (const call of [
    `select public.list_requests('00000000-0000-0000-0000-000000000000')`,
    `select public.request_status_counts('00000000-0000-0000-0000-000000000000')`,
    `select public.get_request_detail('00000000-0000-0000-0000-000000000000')`,
    `select public.change_request_status('00000000-0000-0000-0000-000000000000', 'submitted', 'under_review')`,
    `select public.add_request_note('00000000-0000-0000-0000-000000000000', 'x')`,
    `select public.flag_request_attention('00000000-0000-0000-0000-000000000000', 'x')`,
    `select public.acknowledge_request_attention('00000000-0000-0000-0000-000000000000', 'x')`,
  ]) {
    test(`cannot call: ${call.slice(14, 50)}`, async () => { await db.rejects('anon', call, [], DENIED); });
  }
});
