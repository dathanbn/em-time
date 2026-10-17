import { expect, test, type Page } from '@playwright/test';
import { MIN, atTime, boot, docWithSessions, isMobile, setHidden, v2doc } from './helpers';

const NOW = atTime('12:30');
const layer = (page: Page) => page.getByTestId('sticker-layer');
const drifting = (page: Page) => layer(page).getByTestId('sticker');
const burst = (page: Page) => page.getByTestId('sticker-burst');

/** Records, in fake-clock seconds since load, when each drifting sticker is added and removed, and the peak on screen. */
const LOG = `
(() => {
  const t0 = Date.now();
  window.__log = { added: [], removed: [], peak: 0, perAdd: [] };
  document.addEventListener('DOMContentLoaded', () => {
    const l = document.querySelector('[data-testid="sticker-layer"]');
    new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) if (n.nodeType === 1) { window.__log.added.push((Date.now() - t0) / 1000); window.__log.perAdd.push(n.dataset.emoji); }
        for (const n of r.removedNodes) if (n.nodeType === 1) window.__log.removed.push((Date.now() - t0) / 1000);
      }
      window.__log.peak = Math.max(window.__log.peak, l.querySelectorAll('[data-testid="sticker"]').length);
    }).observe(l, { childList: true });
  });
})();
`;
const readLog = (page: Page) => page.evaluate(() => (window as any).__log as { added: number[]; removed: number[]; peak: number; perAdd: string[] });
/** Jumps in `step` second hops (each due timer fires once per hop): cheap while the focus ring is redrawing. */
async function hop(page: Page, seconds: number, step = 10) {
  for (let t = 0; t < seconds; t += step) await page.clock.fastForward(step * 1000);
}
async function advance(page: Page, seconds: number, step = 5) {
  for (let t = 0; t < seconds; t += step) await page.clock.runFor(step * 1000);
}

test.describe('STICKER-2 drift cadence (seeded random, fake clock)', () => {
  test('the first sticker after 20 to 40 s, then one every 45 to 90 s; never more than 3 (2 on phone); each is removed when it finishes', async ({ page }, info) => {
    await boot(page, { clock: NOW, rng: 1, init: LOG, calm: true });
    await advance(page, 20 * 60);
    const log = await readLog(page);
    expect(log.added.length).toBeGreaterThanOrEqual(12);
    expect(log.added[0]!).toBeGreaterThanOrEqual(19.5);
    expect(log.added[0]!).toBeLessThanOrEqual(40.5);
    const gaps = log.added.slice(1).map((t, i) => t - log.added[i]!);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(44.5);
      expect(g).toBeLessThanOrEqual(90.5);
    }
    expect(log.peak).toBeLessThanOrEqual(isMobile(info.project) ? 2 : 3);
    // every sticker that was added more than 50 s ago is gone: 30 to 42 s of drift, plus the 1.5 s fallback
    const settled = log.removed.length;
    expect(settled).toBeGreaterThanOrEqual(log.added.length - 1);
    expect(await drifting(page).count()).toBeLessThanOrEqual(1);
    // no emoji appears twice in a row
    for (let i = 1; i < log.perAdd.length; i++) expect(log.perAdd[i]).not.toBe(log.perAdd[i - 1]);
  });

  test('while a focus phase runs: at most 1 on screen, and spawns 120 to 240 s apart', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 2, init: LOG, calm: true });
    await page.getByTestId('timer-play').click();
    await hop(page, 20 * 60, 10); // 10 s hops: the focus ring redraws every frame, so runFor would be slow
    const log = await readLog(page);
    expect(log.added.length).toBeGreaterThanOrEqual(4);
    const gaps = log.added.slice(1).map((t, i) => t - log.added[i]!);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(110); // measured on a 10 s grid
      expect(g).toBeLessThanOrEqual(250);
    }
    expect(log.peak).toBeLessThanOrEqual(1);
  });

  test('a drifting sticker is behind the content: inside the scene, aria-hidden, no pointer events, 30 px (26 on a phone)', async ({ page }, info) => {
    await boot(page, { clock: NOW, rng: 1, calm: true });
    await advance(page, 45);
    await expect(drifting(page).first()).toBeAttached();
    const info2 = await drifting(page).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      const inner = el.querySelector('.sticker__in') as HTMLElement;
      return { inScene: !!el.closest('[data-testid="sky"]'), aria: el.getAttribute('aria-hidden'), pe: cs.pointerEvents, fs: parseFloat(getComputedStyle(inner ?? el).fontSize), text: el.textContent, emoji: (el as HTMLElement).dataset.emoji };
    });
    expect(info2.inScene).toBe(true);
    expect(info2.aria).toBe('true');
    expect(info2.pe).toBe('none');
    expect(info2.fs).toBeGreaterThanOrEqual(isMobile(info.project) ? 25 : 29);
    expect(info2.fs).toBeLessThanOrEqual(isMobile(info.project) ? 27 : 31);
    expect(info2.text).toBe(info2.emoji);
  });
});

test.describe('STICKER-5 the completion burst', () => {
  test('a finished focus session: 12 stickers (9 on a phone) in the burst layer at once, centred on the bubble, gone within 1.6 s', async ({ page }, info) => {
    await boot(page, { clock: NOW, rng: 1, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(burst(page)).toBeAttached();
    const n = isMobile(info.project) ? 9 : 12;
    await expect(burst(page).getByTestId('sticker')).toHaveCount(n);
    const geo = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="sticker-burst"]') as HTMLElement;
      const bubble = document.querySelector('[data-testid="timer-bubble"]')!.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return {
        left: parseFloat(b.style.left), top: parseFloat(b.style.top),
        cx: bubble.left + bubble.width / 2, cy: bubble.top + bubble.height / 2,
        aria: b.getAttribute('aria-hidden'), pe: cs.pointerEvents, pos: cs.position, z: Number(cs.zIndex) || 0,
        emojis: [...b.querySelectorAll<HTMLElement>('[data-testid="sticker"]')].map((e) => e.dataset.emoji),
      };
    });
    expect(Math.abs(geo.left - geo.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(geo.top - geo.cy)).toBeLessThanOrEqual(2);
    expect(geo.aria).toBe('true');
    expect(geo.pe).toBe('none');
    expect(geo.pos).toBe('fixed');
    expect(geo.z).toBeGreaterThan(0);
    // picks avoid duplicates within one burst where the pools allow
    expect(new Set(geo.emojis).size).toBe(geo.emojis.length);
    expect(await page.locator('.confetti__p').count()).toBe(0);
    await page.clock.runFor(1700);
    await expect(burst(page)).toHaveCount(0);
  });

  test('a milestone makes it bigger: 18 stickers (14 on a phone), and no confetti', async ({ page }, info) => {
    const doc = docWithSessions([['2026-10-01', 3], ['2026-10-03', 3], ['2026-10-05', 3]]);
    doc.meta.milestonesShown = [];
    await boot(page, { clock: NOW, rng: 1, calm: true, seed: doc });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('message-line')).toContainText('Ten sessions');
    await expect(burst(page).getByTestId('sticker')).toHaveCount(isMobile(info.project) ? 14 : 18);
    expect(await page.locator('.confetti__p').count()).toBe(0);
  });

  test('fix round: each sticker starts on the bubble rim and lands 10 to 80 px outside it (clamped to the viewport), so none rests on the digits', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 2, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(burst(page)).toBeAttached();
    const g = await page.evaluate(() => {
      const bubble = document.querySelector('[data-testid="timer-bubble"]')!.getBoundingClientRect();
      const cx = bubble.left + bubble.width / 2;
      const cy = bubble.top + bubble.height / 2;
      const px = (e: HTMLElement, n: string) => parseFloat(e.style.getPropertyValue(n));
      return {
        rim: bubble.width / 2, vw: innerWidth, vh: innerHeight, cx, cy,
        s: [...document.querySelectorAll<HTMLElement>('[data-testid="sticker-burst"] [data-testid="sticker"]')].map((e) => ({
          sx: px(e, '--sx'), sy: px(e, '--sy'), dx: px(e, '--dx'), dy: px(e, '--dy'),
        })),
      };
    });
    expect(g.s.length).toBeGreaterThan(0);
    let unclamped = 0;
    for (const t of g.s) {
      expect(Math.hypot(t.sx, t.sy), 'start distance is the rim').toBeLessThanOrEqual(g.rim + 2);
      expect(Math.hypot(t.sx, t.sy), 'start distance is the rim').toBeGreaterThanOrEqual(g.rim - 2);
      const x = g.cx + t.dx;
      const y = g.cy + t.dy;
      expect(x, 'landing x inside the viewport').toBeGreaterThanOrEqual(23);
      expect(x).toBeLessThanOrEqual(g.vw - 23);
      expect(y).toBeGreaterThanOrEqual(23);
      expect(y).toBeLessThanOrEqual(g.vh - 23);
      // the animation ends at 1.1x the offset and the product keeps that end point 34 px (8 px margin plus half a
      // rotated sticker at peak scale) from every edge, so a sticker whose end point sits there was clamped
      const x1 = g.cx + t.dx * 1.1;
      const y1 = g.cy + t.dy * 1.1;
      expect(x1, 'end x keeps the 8 px margin').toBeGreaterThanOrEqual(8);
      expect(x1).toBeLessThanOrEqual(g.vw - 8);
      expect(y1).toBeGreaterThanOrEqual(8);
      expect(y1).toBeLessThanOrEqual(g.vh - 8);
      const clamped = x1 <= 36 || x1 >= g.vw - 36 || y1 <= 36 || y1 >= g.vh - 36;
      if (!clamped) {
        unclamped++;
        const d = Math.hypot(t.dx, t.dy);
        expect(d, 'lands rim + 10 .. 80').toBeGreaterThanOrEqual(g.rim + 10 - 2);
        expect(d, 'lands rim + 10 .. 80').toBeLessThanOrEqual(g.rim + 80 + 2);
      }
    }
    expect(unclamped).toBeGreaterThan(g.s.length / 2);
  });

  test('fix round: once landed, no burst sticker covers the digits or the task name', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 2, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(burst(page)).toBeAttached();
    await page.waitForTimeout(1000); // real time: the animation has arrived
    const hits = await page.evaluate(() => {
      const boxes = ['timer-digits', 'current-task'].map((id) => [id, document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()] as const);
      const out: string[] = [];
      for (const s of document.querySelectorAll<HTMLElement>('[data-testid="sticker-burst"] [data-testid="sticker"]')) {
        const r = s.getBoundingClientRect();
        for (const [id, b] of boxes) if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) out.push(`${s.dataset.emoji} over ${id}`);
      }
      return out;
    });
    expect(hits).toEqual([]);
  });

  test('every burst sticker stays inside the viewport at its peak spread', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 3, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(burst(page)).toBeAttached();
    await page.waitForTimeout(700); // real time: the CSS animation runs on the real clock
    const out = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="sticker-burst"] [data-testid="sticker"]')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight).length,
    );
    expect(out).toBe(0);
  });

  test('no burst after Skip', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 1, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.runFor(60_000);
    await page.getByTestId('timer-skip').click();
    await page.clock.runFor(500);
    await expect(burst(page)).toHaveCount(0);
  });

  test('no burst when a break ends', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 1, calm: true });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(burst(page)).toBeAttached();
    await page.clock.runFor(2000);
    await expect(burst(page)).toHaveCount(0);
    await page.clock.fastForward(5 * MIN + 250); // the auto-started break runs out
    await page.clock.runFor(500);
    await expect(burst(page)).toHaveCount(0);
  });

  for (const [label, lateBy] of [['20 s', 20_000], ['6 hours', 6 * 60 * MIN]] as const) {
    test(`no burst for a session that finished while the app was closed (late catch-up, reopened ${label} after the end)`, async ({ page, context }) => {
      await boot(page, { clock: NOW, rng: 1, calm: true });
      await page.getByTestId('timer-play').click();
      const endsAt = await page.evaluate(() => JSON.parse(localStorage.getItem('em-time:data')!).timer.endsAt as number);
      await page.close();
      const p2 = await context.newPage();
      await p2.clock.install({ time: new Date(endsAt + lateBy) });
      await p2.goto('./?e2e&seed=1#/timer');
      await expect(p2.getByTestId('timer-bubble')).toBeVisible();
      await p2.clock.runFor(300);
      await expect(p2.getByTestId('sticker-burst')).toHaveCount(0);
      expect(await p2.evaluate(() => JSON.parse(localStorage.getItem('em-time:data')!).sessions.length)).toBe(1); // it was logged, quietly
    });
  }

  test('MIL-3 starting the next focus phase clears a burst that is still on screen', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 1, calm: true, });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(burst(page)).toBeAttached();
    await page.getByTestId('mode-focus').click();
    await page.getByTestId('timer-play').click();
    await expect(burst(page)).toHaveCount(0);
  });
});

test.describe('STICKER-6 Sky stickers off', () => {
  test('no drifting stickers over 6 minutes and no burst after a session; the switch persists', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 1, seed: v2doc({ stickers: false }), init: LOG, calm: true });
    await advance(page, 6 * 60);
    expect((await readLog(page)).added).toEqual([]);
    expect(await drifting(page).count()).toBe(0);
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('timer-bubble')).toBeVisible();
    await expect(burst(page)).toHaveCount(0);
  });

  test('a milestone shows the v1 confetti instead', async ({ page }) => {
    const doc = docWithSessions([['2026-10-01', 3], ['2026-10-03', 3], ['2026-10-05', 3]], { stickers: false });
    doc.meta.milestonesShown = [];
    await boot(page, { clock: NOW, rng: 1, calm: true, seed: doc });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('message-line')).toContainText('Ten sessions');
    await expect(page.locator('.confetti__p').first()).toBeAttached();
    await expect(burst(page)).toHaveCount(0);
    await page.clock.runFor(1500);
    await expect(page.locator('.confetti__p')).toHaveCount(0);
  });

  test('the switch in Settings stops drifting at once and starting again works without a reload', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 1, route: 'settings', calm: true });
    await advance(page, 45);
    await expect(drifting(page).first()).toBeAttached();
    await page.getByTestId('settings-stickers').click();
    await expect(drifting(page)).toHaveCount(0);
    await advance(page, 120);
    await expect(drifting(page)).toHaveCount(0);
    await page.getByTestId('settings-stickers').click();
    await advance(page, 45);
    await expect(drifting(page).first()).toBeAttached();
  });
});

test.describe('STICKER-7 hidden page', () => {
  test('no sticker spawns while the page is hidden, and no burst plays on return', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 1, stubs: true, init: LOG, calm: true });
    await page.getByTestId('timer-play').click();
    await setHidden(page, true);
    await page.clock.fastForward(25 * MIN + 250); // the focus phase ends while hidden
    await page.clock.runFor(1000);
    expect((await readLog(page)).added).toEqual([]);
    await expect(burst(page)).toHaveCount(0);
    await setHidden(page, false);
    await page.clock.runFor(300);
    await expect(burst(page)).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('em-time:data')!).sessions.length)).toBe(1);
  });
});

test.describe('STICKER-8 (browser part) what is drawn', () => {
  test('every sticker that appears is exactly one grapheme from the shipped pools, and none is a replacement or missing-glyph character', async ({ page }) => {
    await boot(page, { clock: NOW, rng: 5, init: LOG, calm: true });
    await advance(page, 15 * 60);
    const log = await readLog(page);
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    expect(log.perAdd.length).toBeGreaterThan(5);
    for (const e of log.perAdd) {
      expect([...seg.segment(e)].length, e).toBe(1);
      expect(e).not.toMatch(/�|□/);
    }
  });
});
