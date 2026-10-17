import { expect, test, type Page } from '@playwright/test';
import { MIN, ROUTES, atTime, boot, controlsOverlapping, docWithSessions, emptyDoc, go, isMobile, v2doc } from './helpers';

const mascot = (page: Page) => page.getByTestId('mascot');
const state = (page: Page) => mascot(page).getAttribute('data-state');
const NOW = atTime('12:30');
const MASCOTS = '[data-testid="mascot"], [data-testid="mascot-empty"]';

/** Painted extent of a mascot: the headlamp beam, sparkles and the wave arm reach outside its layout box. */
async function paintedOverlaps(page: Page): Promise<string[]> {
  return page.evaluate((interactive) => {
    const out: string[] = [];
    for (const m of document.querySelectorAll<SVGElement>('[data-testid="mascot"], [data-testid="mascot-empty"]')) {
      const r = m.getBoundingClientRect();
      if (r.width === 0) continue;
      const k = r.width / 120;
      const mirrored = m.classList.contains('mascot--mirror');
      // viewBox 0..120 x 0..90; the extras reach x -8..145 and y -14..90
      const left = mirrored ? r.right - 145 * k : r.left - 8 * k;
      const right = mirrored ? r.right + 8 * k : r.left + 145 * k;
      const top = r.top - 14 * k;
      const bottom = r.bottom;
      for (const el of document.querySelectorAll<HTMLElement>(interactive)) {
        if (el.closest('.sr-only, [hidden], .skip, .mascot')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || (el as HTMLInputElement).type === 'file') continue;
        const host = el.tagName === 'INPUT' && el.closest('label') ? el.closest<HTMLElement>('label')! : el;
        const b = host.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (left < b.right - 0.5 && right > b.left + 0.5 && top < b.bottom - 0.5 && bottom > b.top + 0.5)
          out.push(`${m.getAttribute('data-testid')} painted [${Math.round(left)},${Math.round(top)},${Math.round(right - left)}x${Math.round(bottom - top)}] over ${host.tagName.toLowerCase()}[${(host.getAttribute('data-testid') || host.textContent || '').trim().slice(0, 24)}]`);
      }
    }
    return out;
  }, (await import('./helpers')).INTERACTIVE_SELECTOR);
}

test.describe('MASCOT-1 present, decorative, and never over a control', () => {
  test('on Timer by default: one mascot, aria-hidden, no pointer events', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true });
    await expect(mascot(page)).toHaveCount(1);
    await expect(mascot(page)).toBeVisible();
    await expect(mascot(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(mascot(page)).toHaveAttribute('focusable', 'false');
    expect(await mascot(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  });

  for (const route of ROUTES) {
    for (const [label, settings] of [['day', {}], ['Always dark (headlamp)', { theme: 'dark' }]] as const) {
      test(`${route}, ${label}: the mascot's box and its painted extent intersect no button, link, input or select`, async ({ page }) => {
        await boot(page, { clock: NOW, seed: v2doc(settings), route, calm: true });
        await expect(page.getByTestId('nav-timer').first()).toBeVisible();
        if (route !== 'timer') await expect(mascot(page)).toBeVisible();
        await page.waitForTimeout(300);
        expect(await controlsOverlapping(page, MASCOTS)).toEqual([]);
        expect(await paintedOverlaps(page)).toEqual([]);
        await expect(mascot(page)).toHaveAttribute('aria-hidden', 'true');
      });
    }
  }

  test('Timer while running, in a break with a prompt, and after a completion: still clear of every control', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true, seed: v2doc({ theme: 'dark' }) });
    await page.getByTestId('timer-play').click();
    await page.clock.runFor(3000);
    expect(await controlsOverlapping(page, MASCOTS), 'running').toEqual([]);
    expect(await paintedOverlaps(page), 'running painted').toEqual([]);
    await page.clock.fastForward(25 * MIN);
    await expect(page.getByTestId('break-prompt')).toBeVisible();
    await page.waitForTimeout(200);
    expect(await controlsOverlapping(page, MASCOTS), 'break').toEqual([]);
    expect(await paintedOverlaps(page), 'break painted').toEqual([]);
  });

  test('first-run empty states: the decorative mascots sit clear of the Add button and the controls', async ({ page }) => {
    await boot(page, { clock: NOW, seed: emptyDoc(), route: 'tasks', calm: true });
    await expect(page.getByTestId('mascot-empty')).toBeVisible();
    expect(await controlsOverlapping(page, MASCOTS)).toEqual([]);
    await go(page, 'stats');
    await expect(page.getByTestId('mascot-empty')).toBeVisible();
    expect(await controlsOverlapping(page, MASCOTS)).toEqual([]);
  });

  test('the layout holds at 360 and 1024 wide too (header mascot never over Play, the mode switcher or the nav)', async ({ page }, info) => {
    await boot(page, { clock: NOW, calm: true, seed: v2doc({ theme: 'dark' }) });
    for (const size of isMobile(info.project) ? [{ width: 360, height: 740 }, { width: 414, height: 896 }] : [{ width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 900, height: 700 }, { width: 899, height: 700 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      expect(await controlsOverlapping(page, MASCOTS), `${size.width}`).toEqual([]);
      expect(await paintedOverlaps(page), `${size.width} painted`).toEqual([]);
    }
  });
});

test.describe('MASCOT-2 Doodle Cloud states (v3: shrug and thumbs added)', () => {
  const STATES = ['idle', 'focusing', 'break', 'celebrate', 'wave', 'shrug', 'thumbs'];

  test('the empty Tasks and Stats mascots shrug, never wear the headlamp, and stay out of the accessibility tree', async ({ page }) => {
    for (const theme of ['sky', 'dark'] as const) {
      await boot(page, { clock: atTime(theme === 'dark' ? '02:30' : '12:30'), seed: emptyDoc({ theme }), route: 'tasks', calm: true });
      for (const r of ['tasks', 'stats'] as const) {
        await go(page, r);
        const m = page.getByTestId('mascot-empty');
        await expect(m, `${r} ${theme}`).toBeVisible();
        await expect(m).toHaveAttribute('data-state', 'shrug');
        await expect(m).toHaveAttribute('data-accessory', 'none');
        await expect(m).toHaveAttribute('aria-hidden', 'true');
        await expect(m).toHaveAttribute('focusable', 'false');
      }
    }
  });

  test('the shrug disappears when the mascot setting is off', async ({ page }) => {
    await boot(page, { clock: NOW, seed: emptyDoc({ mascot: false }), route: 'tasks', calm: true });
    await expect(page.getByTestId('mascot-empty')).toHaveCount(0);
  });

  test('across a whole session the Timer mascot only shows data-state values from the Doodle Cloud set, and the first load waves', async ({ page }) => {
    await boot(page, { clock: NOW, freeze: true, seed: v2doc() });
    const seen = new Set<string>();
    const grab = async () => seen.add((await state(page)) ?? 'none');
    await grab();
    await page.clock.runFor(2500);
    await grab();
    await page.getByTestId('timer-play').click();
    await page.clock.runFor(1000);
    await grab();
    await page.clock.fastForward(25 * MIN + 250);
    await grab();
    await page.clock.runFor(2500);
    await grab();
    expect([...seen].every((s) => STATES.includes(s)), [...seen].join(',')).toBe(true);
    for (const s of ['wave', 'idle', 'focusing', 'celebrate', 'break']) expect(seen, s).toContain(s);
  });

  test('the Doodle Cloud box is 0.875 as tall as wide, its viewBox is 160x140 and it carries no text node', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true, seed: v2doc() });
    const g = await page.getByTestId('mascot').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { ratio: r.height / r.width, text: el.querySelectorAll('text').length, vb: el.getAttribute('viewBox') };
    });
    expect(g.vb).toBe('0 0 160 140');
    expect(g.ratio).toBeCloseTo(0.875, 2);
    expect(g.text).toBe(0);
  });
});

test.describe('MASCOT-2 face states', () => {
  test('idle with the focus phase idle, focusing while it runs, idle again when paused', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true });
    expect(await state(page)).toBe('idle');
    await page.getByTestId('timer-play').click();
    await expect(mascot(page)).toHaveAttribute('data-state', 'focusing');
    await page.getByTestId('timer-play').click(); // pause
    await expect(mascot(page)).toHaveAttribute('data-state', 'idle');
    await page.getByTestId('timer-play').click();
    await expect(mascot(page)).toHaveAttribute('data-state', 'focusing');
  });

  test('break: any short or long break shows the break face, running or not; focus again returns to idle', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true });
    await page.getByTestId('mode-short').click();
    await expect(mascot(page)).toHaveAttribute('data-state', 'break');
    await page.getByTestId('timer-play').click();
    await expect(mascot(page)).toHaveAttribute('data-state', 'break');
    await page.getByTestId('timer-play').click();
    await page.getByTestId('mode-long').click();
    await expect(mascot(page)).toHaveAttribute('data-state', 'break');
    await page.getByTestId('mode-focus').click();
    await expect(mascot(page)).toHaveAttribute('data-state', 'idle');
  });

  test('a finished focus session: celebrate at once, for 1.6 s, then the break face', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(mascot(page)).toHaveAttribute('data-state', 'celebrate');
    await page.clock.runFor(600);
    await expect(mascot(page)).toHaveAttribute('data-state', 'celebrate');
    await page.clock.runFor(1500); // 2 s or more in: past the 1.6 s mark (the fake clock also advances with real time)
    await expect(mascot(page)).toHaveAttribute('data-state', 'break');
  });

  test('skip does not celebrate', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.runFor(2000);
    await page.getByTestId('timer-skip').click();
    await expect(mascot(page)).not.toHaveAttribute('data-state', 'celebrate');
  });

  test('first open of a study day waves for 1.8 s, then settles; a reload the same day does not wave again', async ({ page }) => {
    await boot(page, { clock: NOW, freeze: true }); // the wave is time-boxed, so hold the clock while the page loads
    await expect(mascot(page)).toHaveAttribute('data-state', 'wave');
    await page.clock.runFor(800);
    await expect(mascot(page)).toHaveAttribute('data-state', 'wave');
    await page.clock.runFor(1400); // well past 1.8 s
    await expect(mascot(page)).toHaveAttribute('data-state', 'idle');
    await page.reload();
    await expect(mascot(page)).toBeVisible();
    await page.clock.runFor(100);
    await expect(mascot(page)).toHaveAttribute('data-state', 'idle');
  });

  test('a new study day waves again (yesterday was the last wave)', async ({ page }) => {
    await boot(page, { clock: NOW, init: `localStorage.setItem('em-time:ui', JSON.stringify({ lastWaveDay: '2026-10-13' }));` });
    await expect(mascot(page)).toHaveAttribute('data-state', 'wave');
    // the study day turns over at 06:00, so 02:00 still belongs to the day before and does not wave again
  });

  test('02:00 belongs to the previous study day: no new wave after midnight', async ({ page }) => {
    await boot(page, { clock: atTime('02:00', '2026-10-15'), init: `localStorage.setItem('em-time:ui', JSON.stringify({ lastWaveDay: '2026-10-14' }));` });
    await expect(mascot(page)).toBeVisible();
    await page.clock.runFor(100);
    await expect(mascot(page)).toHaveAttribute('data-state', 'idle');
  });

  test('a streak milestone (the 7th day in a row): celebrate for 1.6 s, then wave for 1.8 s, then the break face', async ({ page }) => {
    const days: Array<[string, number]> = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map((d) => [d, 1]);
    const doc = docWithSessions(days);
    doc.meta.milestonesShown = [];
    await boot(page, { clock: NOW, calm: true, seed: doc });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('message-line')).toContainText('Seven days in a row');
    await expect(mascot(page)).toHaveAttribute('data-state', 'celebrate');
    await page.clock.runFor(1700);
    await expect(mascot(page)).toHaveAttribute('data-state', 'wave');
    await page.clock.runFor(1800);
    await expect(mascot(page)).toHaveAttribute('data-state', 'break');
  });

  test('a count milestone (the 10th session) celebrates but does not wave', async ({ page }) => {
    const doc = docWithSessions([['2026-10-01', 3], ['2026-10-03', 3], ['2026-10-05', 3]]);
    doc.meta.milestonesShown = [];
    await boot(page, { clock: NOW, calm: true, seed: doc });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('message-line')).toContainText('Ten sessions');
    await expect(mascot(page)).toHaveAttribute('data-state', 'celebrate');
    await page.clock.runFor(1700);
    await expect(mascot(page)).toHaveAttribute('data-state', 'break');
  });

  test('on Tasks, Stats and Settings the small page mascot only ever idles or waves', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true, route: 'tasks' });
    await page.getByTestId('timer-play').click({ trial: true }).catch(() => undefined);
    for (const r of ['tasks', 'stats', 'settings'] as const) {
      await go(page, r);
      expect(['idle', 'wave']).toContain(await state(page));
    }
  });
});

test.describe('MASCOT-3 night alert', () => {
  for (const [label, time, settings] of [['02:00 (Follow the sky)', '02:00', {}], ['12:30 with Always dark', '12:30', { theme: 'dark' }], ['23:00', '23:00', {}], ['18:00 (dusk, dark polarity)', '18:00', {}]] as const) {
    test(`${label}: headlamp, wide eyes in idle and focusing, no closed-eye or Zzz asset`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc(settings), calm: true });
      await expect(mascot(page)).toHaveAttribute('data-accessory', 'headlamp');
      const visibleEyes = () =>
        mascot(page).evaluate((svg) =>
          [...svg.querySelectorAll<SVGGElement>('.m-eyes')].filter((g) => getComputedStyle(g).display !== 'none').map((g) => [...g.classList].find((c) => c.startsWith('m-eyes--'))),
        );
      expect(await visibleEyes()).toEqual(['m-eyes--wide']);
      expect(await mascot(page).evaluate((svg) => getComputedStyle(svg.querySelector('.m-lamp')!).display)).not.toBe('none');
      await page.getByTestId('timer-play').click();
      await expect(mascot(page)).toHaveAttribute('data-state', 'focusing');
      expect(await visibleEyes()).toEqual(['m-eyes--wide']);
      // no sleep asset anywhere: no "Zzz" text, no closed-eye group other than the blink
      const svg = await mascot(page).evaluate((el) => el.outerHTML);
      expect(svg).not.toMatch(/z{2,}/i);
      expect(svg).not.toMatch(/sleep|closed|zzz/i);
      expect(await mascot(page).evaluate((el) => el.querySelectorAll('text').length)).toBe(0);
    });
  }

  test('by day: no headlamp, the ordinary open eyes', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true });
    await expect(mascot(page)).toHaveAttribute('data-accessory', 'none');
    const eyes = await mascot(page).evaluate((svg) => [...svg.querySelectorAll<SVGGElement>('.m-eyes')].filter((g) => getComputedStyle(g).display !== 'none').map((g) => [...g.classList].find((c) => c.startsWith('m-eyes--'))));
    expect(eyes).toEqual(['m-eyes--open']);
    expect(await mascot(page).evaluate((svg) => getComputedStyle(svg.querySelector('.m-lamp')!).display)).toBe('none');
  });

  test('the accessory flips with the polarity live, at 17:00', async ({ page }) => {
    await boot(page, { clock: new Date('2026-10-14T16:59:20-07:00'), calm: true });
    await expect(mascot(page)).toHaveAttribute('data-accessory', 'none');
    await page.clock.runFor(MIN);
    await expect(mascot(page)).toHaveAttribute('data-accessory', 'headlamp');
  });
});

test.describe('MASCOT-4 Cloud friend off', () => {
  test('no mascot on any screen, and it stays off after a reload', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true, route: 'settings' });
    await page.getByTestId('settings-mascot').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('em-time:data')!).settings.mascot)).toBe(false);
    for (const r of ROUTES) {
      await go(page, r);
      await expect(page.getByTestId('mascot')).toHaveCount(0);
      await expect(page.getByTestId('mascot-empty')).toHaveCount(0);
    }
    await page.reload();
    await expect(page.getByTestId('mascot')).toHaveCount(0);
  });

  test('at 390 the greeting gets the full header width: no empty slot is kept (a long name wraps less with the mascot off)', async ({ browser, baseURL }, info) => {
    test.skip(!isMobile(info.project), 'the phone header is the only place the mascot shares a row with the greeting');
    const long = 'Wolfeschlegelstein';
    const measure = async (mascotOn: boolean) => {
      const ctx = await browser.newContext({ ...info.project.use, baseURL });
      const page = await ctx.newPage();
      await boot(page, { clock: NOW, calm: true, seed: v2doc({ displayName: long, mascot: mascotOn }) });
      await expect(page.getByTestId('greeting')).toContainText(long);
      const h = await page.evaluate(() => {
        const g = document.querySelector('[data-testid="greeting"]') as HTMLElement;
        const head = g.closest('header')!;
        return { greeting: g.getBoundingClientRect().height, children: head.children.length, headW: head.getBoundingClientRect().width, textW: (g.parentElement as HTMLElement).getBoundingClientRect().width };
      });
      await ctx.close();
      return h;
    };
    const on = await measure(true);
    const off = await measure(false);
    // v5: the Sounds chip left the header again (phone: under the play controls), so it is greeting (+ the cloud)
    expect(on.children).toBe(2);
    expect(off.children).toBe(1);
    expect(off.greeting).toBeLessThan(on.greeting); // fewer lines
    expect(off.textW).toBeGreaterThan(on.textW + 40);
  });

  test('the brand glyph in the nav is not the cloud friend and stays', async ({ page }) => {
    await boot(page, { clock: NOW, seed: v2doc({ mascot: false }) });
    await expect(page.getByTestId('mascot')).toHaveCount(0);
    expect(await page.getByTestId('mascot-glyph').count()).toBeGreaterThan(0);
  });

  test('turning it back on shows it without a reload', async ({ page }) => {
    await boot(page, { clock: NOW, seed: v2doc({ mascot: false }), route: 'settings' });
    await expect(page.getByTestId('mascot')).toHaveCount(0);
    await page.getByTestId('settings-mascot').click();
    await expect(page.getByTestId('mascot')).toHaveCount(1);
  });
});

test.describe('MASCOT-5 reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('data-state still changes as in MASCOT-2 but nothing animates on the mascot', async ({ page }) => {
    await boot(page, { clock: NOW, calm: true });
    const running = () =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a instanceof CSSAnimation && ((a.effect as KeyframeEffect).target as Element | null)?.closest('.mascot')).length);
    expect(await state(page)).toBe('idle');
    expect(await running()).toBe(0);
    await page.getByTestId('timer-play').click();
    await expect(mascot(page)).toHaveAttribute('data-state', 'focusing');
    expect(await running()).toBe(0);
    await page.clock.fastForward(25 * MIN + 250);
    await expect(mascot(page)).toHaveAttribute('data-state', 'celebrate');
    expect(await running()).toBe(0);
    await page.clock.runFor(1700);
    await expect(mascot(page)).toHaveAttribute('data-state', 'break');
    // the celebrate open smile is still the visible mouth during the state (instant swap)
  });
});

test.describe('MASCOT-6 the mascot carries no information', () => {
  for (const route of ROUTES) {
    test(`${route}: the accessibility tree is identical with the mascot on and off`, async ({ browser, baseURL }, info) => {
      const snap = async (mascotOn: boolean) => {
        const ctx = await browser.newContext({ ...info.project.use, baseURL });
        const page = await ctx.newPage();
        await boot(page, { clock: NOW, calm: true, seed: v2doc({ mascot: mascotOn }), route });
        await page.waitForTimeout(300);
        // the sanity check that the two runs really differ: the mascot is there, or it is not
        expect(await page.getByTestId('mascot').count()).toBe(mascotOn ? 1 : 0);
        // the only legitimate difference: the "Cloud friend" switch itself reports its own state
        const tree = (await page.locator('body').ariaSnapshot()).replace('switch "Cloud friend" [checked]', 'switch "Cloud friend"');
        await ctx.close();
        return tree;
      };
      const on = await snap(true);
      const off = await snap(false);
      expect(off).toBe(on);
    });
  }
});
