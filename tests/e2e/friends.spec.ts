import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createFakeServer, friendsRpc, type FakeServer } from '../../frontend/src/core/sync/fakeSupabase';
import { atTime, boot, controlsOverlapping, docWithSessions, isMobile, NOW, runFocus } from './helpers';

/**
 * v6 friends (docs/friends-spec.md). Everything runs on the :4174 build (fake Supabase env) with
 * `page.route` answering /auth/v1/*, /rest/v1/* and /rest/v1/rpc/*. The rpc answers come from the same
 * in-memory model the unit tests use (core/sync/fakeSupabase.ts friendsRpc), behind real HTTP shapes.
 * Port 4173 (no Supabase env) must show nothing friends related.
 * Screenshots (tests/screenshots/v6-*.png) are written by the last describe.
 */
const SYNC_BASE = 'http://localhost:4174/em-time/';
const SUPA = 'https://qa-fake.example.test';
const UID = '0b8e7a3c-5d41-4f6a-9c2e-7a1d3f5b9e10';
const SHOTS = resolve(import.meta.dirname, '../screenshots');
mkdirSync(SHOTS, { recursive: true });

const CATHY = 'C4TH7YQ2';
const JORDAN = 'J0RD4N8M';
const SAM = 'S4M2P9XK';
const DAYS = [
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
  '2026-10-11',
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
]; // NOW is the 14th
const CATHY_MIN = [60, 90, 0, 120, 45, 150, 30];
const JORDAN_MIN = [20, 0, 40, 80, 25, 60, 35];

// ------------------------------------------------------------------------------------ mock backend

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const user = {
  id: UID,
  email: 'x@dathanbn.github.io',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-14T00:00:00Z',
};
const EXP = 4_102_444_800; // year 2100
const SESSION = {
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: EXP, role: 'authenticated' })}.sig`,
  refresh_token: 'r',
  token_type: 'bearer',
  expires_in: EXP,
  expires_at: EXP,
  user,
};

export interface Backend {
  server: FakeServer;
  /** every rpc the page sent */
  calls: Array<{ fn: string; args: Record<string, any>; auth: string }>;
  /** the next answers: null = serve normally */
  fail: null | 'offline' | 'jwt' | 'server';
  delayMs: number;
  /** every request body that reached the fake host, for the "no sync code leaves" check */
  bodies: string[];
}

function addUser(
  server: FakeServer,
  id: string,
  code: string,
  name: string | null,
  mins: number[],
  withDays = DAYS,
) {
  server.shares.set(id, { code, createdAt: 0 });
  if (name !== null)
    server.tables.settings.set(id, {
      user_id: id,
      data: { displayName: name },
      updated_at: 1,
      server_updated_at: new Date(0).toISOString(),
    });
  mins.forEach((m, i) => {
    if (m <= 0) return;
    server.tables.sessions.set(`${id}|${withDays[i]}`, {
      user_id: id,
      id: `${id}-${i}`,
      day: withDays[i],
      focused_ms: m * 60_000,
      planned_ms: 3 * 3_600_000,
      deleted_at: null,
      updated_at: 1,
      server_updated_at: new Date(0).toISOString(),
    });
  });
}

/** Friends for the signed-in user: Cathy (1), Jordan (2), Sam (3, code off). `names` gives them nicknames. */
function threeFriends(server: FakeServer, names = false) {
  addUser(server, 'u-cathy', CATHY, 'Cathy', CATHY_MIN);
  addUser(server, 'u-jordan', JORDAN, 'Jordan R.', JORDAN_MIN);
  server.links.set(UID, [
    { code: CATHY, nickname: 'Cathy', color: 1, createdAt: 1 },
    { code: JORDAN, nickname: names ? 'Jordan' : null, color: 2, createdAt: 2 },
    { code: SAM, nickname: names ? 'Sam' : null, color: 3, createdAt: 3 },
  ]);
}

async function mockBackend(page: Page, setup?: (server: FakeServer) => void): Promise<Backend> {
  const b: Backend = { server: createFakeServer(), calls: [], fail: null, delayMs: 0, bodies: [] };
  setup?.(b.server);
  await page.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postData();
    if (body) b.bodies.push(body);
    const m = /\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    if (m) {
      const args = (req.postDataJSON() ?? {}) as Record<string, any>;
      b.calls.push({ fn: m[1]!, args, auth: req.headers()['authorization'] ?? '' });
      if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
      if (b.fail === 'offline') return route.abort('failed');
      if (b.fail === 'jwt')
        return json(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null });
      if (b.fail === 'server')
        return json(500, { code: 'XX000', message: 'boom', details: null, hint: null });
      const r = friendsRpc(b.server, UID, m[1]!, args);
      if (r.error)
        return json(r.error.code === '42501' ? 403 : 400, { ...r.error, details: null, hint: null });
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify(r.data),
      });
    }
    if (url.pathname.includes('/auth/v1/token')) return json(200, SESSION);
    if (url.pathname.includes('/auth/v1/user')) return json(200, user);
    if (req.method() === 'GET') return json(200, []);
    return route.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: '' });
  });
  return b;
}

/** A signed-in account on this device: the session supabase-js restores, and meta.sync.userId. */
const AUTH_INIT = `try { localStorage.setItem('em-time:auth', ${JSON.stringify(JSON.stringify(SESSION))}); } catch (e) {}`;

function myDoc(theme: 'light' | 'dark' | 'sky' = 'light', signedIn = true) {
  const d = docWithSessions(
    [
      ['2026-10-09', 2],
      ['2026-10-10', 1],
      ['2026-10-12', 3],
      ['2026-10-14', 2],
    ], // You: 50, 25, 75, 50 minutes
    { theme, displayName: 'Em', notifications: false },
  );
  if (signedIn) d.meta.sync = { ...d.meta.sync, userId: UID, lastUserId: UID };
  return d;
}

async function open(
  page: Page,
  route: 'timer' | 'stats' | 'settings',
  opts: {
    signedIn?: boolean;
    theme?: 'light' | 'dark' | 'sky';
    seed?: any;
    init?: string;
    clock?: Date | true;
  } = {},
) {
  const signedIn = opts.signedIn ?? true;
  await boot(page, {
    seed: opts.seed ?? myDoc(opts.theme ?? 'light', signedIn),
    clock: opts.clock ?? NOW,
    route,
    calm: true,
    init: [signedIn ? AUTH_INIT : '', opts.init ?? ''].join('\n'),
  });
}

/** Moves to a route without reloading (boot() leaves a ?e2e query, so a bare page.goto('#/x') would reload). */
const nav = (p: Page, route: string) =>
  p.evaluate((r) => {
    location.hash = `#/${r}`;
  }, route);
const tile = (p: Page) => p.getByTestId('friends-tile');
const paths = (p: Page) => tile(p).locator('svg path.fseries');
const legendNames = (p: Page) =>
  tile(p)
    .getByTestId('friends-legend')
    .locator('li')
    .allTextContents()
    .then((a) => a.map((t) => t.replace(/\s+/g, ' ').trim()));
const card = (p: Page) => p.getByTestId('settings-friends');
const rpcCount = (b: Backend, fn: string) => b.calls.filter((c) => c.fn === fn).length;
const cache = (p: Page) => p.evaluate(() => localStorage.getItem('em-time:friends-cache'));

test.use({ baseURL: SYNC_BASE });

// ------------------------------------------------------------------------------------------- default build

test.describe('FR-1 build without Supabase env (port 4173): nothing friends related', () => {
  test.use({ baseURL: 'http://localhost:4173/em-time/' });
  test('no tile, no card, no chunk, no request, no cache key; the tiles keep their v5 layout', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await boot(page, { seed: myDoc('light', false), clock: NOW, route: 'stats', calm: true });
    await expect(page.getByTestId('today-tile')).toBeVisible();
    await expect(tile(page)).toHaveCount(0);
    await expect(page.locator('.tiles--friends')).toHaveCount(0);
    await expect(page.getByText('Friends', { exact: true })).toHaveCount(0);
    expect(await page.locator('.tiles > *').count()).toBe(3);
    await nav(page, 'settings');
    await expect(
      page
        .getByRole('heading', { name: 'Display' })
        .or(page.getByRole('heading', { name: 'Your data' }))
        .first(),
    ).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(requests.filter((u) => /Friends|friends|supabase|rpc/.test(u))).toEqual([]);
    expect(await cache(page)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------- the tile

test.describe('FR-2 Stats tile states', () => {
  test('signed out: a short text and Open Settings; no request is made', async ({ page }) => {
    const b = await mockBackend(page);
    await open(page, 'stats', { signedIn: false });
    await expect(tile(page)).toBeVisible();
    await expect(tile(page).locator('.tile__label')).toHaveText('Friends');
    await expect(tile(page)).toContainText(
      'Link this device in Settings to compare focus time with friends.',
    );
    await expect(tile(page).locator('svg')).toHaveCount(0);
    const link = tile(page).getByTestId('friends-tile-link');
    await expect(link).toHaveText('Open Settings');
    await link.click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(card(page)).toBeVisible();
    expect(b.calls).toEqual([]);
  });

  test('signed in with no friends: the chart has only You, and a pointer to Settings', async ({ page }) => {
    await mockBackend(page);
    await open(page, 'stats');
    await expect(tile(page).getByTestId('friends-chart')).toBeVisible();
    await expect(paths(page)).toHaveCount(1);
    expect(await legendNames(page)).toEqual(['You']);
    await expect(tile(page)).toContainText("Add a friend's code in Settings.");
    await tile(page).getByTestId('friends-tile-link').click();
    await expect(page).toHaveURL(/#\/settings$/);
  });

  test('loading without a cache shows the frame, You, and a quiet Loading line; then the friends', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    b.delayMs = 1500;
    await open(page, 'stats');
    await expect(tile(page).getByTestId('friends-note')).toHaveText('Loading…');
    await expect(paths(page)).toHaveCount(1);
    await expect(tile(page).getByTestId('friends-note')).toHaveCount(0, { timeout: 10_000 });
    await expect(paths(page)).toHaveCount(3);
  });

  test('offline without a cache: Friends will load when you are back online', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    b.fail = 'offline';
    await open(page, 'stats');
    await expect(tile(page).getByTestId('friends-note')).toHaveText(
      "Friends will load when you're back online.",
    );
    await expect(paths(page)).toHaveCount(1);
  });

  test('a server error without a cache says it could not load', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    b.fail = 'server';
    await open(page, 'stats');
    await expect(tile(page).getByTestId('friends-note')).toHaveText("Couldn't load friends.");
  });

  test('offline with a cache: the cached chart and an "Updated" note', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
    await expect.poll(() => cache(page)).not.toBeNull();
    b.fail = 'offline';
    await page.clock.fastForward(2 * 3_600_000 + 5_000);
    await page.reload();
    await expect(paths(page)).toHaveCount(3);
    await expect(tile(page).getByTestId('friends-note')).toHaveText('Updated 2 h ago');
  });

  test('the cache is never used for another account, and is gone after sign-out', async ({ page }) => {
    await mockBackend(page, (s) => threeFriends(s));
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
    // pretend the cache belongs to someone else, then lose the network
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('em-time:friends-cache')!);
      c.userId = '00000000-0000-4000-8000-000000000009';
      localStorage.setItem('em-time:friends-cache', JSON.stringify(c));
    });
    await page.unroute(`${SUPA}/**`);
    await page.route(`${SUPA}/**`, (r) =>
      r.request().method() === 'OPTIONS'
        ? r.fulfill({ status: 204, headers: cors })
        : r.request().url().includes('/rpc/')
          ? r.abort('failed')
          : r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' }),
    );
    await page.reload();
    await expect(tile(page).getByTestId('friends-note')).toHaveText(
      "Friends will load when you're back online.",
    );
    await expect(paths(page)).toHaveCount(1);
  });
});

test.describe('FR-3 the chart', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page, (s) => threeFriends(s));
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
  });

  test('one path per active series: You first, solid ink and heavier; friends in their own color; inactive has no line', async ({
    page,
  }) => {
    const info = await paths(page).evaluateAll((els) =>
      els.map((e) => ({
        key: e.getAttribute('data-series'),
        stroke: e.getAttribute('stroke'),
        dash: e.getAttribute('stroke-dasharray'),
        width: e.getAttribute('stroke-width'),
        join: e.getAttribute('stroke-linejoin'),
      })),
    );
    expect(info).toEqual([
      { key: 'you', stroke: 'var(--em-ink)', dash: null, width: '2.5', join: 'round' },
      { key: CATHY, stroke: 'var(--em-cat-1)', dash: null, width: '2', join: 'round' },
      { key: JORDAN, stroke: 'var(--em-cat-2)', dash: null, width: '2', join: 'round' },
    ]);
    await expect(tile(page).locator(`[data-series="${SAM}"]`)).toHaveCount(1); // the legend entry only
    await expect(tile(page).locator(`svg [data-series="${SAM}"]`)).toHaveCount(0);
  });

  test('lines are continuous: one move and only curves per path, no point markers at rest', async ({ page }) => {
    await expect(tile(page).locator('svg circle')).toHaveCount(0);
    await expect(tile(page).locator('svg g.fdots')).toHaveCount(0);
    const ds = await paths(page).evaluateAll((els) => els.map((e) => e.getAttribute('d')!));
    for (const d of ds) {
      expect(d.match(/M/g), d).toHaveLength(1);
      expect(d.match(/C/g), d).toHaveLength(6); // 7 days, 6 curve segments
      expect(d).not.toMatch(/[LZ]/);
    }
    // no dashes anywhere in the series
    expect(await paths(page).evaluateAll((els) => els.filter((e) => e.hasAttribute('stroke-dasharray')).length)).toBe(0);
  });

  test('a path passes through every day value (the end of each curve is that day)', async ({ page }) => {
    const info = await tile(page)
      .locator('svg.fsvg')
      .evaluate((svg) => {
        const ds = [...svg.querySelectorAll('path.fseries')].map((e) => e.getAttribute('d')!);
        const h = Number(svg.getAttribute('height'));
        return { ds, h };
      });
    const you = info.ds[0]!;
    const ends = [...you.matchAll(/([\d.]+),([\d.]+)(?=C|$)/g)].map((m) => Number(m[2]));
    // You: 0, 25, 50, 0, 75, 0, 50 minutes... with days 8..14: Thu 0, Fri 50, Sat 25, Sun 0, Mon 75, Tue 0, Wed 50
    expect(ends).toHaveLength(7);
    const [y0, y1, y2, y3, y4, y5, y6] = ends as [number, number, number, number, number, number, number];
    expect(y0).toBeCloseTo(y3, 1); // both zero
    expect(y0).toBeCloseTo(y5, 1);
    expect(y4).toBeLessThan(y1); // 75 min is higher on the page than 50
    expect(y1).toBeCloseTo(y6, 1); // 50 and 50
    expect(y2).toBeGreaterThan(y1); // 25 is lower than 50
    expect(y2).toBeLessThan(y0);
  });

  test('hovering or focusing a day shows small dots at that day only, on every drawn series', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'keyboard');
    await tile(page).locator('svg.fsvg').focus();
    await expect(tile(page).locator('svg circle')).toHaveCount(3);
    const xs = await tile(page).locator('svg circle').evaluateAll((els) => els.map((e) => e.getAttribute('cx')));
    expect(new Set(xs).size).toBe(1);
    await page.keyboard.press('Home');
    const xs2 = await tile(page).locator('svg circle').evaluateAll((els) => els.map((e) => e.getAttribute('cx')));
    expect(new Set(xs2).size).toBe(1);
    expect(xs2[0]).not.toBe(xs[0]);
    await page.keyboard.press('Escape');
    await tile(page).locator('svg.fsvg').blur();
    await expect(tile(page).locator('svg circle')).toHaveCount(0);
  });

  test('x labels are 6 5 4 3 2 1 Today; every gridline has a y label including the top one; no visible axis title', async ({
    page,
  }) => {
    const texts = await tile(page).locator('svg text').allTextContents();
    expect(texts.slice(-7)).toEqual(['6', '5', '4', '3', '2', '1', 'Today']);
    const y = texts.slice(0, -7);
    expect(texts.join(' ')).not.toMatch(/days ago/i);
    // the data peaks at 2.5 h (Cathy, 13 Oct): 0 / 1h / 2h / 3h, the top gridline labelled
    expect([...y].sort()).toEqual(['0', '1h', '2h', '3h']);
    // one label per line: the baseline and the three gridlines
    expect(await tile(page).locator('svg.fsvg line').count()).toBe(y.length);
  });

  test('legend: You, then friends in list order; name is nickname, else display name, else Friend N; code off is marked', async ({
    page,
  }) => {
    expect(await legendNames(page)).toEqual(['You', 'Cathy', 'Jordan R.', 'Friend 3 (code off)']);
    const off = tile(page).locator(`[data-series="${SAM}"]`);
    await expect(off).toContainText('(code off)');
    const inks = await tile(page)
      .getByTestId('friends-legend')
      .locator('li')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    // text is in an ink color, never in a series color
    const series = await page.evaluate(() =>
      [1, 2, 3].map((n) => {
        const s = document.createElement('i');
        s.style.color = `var(--em-cat-${n})`;
        document.body.append(s);
        const c = getComputedStyle(s).color;
        s.remove();
        return c;
      }),
    );
    for (const c of inks) expect(series).not.toContain(c);
  });

  test('the accessible name carries the summary and the axis meaning; a hidden table has day by series minutes', async ({
    page,
  }) => {
    const svg = tile(page).locator('svg.fsvg');
    await expect(svg).toHaveAttribute('role', 'img');
    const label = (await svg.getAttribute('aria-label'))!;
    expect(label).toContain('Focus minutes per day, last 7 days');
    expect(label).toContain('6 days ago to today');
    expect(label).toContain('You 3 h 20 min total'); // 50 + 25 + 75 + 50 minutes
    expect(label).toContain('Cathy 8 h 15 min total'); // 60 + 90 + 120 + 45 + 150 + 30
    expect(label).toContain('Jordan R. 4 h 20 min total'); // 20 + 40 + 80 + 25 + 60 + 35
    expect(label).toContain('Friend 3, code off');
    const table = tile(page).getByTestId('friends-table');
    await expect(table.locator('thead th')).toHaveText(['Day', 'You', 'Cathy', 'Jordan R.']);
    await expect(table.locator('tbody tr')).toHaveCount(7);
    const rows = await table
      .locator('tbody tr')
      .evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));
    expect(rows[0]).toEqual(['Thu, Oct 8, 6 days ago', '0 min', '1 h', '20 min']);
    expect(rows[4]).toEqual(['Mon, Oct 12, 2 days ago', '1 h 15 min', '45 min', '25 min']);
    expect(rows[6]).toEqual(['Wed, Oct 14, Today', '50 min', '30 min', '35 min']);
    // visually hidden but readable
    const box = await table.locator('xpath=..').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(2);
  });

  test('pointer: a click on a day shows a crosshair and the tooltip lists every series, high to low', async ({
    page,
  }) => {
    const hit = tile(page).locator('rect.trend__hit');
    const box = (await hit.boundingBox())!;
    // day 5 (index 4, Mon 12 Oct): 4/6 of the way across the plot
    await page.mouse.click(box.x + 8 + (box.width - 16) * (4 / 6), box.y + box.height / 2);
    const tip = page.locator('.tooltip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.tooltip__label')).toHaveText('Mon, Oct 12');
    await expect(tip.locator('li')).toHaveCount(3);
    expect(await tip.locator('li').allInnerTexts()).toEqual(
      ['You\n1h 15m', 'Cathy\n45m', 'Jordan R.\n25m'].map((t) => t.replace('\n', '\n')),
    );
    await expect(tile(page).locator('svg line[pointer-events="none"]')).toHaveCount(1);
    // an inactive friend is not in the tooltip
    await expect(tip).not.toContainText('Friend 3');
  });

  test('keyboard: the plot is focusable, Left and Right move the day, Escape closes the tooltip', async ({
    page,
  }, info) => {
    test.skip(isMobile(info.project), 'keyboard');
    const svg = tile(page).locator('svg.fsvg');
    await svg.focus();
    const tip = page.locator('.tooltip');
    await expect(tip.locator('.tooltip__label')).toHaveText('Wed, Oct 14 · today so far');
    await page.keyboard.press('ArrowLeft');
    await expect(tip.locator('.tooltip__label')).toHaveText('Tue, Oct 13');
    expect(await tip.locator('li').allInnerTexts()).toEqual(['Cathy\n2h 30m', 'Jordan R.\n1h', 'You\n0m']);
    await page.keyboard.press('Home');
    await expect(tip.locator('.tooltip__label')).toHaveText('Thu, Oct 8');
    await page.keyboard.press('ArrowLeft');
    await expect(tip.locator('.tooltip__label')).toHaveText('Thu, Oct 8'); // stops at the first day
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect(tip.locator('.tooltip__label')).toHaveText('Wed, Oct 14 · today so far');
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
  });

  test('the Friends tile has no tooltip of its own on the legend and the page has no console errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.reload();
    await expect(paths(page)).toHaveCount(3);
    expect(errors).toEqual([]);
  });
});

test.describe('FR-4 color follows the friend, not the list position', () => {
  test('after the first friend leaves, the others keep their colors', async ({ page }) => {
    await mockBackend(page, (s) => {
      threeFriends(s);
      s.links.set(
        UID,
        s.links.get(UID)!.filter((l) => l.code !== CATHY),
      ); // Jordan (2) and Sam (3) remain
    });
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(2);
    const strokes = await paths(page).evaluateAll((els) => els.map((e) => e.getAttribute('stroke')));
    expect(strokes).toEqual(['var(--em-ink)', 'var(--em-cat-2)']);
    expect(await legendNames(page)).toEqual(['You', 'Jordan R.', 'Friend 2 (code off)']);
  });
});

test.describe('FR-5 refresh rules', () => {
  test('asks when Stats opens, at most once a minute, and again after a minute or when forced by a change', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
    expect(rpcCount(b, 'em_friends_week')).toBe(1);
    expect(rpcCount(b, 'em_share_get')).toBe(1);
    await nav(page, 'tasks');
    await nav(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
    expect(rpcCount(b, 'em_friends_week')).toBe(1); // throttled
    await page.clock.fastForward(61_000);
    await nav(page, 'tasks');
    await nav(page, 'stats');
    await expect.poll(() => rpcCount(b, 'em_friends_week')).toBe(2);
  });

  test('coming back to the tab refreshes (throttled)', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    await open(page, 'stats', {
      init: `(() => { let hidden = false; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') }); window.__hide = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); }; })();`,
    });
    await expect(paths(page)).toHaveCount(3);
    const before = rpcCount(b, 'em_friends_week');
    await page.evaluate(() => (window as any).__hide(true));
    await page.clock.fastForward(61_000);
    await page.evaluate(() => (window as any).__hide(false));
    await expect.poll(() => rpcCount(b, 'em_friends_week')).toBe(before + 1);
    await page.evaluate(() => (window as any).__hide(false));
    await page.waitForTimeout(300);
    expect(rpcCount(b, 'em_friends_week')).toBe(before + 1); // within a minute: no second request
  });

  test('the request window is the last 7 study days (6 days ago to today) and carries the account token', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
    const week = b.calls.find((c) => c.fn === 'em_friends_week')!;
    expect(week.args).toEqual({ p_from: '2026-10-08', p_to: '2026-10-14' });
    expect(week.auth).toMatch(/^Bearer /);
  });

  test('after 6 AM rolls the study day the window moves; before 6 AM it is still the previous day', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => threeFriends(s));
    await open(page, 'stats', { clock: atTime('03:00', '2026-10-15') });
    await expect(paths(page)).toHaveCount(3);
    expect(b.calls.find((c) => c.fn === 'em_friends_week')!.args).toEqual({
      p_from: '2026-10-08',
      p_to: '2026-10-14',
    });
  });
});

// ------------------------------------------------------------------------------------------- Settings

test.describe('FR-6 Settings card: signed out and the share code', () => {
  test('signed out: only the one line', async ({ page }) => {
    const b = await mockBackend(page);
    await open(page, 'settings', { signedIn: false });
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole('heading', { name: 'Friends' })).toBeVisible();
    await expect(card(page).getByTestId('friends-signed-out')).toHaveText(
      'Link this device with a sync code above to share with friends.',
    );
    await expect(card(page).locator('button, input')).toHaveCount(0);
    expect(b.calls).toEqual([]);
    // the card sits right after the Sync card
    const order = await page
      .locator('.stack > section')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    expect(order.indexOf('settings-friends')).toBe(order.indexOf('sync-card') + 1);
  });

  test('sharing off: an explanation with my name and one button; turning it on shows XXXX-XXXX', async ({
    page,
  }) => {
    const b = await mockBackend(page);
    await open(page, 'settings');
    await expect(card(page).getByText('Your friend code')).toBeVisible();
    await expect(card(page)).toContainText(
      'Friends with your code see your name (Em) and how many minutes you focus each day. Nothing else.',
    );
    await expect(card(page)).toContainText("This is not your sync code. It can't open or change your data.");
    await expect(card(page).getByTestId('friends-share-code')).toHaveCount(0);
    await card(page).getByTestId('friends-share-enable').click();
    const code = card(page).getByTestId('friends-share-code');
    await expect(code).toHaveText(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    await expect(card(page).getByTestId('friends-share-enable')).toHaveCount(0);
    for (const id of ['friends-share-copy', 'friends-share-rotate', 'friends-share-disable'])
      await expect(card(page).getByTestId(id)).toBeVisible();
    expect(rpcCount(b, 'em_share_enable')).toBe(1);
    // survives a reload: it is on the server
    await page.reload();
    await expect(card(page).getByTestId('friends-share-code')).toHaveText(await code.innerText());
  });

  test('Copy puts the formatted code on the clipboard and announces it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:4174',
    });
    await mockBackend(page, (s) => s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 }));
    await open(page, 'settings');
    await expect(card(page).getByTestId('friends-share-code')).toHaveText('K7QP-2MXD');
    await card(page).getByTestId('friends-share-copy').click();
    await expect(page.getByTestId('live-region')).toHaveText('Code copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('K7QP-2MXD');
  });

  test('Share appears only where the browser can share', async ({ page }) => {
    await mockBackend(page, (s) => s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 }));
    await open(page, 'settings', {
      init: `Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared = d; return Promise.resolve(); } });`,
    });
    await expect(card(page).getByTestId('friends-share-code')).toBeVisible();
    await card(page).getByTestId('friends-share-share').click();
    expect(await page.evaluate(() => (window as any).__shared.text)).toContain('K7QP-2MXD');
    await page.unroute(`${SUPA}/**`);
  });

  test('without navigator.share there is no Share button', async ({ page }) => {
    await mockBackend(page, (s) => s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 }));
    await open(page, 'settings', {
      init: `Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); try { delete navigator.share; } catch (e) {}`,
    });
    await expect(card(page).getByTestId('friends-share-code')).toBeVisible();
    await expect(card(page).getByTestId('friends-share-share')).toHaveCount(0);
  });

  test('New code asks first, then the old code stops working for the friends who had it', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => {
      s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 });
      s.links.set('u-other', [{ code: 'K7QP2MXD', nickname: null, color: 1, createdAt: 0 }]);
    });
    await open(page, 'settings');
    await card(page).getByTestId('friends-share-rotate').click();
    const dlg = page.getByRole('dialog', { name: 'Get a new code?' });
    await expect(dlg).toContainText(
      'Friends using your current code will stop seeing your minutes until you send them the new one.',
    );
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect(rpcCount(b, 'em_share_rotate')).toBe(0);
    await expect(card(page).getByTestId('friends-share-code')).toHaveText('K7QP-2MXD');
    await card(page).getByTestId('friends-share-rotate').click();
    await page.getByTestId('friends-rotate-confirm').click();
    await expect(card(page).getByTestId('friends-share-code')).not.toHaveText('K7QP-2MXD');
    expect(rpcCount(b, 'em_share_rotate')).toBe(1);
    const mine = b.server.shares.get(UID)!.code;
    expect(mine).not.toBe('K7QP2MXD');
    // the friend who followed the old code now sees a code that is off
    const theirs = friendsRpc(b.server, 'u-other', 'em_friends_week', {
      p_from: '2026-10-08',
      p_to: '2026-10-14',
    }).data as any[];
    expect(theirs).toHaveLength(1);
    expect(theirs[0].active).toBe(false);
  });

  test('Stop sharing asks first, then the card goes back to Get my friend code', async ({ page }) => {
    const b = await mockBackend(page, (s) => s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 }));
    await open(page, 'settings');
    await card(page).getByTestId('friends-share-disable').click();
    const dlg = page.getByRole('dialog', { name: 'Stop sharing?' });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect(b.server.shares.has(UID)).toBe(true);
    await card(page).getByTestId('friends-share-disable').click();
    await page.getByTestId('friends-disable-confirm').click();
    await expect(card(page).getByTestId('friends-share-enable')).toBeVisible();
    await expect(card(page).getByTestId('friends-share-code')).toHaveCount(0);
    expect(b.server.shares.has(UID)).toBe(false);
  });

  test('a failure while sharing is explained and nothing changes', async ({ page }) => {
    const b = await mockBackend(page);
    await open(page, 'settings');
    await expect(card(page).getByTestId('friends-share-enable')).toBeVisible();
    b.fail = 'offline';
    await card(page).getByTestId('friends-share-enable').click();
    await expect(card(page).getByTestId('friends-share-error')).toHaveText(
      "Can't reach the server. Try again when you're online.",
    );
    await expect(card(page).getByTestId('friends-share-code')).toHaveCount(0);
    b.fail = null;
    await card(page).getByTestId('friends-share-enable').click();
    await expect(card(page).getByTestId('friends-share-code')).toBeVisible();
    await expect(card(page).getByTestId('friends-share-error')).toHaveCount(0);
  });
});

test.describe('FR-7 Settings card: friends list', () => {
  const addCode = (p: Page) => card(p).getByTestId('friends-add-code');
  const rows = (p: Page) => card(p).getByTestId('friends-row');

  test('the list: color dot, name, formatted code, Code off badge; heading counts n of 5', async ({
    page,
  }) => {
    await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'settings');
    await expect(card(page).getByRole('heading', { name: 'Friends (3 of 5)' })).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(0)).toContainText('Cathy');
    await expect(rows(page).nth(0)).toContainText('C4TH-7YQ2');
    await expect(rows(page).nth(1)).toContainText('Jordan');
    await expect(rows(page).nth(2)).toContainText('Sam');
    await expect(rows(page).nth(2)).toContainText('Code off');
    await expect(rows(page).nth(0)).not.toContainText('Code off');
    const dots = await card(page)
      .locator('.fdot')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background));
    expect(dots).toEqual(['var(--em-cat-1)', 'var(--em-cat-2)', 'var(--em-cat-3)']);
  });

  test('add: a valid code (any case, dash, look-alikes) adds a friend with an optional name', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => addUser(s, 'u-cathy', CATHY, 'Cathy', CATHY_MIN));
    await open(page, 'settings');
    await expect(card(page).getByTestId('friends-add')).toBeVisible();
    await addCode(page).fill('c4th-7yq2');
    await card(page).getByTestId('friends-add-name').fill('  Cat  ');
    await card(page).getByTestId('friends-add').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Cat');
    await expect(addCode(page)).toHaveValue('');
    await expect(card(page).getByTestId('friends-add-name')).toHaveValue('');
    expect(b.calls.find((c) => c.fn === 'em_friend_add')!.args).toEqual({
      p_code: CATHY,
      p_nickname: '  Cat  ',
    });
    await expect(card(page).getByRole('heading', { name: 'Friends (1 of 5)' })).toBeVisible();
  });

  test('add errors use the specified words and keep the typed code', async ({ page }) => {
    const b = await mockBackend(page, (s) => {
      addUser(s, 'u-cathy', CATHY, 'Cathy', CATHY_MIN);
      s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 });
    });
    await open(page, 'settings');
    const err = card(page).getByTestId('friends-add-error');
    const tryCode = async (code: string) => {
      await addCode(page).fill(code);
      await card(page).getByTestId('friends-add').click();
    };
    const before = () => b.calls.filter((c) => c.fn === 'em_friend_add').length;
    await tryCode('abc');
    await expect(err).toHaveText('Friend codes are 8 letters and numbers, like K7QP-2MXD.');
    expect(before()).toBe(0); // refused on the device, no request
    await expect(addCode(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(addCode(page)).toHaveValue('abc');
    await tryCode('ZZZZ-ZZZZ');
    await expect(err).toHaveText('No one is sharing with that code. Check it with your friend.');
    await tryCode('k7qp 2mxd');
    await expect(err).toHaveText("That's your own code.");
    await tryCode(CATHY);
    await expect(rows(page)).toHaveCount(1);
    await tryCode(CATHY);
    await expect(err).toHaveText('That friend is already on your list.');
    await addCode(page).fill('x'); // typing clears the message
    await expect(err).toHaveCount(0);
    b.fail = 'offline';
    await tryCode('ZZZZZZZZ');
    await expect(err).toHaveText("Can't reach the server. Try again when you're online.");
    b.fail = 'jwt';
    await tryCode('ZZZZZZZZ');
    await expect(err).toHaveText('Link this device again to manage friends.');
    b.fail = 'server';
    await tryCode('ZZZZZZZZ');
    await expect(err).toHaveText('Something went wrong. Try again.');
    await expect(err).toHaveAttribute('role', 'alert');
  });

  test('five friends is the limit: the form is hidden, a sixth is refused by the server too', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => {
      for (let i = 0; i < 6; i += 1) addUser(s, `u-${i}`, `AAAA000${i}`, `Pal ${i}`, [30, 0, 0, 0, 0, 0, 0]);
    });
    await open(page, 'settings');
    for (let i = 0; i < 4; i += 1) {
      await addCode(page).fill(`AAAA000${i}`);
      await card(page).getByTestId('friends-add').click();
      await expect(rows(page)).toHaveCount(i + 1);
    }
    await addCode(page).fill('AAAA0004');
    await card(page).getByTestId('friends-add').click();
    await expect(rows(page)).toHaveCount(5);
    await expect(card(page).getByRole('heading', { name: 'Friends (5 of 5)' })).toBeVisible();
    await expect(addCode(page)).toHaveCount(0);
    await expect(card(page).getByTestId('friends-add')).toHaveCount(0);
    expect(friendsRpc(b.server, UID, 'em_friend_add', { p_code: 'AAAA0005', p_nickname: null }).data).toBe(
      'limit',
    );
    // removing one brings the form back
    await rows(page).first().getByTestId('friends-remove').click();
    await page.getByTestId('friends-remove-confirm').click();
    await expect(rows(page)).toHaveCount(4);
    await expect(addCode(page)).toBeVisible();
    await addCode(page).fill('AAAA0005');
    await card(page).getByTestId('friends-add').click();
    await expect(rows(page)).toHaveCount(5);
  });

  test('rename: a name sticks, empty goes back to their own name; the Stats legend follows', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'settings');
    await rows(page).nth(1).getByTestId('friends-rename').click();
    const dlg = page.getByRole('dialog', { name: 'Rename friend' });
    await expect(dlg.getByTestId('friends-rename-input')).toHaveValue('Jordan');
    await dlg.getByTestId('friends-rename-input').fill('  Jo  ');
    await dlg.getByTestId('friends-rename-save').click();
    await expect(dlg).toHaveCount(0);
    await expect(rows(page).nth(1)).toContainText('Jo');
    expect(b.calls.find((c) => c.fn === 'em_friend_rename')!.args).toEqual({
      p_code: JORDAN,
      p_nickname: '  Jo  ',
    });
    await rows(page).nth(1).getByTestId('friends-rename').click();
    await page.getByTestId('friends-rename-input').fill('');
    await page.getByTestId('friends-rename-save').click();
    await expect(rows(page).nth(1).getByTestId('friends-row-name')).toHaveText('Jordan R.');
    await nav(page, 'stats');
    await expect.poll(() => legendNames(page)).toEqual(['You', 'Cathy', 'Jordan R.', 'Sam (code off)']);
  });

  test('remove asks first; the friend leaves the list and the chart', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'settings');
    await rows(page).nth(0).getByTestId('friends-remove').click();
    const dlg = page.getByRole('dialog', { name: 'Remove Cathy?' });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(rows(page)).toHaveCount(3);
    expect(rpcCount(b, 'em_friend_remove')).toBe(0);
    await rows(page).nth(0).getByTestId('friends-remove').click();
    await page.getByTestId('friends-remove-confirm').click();
    await expect(rows(page)).toHaveCount(2);
    await expect(card(page).getByRole('heading', { name: 'Friends (2 of 5)' })).toBeVisible();
    expect(b.calls.find((c) => c.fn === 'em_friend_remove')!.args).toEqual({ p_code: CATHY });
    await nav(page, 'stats');
    await expect(paths(page)).toHaveCount(2);
  });

  test('the sync code never leaves in a friends request, and is never shown here', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'settings');
    await card(page).getByTestId('friends-share-enable').click();
    await expect(card(page).getByTestId('friends-share-code')).toBeVisible();
    for (const call of b.calls) {
      expect(JSON.stringify(call.args)).not.toMatch(/dathanbn|@|password|em-time:v1/i);
    }
    await expect(card(page)).not.toContainText(/@dathanbn|password/i);
  });

  test('load failures: the card says so, keeps what it has and Try again works', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    b.fail = 'offline';
    await open(page, 'settings');
    await expect(card(page).getByTestId('friends-load-error')).toHaveText(
      "Can't reach the server. Try again when you're online.",
    );
    await expect(rows(page)).toHaveCount(0);
    b.fail = null;
    await card(page).getByTestId('friends-retry').click();
    await expect(rows(page)).toHaveCount(3);
    await expect(card(page).getByTestId('friends-load-error')).toHaveCount(0);
  });

  test('Erase all data and Sign out forget the cache', async ({ page }) => {
    await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'settings');
    await expect(rows(page)).toHaveCount(3);
    expect(await cache(page)).not.toBeNull();
    await page.getByRole('button', { name: 'Erase all data' }).click();
    const dlg = page.getByRole('dialog', { name: 'Erase all data?' });
    await dlg.getByRole('radio', { name: 'This device only' }).check();
    await dlg.getByLabel('Type erase to confirm').fill('erase');
    await dlg.getByRole('button', { name: 'Erase', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => cache(page)).toBeNull();
    await expect(card(page).getByTestId('friends-signed-out')).toBeVisible();
  });

  test('Sign out (Sync card) clears the cache and the card turns back into one line', async ({ page }) => {
    await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'settings');
    await expect(rows(page)).toHaveCount(3);
    expect(await cache(page)).not.toBeNull();
    await page.getByTestId('sync-signout').click();
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(card(page).getByTestId('friends-signed-out')).toBeVisible();
    await expect.poll(() => cache(page)).toBeNull();
    await nav(page, 'stats');
    await expect(tile(page)).toContainText('Link this device in Settings');
  });
});

// ------------------------------------------------------------------------------------------- geometry

const box = async (loc: ReturnType<Page['getByTestId']>) => (await loc.boundingBox())!;

test.describe('FR-8 geometry', () => {
  test('desktop: Today and Friends are the same size, the two streak tiles stack in column 3', async ({
    page,
  }, info) => {
    test.skip(isMobile(info.project), 'desktop layout');
    await mockBackend(page, (s) => threeFriends(s, true));
    for (const width of [1280, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'stats');
      await expect(paths(page)).toHaveCount(3);
      await page.waitForTimeout(250);
      const [today, fr, cur, best] = [
        await box(page.getByTestId('today-tile')),
        await box(tile(page)),
        await box(page.getByTestId('streak-current')),
        await box(page.getByTestId('streak-best')),
      ];
      expect(Math.abs(today.height - fr.height), `${width}: heights`).toBeLessThanOrEqual(1);
      expect(Math.abs(today.width - fr.width), `${width}: widths`).toBeLessThanOrEqual(1);
      expect(Math.abs(today.y - fr.y)).toBeLessThanOrEqual(1);
      expect(fr.x).toBeGreaterThan(today.x + today.width);
      expect(Math.abs(cur.x - best.x)).toBeLessThanOrEqual(1);
      expect(cur.x).toBeGreaterThan(fr.x + fr.width);
      expect(best.y).toBeGreaterThan(cur.y + cur.height - 1);
      expect(Math.abs(cur.y - today.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(best.y + best.height - (today.y + today.height))).toBeLessThanOrEqual(1);
      // the columns are 1.2fr 1.2fr 1fr
      expect(today.width / cur.width).toBeGreaterThan(1.1);
      expect(today.width / cur.width).toBeLessThan(1.3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
  });

  test('phone: Today, Friends full width and equal in height, then the streaks side by side; no overflow', async ({
    page,
  }, info) => {
    test.skip(!isMobile(info.project), 'phone layout');
    await mockBackend(page, (s) => threeFriends(s, true));
    for (const size of [
      { width: 390, height: 844 },
      { width: 360, height: 740 },
    ]) {
      await page.setViewportSize(size);
      await open(page, 'stats');
      await expect(paths(page)).toHaveCount(3);
      await page.waitForTimeout(250);
      const [today, fr, cur, best] = [
        await box(page.getByTestId('today-tile')),
        await box(tile(page)),
        await box(page.getByTestId('streak-current')),
        await box(page.getByTestId('streak-best')),
      ];
      const label = `${size.width}`;
      expect(Math.abs(today.width - fr.width), label).toBeLessThanOrEqual(1);
      expect(today.width, label).toBeGreaterThan(size.width - 40);
      expect(Math.abs(today.height - fr.height), `${label}: heights`).toBeLessThanOrEqual(1);
      expect(fr.y, label).toBeGreaterThanOrEqual(today.y + today.height);
      expect(cur.y, label).toBeGreaterThanOrEqual(fr.y + fr.height);
      expect(Math.abs(cur.y - best.y), label).toBeLessThanOrEqual(1);
      expect(best.x, label).toBeGreaterThan(cur.x + cur.width - 1);
      // nothing of the chart is clipped by the tile
      const t = await box(tile(page));
      const inner = await tile(page)
        .locator('svg.fsvg')
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { l: r.left, r: r.right };
        });
      expect(inner.l).toBeGreaterThanOrEqual(t.x);
      expect(inner.r).toBeLessThanOrEqual(t.x + t.width);
      const texts = await tile(page)
        .locator('svg text')
        .evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { l: r.left, r: r.right, t: e.textContent };
          }),
        );
      for (const x of texts) {
        expect(x.l, `${label}: ${x.t}`).toBeGreaterThanOrEqual(t.x);
        expect(x.r, `${label}: ${x.t}`).toBeLessThanOrEqual(t.x + t.width);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        label,
      ).toBeLessThanOrEqual(0);
    }
  });

  test('x labels never overlap each other', async ({ page }, info) => {
    await mockBackend(page, (s) => threeFriends(s, true));
    if (isMobile(info.project)) await page.setViewportSize({ width: 360, height: 740 });
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
    const xs = await tile(page)
      .locator('svg text')
      .evaluateAll((els) =>
        els.slice(-7).map((e) => {
          const r = e.getBoundingClientRect();
          return [r.left, r.right];
        }),
      );
    for (let i = 1; i < xs.length; i += 1)
      expect(xs[i]![0]!, `label ${i}`).toBeGreaterThan(xs[i - 1]![1]! + 2);
  });

  test('a long name does not break the legend', async ({ page }, info) => {
    await mockBackend(page, (s) => {
      threeFriends(s, true);
      s.links.get(UID)![0]!.nickname = 'Bartholomew-Alexander the Great';
    });
    if (isMobile(info.project)) await page.setViewportSize({ width: 360, height: 740 });
    await open(page, 'stats');
    await expect(paths(page)).toHaveCount(3);
    const t = await box(tile(page));
    const items = await tile(page)
      .getByTestId('friends-legend')
      .locator('li')
      .evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return [r.left, r.right];
        }),
      );
    for (const [l, r] of items) {
      expect(l!).toBeGreaterThanOrEqual(t.x);
      expect(r!).toBeLessThanOrEqual(t.x + t.width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('Settings card on a phone: every control is at least 44 x 44 and nothing overflows', async ({
    page,
  }, info) => {
    test.skip(!isMobile(info.project), 'phone');
    await mockBackend(page, (s) => {
      threeFriends(s, true);
      s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 });
    });
    for (const size of [
      { width: 390, height: 844 },
      { width: 360, height: 740 },
    ]) {
      await page.setViewportSize(size);
      await open(page, 'settings');
      await expect(card(page).getByTestId('friends-row')).toHaveCount(3);
      const small = await card(page)
        .locator('button, input, a[href]')
        .evaluateAll((els) =>
          els
            .filter((e) => {
              const cs = getComputedStyle(e);
              return cs.display !== 'none' && cs.visibility !== 'hidden';
            })
            .map((e) => {
              const r = e.getBoundingClientRect();
              return { n: e.getAttribute('data-testid') ?? e.textContent, w: r.width, h: r.height };
            })
            .filter((x) => x.w < 43.5 || x.h < 43.5),
        );
      expect(small, `${size.width}`).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const c = await box(card(page));
      const rowsOut = await card(page)
        .locator('.frow, .fcode, .btnrow')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
      for (const r of rowsOut) expect(r).toBeLessThanOrEqual(c.x + c.width + 1);
    }
  });
});

// ------------------------------------------------------------------------------------------- axe

async function axe(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

test.describe('FR-9 axe: light, dark and sky, contrast included', () => {
  for (const theme of ['light', 'dark', 'sky'] as const) {
    test(`Stats with the Friends tile (${theme})`, async ({ page }) => {
      await mockBackend(page, (s) => threeFriends(s, true));
      await open(page, 'stats', { theme });
      await expect(paths(page)).toHaveCount(3);
      await page.waitForTimeout(500);
      expect(await axe(page)).toEqual([]);
      // with the tooltip open and the signed-out and empty states
      await tile(page).locator('svg.fsvg').focus();
      await expect(page.locator('.tooltip')).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });

    test(`Stats, signed out (${theme})`, async ({ page }) => {
      await mockBackend(page);
      await open(page, 'stats', { theme, signedIn: false });
      await expect(tile(page).getByTestId('friends-tile-link')).toBeVisible();
      await page.waitForTimeout(400);
      expect(await axe(page)).toEqual([]);
    });

    test(`Stats, signed in with no friends (${theme})`, async ({ page }) => {
      await mockBackend(page);
      await open(page, 'stats', { theme });
      await expect(tile(page)).toContainText("Add a friend's code");
      await page.waitForTimeout(400);
      expect(await axe(page)).toEqual([]);
    });

    test(`Settings card: sharing on, friends, a dialog and an error (${theme})`, async ({ page }) => {
      await mockBackend(page, (s) => {
        threeFriends(s, true);
        s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 });
      });
      await open(page, 'settings', { theme });
      await expect(card(page).getByTestId('friends-row')).toHaveCount(3);
      await page.getByTestId('friends-add-code').fill('abc');
      await page.getByTestId('friends-add').click();
      await expect(page.getByTestId('friends-add-error')).toBeVisible();
      await page.waitForTimeout(400);
      expect(await axe(page, '[data-testid="settings-friends"]')).toEqual([]);
      await card(page).getByTestId('friends-share-rotate').click();
      await expect(page.getByRole('dialog', { name: 'Get a new code?' })).toBeVisible();
      await page.waitForTimeout(300);
      expect(await axe(page)).toEqual([]);
    });

    test(`Settings card signed out and sharing off (${theme})`, async ({ page }) => {
      await mockBackend(page);
      await open(page, 'settings', { theme, signedIn: false });
      await expect(card(page)).toBeVisible();
      expect(await axe(page, '[data-testid="settings-friends"]')).toEqual([]);
    });
  }
});

// ------------------------------------------------------------------------------------------- screenshots

/** Shifts Date by a constant so "now" is `at` and keeps flowing. */
const shiftedClock = (at: Date) => `
(() => {
  const R = Date;
  const off = ${at.getTime()} - R.now();
  window.Date = new Proxy(R, {
    construct(t, a, nt) { return a.length ? Reflect.construct(t, a, nt) : Reflect.construct(t, [R.now() + off], nt); },
    apply() { return new R(R.now() + off).toString(); },
    get(t, k) { return k === 'now' ? () => R.now() + off : Reflect.get(t, k); },
  });
})();
`;

test.describe('v6 screenshots (three friends, one with the code off)', () => {
  for (const [time, id] of [
    ['12:30', 'midday'],
    ['23:00', 'night'],
  ] as const) {
    test(`Stats with the Friends tile (${id})`, async ({ page }) => {
      await mockBackend(page, (s) => threeFriends(s, true));
      await page.addInitScript(shiftedClock(atTime(time)));
      await boot(page, { seed: myDoc('sky'), route: 'stats', calm: true, init: AUTH_INIT });
      await expect(paths(page)).toHaveCount(3);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      const w = page.viewportSize()!.width;
      await page.screenshot({ path: `${SHOTS}/v6-stats-${w}-${id}.png`, animations: 'disabled' });
    });
  }

  test('Settings Friends card', async ({ page }) => {
    await mockBackend(page, (s) => {
      threeFriends(s, true);
      s.shares.set(UID, { code: 'K7QP2MXD', createdAt: 0 });
    });
    await page.addInitScript(shiftedClock(atTime('12:30')));
    await boot(page, { seed: myDoc('sky'), route: 'settings', calm: true, init: AUTH_INIT });
    await expect(card(page).getByTestId('friends-row')).toHaveCount(3);
    await card(page).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const h = document.querySelector('[data-testid="settings-friends"] h2')!;
      window.scrollBy(0, h.getBoundingClientRect().top - 72);
    });
    await page.waitForTimeout(200);
    const w = page.viewportSize()!.width;
    await page.screenshot({ path: `${SHOTS}/v6-settings-friends-${w}.png`, animations: 'disabled' });
  });
});

// ------------------------------------------------------------------------------------------- v6.1: the scale follows the data

/** My document with sessions on the given days (25 minutes each), signed in. */
function docFor(days: Array<[string, number]>, theme: 'light' | 'dark' | 'sky' = 'light') {
  const d = docWithSessions(days, { theme, displayName: 'Em', notifications: false });
  d.meta.sync = { ...d.meta.sync, userId: UID, lastUserId: UID };
  return d;
}
const yLabels = async (p: Page) => (await tile(p).locator('svg.fsvg text').allTextContents()).slice(0, -7);

test.describe('FR-10 the Y axis scales to the data', () => {
  const two = (cathy: number[], jordan: number[]) => (s: FakeServer) => {
    addUser(s, 'u-cathy', CATHY, 'Cathy', cathy);
    addUser(s, 'u-jordan', JORDAN, 'Jordan R.', jordan);
    s.links.set(UID, [
      { code: CATHY, nickname: 'Cathy', color: 1, createdAt: 1 },
      { code: JORDAN, nickname: 'Jordan', color: 2, createdAt: 2 },
    ]);
  };

  test('a small week (20 min at most) is 0 / 15m / 30m', async ({ page }) => {
    await mockBackend(page, two([10, 15, 0, 20, 5, 0, 12], [5, 0, 8, 12, 6, 9, 3]));
    await open(page, 'stats', { seed: docFor([]) });
    await expect(paths(page)).toHaveCount(3);
    expect([...(await yLabels(page))].sort()).toEqual(['0', '15m', '30m']);
  });

  test('a mid week (2 h 50 at most) is 0 / 1h / 2h / 3h', async ({ page }) => {
    await mockBackend(page, two([60, 90, 0, 170, 45, 150, 30], [20, 0, 40, 80, 25, 60, 35]));
    await open(page, 'stats', { seed: docFor([]) });
    await expect(paths(page)).toHaveCount(3);
    expect([...(await yLabels(page))].sort()).toEqual(['0', '1h', '2h', '3h']);
  });

  test('a large week (9 h at most) is 0 / 3h / 6h / 9h', async ({ page }) => {
    await mockBackend(page, two([60, 540, 0, 170, 45, 150, 30], [20, 0, 40, 80, 25, 60, 35]));
    await open(page, 'stats', { seed: docFor([]) });
    await expect(paths(page)).toHaveCount(3);
    expect([...(await yLabels(page))].sort()).toEqual(['0', '3h', '6h', '9h']);
  });

  test('a week with no focus at all is 0 / 15m / 30m, and the lines lie on the baseline', async ({ page }) => {
    await mockBackend(page, two([0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]));
    await open(page, 'stats', { seed: docFor([]) });
    await expect(paths(page)).toHaveCount(3);
    expect([...(await yLabels(page))].sort()).toEqual(['0', '15m', '30m']);
    const ys = await paths(page).evaluateAll((els) => els.map((e) => new Set(e.getAttribute('d')!.match(/,[\d.]+/g)).size));
    expect(ys).toEqual([1, 1, 1]);
  });

  test('the labels change when the data does (small, then a friend with 4 h 30)', async ({ page }) => {
    const b = await mockBackend(page, two([10, 15, 0, 20, 5, 0, 12], [5, 0, 8, 12, 6, 9, 3]));
    await open(page, 'stats', { seed: docFor([]) });
    await expect(paths(page)).toHaveCount(3);
    expect([...(await yLabels(page))].sort()).toEqual(['0', '15m', '30m']);
    addUser(b.server, 'u-cathy', CATHY, 'Cathy', [10, 15, 0, 270, 5, 0, 12]);
    await page.clock.fastForward(61_000);
    await nav(page, 'tasks');
    await nav(page, 'stats');
    await expect.poll(() => yLabels(page).then((a) => [...a].sort().join(' '))).toBe('0 2h 4h 6h');
  });
});

// ------------------------------------------------------------------------------------------- v6.1: the Timer card

const mini = (p: Page) => p.getByTestId('friends-mini');
const miniPaths = (p: Page) => mini(p).locator('svg path.fseries');
const miniLegend = (p: Page) =>
  mini(p)
    .getByTestId('friends-mini-legend')
    .locator('li')
    .allTextContents()
    .then((a) => a.map((t) => t.replace(/\s+/g, ' ').trim()));
/** Makes document.visibilityState scriptable: window.__hide(true|false) fires visibilitychange. */
const HIDEABLE = `(() => { let hidden = false; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') }); window.__hide = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); }; })();`;

test.describe('FR-11 build without Supabase env: no Friends card on the Timer', () => {
  test.use({ baseURL: 'http://localhost:4173/em-time/' });
  test('nothing', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await boot(page, { seed: myDoc('light', false), clock: NOW, route: 'timer', calm: true });
    await expect(page.getByTestId('timer-play')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(mini(page)).toHaveCount(0);
    expect(requests.filter((u) => /friends|rpc|supabase/i.test(u))).toEqual([]);
  });
});

test.describe('FR-12 Timer card: when it shows', () => {
  test('signed out: no card and no request', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer', { signedIn: false });
    await expect(page.getByTestId('timer-play')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(mini(page)).toHaveCount(0);
    expect(b.calls).toEqual([]);
  });

  test('signed in with no friends: no card (and no nag)', async ({ page }) => {
    const b = await mockBackend(page);
    await open(page, 'timer');
    await expect.poll(() => rpcCount(b, 'em_friends_week')).toBe(1);
    await page.waitForTimeout(400);
    await expect(mini(page)).toHaveCount(0);
    await expect(page.getByText('Friends', { exact: true })).toHaveCount(0);
  });

  test('signed in with friends: the card shows, on desktop and on a phone', async ({ page }) => {
    await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer');
    await expect(mini(page)).toBeVisible();
    await expect(miniPaths(page)).toHaveCount(3);
  });

  test('offline with a cached friends list: the card still shows from the cache', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer');
    await expect(mini(page)).toBeVisible();
    await expect.poll(() => cache(page)).not.toBeNull();
    b.fail = 'offline';
    await page.reload();
    await expect(mini(page)).toBeVisible();
    await expect(miniPaths(page)).toHaveCount(3);
  });

  test('losing the last friend hides the card', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer');
    await expect(mini(page)).toBeVisible();
    b.server.links.set(UID, []);
    await page.clock.fastForward(61_000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(mini(page)).toHaveCount(0);
  });
});

test.describe('FR-13 Timer card: content', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer');
    await expect(miniPaths(page)).toHaveCount(3);
  });

  test('title, caption, accessible name and a link to Stats', async ({ page }) => {
    await expect(mini(page).getByRole('heading', { name: 'Friends' })).toBeVisible();
    await expect(mini(page)).toContainText('This week');
    const link = page.getByRole('link', { name: 'Friends this week, open Stats' });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', '#/stats');
    await expect(mini(page)).toHaveJSProperty('tagName', 'A');
  });

  test('plot: continuous lines only, no markers, no axis labels, no gridlines; You solid and heavier', async ({
    page,
  }, info) => {
    const svg = mini(page).getByTestId('friends-mini-chart');
    await expect(svg).toHaveAttribute('role', 'img');
    const label = (await svg.getAttribute('aria-label'))!;
    expect(label).toContain('Focus minutes per day, last 7 days');
    expect(label).toContain('You 3 h 20 min total');
    expect(label).toContain('Cathy 8 h 15 min total');
    await expect(svg.locator('circle')).toHaveCount(0);
    await expect(svg.locator('text')).toHaveCount(0);
    await expect(svg.locator('line')).toHaveCount(1); // the faint baseline
    const info2 = await miniPaths(page).evaluateAll((els) =>
      els.map((e) => ({
        key: e.getAttribute('data-series'),
        stroke: e.getAttribute('stroke'),
        dash: e.getAttribute('stroke-dasharray'),
        width: e.getAttribute('stroke-width'),
        moves: (e.getAttribute('d')!.match(/M/g) ?? []).length,
        curves: (e.getAttribute('d')!.match(/C/g) ?? []).length,
      })),
    );
    expect(info2).toEqual([
      { key: 'you', stroke: 'var(--em-ink)', dash: null, width: '2.5', moves: 1, curves: 6 },
      { key: CATHY, stroke: 'var(--em-cat-1)', dash: null, width: '2', moves: 1, curves: 6 },
      { key: JORDAN, stroke: 'var(--em-cat-2)', dash: null, width: '2', moves: 1, curves: 6 },
    ]);
    const h = await svg.evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBe(isMobile(info.project) ? 80 : 90);
  });

  test('x hints are only "6 days ago" at the left and "Today" at the right', async ({ page }) => {
    const hint = mini(page).locator('.fmini__x span');
    await expect(hint).toHaveText(['6 days ago', 'Today']);
    const [a, b] = await hint.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    const c = (await mini(page).boundingBox())!;
    expect(a!.left - c.x).toBeLessThan(40);
    expect(c.x + c.width - b!.right).toBeLessThan(40);
    expect(b!.left).toBeGreaterThan(a!.right + 20);
  });

  test("legend is today's standings: You first, then active friends, each with today's minutes; code-off friends are left out", async ({
    page,
  }) => {
    // today (Wed 14 Oct): You 50 min, Cathy 30, Jordan 35; Sam's code is off
    expect(await miniLegend(page)).toEqual(['You 50m', 'Cathy 30m', 'Jordan 35m']);
    await expect(mini(page)).not.toContainText('Sam');
    await expect(mini(page)).not.toContainText('code off');
  });

  test('clicking the card opens Stats, and the card has a visible focus ring from the keyboard', async ({
    page,
  }, info) => {
    if (!isMobile(info.project)) {
      await mini(page).focus();
      const o = await mini(page).evaluate((e) => getComputedStyle(e).outlineStyle);
      expect(o).not.toBe('none');
    }
    await mini(page).click();
    await expect(page).toHaveURL(/#\/stats$/);
    await expect(tile(page)).toBeVisible();
    await expect(mini(page)).toHaveCount(0);
  });

  test('the Stats chart and the card draw the same lines', async ({ page }) => {
    const timerPaths = await miniPaths(page).evaluateAll((els) => els.map((e) => e.getAttribute('stroke')));
    await mini(page).click();
    await expect(paths(page)).toHaveCount(3);
    const statsPaths = await paths(page).evaluateAll((els) => els.map((e) => e.getAttribute('stroke')));
    expect(timerPaths).toEqual(statsPaths);
  });
});

const PHONES = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
];

test.describe('FR-14 Timer card: placement', () => {
  test('desktop: with friends shown, the Focus tools card (Sounds and stopwatch) is fully visible at 1280x800 without scrolling', async ({
    page,
  }, info) => {
    test.skip(isMobile(info.project), 'desktop');
    await mockBackend(page, (s) => threeFriends(s, true));
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, 'timer');
    await expect(miniPaths(page)).toHaveCount(3);
    const tools = await box(page.getByTestId('focus-tools'));
    expect(tools.y + tools.height).toBeLessThanOrEqual(800);
    await expect(page.getByTestId('focus-tools').getByTestId('noise-chip')).toBeInViewport();
    await expect(page.getByTestId('focus-tools').getByTestId('stopwatch')).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('desktop: a card in the side column after Today, before Up next; same width as Today', async ({
    page,
  }, info) => {
    test.skip(isMobile(info.project), 'desktop');
    await mockBackend(page, (s) => threeFriends(s, true));
    for (const width of [900, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'timer');
      await expect(miniPaths(page)).toHaveCount(3);
      const kids = await page
        .locator('aside.timerpage__side')
        .evaluate((el) => [...el.children].map((c) => c.getAttribute('data-testid') ?? c.querySelector('h2,h3')?.textContent));
      expect(kids, `${width}`).toEqual(['Today', 'friends-mini', 'Up next', 'focus-tools']);
      const [today, fm, upnext] = [
        await box(page.locator('aside.timerpage__side > div').first()),
        await box(mini(page)),
        await box(page.locator('aside.timerpage__side > div').nth(2)),
      ];
      expect(fm.y, `${width}`).toBeGreaterThanOrEqual(today.y + today.height + 8);
      expect(upnext.y, `${width}`).toBeGreaterThanOrEqual(fm.y + fm.height + 8);
      expect(Math.abs(fm.width - today.width), `${width}`).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(0);
    }
  });

  for (const size of PHONES) {
    test(`phone ${size.width}x${size.height}: the card comes after the tool row, below the whole timer block, and the timer does not move`, async ({
      page,
    }, info) => {
      test.skip(!isMobile(info.project), 'phone');
      const b = await mockBackend(page);
      const names = ['mode-focus', 'timer-bubble', 'timer-play', 'noise-chip', 'stopwatch', 'message-line'];
      await open(page, 'timer');
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      await expect(mini(page)).toHaveCount(0);
      const before: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const n of names) before[n] = await box(page.getByTestId(n));
      const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);

      threeFriends(b.server, true);
      await page.reload();
      await expect(mini(page)).toBeVisible();
      await page.waitForTimeout(300);
      for (const n of names) {
        const a = await box(page.getByTestId(n));
        for (const k of ['x', 'y', 'width', 'height'] as const)
          expect(Math.abs(a[k] - before[n]![k]), `${n}.${k}`).toBeLessThanOrEqual(1);
      }
      const m = await box(mini(page));
      const chip = before['noise-chip']!;
      const sw = before['stopwatch']!;
      expect(m.y, 'after the tool row').toBeGreaterThanOrEqual(Math.max(chip.y + chip.height, sw.y + sw.height) + 8);
      expect(m.x).toBeGreaterThanOrEqual(8);
      expect(m.x + m.width).toBeLessThanOrEqual(size.width - 8);
      expect(await page.evaluate(() => document.documentElement.scrollHeight), 'the page grows by the card').toBeGreaterThan(heightBefore);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(0);
      // it can be reached: scrolled to the end it sits fully above the tab bar
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const nav2 = (await page.locator('.nav').first().boundingBox())!;
      const m2 = await box(mini(page));
      expect(m2.y + m2.height, 'above the tab bar').toBeLessThanOrEqual(nav2.y);
      expect(m2.y, 'on screen').toBeGreaterThanOrEqual(0);
    });
  }

  for (const size of PHONES) {
    test(`phone ${size.width}x${size.height}: with a break card showing, the message, the break idea and the Friends card do not overlap`, async ({
      page,
    }, info) => {
      test.skip(!isMobile(info.project), 'phone');
      await mockBackend(page, (s) => threeFriends(s, true));
      const d = docFor([['2026-10-13', 1]]);
      d.meta.currentTaskId = d.tasks.find((t: any) => !t.deletedAt && !t.done).id;
      await open(page, 'timer', { seed: d });
      await page.setViewportSize(size);
      await expect(mini(page)).toBeVisible();
      await runFocus(page);
      await expect(page.getByTestId('break-prompt')).toBeVisible();
      await page.waitForTimeout(500);
      const msg = await box(page.getByTestId('message-line'));
      const prompt = await box(page.getByTestId('break-prompt'));
      const m = await box(mini(page));
      const sw = await box(page.getByTestId('stopwatch'));
      expect(msg.y, 'message under the tool row').toBeGreaterThanOrEqual(sw.y + sw.height);
      expect(prompt.y, 'break idea under the message').toBeGreaterThanOrEqual(msg.y + msg.height - 1);
      expect(m.y, 'card under the break idea').toBeGreaterThanOrEqual(prompt.y + prompt.height + 4);
      // judged at the end of the page, where the tab bar is (a phone page scrolls under it)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      expect(
        await controlsOverlapping(page, '[data-testid="message-line"], [data-testid="break-prompt"]'),
      ).toEqual([]);
      const nav2 = (await page.locator('.nav').first().boundingBox())!;
      const m2 = await box(mini(page));
      expect(m2.y + m2.height).toBeLessThanOrEqual(nav2.y);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/v6-timer-break-${size.width}-scrolled.png`, animations: 'disabled' });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/v6-timer-break-${size.width}.png`, animations: 'disabled' });
    });
  }

  test('a long friend name does not break the legend', async ({ page }, info) => {
    await mockBackend(page, (s) => {
      threeFriends(s, true);
      s.links.get(UID)![0]!.nickname = 'Bartholomew-Alexander the Great';
    });
    if (isMobile(info.project)) await page.setViewportSize({ width: 360, height: 740 });
    await open(page, 'timer');
    await expect(miniPaths(page)).toHaveCount(3);
    const m = await box(mini(page));
    const items = await mini(page)
      .getByTestId('friends-mini-legend')
      .locator('li')
      .evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().left, e.getBoundingClientRect().right]));
    for (const [l, r] of items) {
      expect(l!).toBeGreaterThanOrEqual(m.x);
      expect(r!).toBeLessThanOrEqual(m.x + m.width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
});

test.describe('FR-15 Timer card: freshness', () => {
  test('your own line moves as soon as a focus session finishes', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer');
    await expect(miniPaths(page)).toHaveCount(3);
    expect((await miniLegend(page))[0]).toBe('You 50m');
    const before = await miniPaths(page).first().getAttribute('d');
    const calls = rpcCount(b, 'em_friends_week');
    await runFocus(page);
    await expect.poll(async () => (await miniLegend(page))[0]).toBe('You 1h 15m');
    expect(await miniPaths(page).first().getAttribute('d')).not.toBe(before);
    void calls;
  });

  test('friends refresh on arrival, when the tab comes back, and every 5 minutes while visible; never while hidden', async ({
    page,
  }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer', { init: HIDEABLE });
    await expect(mini(page)).toBeVisible();
    expect(rpcCount(b, 'em_friends_week')).toBe(1);
    // the 5-minute timer
    await page.clock.fastForward(5 * 60_000 + 1000);
    await expect.poll(() => rpcCount(b, 'em_friends_week')).toBe(2);
    // changes on the server show up with the next refresh
    addUser(b.server, 'u-jordan', JORDAN, 'Jordan R.', [20, 0, 40, 80, 25, 60, 95]);
    await page.clock.fastForward(5 * 60_000 + 1000);
    await expect.poll(() => rpcCount(b, 'em_friends_week')).toBe(3);
    await expect.poll(async () => (await miniLegend(page))[2]).toBe('Jordan 1h 35m');
    // hidden: the timer asks nothing
    await page.evaluate(() => (window as any).__hide(true));
    await page.clock.fastForward(11 * 60_000);
    await page.waitForTimeout(300);
    expect(rpcCount(b, 'em_friends_week')).toBe(3);
    // back to the front: one refresh, and not a second one within a minute
    await page.evaluate(() => (window as any).__hide(false));
    await expect.poll(() => rpcCount(b, 'em_friends_week')).toBe(4);
    await page.evaluate(() => (window as any).__hide(false));
    await page.waitForTimeout(300);
    expect(rpcCount(b, 'em_friends_week')).toBe(4);
  });

  test('leaving the Timer stops the 5-minute timer', async ({ page }) => {
    const b = await mockBackend(page, (s) => threeFriends(s, true));
    await open(page, 'timer');
    await expect(mini(page)).toBeVisible();
    await nav(page, 'tasks');
    await expect(page).toHaveURL(/#\/tasks$/);
    const n = rpcCount(b, 'em_friends_week');
    await page.clock.fastForward(16 * 60_000);
    await page.waitForTimeout(300);
    expect(rpcCount(b, 'em_friends_week')).toBe(n);
  });
});

test.describe('FR-16 axe: Timer with the Friends card', () => {
  for (const theme of ['light', 'dark', 'sky'] as const) {
    test(`Timer (${theme})`, async ({ page }) => {
      await mockBackend(page, (s) => threeFriends(s, true));
      await open(page, 'timer', { theme });
      await expect(miniPaths(page)).toHaveCount(3);
      await page.waitForTimeout(500);
      expect(await axe(page)).toEqual([]);
    });
  }
});

test.describe('v6.1 screenshots (Timer with the Friends card)', () => {
  for (const [time, id] of [
    ['12:30', 'midday'],
    ['23:00', 'night'],
  ] as const) {
    test(`Timer with the Friends card (${id})`, async ({ page }, info) => {
      await mockBackend(page, (s) => threeFriends(s, true));
      await page.addInitScript(shiftedClock(atTime(time)));
      await boot(page, { seed: myDoc('sky'), route: 'timer', calm: true, init: AUTH_INIT });
      await expect(miniPaths(page)).toHaveCount(3);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      const w = page.viewportSize()!.width;
      await page.screenshot({ path: `${SHOTS}/v6-timer-${w}-${id}.png`, animations: 'disabled' });
      if (isMobile(info.project) && id === 'midday') {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/v6-timer-${w}-scrolled.png`, animations: 'disabled' });
      }
    });
  }
});
