// End-to-end journey for Milestone 2 against the mock Supabase API and a real
// local PostgreSQL. Run with: npm run test:e2e
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

async function newSession() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => browserErrors.push(e.message));
  const s = {
    page,
    go: (path) => page.goto(BASE + path, { waitUntil: 'networkidle0' }),
    text: () => page.evaluate(() => document.body.innerText),
    path: () => new URL(page.url()).pathname,
    fill: async (name, value) => {
      await page.$eval(`[name="${name}"]`, (el) => { el.value = ''; });
      await page.type(`[name="${name}"]`, value);
    },
    // Clicks the first button with this exact label and waits for the result.
    press: async (label) => {
      const handle = await page.evaluateHandle((l) =>
        [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === l), label);
      if (!handle.asElement()) throw new Error(`button not found: ${label}`);
      await Promise.all([
        page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {}),
        handle.asElement().click(),
      ]);
      await new Promise((r) => setTimeout(r, 300));
    },
    close: () => context.close(),
  };
  return s;
}

const PASSWORD = 'harvest2026x';
const userId = async (email) =>
  (await mock.pool.query('select id from auth.users where email = $1', [email])).rows[0]?.id;

async function signUp(s, email, next = '') {
  await s.go(`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await s.fill('email', email);
  await s.fill('password', PASSWORD);
  await s.fill('confirmPassword', PASSWORD);
  await s.press('Create account');
}
async function signIn(s, email, password = PASSWORD) {
  await s.go('/sign-in');
  await s.fill('email', email);
  await s.fill('password', password);
  await s.press('Sign in');
}
const confirmEmail = async (s, email) => s.go(`/auth/confirm?token_hash=${await userId(email)}&type=signup`);

try {
  // ------------------------------------------------------------------
  console.log('\nSign-up, confirmation and sign-in');
  const owner = await newSession();
  await signUp(owner, 'owner@grace.test');
  check('sign-up leads to "check your email"', owner.path() === '/check-email' && /owner@grace\.test/.test(await owner.text()));
  check('a confirmation email was requested', mock.mailbox.some((m) => m.type === 'signup' && m.email === 'owner@grace.test'));
  await owner.press('Send the email again');
  check('resend gives a neutral answer', /new email is on its way/.test(await owner.text()));

  await signIn(owner, 'owner@grace.test');
  check('cannot sign in before confirming', owner.path() === '/sign-in' && /Confirm your email address/.test(await owner.text()));
  await signIn(owner, 'owner@grace.test', 'wrong-password-1');
  check('wrong password gives a generic message', /do not match/.test(await owner.text()));
  await signIn(owner, 'nobody@grace.test');
  check('unknown email gives the same generic message', /do not match/.test(await owner.text()));

  await owner.go('/auth/confirm?token_hash=00000000-0000-0000-0000-000000000000&type=signup');
  check('a bad confirmation link is refused', owner.path() === '/sign-in' && /expired or was already used/.test(await owner.text()));

  await confirmEmail(owner, 'owner@grace.test');
  check('confirming signs in and sends a new user to onboarding', owner.path() === '/onboarding');

  // ------------------------------------------------------------------
  console.log('\nChurch registration');
  await owner.press('Register church');
  check('empty form shows field errors', /Enter your church's name/.test(await owner.text()));
  await owner.fill('name', 'Grace Community Church');
  const slug = await owner.page.$eval('[name="slug"]', (el) => el.value);
  check('link name is suggested from the church name', slug === 'grace-community-church', slug);
  await owner.fill('slug', 'grace-community');
  await owner.fill('area', 'Akure');
  await owner.press('Register church');
  let t = await owner.text();
  check('registration lands in the workspace', owner.path() === '/app' && /Welcome to Grace Community Church/.test(t));
  check('new church is shown as awaiting verification', /awaiting verification/i.test(t));
  await owner.go('/onboarding');
  check('a member cannot reach onboarding again', owner.path() === '/app');

  // A second church, to prove separation in the interface.
  const faith = await newSession();
  await signUp(faith, 'owner@faith.test');
  await confirmEmail(faith, 'owner@faith.test');
  await faith.fill('name', 'Living Faith Church');
  await faith.fill('slug', 'grace-community');
  await faith.press('Register church');
  check('a taken link name is reported on the field', faith.path() === '/onboarding' && /already taken/.test(await faith.text()));
  check('the church name is kept after the error', (await faith.page.$eval('[name="name"]', (el) => el.value)) === 'Living Faith Church');
  await faith.fill('slug', 'living-faith');
  await faith.press('Register church');
  check('second church registers', faith.path() === '/app' && /Living Faith Church/.test(await faith.text()));

  // ------------------------------------------------------------------
  console.log('\nInvitations');
  await owner.go('/app/settings/staff');
  t = await owner.text();
  check('staff page lists the owner', /owner@grace\.test \(you\)/.test(t) && /Owner/.test(t));
  check('staff page shows nothing of the other church', !/faith\.test/.test(t));

  await owner.fill('email', 'owner@grace.test');
  await owner.press('Create invitation');
  check('cannot invite an existing member', /already a member/.test(await owner.text()));
  await owner.fill('email', 'not-an-email');
  await owner.press('Create invitation');
  check('invalid invite email is rejected', /valid email/.test(await owner.text()));

  await owner.fill('email', 'Coord@Grace.Test');
  await owner.press('Create invitation');
  t = await owner.text();
  const inviteUrl = t.match(/http:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/)?.[0];
  check('invitation link is shown once', Boolean(inviteUrl) && /coord@grace\.test/.test(t));
  const invitePath = new URL(inviteUrl).pathname;
  const stored = await mock.pool.query(`select token_hash from public.invitations where email = 'coord@grace.test'`);
  check('only a hash of the token is stored', stored.rows[0].token_hash.length === 64 && !inviteUrl.includes(stored.rows[0].token_hash));
  await owner.go('/app/settings/staff');
  t = await owner.text();
  check('open invitation is listed without its link', /coord@grace\.test/.test(t) && !/\/invite\//.test(t));
  await owner.fill('email', 'coord@grace.test');
  await owner.press('Create invitation');
  check('a second open invitation to the same address is refused', /already an open invitation/.test(await owner.text()));

  // Invitee: arrives signed out, creates an account, confirms, accepts.
  const coord = await newSession();
  await coord.go(invitePath);
  check('signed-out visitor sees a neutral invitation prompt', /You have been invited/.test(await coord.text()) && !/Grace/.test(await coord.text()));
  await signUp(coord, 'coord@grace.test', invitePath);
  await confirmEmail(coord, 'coord@grace.test');
  check('after confirming, the invitee returns to the invitation', coord.path() === invitePath);
  t = await coord.text();
  check('invitation shows church and role', /Join Grace Community Church/.test(t) && /coordinator/.test(t));

  // Someone else tries the same link.
  await faith.go(invitePath);
  t = await faith.text();
  check('another account sees an email mismatch and no accept button', /different email address/.test(t) && !/Accept invitation/.test(t));

  await coord.press('Accept invitation');
  check('accepting lands in the church workspace', coord.path() === '/app' && /Grace Community Church/.test(await coord.text()));
  await coord.go(invitePath);
  check('a used invitation link no longer works', /not valid/.test(await coord.text()));

  await coord.go('/app/settings/staff');
  t = await coord.text();
  check('coordinator sees colleagues', /owner@grace\.test/.test(t) && /coord@grace\.test \(you\)/.test(t));
  check('coordinator has no invite, role or remove controls',
    !/Invite someone/.test(t) && !/Save role/.test(t) && !/\bRemove\b/.test(t));

  // ------------------------------------------------------------------
  console.log('\nRoles');
  await owner.go('/app/settings/staff');
  const coordMembership = (await mock.pool.query(
    `select m.id from public.church_memberships m join auth.users u on u.id = m.user_id where u.email = 'coord@grace.test'`)).rows[0].id;
  await owner.page.select(`#role-${coordMembership}`, 'admin');
  await owner.press('Save role');
  check('owner promotes a coordinator to administrator', /Role updated/.test(await owner.text()));
  await coord.go('/app/settings/staff');
  t = await coord.text();
  check('new administrator can invite but still cannot change roles', /Invite someone/.test(t) && !/Save role/.test(t));
  const roleOptions = await coord.page.$$eval('select[name="role"] option', (o) => o.map((x) => x.value));
  check('administrator can only invite coordinators', JSON.stringify(roleOptions) === '["coordinator"]', JSON.stringify(roleOptions));
  check('administrator cannot remove the owner', !/\bRemove\b/.test(t));

  // Revoke flow
  await owner.go('/app/settings/staff');
  await owner.fill('email', 'temp@grace.test');
  await owner.press('Create invitation');
  const tempPath = new URL((await owner.text()).match(/http:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/)[0]).pathname;
  await owner.go('/app/settings/staff');
  await owner.press('Revoke');
  check('owner revokes an invitation and it leaves the list', !/temp@grace\.test/.test(await owner.text()) && /No invitations are waiting/.test(await owner.text()));
  const temp = await newSession();
  await signUp(temp, 'temp@grace.test', tempPath);
  await confirmEmail(temp, 'temp@grace.test');
  check('a revoked invitation cannot be used', /not valid/.test(await temp.text()));
  await temp.go('/app');
  check('a user with no church is sent to onboarding', temp.path() === '/onboarding');
  await temp.go('/app/settings/staff');
  check('and cannot open staff settings', temp.path() === '/onboarding');

  await owner.go('/app/settings/staff');
  await owner.press('Remove');
  check('owner removes a member and they leave the list', !/coord@grace\.test/.test(await owner.text()));
  await coord.go('/app');
  check('the removed member loses access at once', coord.path() === '/onboarding');

  // ------------------------------------------------------------------
  console.log('\nPlatform verification');
  await owner.go('/platform');
  check('church staff get "not found" on the platform page', /Page not found/.test(await owner.text()));
  const admin = await newSession();
  await signUp(admin, 'platform@mercymap.test');
  await confirmEmail(admin, 'platform@mercymap.test');
  await mock.pool.query('insert into public.platform_admins (user_id) values ($1)', [await userId('platform@mercymap.test')]);
  await admin.go('/platform');
  t = await admin.text();
  check('platform administrator sees registered churches', /Grace Community Church/.test(t) && /Living Faith Church/.test(t) && /owner@grace\.test/.test(t));
  await admin.press('Verify');
  check('verification shows a verified badge', /✓ Verified/.test(await admin.text()));
  const statuses = (await mock.pool.query('select status from public.churches order by status')).rows.map((r) => r.status);
  check('exactly one church is verified', JSON.stringify(statuses) === '["pending","verified"]', JSON.stringify(statuses));
  const verifiedName = (await mock.pool.query(`select name from public.churches where status = 'verified'`)).rows[0].name;
  const verifiedSession = verifiedName.startsWith('Grace') ? owner : faith;
  await verifiedSession.go('/app');
  check('the verified church sees its new status', /Your church is verified/.test(await verifiedSession.text()));

  // ------------------------------------------------------------------
  console.log('\nSign-out and password reset');
  await owner.go('/app');
  await owner.press('Sign out');
  check('sign-out returns to sign in', owner.path() === '/sign-in' && /signed out/.test(await owner.text()));
  await owner.go('/app');
  check('workspace is closed after sign-out', owner.path() === '/sign-in');
  check('the original destination is remembered', owner.page.url().includes('next=%2Fapp'));

  await owner.go('/forgot-password');
  await owner.fill('email', 'owner@grace.test');
  await owner.press('Send reset link');
  check('reset request gives a neutral answer', /If an account exists/.test(await owner.text()));
  check('a recovery email was requested', mock.mailbox.some((m) => m.type === 'recovery' && m.email === 'owner@grace.test'));
  await owner.go(`/auth/confirm?token_hash=${await userId('owner@grace.test')}&type=recovery&next=/update-password`);
  check('recovery link opens the new-password page', owner.path() === '/update-password');
  await owner.fill('password', 'short');
  await owner.fill('confirmPassword', 'short');
  await owner.press('Save new password');
  check('weak new password is rejected', /at least 10 characters/i.test(await owner.text()));
  await owner.fill('password', 'newharvest2027y');
  await owner.fill('confirmPassword', 'newharvest2027y');
  await owner.press('Save new password');
  check('new password is saved', owner.path() === '/app');
  await owner.press('Sign out');
  await signIn(owner, 'owner@grace.test');
  check('old password no longer works', owner.path() === '/sign-in');
  await signIn(owner, 'owner@grace.test', 'newharvest2027y');
  check('new password works', owner.path() === '/app');

  await owner.go('/sign-in?next=https://evil.example');
  check('signed-in user is not redirected off-site', new URL(owner.page.url()).origin === new URL(BASE).origin && owner.path() === '/app');

  // Mobile layout check and screenshots for the report.
  await owner.page.setViewport({ width: 390, height: 844 });
  await owner.go('/app/settings/staff');
  const overflow = await owner.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('staff page has no sideways scroll on a phone', !overflow);
  if (process.env.E2E_SCREENSHOTS) {
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/staff-mobile.png`, fullPage: true });
    await owner.page.setViewport({ width: 1280, height: 900 });
    await owner.go('/app/settings/staff');
    await owner.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/staff-desktop.png`, fullPage: true });
    await admin.go('/platform');
    await admin.page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/platform.png`, fullPage: true });
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
