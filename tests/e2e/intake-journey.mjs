// End-to-end journey for Milestone 3 (public and staff-assisted intake),
// against the mock Supabase API and a real local PostgreSQL.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { E2E_SECRET_KEY, E2E_TURNSTILE_SECRET, startMockSupabase } from './mock-supabase.mjs';

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
    fill: async (name, value) => {
      await page.$eval(`form [name="${name}"]`, (el) => { el.value = ''; });
      if (value) await page.type(`form [name="${name}"]`, value);
    },
    choose: (name, value) => page.click(`input[name="${name}"][value="${value}"]`),
    tick: (name) => page.click(`input[name="${name}"]`),
    press: async (label) => {
      const handle = await page.evaluateHandle((l) =>
        [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === l), label);
      if (!handle.asElement()) throw new Error(`button not found: ${label}`);
      await Promise.all([page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {}), handle.asElement().click()]);
      await new Promise((r) => setTimeout(r, 300));
    },
    close: () => context.close(),
  };
}

// The real widget cannot load here (no internet), so put a token in the form
// the way the widget would.
async function setToken(s, token) {
  await s.page.evaluate((t) => {
    const form = document.querySelector('form');
    let input = form.querySelector('input[name="cf-turnstile-response"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'cf-turnstile-response';
      form.appendChild(input);
    }
    input.value = t;
  }, token);
}

const PASSWORD = 'harvest2026x';
const userId = async (email) => (await mock.pool.query('select id from auth.users where email = $1', [email])).rows[0]?.id;
async function staffAccount(s, email, church, slug) {
  await s.go('/sign-up');
  await s.fill('email', email);
  await s.fill('password', PASSWORD);
  await s.fill('confirmPassword', PASSWORD);
  await s.press('Create account');
  await s.go(`/auth/confirm?token_hash=${await userId(email)}&type=signup`);
  await s.fill('name', church);
  await s.fill('slug', slug);
  await s.press('Register church');
}
const requestCount = async (where = 'true', params = []) =>
  (await mock.pool.query(`select count(*)::int as n from public.requests where ${where}`, params)).rows[0].n;

let tokenN = 0;
async function fillValidPublicRequest(s, { method = 'phone_call', phone = '0803 123 4567' } = {}) {
  await s.choose('category', 'food');
  await s.fill('description', 'We have run out of food for the children this week.');
  await s.fill('quantity', '3');
  await s.choose('contactMethod', method);
  if (method === 'phone_call' || method === 'sms') {
    await s.page.waitForSelector('form [name="contactValue"]');
    await s.fill('contactValue', phone);
  }
  if (!(await s.page.$eval('form [name="consent"]', (el) => el.checked))) await s.tick('consent');
}

try {
  console.log('\nSetup: two churches');
  const owner = await newSession();
  await staffAccount(owner, 'owner@grace.test', 'Grace Community Church', 'grace-community');
  const faith = await newSession();
  await staffAccount(faith, 'owner@faith.test', 'Living Faith Church', 'living-faith');
  const grace = (await mock.pool.query(`select id from public.churches where slug = 'grace-community'`)).rows[0].id;
  const living = (await mock.pool.query(`select id from public.churches where slug = 'living-faith'`)).rows[0].id;
  check('both churches registered', Boolean(grace && living));

  console.log('\nPublic page availability');
  const visitor = await newSession({ mobile: true });
  for (const [slug, label] of [['grace-community', 'pending'], ['living-faith', 'pending'], ['no-such-church', 'unknown'], ['BAD%20slug', 'malformed']]) {
    await visitor.go(`/request/${slug}`);
    check(`${label} church page (${slug}) is not available`, /This request page is not available/.test(await visitor.text()));
  }
  check('the unavailable page reveals nothing about the church', !/Grace|Living Faith/.test(await visitor.text()));

  await mock.pool.query(`update public.churches set status = 'verified' where id = $1`, [grace]);
  await visitor.go('/request/grace-community');
  let t = await visitor.text();
  check('verified church page shows the church and the form', /Grace Community Church/.test(t) && /What kind of help do you need\?/.test(t));
  check('no account or sign-in is asked for', !/Sign in|Create an account|Password/.test(t) && /do not need an account/.test(t));
  check('not-an-emergency notice with default guidance', /This is not an emergency service/.test(t) && /local emergency services/.test(t));
  check('all nine categories offered', (await visitor.page.$$('input[name="category"]')).length === 9);
  check('page is kept out of search engines',
    (await visitor.page.$eval('meta[name="robots"]', (m) => m.content).catch(() => '')).includes('noindex'));
  const overflow = await visitor.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no sideways scrolling on a phone', !overflow);
  await new Promise((r) => setTimeout(r, 1500));
  check('if the security check cannot load, the visitor is told', /security check could not load/.test(await visitor.text()));
  if (process.env.E2E_SCREENSHOTS) await visitor.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/public-form-mobile.png`, fullPage: true });

  console.log('\nPublic form validation');
  await visitor.press('Send my request');
  t = await visitor.text();
  check('empty form: category, description and consent errors',
    /Choose the kind of help you need/.test(t) && /at least 10 characters/.test(t) && /tick this box/.test(t));
  check('empty form: phone number asked for when "Call me" is chosen', /Enter a phone number/.test(t));
  check('nothing was saved', (await requestCount()) === 0);

  await fillValidPublicRequest(visitor, { phone: 'call me maybe' });
  await setToken(visitor, `e2e-pass-${++tokenN}`);
  await visitor.press('Send my request');
  t = await visitor.text();
  check('invalid phone number is rejected', /valid phone number/.test(t));
  const keptDesc = await visitor.page.$eval('form [name="description"]', (el) => el.value);
  check('the description is kept after an error', keptDesc.startsWith('We have run out of food'), JSON.stringify(keptDesc));
  check('consent must be ticked again', !(await visitor.page.$eval('form [name="consent"]', (el) => el.checked)));
  check('the token was not spent on an invalid form', mock.turnstileCalls.length === 0);

  await fillValidPublicRequest(visitor);
  await visitor.page.evaluate(() => document.querySelector('input[name="cf-turnstile-response"]')?.remove());
  await visitor.press('Send my request');
  t = await visitor.text();
  check('without the security check the request is refused', /complete the security check/.test(t),
    (t.match(/(Choose[^\n]*|Tell us a little[^\n]*|valid phone[^\n]*|Enter a phone[^\n]*|tick this box[^\n]*|could not[^\n]*)/g) ?? []).join(' / '));
  check('still nothing saved', (await requestCount()) === 0);

  await fillValidPublicRequest(visitor);
  await setToken(visitor, 'forged-token');
  await visitor.press('Send my request');
  check('a forged security token is refused', /complete the security check/.test(await visitor.text()) && (await requestCount()) === 0);

  await fillValidPublicRequest(visitor);
  await visitor.page.$eval('input[name="website"]', (el) => { el.value = 'http://spam.example'; });
  await setToken(visitor, `e2e-pass-${++tokenN}`);
  await visitor.press('Send my request');
  check('a filled-in trap field is refused and nothing saved', /could not be sent/.test(await visitor.text()) && (await requestCount()) === 0);
  await visitor.page.$eval('input[name="website"]', (el) => { el.value = ''; });

  console.log('\nSuccessful public request');
  await fillValidPublicRequest(visitor);
  const goodToken = `e2e-pass-${++tokenN}`;
  await setToken(visitor, goodToken);
  await visitor.press('Send my request');
  t = await visitor.text();
  const ref = t.match(/MM-[0-9A-F]{6}-[0-9A-F]{6}/)?.[0];
  check('confirmation with a reference number', /Your request has been sent/.test(t) && Boolean(ref));
  check('explains what happens next and how contact works', /What happens next/.test(t) && /may call you/.test(t) && /not an emergency service/.test(t));
  const row = (await mock.pool.query('select * from public.requests where reference = $1', [ref])).rows[0];
  check('saved to the church named by the link', row?.church_id === grace);
  check('saved as public, submitted, no staff author, consent recorded',
    row?.channel === 'public' && row?.status === 'submitted' && row?.created_by === null && Boolean(row?.consent_given_at));
  check('fields saved as entered', row?.category_key === 'food' && row?.quantity_needed === 3 && row?.contact_value === '0803 123 4567');
  const ev = (await mock.pool.query('select event_type from public.request_events where request_id = $1', [row?.id])).rows;
  check('history starts with a "submitted" event', ev.length === 1 && ev[0].event_type === 'submitted');
  const limitRow = (await mock.pool.query('select ip_hash from public.intake_rate_limits')).rows[0];
  check('only a hash of the address is stored', /^[0-9a-f]{64}$/.test(limitRow?.ip_hash ?? '') && limitRow.ip_hash !== 'unknown');
  if (process.env.E2E_SCREENSHOTS) await visitor.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/public-confirmation-mobile.png`, fullPage: true });

  await visitor.go('/request/grace-community');
  await fillValidPublicRequest(visitor);
  await setToken(visitor, goodToken);
  await visitor.press('Send my request');
  check('a security token cannot be used twice', /complete the security check/.test(await visitor.text()) && (await requestCount()) === 1);

  console.log('\nRate limit');
  for (let i = 0; i < 4; i++) {
    await visitor.go('/request/grace-community');
    await fillValidPublicRequest(visitor, { method: 'none' });
    await setToken(visitor, `e2e-pass-${++tokenN}`);
    await visitor.press('Send my request');
  }
  check('five requests from one connection are accepted', (await requestCount(`channel = 'public'`)) === 5);
  const none = (await mock.pool.query(`select contact_value from public.requests where contact_method = 'none' limit 1`)).rows[0];
  check('no phone number is stored for "I don\'t have a phone"', none?.contact_value === null);
  await visitor.go('/request/grace-community');
  await fillValidPublicRequest(visitor);
  await setToken(visitor, `e2e-pass-${++tokenN}`);
  await visitor.press('Send my request');
  check('the sixth within the hour is refused with a clear message',
    /Too many requests have been sent from this connection/.test(await visitor.text()) && (await requestCount(`channel = 'public'`)) === 5);

  console.log('\nStaff-assisted intake');
  await owner.go('/app');
  t = await owner.text();
  check('overview shows the live public link once verified', /Your public request page is live/.test(t) && /\/request\/grace-community/.test(t));
  await owner.go('/app/requests/new');
  t = await owner.text();
  check('staff form is available from the workspace', /Record a request/.test(t) && /Kind of help needed/.test(t));
  check('staff form has no security check', !(await owner.page.$('[data-testid="turnstile"]')));
  await owner.press('Record request');
  check('staff form is validated too', /Choose the kind of help you need/.test(await owner.text()));
  await owner.choose('category', 'clothing');
  await owner.fill('description', 'Walked in this morning asking for school uniforms for two children.');
  await owner.fill('quantity', '2');
  await owner.tick('consent');
  await owner.press('Record request');
  t = await owner.text();
  const staffRef = t.match(/MM-[0-9A-F]{6}-[0-9A-F]{6}/)?.[0];
  check('staff request recorded with a reference', /Request recorded/.test(t) && Boolean(staffRef));
  const staffRow = (await mock.pool.query('select * from public.requests where reference = $1', [staffRef])).rows[0];
  check('marked as staff-assisted, with its author, in the right church',
    staffRow?.channel === 'staff' && staffRow?.created_by === (await userId('owner@grace.test')) && staffRow?.church_id === grace);
  check('defaults to "in person" contact with no number', staffRow?.contact_method === 'in_person' && staffRow?.contact_value === null);
  await owner.press('Record another request');
  check('"Record another" gives a fresh form', (await owner.page.$eval('form [name="description"]', (el) => el.value)) === '');

  await faith.go('/app/requests/new');
  await faith.choose('category', 'medical');
  await faith.fill('description', 'Needs help getting to the clinic for a check-up.');
  await faith.tick('consent');
  await faith.press('Record request');
  const faithRef = (await faith.text()).match(/MM-[0-9A-F]{6}-[0-9A-F]{6}/)?.[0];
  const faithRow = (await mock.pool.query('select church_id from public.requests where reference = $1', [faithRef])).rows[0];
  check('a church awaiting verification can still record requests, in its own workspace', faithRow?.church_id === living);
  check('Grace has 6 requests and Living Faith 1', (await requestCount('church_id = $1', [grace])) === 6 && (await requestCount('church_id = $1', [living])) === 1);

  console.log('\nChurch profile and emergency guidance');
  await owner.go('/app/settings');
  await owner.fill('contactPhone', 'not a phone');
  await owner.press('Save details');
  check('invalid church phone rejected', /valid phone number/.test(await owner.text()));
  await owner.fill('contactPhone', '0803 555 0101');
  await owner.fill('emergencyGuidance', 'In an emergency call 112. Pastor on call: 0803 555 0199.');
  await owner.press('Save details');
  check('church details saved', /Church details saved/.test(await owner.text()));
  await visitor.go('/request/grace-community');
  t = await visitor.text();
  check('public page shows the church\'s own emergency guidance and phone', /Pastor on call: 0803 555 0199/.test(t) && /0803 555 0101/.test(t));

  const coordEmail = 'coord@grace.test';
  await owner.go('/app/settings/staff');
  await owner.fill('email', coordEmail);
  await owner.press('Create invitation');
  const invitePath = new URL((await owner.text()).match(/http:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/)[0]).pathname;
  const coord = await newSession();
  await coord.go('/sign-up');
  await coord.fill('email', coordEmail);
  await coord.fill('password', PASSWORD);
  await coord.fill('confirmPassword', PASSWORD);
  await coord.press('Create account');
  await coord.go(`/auth/confirm?token_hash=${await userId(coordEmail)}&type=signup`);
  await coord.go(invitePath);
  await coord.press('Accept invitation');
  await coord.go('/app/settings');
  check('a coordinator sees the profile but cannot save it',
    /Grace Community Church/.test(await coord.text()) && !/Save details/.test(await coord.text()));
  await coord.go('/app/requests/new');
  await coord.choose('category', 'food');
  await coord.fill('description', 'Called the office asking for a food parcel.');
  await coord.choose('contactMethod', 'phone_call');
  await coord.page.waitForSelector('form [name="contactValue"]');
  await coord.fill('contactValue', '0803 222 3344');
  await coord.tick('consent');
  await coord.press('Record request');
  check('a coordinator can record requests', /Request recorded/.test(await coord.text()));

  console.log('\nSecrets stay on the server');
  const staticDir = join(process.cwd(), '.next', 'static');
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = walk(staticDir);
  const leaks = files.filter((f) => {
    const body = readFileSync(f, 'utf8');
    return body.includes(E2E_SECRET_KEY) || body.includes(E2E_TURNSTILE_SECRET) || body.includes(process.env.INTAKE_HASH_SECRET ?? '\u0000');
  });
  check(`no secret appears in browser code (${files.length} files checked)`, files.length > 0 && leaks.length === 0, leaks.join(', '));
  const html = await (await fetch(`${BASE}/request/grace-community`)).text();
  check('no secret appears in the public page HTML', !html.includes(E2E_SECRET_KEY) && !html.includes(E2E_TURNSTILE_SECRET));
  check('the public site key is present for the widget', html.includes('1x00000000000000000000AA'));

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
