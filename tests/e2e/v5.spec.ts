import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parseColor } from '../unit/colorMath';
import { MIN, NOW, atTime, boot, controlsOverlapping, docWithSessions, isMobile, rootVar, runFocus, v2doc } from './helpers';

/**
 * v5 (docs/v5-spec.md): clear liquid glass on the mode selector, the desktop tabs and the phone tool
 * pills; the Sounds chip moves (desktop: the "Focus tools" card, phone: under the play controls); the
 * phone greeting centres on the header cloud. The stopwatch itself is in stopwatch.spec.ts.
 * Screenshots (tests/screenshots/v5-*.png) are written by the last describe.
 */
const SHOTS = resolve(import.meta.dirname, '../screenshots');
mkdirSync(SHOTS, { recursive: true });

const chip = (p: Page) => p.getByTestId('noise-chip');
const rgb = (hex: string): string => {
  const [r, g, b] = parseColor(hex);
  return `rgb(${r}, ${g}, ${b})`;
};

interface GlassStyle {
  image: string;
  color: string;
  filter: string;
  border: string;
  shadow: string;
  ink: string;
}
const styleOf = (page: Page, selector: string): Promise<GlassStyle> =>
  page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      image: s.backgroundImage,
      color: s.backgroundColor,
      filter: s.backdropFilter || (s as any).webkitBackdropFilter || '',
      border: s.borderTopColor,
      shadow: s.boxShadow,
      ink: s.color,
    };
  });

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

// ------------------------------------------------------------------------------------------- 1. clear glass

for (const theme of ['light', 'dark'] as const) {
  test.describe(`clear glass tokens (${theme})`, () => {
    const spec =
      theme === 'light'
        ? { blur: /blur\(14px\)/, sat: /saturate\((1\.15|115%)\)/, rim: 'rgba(255, 255, 255, 0.45)', fill: ['0.22', '0.06'], bead: ['0.42', '0.18'] }
        : { blur: /blur\(12px\)/, sat: /saturate\((1\.6|160%)\)/, rim: 'rgba(255, 255, 255, 0.2)', fill: ['0.13', '0.04'], bead: ['0.22', '0.09'] };

    test('the mode selector is glass: gradient fill, blur, rim, depth; the selected option is a lighter bead, not an accent fill', async ({ page }) => {
      await boot(page, { seed: v2doc({ theme }), clock: NOW, calm: true });
      const box = await styleOf(page, '.modes');
      expect(box.image).toContain('linear-gradient');
      for (const a of spec.fill) expect(box.image).toContain(`rgba(255, 255, 255, ${a})`);
      expect(box.color).toBe(TRANSPARENT);
      expect(box.filter).toMatch(spec.blur);
      expect(box.filter).toMatch(spec.sat);
      expect(box.border).toBe(spec.rim);
      expect(box.shadow).toContain('inset');

      const ink = rgb(await rootVar(page, '--sky-lg-ink'));
      const selected = await styleOf(page, '.modes [aria-checked="true"]');
      expect(selected.color).toBe(TRANSPARENT); // no solid accent fill
      expect(selected.image).toContain('linear-gradient');
      for (const a of spec.bead) expect(selected.image).toContain(`rgba(255, 255, 255, ${a})`);
      expect(selected.shadow).toContain('inset');
      expect(selected.ink).toBe(ink);
      const plain = await styleOf(page, '.modes [aria-checked="false"]');
      expect(plain.ink).toBe(ink); // no grey inactive labels
      expect(plain.image).toBe('none');
      expect(plain.color).toBe(TRANSPARENT);
      // switching mode moves the bead
      await page.getByTestId('mode-short').click();
      expect((await styleOf(page, '[data-testid="mode-short"]')).image).toContain('linear-gradient');
      expect((await styleOf(page, '[data-testid="mode-focus"]')).image).toBe('none');
    });

    test('hovering an unselected option lightens it with the hover token', async ({ page }, info) => {
      test.skip(isMobile(info.project), 'no hover on touch');
      await boot(page, { seed: v2doc({ theme }), clock: NOW, calm: true });
      await page.getByTestId('mode-long').hover();
      await page.waitForTimeout(350); // the background transition
      const hov = await styleOf(page, '[data-testid="mode-long"]');
      expect(hov.color).toBe(theme === 'light' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.08)');
      expect(hov.ink).toBe(rgb(await rootVar(page, '--sky-lg-ink')));
    });

    test('desktop tabs are glass with the same tokens; every label has the glass ink, also while a focus phase runs', async ({ page }, info) => {
      test.skip(isMobile(info.project), 'the phone tab bar keeps its solid look');
      await boot(page, { seed: v2doc({ theme }), clock: NOW, calm: true });
      const tabs = await styleOf(page, '.nav__tabs');
      expect(tabs.image).toContain('linear-gradient');
      expect(tabs.color).toBe(TRANSPARENT);
      expect(tabs.filter).toMatch(spec.blur);
      expect(tabs.border).toBe(spec.rim);
      const ink = rgb(await rootVar(page, '--sky-lg-ink'));
      const current = await styleOf(page, '.nav__tab[aria-current="page"]');
      expect(current.color).toBe(TRANSPARENT);
      expect(current.image).toContain('linear-gradient');
      expect(current.ink).toBe(ink);
      expect((await styleOf(page, '[data-testid="nav-tasks"]')).ink).toBe(ink);
      await page.getByTestId('timer-play').click(); // the nav dims while focus runs; the labels must not go grey
      await expect(page.locator('.nav--dim')).toHaveCount(1);
      for (const id of ['nav-tasks', 'nav-stats', 'nav-settings']) expect((await styleOf(page, `[data-testid="${id}"]`)).ink).toBe(ink);
    });
  });
}

test.describe('clear glass: what stays as it was', () => {
  test('phone: the bottom tab bar keeps its solid look (nav glass 0.92, accent bead, no per-tab glass)', async ({ page }, info) => {
    test.skip(!isMobile(info.project), 'phone only');
    await boot(page, { seed: v2doc({ theme: 'light' }), clock: NOW, calm: true });
    const nav = await styleOf(page, '.nav');
    expect(nav.color).toBe('rgba(255, 255, 255, 0.92)');
    expect(nav.image).toBe('none');
    const tabs = await styleOf(page, '.nav__tabs');
    expect(tabs.filter).not.toContain('blur(14px)'); // not the clear-glass blur
    expect(tabs.image).toBe('none');
    expect(tabs.color).toBe(TRANSPARENT);
    const bead = await page.locator('.nav__tab[aria-current="page"]').evaluate((e) => getComputedStyle(e, '::before').backgroundColor);
    expect(bead).toBe(rgb(await rootVar(page, '--em-accent')));
    expect((await styleOf(page, '.nav__tab[aria-current="page"]')).ink).toBe(rgb(await rootVar(page, '--em-ink')));
  });

  test('other segmented controls (Stats range, Settings theme) keep the solid selected style', async ({ page }) => {
    await boot(page, { seed: v2doc({ theme: 'light' }), clock: NOW, calm: true, route: 'stats' });
    const sel = await styleOf(page, '.seg:not(.modes) [aria-checked="true"]');
    expect(sel.color).toBe(rgb(await rootVar(page, '--em-accent')));
  });

  test('the sky glass is not used for cards: .card keeps its surface', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'the side cards are desktop only');
    await boot(page, { seed: v2doc({ theme: 'light' }), clock: NOW, calm: true });
    const card = await styleOf(page, '.timerpage__side .card');
    expect(card.color).toBe('rgba(255, 255, 255, 0.9)');
  });
});

// ------------------------------------------------------------------------------------------- 2. Sounds placement

test.describe('Sounds placement', () => {
  test('desktop: no chip in the header; a third "Focus tools" card under Up next holds the chip and the stopwatch', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'desktop only');
    await boot(page, { seed: v2doc(), clock: NOW, calm: true });
    await expect(chip(page)).toHaveCount(1);
    await expect(page.locator('header.thead').getByTestId('noise-chip')).toHaveCount(0);
    const side = page.locator('aside.timerpage__side');
    await expect(side.locator('> .card')).toHaveCount(3);
    const third = side.locator('> .card').nth(2);
    await expect(third).toHaveAttribute('data-testid', 'focus-tools');
    await expect(third.getByRole('heading', { name: 'Focus tools' })).toBeVisible();
    await expect(third.getByTestId('noise-chip')).toBeVisible();
    await expect(third.getByTestId('stopwatch')).toBeVisible();
    await expect(third).toContainText('Stopwatch');
    // order: Today, Up next, Focus tools, top to bottom
    const ys = await side.locator('> .card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
    // same chip behaviour: label and state, 44 px tall, opens the picker
    await expect(chip(page)).toContainText('Sounds');
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    expect((await chip(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await chip(page).click();
    await expect(page.getByTestId('noise-picker')).toBeVisible();
    expect(await third.textContent()).not.toMatch(/[–—]/);
  });

  test('desktop: the whole Focus tools card is inside the viewport at 1280x800', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'desktop only');
    await boot(page, { seed: v2doc(), clock: NOW, calm: true });
    const b = (await page.getByTestId('focus-tools').boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(800);
  });

  test('phone: the chip and the stopwatch share one centred row directly under the play controls', async ({ page }, info) => {
    test.skip(!isMobile(info.project), 'phone only');
    await boot(page, { seed: v2doc(), clock: NOW, calm: true });
    await expect(chip(page)).toHaveCount(1);
    await expect(page.locator('header.thead').getByTestId('noise-chip')).toHaveCount(0);
    await expect(page.getByTestId('focus-tools')).toHaveCount(0);
    const play = (await page.getByTestId('timer-play').boundingBox())!;
    const c = (await chip(page).boundingBox())!;
    const s = (await page.getByTestId('stopwatch').boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(play.y + play.height + 4);
    expect(c.y - (play.y + play.height)).toBeLessThan(40); // directly under, not floating elsewhere
    expect(Math.abs(c.y + c.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(3); // one row
    expect(s.x).toBeGreaterThan(c.x + c.width); // chip left, stopwatch right
    const mid = (Math.min(c.x, s.x) + Math.max(c.x + c.width, s.x + s.width)) / 2;
    expect(Math.abs(mid - page.viewportSize()!.width / 2)).toBeLessThanOrEqual(3);
    expect(c.height).toBeGreaterThanOrEqual(44);
    expect(s.height).toBeGreaterThanOrEqual(44);
  });

  test('the chip is unique at every width, also after a resize across the breakpoint', async ({ page }) => {
    await boot(page, { seed: v2doc(), clock: NOW, calm: true });
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 899, height: 800 }, { width: 900, height: 800 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(150);
      await expect(chip(page), `@${size.width}`).toHaveCount(1);
      await expect(page.getByTestId('stopwatch'), `@${size.width}`).toHaveCount(1);
      await expect(page.getByTestId('stopwatch-toggle'), `@${size.width}`).toHaveCount(1);
    }
  });

  test('the chip keeps its states in the new places (on, playing label, error colour is not the glass ink)', async ({ page }) => {
    await boot(page, { seed: v2doc({ noiseOn: true, noise: 'brown' }), clock: NOW, calm: true });
    await expect(chip(page)).toContainText('Brown noise');
    await expect(chip(page)).toHaveAttribute('aria-label', 'Focus sounds: Brown noise, on');
    expect((await chip(page).boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16);
  });
});

// ------------------------------------------------------------------------------------------- 3. phone greeting

test.describe('phone greeting', () => {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
    test(`the greeting is vertically centred on the header cloud at ${size.width}x${size.height}`, async ({ page }, info) => {
      test.skip(!isMobile(info.project), 'phone only');
      await boot(page, { seed: v2doc({ displayName: 'Em' }), clock: NOW, calm: true });
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const g = (await page.getByTestId('greeting').boundingBox())!;
      const m = (await page.getByTestId('mascot').boundingBox())!;
      expect(Math.abs(g.y + g.height / 2 - (m.y + m.height / 2))).toBeLessThanOrEqual(4);
      expect(m.x).toBeGreaterThan(g.x + g.width - 1); // same row, cloud at the right
      // compact: the header is not taller than the cloud row and the mode selector follows closely
      const head = (await page.locator('header.thead').boundingBox())!;
      expect(head.height).toBeLessThanOrEqual(76);
      const modes = (await page.locator('.modes').boundingBox())!;
      expect(modes.y - (head.y + head.height)).toBeLessThanOrEqual(20);
    });
  }

  test('a two-line greeting (long name) stays centred on the cloud', async ({ page }, info) => {
    test.skip(!isMobile(info.project), 'phone only');
    await boot(page, { seed: v2doc({ displayName: 'Wolfeschlegelstein' }), clock: NOW, calm: true });
    const g = (await page.getByTestId('greeting').boundingBox())!;
    const m = (await page.getByTestId('mascot').boundingBox())!;
    expect(g.height).toBeGreaterThan(40); // wrapped
    expect(Math.abs(g.y + g.height / 2 - (m.y + m.height / 2))).toBeLessThanOrEqual(4);
  });

  test('desktop: the header is unchanged (greeting alone, left)', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'desktop only');
    await boot(page, { seed: v2doc(), clock: NOW, calm: true });
    const head = page.locator('header.thead');
    expect(await head.evaluate((e) => e.children.length)).toBe(1);
    const g = (await page.getByTestId('greeting').boundingBox())!;
    expect(g.x).toBeLessThan(120);
  });
});

// ------------------------------------------------------------------------------------------- no overlaps on phone

/** controlsOverlapping reports an interactive target over itself too: keep only hits on other elements. */
const foreign = (hits: string[]): string[] =>
  hits.filter((h) => {
    const m = /^(.+?) \[.*? over [a-z]+\[(.*?)\] \[/.exec(h);
    return !(m && m[1] === m[2]);
  });

const PHONES = [{ width: 390, height: 844 }, { width: 360, height: 740 }];
test.describe('phone: nothing overlaps the Sounds and stopwatch row', () => {
  for (const size of PHONES) {
    test(`at ${size.width}x${size.height}, idle and after a focus session (message line and break idea shown)`, async ({ page }, info) => {
      test.skip(!isMobile(info.project), 'phone only');
      const d = docWithSessions([['2026-10-13', 1]], { notifications: false });
      d.meta.currentTaskId = d.tasks.find((t: any) => !t.deletedAt && !t.done).id;
      await boot(page, { seed: d, clock: NOW, calm: true });
      await page.setViewportSize(size);
      await page.waitForTimeout(250);

      const rect = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
      const check = async (label: string) => {
        const c = await rect('[data-testid="noise-chip"]');
        const s = await rect('[data-testid="stopwatch"]');
        const nav = await rect('.nav');
        const rowBottom = Math.max(c.y + c.height, s.y + s.height);
        expect(rowBottom, `${label}: row above the tab bar`).toBeLessThanOrEqual(nav.y - 8);
        expect(c.x, `${label}: chip inside`).toBeGreaterThanOrEqual(8);
        expect(s.x + s.width, `${label}: stopwatch inside`).toBeLessThanOrEqual(size.width - 8);
        expect(c.x + c.width, `${label}: chip does not touch the stopwatch`).toBeLessThanOrEqual(s.x - 6);
        for (const id of ['timer-reset', 'timer-play', 'timer-skip']) {
          const b = await rect(`[data-testid="${id}"]`);
          expect(b.y + b.height, `${label}: ${id} above the row`).toBeLessThanOrEqual(Math.min(c.y, s.y) - 2);
        }
        expect(foreign(await controlsOverlapping(page, '[data-testid="noise-chip"]')), `${label}: chip`).toEqual([]);
        expect(foreign(await controlsOverlapping(page, '[data-testid="timer-reset"], [data-testid="timer-play"], [data-testid="timer-skip"]')), `${label}: controls`).toEqual([]);
        if (size.height >= 844) expect(await page.evaluate(() => document.documentElement.scrollHeight), `${label}: a 844 px phone does not scroll`).toBeLessThanOrEqual(size.height);
        // the hanging message and break card sit under the row and clear the tab bar. A short phone scrolls
        // (the page already did before v5), so judge them at the end of the page, where the tab bar is last
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(100);
        const nav2 = await rect('.nav');
        const row2 = await rect('[data-testid="noise-chip"]');
        for (const id of ['message-line', 'break-prompt']) {
          const loc = page.locator(`[data-testid="${id}"]`);
          if (!(await loc.isVisible())) continue;
          const b = (await loc.boundingBox())!;
          if (b.height < 2) continue;
          expect(b.y, `${label}: ${id} under the row`).toBeGreaterThanOrEqual(row2.y + row2.height + 2);
          expect(b.y + b.height, `${label}: ${id} above the tab bar`).toBeLessThanOrEqual(nav2.y);
        }
        expect(await controlsOverlapping(page, '[data-testid="message-line"], [data-testid="break-prompt"]'), `${label}: message and break card`).toEqual([]);
        await page.evaluate(() => window.scrollTo(0, 0));
        // the stopwatch's own two buttons and its digits do not overlap each other
        const parts = await page.evaluate(() => {
          const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
          const a = r('stopwatch-time');
          const b = r('stopwatch-toggle');
          const c = r('stopwatch-reset');
          return { timeRight: a.right, toggleLeft: b.left, toggleRight: b.right, resetLeft: c.left };
        });
        expect(parts.timeRight, `${label}: digits clear of the toggle`).toBeLessThanOrEqual(parts.toggleLeft + 0.5);
        expect(parts.toggleRight, `${label}: toggle clear of reset`).toBeLessThanOrEqual(parts.resetLeft + 0.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label}: no horizontal scroll`).toBeLessThanOrEqual(0);
      };
      await check('idle');

      await runFocus(page); // a focus session ends: the encouragement line and a break idea appear
      await expect(page.getByTestId('break-prompt')).toBeVisible();
      await page.waitForTimeout(500);
      await check('break');
      await page.screenshot({ path: `${SHOTS}/v5-break-${size.width}.png`, animations: 'disabled' });

      // with a long stopwatch time and a long sound name the row still fits
      await page.evaluate(() => localStorage.setItem('em-time:stopwatch', JSON.stringify({ startedAt: null, accumulatedMs: (10 * 3600 + 59 * 60 + 59) * 1000 })));
      await page.reload();
      await expect(page.getByTestId('stopwatch-time')).toHaveText('10:59:59');
      await check('long digits');
    });
  }
});

// ------------------------------------------------------------------------------------------- screenshots

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

test.describe('v5 screenshots (Timer, stopwatch running)', () => {
  const TIMES: Array<[string, string]> = [['12:30', 'midday'], ['18:30', 'dusk'], ['23:00', 'night']];
  for (const [time, id] of TIMES) {
    test(`Timer with the stopwatch running and a sound chosen (${id})`, async ({ page }) => {
      const d = docWithSessions([['2026-10-13', 1], ['2026-10-14', 3]], { notifications: false, noiseOn: true, noise: 'rain' });
      d.meta.currentTaskId = d.tasks.find((t: any) => !t.deletedAt && !t.done).id;
      await page.addInitScript(shiftedClock(atTime(time)));
      await boot(page, { seed: d, rng: 1, calm: true });
      await page.evaluate(() => document.fonts.ready);
      await page.getByTestId('stopwatch-toggle').click();
      await page.evaluate((ms) => (window as any).__qaShift(ms), 12 * MIN + 34_000);
      await expect(page.getByTestId('stopwatch-time')).toHaveText('12:34');
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      const w = page.viewportSize()!.width;
      await page.screenshot({ path: `${SHOTS}/v5-timer-${w}-${id}.png`, animations: 'disabled' });
    });
  }
});
