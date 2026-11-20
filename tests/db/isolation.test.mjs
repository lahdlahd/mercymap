// Tenant isolation: no church can read or change another church's data,
// and the anonymous public role can touch nothing at all.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, makeRunner, DENIED } from './harness.mjs';
import { seedTwoChurches } from './fixtures.mjs';

let pool, db, s;

before(async () => {
  pool = await createTestDatabase('mercymap_test_isolation');
  db = makeRunner(pool);
  s = await seedTwoChurches(pool, db);
});
after(async () => { await pool.end(); });

// Tenant tables that carry church_id, with a harmless column to try updating.
const TENANT_TABLES = {
  church_memberships: 'role',
  invitations: 'email',
  requests: 'original_text',
  ai_analyses: 'model',
  request_events: 'note',
  resources: 'name',
  allocations: 'release_reason',
  volunteers: 'full_name',
  assignments: 'task_brief',
  notifications: 'read_at',
  audit_logs: 'action',
};
const ALL_TABLES = [...Object.keys(TENANT_TABLES), 'churches', 'categories', 'platform_admins', 'intake_rate_limits'];

describe('structure', () => {
  test('every table in public has row level security enabled', async () => {
    const { rows } = await pool.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(rows.map((r) => r.relname), []);
  });

  test('the test list covers every table in public', async () => {
    const { rows } = await pool.query(
      `select tablename from pg_tables where schemaname = 'public' order by 1`);
    assert.deepEqual(rows.map((r) => r.tablename), [...ALL_TABLES].sort());
  });

  test('the anonymous role holds no privilege on any table, view or column', async () => {
    const tables = await pool.query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`);
    assert.deepEqual(tables.rows, []);
    const columns = await pool.query(
      `select table_name, column_name from information_schema.column_privileges
        where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`);
    assert.deepEqual(columns.rows, []);
  });

  test('the anonymous role cannot execute any function in public or private', async () => {
    const { rows } = await pool.query(
      `select n.nspname || '.' || p.proname as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and has_function_privilege('anon', p.oid, 'execute')`);
    assert.deepEqual(rows.map((r) => r.fn), []);
  });

  test('no policy applies to the anonymous or public role', async () => {
    const { rows } = await pool.query(
      `select tablename, policyname from pg_policies
        where schemaname = 'public' and (roles && array['anon', 'public']::name[])`);
    assert.deepEqual(rows, []);
  });

  test('every security definer function pins its search_path', async () => {
    const { rows } = await pool.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    assert.deepEqual(rows.map((r) => r.proname), []);
  });
});

describe('anonymous public role', () => {
  for (const table of ALL_TABLES) {
    test(`cannot read ${table}`, async () => {
      await db.rejects('anon', `select * from public.${table}`, [], DENIED);
    });
  }
  test('cannot insert a request directly', async () => {
    await db.rejects('anon',
      `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at)
       values ($1, 'public', 'food', 'direct insert', now())`, [s.grace], DENIED);
  });
  test('cannot register a church', async () => {
    await db.rejects('anon', `select public.create_church('X Church', 'x-church')`, [], DENIED);
  });
  test('cannot read the availability view', async () => {
    await db.rejects('anon', 'select * from public.resource_availability', [], DENIED);
  });
});

describe('cross-church access', () => {
  // Actors who must see nothing of Grace Community: another church's owner,
  // another church's coordinator, and a signed-in user with no church.
  const intruders = () => ({
    'Living Faith owner': s.u.faithOwner,
    'Living Faith coordinator': s.u.faithCoord,
    'signed-in user with no church': s.u.outsider,
  });

  for (const [table, column] of Object.entries(TENANT_TABLES)) {
    test(`${table}: other churches cannot read, update or delete Grace rows`, async () => {
      for (const [who, actor] of Object.entries(intruders())) {
        const cols = table === 'invitations' ? 'id' : '*';
        const seen = await db.run(actor, `select ${cols} from public.${table} where church_id = $1`, [s.grace]);
        assert.equal(seen.rowCount, 0, `${who} can read ${table}`);

        const value = column === 'read_at' ? 'now()' : `'tampered'`;
        await db.blocked(actor, `update public.${table} set ${column} = ${value} where church_id = $1`, [s.grace]);
        await db.blocked(actor, `delete from public.${table} where church_id = $1`, [s.grace]);
      }
      // Nothing changed, checked as the database owner.
      const intact = await pool.query(
        `select count(*)::int as n from public.${table} where church_id = $1`, [s.grace]);
      assert.ok(intact.rows[0].n >= 1, `${table} lost Grace rows`);
    });
  }

  test('other churches cannot read or edit the Grace church record', async () => {
    for (const actor of Object.values(intruders())) {
      const seen = await db.run(actor, 'select * from public.churches where id = $1', [s.grace]);
      assert.equal(seen.rowCount, 0);
      await db.blocked(actor, `update public.churches set name = 'Hijacked' where id = $1`, [s.grace]);
    }
    const { rows } = await pool.query('select name from public.churches where id = $1', [s.grace]);
    assert.equal(rows[0].name, 'Grace Community Church');
  });

  test('listing without a filter returns only the caller\'s own church', async () => {
    for (const table of Object.keys(TENANT_TABLES)) {
      if (table === 'invitations') continue; // column-restricted; covered above
      const { rows } = await db.run(s.u.faithOwner, `select distinct church_id from public.${table}`);
      assert.deepEqual(rows.map((r) => r.church_id), [s.faith], table);
    }
    const churches = await db.run(s.u.faithOwner, 'select id from public.churches');
    assert.deepEqual(churches.rows.map((r) => r.id), [s.faith]);
    const availability = await db.run(s.u.faithOwner, 'select distinct church_id from public.resource_availability');
    assert.deepEqual(availability.rows.map((r) => r.church_id), [s.faith]);
  });

  test('other churches cannot insert rows into Grace', async () => {
    const a = s.u.faithOwner;
    await db.rejects(a,
      `insert into public.requests (church_id, channel, created_by, category_key, original_text, consent_given_at)
       values ($1, 'staff', $2, 'food', 'planted', now())`, [s.grace, a], DENIED);
    await db.rejects(a,
      `insert into public.resources (church_id, name, category_key, unit, total_quantity)
       values ($1, 'Planted', 'food', 'item', 5)`, [s.grace], DENIED);
    await db.rejects(a,
      `insert into public.volunteers (church_id, full_name) values ($1, 'Planted Person')`, [s.grace], DENIED);
    await db.rejects(a,
      `insert into public.assignments (church_id, volunteer_id, request_id, task_brief, assigned_by)
       values ($1, $2, $3, 'planted', $4)`,
      [s.grace, s.rows.grace.volunteers, s.rows.grace.requests, a], DENIED);
    await db.rejects(a,
      `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
       values ($1, 'spy@faith.test', 'coordinator', $2, $3, now() + interval '1 day')`,
      [s.grace, 'f'.repeat(64), a], DENIED);
    for (const table of ['church_memberships', 'ai_analyses', 'request_events', 'allocations', 'notifications', 'audit_logs']) {
      await db.rejects(a, `insert into public.${table} (church_id) values ($1)`, [s.grace], DENIED);
    }
  });

  test('a member of two churches cannot move a row between them', async () => {
    await pool.query(
      `insert into public.church_memberships (church_id, user_id, role) values ($1, $2, 'coordinator')`,
      [s.faith, s.u.graceCoord]);
    await db.rejects(s.u.graceCoord,
      'update public.resources set church_id = $1 where id = $2', [s.faith, s.rows.grace.resources],
      /permission denied|church_id_immutable/);
    await db.rejects('service',
      'update public.volunteers set church_id = $1 where id = $2', [s.faith, s.rows.grace.volunteers],
      /church_id_immutable|foreign key/);
    await pool.query('delete from public.church_memberships where church_id = $1 and user_id = $2',
      [s.faith, s.u.graceCoord]);
  });

  test('a suspended member loses access immediately', async () => {
    await pool.query(`update public.church_memberships set status = 'suspended' where id = $1`, [s.m.faithCoord]);
    const seen = await db.run(s.u.faithCoord, 'select id from public.requests');
    assert.equal(seen.rowCount, 0);
    await pool.query(`update public.church_memberships set status = 'active' where id = $1`, [s.m.faithCoord]);
    const again = await db.run(s.u.faithCoord, 'select id from public.requests');
    assert.equal(again.rowCount, 1);
  });
});

describe('cross-church references are impossible even for the trusted server role', () => {
  const FK = /foreign key constraint/;
  test('allocation: Grace request with Living Faith resource', async () => {
    await pool.query(`update public.allocations set status = 'released' where id = $1`, [s.rows.grace.allocations]);
    await db.rejects('service',
      `insert into public.allocations (church_id, request_id, resource_id, quantity)
       values ($1, $2, $3, 1)`, [s.grace, s.rows.grace.requests, s.rows.faith.resources],
      /resource_not_found|foreign key constraint/);
    await db.rejects('service',
      `insert into public.allocations (church_id, request_id, resource_id, quantity)
       values ($1, $2, $3, 1)`, [s.faith, s.rows.grace.requests, s.rows.faith.resources], FK);
  });
  test('assignment: Living Faith volunteer on a Grace request', async () => {
    await db.rejects('service',
      `insert into public.assignments (church_id, volunteer_id, request_id, task_brief)
       values ($1, $2, $3, 'x')`, [s.grace, s.rows.faith.volunteers, s.rows.grace.requests], FK);
  });
  test('AI analysis and event: wrong church for the request', async () => {
    await db.rejects('service',
      `insert into public.ai_analyses (church_id, request_id, status, provider, model, prompt_version)
       values ($1, $2, 'done', 't', 't', 'v1')`, [s.faith, s.rows.grace.requests], FK);
    await db.rejects('service',
      `insert into public.request_events (church_id, request_id, event_type)
       values ($1, $2, 'note_added')`, [s.faith, s.rows.grace.requests], FK);
  });
  test('notification: recipient who is not a member of that church', async () => {
    await db.rejects('service',
      `insert into public.notifications (church_id, recipient_user_id, type, title)
       values ($1, $2, 'request_new', 'x')`, [s.grace, s.u.faithOwner], FK);
  });
  test('resource manager who is not a member of that church', async () => {
    await db.rejects('service',
      `insert into public.resources (church_id, name, category_key, unit, total_quantity, manager_user_id)
       values ($1, 'Clothes', 'clothing', 'item', 3, $2)`, [s.grace, s.u.faithOwner], FK);
  });
});

describe('members can work inside their own church', () => {
  test('a coordinator reads own-church rows in every member-readable table', async () => {
    for (const table of ['requests', 'ai_analyses', 'request_events', 'resources', 'allocations',
      'volunteers', 'assignments', 'church_memberships', 'churches', 'categories']) {
      const { rowCount } = await db.run(s.u.graceCoord, `select * from public.${table}`);
      assert.ok(rowCount >= 1, table);
    }
  });
  test('a coordinator can add and edit resources and volunteers', async () => {
    const res = await db.run(s.u.graceCoord,
      `insert into public.resources (church_id, name, category_key, unit, total_quantity)
       values ($1, 'School bags', 'education', 'bag', 12) returning id`, [s.grace]);
    await db.run(s.u.graceCoord, 'update public.resources set total_quantity = 15 where id = $1', [res.rows[0].id]);
    // Since Milestone 7, volunteers change only through the checked function.
    const vol = await db.run(s.u.graceCoord,
      `select public.save_volunteer(null, $1, 'Second Volunteer', null, '{}', null, false) as id`, [s.grace]);
    await db.run(s.u.graceCoord,
      `select public.save_volunteer($1, $2, 'Second Volunteer', null, '{}', null, false, 'inactive')`, [vol.rows[0].id, s.grace]);
    const { rows } = await db.run(s.u.graceCoord, 'select status from public.volunteers where id = $1', [vol.rows[0].id]);
    assert.equal(rows[0].status, 'inactive');
    await db.rejects(s.u.graceCoord, `update public.volunteers set status = 'active' where id = $1`, [vol.rows[0].id], DENIED);
  });
});
