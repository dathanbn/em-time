import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MIN, boot, fixture, go, isMobile } from './helpers';

type Route = 'timer' | 'tasks' | 'stats' | 'settings';
const ROUTES: Route[] = ['timer', 'tasks', 'stats', 'settings'];

/** Fixture with a current task so the "current" highlight, chip and picker states are on screen. */
const seed = () => {
  const d = fixture('backup-valid.json');
  d.meta.currentTaskId = d.tasks[1].id;
  return d;
};

const noHScroll = (page: Page) =>
  page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    body: document.body.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        if (el.closest('.sr-only, [hidden], svg *, .tooltip')) return false;
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1;
      })
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(el.getBoundingClientRect().right)}`),
  }));

// ---------------------------------------------------------------- UI-3 layouts
const DESKTOP_SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
const PHONE_SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
];

test.describe('UI-3 layouts: no horizontal scroll, controls reachable', () => {
  for (const route of ROUTES) {
    test(`${route} fits the width at every supported size`, async ({ page }, info) => {
      const sizes = isMobile(info.project) ? PHONE_SIZES : DESKTOP_SIZES;
      await boot(page, { seed: seed(), clock: true, stubs: true, route });
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.waitForTimeout(250); // charts re-measure
        const r = await noHScroll(page);
        expect(r.scroll, `${route} @${size.width}`).toBeLessThanOrEqual(r.inner);
        expect(r.offenders, `${route} @${size.width}`).toEqual([]);
        // navigation is reachable at every size
        await expect(page.getByTestId('nav-timer').filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByTestId('nav-settings').filter({ visible: true }).first()).toBeVisible();
      }
    });
  }

  test('the timer screen keeps its primary controls on screen without scrolling at 1024x768 and 390x844', async ({ page }, info) => {
    await boot(page, { seed: seed(), clock: true, route: 'timer' });
    for (const size of isMobile(info.project) ? [{ width: 390, height: 844 }] : [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      for (const id of ['timer-digits', 'timer-play', 'timer-reset', 'timer-skip']) {
        const box = await page.getByTestId(id).filter({ visible: true }).first().boundingBox();
        expect(box, `${id} @${size.width}`).not.toBeNull();
        expect(box!.y + box!.height, `${id} bottom @${size.width}`).toBeLessThanOrEqual(size.height);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      }
    }
  });

  test('dialogs and sheets fit the viewport', async ({ page }) => {
    await boot(page, { seed: seed(), clock: true, route: 'timer' });
    await page.getByTestId('current-task').filter({ visible: true }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Pick a task' });
    await page.waitForTimeout(500); // sheet transition
    const b = (await dlg.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await page.waitForTimeout(500);
    const sheet = page.getByRole('dialog').first();
    const sb = (await sheet.boundingBox())!;
    expect(sb.x + sb.width).toBeLessThanOrEqual(vp.width + 1);
    expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height + 1);
  });
});

// ---------------------------------------------------------------- A11Y-5 touch targets
const INTERACTIVE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="tab"], summary';

async function smallTargets(page: Page, scope = 'body'): Promise<string[]> {
  return page.evaluate(([sel, root]) => {
    const out: string[] = [];
    for (const el of document.querySelector(root as string)!.querySelectorAll<HTMLElement>(sel as string)) {
      if (el.closest('.sr-only, [hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (el as HTMLInputElement).type === 'file') continue;
      // the real checkbox/radio input sits inside a larger label; judge the label's box
      const host = el.closest('label') ?? el;
      const r = host.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.classList.contains('skip')) continue; // skip link: visible only on focus
      if (r.width < 43.5 || r.height < 43.5) {
        const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 24) || el.getAttribute('data-testid') || el.className;
        out.push(`${el.tagName.toLowerCase()}[${name}] ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  }, [INTERACTIVE, scope]);
}

test.describe('A11Y-5 touch targets on the phone layout', () => {
  test.beforeEach(async ({ browserName: _b }, info) => {
    test.skip(!isMobile(info.project), 'phone layout only');
  });

  test('the primary controls are at least 44x44: nav, Play, Reset, Skip, mode switcher, task button, Add, menus, checkboxes', async ({ page }) => {
    await boot(page, { seed: seed(), clock: true, route: 'timer' });
    const small: string[] = [];
    const check = async (loc: ReturnType<Page['locator']>, what: string) => {
      await loc.first().waitFor({ state: 'attached' }).catch(() => undefined); // screens render after the route change
      const n = await loc.count();
      expect(n, what).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i);
        if (!(await el.isVisible())) continue;
        const b = (await el.boundingBox())!;
        if (b.width < 43.5 || b.height < 43.5) small.push(`${what} #${i} ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    };
    for (const id of ['timer-play', 'timer-reset', 'timer-skip', 'mode-focus', 'mode-short', 'mode-long', 'current-task']) await check(page.getByTestId(id).filter({ visible: true }), id);
    await check(page.locator('[data-testid^="nav-"]').filter({ visible: true }), 'nav');
    await go(page, 'tasks');
    await check(page.getByTestId('task-add-button'), 'add task');
    await check(page.getByTestId('task-add-input'), 'task input');
    await check(page.getByRole('button', { name: /^More actions for/ }), 'task menu');
    await check(page.getByRole('button', { name: /^Set as current/ }).or(page.getByRole('button', { name: /^Current task:/ })), 'set current');
    await check(page.locator('label.check'), 'task checkbox');
    await go(page, 'stats');
    await check(page.getByTestId('week-prev'), 'week prev');
    await check(page.getByTestId('week-next'), 'week next');
    await check(page.locator('[data-testid^="trend-range-"]'), 'trend range');
    await go(page, 'settings');
    await check(page.getByRole('switch'), 'switches');
    await check(page.getByTestId('export-button'), 'export');
    expect(small).toEqual([]);
  });

  for (const route of ROUTES) {
    test(`every interactive element on ${route} is at least 44x44`, async ({ page }) => {
      await boot(page, { seed: seed(), clock: true, route });
      expect(await smallTargets(page)).toEqual([]);
    });
  }

  test('dialogs and sheets: every control is at least 44x44', async ({ page }) => {
    await boot(page, { seed: seed(), clock: true, route: 'timer' });
    await page.getByTestId('current-task').filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    expect(await smallTargets(page, '[role="dialog"]'), 'task picker').toEqual([]);
    await page.keyboard.press('Escape');
    await go(page, 'tasks');
    await page.getByRole('button', { name: 'Manage categories' }).click();
    await page.waitForTimeout(500);
    expect(await smallTargets(page, '[role="dialog"]'), 'categories sheet').toEqual([]);
  });

  test('chart marks have hit areas of at least 24 px', async ({ page }) => {
    await boot(page, { seed: seed(), clock: true, route: 'stats' });
    const hit = await page.getByTestId('week-columns').locator('rect.hit').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    for (const w of hit) expect(w).toBeGreaterThanOrEqual(24);
    const cells = await page.getByTestId('heatmap-cell').evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
    for (const w of cells) expect(w).toBeGreaterThanOrEqual(24);
  });
});

// ---------------------------------------------------------------- A11Y-1 contrast, A11Y axe
const STOPS = {
  light: { dawn: ['#EEF5FC', '#FBF8F6'], day: ['#F4F9FE', '#FFFFFF'], dusk: ['#EEF3F9', '#F6F4F9'], night: ['#E8EFF9', '#F2F6FB'] },
  dark: { dawn: ['#121B2E', '#16182A'], day: ['#0F1A2C', '#0B1220'], dusk: ['#141629', '#1A1A2C'], night: ['#070D18', '#0B1220'] },
} as const;

const lin = (c: number) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0'), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hex6 = (c: string) => {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a hex color: ${c}`);
  return m[1]!.length === 3 ? `#${[...m[1]!].map((x) => x + x).join('')}` : `#${m[1]}`;
};

test.describe('A11Y-1 contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`text tokens reach 4.5:1 on every gradient stop and surface, ${theme} theme`, async ({ page }) => {
      await boot(page, { seed: { ...fixture('backup-valid.json'), settings: { ...fixture('backup-valid.json').settings, theme } }, clock: true });
      const tok = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const get = (n: string) => cs.getPropertyValue(n).trim();
        return Object.fromEntries(['ink', 'ink-2', 'ink-3', 'accent-text', 'danger', 'bg', 'surface', 'surface-sunk', 'danger-soft'].map((n) => [n, get(`--em-${n}`)]));
      });
      const stops = Object.values(STOPS[theme]).flat();
      const bgs = [...stops, hex6(tok.bg!), hex6(tok.surface!), hex6(tok['surface-sunk']!)];
      const fails: string[] = [];
      for (const t of ['ink', 'ink-2', 'ink-3', 'accent-text'] as const)
        for (const bg of bgs) {
          const r = ratio(hex6(tok[t]!), bg);
          if (r < 4.5) fails.push(`${t} ${tok[t]} on ${bg} = ${r.toFixed(2)}`);
        }
      for (const bg of [hex6(tok.surface!), hex6(tok['danger-soft']!)]) {
        const r = ratio(hex6(tok.danger!), bg);
        if (r < 4.5) fails.push(`danger on ${bg} = ${r.toFixed(2)}`);
      }
      expect(fails).toEqual([]);
    });
  }
});

async function axe(page: Page, opts: { contrastOnly?: boolean; noContrast?: boolean } = {}) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']);
  if (opts.contrastOnly) b = b.withRules(['color-contrast']);
  if (opts.noContrast) b = b.disableRules(['color-contrast']);
  const r = await b.analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

async function openScreen(page: Page, route: Route, theme: 'light' | 'dark') {
  const d = seed();
  d.settings.theme = theme;
  await boot(page, { seed: d, clock: true, stubs: true, route });
  await page.waitForTimeout(400); // charts measure
}

test.describe('A11Y axe: no violations on any screen, both themes', () => {
  for (const theme of ['light', 'dark'] as const)
    for (const route of ROUTES) {
      test(`${route} (${theme}): structure, names, roles`, async ({ page }) => {
        await openScreen(page, route, theme);
        expect(await axe(page, { noContrast: true })).toEqual([]);
      });
      test(`${route} (${theme}): text contrast on every gradient stop`, async ({ page }) => {
        await openScreen(page, route, theme);
        const problems: string[] = [];
        for (const [period, [top, bottom]] of Object.entries(STOPS[theme])) {
          for (const [where, color] of [['top', top], ['bottom', bottom]] as const) {
            // axe cannot resolve a gradient, so paint each stop as a flat page background
            await page.addStyleTag({ content: `html, body { background-image: none !important; background-color: ${color} !important; }` });
            for (const v of await axe(page, { contrastOnly: true })) problems.push(`${period}/${where} ${color}: ${v}`);
          }
        }
        expect(problems).toEqual([]);
      });
    }

  for (const theme of ['light', 'dark'] as const) {
    // one page per theme: reusing a page keeps the first theme (hash navigation does not reseed)
    test(`timer while a focus phase runs (the nav is dimmed with a muted token): text contrast, ${theme}`, async ({ page }) => {
      await openScreen(page, 'timer', theme);
      await page.getByTestId('timer-play').click();
      await page.clock.runFor(2000);
      await page.waitForTimeout(500); // the dim is a transition
      const flat = STOPS[theme].day[0]; // axe cannot read a gradient: paint the day stop flat
      await page.addStyleTag({ content: `html, body { background-image: none !important; background-color: ${flat} !important; }` });
      expect(await axe(page, { contrastOnly: true })).toEqual([]);
    });
  }

  test('dialogs: the task picker, the discard confirm and the shortcuts sheet have no violations', async ({ page }) => {
    await boot(page, { seed: seed(), clock: true, stubs: true, route: 'timer' });
    await page.getByTestId('current-task').filter({ visible: true }).first().click();
    await page.waitForTimeout(500); // sheet transition
    expect(await axe(page), 'task picker').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await page.waitForTimeout(500);
    expect(await axe(page), 'shortcuts').toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(2 * MIN);
    await page.getByTestId('mode-short').click();
    await expect(page.getByRole('dialog', { name: 'Discard this session?' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await axe(page), 'discard').toEqual([]);
  });
});

// ---------------------------------------------------------------- UI-2 gradient
test.describe('UI-2 time-of-day background', () => {
  const vars = (page: Page) =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return [cs.getPropertyValue('--em-bg-grad-top').trim().toLowerCase(), cs.getPropertyValue('--em-bg-grad-bottom').trim().toLowerCase()];
    });
  const at = (h: number, m = 0) => new Date(`2026-10-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:30-07:00`);

  for (const theme of ['light', 'dark'] as const) {
    test(`each period shows its own stops in the ${theme} theme, exactly where no blend applies`, async ({ browser, baseURL }) => {
      const pure: Array<[string, number, number]> = [
        ['night', 2, 0],
        ['dawn', 6, 0],
        ['day', 12, 0],
        ['dusk', 18, 0],
        ['night', 21, 0],
      ];
      for (const [period, h, m] of pure) {
        const ctx = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
        const page = await ctx.newPage();
        const d = fixture('backup-valid.json');
        d.settings.theme = theme;
        await page.clock.install({ time: at(h, m) });
        await page.addInitScript((t: string) => localStorage.setItem('em-time:data', t), JSON.stringify(d));
        await page.goto('?e2e#/timer');
        await expect(page.getByTestId('nav-timer').first()).toBeVisible();
        const [top, bottom] = STOPS[theme][period as keyof (typeof STOPS)['light']];
        expect(await vars(page), `${period} ${h}:00 ${theme}`).toEqual([top.toLowerCase(), bottom.toLowerCase()]);
        const image = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
        expect(image).toContain('linear-gradient');
        await ctx.close();
      }
    });
  }

  test('inside the hour before a boundary the colours move between the two periods; they are recomputed once a minute', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
    const page = await ctx.newPage();
    await page.clock.install({ time: at(7, 59) });
    await page.addInitScript(() => {
      (window as any).__gradWrites = 0;
      const orig = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (name: string, ...rest: any[]) {
        if (name === '--em-bg-grad-top') (window as any).__gradWrites++;
        return (orig as any).call(this, name, ...rest);
      };
    });
    await page.goto('?e2e#/timer');
    await expect(page.getByTestId('nav-timer').first()).toBeVisible();
    const dawn = STOPS.light.dawn.map((s) => s.toLowerCase());
    const day = STOPS.light.day.map((s) => s.toLowerCase());
    expect(await vars(page)).toEqual(dawn); // 07:59, the blend starts at 08:00
    const writes0 = await page.evaluate(() => (window as any).__gradWrites as number);
    await page.clock.runFor(5 * 60_000); // five minutes
    const writes1 = await page.evaluate(() => (window as any).__gradWrites as number);
    expect(writes1 - writes0).toBe(5);
    // 08:20 and 08:40 are a third and two thirds of the way
    const seen: string[][] = [];
    for (const target of [20, 40]) {
      const now = await page.evaluate(() => new Date().getMinutes());
      await page.clock.runFor((target - now) * 60_000);
      seen.push(await vars(page));
    }
    for (const colours of seen) {
      expect(colours).not.toEqual(dawn);
      expect(colours).not.toEqual(day);
      for (let k = 0; k < 2; k++) for (let c = 1; c < 7; c += 2) {
        const a = parseInt(dawn[k]!.slice(c, c + 2), 16);
        const b = parseInt(day[k]!.slice(c, c + 2), 16);
        const v = parseInt(colours[k]!.slice(c, c + 2), 16);
        expect(v).toBeGreaterThanOrEqual(Math.min(a, b) - 1);
        expect(v).toBeLessThanOrEqual(Math.max(a, b) + 1);
      }
    }
    expect(seen[0]).not.toEqual(seen[1]); // moving, in the right direction
    const bright = (c: string[]) => parseInt(c[0]!.slice(1, 3), 16) + parseInt(c[0]!.slice(3, 5), 16);
    expect(Math.abs(bright(seen[0]!) - bright(day))).toBeGreaterThan(Math.abs(bright(seen[1]!) - bright(day)) - 1);
    await page.clock.runFor(21 * 60_000); // 09:01
    expect(await vars(page)).toEqual(day);
    await ctx.close();
  });

  test('the boundaries: 04:59 is almost dawn, 05:00 is dawn; 16:59 is almost dusk, 17:00 is dusk', async ({ browser, baseURL }) => {
    for (const [h, m, period] of [[5, 0, 'dawn'], [9, 0, 'day'], [17, 0, 'dusk'], [20, 0, 'night']] as const) {
      const ctx = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
      const page = await ctx.newPage();
      await page.clock.install({ time: at(h, m) });
      await page.goto('?e2e#/timer');
      await expect(page.getByTestId('nav-timer').first()).toBeVisible();
      expect(await vars(page), `${h}:${m}`).toEqual(STOPS.light[period].map((s) => s.toLowerCase()));
      await ctx.close();
    }
  });
});
