import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MIN, boot, fixture, go, isMobile } from './helpers';
import { contrast, over, parseColor, type RGB, type RGBA } from '../unit/colorMath';

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
        if (!(r.width > 0 && r.right > window.innerWidth + 1)) return false;
        // an element whose overflow is clipped by an ancestor that itself fits the viewport cannot cause a scroll
        // (the sky scene clips the sun glow by design; the sun glides while the viewport is resized)
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const ov = getComputedStyle(a).overflowX;
          if ((ov === 'hidden' || ov === 'clip') && a !== document.body && a.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        }
        return true;
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
// v2: the v1 gradient-stop table is gone (UI-2 is replaced by SKY-2 to SKY-9). The proof that every
// pair passes at every minute is the unit sweep (tests/unit/sky-contrast.test.ts); here the same
// pairs are re-computed in the browser from the LIVE tokens and sky colours of the running page.
const toRgb = (c: string): RGBA => parseColor(c);

test.describe('A11Y-1 contrast (live tokens over the live sky)', () => {
  for (const mode of ['light', 'dark'] as const) {
    test(`ink tokens reach 4.5:1 on glass and cards over every sky colour, Always ${mode}`, async ({ page }) => {
      await boot(page, { seed: { ...fixture('backup-valid.json'), settings: { ...fixture('backup-valid.json').settings, theme: mode } }, clock: true });
      const t = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const names = ['ink', 'ink-2', 'ink-3', 'accent-text', 'danger', 'glass', 'surface', 'surface-solid'].map((n) => `--em-${n}`);
        const sky = ['top', 'mid', 'horizon', 'hill-back', 'hill-front'].map((n) => `--sky-${n}`);
        return Object.fromEntries([...names, ...sky].map((n) => [n, cs.getPropertyValue(n).trim()]));
      });
      const under = ['top', 'mid', 'horizon', 'hill-back', 'hill-front'].map((n) => toRgb(t[`--sky-${n}`]!).slice(0, 3) as RGB);
      const fails: string[] = [];
      const check = (fill: string, tokens: string[]) => {
        for (const k of tokens) {
          for (const u of under) {
            const r = contrast(toRgb(t[k]!).slice(0, 3) as RGB, over(toRgb(t[fill]!), u));
            if (r < 4.5) fails.push(`${k} on ${fill} over ${u.join(',')} = ${r.toFixed(2)}`);
          }
        }
      };
      check('--em-surface', ['--em-ink', '--em-ink-2', '--em-ink-3', '--em-accent-text', '--em-danger']);
      check('--em-glass', ['--em-ink', '--em-ink-2', '--em-accent-text']);
      check('--em-surface-solid', ['--em-ink', '--em-ink-2', '--em-ink-3']);
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
    }

  for (const theme of ['light', 'dark'] as const) {
    // one page per theme: reusing a page keeps the first theme (hash navigation does not reseed)
    test(`timer while a focus phase runs (the nav is dimmed with a muted token): text contrast, ${theme}`, async ({ page }) => {
      await openScreen(page, 'timer', theme);
      await page.getByTestId('timer-play').click();
      await page.clock.runFor(2000);
      await page.waitForTimeout(500); // the dim is a transition
      // axe cannot read a gradient: paint the sky mid colour flat (the glass and cards still composite over it)
      const flat = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sky-mid').trim());
      await page.addStyleTag({ content: `.scene { display: none !important; } html, body { background-image: none !important; background-color: ${flat} !important; }` });
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
