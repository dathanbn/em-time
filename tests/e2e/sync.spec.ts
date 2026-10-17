import { expect, test } from '@playwright/test';
import { boot, fixture } from './helpers';

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

test.describe('SYNC-1 default build: no Supabase configured', () => {
  test('SYNC-1 Settings has no Sync card, no sign-in field, no auth key, no Supabase request, no sync chunk', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'settings' });
    await expect(page.getByTestId('sync-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sync' })).toHaveCount(0);
    await expect(page.getByText('Sign in to sync across devices.')).toHaveCount(0);
    await expect(page.getByPlaceholder('you@example.com')).toHaveCount(0);
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

  test('SYNC-2 the Sync card renders on Settings while signed out, and supabase-js is not downloaded', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await boot(page, { clock: true, route: 'settings' });
    const card = page.getByTestId('sync-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Sync' })).toBeVisible();
    await expect(card).toContainText('Sign in to sync across devices.');
    await expect(card.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(card.getByTestId('sync-send')).toBeEnabled();
    expect(requests.filter((u) => /\/assets\/(sync-)?dist-[^/]+\.js/.test(u))).toEqual([]);
  });

  test('SYNC-3 an invalid address shows an inline error and sends nothing', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (r) => {
      if (/\/auth\/v1\//.test(r.url())) calls.push(r.url());
    });
    await boot(page, { clock: true, route: 'settings' });
    await page.getByPlaceholder('you@example.com').fill('not-an-email');
    await page.getByTestId('sync-send').click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    expect(calls).toEqual([]);
  });

  test('SYNC-2 local use is unaffected: tasks and stats work signed out', async ({ page }) => {
    await boot(page, { seed: fixture('backup-valid.json'), clock: true, route: 'tasks' });
    await expect(page.getByTestId('task-row').first()).toBeVisible();
  });
});
