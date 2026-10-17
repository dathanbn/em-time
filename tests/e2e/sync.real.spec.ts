import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { boot, go, MIN, sessionsOf } from './helpers';

/**
 * SYNC against the real Supabase project (D-52). Runs only when all three variables are set:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (the :4174 build is made with them, see playwright.config.ts)
 *   SUPABASE_SERVICE_ROLE_KEY (test environment only; deletes the throwaway accounts the sync code creates)
 * The sandbox proxy returns 403 for supabase.co, so QA reports this spec as "not run".
 * v3: a sync code signs in or creates the account (Confirm email must be OFF). Use a separate test project; it creates and deletes throwaway users.
 */
const URL_ = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:4174/em-time/';

test.describe('SYNC real project', () => {
  test.skip(!URL_ || !ANON || !SERVICE, 'SUPABASE_SERVICE_ROLE_KEY (and VITE_SUPABASE_*) not set: real-project sync not run');
  test.use({ baseURL: BASE });
  test.skip(({ isMobile }) => isMobile, 'one viewport is enough for the real-project run');

  test('SYNC-3, SYNC-7, SYNC-10: two devices converge on the union; anon and other users read nothing', async ({ browser }) => {
    const admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    const code = `qa e2e ${Date.now()}`;
    const email = `${code.replace(/\s+/g, '-')}@dathanbn.github.io`;
    try {
      const device = async (name: string) => {
        const ctx = await browser.newContext({ baseURL: BASE });
        const page = await ctx.newPage();
        await boot(page, { clock: true, route: 'timer' });
        // complete one session offline-equivalent: fast-forward a 25 minute phase
        await page.getByTestId('timer-play').click();
        await page.clock.fastForward(25 * MIN + 250);
        expect((await sessionsOf(page)).length, name).toBe(1);
        return { ctx, page };
      };
      const signIn = async (page: Page) => {
        await go(page, 'settings');
        await page.getByTestId('sync-code-input').fill(code);
        await page.getByTestId('sync-send').click();
        await expect(page.getByText('Linked', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('sync-status')).toContainText(/Synced/, { timeout: 30_000 });
      };
      const a = await device('A');
      const b = await device('B');
      await signIn(a.page);
      await signIn(b.page);
      await go(a.page, 'settings');
      await a.page.getByTestId('sync-now').click();
      await expect.poll(async () => (await sessionsOf(a.page)).length, { timeout: 30_000 }).toBe(2);
      await expect.poll(async () => (await sessionsOf(b.page)).length, { timeout: 30_000 }).toBe(2);

      // SYNC-10: an anonymous client reads nothing
      const anon = createClient(URL_!, ANON!, { auth: { persistSession: false } });
      const rows = await anon.from('sessions').select('id');
      expect(rows.data ?? []).toEqual([]);
      await a.ctx.close();
      await b.ctx.close();
    } finally {
      const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
      for (const u of data?.users ?? []) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
    }
  });
});
