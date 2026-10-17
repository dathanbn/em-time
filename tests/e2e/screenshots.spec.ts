import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { MIN, atTime, boot, docWithSessions, emptyDoc, go, v2doc } from './helpers';

/**
 * Visual evidence for the QA report (v2 "Sky diary"), saved to tests/screenshots/v2/{screen}-{state}-{width}-{keyframe}.png,
 * width = 1280 desktop or 390 phone. The v1 set lives in tests/screenshots/v1/.
 *
 * The clock: `page.clock.install` hangs screenshots with the v2 animations, so the page's Date is shifted by an offset
 * before the app loads (time still flows, and `window.__qaShift(ms)` moves it forward to finish a session). Stickers are seeded
 * (`?e2e&seed=1`). Animations are disabled except for the burst, which is captured live 300 ms after the session ends.
 * The checks here are sanity only (no horizontal scroll, the screen rendered); the review is by eye.
 */
const OUT = resolve(import.meta.dirname, '../screenshots/v2');
mkdirSync(OUT, { recursive: true });

const KEYFRAMES: Array<[string, string]> = [['06:00', 'dawn'], ['12:30', 'midday'], ['18:30', 'dusk'], ['23:00', 'night']];
const ID_AT: Record<string, string> = { '02:00': 'latenight', '02:30': 'latenight', '06:00': 'dawn', '12:30': 'midday', '18:30': 'dusk', '23:00': 'night' };

/** Shifts Date by a constant so "now" is `at` and keeps flowing; `__qaShift(ms)` jumps forward. */
const shiftedClock = (at: Date) => `
(() => {
  const R = Date;
  let off = ${at.getTime()} - R.now();
  const P = new Proxy(R, {
    construct(t, a, nt) { return a.length ? Reflect.construct(t, a, nt) : Reflect.construct(t, [R.now() + off], nt); },
    apply() { return new R(R.now() + off).toString(); },
    get(t, k) { return k === 'now' ? () => R.now() + off : Reflect.get(t, k); },
  });
  window.Date = P;
  window.__qaShift = (d) => { off += d; };
})();
`;

async function open(page: Page, hhmm: string, seed: object | undefined, route: 'timer' | 'tasks' | 'stats' | 'settings' = 'timer', extra: { calm?: boolean; stubs?: boolean } = {}) {
  await page.addInitScript(shiftedClock(atTime(hhmm)));
  await boot(page, { seed, route, rng: 1, calm: extra.calm ?? true, stubs: extra.stubs });
  await page.evaluate(() => document.fonts.ready);
}

/** Moves the page's clock forward and wakes the engine the way a returning tab would (it sleeps on one long timeout). */
const shift = (page: Page, ms: number) =>
  page.evaluate((d) => {
    (window as any).__qaShift(d);
    window.dispatchEvent(new Event('focus'));
  }, ms);

async function shot(page: Page, name: string, hhmm: string, opts: { fullPage?: boolean; live?: boolean; label?: string } = {}): Promise<void> {
  const width = page.viewportSize()!.width;
  const key = opts.label ?? ID_AT[hhmm] ?? hhmm.replace(':', '');
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} ${width} ${key}: horizontal scroll`).toBeLessThanOrEqual(0);
  const original = page.viewportSize()!;
  const full = opts.fullPage ?? true;
  if (full) {
    // fullPage capture would paint the fixed nav mid-page and stretch the fixed scene; grow the viewport instead
    // a route change may not have laid out yet: wait until the height stops changing
    let h = 0;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(150);
      const next = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, window.innerHeight));
      if (next === h && i > 1) break;
      h = next;
    }
    await page.setViewportSize({ width: original.width, height: Math.min(h, 4000) });
    await page.waitForTimeout(450); // charts re-measure, the sky re-lays out
  }
  await page.screenshot({ path: `${OUT}/${name}-${width}-${key}.png`, animations: opts.live ? 'allow' : 'disabled' });
  if (full) await page.setViewportSize(original);
}

/** The Timer state the brief asks for: a current task, 3 sessions today, a 6-day streak. */
const timerDoc = (settings: Record<string, unknown> = {}) => {
  const d = docWithSessions(
    [['2026-10-09', 1], ['2026-10-10', 1], ['2026-10-11', 1], ['2026-10-12', 1], ['2026-10-13', 1], ['2026-10-14', 3]],
    settings,
  );
  d.meta.currentTaskId = d.tasks.find((t: any) => !t.deletedAt && !t.done).id;
  return d;
};

// ------------------------------------------------------------------------------------------------ the four keyframes

for (const [time, id] of KEYFRAMES) {
  test.describe(`screenshots at ${time} (${id})`, () => {
    test(`Timer running with a task, 3 sessions today, a 6-day streak, and Stats seeded (${id})`, async ({ page }) => {
      await open(page, time, timerDoc(), 'timer');
      await page.getByTestId('timer-play').click();
      await shift(page, 7 * MIN + 250);
      await page.waitForTimeout(1300); // a tick
      await expect(page.getByTestId('timer-digits').filter({ visible: true }).first()).not.toHaveText('25:00');
      await shot(page, 'timer-running', time);

      await go(page, 'stats');
      await expect(page.getByTestId('heatmap')).toBeVisible();
      await shot(page, 'stats', time);
    });

    test(`Stats seeded with backup-valid.json (${id})`, async ({ page }) => {
      await open(page, time, v2doc(), 'stats');
      await expect(page.getByTestId('heatmap')).toBeVisible();
      await shot(page, 'stats-fixture', time);
    });
  });
}

// ------------------------------------------------------------------------------------------------ Timer states, Tasks, Settings, empties

for (const [time, id] of [['12:30', 'midday'], ['23:00', 'night']] as const) {
  test.describe(`state screenshots at ${time} (${id})`, () => {
    test(`Timer idle, break with prompt, celebrate, Tasks, Settings (${id})`, async ({ page }) => {
      await open(page, time, timerDoc(), 'timer');
      await shot(page, 'timer-idle', time);

      await page.getByTestId('timer-play').click();
      await shift(page, 25 * MIN + 250);
      // the burst and the celebrate face, captured live 300 ms after completion
      await expect(page.getByTestId('mascot')).toHaveAttribute('data-state', 'celebrate');
      await page.waitForTimeout(300);
      await shot(page, 'timer-celebrate', time, { fullPage: false, live: true });
      await expect(page.getByTestId('break-prompt')).toBeVisible();
      await page.waitForTimeout(1800);
      await shot(page, 'timer-break', time);

      await go(page, 'tasks');
      await shot(page, 'tasks', time);
      await go(page, 'settings');
      await shot(page, 'settings', time);
    });

    test(`first-run empty states and the first-open wave (${id})`, async ({ page }) => {
      await open(page, time, emptyDoc(), 'timer', { calm: false });
      await expect(page.getByTestId('mascot')).toHaveAttribute('data-state', 'wave');
      await shot(page, 'timer-wave', time, { fullPage: false, live: true });
      await page.waitForTimeout(2200);
      await shot(page, 'timer-empty', time);
      await go(page, 'tasks');
      await shot(page, 'tasks-empty', time);
      await go(page, 'stats');
      await shot(page, 'stats-empty', time);
    });

    test(`the task picker and the discard dialog (${id})`, async ({ page }) => {
      await open(page, time, timerDoc(), 'timer');
      await page.getByTestId('current-task').filter({ visible: true }).first().click();
      const picker = page.getByRole('dialog', { name: 'Pick a task' });
      await expect(picker).toBeVisible();
      await page.waitForTimeout(500); // sheet transition
      await shot(page, 'picker', time, { fullPage: false });
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);

      await page.getByTestId('timer-play').click();
      await shift(page, 5 * MIN);
      await page.getByTestId('mode-short').click();
      await expect(page.getByRole('dialog', { name: 'Discard this session?' })).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, 'dialog-discard', time, { fullPage: false });
    });

    test(`the 10th-session milestone: sticker burst, then the stickers-off confetti (${id})`, async ({ page }) => {
      const d = v2doc();
      d.meta.currentTaskId = d.tasks.find((t: any) => !t.deletedAt && !t.done).id;
      d.sessions = [...d.sessions].filter((s: any) => !s.deletedAt).sort((a: any, b: any) => a.startedAt - b.startedAt).slice(0, 9);
      d.meta.milestonesShown = [];
      await open(page, time, d, 'timer');
      await page.getByTestId('timer-play').click();
      await shift(page, 25 * MIN + 250);
      await expect(page.getByTestId('message-line')).toContainText('Ten sessions');
      await page.waitForTimeout(300);
      await shot(page, 'milestone', time, { fullPage: false, live: true });
    });

    test(`the milestone with Sky stickers off shows the v1 confetti (${id})`, async ({ page }) => {
      const d = v2doc({ stickers: false });
      d.meta.currentTaskId = d.tasks.find((t: any) => !t.deletedAt && !t.done).id;
      d.sessions = [...d.sessions].filter((s: any) => !s.deletedAt).sort((a: any, b: any) => a.startedAt - b.startedAt).slice(0, 9);
      d.meta.milestonesShown = [];
      await open(page, time, d, 'timer');
      await page.getByTestId('timer-play').click();
      await shift(page, 25 * MIN + 250);
      await expect(page.getByTestId('message-line')).toContainText('Ten sessions');
      await expect(page.locator('.confetti__p').first()).toBeAttached();
      await page.waitForTimeout(300);
      await shot(page, 'milestone-confetti', time, { fullPage: false, live: true });
    });
  });
}

// ------------------------------------------------------------------------------------------------ 02:30, theme modes, decoration off

test.describe('screenshots at 02:30 (latenight)', () => {
  test('Timer idle, Tasks and Settings in the small hours (night greeting, headlamp)', async ({ page }) => {
    await open(page, '02:30', timerDoc(), 'timer');
    await shot(page, 'timer-idle', '02:30');
    await go(page, 'tasks');
    await shot(page, 'tasks', '02:30');
    await go(page, 'settings');
    await shot(page, 'settings', '02:30');
  });
  test('Stats at 02:30', async ({ page }) => {
    await open(page, '02:30', v2doc(), 'stats');
    await expect(page.getByTestId('heatmap')).toBeVisible();
    await shot(page, 'stats-fixture', '02:30');
  });
});

test.describe('theme modes', () => {
  test('Settings with "Always light" at 02:00, and the Timer it gives', async ({ page }) => {
    await open(page, '02:00', timerDoc({ theme: 'light' }), 'settings');
    await expect(page.locator('html')).toHaveAttribute('data-sky-phase', 'midday');
    await shot(page, 'settings-always-light', '02:00');
    await go(page, 'timer');
    await shot(page, 'timer-always-light', '02:00');
  });
  test('Settings with "Always dark" at 12:30, and the Timer it gives', async ({ page }) => {
    await open(page, '12:30', timerDoc({ theme: 'dark' }), 'settings');
    await expect(page.locator('html')).toHaveAttribute('data-sky-phase', 'latenight'); // fix round: Always dark pins 02:30
    await shot(page, 'settings-always-dark', '12:30');
    await go(page, 'timer');
    await shot(page, 'timer-always-dark', '12:30');
  });
  test('Timer with the cloud friend and the stickers off at 12:30', async ({ page }) => {
    await open(page, '12:30', timerDoc({ mascot: false, stickers: false }), 'timer');
    await expect(page.getByTestId('mascot')).toHaveCount(0);
    await shot(page, 'timer-decoration-off', '12:30');
  });
  test('Timer just after the polarity flip, 17:05', async ({ page }) => {
    await open(page, '17:05', timerDoc(), 'timer');
    await shot(page, 'timer-idle', '17:05', { label: 'dusk-edge' });
  });
});

// ------------------------------------------------------------------------------------------------ live captures, dialogs

/** Live: animations running, a couple of seconds of real time, so clouds have drifted and the moon, stars and mascot are in motion. */
for (const [time, id] of [['12:30', 'midday'], ['02:30', 'latenight'], ['23:00', 'night']] as const) {
  test(`live capture of the Timer after 2 s of real time (${id})`, async ({ page }) => {
    await open(page, time, timerDoc(), 'timer');
    await page.waitForTimeout(2000);
    const width = page.viewportSize()!.width;
    await page.screenshot({ path: `${OUT}/live-timer-${width}-${id}.png` });
  });
}

/** Live, after the first drifting sticker has appeared (the first spawn is 20 to 40 s after load, on the real timers). */
for (const [time, id] of [['12:30', 'midday'], ['23:00', 'night']] as const) {
  test(`live capture with a drifting sticker on screen (${id})`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, time, timerDoc(), 'timer');
    await expect(page.getByTestId('sticker').first()).toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const width = page.viewportSize()!.width;
    await page.screenshot({ path: `${OUT}/live-sticker-${width}-${id}.png` });
  });
}

/** The dialogs that open from Settings cards now portal to the body (fix round). */
for (const [time, id] of [['12:30', 'midday'], ['23:00', 'night']] as const) {
  test(`Settings dialogs: import summary and erase (${id})`, async ({ page }) => {
    await open(page, time, v2doc(), 'settings');
    await page.getByTestId('import-input').setInputFiles(resolve(import.meta.dirname, '../fixtures/backup-valid.json'));
    const dlg = page.getByRole('dialog', { name: 'Import this backup' });
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, 'settings-import-dialog', time, { fullPage: false });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
    await page.getByRole('button', { name: 'Erase all data' }).click();
    await expect(page.getByRole('dialog', { name: 'Erase all data?' })).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, 'settings-erase-dialog', time, { fullPage: false });
  });
}

// ------------------------------------------------------------------------------------------------ Sync card

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

test.describe('sync card screenshots', () => {
  test.use({ baseURL: 'http://localhost:4174/em-time/' });

  test('the signed-out Sync card (one Sync code field), then the inline short-code error', async ({ page }) => {
    await open(page, '12:30', v2doc(), 'settings');
    const card = page.getByTestId('sync-card');
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await shot(page, 'sync-signed-out', '12:30');
    await card.getByTestId('sync-code-input').fill('abc');
    await card.getByTestId('sync-send').click();
    await expect(card.getByRole('alert')).toBeVisible();
    await shot(page, 'sync-code-error', '12:30');
  });

  test('the signed-in Sync card, driven by a stored session and a mocked Supabase', async ({ page }) => {
    const d = v2doc();
    const now = atTime('12:30').getTime();
    const user = { id: '0b8e7a3c-5d41-4f6a-9c2e-7a1d3f5b9e10', email: 'qa-code@dathanbn.github.io', aud: 'authenticated', role: 'authenticated' };
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
    d.meta.sync.email = null; // v3: a code account never stores an address
    d.meta.sync.lastUserId = user.id;
    await page.addInitScript(([key, value]) => localStorage.setItem(key as string, value as string), ['em-time:auth', JSON.stringify(session)]);
    await open(page, '12:30', d, 'settings');
    const card = page.getByTestId('sync-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('sync-now')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'sync-signed-in', '12:30');
  });
});
