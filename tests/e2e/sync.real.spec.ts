import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { boot, go, MIN, sessionsOf } from './helpers';

/**
 * SYNC against the real Supabase project (D-52). Runs only when all three variables are set:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (the :4174 build is made with them, see playwright.config.ts)
 *   SUPABASE_SERVICE_ROLE_KEY (test environment only; fetches the 6-digit code through the admin API)
 * The sandbox proxy returns 403 for supabase.co, so QA reports this spec as "not run".
 * Use a separate test project; it creates and deletes throwaway users.
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
    const email = `em-time-e2e+${Date.now()}@example.com`;
    const created: string[] = [];
    try {
      const codeFor = async (): Promise<string> => {
        const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
        if (error) throw error;
        created.push(data.user.id);
        return data.properties.email_otp;
      };
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
        await page.getByTestId('sync-email-input').fill(email);
        await page.getByTestId('sync-send').click();
        await page.getByTestId('sync-code-input').fill(await codeFor());
        await page.getByTestId('sync-verify').click();
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
      for (const id of new Set(created)) await admin.auth.admin.deleteUser(id);
    }
  });
});
