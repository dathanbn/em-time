import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { atTime, boot, emptyDoc, go, isMobile, stored } from './helpers';

/**
 * Focus sounds (v4). Audio is real here: the preview server's Chromium renders Web Audio, and the
 * engine's e2e hook (window.__emNoise, present only with ?e2e on the VITE_E2E build) exposes an
 * analyser on the master output, so "playing" is proven by signal, not only by the chip state.
 *
 * Playwright's Chromium builds cannot decode AAC (no proprietary codecs). Where a recorded sound has to
 * play, the .m4a request is answered with a short WAV of noise when the browser lacks AAC, so the
 * fetch, decodeAudioData and loop path still run; a browser with AAC (any CI Chrome or Edge channel)
 * uses the real files, and the decode test then checks every file's real length.
 */
const SHOTS = resolve(import.meta.dirname, '../screenshots');
const SOUNDS = resolve(import.meta.dirname, '../../frontend/public/sounds');
const LOOPS: Record<string, number> = { rain: 40, waves: 40, stream: 40, cafe: 14.5, fireplace: 23, night: 45 };
const IDS = ['white', 'pink', 'brown', 'rain', 'waves', 'stream', 'cafe', 'fireplace', 'night'];

let aac = false;
test.beforeAll(async ({ browser, baseURL }) => {
  const p = await browser.newPage({ baseURL });
  await p.goto('./');
  aac = await p.evaluate(async () => {
    try {
      const res = await fetch('sounds/cafe.m4a');
      await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(await res.arrayBuffer());
      return true;
    } catch {
      return false;
    }
  });
  await p.close();
});

/** 2 s of mono noise as a WAV, for browsers that cannot decode AAC. */
function wav(seconds = 2, rate = 22050): Buffer {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round((Math.random() * 2 - 1) * 0.5 * 32767), 44 + i * 2);
  return b;
}
const fallback = async (page: Page) => {
  if (!aac) await page.route('**/sounds/*.m4a', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav() }));
};

const chip = (p: Page) => p.getByTestId('noise-chip');
const picker = (p: Page) => p.getByTestId('noise-picker');
/** RMS of the master output; throws when the engine was never loaded, so a silence check cannot pass by default. */
const level = (p: Page) =>
  p.evaluate(() => {
    const h = (window as any).__emNoise;
    if (!h) throw new Error('engine not loaded');
    return h.level();
  }) as Promise<number>;
const hook = (p: Page) => p.evaluate(() => (window as any).__emNoise?.state()) as Promise<{ status: string; id: string | null; error?: string }>;
const play = (p: Page) => p.getByTestId('timer-play').click();
const settingsOf = async (p: Page) =>
  (await stored(p))?.settings ?? (await p.evaluate(() => (window as any).__emCore.store.get().settings));
/** A first-run document with sound settings; notifications off so Play never asks the browser for anything. */
const doc = (s: Record<string, unknown> = {}) => emptyDoc({ notifications: false, ...s });
const noDash = (t: string | null) => expect(t ?? '').not.toMatch(/[–—]/);

test.describe('focus sounds: Timer chip and picker', () => {
  test('the chip is on the Timer, off and muted on first run, and at least 44 px tall', async ({ page }) => {
    await boot(page);
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    await expect(chip(page)).toHaveAttribute('aria-label', 'Focus sounds: off');
    await expect(chip(page)).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(chip(page)).toContainText('Sounds');
    const box = (await chip(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // inside the viewport (v5: under the play controls on phone, in the Focus tools card on desktop), no horizontal scroll
    const vw = page.viewportSize()!.width;
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await settingsOf(page)).toMatchObject({ noiseOn: false, noise: 'rain', noiseVolume: 0.5 });
  });

  test('the picker: title, hint, switch, nine radio tiles, volume; Escape closes and returns focus to the chip', async ({ page }) => {
    await boot(page);
    await chip(page).click();
    await expect(picker(page)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Focus sounds' })).toBeVisible();
    await expect(picker(page)).toContainText('Plays during focus sessions, pauses on breaks.');
    await expect(page.getByTestId('noise-toggle')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('radiogroup', { name: 'Focus sound' })).toBeVisible();
    await expect(picker(page).getByRole('radio')).toHaveCount(9);
    for (const id of IDS) await expect(page.getByTestId(`noise-option-${id}`)).toHaveAttribute('role', 'radio');
    await expect(page.getByTestId('noise-option-rain')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('noise-volume')).toHaveValue('50');
    // 3 columns
    const xs = await picker(page).getByRole('radio').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(3);
    noDash(await picker(page).textContent());
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(chip(page)).toBeFocused();
  });

  test('picking Rain turns sounds on and names it on the chip; the choice survives a reload', async ({ page }) => {
    await fallback(page);
    await boot(page, { seed: doc({ noise: 'waves' }) });
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    await chip(page).click();
    await page.getByTestId('noise-option-rain').click();
    await expect(page.getByTestId('noise-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('noise-option-rain')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(chip(page)).toContainText('Rain');
    await expect(chip(page)).toHaveAttribute('aria-label', 'Focus sounds: Rain, on');
    expect(await settingsOf(page)).toMatchObject({ noiseOn: true, noise: 'rain' });
    await page.reload();
    await expect(chip(page)).toContainText('Rain');
    await expect(chip(page)).not.toHaveAttribute('data-state', 'off');
    expect(await settingsOf(page)).toMatchObject({ noiseOn: true, noise: 'rain' });
  });

  test('arrow keys move through the tiles like a radio group (roving tabindex)', async ({ page }) => {
    await boot(page, { seed: doc({ noise: 'brown' }) });
    await chip(page).click();
    const tiles = picker(page).getByRole('radio');
    await expect(tiles.nth(2)).toHaveAttribute('tabindex', '0');
    await expect(tiles.nth(0)).toHaveAttribute('tabindex', '-1');
    await tiles.nth(2).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('noise-option-rain')).toBeFocused();
    await expect(page.getByTestId('noise-option-rain')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(page.getByTestId('noise-option-night')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('noise-option-white')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('noise-option-night')).toBeFocused();
    expect(await settingsOf(page)).toMatchObject({ noise: 'night', noiseOn: true });
  });

  test('the volume slider saves 0..1 and the switch turns sounds off again', async ({ page }) => {
    await boot(page, { seed: doc({ noiseOn: true }) });
    await chip(page).click();
    await page.getByTestId('noise-volume').fill('80');
    expect((await settingsOf(page)).noiseVolume).toBe(0.8);
    await expect(picker(page)).toContainText('80');
    await page.getByTestId('noise-toggle').click();
    await expect(page.getByTestId('noise-toggle')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
  });

  test('N toggles sounds on and off', async ({ page }) => {
    test.skip(isMobile(test.info().project), 'keyboard shortcuts are a desktop feature');
    await boot(page, { seed: doc() });
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    await page.keyboard.press('n');
    await expect(chip(page)).not.toHaveAttribute('data-state', 'off');
    expect((await settingsOf(page)).noiseOn).toBe(true);
    await page.keyboard.press('N');
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    expect((await settingsOf(page)).noiseOn).toBe(false);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' }).locator('kbd', { hasText: /^N$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    // ignored while typing
    await boot(page, { seed: doc(), route: 'tasks' });
    await page.getByTestId('task-add-input').fill('nnn');
    expect((await settingsOf(page)).noiseOn).toBe(false);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the open picker has no axe violations (${theme}), contrast included`, async ({ page }) => {
      await boot(page, { seed: doc({ theme, noiseOn: true }) });
      await chip(page).click();
      await expect(picker(page)).toBeVisible();
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});

test.describe('focus sounds: playback follows the timer', () => {
  test('a synthesized sound renders a signal during focus, fades to silence on Pause, and returns on Resume', async ({ page }) => {
    await boot(page, { seed: doc({ noiseOn: true, noise: 'pink' }) });
    await expect(chip(page)).toHaveAttribute('data-state', 'idle'); // on, but nothing is playing yet
    await play(page);
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await expect(chip(page)).toHaveAttribute('aria-label', 'Focus sounds: Pink noise, on');
    // pink at volume 0.5: 0.037 RMS x (0.5^2 x 1.2 = 0.3) = 0.011
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.004);
    await expect.poll(() => page.evaluate(() => (window as any).__emNoise.masterGain()), { timeout: 8000 }).toBeCloseTo(0.3, 1);
    expect(await level(page)).toBeLessThan(0.05);

    await play(page); // Pause
    await expect(chip(page)).toHaveAttribute('data-state', 'idle');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeLessThan(0.0005);

    await play(page); // Resume
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.004);
  });

  test('plays only during a running focus phase: skip, breaks and reset are silent', async ({ page }) => {
    await boot(page, { seed: doc({ noiseOn: true, noise: 'brown' }) });
    await play(page);
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await page.getByTestId('timer-skip').click(); // short break, idle
    await expect(chip(page)).toHaveAttribute('data-state', 'idle');
    await play(page); // the break runs
    await page.waitForTimeout(300);
    await expect(chip(page)).toHaveAttribute('data-state', 'idle');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeLessThan(0.0005);
    await page.getByTestId('timer-skip').click(); // back to focus (idle)
    await play(page);
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await page.getByTestId('timer-reset').click();
    await expect(chip(page)).toHaveAttribute('data-state', 'idle');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeLessThan(0.0005);
  });

  test('turning sounds on mid-focus fades in; turning them off fades out; changing sound or volume is live', async ({ page }) => {
    await boot(page, { seed: doc({ noise: 'white' }) });
    await play(page);
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    expect(await hook(page)).toBeUndefined(); // the engine chunk is not even loaded
    await chip(page).click();
    await page.getByTestId('noise-toggle').click();
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.002);
    await page.getByTestId('noise-option-brown').click(); // crossfade to brown, live
    await expect.poll(async () => (await hook(page)).id).toBe('brown');
    await page.getByTestId('noise-volume').fill('100'); // gain 1.2
    await expect.poll(() => page.evaluate(() => (window as any).__emNoise.masterGain()), { timeout: 5000 }).toBeCloseTo(1.2, 1);
    await page.getByTestId('noise-toggle').click();
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeLessThan(0.0005);
  });

  test('after a reload in the middle of a focus session the sound waits for the first tap, then starts', async ({ page }) => {
    await boot(page, { seed: doc({ noiseOn: true, noise: 'brown' }) });
    await play(page);
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await page.reload();
    await expect(chip(page)).toBeVisible();
    expect((await page.evaluate(() => (window as any).__emCore.timer.getState())).status).toBe('running');
    // a fresh page has no user activation, so the browser keeps the audio context suspended: not playing yet
    await expect.poll(async () => (await hook(page))?.status, { timeout: 8000 }).toBe('idle');
    await expect(chip(page)).toHaveAttribute('data-state', 'idle');
    await page.mouse.click(2, page.viewportSize()!.height - 2); // any tap resumes the context
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.004);
  });

  test('when the focus phase ends the sound fades out and stays off through the auto-started break', async ({ page }) => {
    const now = Date.now();
    const d = doc({ noiseOn: true, noise: 'white' });
    d.timer = { phase: 'focus', status: 'running', plannedMs: 25 * 60_000, remainingMs: 25 * 60_000, endsAt: now + 6000, phaseStartedAt: now - 25 * 60_000 + 6000, cycle: 0, updatedAt: now };
    await boot(page, { seed: d });
    await page.mouse.click(2, page.viewportSize()!.height - 2); // the page was opened mid-session: a tap lets the audio start
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.002);
    await expect.poll(() => page.evaluate(() => (window as any).__emCore.timer.getState().phase), { timeout: 15000 }).toBe('short');
    expect((await page.evaluate(() => (window as any).__emCore.timer.getState())).status).toBe('running'); // auto-started
    await expect(chip(page)).toHaveAttribute('data-state', 'idle');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeLessThan(0.0005);
  });

  test('a recorded sound (Rain) loads, plays during focus and stops on Pause', async ({ page }) => {
    await fallback(page);
    await boot(page, { seed: doc({ noiseOn: true, noise: 'rain' }) });
    const req = page.waitForResponse((r) => r.url().endsWith('/sounds/rain.m4a'));
    await play(page);
    expect((await req).status()).toBe(200);
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.004);
    await play(page);
    await expect(chip(page)).not.toHaveAttribute('data-state', 'playing');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeLessThan(0.0005);
  });

  test('a recorded sound that cannot load shows the error, never breaks the timer, and recovers when the network does', async ({ page }) => {
    await fallback(page);
    await page.route('**/sounds/rain.m4a', (r) => r.abort('internetdisconnected'));
    await boot(page, { seed: doc({ noiseOn: true, noise: 'rain' }) });
    await play(page);
    await expect(chip(page)).toHaveAttribute('data-state', 'error');
    expect((await page.evaluate(() => (window as any).__emCore.timer.getState())).status).toBe('running');
    await chip(page).click();
    await expect(page.getByTestId('noise-error')).toHaveText("Couldn't load. Check your connection.");
    noDash(await page.getByTestId('noise-error').textContent());
    await page.unroute('**/sounds/rain.m4a');
    await fallback(page);
    await page.getByTestId('noise-option-rain').click(); // picking it again tries again
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    await expect(page.getByTestId('noise-error')).toHaveCount(0);
  });

  test('every sound picked while idle plays a short preview (no focus needed)', async ({ page }) => {
    await boot(page, { seed: doc() });
    await chip(page).click();
    await page.getByTestId('noise-option-white').click();
    await expect.poll(async () => (await hook(page))?.status).toBe('playing');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.002);
    // the preview ends on its own after about 5 s
    await expect.poll(async () => (await hook(page)).status, { timeout: 9000 }).toBe('idle');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeLessThan(0.0005);
  });
});

test.describe('focus sounds: Settings', () => {
  test('mirrors the picker: switch, nine radios with Preview buttons, volume, credits', async ({ page }) => {
    await fallback(page);
    await boot(page, { seed: doc() });
    await chip(page).click();
    await page.getByTestId('noise-option-stream').click();
    await page.keyboard.press('Escape');
    await go(page, 'settings');
    const card = page.getByTestId('settings-noise');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('settings-noise-toggle')).toHaveAttribute('aria-checked', 'true');
    for (const id of IDS) await expect(page.getByTestId(`settings-noise-${id}`)).toBeVisible();
    await expect(page.getByTestId('settings-noise-stream')).toBeChecked();
    await expect(card.getByRole('button', { name: /^Preview / })).toHaveCount(9);
    await expect(page.getByTestId('settings-noise-volume')).toHaveValue('50');
    const credits = page.getByTestId('noise-credits');
    for (const who of ['alex36917', 'Luftrum', 'gluckose', 'stephan', 'ezwa', 'Lisa Redfern', 'CC BY', 'CC0', 'Porrumentzio']) await expect(credits).toContainText(who);
    noDash(await card.textContent());
    // changes here reach the Timer chip
    await page.getByTestId('settings-noise-cafe').check();
    expect(await settingsOf(page)).toMatchObject({ noise: 'cafe', noiseOn: true });
    await page.getByTestId('settings-noise-volume').fill('20');
    expect((await settingsOf(page)).noiseVolume).toBe(0.2);
    await page.getByTestId('settings-noise-toggle').click();
    expect((await settingsOf(page)).noiseOn).toBe(false);
    await go(page, 'timer');
    await expect(chip(page)).toHaveAttribute('data-state', 'off');
    await page.getByTestId('noise-chip').click();
    await expect(page.getByTestId('noise-option-cafe')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('noise-volume')).toHaveValue('20');
  });

  test('Preview plays the sound without selecting it', async ({ page }) => {
    await boot(page, { route: 'settings', seed: doc({ noise: 'rain' }) });
    await page.getByRole('button', { name: 'Preview Brown noise' }).click();
    await expect.poll(async () => (await hook(page))?.id).toBe('brown');
    await expect.poll(() => level(page), { timeout: 8000 }).toBeGreaterThan(0.002);
    expect((await settingsOf(page)).noise).toBe('rain');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the Focus sounds card has no axe violations (${theme})`, async ({ page }) => {
      await boot(page, { route: 'settings', seed: doc({ theme }) });
      await expect(page.getByTestId('settings-noise')).toBeVisible();
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).include('[data-testid="settings-noise"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});

test.describe('focus sounds: files and service worker', () => {
  test('sounds/rain.m4a (and the other five) are served with 200 from the preview server', async ({ page }) => {
    await boot(page);
    for (const id of Object.keys(LOOPS)) {
      const r = await page.request.get(`sounds/${id}.m4a`);
      expect(r.status(), id).toBe(200);
      expect((await r.body()).length, id).toBe(readFileSync(resolve(SOUNDS, `${id}.m4a`)).length);
    }
    expect((await page.request.get('sounds/CREDITS.md')).status()).toBe(200);
  });

  test('decodeAudioData accepts the recorded loops (real AAC where the browser has it)', async ({ page }) => {
    await fallback(page);
    await boot(page, { seed: doc({ noiseOn: true, noise: 'cafe' }) });
    await play(page); // loads the engine chunk and its e2e hook
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    for (const [id, sec] of Object.entries(LOOPS)) {
      const d = await page.evaluate((x) => (window as any).__emNoise.decode(x), id);
      expect(d.channels, id).toBeGreaterThanOrEqual(1);
      if (aac) {
        expect(d.rate, id).toBe(44100);
        expect(d.duration, id).toBeGreaterThanOrEqual(sec - 0.2);
        expect(d.duration, id).toBeLessThanOrEqual(sec + 0.2);
      } else expect(d.duration, id).toBeGreaterThan(1); // the stand-in WAV: pipeline only
    }
    test.info().annotations.push({ type: 'aac', description: aac ? 'real AAC decoded' : 'browser has no AAC: WAV stand-in used' });
  });

  test('synthesized colors render at their target loudness (OfflineAudioContext, within 1.5 dB)', async ({ page }) => {
    await boot(page, { seed: doc({ noiseOn: true, noise: 'white' }) });
    await play(page);
    await expect(chip(page)).toHaveAttribute('data-state', 'playing');
    const target = { white: 0.022, pink: 0.037, brown: 0.043 } as const;
    for (const [c, want] of Object.entries(target)) {
      const got = await page.evaluate((x) => (window as any).__emNoise.renderRms(x), c);
      expect(Math.abs(20 * Math.log10(got / want)), c).toBeLessThan(1.5);
    }
  });

  test('a sound that played once is cached by the service worker and still loads with the network off', async ({ page, context }) => {
    await boot(page, { seed: doc({ noiseOn: true, noise: 'rain' }) });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload(); // now the worker controls the page
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cached = () => page.evaluate(async () => (await (await caches.open('em-time-sounds')).keys()).map((r) => new URL(r.url).pathname));
    expect(await cached()).toEqual([]); // not precached
    await play(page); // fetches rain.m4a (decoding may fail in a browser without AAC; the fetch is what is cached)
    await expect.poll(cached, { timeout: 10000 }).toEqual([expect.stringMatching(/\/sounds\/rain\.m4a$/)]);
    await context.setOffline(true);
    const status = await page.evaluate(async () => (await fetch('sounds/rain.m4a')).status);
    expect(status).toBe(200);
    await context.setOffline(false);
  });

  test('the service worker caches played sounds (CacheFirst, em-time-sounds, 12 entries) and does not precache them', async ({ page }) => {
    const sw = await (await page.request.get('sw.js')).text();
    expect(sw).toContain('em-time-sounds');
    expect(sw).toMatch(/\.m4a/);
    expect(sw).toMatch(/maxEntries:\s*12/);
    expect(sw).toMatch(/statuses:\s*\[0,\s*200\]/);
    const precached = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(precached.some((u) => u!.endsWith('.m4a'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------- screenshots
mkdirSync(SHOTS, { recursive: true });

/** Date shifted to a fixed local time (it keeps flowing), so the sky is the same on every run. */
const shifted = (at: Date) => `
(() => {
  const R = Date; const off = ${at.getTime()} - R.now();
  window.Date = new Proxy(R, {
    construct(t, a, nt) { return a.length ? Reflect.construct(t, a, nt) : Reflect.construct(t, [R.now() + off], nt); },
    apply() { return new R(R.now() + off).toString(); },
    get(t, k) { return k === 'now' ? () => R.now() + off : Reflect.get(t, k); },
  });
})();
`;

test.describe('focus sounds: screenshots', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`Timer chip off, chip playing, and the picker (${theme})`, async ({ page }) => {
      const w = page.viewportSize()!.width;
      const name = (what: string) => `${SHOTS}/noise-${what}-${w}-${theme}.png`;
      await fallback(page);
      await page.emulateMedia({ reducedMotion: 'reduce' }); // a still equalizer and sky
      await page.addInitScript(shifted(atTime('12:30')));
      await boot(page, { seed: doc({ theme }), calm: true, rng: 1 });
      await page.evaluate(() => document.fonts.ready);
      await expect(chip(page)).toHaveAttribute('data-state', 'off');
      await page.waitForTimeout(500);
      await page.screenshot({ path: name('chip-off') });

      await chip(page).click();
      await page.getByTestId('noise-option-rain').click(); // a preview starts; the sheet shows the selection
      await expect(page.getByTestId('noise-toggle')).toHaveAttribute('aria-checked', 'true');
      await page.waitForTimeout(500);
      await page.screenshot({ path: name('picker') });
      await page.keyboard.press('Escape');

      await page.getByTestId('noise-chip').click();
      await page.getByTestId('noise-option-pink').click();
      await page.keyboard.press('Escape');
      await play(page);
      await expect(chip(page)).toHaveAttribute('data-state', 'playing');
      await page.waitForTimeout(900);
      await page.screenshot({ path: name('chip-playing') });
    });
  }
});
