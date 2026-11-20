// End-to-end journey for Milestone 5 (resources, approval by reservation,
// delivery, fulfilment and stock release), against the mock Supabase API and a
// real local PostgreSQL.
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


const stock = async (name) => (await mock.pool.query(
  `select r.id, r.total_quantity as total, private.resource_available(r.id) as available,
          coalesce((select sum(a.quantity) from public.allocations a where a.resource_id = r.id and a.status = 'reserved'), 0)::int as reserved,
          coalesce((select sum(a.quantity) from public.allocations a where a.resource_id = r.id and a.status = 'fulfilled'), 0)::int as distributed
     from public.resources r where r.name = $1`, [name])).rows[0];
const allocationOf = async (requestId) => (await mock.pool.query(
  `select status, quantity, release_reason from public.allocations where request_id = $1 order by approved_at desc limit 1`, [requestId])).rows[0];
const offered = (s) => s.page.$$eval('input[name="resourceId"]', (els) => els.map((e) => e.closest('label').innerText));
const pick = (s, id) => s.page.click(`input[name="resourceId"][value="${id}"]`);
// Several forms on the request page have a "note" box; type into the one in the
// form that also holds the given field.
async function noteIn(s, fieldSelector, value) {
  const box = await s.page.evaluateHandle((sel) => document.querySelector(sel)?.closest('form')?.querySelector('textarea[name="note"]'), fieldSelector);
  await box.asElement().type(value);
}
async function addResource(s, { name, category = 'food', unit = 'package', total, partner, areas, from, until }) {
  await s.go('/app/resources/new');
  await s.fill('form [name="name"]', name);
  await s.page.select('form select[name="category"]', category);
  await s.fill('form [name="unit"]', unit);
  await s.fill('form [name="total"]', String(total));
  if (partner) {
    await s.page.click('input[name="sourceType"][value="partner"]');
    await s.page.waitForSelector('form [name="sourceName"]');
    await s.fill('form [name="sourceName"]', partner);
  }
  if (areas) await s.fill('form [name="areas"]', areas);
  if (from) await s.page.$eval('form [name="validFrom"]', (el, v) => { el.value = v; }, from);
  if (until) await s.page.$eval('form [name="validUntil"]', (el, v) => { el.value = v; }, until);
  await s.press('Add resource');
  await s.page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
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
  const faith = await newSession();
  await staffAccount(faith, 'owner@faith.test', 'Living Faith Church', 'living-faith');
  const grace = (await mock.pool.query(`select id from public.churches where slug = 'grace-community'`)).rows[0].id;
  const living = (await mock.pool.query(`select id from public.churches where slug = 'living-faith'`)).rows[0].id;
  await mock.pool.query(`update public.churches set status = 'verified' where id = $1`, [grace]);

  console.log('\nResources list and form');
  await owner.go('/app/resources');
  let t = await owner.text();
  check('Resources is in the sidebar', await owner.page.$('nav a[href="/app/resources"]') !== null);
  check('empty state explains what resources are for', /There are no active resources yet/.test(t));

  await owner.go('/app/resources/new');
  await owner.press('Add resource');
  t = await owner.text();
  check('empty form shows what is missing', /Give the resource a name/.test(t) && /Choose the kind of help/.test(t) && /Enter a number/.test(t), t.slice(0, 400));
  await owner.fill('form [name="name"]', 'Bad dates');
  await owner.page.select('form select[name="category"]', 'food');
  await owner.fill('form [name="unit"]', 'package');
  await owner.fill('form [name="total"]', '3');
  await owner.page.click('input[name="sourceType"][value="partner"]');
  await owner.page.waitForSelector('form [name="sourceName"]');
  await owner.page.$eval('form [name="validFrom"]', (el) => { el.value = '2026-12-10'; });
  await owner.page.$eval('form [name="validUntil"]', (el) => { el.value = '2026-12-01'; });
  await owner.press('Add resource');
  t = await owner.text();
  check('a partner resource needs the partner name', /Name the partner that provides it/.test(t));
  check('the end date cannot be before the start date', /end date is before the start date/.test(t));
  check('typed values are kept after an error', await owner.page.$eval('form [name="name"]', (el) => el.value) === 'Bad dates');
  check('nothing was saved', (await mock.pool.query(`select count(*)::int as n from public.resources`)).rows[0].n === 0);

  await addResource(owner, { name: 'Food package', total: 5, areas: 'Ijapo, Oke-Aro\nijapo' });
  t = await owner.text();
  check('adding a resource opens it', /\/app\/resources\/[0-9a-f-]{36}/.test(owner.page.url()) && /Resource added/.test(t));
  const food = await stock('Food package');
  check('new resource starts with all stock available', food.total === 5 && food.available === 5);
  check('areas are tidied and duplicates dropped',
    JSON.stringify((await mock.pool.query(`select coverage_areas from public.resources where id = $1`, [food.id])).rows[0].coverage_areas) === '["Ijapo","Oke-Aro"]');
  check('detail page shows the counts', await owner.page.$eval('[data-stat="available"] dd', (el) => el.innerText) === '5');

  await addResource(owner, { name: 'Hope Foods voucher', unit: 'voucher', total: 1, partner: 'Hope Foods' });
  await addResource(owner, { name: 'Old rice stock', total: 10, until: '2020-01-31' });
  await addResource(owner, { name: 'Christmas hamper', total: 10, from: '2099-12-01' });
  await addResource(owner, { name: 'Winter coats', category: 'clothing', unit: 'coat', total: 4 });
  const voucher = await stock('Hope Foods voucher');
  check('audit log records resource creation',
    (await mock.pool.query(`select count(*)::int as n from public.audit_logs where action = 'resource.created' and church_id = $1`, [grace])).rows[0].n === 5);

  await owner.go('/app/resources');
  t = await owner.text();
  check('list shows every active resource', ['Food package', 'Hope Foods voucher', 'Old rice stock', 'Christmas hamper', 'Winter coats'].every((n) => t.includes(n)));
  check('list marks expired and future resources', /Past end date/.test(t) && /Not available yet/.test(t));
  check('list names the partner', /From Hope Foods/.test(t));

  console.log('\nMatching');
  const a = await makeRequest(grace, { area: 'ijapo', quantity: 2 });
  await owner.go(`/app/requests/${a.id}`);
  let options = await offered(owner);
  check('a fitting resource is offered with its stock and coverage',
    options.length === 1 && /Food package/.test(options[0]) && /5 package available/.test(options[0]) && /Covers their area/.test(options[0]), JSON.stringify(options));
  t = await owner.text();
  check('resources that cannot be used are listed with a reason',
    /Hope Foods voucher: Not enough left \(1 voucher left\)/.test(t) && /Old rice stock: Past its end date/.test(t) && /Christmas hamper: Not available yet/.test(t), t);
  check('other kinds of help are not listed', !t.includes('Winter coats'));
  check('approved is never offered as a plain status change',
    !(await owner.page.$$eval('input[name="toStatus"]', (els) => els.map((e) => e.value))).includes('approved'));

  console.log('\nApproval reserves stock');
  await owner.press('Approve and reserve');
  t = await owner.text();
  check('approving needs a resource to be chosen', /Choose a resource to reserve/.test(t));
  check('nothing reserved without a choice', (await statusOf(a.id)).status === 'awaiting_match');
  await pick(owner, food.id);
  await noteIn(owner, 'input[name="resourceId"]', 'Collect on Saturday morning.');
  await owner.press('Approve and reserve');
  t = await owner.text();
  check('request is approved', (await statusOf(a.id)).status === 'approved');
  check('stock is reserved at the same moment', (await stock('Food package')).available === 3 && (await stock('Food package')).reserved === 2);
  check('page shows the reserved stock', /Stock reserved[\s\S]*2 package from[\s\S]*Food package/.test(t));
  check('history records the reservation and note', /Reserved 2 package from "Food package"\. Collect on Saturday morning\./.test(t), t.slice(-1500));
  let toOptions = await owner.page.$$eval('input[name="toStatus"]', (els) => els.map((e) => e.value));
  check('approved request can start delivery, be released, declined, cancelled or closed',
    ['in_progress', 'awaiting_match', 'declined', 'cancelled', 'unable_to_fulfil'].every((s) => toOptions.includes(s)), JSON.stringify(toOptions));
  check('approved request cannot be marked fulfilled without the fulfilment form', !toOptions.includes('fulfilled'));

  await owner.go('/app/resources');
  check('resource list shows the reserved stock',
    await owner.page.$eval('tr[data-resource="Food package"] [data-col="available"]', (el) => el.innerText) === '3'
    && await owner.page.$eval('tr[data-resource="Food package"] [data-col="reserved"]', (el) => el.innerText) === '2');
  await owner.go(`/app/resources/${food.id}`);
  t = await owner.text();
  check('resource page lists the request using it', t.includes(a.reference) && /Reserved/.test(t));

  console.log('\nDelivery and fulfilment');
  await owner.go(`/app/requests/${a.id}`);
  await choose(owner, 'in_progress');
  await owner.press('Update status');
  check('start delivery needs no note', (await statusOf(a.id)).status === 'in_progress');
  check('stock stays reserved while delivering', (await allocationOf(a.id)).status === 'reserved' && (await stock('Food package')).available === 3);
  toOptions = await owner.page.$$eval('input[name="toStatus"]', (els) => els.map((e) => e.value));
  check('in progress can be released, cancelled or closed but not started again',
    ['awaiting_match', 'cancelled', 'unable_to_fulfil'].every((s) => toOptions.includes(s)) && !toOptions.includes('in_progress') && !toOptions.includes('declined'), JSON.stringify(toOptions));
  await noteIn(owner, 'textarea[name="note"][maxlength="1000"]', 'Handed over by Deacon Sam.');
  await owner.press('Mark as fulfilled');
  t = await owner.text();
  check('request is fulfilled', (await statusOf(a.id)).status === 'fulfilled');
  check('reserved stock becomes given out', (await allocationOf(a.id)).status === 'fulfilled'
    && (await stock('Food package')).distributed === 2 && (await stock('Food package')).reserved === 0 && (await stock('Food package')).available === 3);
  check('page shows help given', /Help given[\s\S]*2 package from/.test(t));
  check('fulfilled request has no further actions', (await owner.page.$$('input[name="toStatus"]')).length === 0 && !/Mark as fulfilled/.test(t));
  check('delivery note is kept as the outcome', (await statusOf(a.id)).outcome_reason === 'Handed over by Deacon Sam.');

  console.log('\nCoverage and editing');
  const b = await makeRequest(grace, { area: 'Alagbaka', quantity: 2 });
  await owner.go(`/app/requests/${b.id}`);
  t = await owner.text();
  check('a resource that does not cover their area is not offered', (await offered(owner)).length === 0 && /Food package: Does not cover their area/.test(t));
  check('says when nothing can meet the request', /No resource can meet this request right now/.test(t));
  check('no approve button when nothing fits', !(await owner.page.$$eval('button', (els) => els.some((b) => b.innerText.trim() === 'Approve and reserve'))));
  await owner.go(`/app/resources/${food.id}`);
  await owner.fill('form [name="areas"]', 'Ijapo, Oke-Aro, Alagbaka');
  await owner.press('Save changes');
  check('editing a resource saves', /Changes saved/.test(await owner.text()));
  await owner.go(`/app/requests/${b.id}`);
  check('after adding the area it is offered', (await offered(owner)).some((o) => /Food package/.test(o)));
  await pick(owner, food.id);
  await owner.press('Approve and reserve');
  check('approved after the edit', (await statusOf(b.id)).status === 'approved' && (await stock('Food package')).available === 1);

  console.log('\nDeclining releases stock');
  await choose(owner, 'declined');
  await owner.press('Update status');
  t = await owner.text();
  check('declining an approved request needs a note', /short note/.test(t) && (await statusOf(b.id)).status === 'approved');
  await choose(owner, 'declined');
  await noteIn(owner, 'input[name="toStatus"]', 'They found help elsewhere.');
  await owner.press('Update status');
  t = await owner.text();
  check('declined', (await statusOf(b.id)).status === 'declined');
  check('stock is returned', (await stock('Food package')).available === 3 && (await allocationOf(b.id)).status === 'released');
  check('release reason is recorded', (await allocationOf(b.id)).release_reason === 'They found help elsewhere.');
  check('history says the stock was returned', /They found help elsewhere\. \(Reserved stock returned\.\)/.test(t), t.slice(-1200));

  console.log('\nCancelling during delivery releases stock');
  const c = await makeRequest(grace, { area: 'Oke-Aro', quantity: 1 });
  await owner.go(`/app/requests/${c.id}`);
  await pick(owner, food.id);
  await owner.press('Approve and reserve');
  await choose(owner, 'in_progress');
  await owner.press('Update status');
  check('delivery started', (await statusOf(c.id)).status === 'in_progress' && (await stock('Food package')).available === 2);
  await choose(owner, 'cancelled');
  await noteIn(owner, 'input[name="toStatus"]', 'They moved away.');
  await owner.press('Update status');
  check('cancelled during delivery', (await statusOf(c.id)).status === 'cancelled');
  check('stock is returned after cancelling', (await stock('Food package')).available === 3 && (await allocationOf(c.id)).status === 'released');

  console.log('\nUnable to fulfil releases stock');
  const u = await makeRequest(grace, { area: 'Ijapo', quantity: 1 });
  await owner.go(`/app/requests/${u.id}`);
  await pick(owner, food.id);
  await owner.press('Approve and reserve');
  await choose(owner, 'unable_to_fulfil');
  await noteIn(owner, 'input[name="toStatus"]', 'Could not reach them.');
  await owner.press('Update status');
  check('closed as unable to fulfil with the stock back', (await statusOf(u.id)).status === 'unable_to_fulfil' && (await stock('Food package')).available === 3);

  console.log('\nRelease and choose another resource');
  const d = await makeRequest(grace, { quantity: 1 });
  await owner.go(`/app/requests/${d.id}`);
  options = await offered(owner);
  check('a request with no area is offered resources with a coverage warning',
    options.some((o) => /Food package/.test(o) && /Area not given: check coverage/.test(o)) && options.some((o) => /Hope Foods voucher/.test(o) && /Serves any area/.test(o)), JSON.stringify(options));
  await pick(owner, food.id);
  await owner.press('Approve and reserve');
  check('approved on the food package', (await stock('Food package')).available === 2);
  t = await owner.text();
  check('release option is worded clearly', /Release and choose another resource/.test(t));
  await choose(owner, 'awaiting_match');
  await owner.press('Update status');
  check('releasing needs a note', (await statusOf(d.id)).status === 'approved');
  await choose(owner, 'awaiting_match');
  await noteIn(owner, 'input[name="toStatus"]', 'Partner voucher is closer to them.');
  await owner.press('Update status');
  check('back to awaiting a resource with the stock returned', (await statusOf(d.id)).status === 'awaiting_match' && (await stock('Food package')).available === 3);
  await pick(owner, voucher.id);
  await owner.press('Approve and reserve');
  t = await owner.text();
  check('re-matched to the partner voucher', (await statusOf(d.id)).status === 'approved' && (await stock('Hope Foods voucher')).available === 0);
  check('page shows the partner name', /Hope Foods voucher[\s\S]*\(Hope Foods\)/.test(t));

  console.log('\nTotal cannot drop below what is committed');
  await owner.go(`/app/resources/${food.id}`);
  await owner.fill('form [name="total"]', '1');
  await owner.press('Save changes');
  t = await owner.text();
  check('lowering the total below reserved and given out is refused', /less than is already reserved or given out/.test(t) && (await stock('Food package')).total === 5);

  console.log('\nTwo people approving at once');
  const second = await newSession();
  await signIn(second, 'owner@grace.test');
  const e1 = await makeRequest(grace, { quantity: 2, area: 'Ijapo' });
  const e2 = await makeRequest(grace, { quantity: 2, area: 'Ijapo' });
  // Leave 2 in the food package, then both pages offer it.
  await mock.pool.query(`update public.resources set total_quantity = 4 where id = $1`, [food.id]);
  check('two left for two requests that each need two', (await stock('Food package')).available === 2);
  await owner.go(`/app/requests/${e1.id}`);
  await second.go(`/app/requests/${e2.id}`);
  await pick(second, food.id);
  await second.press('Approve and reserve');
  check('the first approval wins', (await statusOf(e2.id)).status === 'approved' && (await stock('Food package')).available === 0);
  await pick(owner, food.id);
  await owner.press('Approve and reserve');
  t = await owner.text();
  check('the second approval is refused because the stock is gone', (await statusOf(e1.id)).status === 'awaiting_match' && /no longer has enough available/.test(t), t.slice(0, 500));
  check('stock never goes below zero', (await stock('Food package')).available === 0);
  check('page refreshes to show nothing fits now', /No resource can meet this request right now/.test(await owner.text()) || (await offered(owner)).length === 0);

  await owner.go(`/app/requests/${e2.id}`);
  await second.go(`/app/requests/${e2.id}`);
  await noteIn(owner, 'textarea[name="note"][maxlength="1000"]', 'Delivered.');
  await owner.press('Mark as fulfilled');
  await second.press('Mark as fulfilled');
  t = await second.text();
  check('a stale page cannot fulfil twice', /Someone else changed/.test(t) && (await stock('Food package')).distributed === 4, t.slice(0, 400));

  console.log('\nArchiving');
  await mock.pool.query(`update public.resources set total_quantity = 10 where id = $1`, [food.id]);
  await owner.go(`/app/resources/${food.id}`);
  await owner.press('Archive');
  check('archived', /Archived/.test(await owner.text()) && (await mock.pool.query(`select status from public.resources where id = $1`, [food.id])).rows[0].status === 'archived');
  await owner.go(`/app/requests/${e1.id}`);
  t = await owner.text();
  check('an archived resource is not offered or listed', !(await offered(owner)).some((o) => /Food package/.test(o)) && !t.includes('Food package'));
  await owner.go('/app/resources');
  check('archived resources are hidden from the list by default', !(await owner.text()).includes('Food package'));
  await owner.go('/app/resources?show=archived');
  check('and shown on request', (await owner.text()).includes('Food package'));
  await owner.go(`/app/resources/${food.id}`);
  await owner.press('Restore');
  await owner.go(`/app/requests/${e1.id}`);
  check('a restored resource is offered again', (await offered(owner)).some((o) => /Food package/.test(o)));

  console.log('\nOther churches');
  await faith.go('/app/resources');
  t = await faith.text();
  check("another church does not see Grace's resources", !t.includes('Food package') && !t.includes('Hope Foods'));
  await faith.go(`/app/resources/${food.id}`);
  check("another church cannot open Grace's resource", /not found|could not be found|404/i.test(await faith.text()));
  const lf = await makeRequest(living, { quantity: 1 });
  await faith.go(`/app/requests/${lf.id}`);
  t = await faith.text();
  check("another church's request is never matched to Grace's stock", (await offered(faith)).length === 0 && !t.includes('Food package') && /No resource can meet/.test(t));

  console.log('\nPhone layout');
  const coord = await newSession({ mobile: true });
  await signIn(coord, 'owner@grace.test');
  await coord.go('/app/resources');
  const overflow = await coord.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('resources page has no sideways page scroll on a phone', !overflow);
  await coord.go(`/app/requests/${e1.id}`);
  check('matching panel has no sideways scroll on a phone', !(await coord.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  if (process.env.E2E_SCREENSHOTS) {
    await coord.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/match-mobile.png`, fullPage: true });
    await owner.go('/app/resources');
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/resources-desktop.png`, fullPage: true });
    await owner.go(`/app/requests/${e1.id}`);
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/match-desktop.png`, fullPage: true });
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
