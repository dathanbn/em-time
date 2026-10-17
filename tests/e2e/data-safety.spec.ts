import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MIN, NOW, boot, fixture, fixtureText, go, stored } from './helpers';

const banner = (page: Page) => page.getByTestId('banner');

async function readDownload(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
}

test.describe('DAT-1 writes', () => {
  test('DAT-1 a change is in localStorage before the UI confirms it (same task as the click)', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    const input = page.getByTestId('task-add-input');
    await input.fill('Written synchronously');
    // click and read storage in one synchronous page task: no await between them
    const seen = await page.evaluate(() => {
      (document.querySelector('[data-testid="task-add-button"]') as HTMLElement).click();
      const doc = JSON.parse(localStorage.getItem('em-time:data') || 'null');
      return doc ? doc.tasks.map((t: any) => t.name) : null;
    });
    expect(seen).toContain('Written synchronously');
  });

  test('DAT-1 ticking does not write; start and a finished session do', async ({ page }) => {
    await boot(page, {
      clock: true,
      stubs: true,
      init: `(() => { const n = (window.__writes = []); const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) { if (k === 'em-time:data') n.push(Date.now()); return orig.call(this, k, v); }; })();`,
    });
    const writes = () => page.evaluate(() => (window as any).__writes.length as number);
    await page.getByTestId('timer-play').click();
    const afterStart = await writes();
    expect(afterStart).toBeGreaterThan(0);
    // ten seconds of display updates (rAF + title) write nothing
    await page.clock.runFor(10_000);
    expect(await writes()).toBe(afterStart);
    await page.clock.fastForward(25 * MIN);
    await expect.poll(writes).toBeGreaterThan(afterStart);
    expect((await stored(page)).sessions).toHaveLength(1);
  });
});

test.describe('DAT-4 export reminder', () => {
  const reminder = (page: Page) => page.getByTestId('banner').filter({ hasText: /Export a backup|since your last backup/ });
  const seedWith = (patch: (d: any) => void) => {
    const d = fixture('backup-valid.json');
    patch(d);
    return d;
  };

  test('DAT-4 10+ sessions and no export ever: a quiet banner on Stats and Settings, never on Timer or Tasks', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    await expect(reminder(page)).toContainText('Your history is saved on this device only. Export a backup so it can never get lost.');
    await go(page, 'settings');
    await expect(reminder(page)).toHaveCount(1);
    await go(page, 'timer');
    await expect(reminder(page)).toHaveCount(0);
    await go(page, 'tasks');
    await expect(reminder(page)).toHaveCount(0);
  });

  test('DAT-4 fewer than 10 sessions: no reminder', async ({ page }) => {
    await boot(page, { seed: seedWith((d) => (d.sessions = d.sessions.slice(-9))), clock: true, route: 'stats' });
    await expect(reminder(page)).toHaveCount(0);
    await go(page, 'settings');
    await expect(reminder(page)).toHaveCount(0);
  });

  test('DAT-4 Export from the banner downloads the file and removes the banner; "Later" snoozes for 7 days', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    await reminder(page).getByRole('button', { name: 'Later' }).click();
    await expect(reminder(page)).toHaveCount(0);
    const until = (await stored(page)).meta.exportReminderSnoozedUntil as number;
    expect(Math.abs(until - (NOW.getTime() + 7 * 24 * 60 * MIN))).toBeLessThan(5 * MIN);
    await page.reload();
    await expect(reminder(page)).toHaveCount(0);
    // after the snooze runs out it returns
    const d = await stored(page);
    d.meta.exportReminderSnoozedUntil = NOW.getTime() - 1;
    await page.evaluate((t) => localStorage.setItem('em-time:data', t), JSON.stringify(d));
    await page.reload();
    await expect(reminder(page)).toHaveCount(1);
    const { name } = await readDownload(page, () => reminder(page).getByRole('button', { name: 'Export' }).click());
    expect(name).toMatch(/^em-time-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(reminder(page)).toHaveCount(0);
  });

  test('DAT-4 after an export: quiet for 14 days, then only when sessions were added since', async ({ page }) => {
    const day = 24 * 60 * MIN;
    const lastExport = NOW.getTime() - 15 * day;
    const withNew = seedWith((d) => (d.meta.lastExportAt = lastExport)); // fixture sessions were created after it
    await boot(page, { seed: withNew, clock: true, route: 'stats' });
    await expect(reminder(page)).toContainText("It's been a while since your last backup.");

    const recent = seedWith((d) => (d.meta.lastExportAt = NOW.getTime() - 10 * day));
    await page.evaluate((t) => localStorage.setItem('em-time:data', t), JSON.stringify(recent));
    await page.reload();
    await expect(reminder(page)).toHaveCount(0);

    const nothingNew = seedWith((d) => {
      d.meta.lastExportAt = NOW.getTime() - 20 * day;
      for (const s of d.sessions) s.createdAt = Math.min(s.createdAt, NOW.getTime() - 30 * day);
    });
    await page.evaluate((t) => localStorage.setItem('em-time:data', t), JSON.stringify(nothingNew));
    await page.reload();
    await expect(reminder(page)).toHaveCount(0);
  });

  test('DAT-4 signed in and synced within 7 days: not shown; stale sync: shown', async ({ page }) => {
    const uid = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
    const fresh = seedWith((d) => {
      d.meta.sync.userId = uid;
      d.meta.sync.email = 'a@example.com';
      d.meta.sync.lastSyncedAt = NOW.getTime() - 24 * 60 * MIN;
    });
    await boot(page, { seed: fresh, clock: true, route: 'stats' });
    await expect(reminder(page)).toHaveCount(0);
    const stale = seedWith((d) => {
      d.meta.sync.userId = uid;
      d.meta.sync.email = 'a@example.com';
      d.meta.sync.lastSyncedAt = NOW.getTime() - 8 * 24 * 60 * MIN;
    });
    await page.evaluate((t) => localStorage.setItem('em-time:data', t), JSON.stringify(stale));
    await page.reload();
    await expect(reminder(page)).toHaveCount(1);
  });
});

test.describe('EDGE-6 data loss safety', () => {
  test('corrupt JSON is kept under a backup key, the app starts empty, and the banner offers the damaged data', async ({ page }) => {
    const damaged = '{"app":"em-time","schemaVersion":1,"sessions":[{"id":"x"';
    await boot(page, { rawSeed: damaged, clock: true });
    await expect(banner(page)).toContainText("Saved data couldn't be read, so Em Time started fresh. Your old data is kept as a file you can download.");
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const backupKey = keys.find((k) => k.startsWith('em-time:corrupt:'))!;
    expect(backupKey).toBeTruthy();
    expect(await page.evaluate((k) => localStorage.getItem(k), backupKey)).toBe(damaged);
    // boots empty and usable
    await expect(page.getByTestId('timer-digits').filter({ visible: true }).first()).toHaveText('25:00');
    await go(page, 'tasks');
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    expect((await stored(page)).sessions).toHaveLength(0);
    // the banner is on every screen and its download is the raw bytes
    await expect(banner(page)).toBeVisible();
    const { name, text } = await readDownload(page, () => banner(page).getByRole('button', { name: 'Download' }).click());
    expect(name).toBe('em-time-damaged-data.json');
    expect(text).toBe(damaged);
    await banner(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner(page)).toHaveCount(0);
  });

  test('not-an-Em-Time document in storage is treated the same way', async ({ page }) => {
    await boot(page, { rawSeed: JSON.stringify({ hello: 'world' }), clock: true });
    await expect(banner(page)).toContainText("Saved data couldn't be read");
    expect((await stored(page)).app).toBe('em-time');
  });

  test('storage that rejects writes (quota): a persistent banner offers Export, the app keeps working in memory', async ({ page }) => {
    await boot(page, {
      clock: true,
      init: `(() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) {
        if (k === 'em-time:data' && window.__full) { const e = new DOMException('full', 'QuotaExceededError'); throw e; }
        return orig.call(this, k, v); }; })();`,
      route: 'tasks',
    });
    await page.evaluate(() => ((window as any).__full = true));
    await page.getByTestId('task-add-input').fill('Still works');
    await page.getByTestId('task-add-button').click();
    await expect(page.getByTestId('task-row')).toHaveCount(1);
    await expect(banner(page)).toContainText("Em Time can't save on this device right now. Export to keep a copy.");
    await go(page, 'timer');
    await expect(banner(page)).toBeVisible(); // persistent, on every screen
    const { text } = await readDownload(page, () => banner(page).getByRole('button', { name: 'Export' }).click());
    expect(JSON.parse(text).tasks.map((t: any) => t.name)).toContain('Still works');
  });

  test('storage that is blocked entirely: the app boots, shows the banner after a change, and offers Export', async ({ page }) => {
    await boot(page, {
      clock: true,
      init: `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });`,
      route: 'tasks',
    });
    await expect(page.getByTestId('task-add-input')).toBeVisible();
    await page.getByTestId('task-add-input').fill('In memory');
    await page.getByTestId('task-add-button').click();
    await expect(page.getByTestId('task-row')).toHaveCount(1);
    await expect(banner(page)).toContainText("Em Time can't save on this device right now.");
    await go(page, 'timer');
    await page.getByTestId('timer-play').click();
    await expect(page.getByTestId('timer-play')).toHaveAttribute('aria-label', /Pause/);
  });

  test('data from a newer version is read-only, never overwritten, and the banner says to refresh', async ({ page }) => {
    const raw = fixtureText('backup-newer.json');
    await boot(page, { rawSeed: raw, clock: true, route: 'tasks' });
    await expect(banner(page)).toContainText('This data is from a newer version of Em Time. Refresh to update.');
    await expect(banner(page).getByRole('button', { name: 'Refresh' })).toBeVisible();
    await page.getByTestId('task-add-input').fill('Not saved');
    await page.getByTestId('task-add-button').click();
    expect(await page.evaluate(() => localStorage.getItem('em-time:data'))).toBe(raw);
  });

  test('pagehide flushes: the latest state is in storage when the page is hidden', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    await page.getByTestId('task-add-input').fill('Before leaving');
    await page.getByTestId('task-add-button').click();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect((await stored(page)).tasks.map((t: any) => t.name)).toContain('Before leaving');
  });
});

test.describe('EDGE-9 deleted references', () => {
  test('a deleted task renders as "(deleted)" with a neutral swatch; its sessions are untouched', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const row = page.getByTestId('task-totals').locator('.tbar', { hasText: 'Old essay outline (deleted)' });
    await expect(row).toHaveCount(1);
    const neutral = await page.evaluate(() => {
      const el = document.createElement('i');
      el.style.background = 'var(--em-axis)';
      document.body.appendChild(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    });
    await expect(row.locator('.tbar__bar')).toHaveCSS('background-color', neutral);
    // and the table view carries the same label (EDGE-10: full name in the table)
    await page.getByRole('button', { name: 'Show as table' }).first().click();
    await expect(page.getByTestId('task-table')).toContainText('Old essay outline (deleted)');
  });
});

test.describe('EDGE-7 multiple tabs (storage event)', () => {
  test('a task added in one tab shows in another without a reload', async ({ page, context }) => {
    await boot(page, { route: 'tasks' });
    const other = await context.newPage();
    await other.goto('?e2e#/tasks');
    await expect(other.getByTestId('task-add-input')).toBeVisible();
    await page.getByTestId('task-add-input').fill('Shared across tabs');
    await page.getByTestId('task-add-button').click();
    await expect(other.getByTestId('task-row')).toHaveCount(1);
    await expect(other.getByTestId('task-row')).toContainText('Shared across tabs');
  });
});
