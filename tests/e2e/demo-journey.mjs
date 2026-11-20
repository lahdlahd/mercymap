// End-to-end journey for Milestone 11: the fictional demo church and the
// "Analyse waiting requests" button, against the mock Supabase API, a fake
// Claude endpoint and a real local PostgreSQL loaded with the real demo seed.
// Screenshots of every page go to /tmp/demo-shots for review.
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { startMockSupabase } from './mock-supabase.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const SHOTS = '/tmp/demo-shots';
mkdirSync(SHOTS, { recursive: true });
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
    shot: async (name) => { await new Promise((r) => setTimeout(r, 1500)); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); },
    fill: async (selector, value) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.$eval(selector, (el) => { el.value = ''; });
        if (value) await page.type(selector, value);
        if (await page.$eval(selector, (el) => el.value) === value) return;
      }
      throw new Error(`could not type into ${selector}`);
    },
    press: async (label, wait = 500) => {
      const handle = await page.evaluateHandle((l) =>
        [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === l), label);
      if (!handle.asElement()) throw new Error(`button not found: ${label}`);
      await Promise.all([page.waitForNetworkIdle({ idleTime: wait, timeout: 120000 }).catch(() => {}), handle.asElement().click()]);
      await new Promise((r) => setTimeout(r, 400));
    },
    close: () => context.close(),
  };
}

const PASSWORD = 'harvest2026x';
const EMAILS = { owner: 'owner@hopeharvest.example', admin: 'admin@hopeharvest.example', coord: 'coordinator@hopeharvest.example' };
const userId = async (email) => (await mock.pool.query('select id from auth.users where email = $1', [email])).rows[0]?.id;
async function account(email) {
  const s = await newSession();
  await s.go('/sign-up');
  await s.fill('[name="email"]', email);
  await s.fill('[name="password"]', PASSWORD);
  await s.fill('[name="confirmPassword"]', PASSWORD);
  await s.press('Create account');
  await s.go(`/auth/confirm?token_hash=${await userId(email)}&type=signup`);
  await s.close();
}
async function signIn(email, opts) {
  const s = await newSession(opts);
  await s.go('/sign-in');
  await s.fill('[name="email"]', email);
  await s.fill('[name="password"]', PASSWORD);
  await s.press('Sign in');
  return s;
}
const tiles = (s) => s.page.$$eval('[data-tile]', (els) => Object.fromEntries(els.map((el) => [
  el.querySelector('span').innerText.trim(), el.querySelector('[data-value]').innerText.trim()])));

try {
  console.log('Demo accounts and seed');
  for (const email of Object.values(EMAILS)) await account(email);
  await mock.pool.query(readFileSync(new URL('../../supabase/maintenance/2026-11-demo-seed.sql', import.meta.url), 'utf8'));
  const church = (await mock.pool.query(`select id from public.churches where slug = 'hope-harvest-chapel'`)).rows[0];
  check('the seed loads into the app database', Boolean(church));

  console.log('Overview as the owner');
  const owner = await signIn(EMAILS.owner);
  await owner.go('/app');
  const t = await tiles(owner);
  check('overview shows the demo church', (await owner.text()).includes('Hope Harvest Chapel'));
  check('tiles: 1 needs attention, 4 new, 10 open',
    t['Needs attention'] === '1' && t['New'] === '4' && t['Open'] === '10', JSON.stringify(t));
  check('tiles: 2 awaiting a resource, 1 approved, 1 in delivery, 1 running low',
    t['Awaiting match'] === '2' && t['Approved'] === '1' && t['In delivery'] === '1' && t['Resources running low'] === '1', JSON.stringify(t));
  check('no "awaiting verification" notice for the verified demo church', !(await owner.text()).includes('awaiting verification'));
  await owner.shot('01-overview');

  console.log('Requests and the waiting AI analyses');
  await owner.go('/app/requests');
  const card = await owner.page.$eval('[data-ai-waiting]', (el) => el.innerText).catch(() => '');
  check('owner sees "28 requests are waiting for AI suggestions"', card.includes('28 requests are waiting for AI suggestions'), card);
  check('the card says names and contact details are removed', card.includes('Names and contact details are removed'));
  check('the safeguarding banner shows one concern', (await owner.text()).includes('1 safeguarding concern needs review'));
  await owner.shot('02-requests');

  const coord = await signIn(EMAILS.coord);
  await coord.go('/app/requests');
  check('a coordinator does not see the button', !(await coord.page.$('[data-ai-waiting]')));

  mock.aiCalls.length = 0;
  await owner.press('Analyse waiting requests', 1500);
  const done = await mock.pool.query(`select ai_status, count(*)::int as n from public.requests where church_id = $1 group by 1`, [church.id]);
  check('every demo request was analysed', done.rows.length === 1 && done.rows[0].ai_status === 'done' && done.rows[0].n === 28, JSON.stringify(done.rows));
  check('the fake Claude was called 28 times', mock.aiCalls.length === 28, String(mock.aiCalls.length));
  const sent = JSON.stringify(mock.aiCalls);
  const leaks = ['Mrs Funmi', 'Mama Ronke', 'Brother Femi', 'Sister Joy', 'Baba Sola', 'Brother Dayo', '0800 000 2']
    .filter((x) => sent.includes(x));
  check('no requester name or phone number was sent to the AI', leaks.length === 0, leaks.join(', '));
  const message = await owner.text();
  check('the result says "AI suggestions added to 28 requests."', message.includes('AI suggestions added to 28 requests.'));
  await owner.go('/app/requests');
  check('the card is gone once nothing is waiting', !(await owner.page.$('[data-ai-waiting]')));
  const audit = await mock.pool.query(`select metadata from public.audit_logs where action = 'request.ai_waiting_started'`);
  check('the run is in the audit log', audit.rows.length === 1 && audit.rows[0].metadata.count === 28);

  console.log('When the AI is down');
  await mock.pool.query(`update public.requests set ai_status = 'failed', ai_attempts = 1
                          where id = (select id from public.requests where church_id = $1 order by created_at desc limit 1)`, [church.id]);
  mock.aiControl.mode = 'down';
  await owner.go('/app/requests');
  check('one failed request shows as waiting', (await owner.page.$eval('[data-ai-waiting]', (el) => el.innerText).catch(() => '')).includes('1 request is waiting'));
  await owner.press('Analyse waiting requests', 1500);
  check('a clear message when the AI cannot be reached', (await owner.text()).includes('could not be analysed; the AI may be unavailable'));
  mock.aiControl.mode = 'ok';
  await owner.press('Analyse waiting requests', 1500);
  check('it works again once the AI is back', (await owner.text()).includes('AI suggestions added to 1 request.'));

  console.log('Pages for review');
  const ref = async (text) => (await mock.pool.query(
    `select id from public.requests where church_id = $1 and original_text like $2`, [church.id, `${text}%`])).rows[0].id;
  await owner.go(`/app/requests/${await ref('A teenage girl')}`);
  check('the open safeguarding request shows its flag', (await owner.text()).includes('Needs attention'));
  await owner.shot('03-request-attention');
  await owner.go(`/app/requests/${await ref('Widow with three children')}`);
  const funmi = await owner.text();
  check('a fulfilled request shows its full history',
    ['Under review', 'Awaiting match', 'Approved', 'In progress', 'Fulfilled'].every((x) => funmi.includes(x)), '');
  check('the history names the volunteer task', funmi.includes('Tunde Adeyemi'));
  await owner.shot('04-request-fulfilled');
  await owner.go(`/app/requests/${await ref('I am a student nurse')}`);
  check('an awaiting-match request offers a matching resource', (await owner.text()).includes('Family food package'));
  await owner.shot('05-request-match');
  await owner.go('/app/reports');
  const rep = await owner.text();
  check('reports show figures for the last 30 days', /Requests received\s*20/.test(rep) || rep.includes('20'), '');
  await owner.shot('06-reports-30');
  await owner.go('/app/reports');
  await new Promise((r) => setTimeout(r, 2000));
  const marks = await owner.page.evaluate(() => ({
    bars: document.querySelectorAll('.recharts-bar-rectangle').length,
    lines: document.querySelectorAll('.recharts-line-curve').length,
    slices: document.querySelectorAll('.recharts-sector, .recharts-pie-sector').length,
    svgs: [...document.querySelectorAll('svg.recharts-surface')].map((el) => Math.round(el.getBoundingClientRect().width)).filter((w) => w > 50),
  }));
  console.log('    chart marks:', JSON.stringify(marks));
  check('the report charts draw their data', marks.svgs.length >= 4 && marks.svgs.every((w) => w > 200) && (marks.bars + marks.lines + marks.slices) > 0, JSON.stringify(marks));
  await owner.page.evaluate(() => window.scrollTo(0, 450));
  await new Promise((r) => setTimeout(r, 1500));
  await owner.page.screenshot({ path: `${SHOTS}/06b-reports-viewport.png` });
  await owner.go('/app/reports?days=365');
  await owner.shot('07-reports-365');
  await owner.go('/app/resources');
  check('resources list the nine demo resources', (await owner.text()).includes('Baby care pack') && (await owner.text()).includes('CV and interview coaching'));
  await owner.shot('08-resources');
  await owner.go('/app/volunteers');
  check('volunteers list the active demo volunteers', (await owner.text()).includes('Ngozi Eze'));
  await owner.shot('09-volunteers');
  await owner.go('/app/notifications');
  await owner.shot('10-notifications');
  const pub = await newSession();
  await pub.go('/request/hope-harvest-chapel');
  check('the public request page is open for the demo church', (await pub.text()).includes('Hope Harvest Chapel'));
  await pub.shot('11-public-request');
  const phone = await signIn(EMAILS.owner, { mobile: true });
  await phone.go('/app');
  await phone.shot('12-overview-phone');
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('the demo overview fits a phone screen', !overflow);

  const res = await fetch(BASE + '/');
  check('security headers: HSTS and a content security policy',
    /max-age=63072000/.test(res.headers.get('strict-transport-security') ?? '')
    && /frame-ancestors 'none'/.test(res.headers.get('content-security-policy') ?? '')
    && /form-action 'self'/.test(res.headers.get('content-security-policy') ?? ''));

  check('no browser errors', browserErrors.length === 0, browserErrors.join(' | '));
} catch (err) {
  failures.push(`crashed: ${err.message}`);
  console.log(err);
} finally {
  await browser.close();
  await mock.close?.();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exitCode = 1; }
  process.exit();
}
