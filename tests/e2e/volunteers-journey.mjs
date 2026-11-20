// End-to-end journey for Milestone 7 (notifications, volunteers and volunteer
// tasks), against the mock Supabase API and a real local PostgreSQL.
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
async function makeRequest(churchId, { status = 'awaiting_match', category = 'food', text = 'We need help with food this week.', when, channel = 'public', phone, area = null, quantity = 2 } = {}) {
  const { rows } = await mock.pool.query(
    // Inserted directly, so never analysed: marked 'skipped' so the AI panel
    // does not wait (and refresh the page) for an analysis that will not come.
    `insert into public.requests (church_id, channel, category_key, original_text, consent_given_at, status, created_at,
                                  contact_method, contact_value, requester_name, quantity_needed, area, ai_status)
     values ($1, $2, $3, $4, now(), $5, coalesce($6, now()), $7, $8, 'Sample Person', $9, $10, 'skipped') returning id, reference`,
    [churchId, channel, category, text, status, when ?? null, phone ? 'phone_call' : 'none', phone ?? null, quantity, area]);
  await mock.pool.query(
    `insert into public.request_events (church_id, request_id, event_type, to_status) values ($1, $2, 'submitted', 'submitted')`,
    [churchId, rows[0].id]);
  return rows[0];
}
const statusOf = async (id) => (await mock.pool.query('select status, outcome_reason from public.requests where id = $1', [id])).rows[0];
const choose = (s, value) => s.page.click(`input[name="toStatus"][value="${value}"]`);



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
const unreadBadge = (s) => s.page.$eval('[data-bell]', (el) => el.querySelector('[data-unread-count]')?.textContent ?? '0');
const notesFor = async (email, type) => (await mock.pool.query(
  `select n.* from public.notifications n join auth.users u on u.id = n.recipient_user_id where u.email = $1 and n.type = $2 order by n.created_at`,
  [email, type])).rows;
const buttonExists = (s, label) => s.page.evaluate((l) => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === l), label);
async function pressIn(s, selector, label) {
  const handle = await s.page.evaluateHandle((sel, l) =>
    [...(document.querySelector(sel)?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === l), selector, label);
  const el = handle.asElement();
  if (!el) throw new Error(`no "${label}" button in ${selector}`);
  await el.click();
  await s.page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
}
async function signIn(s, email) {
  await s.go('/sign-in');
  await s.fill('[name="email"]', email);
  await s.fill('[name="password"]', PASSWORD);
  await s.press('Sign in');
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
  check('a coordinator works inside Grace', /Grace Community Church/.test(await coord.text()));

  console.log('\nNotifications');
  await coord.go('/app/requests/new');
  await coord.choose('category', 'food');
  await coord.fill('form [name="description"]', 'Ada Example needs rice and beans for her family this week.');
  await coord.fill('form [name="quantity"]', '1');
  await coord.fill('form [name="name"]', 'Ada Example');
  await coord.tick('consent');
  await coord.press('Record request');
  const refA = (await coord.text()).match(/MM-[0-9A-F]{6}-[0-9A-F]{6}/)?.[0];
  check('the coordinator recorded a request', Boolean(refA));
  check('the person who recorded it is not notified', (await notesFor('coord@grace.test', 'new_request')).length === 0);
  await owner.go('/app');
  check('the owner sees an unread count on the bell', Number(await unreadBadge(owner)) >= 1);
  await owner.page.click('[data-bell]');
  await owner.page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
  let t = await owner.text();
  check('the notification names the reference and the kind of help', t.includes(`New request ${refA}`) && /Food and groceries · recorded by staff/.test(t));
  check('no name or description is in the notification', !/Ada|rice/.test(t));
  const before = Number(await unreadBadge(owner));
  await pressIn(owner, '[data-notification="new_request"]', 'Open request');
  check('opening it goes to the request', /\/app\/requests\/[0-9a-f-]{36}$/.test(owner.page.url()) && (await owner.text()).includes(refA));
  check('and marks it read', Number(await unreadBadge(owner)) === before - 1);

  await owner.go('/app/requests/new');
  await owner.choose('category', 'food');
  await owner.fill('form [name="description"]', 'My husband beats me and the children have not eaten.');
  await owner.fill('form [name="quantity"]', '1');
  await owner.tick('consent');
  await owner.press('Record request');
  const att = await notesFor('coord@grace.test', 'needs_attention');
  check('a keyword safeguarding flag notifies other staff, without the reason', att.length === 1
    && att[0].body === 'Raised by the keyword check. A person should review it.' && !/beats/.test(att[0].title + att[0].body));
  await coord.go('/app/notifications');
  t = await coord.text();
  check('the coordinator sees it marked as needs attention', /Needs attention/.test(t) && /Raised by the keyword check/.test(t));
  await coord.press('Mark all as read');
  check('mark all as read clears the bell', (await unreadBadge(coord)) === '0' && /You are all caught up/.test(await coord.text()));

  console.log('\nVolunteers');
  await owner.go('/app/volunteers');
  check('Volunteers is in the sidebar', await owner.page.$('nav a[href="/app/volunteers"]') !== null);
  check('empty state explains volunteers need no account', /There are no volunteers yet/.test(await owner.text()));
  await owner.go('/app/volunteers/new');
  await owner.press('Add volunteer');
  check('a name is required', /Enter the volunteer's name/.test(await owner.text()));
  await owner.fill('form [name="fullName"]', 'Bola Driver');
  await owner.fill('form [name="phone"]', '0803 000 0001');
  await owner.press('Add volunteer');
  t = await owner.text();
  check('a phone number needs their consent', /Tick this to keep their phone number/.test(t)
    && (await mock.pool.query('select count(*)::int n from public.volunteers')).rows[0].n === 0);
  await owner.tick('consent');
  await owner.fill('form [name="skills"]', 'Driving, has a car, driving');
  await owner.press('Add volunteer');
  t = await owner.text();
  const bola = (await mock.pool.query(`select * from public.volunteers where full_name = 'Bola Driver'`)).rows[0];
  check('volunteer added with consent recorded', /Volunteer added/.test(t) && Boolean(bola?.consent_given_at));
  check('skills are tidied', JSON.stringify(bola?.skills) === '["driving","has a car"]');
  for (const name of ['Chi Helper', 'Dayo Away']) {
    await owner.go('/app/volunteers/new');
    await owner.fill('form [name="fullName"]', name);
    await owner.press('Add volunteer');
  }
  const dayo = (await mock.pool.query(`select id from public.volunteers where full_name = 'Dayo Away'`)).rows[0].id;
  await owner.go(`/app/volunteers/${dayo}`);
  await owner.press('Mark as not available');
  await owner.go('/app/volunteers');
  t = await owner.text();
  check('the list shows available volunteers with their skills', /Bola Driver/.test(t) && /driving, has a car/.test(t) && /Chi Helper/.test(t));
  check('volunteers who are not available are hidden by default', !t.includes('Dayo Away'));
  await owner.go('/app/volunteers?show=all');
  check('and shown on request', /Dayo Away[\s\S]{0,40}Not available/.test(await owner.text()));
  check('changes are audited', (await mock.pool.query(`select count(*)::int n from public.audit_logs where action like 'volunteer.%'`)).rows[0].n === 4);

  console.log('\nApproval, low stock and tasks');
  const coordId = await userId('coord@grace.test');
  const rice = (await mock.pool.query(`insert into public.resources (church_id, name, category_key, unit, total_quantity, manager_user_id)
    values ($1, 'Rice bags', 'food', 'bag', 10, $2) returning id`, [grace, coordId])).rows[0].id;
  const b = await makeRequest(grace, { quantity: 8, area: 'Ijapo', phone: '0803 555 0102' });
  await owner.go(`/app/requests/${b.id}`);
  check('no task panel before approval', (await owner.page.$('[data-tasks-panel]')) === null);
  await owner.page.click(`input[name="resourceId"][value="${rice}"]`);
  await owner.press('Approve and reserve');
  const lowCoord = await notesFor('coord@grace.test', 'low_stock');
  const lowOwner = await notesFor('owner@grace.test', 'low_stock');
  check('low stock tells the responsible person and the owner once', lowCoord.length === 1 && lowOwner.length === 1
    && lowCoord[0].title === 'Stock running low: Rice bags' && lowCoord[0].body === '2 bag available of 10.');

  t = await owner.text();
  check('approved request shows the task panel', /Volunteer tasks/.test(t) && /Give this to a volunteer/.test(t));
  const options = await owner.page.$$eval('select[name="volunteerId"] option', (els) => els.map((e) => e.textContent));
  check('only available volunteers are offered', options.includes('Bola Driver') && options.includes('Chi Helper') && !options.includes('Dayo Away'));
  let brief = await owner.page.$eval('#task-brief', (el) => el.value);
  check('the brief has the reference, the help and the area', brief.includes(b.reference) && /Help: 8 bag \(Rice bags\)/.test(brief) && /Area: Ijapo/.test(brief));
  check('the brief leaves out the name, story and phone', !/Sample Person|We need help|0803 555 0102/.test(brief));
  await owner.page.click('input[name="includePhone"]');
  brief = await owner.page.$eval('#task-brief', (el) => el.value);
  check('ticking adds the phone number', brief.endsWith('Contact: 0803 555 0102'));
  await owner.page.click('input[name="includePhone"]');
  brief = await owner.page.$eval('#task-brief', (el) => el.value);
  check('unticking removes it again', !brief.includes('0803 555 0102'));
  await owner.press('Give task');
  check('choosing a volunteer is required', /Choose a volunteer/.test(await owner.text()));
  await owner.page.select('select[name="volunteerId"]', bola.id);
  await owner.press('Give task');
  t = await owner.text();
  const task = (await mock.pool.query('select * from public.assignments where request_id = $1', [b.id])).rows[0];
  check('task given', task?.status === 'assigned' && /Task given/.test(t));
  check('the stored brief has no phone', !task.task_brief.includes('0803 555 0102'));
  check('history records who gave it to whom', /Volunteer given the task[\s\S]{0,80}owner@grace\.test[\s\S]{0,80}Task given to Bola Driver\./.test(t));
  const wa = await owner.page.$eval('[data-task="Bola Driver"] a[href^="https://wa.me/"]', (el) => el.href);
  check('WhatsApp link goes to the volunteer with the brief', wa.startsWith('https://wa.me/2348030000001?text=') && decodeURIComponent(wa).includes(b.reference));
  check('a copy button is offered', await buttonExists(owner, 'Copy brief'));
  await owner.page.select('select[name="volunteerId"]', bola.id);
  await owner.press('Give task');
  check('the same volunteer cannot get a second open task', /already has an open task/.test(await owner.text()));

  console.log('\nCompleting and closing');
  await coord.go(`/app/requests/${b.id}`);
  await pressIn(coord, '[data-task="Bola Driver"]', 'Mark as started');
  await pressIn(coord, '[data-task="Bola Driver"]', 'Mark as completed');
  t = await coord.text();
  check('the task is completed', (await mock.pool.query('select status from public.assignments where id = $1', [task.id])).rows[0].status === 'completed');
  check('completing does not fulfil the request', (await statusOf(b.id)).status === 'approved');
  const done = await notesFor('owner@grace.test', 'task_completed');
  check('the person who gave the task is told', done.length === 1 && done[0].title === `Volunteer task completed: ${b.reference}`);
  check('history shows the steps', /Bola Driver's task: started\./.test(t) && /Bola Driver's task: completed\./.test(t));

  await owner.go(`/app/requests/${b.id}`);
  const chi = (await mock.pool.query(`select id from public.volunteers where full_name = 'Chi Helper'`)).rows[0].id;
  await owner.page.select('select[name="volunteerId"]', chi);
  await owner.press('Give task');
  await choose(owner, 'declined');
  const box = await owner.page.evaluateHandle(() => document.querySelector('input[name="toStatus"]')?.closest('form')?.querySelector('textarea[name="note"]'));
  await box.asElement().type('They found help elsewhere.');
  await owner.press('Update status');
  t = await owner.text();
  const chiTask = (await mock.pool.query('select status from public.assignments where request_id = $1 and volunteer_id = $2', [b.id, chi])).rows[0];
  check('declining cancels the open task', chiTask.status === 'cancelled' && /1 open volunteer task cancelled because the request was closed\./.test(t));
  check('the completed task is left as it was', (await mock.pool.query('select status from public.assignments where id = $1', [task.id])).rows[0].status === 'completed');
  check('no task actions remain on a closed request', !(await buttonExists(owner, 'Give task')) && !(await buttonExists(owner, 'Mark as completed')));

  console.log('\nOther churches');
  await faith.go('/app/volunteers');
  check("another church does not see Grace's volunteers", !/Bola Driver|Chi Helper/.test(await faith.text()));
  await faith.go(`/app/volunteers/${bola.id}`);
  check("another church cannot open Grace's volunteer", /not found|404/i.test(await faith.text()));
  await faith.go('/app/notifications');
  check("another church gets none of Grace's notifications", !/MM-|Rice bags/.test(await faith.text()));

  console.log('\nPhone layout');
  const phone = await newSession({ mobile: true });
  await signIn(phone, 'coord@grace.test');
  for (const path of ['/app/notifications', '/app/volunteers', `/app/requests/${b.id}`]) {
    await phone.go(path);
    check(`${path.replace(/[0-9a-f-]{36}/, '…')} fits on a phone`, !(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  }
  if (process.env.E2E_SCREENSHOTS) {
    await owner.go('/app/notifications');
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/notifications.png`, fullPage: true });
    const c = await makeRequest(grace, { quantity: 1, area: 'Ijapo', phone: '0803 555 0103', status: 'approved' });
    await owner.go(`/app/requests/${c.id}`);
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/tasks.png`, fullPage: true });
    await phone.go('/app/volunteers');
    await phone.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/volunteers-mobile.png`, fullPage: true });
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
