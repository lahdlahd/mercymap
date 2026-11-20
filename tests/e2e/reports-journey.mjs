// End-to-end journey for Milestone 8 (dashboard, Reports & Impact, exports),
// against the mock Supabase API and a real local PostgreSQL.
import puppeteer from 'puppeteer-core';
import { startMockSupabase } from './mock-supabase.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const mock = await startMockSupabase(54400);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--no-proxy-server'],
});

let passed = 0;
const failures = [];
const browserErrors = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✔ ${name}`); }
  else { failures.push(name); console.log(`  ✖ ${name} ${detail}`); }
}

async function newSession({ mobile = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true } : { width: 1280, height: 900 });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => browserErrors.push(e.message));
  return {
    page,
    go: (path) => page.goto(BASE + path, { waitUntil: 'networkidle0' }),
    text: () => page.evaluate(() => document.body.innerText),
    path: () => new URL(page.url()).pathname,
    // Typing straight after a navigation can lose a key while the page
    // hydrates, so check the result and type again if needed.
    fill: async (selector, value) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.$eval(selector, (el) => { el.value = ''; });
        if (value) await page.type(selector, value);
        if (await page.$eval(selector, (el) => el.value) === value) return;
      }
      throw new Error(`could not type into ${selector}`);
    },
    press: async (label) => {
      const handle = await page.evaluateHandle((l) =>
        [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === l), label);
      if (!handle.asElement()) throw new Error(`button not found: ${label}`);
      await Promise.all([page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {}), handle.asElement().click()]);
      await new Promise((r) => setTimeout(r, 400));
    },
    choose: (name, value) => page.click(`input[name="${name}"][value="${value}"]`),
    tick: (name) => page.click(`input[name="${name}"]`),
    close: () => context.close(),
  };
}

const PASSWORD = 'harvest2026x';
const userId = async (email) => (await mock.pool.query('select id from auth.users where email = $1', [email])).rows[0]?.id;
async function staffAccount(s, email, church, slug) {
  await s.go('/sign-up');
  await s.fill('[name="email"]', email);
  await s.fill('[name="password"]', PASSWORD);
  await s.fill('[name="confirmPassword"]', PASSWORD);
  await s.press('Create account');
  await s.go(`/auth/confirm?token_hash=${await userId(email)}&type=signup`);
  await s.fill('[name="name"]', church);
  await s.fill('[name="slug"]', slug);
  await s.press('Register church');
}



async function staffMember(s, email, churchId, role) {
  await s.go('/sign-up');
  await s.fill('[name="email"]', email);
  await s.fill('[name="password"]', PASSWORD);
  await s.fill('[name="confirmPassword"]', PASSWORD);
  await s.press('Create account');
  await s.go(`/auth/confirm?token_hash=${await userId(email)}&type=signup`);
  await mock.pool.query('insert into public.church_memberships (church_id, user_id, role) values ($1, $2, $3)',
    [churchId, await userId(email), role]);
  await s.go('/app');
}
async function signIn(s, email) {
  await s.go('/sign-in');
  await s.fill('[name="email"]', email);
  await s.fill('[name="password"]', PASSWORD);
  await s.press('Sign in');
}


// Back-dated records with exact expected figures (same set as the database tests).
async function seed(church) {
  const c = await mock.pool.connect();
  try {
    await c.query('begin');
    await c.query("set local session_replication_role = 'replica'");
    const noon = `(((select private.today_local())::timestamp + interval '12 hours') at time zone 'Africa/Lagos')`;
    const ago = (days) => `(${noon} - interval '${days} days')`;
    const res = async (name, cat, unit, total) => (await c.query(
      `insert into public.resources (church_id, name, category_key, unit, total_quantity) values ($1,$2,$3,$4,$5) returning id`,
      [church, name, cat, unit, total])).rows[0].id;
    const food = await res('Food pack', 'food', 'pack', 15);
    const clothes = await res('Clothes', 'clothing', 'set', 100);
    const vol = (await c.query(`insert into public.volunteers (church_id, full_name) values ($1, 'Report Volunteer') returning id`, [church])).rows[0].id;
    const refs = {};
    const req = async (key, category, status, createdSql) => {
      const { rows } = await c.query(
        `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at, status, created_at,
                                      requester_name, contact_method, contact_value, area, quantity_needed, ai_status)
         values ($1, 'public', $2, $3, now(), $4, ${createdSql}, 'Zainab Secret', 'phone_call', '0803 999 0000', 'Ijapo', 2, 'skipped') returning id, reference`,
        [church, category, `A secret story for ${key}.`, status]);
      refs[key] = rows[0];
      await c.query(`insert into public.request_events (church_id, request_id, event_type, to_status, created_at) values ($1,$2,'submitted','submitted',${createdSql})`, [church, rows[0].id]);
      return rows[0].id;
    };
    const ev = (id, to, when) => c.query(`insert into public.request_events (church_id, request_id, event_type, to_status, created_at) values ($1,$2,'status_changed',$3,${when})`, [church, id, to]);
    const alloc = (id, r, q, st, appr, ful, ai = false) => c.query(
      `insert into public.allocations (church_id, request_id, resource_id, quantity, status, approved_at, fulfilled_at, ai_recommended)
       values ($1,$2,$3,$4,$5,${appr},${ful ?? 'null'},$6)`, [church, id, r, q, st, ai]);
    const A = await req('A', 'food', 'fulfilled', ago(2)); await ev(A, 'fulfilled', ago(1)); await alloc(A, food, 3, 'fulfilled', ago(2), ago(1), true);
    const B = await req('B', 'food', 'fulfilled', ago(20)); await ev(B, 'fulfilled', ago(10)); await alloc(B, food, 2, 'fulfilled', ago(15), ago(10));
    const C = await req('C', 'clothing', 'fulfilled', ago(60)); await ev(C, 'fulfilled', ago(50)); await alloc(C, clothes, 5, 'fulfilled', ago(55), ago(50));
    const D = await req('D', 'education', 'declined', ago(200)); await ev(D, 'declined', ago(190));
    await req('E', 'food', 'awaiting_match', ago(5));
    const F = await req('F', 'clothing', 'cancelled', ago(3)); await ev(F, 'cancelled', ago(3));
    const G = await req('G', 'food', 'fulfilled', ago(400)); await ev(G, 'fulfilled', ago(399));
    await req('H', 'food', 'submitted', 'private.period_start(7)');
    await req('I', 'food', 'submitted', "(private.period_start(7) - interval '1 minute')");
    const J = await req('J', 'food', 'approved', ago(1)); await alloc(J, food, 9, 'reserved', ago(1), null);
    await c.query(`update public.requests set attention_flag = true, attention_source = 'staff', attention_reason = 'x' where id = $1`, [refs.E.id]);
    await c.query(`insert into public.assignments (church_id, volunteer_id, request_id, task_brief, status, completed_at, created_at)
                   values ($1,$2,$3,'x','completed',${ago(4)},${ago(4)}), ($1,$2,$4,'x','completed',${ago(40)},${ago(41)})`, [church, vol, A, C]);
    await c.query('commit');
    return refs;
  } finally { c.release(); }
}
const figure = (s, label) => s.page.$eval(`[data-figure="${label}"] dd`, (el) => el.textContent.trim());
const tile = (s, label) => s.page.$eval(`[data-tile="${label}"] dd`, (el) => el.textContent.trim());
async function postExport(s, kind, days) {
  return s.page.evaluate(async (k, d) => {
    const body = new FormData(); body.set('kind', k); body.set('days', String(d));
    const r = await fetch('/app/reports/export', { method: 'POST', body });
    return { status: r.status, type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition'), text: await r.text() };
  }, kind, days);
}

try {
  console.log('\nSetup');
  const owner = await newSession();
  await staffAccount(owner, 'owner@grace.test', 'Grace Community Church', 'grace-community');
  const grace = (await mock.pool.query(`select id from public.churches where slug = 'grace-community'`)).rows[0].id;
  await mock.pool.query(`update public.churches set status = 'verified' where id = $1`, [grace]);
  const coord = await newSession();
  await staffMember(coord, 'coord@grace.test', grace, 'coordinator');
  const faith = await newSession();
  await staffAccount(faith, 'owner@faith.test', 'Living Faith Church', 'living-faith');
  const refs = await seed(grace);

  console.log('\nDashboard tiles');
  await owner.go('/app');
  const expected = { 'Needs attention': '1', New: '2', Open: '4', 'Awaiting a resource': '1', Approved: '1', 'In delivery': '0', 'Resources running low': '1' };
  for (const [label, value] of Object.entries(expected)) check(`tile "${label}" shows ${value}`, (await tile(owner, label)) === value, await tile(owner, label));
  const links = { 'Needs attention': '/app/requests?status=attention', New: '/app/requests?status=submitted', Open: '/app/requests',
    'Awaiting a resource': '/app/requests?status=awaiting_match', Approved: '/app/requests?status=approved', 'In delivery': '/app/requests?status=in_progress',
    'Helped this month': '/app/reports', 'Units given this month': '/app/reports', 'Resources running low': '/app/resources' };
  for (const [label, href] of Object.entries(links)) {
    await owner.go('/app');
    const value = await tile(owner, label);
    const opened = await owner.page.$eval(`[data-tile="${label}"]`, (el) => el.getAttribute('href'));
    await owner.go(opened);
    let ok = opened === href;
    if (href.startsWith('/app/requests')) {
      const count = (await owner.text()).match(/(\d+) requests?\b/)?.[1] ?? (/No (open )?requests/.test(await owner.text()) ? '0' : null);
      ok = ok && count === value;
      check(`"${label}" opens ${href} listing the same ${value}`, ok, `${opened} / ${count}`);
    } else {
      check(`"${label}" opens ${href}`, ok, opened);
    }
  }

  console.log('\nReports for each period');
  const periods = {
    7: { received: '5', fulfilled: '1', units: '3', median: '1', tasks: '1' },
    30: { received: '7', fulfilled: '2', units: '5', median: '5.5', tasks: '1' },
    90: { received: '8', fulfilled: '3', units: '10', median: '10', tasks: '2' },
    365: { received: '9', fulfilled: '3', units: '10', median: '10', tasks: '2' },
  };
  await owner.go('/app/reports');
  check('Reports is in the sidebar', await owner.page.$('nav a[href="/app/reports"]') !== null);
  check('30 days is the default', await owner.page.$eval('nav[aria-label="Period"] [aria-current="page"]', (el) => el.textContent) === 'Last 30 days');
  for (const [days, e] of Object.entries(periods)) {
    await owner.go(days === '30' ? '/app/reports' : `/app/reports?days=${days}`);
    const got = [await figure(owner, 'Requests received'), await figure(owner, 'Requests fulfilled'), await figure(owner, 'Units given out'),
      await figure(owner, 'Typical days to fulfil'), await figure(owner, 'Volunteer tasks completed')];
    check(`${days} days: received ${e.received}, fulfilled ${e.fulfilled}, units ${e.units}, median ${e.median}, tasks ${e.tasks}`,
      JSON.stringify(got) === JSON.stringify([e.received, e.fulfilled, e.units, e.median, e.tasks]), JSON.stringify(got));
  }
  await owner.go('/app/reports?days=7');
  let t = await owner.text();
  check('AI share is shown as people approving', /Staff chose the AI-suggested resource for 1 of 2 approvals \(50%\)\. The AI only suggests; people approve\./.test(t));
  const widths = await owner.page.$$eval('[data-chart-width]', (els) => els.map((el) => [Number(el.dataset.chartWidth), el.getBoundingClientRect().width]));
  check('each chart is drawn at the full width of its card', widths.length === 4 && widths.every(([drawn, box]) => drawn > 200 && Math.abs(drawn - box) <= 1), JSON.stringify(widths));
  check('four charts are drawn', (await owner.page.$$('[role="img"] svg, [role="img"]')).length >= 4 && (await owner.page.$$('.recharts-surface')).length >= 4);
  await owner.page.click('details summary');
  t = await owner.text();
  check('the table view lists the same figures', /Requests by kind of help[\s\S]*Food and groceries\s*4[\s\S]*Clothing\s*1/.test(t) && /Still open\s*3/.test(t));
  const rowsSum = await owner.page.$$eval('[data-table="over-time"] tbody tr', (trs) => trs.reduce((n, tr) => n + Number(tr.children[1].textContent), 0));
  check('the over-time table adds up to requests received', rowsSum === 5);
  await owner.go('/app/reports?days=12');
  check('an unknown period falls back to 30 days', await figure(owner, 'Requests received') === '7');

  console.log('\nExports');
  await owner.go('/app/reports');
  check('owners see three download buttons', (await owner.page.$$('form[action="/app/reports/export"]')).length === 3);
  const auditCount = async () => (await mock.pool.query(`select count(*)::int n from public.audit_logs where action = 'report.exported'`)).rows[0].n;
  const before = await auditCount();
  const csv = await postExport(owner, 'requests', 30);
  check('requests export downloads as CSV', csv.status === 200 && /text\/csv/.test(csv.type) && /attachment; filename="mercymap-requests-last-30-days-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.disposition));
  const lines = csv.text.replace(/^﻿/, '').trim().split(/\r\n/);
  check('header and one row per request in the period', lines[0] === 'Reference,Received,Kind of help,Status,Quantity,Area,Received through,Closed' && lines.length === 8, lines.length);
  check('no names, phone numbers or descriptions in the file', !/Zainab|Secret|0803|secret story/i.test(csv.text));
  check('the fulfilled request has a closing date', lines.some((l) => l.startsWith(refs.A.reference) && /,fulfilled,/.test(l) && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(l)));
  const stock = await postExport(owner, 'stock', 90);
  check('stock export lists the 3 hand-overs', stock.status === 200 && stock.text.trim().split(/\r\n/).length === 4);
  const tasks = await postExport(owner, 'tasks', 365);
  check('tasks export has no volunteer names', tasks.status === 200 && !tasks.text.includes('Report Volunteer') && tasks.text.trim().split(/\r\n/).length === 3);
  const logs = (await mock.pool.query(`select a.metadata, u.email from public.audit_logs a join auth.users u on u.id = a.actor_user_id where a.action = 'report.exported' order by a.id`)).rows;
  const m = logs.at(-3)?.metadata ?? {};
  check('every download is in the audit log with who, what and how many rows', (await auditCount()) === before + 3
    && logs.at(-3).email === 'owner@grace.test' && m.kind === 'requests' && m.days === 30 && m.rows === 7, JSON.stringify(logs.at(-3)));

  await coord.go('/app/reports');
  t = await coord.text();
  check('coordinators see the reports', /Requests received/.test(t) && await figure(coord, 'Requests received') === '7');
  check('but no download buttons', (await coord.page.$$('form[action="/app/reports/export"]')).length === 0 && /Only owners and administrators can download exports/.test(t));
  const denied = await postExport(coord, 'requests', 30);
  check('and the export itself refuses them, without an audit entry', denied.status === 403 && (await auditCount()) === before + 3);
  // Signed in as the owner, but posted from another site.
  const cookie = (await owner.page.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const foreign = await fetch(`${BASE}/app/reports/export`, { method: 'POST', redirect: 'manual',
    headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'kind=requests&days=30' });
  check('a form posted from another site is refused, even with a valid session', foreign.status === 403 && (await auditCount()) === before + 3, foreign.status);

  console.log('\nOther churches');
  await faith.go('/app/reports?days=365');
  check("another church's reports show none of Grace's records", await figure(faith, 'Requests received') === '0' && !/Food pack/.test(await faith.text()));
  await faith.go('/app');
  check("another church's tiles show none of Grace's records", await tile(faith, 'Open') === '0');
  const theirs = await postExport(faith, 'requests', 365);
  check("another church's export has no Grace rows", theirs.status === 200 && theirs.text.trim().split(/\r\n/).length === 1);

  console.log('\nPhone layout');
  const phone = await newSession({ mobile: true });
  await signIn(phone, 'owner@grace.test');
  for (const path of ['/app', '/app/reports', '/app/reports?days=365']) {
    await phone.go(path);
    check(`${path} fits on a phone`, !(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  }
  if (process.env.E2E_SCREENSHOTS) {
    await owner.go('/app');
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/overview.png`, fullPage: true });
    await owner.go('/app/reports?days=90');
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/reports.png`, fullPage: true });
    await phone.go('/app/reports');
    await phone.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/reports-mobile.png`, fullPage: true });
  }

  check('no JavaScript errors in the browser', browserErrors.length === 0, browserErrors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`journey stopped: ${error.message}`);
  console.error(error);
} finally {
  await browser.close();
  await mock.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
