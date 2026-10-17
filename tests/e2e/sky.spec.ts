import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MIN, ROUTES, KEYFRAME_TIMES, atTime, boot, fixture, go, rootVar, setHidden, v2doc } from './helpers';
import { hexRgb, mixOklab, rgbHex } from '../unit/colorMath';

const messages = JSON.parse(readFileSync(new URL('../../frontend/src/data/messages.json', import.meta.url), 'utf8')) as {
  sky: { greetings: Record<'dawn' | 'morning' | 'afternoon' | 'evening' | 'night', string[]> };
};
const lines = (w: keyof typeof messages.sky.greetings, name = 'Em') => messages.sky.greetings[w].map((l) => l.replace('{name}', name));
const BANNED = /\b(late|sleep|sleepy|tired|bed|bedtime|exhausted)\b/i;

// design.md 2.1, copied by hand
const SKY: Record<string, [string, string, string]> = {
  latenight: ['#070D22', '#101C40', '#22305E'],
  dawn: ['#A9CBF0', '#F6CFD6', '#FFDDB5'],
  morning: ['#6EB8F2', '#A9D8FA', '#E3F3FD'],
  midday: ['#4FA8EE', '#8CC8F5', '#D6EEFC'],
  afternoon: ['#5AA7E6', '#A3CDEF', '#FBE3C6'],
  dusk: ['#363F88', '#7D5596', '#F09A7E'],
  evening: ['#1E2A5E', '#34407E', '#6B5A94'],
  night: ['#0B1430', '#16244D', '#2B3D73'],
};
const WINDOW_AT: Record<string, 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'> = {
  '02:30': 'night', '06:00': 'dawn', '08:30': 'morning', '12:30': 'afternoon', '16:00': 'afternoon', '18:30': 'evening', '20:30': 'evening', '23:00': 'night',
};

const near = (a: string, b: string, tol = 1) => hexRgb(a).every((v, i) => Math.abs(v - hexRgb(b)[i]!) <= tol);
const html = (page: Page) => page.locator('html');
const body = (page: Page, kind: 'sun' | 'moon') =>
  page.evaluate((k) => {
    const el = document.querySelector(k === 'sun' ? '[data-testid="sky-sun"] .sun__body' : '[data-testid="sky-moon"] .moon__svg');
    if (!el) return null;
    const cs = getComputedStyle(document.querySelector(`[data-testid="sky-${k}"]`)!);
    const r = el.getBoundingClientRect();
    return { display: cs.display, left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, vw: innerWidth, vh: innerHeight };
  }, kind);
const band = (vw: number) => (vw >= 900 ? 232 : 132);
const backHill = (vh: number) => Math.min(170, Math.max(84, vh * 0.18));

test.describe('SKY-1 the scene', () => {
  for (const route of ROUTES) {
    test(`${route}: fixed, full viewport, aria-hidden, no pointer events, no focusable descendants, behind the content`, async ({ page }) => {
      await boot(page, { clock: atTime('12:30'), route });
      const info = await page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>('[data-testid="sky"]')!;
        const cs = getComputedStyle(sc);
        const r = sc.getBoundingClientRect();
        const focusable = sc.querySelectorAll('a[href], button, input, select, textarea, [tabindex], [contenteditable]').length;
        const main = document.querySelector('main')!;
        const above = !!(sc.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING);
        return {
          position: cs.position, pe: cs.pointerEvents, aria: sc.getAttribute('aria-hidden'), z: cs.zIndex,
          rect: [r.left, r.top, r.width, r.height], vw: innerWidth, vh: innerHeight, focusable, mainAfter: above,
          probe: (() => {
            // the middle of the nav is never the scene
            const nav = document.querySelector('nav')!.getBoundingClientRect();
            const el = document.elementFromPoint(nav.left + nav.width / 2, nav.top + nav.height / 2);
            return el ? !sc.contains(el) : true;
          })(),
        };
      });
      expect(info.position).toBe('fixed');
      expect(info.pe).toBe('none');
      expect(info.aria).toBe('true');
      expect(info.rect).toEqual([0, 0, info.vw, info.vh]);
      expect(info.focusable).toBe(0);
      expect(info.mainAfter).toBe(true);
      expect(Number(info.z) || 0).toBeLessThanOrEqual(0);
      expect(info.probe).toBe(true);
    });
  }

  test('SKY-8 exactly 3 clouds; 28 stars at 1280 and 16 at 390; two hills', async ({ page }, info) => {
    await boot(page, { clock: atTime('23:00') });
    await expect(page.getByTestId('sky-cloud')).toHaveCount(3);
    const stars = await page.locator('[data-testid="sky-stars"] .star').count();
    expect(stars).toBe(info.project.name === 'mobile' ? 16 : 28);
    await expect(page.getByTestId('sky-hills')).toHaveCount(1);
    expect(await page.locator('[data-testid="sky-hills"] path').count()).toBe(2);
  });
});

test.describe('SKY-2 the keyframes: tokens, phase, theme attribute and greeting at each time', () => {
  for (const [time, id] of KEYFRAME_TIMES) {
    test(`at ${time} the sky is "${id}" and the greeting matches its copy window`, async ({ page }) => {
      await boot(page, { clock: atTime(time), calm: true });
      await expect(html(page)).toHaveAttribute('data-sky-phase', id);
      const [top, mid, hor] = SKY[id]!;
      expect((await rootVar(page, '--sky-top')).toUpperCase()).toBe(top);
      expect((await rootVar(page, '--sky-mid')).toUpperCase()).toBe(mid);
      expect((await rootVar(page, '--sky-horizon')).toUpperCase()).toBe(hor);
      const dark = ['latenight', 'dusk', 'evening', 'night'].includes(id);
      await expect(html(page)).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
      await expect(html(page)).toHaveAttribute('data-theme-mode', 'sky');
      const greeting = ((await page.getByTestId('greeting').textContent()) ?? '').trim();
      expect(lines(WINDOW_AT[time]!), `${time} greeting "${greeting}"`).toContain(greeting);
      expect(greeting).not.toMatch(BANNED);
      if (WINDOW_AT[time] === 'night') expect(greeting.toLowerCase()).toContain('night');
      await expect(page.getByTestId('greeting-sub')).toHaveCount(0); // Timer simplification: the subline chip is gone
      // the ink on the sky: navy by day, white at night (design 2.2)
      expect((await rootVar(page, '--sky-ink')).toUpperCase()).toBe(dark ? '#FFFFFF' : '#10263F');
    });
  }
});

test.describe('SKY-3 / SKY-4 night and noon', () => {
  test('SKY-3 at 02:00: latenight, dark, moon visible, no sun, stars at least 0.9, night greeting without banned words', async ({ page }) => {
    await boot(page, { clock: atTime('02:00'), calm: true });
    await expect(html(page)).toHaveAttribute('data-sky-phase', 'latenight');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    expect(Number(await rootVar(page, '--sky-star-opacity'))).toBeGreaterThanOrEqual(0.9);
    expect((await body(page, 'moon'))!.display).not.toBe('none');
    expect((await body(page, 'sun'))!.display).toBe('none');
    const g = ((await page.getByTestId('greeting').textContent()) ?? '').trim();
    expect(g.toLowerCase()).toContain('night');
    expect(g).not.toMatch(BANNED);
    await expect(page.getByTestId('sky-stars')).toBeVisible();
  });

  test('SKY-4 at 12:30: midday, light, sun visible with its centre at 45 to 55% of the width, no stars, no moon', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), calm: true });
    await expect(html(page)).toHaveAttribute('data-sky-phase', 'midday');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    expect(Number(await rootVar(page, '--sky-star-opacity'))).toBe(0);
    const sun = (await body(page, 'sun'))!;
    expect(sun.display).not.toBe('none');
    expect(sun.cx / sun.vw).toBeGreaterThanOrEqual(0.45);
    expect(sun.cx / sun.vw).toBeLessThanOrEqual(0.55);
    expect((await body(page, 'moon'))!.display).toBe('none');
    await expect(page.getByTestId('sky-stars')).toBeHidden();
  });
});

test.describe('SKY-5 blending', () => {
  test('10:30 is the OKLab midpoint of morning and midday, and 10:10 differs from 10:00', async ({ browser, baseURL }) => {
    const topAt = async (hhmm: string) => {
      const ctx = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
      const page = await ctx.newPage();
      await boot(page, { clock: atTime(hhmm) });
      const v = await rootVar(page, '--sky-top');
      await ctx.close();
      return v;
    };
    const mid = rgbHex(mixOklab(hexRgb('#6EB8F2'), hexRgb('#4FA8EE'), 0.5));
    const t1030 = await topAt('10:30');
    expect(near(t1030, mid, 1), `${t1030} vs ${mid}`).toBe(true);
    expect((await topAt('10:10')).toUpperCase()).not.toBe((await topAt('10:00')).toUpperCase());
  });
});

test.describe('SKY-6 cadence', () => {
  test('the sky properties are rewritten once a minute, and once at once when the page becomes visible', async ({ page }) => {
    await boot(page, {
      clock: atTime('12:30'), stubs: true,
      init: `(() => { window.__skyWrites = 0; document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(() => { window.__skyWrites++; }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] }); }); })();`,
    });
    const writes = () => page.evaluate(() => (window as any).__skyWrites as number);
    await page.waitForTimeout(50);
    const w0 = await writes();
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.clock.runFor(MIN);
      await page.waitForTimeout(30);
      seen.push((await writes()) - (i === 0 ? w0 : seen.reduce((a, b) => a + b, w0)));
    }
    // a write is one batch of property updates: 1 per minute, never more than 2 in any 60 s window
    for (const n of seen) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
    const before = await writes();
    await setHidden(page, true);
    await page.clock.runFor(2 * MIN);
    await setHidden(page, false);
    await page.waitForTimeout(50);
    expect(await writes()).toBeGreaterThan(before); // the immediate write on return
  });
});

test.describe('SKY-7 arcs', () => {
  test('at 06:00 the sun is low: its centre is within 15% of the viewport height of the back-hill top', async ({ page }) => {
    await boot(page, { clock: atTime('06:00') });
    const sun = (await body(page, 'sun'))!;
    const hillTop = sun.vh - backHill(sun.vh);
    expect(Math.abs(sun.cy - hillTop)).toBeLessThanOrEqual(0.15 * sun.vh);
  });

  for (const [time] of KEYFRAME_TIMES) {
    test(`at ${time} neither body enters the header band`, async ({ page }) => {
      await boot(page, { clock: atTime(time) });
      for (const k of ['sun', 'moon'] as const) {
        const b = await body(page, k);
        if (!b || b.display === 'none') continue;
        expect(b.top, `${k} top at ${time}`).toBeGreaterThan(band(b.vw));
      }
    });
  }

  test('the sun is rendered 05:30 to 19:30 and the moon 19:00 to 06:30', async ({ browser, baseURL }) => {
    const cases: Array<[string, boolean, boolean]> = [
      ['05:29', false, true], ['05:35', true, true], ['12:00', true, false], ['19:10', true, true], ['19:31', false, true], ['22:00', false, true],
      ['06:25', true, true], ['06:31', true, false],
    ];
    for (const [t, sun, moon] of cases) {
      const ctx = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
      const page = await ctx.newPage();
      await boot(page, { clock: atTime(t) });
      expect((await body(page, 'sun'))!.display !== 'none', `sun at ${t}`).toBe(sun);
      expect((await body(page, 'moon'))!.display !== 'none', `moon at ${t}`).toBe(moon);
      await ctx.close();
    }
  });
});

test.describe('SKY-9 polarity flips at 05:15 and 17:00', () => {
  for (const [t, pol] of [['05:14', 'dark'], ['05:15', 'light'], ['16:59', 'light'], ['17:00', 'dark']] as const) {
    test(`${t} is ${pol}`, async ({ page }) => {
      await boot(page, { clock: atTime(t) });
      await expect(html(page)).toHaveAttribute('data-theme', pol);
    });
  }

  test('the flip happens live, without a reload: 16:59:30 becomes dark at 17:00', async ({ page }) => {
    await boot(page, { clock: new Date('2026-10-14T16:59:20-07:00') });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await page.clock.runFor(MIN);
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    // and the cards cross-fade (a 600 ms transition on the card background)
    const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.card') ?? document.body).transitionDuration);
    expect(dur).toMatch(/0\.6s|600ms/);
  });
});

test.describe('SKY-14 theme-color follows the sky', () => {
  test('the meta tag equals --sky-top and updates when the sky moves', async ({ page }) => {
    await boot(page, { clock: atTime('12:30') });
    const meta = () => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '');
    expect((await meta()).toUpperCase()).toBe('#4FA8EE');
    expect((await meta()).toUpperCase()).toBe((await rootVar(page, '--sky-top')).toUpperCase());
    await page.clock.fastForward(10.5 * 60 * MIN); // 23:00
    await expect.poll(async () => (await meta()).toUpperCase()).toBe('#0B1430');
    expect((await meta()).toUpperCase()).toBe((await rootVar(page, '--sky-top')).toUpperCase());
  });
  test('at every keyframe time the meta tag is the sky top', async ({ browser, baseURL }) => {
    for (const [t, id] of KEYFRAME_TIMES) {
      const ctx = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' });
      const page = await ctx.newPage();
      await boot(page, { clock: atTime(t) });
      const meta = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '');
      expect(meta.toUpperCase(), id).toBe(SKY[id]![0]);
      await ctx.close();
    }
  });
});

test.describe('THEME-2 / THEME-3 the fixed modes', () => {
  test('THEME-2 Always light at 02:00: midday sky, light, the sun at its apex, but a night greeting', async ({ page }) => {
    await boot(page, { clock: atTime('02:00'), seed: v2doc({ theme: 'light' }), calm: true });
    await expect(html(page)).toHaveAttribute('data-sky-phase', 'midday');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(html(page)).toHaveAttribute('data-theme-mode', 'light');
    const sun = (await body(page, 'sun'))!;
    expect(sun.display).not.toBe('none');
    expect(Math.abs(sun.cx / sun.vw - 0.5)).toBeLessThan(0.02);
    expect((await body(page, 'moon'))!.display).toBe('none');
    const g = ((await page.getByTestId('greeting').textContent()) ?? '').trim();
    expect(lines('night')).toContain(g);
    // the mascot follows the sky shown: no headlamp
    await expect(page.getByTestId('mascot')).toHaveAttribute('data-accessory', 'none');
  });

  test('THEME-3 Always dark at 12:30: the 02:30 sky (fix round, was 23:00), dark, moon and stars, headlamp mascot, an afternoon greeting', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), seed: v2doc({ theme: 'dark' }), calm: true });
    await expect(html(page)).toHaveAttribute('data-sky-phase', 'latenight');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    expect(Number(await rootVar(page, '--sky-star-opacity'))).toBe(1);
    expect((await body(page, 'moon'))!.display).not.toBe('none');
    expect((await body(page, 'sun'))!.display).toBe('none');
    await expect(page.getByTestId('mascot')).toHaveAttribute('data-accessory', 'headlamp');
    expect(lines('afternoon')).toContain(((await page.getByTestId('greeting').textContent()) ?? '').trim());
    expect((await rootVar(page, '--sky-top')).toUpperCase()).toBe('#070D22');
  });

  test('switching modes in Settings takes effect at once, without a reload, and persists', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), route: 'settings', calm: true });
    await expect(html(page)).toHaveAttribute('data-sky-phase', 'midday');
    await page.getByTestId('settings-theme-dark').click();
    await expect(html(page)).toHaveAttribute('data-sky-phase', 'latenight');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme-mode', 'dark');
    await expect(html(page)).toHaveAttribute('data-sky-phase', 'latenight');
    await page.getByTestId('settings-theme-sky').click();
    await expect(html(page)).toHaveAttribute('data-sky-phase', /^(midday|afternoon)$/);
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('SKY-15 performance rules', () => {
  test('no canvas is attached on any screen', async ({ page }) => {
    await boot(page, { clock: atTime('12:30') });
    for (const r of ROUTES) {
      await go(page, r);
      expect(await page.locator('canvas').count()).toBe(0);
    }
  });

  test('with the page hidden every animation in the scene, mascot and stickers is paused, no sticker is added, and they resume on return', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), stubs: true, calm: true, route: 'timer' });
    const states = () =>
      page.evaluate(() => {
        const sel = '[data-testid="sky"], .mascot, [data-testid="sticker-layer"], [data-testid="sticker-burst"]';
        const mine = document.getAnimations().filter((a) => {
          const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
          return !!t && !!t.closest(sel) && a instanceof CSSAnimation;
        });
        return { n: mine.length, running: mine.filter((a) => a.playState === 'running').length, paused: mine.filter((a) => a.playState === 'paused').length };
      });
    const visible = await states();
    expect(visible.running, 'animations run while visible').toBeGreaterThan(3);
    await setHidden(page, true);
    await expect(html(page)).toHaveAttribute('data-hidden', '');
    await page.waitForTimeout(100);
    const hidden = await states();
    expect(hidden.running).toBe(0);
    expect(hidden.paused).toBe(hidden.n);
    await page.clock.fastForward(5 * MIN);
    expect(await page.getByTestId('sticker').count()).toBe(0);
    await setHidden(page, false);
    await expect(html(page)).not.toHaveAttribute('data-hidden', /.*/);
    await page.waitForTimeout(100);
    expect((await states()).running).toBeGreaterThan(3);
  });
});

test.describe('SKY-16 reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no animation runs in the scene, the mascot or the sticker layers, on any screen, and no sticker drifts in', async ({ page }) => {
    await boot(page, { clock: atTime('23:00'), calm: true });
    const running = () =>
      page.evaluate(() => {
        const sel = '[data-testid="sky"], .mascot, [data-testid="sticker-layer"], [data-testid="sticker-burst"]';
        return document
          .getAnimations()
          .filter((a) => {
            const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
            return !!t && !!t.closest(sel) && a.playState === 'running' && a instanceof CSSAnimation;
          })
          .map((a) => `${(a as CSSAnimation).animationName} on ${((a.effect as KeyframeEffect).target as Element).className}`);
      });
    for (const r of ROUTES) {
      await go(page, r);
      expect(await running(), r).toEqual([]);
    }
    await go(page, 'timer');
    await page.getByTestId('timer-play').click();
    await page.clock.runFor(1000);
    expect(await running(), 'focusing').toEqual([]);
    await page.clock.fastForward(10 * MIN);
    expect(await page.getByTestId('sticker').count()).toBe(0);
  });

  test('a finished session shows 3 static stickers instead of the burst, which clear', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    const burst = page.getByTestId('sticker-burst');
    await expect(burst).toBeAttached();
    await expect(burst.getByTestId('sticker')).toHaveCount(3);
    await page.clock.runFor(2600);
    await expect(burst).toHaveCount(0);
  });
});

test.describe('fixture sanity', () => {
  test('the v1 fixture seeds fine through the migration (light becomes the sky)', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), seed: fixture('backup-valid.json') });
    await expect(html(page)).toHaveAttribute('data-theme-mode', 'sky');
  });
});
