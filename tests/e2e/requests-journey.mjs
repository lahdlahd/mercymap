// End-to-end journey for Milestone 4 (request management), against the mock
// Supabase API and a real local PostgreSQL.
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
    fill: async (selector, value) => {
      await page.$eval(selector, (el) => { el.value = ''; });
      if (value) await page.type(selector, value);
    },
    press: async (label) => {
      const handle = await page.evaluateHandle((l) =>
        [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === l), label);
      if (!handle.asElement()) throw new Error(`button not found: ${label}`);
      await Promise.all([page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {}), handle.asElement().click()]);
      await new Promise((r) => setTimeout(r, 400));
    },
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
async function makeRequest(churchId, { status = 'submitted', category = 'food', text = 'We need help with food this week.', when, channel = 'public', phone } = {}) {
  const { rows } = await mock.pool.query(
    `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at, status, created_at,
                                  contact_method, contact_value, requester_name, quantity_needed)
     values ($1, $2, $3, $4, now(), $5, coalesce($6, now()), $7, $8, 'Sample Person', 2) returning id, reference`,
    [churchId, channel, category, text, status, when ?? null, phone ? 'phone_call' : 'none', phone ?? null]);
  await mock.pool.query(
    `insert into public.request_events (church_id, request_id, event_type, to_status) values ($1, $2, 'submitted', 'submitted')`,
    [churchId, rows[0].id]);
  return rows[0];
}
const statusOf = async (id) => (await mock.pool.query('select status, outcome_reason from public.requests where id = $1', [id])).rows[0];
const choose = (s, value) => s.page.click(`input[name="toStatus"][value="${value}"]`);

try {
  console.log('\nSetup');
  const owner = await newSession();
  await staffAccount(owner, 'owner@grace.test', 'Grace Community Church', 'grace-community');
  const faith = await newSession();
  await staffAccount(faith, 'owner@faith.test', 'Living Faith Church', 'living-faith');
  const grace = (await mock.pool.query(`select id from public.churches where slug = 'grace-community'`)).rows[0].id;
  const living = (await mock.pool.query(`select id from public.churches where slug = 'living-faith'`)).rows[0].id;
  await mock.pool.query(`update public.churches set status = 'verified' where id = $1`, [grace]);

  await owner.go('/app/requests');
  check('empty state when there are no requests', /No open requests/.test(await owner.text()));

  const a = await makeRequest(grace, { when: '2026-11-17T09:00:00Z', phone: '0803 123 4567', text: 'Out of food since Monday.\nThree children at home.' });
  const b = await makeRequest(grace, { category: 'clothing', when: '2026-11-16T09:00:00Z', channel: 'staff' });
  const c = await makeRequest(grace, { status: 'declined', when: '2026-11-15T09:00:00Z' });
  const other = await makeRequest(living, { text: 'Living Faith private request text.' });

  console.log('\nRequests list');
  await owner.go('/app');
  let t = await owner.text();
  check('overview shows request counts', /Requests/.test(t) && /New\n2/.test(t) && /Open\n2/.test(t));
  await owner.go('/app/requests');
  t = await owner.text();
  check('open requests listed, newest first', t.indexOf(a.reference) > -1 && t.indexOf(a.reference) < t.indexOf(b.reference));
  check('closed requests are not in "Open"', !t.includes(c.reference));
  check('another church\'s requests never appear', !t.includes(other.reference));
  check('tabs show counts', /Open\n2/.test(t) && /Closed\n1/.test(t) && /All\n3/.test(t));
  check('rows show status, kind of help and channel', /New/.test(t) && /Food and groceries/.test(t) && /Recorded by staff/.test(t));
  check('the list shows no personal details', !/Out of food since Monday/.test(t) && !/0803 123 4567/.test(t) && !/Sample Person/.test(t));

  await owner.go('/app/requests?status=closed');
  check('Closed tab shows the declined request', (await owner.text()).includes(c.reference));
  await owner.go(`/app/requests?status=all&category=clothing`);
  t = await owner.text();
  check('kind-of-help filter', t.includes(b.reference) && !t.includes(a.reference));
  await owner.go(`/app/requests?status=all&channel=staff`);
  t = await owner.text();
  check('channel filter', t.includes(b.reference) && !t.includes(a.reference));
  await owner.go('/app/requests?status=all');
  await owner.fill('#filter-q', a.reference.slice(3, 9).toLowerCase());
  await Promise.all([owner.page.waitForNavigation({ waitUntil: 'networkidle0' }), owner.press('Filter')]);
  t = await owner.text();
  check('search by part of a reference, in any case', t.includes(a.reference) && !t.includes(b.reference) && /1 request/.test(t));
  await owner.go(`/app/requests?status=all&q=${other.reference}`);
  check('searching for another church\'s reference finds nothing', /No requests match/.test(await owner.text()));
  await owner.go('/app/requests?status=bogus&page=-4&category=%27;drop');
  check('nonsense filters fall back safely', (await owner.text()).includes(a.reference));

  console.log('\nRequest detail');
  await owner.go('/app/requests');
  await Promise.all([owner.page.waitForNavigation({ waitUntil: 'networkidle0' }), owner.page.click(`a[href="/app/requests/${a.id}"]`)]);
  t = await owner.text();
  check('detail opens from the list', owner.path() === `/app/requests/${a.id}` && t.includes(a.reference));
  check('shows the full text with line breaks', /Out of food since Monday\.\nThree children at home\./.test(t));
  check('shows contact details to staff', /0803 123 4567/.test(t) && /Sample Person/.test(t) && /Phone call/.test(t));
  check('history starts with "Request received"', /History[\s\S]*Request received/.test(t));
  const views = await mock.pool.query(`select actor_user_id from public.audit_logs where action = 'request.viewed' and entity_id = $1`, [a.id]);
  check('opening the request is written to the audit log', views.rowCount >= 1 && views.rows[0].actor_user_id === (await userId('owner@grace.test')));
  const offered = await owner.page.$$eval('input[name="toStatus"]', (els) => els.map((e) => e.value));
  check('a new request offers Start review, Decline or Cancel', JSON.stringify(offered) === '["under_review","declined","cancelled"]', JSON.stringify(offered));

  await owner.press('Update status');
  check('choosing nothing is caught', /Choose what happens next/.test(await owner.text()));
  await choose(owner, 'declined');
  await owner.press('Update status');
  t = await owner.text();
  check('declining without a reason is refused', /short note/.test(t) && (await statusOf(a.id)).status === 'submitted');

  await choose(owner, 'under_review');
  await owner.press('Update status');
  t = await owner.text();
  check('start review', (await statusOf(a.id)).status === 'under_review' && /Status changed to Under review/.test(t));
  check('history shows the change and who made it', /New → Under review[\s\S]*owner@grace\.test/.test(t));
  const offered2 = await owner.page.$$eval('input[name="toStatus"]', (els) => els.map((e) => e.value));
  check('under review offers the next set of steps', offered2.includes('awaiting_clarification') && offered2.includes('awaiting_match') && !offered2.includes('approved'));

  await choose(owner, 'awaiting_clarification');
  await owner.page.type('form textarea[name="note"]', 'Ask how many adults are in the house.');
  await owner.press('Update status');
  t = await owner.text();
  check('ask for clarification, with the question recorded', (await statusOf(a.id)).status === 'awaiting_clarification' && /Ask how many adults/.test(t));

  const noteBoxes = await owner.page.$$('textarea[name="note"]');
  await noteBoxes[noteBoxes.length - 1].type('Called them; two adults and three children.');
  await owner.press('Add note');
  t = await owner.text();
  check('add a note to the history', /Note added[\s\S]*Called them; two adults and three children\./.test(t));
  const cleared = await owner.page.$$eval('textarea[name="note"]', (els) => els[els.length - 1].value);
  check('the note box clears after saving', cleared === '', JSON.stringify(cleared));

  await choose(owner, 'under_review');
  await owner.press('Update status');
  await choose(owner, 'awaiting_match');
  await owner.press('Update status');
  t = await owner.text();
  check('ready for a resource', (await statusOf(a.id)).status === 'awaiting_match');
  check('explains that no resource can meet it yet', /No resource can meet this request right now/.test(t));
  const offered3 = await owner.page.$$eval('input[name="toStatus"]', (els) => els.map((e) => e.value));
  check('no way to approve by hand', !offered3.includes('approved') && !offered3.includes('fulfilled'));

  console.log('\nTwo people at once');
  const second = await newSession();
  await second.go('/sign-in');
  await second.fill('[name="email"]', 'owner@grace.test');
  await second.fill('[name="password"]', PASSWORD);
  await second.press('Sign in');
  await second.go(`/app/requests/${b.id}`);
  await owner.go(`/app/requests/${b.id}`);
  await choose(owner, 'under_review');
  await owner.press('Update status');
  await choose(second, 'cancelled');
  await second.page.type('form textarea[name="note"]', 'Duplicate of another request.');
  await second.press('Update status');
  t = await second.text();
  check('a stale page cannot overwrite a newer change', /Someone else changed this request/.test(t) && (await statusOf(b.id)).status === 'under_review');
  check('the stale page refreshes to the current status', /Under review/.test(t));
  check('the note label no longer describes the old choice', !/Why is it being cancelled\?/.test(t) && /Note \(optional\)/.test(t));

  await choose(owner, 'unable_to_fulfil');
  await owner.page.type('form textarea[name="note"]', 'No clothing in the right sizes this month.');
  await owner.press('Update status');
  t = await owner.text();
  check('close as unable to fulfil, with the reason shown', (await statusOf(b.id)).status === 'unable_to_fulfil' && /No clothing in the right sizes/.test(t));
  check('a closed request offers no further status changes', /This request is closed/.test(t) && !(await owner.page.$('input[name="toStatus"]')));

  console.log('\nSafeguarding');
  await owner.go(`/app/requests/${a.id}`);
  await owner.press('Raise a safeguarding concern');
  await owner.press('Raise concern');
  check('a concern needs a description', /what the concern is/.test(await owner.text()));
  await owner.page.type('textarea[name="reason"]', 'Mentions children left alone overnight.');
  await owner.press('Raise concern');
  t = await owner.text();
  check('concern raised and shown prominently', /Safeguarding concern: needs a person to review it/.test(t) && /left alone overnight/.test(t));
  check('the page says the flag is not an assessment', /not an assessment/.test(t));
  await owner.go('/app/requests');
  t = await owner.text();
  check('the list warns about concerns needing review', /1 safeguarding concern needs review/.test(t) && /Needs attention/.test(t));
  await owner.go('/app/requests?status=attention');
  check('"Needs attention" tab lists it', (await owner.text()).includes(a.reference));
  await owner.go('/app');
  check('overview shows 1 needing attention', /Needs attention\n1\b/.test(await owner.text()));

  await owner.go(`/app/requests/${a.id}`);
  await owner.press('Mark as reviewed');
  check('reviewing needs a note', /what was done or decided/.test(await owner.text()));
  await owner.page.type('section textarea[name="note"]', 'Pastor visited; an aunt is now staying with them.');
  await owner.press('Mark as reviewed');
  t = await owner.text();
  check('concern recorded as reviewed, with who and what', /Safeguarding concern reviewed/.test(t) && /owner@grace\.test/.test(t) && /an aunt is now staying/.test(t));
  check('history shows both steps', /Safeguarding concern raised[\s\S]*Safeguarding concern reviewed/.test(t));
  await owner.go('/app/requests?status=attention');
  check('nothing left needing attention', /No requests match/.test(await owner.text()));

  console.log('\nOther churches and coordinators');
  await faith.go(`/app/requests/${a.id}`);
  t = await faith.text();
  check('another church gets "Request not found"', /Request not found/.test(t) && !t.includes('Out of food'));
  await faith.go('/app/requests/not-a-uuid');
  check('a malformed id is also "not found"', /Request not found|Page not found/.test(await faith.text()));
  await faith.go('/app/requests');
  t = await faith.text();
  check('another church sees only its own requests', t.includes(other.reference) && !t.includes(a.reference));
  const faithViews = await mock.pool.query(
    `select count(*)::int as n from public.audit_logs where action = 'request.viewed' and entity_id = $1 and actor_user_id = $2`,
    [a.id, await userId('owner@faith.test')]);
  check('a refused view is not logged as a view', faithViews.rows[0].n === 0);

  await owner.go('/app/settings/staff');
  await owner.fill('[name="email"]', 'coord@grace.test');
  await owner.press('Create invitation');
  const invitePath = new URL((await owner.text()).match(/http:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/)[0]).pathname;
  const coord = await newSession({ mobile: true });
  await coord.go('/sign-up');
  await coord.fill('[name="email"]', 'coord@grace.test');
  await coord.fill('[name="password"]', PASSWORD);
  await coord.fill('[name="confirmPassword"]', PASSWORD);
  await coord.press('Create account');
  await coord.go(`/auth/confirm?token_hash=${await userId('coord@grace.test')}&type=signup`);
  await coord.go(invitePath);
  await coord.press('Accept invitation');
  const d = await makeRequest(grace, { text: 'Coordinator test request.' });
  await coord.go(`/app/requests/${d.id}`);
  await choose(coord, 'under_review');
  await coord.press('Update status');
  check('a coordinator can work on requests', (await statusOf(d.id)).status === 'under_review');
  const overflow = await coord.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('request page has no sideways scroll on a phone', !overflow);
  if (process.env.E2E_SCREENSHOTS) {
    await coord.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/request-detail-mobile.png`, fullPage: true });
    await owner.go(`/app/requests/${a.id}`);
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/request-detail-desktop.png`, fullPage: true });
    await owner.go('/app/requests?status=all');
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/requests-list-desktop.png`, fullPage: true });
  }

  console.log('\nStaff intake links to the new request');
  await owner.go('/app/requests/new');
  await owner.page.click('input[name="category"][value="transport"]');
  await owner.page.type('form textarea[name="description"]', 'Needs a ride to the hospital on Friday.');
  await owner.page.click('input[name="consent"]');
  await owner.press('Record request');
  const openLink = await owner.page.evaluate(() =>
    [...document.querySelectorAll('a')].find((el) => el.innerText.trim() === 'Open this request')?.getAttribute('href') ?? null);
  check('"Open this request" goes to the new request', Boolean(openLink) && /^\/app\/requests\/[0-9a-f-]{36}$/.test(openLink), openLink);

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
