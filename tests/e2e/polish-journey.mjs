// End-to-end journey for Milestone 9 (landing page and polish): accessibility
// (axe), phone layout, titles, link previews, robots, skip link, and the two
// Milestone 2 fixes. Mock Supabase API and a real local PostgreSQL.
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
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

const VERSE = 'The King will answer them, ‘Most certainly I tell you, because you did it to one of the least of these my brothers, you did it to me.’';
const axeIssues = [];
async function audit(s, path, label = path) {
  await s.go(path);
  await s.page.addScriptTag({ path: AXE });
  const violations = await s.page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: String(v.nodes[0]?.target ?? '') })));
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of violations) axeIssues.push(`${label}: ${v.impact} ${v.id} ×${v.nodes} (${v.target})`);
  check(`${label}: no serious accessibility problems`, serious.length === 0, JSON.stringify(serious));
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  return { overflow, title: await s.page.title() };
}

try {
  console.log('\nSetup');
  const owner = await newSession();
  await staffAccount(owner, 'owner@grace.test', 'Grace Community Church', 'grace-community');
  const grace = (await mock.pool.query(`select id from public.churches where slug = 'grace-community'`)).rows[0].id;
  await mock.pool.query(`update public.churches set status = 'verified' where id = $1`, [grace]);
  const faith = await newSession();
  await staffAccount(faith, 'owner@faith.test', 'Living Faith Church', 'living-faith');
  const refs = await seed(grace);
  await mock.pool.query(`insert into public.volunteers (church_id, full_name, phone, consent_given_at) values ($1, 'Bola Driver', '0803 000 0001', now())`, [grace]);

  console.log('\nLanding page');
  const visitor = await newSession();
  await visitor.go('/');
  let t = await visitor.text();
  check('page title', (await visitor.page.title()) === 'MERCYMAP · Church compassion, coordinated');
  check('one main heading with the promise', (await visitor.page.$$eval('h1', (h) => h.map((x) => x.textContent))).join() === 'Turning Church Compassion Into Coordinated Community Impact.');
  check('Matthew 25:40 in the World English Bible, with its reference', t.includes(`“${VERSE}”`) && /Matthew 25:40\s*· World English Bible/.test(t));
  check('register and sign-in links', await visitor.page.$('main a[href="/sign-up"]') !== null && await visitor.page.$('a[href="/sign-in"]') !== null);
  check('how it works, features, safety and help-seeker sections', ['How it works', 'What your church gets', 'Safe, private and human', 'Looking for help?'].every((h) => t.includes(h)));
  check('people looking for help are told to ask their church for its link', /Ask your church for its MERCYMAP link/.test(t));
  check('no church is listed on the public site', !/Grace Community|Living Faith/.test(t) && (await visitor.page.$$('a[href^="/request/"]')).length === 0);
  const meta = await visitor.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"]')]
    .map((m) => [m.getAttribute('property') ?? m.getAttribute('name'), m.getAttribute('content')])));
  check('link previews: title, description, image and large card', meta['og:title'] === 'MERCYMAP · Church compassion, coordinated'
    && /People asking for help never need an account/.test(meta['og:description'] ?? '') && /^http:\/\/localhost:3100\/opengraph-image/.test(meta['og:image'] ?? '')
    && meta['twitter:card'] === 'summary_large_image', JSON.stringify(meta));
  const og = await fetch(meta['og:image']);
  check('the preview image is a 1200×630 PNG', og.status === 200 && og.headers.get('content-type') === 'image/png'
    && (await og.arrayBuffer()).byteLength > 5000 && meta['og:image:width'] === '1200' && meta['og:image:height'] === '630');
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check('search engines are kept away from request pages and the app', /Disallow: \/request\//.test(robots) && /Disallow: \/app\//.test(robots) && /Allow: \/\$/.test(robots), robots);
  await visitor.go('/request/grace-community');
  check('request pages ask search engines not to index them', await visitor.page.$eval('meta[name="robots"]', (m) => m.content) === 'noindex, nofollow');

  console.log('\nKeyboard');
  await visitor.go('/');
  await visitor.page.keyboard.press('Tab');
  check('the first Tab reaches "Skip to main content"', await visitor.page.evaluate(() => document.activeElement?.textContent) === 'Skip to main content'
    && await visitor.page.evaluate(() => document.activeElement.getBoundingClientRect().width > 0));
  await visitor.page.keyboard.press('Enter');
  check('and it moves focus to the main content', await visitor.page.evaluate(() => document.activeElement?.id) === 'main');
  await owner.go('/app');
  await owner.page.keyboard.press('Tab');
  await owner.page.keyboard.press('Enter');
  check('the skip link works in the staff app too', await owner.page.evaluate(() => document.activeElement?.id) === 'main');

  console.log('\nAccessibility and layout, public pages');
  const phonePublic = await newSession({ mobile: true });
  const titles = {};
  for (const [path, label] of [['/', 'home'], ['/sign-in', 'sign in'], ['/sign-up', 'sign up'], ['/request/grace-community', 'public request page'], ['/no-such-page', '404']]) {
    const r = await audit(visitor, path, label);
    titles[label] = r.title;
    await phonePublic.go(path);
    check(`${label} fits on a phone`, !(await phonePublic.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  }
  await phonePublic.go('/');
  check('on a phone the header keeps just "Staff sign in"', (await phonePublic.page.$$eval('header a', (as) => as.filter((a) => a.offsetParent !== null).map((a) => a.textContent.trim()))).join('|') === 'MERCYMAP|Staff sign in');
  check('the 404 page says so', /Page not found/.test(await visitor.text()));

  console.log('\nAccessibility and layout, staff pages');
  const phone = await newSession({ mobile: true });
  await signIn(phone, 'owner@grace.test');
  const staffPages = [['/app', 'overview'], ['/app/requests', 'requests'], [`/app/requests/${refs.E.id}`, 'request detail'], [`/app/requests/${refs.J.id}`, 'approved request'],
    ['/app/requests/new', 'record a request'], ['/app/resources', 'resources'], ['/app/volunteers', 'volunteers'], ['/app/volunteers/new', 'add volunteer'],
    ['/app/notifications', 'notifications'], ['/app/reports', 'reports'], ['/app/settings', 'settings']];
  for (const [path, label] of staffPages) {
    const r = await audit(owner, path, label);
    titles[label] = r.title;
    await phone.go(path);
    check(`${label} fits on a phone`, !(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  }
  const allTitles = Object.values(titles);
  check('every page has its own title ending in MERCYMAP', allTitles.every((x) => /MERCYMAP/.test(x))
    && new Set(Object.entries(titles).filter(([k]) => !['request detail', 'approved request'].includes(k)).map(([, v]) => v)).size === allTitles.length - 2, JSON.stringify(titles));

  console.log('\nEmpty states');
  for (const [path, words] of [['/app/volunteers', /There are no volunteers yet/], ['/app/notifications', /No notifications yet|caught up/]]) {
    await faith.go(path);
    check(`${path} explains an empty list`, words.test(await faith.text()));
  }
  await faith.go('/app/requests');
  check('/app/requests explains an empty list', /No open requests/.test(await faith.text()));
  await faith.go('/app/resources');
  check('/app/resources explains an empty list', /There are no active resources yet/.test(await faith.text()));

  console.log('\nPending invitation on "Register your church"');
  const invited = await newSession();
  await invited.go('/sign-up');
  await invited.fill('[name="email"]', 'helper@grace.test');
  await invited.fill('[name="password"]', PASSWORD);
  await invited.fill('[name="confirmPassword"]', PASSWORD);
  await invited.press('Create account');
  await invited.go(`/auth/confirm?token_hash=${await userId('helper@grace.test')}&type=signup`);
  await mock.pool.query(`insert into public.invitations (church_id, email, role, token_hash, invited_by, expires_at)
    values ($1, 'helper@grace.test', 'coordinator', $2, $3, now() + interval '7 days')`, [grace, 'e'.repeat(64), await userId('owner@grace.test')]);
  await invited.go('/onboarding');
  t = await invited.text();
  check('the invitation is shown before the registration form', /You have been invited to join Grace Community Church/.test(t)
    && /Grace Community Church as a coordinator, until/.test(t) && /open the invitation link you were sent/.test(t));
  check('the invitation token is not on the page', !(await invited.page.content()).includes('e'.repeat(64)));
  await faith.go('/app');
  const stranger = await newSession();
  await stranger.go('/sign-up');
  await stranger.fill('[name="email"]', 'stranger@other.test');
  await stranger.fill('[name="password"]', PASSWORD);
  await stranger.fill('[name="confirmPassword"]', PASSWORD);
  await stranger.press('Create account');
  await stranger.go(`/auth/confirm?token_hash=${await userId('stranger@other.test')}&type=signup`);
  await stranger.go('/onboarding');
  check('someone without an invitation sees only the form', !(await stranger.page.$('[data-pending-invitations]')) && /Register church/.test(await stranger.text()));
  await audit(invited, '/onboarding', 'register your church');

  console.log('\nPlatform administrator and their own church');
  await mock.pool.query('insert into public.platform_admins (user_id) values ($1)', [await userId('owner@faith.test')]);
  await faith.go('/platform');
  const cards = await faith.page.$$eval('main .space-y-3', (els) => els.map((el) => ({ text: el.innerText, buttons: [...el.querySelectorAll('button')].map((b) => b.innerText.trim()) })));
  const own = cards.find((c) => c.text.includes('Living Faith Church'));
  const other = cards.find((c) => c.text.includes('Grace Community Church'));
  check('their own church shows why there is no button', own && own.buttons.length === 0 && /You belong to this church, so another platform administrator must review it/.test(own.text), JSON.stringify(own));
  check('other churches can still be reviewed', other && other.buttons.includes('Suspend'), JSON.stringify(other));
  await audit(faith, '/platform', 'platform');

  if (axeIssues.length) console.log(`\n  axe notes (all impacts):\n   - ${axeIssues.join('\n   - ')}`);
  if (process.env.E2E_SCREENSHOTS) {
    await visitor.go('/');
    await visitor.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/landing.png`, fullPage: true });
    await phonePublic.go('/');
    await phonePublic.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/landing-mobile.png`, fullPage: true });
    await invited.go('/onboarding');
    await invited.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/onboarding-invited.png`, fullPage: true });
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
