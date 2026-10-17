import { expect, test, type Page } from '@playwright/test';
import { boot, fixture, stored } from './helpers';

/**
 * SYNC needs a real Supabase project to be exercised end to end (see sync.real.spec.ts, skipped
 * here). These tests never create an account and never send a sign-in email.
 *   - port 4173 serves the default build (no VITE_SUPABASE_*): nothing sync-related may exist.
 *   - port 4174 serves a second build with fake Supabase env (playwright.config.ts): the Sync card
 *     must render. The fake host is unreachable, so nothing is ever sent anywhere real.
 * The sync algorithm itself (SYNC-3..15, EDGE-11..15) is covered by tests/unit/sync.test.ts against
 * a fake Supabase server.
 */
const SYNC_BASE = 'http://localhost:4174/em-time/';

/** Words of the removed sign-in styles. None may appear in the Sync card (the Confirm email hint is checked on its own). */
const NO_EMAIL = /e-?mail|one-time|\bOTP\b|magic link|verify|6-digit|six-digit|check your inbox|we sent/i;

/**
 * A mocked Supabase auth server for the :4174 build (host qa-fake.example.test). `account`:
 *   new       password grant is rejected (invalid_credentials), sign-up returns a session
 *   existing  password grant returns a session
 *   confirm   password grant is rejected, sign-up returns a user and no session
 */
async function mockSupabase(page: Page, opts: { account: 'new' | 'existing' | 'confirm' }) {
  const calls: Array<{ kind: 'password' | 'signup'; body: { email: string; password: string } }> = [];
  let otp = false;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mk = (email: string) => {
    const user = { id: '0b8e7a3c-5d41-4f6a-9c2e-7a1d3f5b9e10', email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-14T00:00:00Z' };
    const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`;
    return { user, session: { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 31536000, expires_at: exp, user } };
  };
  await page.route('https://qa-fake.example.test/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/\/auth\/v1\/(otp|verify)/.test(url)) {
      otp = true;
      return json(400, { code: 400, msg: 'unexpected' });
    }
    if (url.includes('/auth/v1/token')) {
      const body = req.postDataJSON();
      calls.push({ kind: 'password', body });
      if (opts.account === 'existing') return json(200, mk(body.email).session);
      return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (url.includes('/auth/v1/signup')) {
      const body = req.postDataJSON();
      calls.push({ kind: 'signup', body });
      const m = mk(body.email);
      return json(200, opts.account === 'confirm' ? m.user : { ...m.session, user: m.user });
    }
    if (url.includes('/auth/v1/user')) return json(200, mk('x@emtime.local').user);
    if (req.method() === 'GET') return json(200, []);
    return route.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: '' });
  });
  return { auth: () => calls, sawOtp: () => otp };
}

test.describe('SYNC-1 default build: no Supabase configured', () => {
  test('SYNC-1 Settings has no Sync card, no sign-in field, no auth key, no Supabase request, no sync chunk', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'settings' });
    await expect(page.getByTestId('sync-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sync' })).toHaveCount(0);
    await expect(page.getByText('Link this device to sync across devices.')).toHaveCount(0);
    await expect(page.getByTestId('sync-code-input')).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /auth|supabase|sb-/i.test(k)))).toEqual([]);
    expect(requests.filter((u) => /supabase/i.test(u))).toEqual([]);
    // the lazy sync chunks (engine-*, dist-*) are never fetched when sync is not configured
    expect(requests.filter((u) => /\/assets\/(sync-)?(engine|dist)-[^/]+\.js/.test(u))).toEqual([]);
  });

  test('SYNC-1 a whole focus session makes no request to any Supabase host', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await boot(page, { clock: true, route: 'timer' });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * 60_000 + 250);
    await expect(page.getByTestId('timer-play')).toBeVisible();
    expect(requests.filter((u) => /supabase/i.test(u))).toEqual([]);
  });
});

test.describe('SYNC-2 build with Supabase env set (port 4174)', () => {
  test.use({ baseURL: SYNC_BASE });

  test('SYNC-2 the Sync card renders on Settings while signed out: one Sync code field and Link this device; supabase-js is not downloaded', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await boot(page, { clock: true, route: 'settings' });
    const card = page.getByTestId('sync-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Sync' })).toBeVisible();
    await expect(card).toContainText('Link this device to sync across devices.');
    await expect(card.getByLabel('Sync code')).toBeVisible();
    await expect(card.getByTestId('sync-code-input')).toHaveCount(1);
    await expect(card.getByTestId('sync-send')).toHaveText('Link this device');
    await expect(card.getByTestId('sync-send')).toBeEnabled();
    await expect(card.locator('input')).toHaveCount(1);
    expect(requests.filter((u) => /\/assets\/(sync-)?dist-[^/]+\.js/.test(u))).toEqual([]);
  });

  test('SYNC-3 a short code shows an inline error and sends no request', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (r) => {
      if (/\/auth\/v1\//.test(r.url())) calls.push(r.url());
    });
    await boot(page, { clock: true, route: 'settings' });
    await page.getByTestId('sync-code-input').fill('abc');
    await page.getByTestId('sync-send').click();
    const err = page.getByTestId('sync-card').getByRole('alert');
    await expect(err).toHaveText('Use at least 8 characters.');
    await expect(page.getByTestId('sync-code-input')).toHaveAttribute('aria-invalid', 'true');
    // typing clears it again
    await page.getByTestId('sync-code-input').fill('abcdefgh');
    await expect(err).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  for (const [code, message] of [
    ['her@example.com', 'Use letters, numbers, spaces, dashes, underscores or dots.'],
    ['a'.repeat(65), 'That code is too long. Use up to 64 characters.'],
  ] as const) {
    test(`SYNC-3 "${code.slice(0, 20)}" is rejected inline without a request`, async ({ page }) => {
      const calls: string[] = [];
      page.on('request', (r) => /\/auth\/v1\//.test(r.url()) && calls.push(r.url()));
      await boot(page, { clock: true, route: 'settings' });
      await page.getByTestId('sync-code-input').fill(code);
      await page.getByTestId('sync-code-input').press('Enter');
      await expect(page.getByTestId('sync-card').getByRole('alert')).toHaveText(message);
      expect(calls).toEqual([]);
    });
  }

  test('SYNC-4 a valid new code creates the account, shows Linked with a status line, and Sign out returns to the form; no email or OTP wording anywhere', async ({ page }) => {
    const net = await mockSupabase(page, { account: 'new' });
    await boot(page, { clock: true, route: 'settings' });
    const card = page.getByTestId('sync-card');
    await expect(card).not.toContainText(NO_EMAIL);
    await card.getByTestId('sync-code-input').fill('  Blue Sky   Morning 42 ');
    await card.getByTestId('sync-send').click();
    await expect(card.getByText('Linked', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('sync-status')).toBeVisible();
    await expect(card.getByTestId('sync-now')).toBeVisible();
    await expect(card.getByTestId('sync-code-input')).toHaveCount(0);
    await expect(card).not.toContainText(NO_EMAIL);
    // the requests: sign-in first (rejected), then sign-up, both with the derived pair, never the raw code in a body
    const auth = net.auth();
    expect(auth.map((c) => c.kind)).toEqual(['password', 'signup']);
    for (const c of auth) {
      expect(c.body.email).toBe('blue-sky-morning-42@emtime.local');
      expect(c.body.password).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(c.body)).not.toContain('Blue Sky');
    }
    expect(net.sawOtp()).toBe(false);
    // nothing derived is persisted in AppData
    const doc = JSON.stringify(await stored(page));
    expect(doc).not.toContain('emtime.local');
    expect(doc).not.toContain(auth[0]!.body.password);
    expect((await stored(page)).meta.sync.email ?? null).toBeNull();
    // Sign out: confirm dialog, then the form is back and the stored session is gone
    await card.getByTestId('sync-signout').click();
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(card.getByTestId('sync-code-input')).toBeVisible();
    await expect(card.getByText('Linked', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('em-time:auth'))).toBeNull();
    expect((await stored(page)).meta.sync.userId).toBeNull();
  });

  test('SYNC-4 an existing account signs in with one request (no sign-up)', async ({ page }) => {
    const net = await mockSupabase(page, { account: 'existing' });
    await boot(page, { clock: true, route: 'settings' });
    await page.getByTestId('sync-code-input').fill('already linked code');
    await page.getByTestId('sync-code-input').press('Enter');
    await expect(page.getByTestId('sync-card').getByText('Linked', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(net.auth().map((c) => c.kind)).toEqual(['password']);
  });

  test('SYNC-4 with Confirm email on at Supabase the card explains it and stays signed out', async ({ page }) => {
    await mockSupabase(page, { account: 'confirm' });
    await boot(page, { clock: true, route: 'settings' });
    const card = page.getByTestId('sync-card');
    await card.getByTestId('sync-code-input').fill('needs confirmation');
    await card.getByTestId('sync-send').click();
    await expect(card.getByRole('alert')).toContainText('Confirm email');
    await expect(card.getByText('Linked', { exact: true })).toHaveCount(0);
    expect((await stored(page))?.meta?.sync?.userId ?? null).toBeNull();
  });

  test('SYNC-4 a network failure is reported inline and the code stays in the field', async ({ page }) => {
    await page.route('https://qa-fake.example.test/**', (r) => r.abort('failed'));
    await boot(page, { clock: true, route: 'settings' });
    const card = page.getByTestId('sync-card');
    await card.getByTestId('sync-code-input').fill('offline attempt code');
    await card.getByTestId('sync-send').click();
    await expect(card.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId('sync-code-input')).toHaveValue('offline attempt code');
    await expect(card.getByText('Linked', { exact: true })).toHaveCount(0);
  });

  test('SYNC-4 the sync form is keyboard operable and labelled (A11Y)', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    const input = page.getByTestId('sync-code-input');
    await expect(input).toHaveAccessibleName('Sync code');
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await input.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sync-send')).toBeFocused();
  });

  test('SYNC-2 local use is unaffected: tasks and stats work signed out', async ({ page }) => {
    await boot(page, { seed: fixture('backup-valid.json'), clock: true, route: 'tasks' });
    await expect(page.getByTestId('task-row').first()).toBeVisible();
  });
});
