import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { boot, go, stored } from './helpers';
import { serveDist, type StaticServer } from './staticServer';

const DIST = resolve(import.meta.dirname, '../../dist');

const pngSize = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

async function swReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.describe('PWA-1 installable', () => {
  test('the manifest is linked, parses, and names the app "Em Time" in standalone display', async ({ page, request }) => {
    await boot(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/em-time/manifest.webmanifest');
    const res = await request.get(new URL(href!, page.url()).toString());
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
    const m = await res.json();
    expect(m.name).toBe('Em Time');
    expect(m.short_name).toBe('Em Time');
    expect(m.display).toBe('standalone');
    expect(m.scope).toBe('./');
    expect(new URL(m.start_url, 'https://dathanbn.github.io/em-time/manifest.webmanifest').pathname).toBe('/em-time/');
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    const sizes = m.icons.map((i: any) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  });

  test('every manifest icon and the apple-touch-icon exist, are PNGs, and have the size they claim', async ({ page, request }) => {
    await boot(page);
    const manifestUrl = new URL('/em-time/manifest.webmanifest', page.url()).toString();
    const m = await (await request.get(manifestUrl)).json();
    for (const icon of m.icons) {
      const r = await request.get(new URL(icon.src, manifestUrl).toString());
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type']).toBe('image/png');
      const { w, h } = pngSize(await r.body());
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
    const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    const r = await request.get(new URL(touch!, page.url()).toString());
    expect(r.status()).toBe(200);
    expect(pngSize(await r.body())).toEqual({ w: 180, h: 180 });
  });

  test('iOS home screen metadata: title "Em Time", standalone capable', async ({ page }) => {
    await boot(page);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Em Time');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#/);
    await expect(page).toHaveTitle('Em Time');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('a service worker registers, activates and takes control; Chrome reports no installability errors', async ({ page, context }) => {
    await boot(page);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/em-time\/$/);
    await swReady(page);
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: Array<{ errorId: string }> };
    // 'in-incognito' is how Chrome sees Playwright's throwaway profile, not a defect of the app
    expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual([]);
    const mf = (await cdp.send('Page.getAppManifest')) as { url: string; errors: unknown[] };
    expect(mf.url).toMatch(/\/em-time\/manifest\.webmanifest$/);
    expect(mf.errors).toEqual([]);
  });
});

test.describe('PWA-2 offline', () => {
  test('after the first load every screen, a new task, the timer and Export work with the network off', async ({ page, context }) => {
    await boot(page);
    await swReady(page);
    await context.setOffline(true);
    // a cold navigation is answered by the service worker
    await page.goto('?e2e#/timer');
    await expect(page.getByTestId('timer-digits').filter({ visible: true }).first()).toHaveText('25:00');
    await page.reload();
    await expect(page.getByTestId('timer-digits').filter({ visible: true }).first()).toHaveText('25:00');
    // timer
    await page.getByTestId('timer-play').click();
    await expect(page.getByTestId('timer-play')).toHaveAttribute('aria-label', /Pause/);
    await page.getByTestId('timer-play').click();
    await page.getByTestId('timer-reset').click();
    // tasks
    await go(page, 'tasks');
    await page.getByTestId('task-add-input').fill('Offline task');
    await page.getByTestId('task-add-button').click();
    await expect(page.getByTestId('task-row')).toHaveCount(1);
    // stats (lazy chart code is part of the precache)
    await go(page, 'stats');
    await expect(page.getByTestId('heatmap')).toBeVisible();
    await expect(page.getByTestId('trend-chart')).toBeVisible();
    // settings and export
    await go(page, 'settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-button').click()]);
    const out = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    expect(out.tasks.map((t: any) => t.name)).toContain('Offline task');
    // data survives going back online and a reload
    await context.setOffline(false);
    await page.reload();
    expect((await stored(page)).tasks.map((t: any) => t.name)).toContain('Offline task');
  });

  test('offline, no screen fires a network request that fails (nothing is fetched at runtime)', async ({ page, context }) => {
    await boot(page);
    await swReady(page);
    await context.setOffline(true);
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url()));
    await page.goto('?e2e#/timer');
    for (const r of ['tasks', 'stats', 'settings', 'timer'] as const) await go(page, r);
    expect(failed).toEqual([]);
  });
});

test.describe('PWA-3 update prompt', () => {
  let srv: StaticServer;
  test.beforeEach(async () => {
    srv = await serveDist();
  });
  test.afterEach(async () => {
    await srv.close();
  });

  test('a new version waits: no prompt while the timer runs, no automatic reload, prompt when it stops, Refresh applies it', async ({ page }) => {
    await page.goto(`${srv.origin}/em-time/?e2e#/timer`);
    await expect(page.getByTestId('timer-digits').filter({ visible: true }).first()).toHaveText('25:00');
    await swReady(page);
    await page.evaluate(() => ((window as any).__marker = 'still the same page'));
    const sw0 = await page.evaluate(() => navigator.serviceWorker.controller!.scriptURL);

    await page.getByTestId('timer-play').click(); // running
    srv.deploy();
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting), { timeout: 15_000 }).toBe(true);
    // a waiting worker exists, the timer is running: no prompt
    await page.waitForTimeout(1500);
    await expect(page.locator('.updatepill')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__marker)).toBe('still the same page');

    // pause: the timer is no longer running, the prompt appears; the page still has not reloaded by itself
    await page.getByTestId('timer-play').click();
    await expect(page.locator('.updatepill')).toBeVisible();
    await expect(page.locator('.updatepill')).toContainText('Update ready');
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => (window as any).__marker)).toBe('still the same page');

    // starting again hides it, pausing brings it back
    await page.getByTestId('timer-play').click();
    await expect(page.locator('.updatepill')).toHaveCount(0);
    await page.getByTestId('timer-play').click();
    await expect(page.locator('.updatepill')).toBeVisible();

    // Refresh applies the update and reloads
    await page.locator('.updatepill').getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__marker ?? null).catch(() => null), { timeout: 15_000 }).toBeNull();
    await expect(page.getByTestId('nav-timer').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
    expect(sw0).toMatch(/sw\.js$/);
  });

  test('PWA-3 with the timer idle the prompt shows at once, and the saved timer state survives the refresh', async ({ page }) => {
    await page.goto(`${srv.origin}/em-time/?e2e#/tasks`);
    await swReady(page);
    await page.getByTestId('task-add-input').fill('Survives update');
    await page.getByTestId('task-add-button').click();
    srv.deploy();
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await expect(page.locator('.updatepill')).toBeVisible({ timeout: 15_000 });
    await page.locator('.updatepill').getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByTestId('task-row')).toContainText('Survives update', { timeout: 15_000 });
  });
});

test.describe('PWA-4 base path', () => {
  test('every request on every screen stays under /em-time/ and succeeds', async ({ page }) => {
    const srv = await serveDist();
    try {
      const bad: string[] = [];
      page.on('response', (r) => {
        if (r.url().startsWith(srv.origin) && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
      });
      await page.goto(`${srv.origin}/em-time/?e2e#/timer`);
      for (const r of ['tasks', 'stats', 'settings', 'timer'] as const) await go(page, r);
      await page.getByTestId('timer-play').click();
      await swReady(page);
      expect(bad).toEqual([]);
      expect(srv.requests.length).toBeGreaterThan(5);
      expect(srv.requests.filter((p) => !p.startsWith('/em-time/'))).toEqual([]);
      // the origin root is not served: the app does not depend on it
      const root = await page.request.get(`${srv.origin}/`);
      expect(root.status()).toBe(404);
    } finally {
      await srv.close();
    }
  });

  test('the build output contains no root-absolute URLs outside /em-time/', async () => {
    const offenders: string[] = [];
    const files = [
      'index.html',
      'manifest.webmanifest',
      'sw.js',
      'sw-notify.js',
      ...readdirSync(resolve(DIST, 'assets')).filter((f) => /\.(js|css)$/.test(f)).map((f) => `assets/${f}`),
    ];
    for (const f of files) {
      const text = readFileSync(resolve(DIST, f), 'utf8');
      // href="/x", src="/x", url(/x), fetch("/x"), but not "//" protocol-relative nor /em-time/
      const re = /(?:href|src)=["']\/(?!em-time\/|\/)[^"']*["']|url\(\s*["']?\/(?!em-time\/|\/)[^)"']*|["']\/(?:assets|icons|favicon|manifest|sw)[^"']*["']/g;
      for (const m of text.match(re) ?? []) offenders.push(`${f}: ${m}`);
    }
    expect(offenders).toEqual([]);
    const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
    expect(html).toContain('/em-time/assets/');
  });
});
