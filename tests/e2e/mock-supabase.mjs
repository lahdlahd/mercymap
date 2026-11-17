// A small stand-in for Supabase's HTTP API, for local end-to-end tests only.
// Auth is faked (no emails, no real password hashing). Every database call,
// however, runs against a real PostgreSQL with the real migrations, as the
// `authenticated` role, so Row Level Security and the database functions are
// exercised exactly as written. It does NOT prove behaviour of real Supabase
// Auth or PostgREST; that still needs the live test script.
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { createTestDatabase } from '../db/harness.mjs';

const SECRET = 'local-e2e-secret';
// The app's server-only Supabase secret key in the e2e build.
export const E2E_SECRET_KEY = 'sb_secret_local_e2e';
export const E2E_TURNSTILE_SECRET = 'e2e-turnstile-secret';
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function signJwt(payload) {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}
function readJwt(token) {
  const [h, p, sig] = (token ?? '').split('.');
  if (!sig || createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== sig) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  return payload.exp * 1000 > Date.now() ? payload : null;
}

export async function startMockSupabase(port) {
  const pool = await createTestDatabase('mercymap_e2e');
  const passwords = new Map(); // email -> password (test only)
  const mailbox = [];          // "emails" the tests can read: { type, email, userId }
  const usedTokens = new Set(); // Turnstile tokens already verified (single use)
  const turnstileCalls = [];

  const userJson = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at,
    app_metadata: { provider: 'email' }, user_metadata: {}, identities: [{}], created_at: new Date().toISOString(),
  });
  const session = (u) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return {
      access_token: signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600 }),
      token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: randomUUID(), user: userJson(u),
    };
  };
  const findUser = async (where, value) =>
    (await pool.query(`select id, email, email_confirmed_at from auth.users where ${where} = $1`, [value])).rows[0];

  async function asUser(claims, fn) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const role = claims === 'service' ? 'service_role' : claims ? 'authenticated' : 'anon';
      await client.query(`set local role ${role}`);
      if (claims && claims !== 'service') await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims.sub]);
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString();
    const isForm = (req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');
    const body = isForm ? Object.fromEntries(new URLSearchParams(rawBody)) : rawBody ? JSON.parse(rawBody) : {};
    const userClaims = readJwt((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    // Like Supabase: a signed-in user's token wins; otherwise the secret key
    // means service_role and anything else means anon.
    const claims = userClaims ?? (req.headers.apikey === E2E_SECRET_KEY ? 'service' : null);
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    const authError = (status, code, msg) => send(status, { code: status, error_code: code, msg });
    const path = url.pathname;

    try {
      // ---------------- auth ----------------
      if (path === '/auth/v1/signup') {
        let u = await findUser('email', body.email);
        if (!u) {
          u = (await pool.query(
            'insert into auth.users (email, email_confirmed_at) values ($1, null) returning id, email, email_confirmed_at',
            [body.email])).rows[0];
          passwords.set(body.email, body.password);
          mailbox.push({ type: 'signup', email: u.email, userId: u.id });
        }
        return send(200, userJson({ ...u, id: u.id })); // no session until confirmed
      }
      if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const u = await findUser('email', body.email);
        if (!u || passwords.get(body.email) !== body.password) return authError(400, 'invalid_credentials', 'Invalid login credentials');
        if (!u.email_confirmed_at) return authError(400, 'email_not_confirmed', 'Email not confirmed');
        return send(200, session(u));
      }
      if (path === '/auth/v1/verify') {
        // In this mock the "token hash" in an email link is simply the user id.
        const u = await findUser('id::text', body.token_hash);
        if (!u) return authError(403, 'otp_expired', 'Email link is invalid or has expired');
        const confirmed = (await pool.query(
          'update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1 returning id, email, email_confirmed_at',
          [u.id])).rows[0];
        return send(200, session(confirmed));
      }
      if (path === '/auth/v1/user' && req.method === 'GET') {
        if (!claims) return authError(401, 'bad_jwt', 'invalid JWT');
        return send(200, userJson(await findUser('id::text', claims.sub)));
      }
      if (path === '/auth/v1/user' && req.method === 'PUT') {
        if (!claims) return authError(401, 'bad_jwt', 'invalid JWT');
        const u = await findUser('id::text', claims.sub);
        if (body.password) passwords.set(u.email, body.password);
        return send(200, userJson(u));
      }
      if (path === '/auth/v1/recover') {
        const u = await findUser('email', body.email);
        if (u) mailbox.push({ type: 'recovery', email: u.email, userId: u.id });
        return send(200, {});
      }
      if (path === '/auth/v1/resend') { mailbox.push({ type: 'resend', email: body.email }); return send(200, {}); }
      if (path === '/auth/v1/logout') return send(204);

      // ---------------- database (as the signed-in user, through RLS) ----------------
      const pgError = (e) => send(e.code === '42501' ? 403 : 400, { code: e.code, message: e.message, details: null, hint: null });

      if (path.startsWith('/rest/v1/rpc/')) {
        const fn = path.slice('/rest/v1/rpc/'.length);
        if (!/^[a-z_]+$/.test(fn)) return send(404, { message: 'no such function' });
        const keys = Object.keys(body).filter((k) => /^[a-z_]+$/.test(k));
        const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
        try {
          const { rows, fields } = await asUser(claims, (c) =>
            c.query(`select * from public.${fn}(${args})`, keys.map((k) => body[k])));
          const scalar = fields.length === 1 && fields[0].name === fn;
          return send(200, scalar ? rows[0]?.[fn] ?? null : rows);
        } catch (e) { return pgError(e); }
      }

      const eq = (k) => (url.searchParams.get(k) ?? '').replace(/^eq\./, '');
      if (path === '/rest/v1/church_memberships' && req.method === 'GET') {
        try {
          const { rows } = await asUser(claims, (c) => c.query(
            `select m.id, m.role, json_build_object('id', ch.id, 'name', ch.name, 'slug', ch.slug,
                    'status', ch.status, 'area', ch.area) as churches
               from public.church_memberships m join public.churches ch on ch.id = m.church_id
              where m.user_id = $1 and m.status = $2 order by m.created_at limit 1`,
            [eq('user_id'), eq('status')]));
          if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
            return rows.length === 1 ? send(200, rows[0])
              : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
          }
          return send(200, rows);
        } catch (e) { return pgError(e); }
      }
      if (path === '/turnstile/siteverify') {
        const token = body.response ?? '';
        const ok = body.secret === E2E_TURNSTILE_SECRET && token.startsWith('e2e-pass') && !usedTokens.has(token);
        if (ok) usedTokens.add(token);
        turnstileCalls.push({ token, remoteip: body.remoteip ?? null, ok });
        return send(200, ok ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] });
      }
      if (path === '/rest/v1/categories' && req.method === 'GET') {
        try {
          const { rows } = await asUser(claims, (c) => c.query(
            'select key, label from public.categories where is_active order by sort_order'));
          return send(200, rows);
        } catch (e) { return pgError(e); }
      }
      if (path === '/rest/v1/churches') {
        const PROFILE = ['name', 'area', 'contact_phone', 'contact_email', 'emergency_guidance'];
        try {
          if (req.method === 'GET') {
            const { rows } = await asUser(claims, (c) => c.query(
              `select ${PROFILE.join(', ')} from public.churches where id = $1`, [eq('id')]));
            if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
              return rows.length === 1 ? send(200, rows[0]) : send(406, { code: 'PGRST116', message: 'no rows' });
            }
            return send(200, rows);
          }
          if (req.method === 'PATCH') {
            const keys = Object.keys(body).filter((k) => PROFILE.includes(k));
            const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
            const { rows } = await asUser(claims, (c) => c.query(
              `update public.churches set ${sets} where id = $1 returning id`, [eq('id'), ...keys.map((k) => body[k])]));
            return send(200, rows);
          }
        } catch (e) { return pgError(e); }
      }
      if (path === '/rest/v1/invitations') {
        try {
          if (req.method === 'GET') {
            const { rows } = await asUser(claims, (c) => c.query(
              `select id, email, role, expires_at, accepted_at from public.invitations
                where church_id = $1 and accepted_at is null order by created_at desc`, [eq('church_id')]));
            return send(200, rows);
          }
          if (req.method === 'POST') {
            await asUser(claims, (c) => c.query(
              `insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
               values ($1, $2, $3, $4, $5, $6)`,
              [body.church_id, body.email, body.role, body.token_hash, body.invited_by, body.expires_at]));
            return send(201);
          }
          if (req.method === 'DELETE') {
            const { rows } = await asUser(claims, (c) => c.query(
              'delete from public.invitations where id = $1 and church_id = $2 returning id', [eq('id'), eq('church_id')]));
            return send(200, rows);
          }
        } catch (e) { return pgError(e); }
      }
      send(404, { message: `mock-supabase: unhandled ${req.method} ${path}` });
    } catch (e) {
      send(500, { message: String(e?.message ?? e) });
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));
  return { pool, mailbox, turnstileCalls, close: async () => { server.close(); await pool.end(); } };
}
