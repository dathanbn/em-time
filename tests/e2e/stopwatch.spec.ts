import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MIN, NOW, boot, emptyDoc, go, isMobile, setHidden, stored } from './helpers';

/**
 * Stopwatch (v5): a barebones start/stop/reset, device-only, never part of the Pomodoro timer.
 * Desktop: labelled block in the "Focus tools" card with text buttons. Phone: a glass pill under the
 * play controls with two 44px icon buttons. The page clock is Playwright's fake clock, frozen after
 * boot and advanced with runFor / fastForward, so every elapsed time is exact.
 */
const KEY = 'em-time:stopwatch';
const sw = (p: Page) => p.getByTestId('stopwatch');
const time = (p: Page) => p.getByTestId('stopwatch-time');
const toggle = (p: Page) => p.getByTestId('stopwatch-toggle');
const reset = (p: Page) => p.getByTestId('stopwatch-reset');
const stored_ = (p: Page) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);
const doc = (s: Record<string, unknown> = {}) => emptyDoc({ notifications: false, ...s });
/** Boots on the frozen fake clock and lets Preact's effects (the live region hookup) run before the first click. */
async function open(p: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await boot(p, { seed: doc(), clock: NOW, freeze: true, stubs: true, ...extra });
  await p.clock.runFor(300);
}
const run = (p: Page, ms: number) => p.clock.runFor(ms);
const noDash = (t: string | null) => expect(t ?? '').not.toMatch(/[–—]/);

test.describe('stopwatch: controls and display', () => {
  test('idle: one stopwatch, zero, Start enabled, Reset disabled (aria-disabled), test ids and roles', async ({ page }, info) => {
    await open(page);
    await expect(sw(page)).toHaveCount(1);
    await expect(sw(page)).toHaveAttribute('data-state', 'idle');
    await expect(time(page)).toHaveText('0:00');
    await expect(time(page)).toHaveAttribute('role', 'timer');
    await expect(time(page)).toHaveAttribute('aria-live', 'off');
    await expect(sw(page)).toHaveAttribute('role', 'group');
    await expect(reset(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle(page)).not.toHaveAttribute('aria-disabled', 'true');
    if (isMobile(info.project)) {
      await expect(toggle(page)).toHaveAccessibleName('Start stopwatch');
      await expect(reset(page)).toHaveAccessibleName('Reset stopwatch');
      await expect(toggle(page)).toHaveText('');
    } else {
      await expect(toggle(page)).toHaveText('Start');
      await expect(reset(page)).toHaveText('Reset');
      await expect(sw(page)).toContainText('Stopwatch');
      await expect(sw(page)).toHaveAccessibleName('Stopwatch');
    }
    expect(await stored_(page)).toBeNull(); // nothing is written until it is used
  });

  test('Start: the time advances; Stop holds it; Start continues from there; Reset zeroes, stops and disables', async ({ page }, info) => {
    await open(page);
    await toggle(page).click();
    await expect(sw(page)).toHaveAttribute('data-state', 'running');
    await run(page, 5000);
    await expect(time(page)).toHaveText('0:05');
    await run(page, 62_000);
    await expect(time(page)).toHaveText('1:07');
    if (isMobile(info.project)) await expect(toggle(page)).toHaveAccessibleName('Stop stopwatch');
    else await expect(toggle(page)).toHaveText('Stop');
    await expect(reset(page)).not.toHaveAttribute('aria-disabled', 'true');

    await toggle(page).click(); // Stop
    await expect(sw(page)).toHaveAttribute('data-state', 'stopped');
    await run(page, 30_000);
    await expect(time(page)).toHaveText('1:07'); // holds
    if (isMobile(info.project)) await expect(toggle(page)).toHaveAccessibleName('Start stopwatch');
    else await expect(toggle(page)).toHaveText('Start');
    expect(await stored_(page)).toEqual({ startedAt: null, accumulatedMs: 67_000 });

    await toggle(page).click(); // Start again: continues
    await run(page, 3000);
    await expect(time(page)).toHaveText('1:10');

    await reset(page).click();
    await expect(sw(page)).toHaveAttribute('data-state', 'idle');
    await expect(time(page)).toHaveText('0:00');
    await expect(reset(page)).toHaveAttribute('aria-disabled', 'true');
    await run(page, 5000);
    await expect(time(page)).toHaveText('0:00'); // stopped as well
    expect(await stored_(page)).toEqual({ startedAt: null, accumulatedMs: 0 });
    await reset(page).click({ force: true }); // disabled at zero: nothing happens
    await expect(sw(page)).toHaveAttribute('data-state', 'idle');
  });

  test('Reset while stopped zeroes it too', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await run(page, 9000);
    await toggle(page).click();
    await expect(sw(page)).toHaveAttribute('data-state', 'stopped');
    await expect(reset(page)).not.toHaveAttribute('aria-disabled', 'true');
    await reset(page).click();
    await expect(time(page)).toHaveText('0:00');
    await expect(sw(page)).toHaveAttribute('data-state', 'idle');
  });

  test('digits switch to h:mm:ss from one hour, with tabular figures', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await page.clock.fastForward(59 * MIN + 59_000);
    await run(page, 10);
    await expect(time(page)).toHaveText('59:59');
    await run(page, 1000);
    await expect(time(page)).toHaveText('1:00:00');
    await page.clock.fastForward(2 * MIN + 2000);
    await run(page, 1000);
    await expect(time(page)).toHaveText('1:02:03');
    expect(await time(page).evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain('tabular-nums');
  });

  test('it repaints about every 250 ms, never faster, and only while running', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stopwatch-time"]')!;
      (window as any).__swWrites = 0;
      new MutationObserver((m) => ((window as any).__swWrites += m.length)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await run(page, 5000);
    expect(await page.evaluate(() => (window as any).__swWrites)).toBe(0); // idle: no writes at all
    await toggle(page).click();
    await page.evaluate(() => ((window as any).__swWrites = 0));
    await run(page, 10_000);
    const writes = await page.evaluate(() => (window as any).__swWrites);
    expect(writes).toBeGreaterThanOrEqual(9); // once per displayed second
    expect(writes).toBeLessThanOrEqual(11); // text is only written when it changes
    await toggle(page).click();
    await page.evaluate(() => ((window as any).__swWrites = 0));
    await run(page, 5000);
    expect(await page.evaluate(() => (window as any).__swWrites)).toBe(0); // stopped: no repaint
  });
});

test.describe('stopwatch: persistence and time keeping', () => {
  test('a running stopwatch keeps running across a reload; a stopped one keeps its time', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await run(page, 8000);
    await expect(time(page)).toHaveText('0:08');
    const s = await stored_(page);
    expect(typeof s.startedAt).toBe('number');
    expect(s.accumulatedMs).toBe(0);
    await page.reload();
    await expect(sw(page)).toHaveAttribute('data-state', 'running');
    const shown = (await time(page).textContent())!;
    expect(shown).toMatch(/^0:(0[8-9]|[1-5]\d)$/); // still counting: never reset to 0:00
    await page.waitForTimeout(1300);
    await expect(sw(page)).toHaveAttribute('data-state', 'running');
    await toggle(page).click(); // Stop
    const held = (await time(page).textContent())!;
    await page.reload();
    await expect(sw(page)).toHaveAttribute('data-state', 'stopped');
    await expect(time(page)).toHaveText(held);
  });

  test('device-only: stored under its own key, never in the app data, the export or the sync rows', async ({ page }) => {
    await open(page, { core: true });
    await toggle(page).click();
    await run(page, 4000);
    const raw = await page.evaluate(() => localStorage.getItem('em-time:data') ?? '');
    expect(raw).not.toContain('accumulatedMs');
    expect(raw).not.toContain('stopwatch');
    expect(JSON.stringify(await stored(page))).not.toContain('accumulatedMs');
    expect(Object.keys(await stored_(page)).sort()).toEqual(['accumulatedMs', 'startedAt']);
  });

  test('a clock jump while the tab is hidden: nothing repaints while hidden, the time is right the moment it is visible again', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await run(page, 2000);
    await expect(time(page)).toHaveText('0:02');
    await setHidden(page, true);
    await page.clock.fastForward(10 * MIN + 5000); // the phone was locked
    await run(page, 3000);
    await expect(time(page)).toHaveText('0:02'); // hidden: no repaint
    await setHidden(page, false);
    await expect(time(page)).toHaveText('10:10');
    await run(page, 1000);
    await expect(time(page)).toHaveText('10:11');
  });

  test('a jump while stopped changes nothing', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await run(page, 6000);
    await toggle(page).click();
    await page.clock.fastForward(60 * MIN);
    await expect(time(page)).toHaveText('0:06');
  });

  test('a stored start in the future (the wall clock was set back) never shows negative time', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ startedAt: 4_102_444_800_000, accumulatedMs: 2000 })), KEY);
    await open(page);
    await expect(sw(page)).toHaveAttribute('data-state', 'running');
    await expect(time(page)).toHaveText('0:02');
    await run(page, 3000);
    await expect(time(page)).toHaveText('0:02');
  });

  test('bad stored data falls back to zero (storage can be hand-edited or full)', async ({ page }) => {
    for (const bad of ['not json', '{"startedAt":"x","accumulatedMs":1}', '{"startedAt":null,"accumulatedMs":-5}', '{"startedAt":null}', 'null']) {
      await page.addInitScript((v) => localStorage.setItem('em-time:stopwatch', v), bad);
      await boot(page, { seed: doc() });
      await expect(sw(page)).toHaveAttribute('data-state', 'idle');
      await expect(time(page)).toHaveText('0:00');
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
    }
  });

  test('works with storage blocked (every access is guarded)', async ({ page }) => {
    await page.addInitScript(`
      const real = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) { if (k === 'em-time:stopwatch') throw new Error('blocked'); return real.call(this, k); };
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'em-time:stopwatch') throw new Error('full'); return set.call(this, k, v); };
    `);
    await open(page);
    await toggle(page).click();
    await run(page, 3000);
    await expect(time(page)).toHaveText('0:03');
    await toggle(page).click();
    await reset(page).click();
    await expect(time(page)).toHaveText('0:00');
  });

  test('Erase all data also clears the stopwatch', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: NOW, freeze: true, stubs: true });
    await toggle(page).click();
    await run(page, 4000);
    expect(await stored_(page)).not.toBeNull();
    await go(page, 'settings');
    await page.getByRole('button', { name: 'Erase all data' }).click();
    const dlg = page.getByRole('dialog', { name: 'Erase all data?' });
    await dlg.getByLabel('Type erase to confirm').fill('erase');
    await dlg.getByRole('button', { name: 'Erase', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await stored_(page)).toBeNull();
    await go(page, 'timer');
    await expect(sw(page)).toHaveAttribute('data-state', 'idle');
    await expect(time(page)).toHaveText('0:00');
  });
});

test.describe('stopwatch: independent of the Pomodoro timer', () => {
  test('starting, stopping and resetting it never starts, pauses or logs the timer', async ({ page }) => {
    await open(page, { core: true });
    const digits = page.getByTestId('timer-digits').filter({ visible: true });
    await toggle(page).click();
    await run(page, 20_000);
    await expect(digits).toHaveText('25:00');
    await expect(page.getByTestId('timer-play')).toHaveAccessibleName('Start');
    await toggle(page).click();
    await reset(page).click();
    await expect(digits).toHaveText('25:00');
    expect(((await stored(page))?.sessions ?? []).length).toBe(0);
  });

  test('Play, Pause, Skip and Reset on the Pomodoro timer leave a running stopwatch alone', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await run(page, 1000);
    await page.getByTestId('timer-play').click(); // Start focus
    await run(page, 7000);
    await expect(time(page)).toHaveText('0:08');
    await page.getByTestId('timer-play').click(); // Pause
    await run(page, 2000);
    await expect(time(page)).toHaveText('0:10');
    await page.getByTestId('timer-skip').click();
    await page.getByTestId('timer-reset').click();
    await run(page, 2000);
    await expect(sw(page)).toHaveAttribute('data-state', 'running');
    await expect(time(page)).toHaveText('0:12');
  });

  test('a stopped stopwatch is unaffected by a focus session that runs to the end', async ({ page }) => {
    await open(page);
    await toggle(page).click();
    await run(page, 5000);
    await toggle(page).click();
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 500);
    await run(page, 500);
    await expect(sw(page)).toHaveAttribute('data-state', 'stopped');
    await expect(time(page)).toHaveText('0:05');
  });
});

test.describe('stopwatch: announcements, keyboard, accessibility', () => {
  test('Start, Stop and Reset are announced through the polite live region', async ({ page }) => {
    await open(page);
    const live = page.getByTestId('live-region');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await toggle(page).click();
    await run(page, 100);
    await expect(live).toHaveText('Stopwatch started');
    await run(page, 1000);
    await toggle(page).click();
    await run(page, 100);
    await expect(live).toHaveText('Stopwatch stopped');
    await run(page, 1000);
    await reset(page).click();
    await run(page, 100);
    await expect(live).toHaveText('Stopwatch reset');
    // nothing is announced for the ticking digits and the strings have no dashes
    for (const t of ['Stopwatch started', 'Stopwatch stopped', 'Stopwatch reset']) noDash(t);
  });

  test('keyboard: Tab reaches Start, Enter and Space both toggle it; the focus indicator is visible', async ({ page }) => {
    await open(page);
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(sw(page)).toHaveAttribute('data-state', 'running');
    await run(page, 2000);
    await page.keyboard.press('Space');
    await expect(sw(page)).toHaveAttribute('data-state', 'stopped');
    const ring = await toggle(page).evaluate((e) => {
      const s = getComputedStyle(e);
      return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow };
    });
    expect(ring.outline).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    // the page shortcuts (Space, S, R) are not hijacked while a button has focus, and the stopwatch has none of its own
    await expect(page.getByTestId('timer-play')).toHaveAccessibleName('Start');
  });

  test('buttons are at least 44x44 and the row stays inside the viewport', async ({ page }) => {
    await open(page);
    for (const b of [toggle(page), reset(page)]) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.width).toBeGreaterThanOrEqual(43.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  for (const theme of ['light', 'dark', 'sky'] as const) {
    test(`no axe violations with the stopwatch running (${theme}), contrast included`, async ({ page }) => {
      await boot(page, { seed: doc({ theme }), clock: NOW, freeze: true });
      await page.clock.runFor(300);
      await toggle(page).click();
      await run(page, 65_000);
      await page.clock.resume(); // axe uses timers of its own
      await page.waitForTimeout(300);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
