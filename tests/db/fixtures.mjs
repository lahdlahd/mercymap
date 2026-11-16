// Two fictional churches with one row in every tenant-owned table.
// All names and details are synthetic.
export async function seedTwoChurches(pool, { run }) {
  const user = async (email) =>
    (await pool.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;

  const u = {
    graceOwner: await user('owner@grace.test'),
    graceAdmin: await user('admin@grace.test'),
    graceCoord: await user('coordinator@grace.test'),
    faithOwner: await user('owner@faith.test'),
    faithCoord: await user('coordinator@faith.test'),
    outsider: await user('nobody@example.test'),
    platformAdmin: await user('platform@mercymap.test'),
  };
  await pool.query('insert into public.platform_admins (user_id) values ($1)', [u.platformAdmin]);

  const church = async (owner, name, slug) =>
    (await run(owner, 'select public.create_church($1, $2, $3) as id', [name, slug, 'Akure'])).rows[0].id;
  const grace = await church(u.graceOwner, 'Grace Community Church', 'grace-community');
  const faith = await church(u.faithOwner, 'Living Faith Church', 'living-faith');

  const member = async (churchId, userId, role) =>
    (await pool.query(
      `insert into public.church_memberships (church_id, user_id, role) values ($1, $2, $3) returning id`,
      [churchId, userId, role])).rows[0].id;
  const m = {
    graceAdmin: await member(grace, u.graceAdmin, 'admin'),
    graceCoord: await member(grace, u.graceCoord, 'coordinator'),
    faithCoord: await member(faith, u.faithCoord, 'coordinator'),
  };
  const ownerMembership = async (churchId, userId) =>
    (await pool.query('select id from public.church_memberships where church_id = $1 and user_id = $2',
      [churchId, userId])).rows[0].id;
  m.graceOwner = await ownerMembership(grace, u.graceOwner);
  m.faithOwner = await ownerMembership(faith, u.faithOwner);

  // One row per tenant table, per church, inserted by the trusted server role.
  const rows = {};
  for (const [key, churchId, owner] of [['grace', grace, u.graceOwner], ['faith', faith, u.faithOwner]]) {
    const one = async (sql, params) => (await run('service', sql, params)).rows[0].id;
    const r = {};
    r.invitations = await one(
      `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
       values ($1, $2, 'coordinator', $3, $4, now() + interval '7 days') returning id`,
      [churchId, `invitee@${key}.test`, `${key}-`.padEnd(64, 'a'), owner]);
    r.requests = await one(
      `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at)
       values ($1, 'public', 'food', 'We need food support for the week.', now()) returning id`,
      [churchId]);
    r.ai_analyses = await one(
      `insert into public.ai_analyses (church_id, request_id, status, output, provider, model, prompt_version)
       values ($1, $2, 'done', '{"category":"food"}', 'test', 'test-model', 'v1') returning id`,
      [churchId, r.requests]);
    r.request_events = await one(
      `insert into public.request_events (church_id, request_id, event_type, to_status)
       values ($1, $2, 'submitted', 'submitted') returning id`,
      [churchId, r.requests]);
    r.resources = await one(
      `insert into public.resources (church_id, name, category_key, unit, total_quantity)
       values ($1, 'Food packages', 'food', 'package', 10) returning id`,
      [churchId]);
    r.allocations = await one(
      `insert into public.allocations (church_id, request_id, resource_id, quantity, approved_by)
       values ($1, $2, $3, 1, $4) returning id`,
      [churchId, r.requests, r.resources, owner]);
    r.volunteers = await one(
      `insert into public.volunteers (church_id, full_name) values ($1, 'Sample Volunteer') returning id`,
      [churchId]);
    r.assignments = await one(
      `insert into public.assignments (church_id, volunteer_id, request_id, task_brief, assigned_by)
       values ($1, $2, $3, 'Deliver one food package.', $4) returning id`,
      [churchId, r.volunteers, r.requests, owner]);
    r.notifications = await one(
      `insert into public.notifications (church_id, recipient_user_id, type, request_id, title)
       values ($1, $2, 'request_new', $3, 'New assistance request') returning id`,
      [churchId, owner, r.requests]);
    rows[key] = r;
  }

  return { u, m, grace, faith, rows };
}
