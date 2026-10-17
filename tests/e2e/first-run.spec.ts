import { expect, test, type Page } from '@playwright/test';
import { boot, go, isMobile, visible } from './helpers';
import { parseColor } from '../unit/colorMath';

const TOKENS = [
  '--em-bg', '--em-bg-grad-top', '--em-bg-grad-bottom', '--em-surface', '--em-surface-sunk', '--em-border', '--em-scrim',
  '--em-ink', '--em-ink-2', '--em-ink-3', '--em-accent', '--em-accent-soft', '--em-accent-text', '--em-on-accent', '--em-focus-ring',
  '--em-ring-track', '--em-ring-fill', '--em-ring-glow', '--em-danger', '--em-danger-soft', '--em-grid', '--em-axis',
  ...[0, 1, 2, 3, 4].map((i) => `--em-heat-${i}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `--em-cat-${i}`),
  // v2 additions (contract V2.8)
  '--sky-top', '--sky-mid', '--sky-horizon', '--sky-hill-back', '--sky-hill-front', '--sky-ink', '--sky-sun-x', '--sky-sun-y', '--sky-sun-size',
  '--sky-sun-opacity', '--sky-moon-x', '--sky-moon-y', '--sky-moon-size', '--sky-moon-opacity', '--sky-cloud-fill', '--sky-cloud-opacity', '--sky-star-opacity',
  '--em-glass', '--em-glass-border', '--em-surface-solid', '--em-blur', '--em-focus-halo',
  '--mascot-fill', '--mascot-line', '--mascot-shade', '--mascot-ink', '--mascot-blush',
  '--em-fs-greet', '--em-fs-section', '--em-fw-heavy', '--sticker-size',
  '--em-font-sans', '--em-fs-xs', '--em-fs-sm', '--em-fs-md', '--em-fs-lg', '--em-fs-xl', '--em-fs-stat', '--em-fs-timer',
  '--em-fw-light', '--em-fw-regular', '--em-fw-medium', '--em-fw-semibold',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `--em-space-${i}`),
  '--em-radius-sm', '--em-radius-md', '--em-radius-lg', '--em-radius-pill',
  '--em-shadow-sm', '--em-shadow-md', '--em-shadow-lg',
  '--em-dur-fast', '--em-dur-base', '--em-dur-slow', '--em-dur-refill', '--em-dur-breath', '--em-ease-standard', '--em-ease-in', '--em-ease-breath',
  '--em-nav-h', '--em-content-max', '--em-gutter',
];

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

test.describe('first run (EDGE-8, TSK-1, UI-1)', () => {
  test('TMR-1 EDGE-8 timer screen shows "No task" with a "Pick a task" ghost button and zeroed Today (desktop card; the phone Timer has no stats)', async ({ page }, info) => {
    await boot(page, { clock: true });
    await expect(page.getByTestId('current-task')).toHaveText('Pick a task');
    if (info.project.name.startsWith('mobile')) {
      // Timer simplification: no Today strip on the phone Timer
      await expect(page.getByTestId('today-goal').filter({ visible: true })).toHaveCount(0);
    } else {
      await expect(visible(page.getByTestId('today-goal')).first()).toContainText('0 of 120 min');
      await expect(visible(page.getByTestId('today-goal')).first()).toContainText('0 sessions');
    }
    await expect(page.getByTestId('message-line')).toBeEmpty();
    await expect(page.getByTestId('break-prompt')).toHaveCount(0);
  });

  test('EDGE-8 timer side card (desktop) says "Nothing here yet. Add what you\'re working on."', async ({ page }, info) => {
    test.skip(info.project.name.startsWith('mobile'), 'the Up next card exists on desktop only');
    await boot(page, { clock: true });
    await expect(page.getByText("Nothing here yet. Add what you're working on.")).toBeVisible();
  });

  test('EDGE-8 Tasks screen empty state', async ({ page }) => {
    await boot(page, { clock: true, route: 'tasks' });
    await expect(page.getByText('Nothing here yet.', { exact: true })).toBeVisible();
    await expect(page.getByText("Add what you're working on.", { exact: true })).toBeVisible();
    await expect(page.getByTestId('task-row')).toHaveCount(0);
  });

  test('EDGE-8 Stats screen keeps every frame with zero values and no sample data', async ({ page }) => {
    await boot(page, { clock: true, route: 'stats' });
    await expect(page.getByTestId('goal-ring')).toHaveAttribute('aria-label', /^0 of 120 minutes today/);
    await expect(page.getByTestId('streak-current')).toContainText('0 days');
    await expect(page.getByTestId('streak-best')).toContainText('0 days');
    await expect(page.getByTestId('week-total')).toContainText('0m');
    await expect(page.getByText('No focus time this week yet.')).toBeVisible();
    await expect(page.getByTestId('week-columns')).toBeVisible();
    const cells = page.getByTestId('heatmap-cell');
    expect(await cells.count()).toBeGreaterThan(50);
    for (const l of await cells.evaluateAll((els) => els.map((e) => e.getAttribute('data-level')))) expect(l).toBe('0');
    await expect(page.getByText('Your first session will show up here.')).toHaveCount(2); // heatmap and trend
    await expect(page.getByTestId('trend-chart').locator('svg')).toBeVisible();
    await expect(page.getByTestId('trend-chart')).toContainText('Goal');
  });

  test('TSK-1 first run seeds five categories with colour slots 1 to 5 and no tasks', async ({ page }, info) => {
    await boot(page, { clock: true, route: 'tasks' });
    if (info.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Manage categories' }).click();
    const rows = visible(page.getByTestId('category-row'));
    await expect(rows).toHaveCount(5);
    const names = await rows.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(names).toEqual(['Study', 'Reading', 'Problem sets', 'Writing', 'Review']);
    const d = await page.evaluate(() => (window as any).__emCore.store.get());
    expect(d.categories.map((c: any) => [c.id, c.color])).toEqual([
      ['5e5e0000-0000-4000-8000-000000000001', 1], ['5e5e0000-0000-4000-8000-000000000002', 2],
      ['5e5e0000-0000-4000-8000-000000000003', 3], ['5e5e0000-0000-4000-8000-000000000004', 4],
      ['5e5e0000-0000-4000-8000-000000000005', 5],
    ]);
    expect(d.tasks).toEqual([]);
    expect(d.sessions).toEqual([]);
  });

  test('THEME-1 (replaces UI-1) the default is Follow the sky (light polarity at 15:00), and the OS dark preference does not switch it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await boot(page, { clock: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'sky');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Chromium may serialise the token as #ffffffe6: compare the parsed colour, not the text
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--em-surface').trim());
    const [r, g, b, a] = parseColor(bg);
    expect([r, g, b]).toEqual([255, 255, 255]);
    expect(a).toBeCloseTo(0.9, 2);
  });

  test('routing: hash routes, nav clicks, deep links and the default route', async ({ page }) => {
    await boot(page, { clock: true });
    await expect(page).toHaveURL(/#\/timer$/);
    for (const r of ['tasks', 'stats', 'settings', 'timer'] as const) {
      await go(page, r);
      await expect(page.locator('main h1')).toHaveText(new RegExp(r, 'i'));
    }
    await page.goto('./#/stats');
    await expect(page.getByTestId('week-total')).toBeVisible();
    await page.goto('./#/nonsense');
    await expect(page.getByTestId('timer-digits')).toBeVisible();
  });

  test('every design token from contract section 8 exists in light and in dark', async ({ page }, info) => {
    await boot(page, { clock: true, route: 'settings' });
    const read = () =>
      page.evaluate((names) => {
        const cs = getComputedStyle(document.documentElement);
        return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
      }, TOKENS);
    const light = await read();
    const missingLight = TOKENS.filter((t) => !light[t]);
    expect(missingLight, `missing in light: ${missingLight.join(', ')}`).toEqual([]);
    await page.getByTestId('settings-theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await read();
    expect(TOKENS.filter((t) => !dark[t])).toEqual([]);
    for (const t of ['--em-bg', '--em-surface', '--em-ink', '--em-accent-text', '--em-heat-4']) expect(dark[t], t).not.toBe(light[t]);
    expect(light['--em-nav-h']).toBe(isMobile(info.project) ? '64px' : '72px'); // v2 desktop nav row 72 (design.md 6), phone tab bar 64
    expect(light['--em-content-max']).toBe('1120px');
  });

  test('no console errors or failed requests across all four screens', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
    page.on('requestfailed', (r) => problems.push('failed: ' + r.url()));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
    await boot(page, { clock: true });
    for (const r of ['tasks', 'stats', 'settings', 'timer'] as const) await go(page, r);
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
  });

  test('copy rule: no em or en dashes in any visible text', async ({ page }) => {
    await boot(page, { clock: true });
    for (const r of ['timer', 'tasks', 'stats', 'settings'] as const) {
      await go(page, r);
      const text = await visibleText(page);
      expect(text, r).not.toMatch(/[–—]/);
    }
  });
});

test.describe('SYNC-1 local-only build', () => {
  const isSyncAsset = (u: string) => /supabase/i.test(u) || /\/assets\/(sync-)?(engine|dist)-/.test(u);

  test('no Sync card and no Supabase request from the page across a full session', async ({ page }, info) => {
    const hits: string[] = [];
    page.on('request', (r) => isSyncAsset(r.url()) && hits.push(r.url()));
    await boot(page, { clock: true });
    await page.getByTestId('current-task').click();
    await page.getByLabel('Add task').fill('x');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(26 * 60_000);
    for (const r of ['tasks', 'stats', 'settings'] as const) await go(page, r);
    await expect(page.getByTestId('sync-card')).toHaveCount(0);
    await expect(page.getByText('Link this device')).toHaveCount(0);
    await expect(page.getByTestId('sync-code-input')).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(500);
    expect(hits, `${info.project.name}: ${hits.join(', ')}`).toEqual([]);
  });

  // The service worker precaches every emitted file, including the lazy sync chunks.
  test('the service worker does not download the sync chunks in a local-only build (SYNC-1, SYNC-2, tasks.md QA 4)', async ({ page, context }) => {
    const hits: string[] = [];
    context.on('request', (r) => isSyncAsset(r.url()) && hits.push(r.url().split('/').pop()!));
    await boot(page, { clock: true });
    await page.waitForTimeout(2500);
    expect(hits).toEqual([]);
  });

  test('the build output has no Supabase URL in the entry chunk', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dist = new URL('../../dist/', import.meta.url);
    const html = readFileSync(new URL('index.html', dist), 'utf8');
    const entry = /assets\/(index-[^"]+\.js)/.exec(html)![1]!;
    const js = readFileSync(new URL(`assets/${entry}`, dist), 'utf8');
    expect(js).not.toMatch(/\.supabase\.co/);
    expect(js).not.toMatch(/@supabase|GoTrueClient|PostgrestClient/);
    expect(readdirSync(new URL('assets/', dist)).filter((f) => f.endsWith('.js')).length).toBeGreaterThan(1);
  });
});
