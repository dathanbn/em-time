import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MIN, boot, fixture, go } from './helpers';

/**
 * Visual evidence for the QA report: every screen and key state in both themes at both widths,
 * saved to tests/screenshots/<name>-<width>-<theme>.png (width = 1280 desktop or 390 phone).
 * The checks here are sanity only (no horizontal scroll, the screen rendered); the review is by eye.
 */
const OUT = resolve(import.meta.dirname, '../screenshots');
mkdirSync(OUT, { recursive: true });

const withTheme = (theme: 'light' | 'dark') => {
  const d = fixture('backup-valid.json');
  d.settings.theme = theme;
  return d;
};

async function shot(page: Page, name: string, theme: string, fullPage = true): Promise<void> {
  const width = page.viewportSize()!.width;
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} ${width} ${theme}: horizontal scroll`).toBeLessThanOrEqual(0);
  const original = page.viewportSize()!;
  if (fullPage) {
    // fullPage capture would paint the fixed bottom nav mid-page; grow the viewport instead
    const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, window.innerHeight));
    await page.setViewportSize({ width: original.width, height: Math.min(h, 4000) });
    await page.waitForTimeout(350); // charts re-measure
  }
  await page.screenshot({ path: `${OUT}/${name}-${width}-${theme}.png` });
  if (fullPage) await page.setViewportSize(original);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`screenshots ${theme}`, () => {
    test(`timer idle, running, break with prompt, tasks, settings (${theme})`, async ({ page }) => {
      await boot(page, { seed: withTheme(theme), clock: true, route: 'timer' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await shot(page, 'timer-idle', theme);

      await page.getByTestId('timer-play').click();
      await page.clock.fastForward(7 * MIN + 250);
      await shot(page, 'timer-running', theme);

      await page.clock.fastForward(18 * MIN + 250);
      await expect(page.getByTestId('break-prompt')).toBeVisible();
      await shot(page, 'timer-break', theme);

      await go(page, 'tasks');
      await shot(page, 'tasks', theme);
      await go(page, 'settings');
      await shot(page, 'settings', theme);
    });

    test(`stats seeded and stats empty (${theme})`, async ({ page }) => {
      await boot(page, { seed: withTheme(theme), clock: true, route: 'stats' });
      await expect(page.getByTestId('heatmap')).toBeVisible();
      await shot(page, 'stats', theme);
    });

    test(`first run empty states (${theme})`, async ({ page }) => {
      const empty = fixture('backup-valid.json');
      empty.settings.theme = theme;
      await boot(page, { seed: { ...empty, sessions: [], tasks: [] }, clock: true, route: 'stats' });
      await shot(page, 'stats-empty', theme);
      await go(page, 'tasks');
      await shot(page, 'tasks-empty', theme);
      await go(page, 'timer');
      await shot(page, 'timer-empty', theme);
    });
  });
}

/** Extra states: current task, picker sheet, a dialog, the milestone moment, the signed-in Sync card. */
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

for (const theme of ['light', 'dark'] as const) {
  test.describe(`state screenshots ${theme}`, () => {
    const seeded = () => {
      const d = withTheme(theme);
      d.meta.currentTaskId = d.tasks.find((t: any) => !t.deletedAt && !t.done).id;
      return d;
    };

    test(`current task on the timer, the task picker, and the discard dialog (${theme})`, async ({ page }) => {
      await boot(page, { seed: seeded(), clock: true, route: 'timer' });
      await expect(page.getByTestId('current-task').filter({ visible: true }).first()).not.toContainText('Pick a task');
      await shot(page, 'timer-current-task', theme, false);

      await page.getByTestId('current-task').filter({ visible: true }).first().click();
      const picker = page.getByRole('dialog', { name: 'Pick a task' });
      await expect(picker).toBeVisible();
      await page.waitForTimeout(500); // sheet transition
      await shot(page, 'picker', theme, false);
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);

      await page.getByTestId('timer-play').click();
      await page.clock.fastForward(5 * MIN);
      await page.getByTestId('mode-short').click();
      await expect(page.getByRole('dialog', { name: 'Discard this session?' })).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, 'dialog-discard', theme, false);
    });

    test(`the milestone moment: message and confetti right after the 10th session (${theme})`, async ({ page }) => {
      const d = seeded();
      d.sessions = [...d.sessions].filter((s: any) => !s.deletedAt).sort((a: any, b: any) => a.startedAt - b.startedAt).slice(0, 9);
      d.meta.milestonesShown = [];
      await boot(page, { seed: d, clock: true, route: 'timer' });
      await page.getByTestId('timer-play').click();
      await page.clock.fastForward(25 * MIN + 250);
      await expect(page.getByTestId('message-line')).toContainText('Ten sessions');
      await expect(page.locator('.confetti__p').first()).toBeAttached();
      await shot(page, 'milestone', theme, false);
    });

  });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`sync card screenshots ${theme}`, () => {
    test.use({ baseURL: 'http://localhost:4174/em-time/' });

    test(`the signed-in Sync card, driven by a stored session and a mocked Supabase (${theme})`, async ({ page }) => {
      const d = withTheme(theme);
      const now = new Date('2026-10-14T15:00:00-07:00').getTime();
      const user = { id: '0b8e7a3c-5d41-4f6a-9c2e-7a1d3f5b9e10', email: 'em@example.com', aud: 'authenticated', role: 'authenticated' };
      const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp: Math.floor(now / 1000) + 3600 * 24 * 365, role: 'authenticated' })}.sig`;
      const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 31536000, expires_at: Math.floor(now / 1000) + 3600 * 24 * 365, user };
      await page.route('https://qa-fake.example.test/**', (route) => {
        const req = route.request();
        const url = req.url();
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(user) });
        if (url.includes('/auth/v1/token')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(session) });
        if (req.method() === 'GET') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
        return route.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: '' });
      });
      d.meta.sync.userId = user.id;
      d.meta.sync.email = user.email;
      d.meta.sync.lastUserId = user.id;
      await page.addInitScript(
        ([key, value]) => localStorage.setItem(key as string, value as string),
        ['em-time:auth', JSON.stringify(session)],
      );
      await boot(page, { seed: d, clock: true, route: 'settings' });
      const card = page.getByTestId('sync-card');
      await expect(card).toBeVisible();
      await expect(card.getByTestId('sync-now')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await card.scrollIntoViewIfNeeded();
      await shot(page, 'sync-signed-in', theme, true);
    });
  });
}
