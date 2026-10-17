import { expect, test, type Page } from '@playwright/test';
import { MIN, boot, fixture, go, isMobile, runFocus, setHidden } from './helpers';

// ---------- independent expectations, computed from the fixture's own records ----------
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(utc(day) + n * 86_400_000);
const dow = (day: string) => new Date(utc(day)).getUTCDay();
const short = (day: string) => `${MO[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}`;
const label = (day: string) => `${WD[dow(day)]}, ${short(day)}`;
const fmt = (m: number) => {
  const t = Math.round(m);
  const h = Math.floor(t / 60);
  return h === 0 ? `${t}m` : t % 60 === 0 ? `${h}h` : `${h}h ${t % 60}m`;
};
const weekStart = (day: string, startsOn: 0 | 1) => addDays(day, -((dow(day) - startsOn + 7) % 7));
const levelOf = (min: number, goal: number) => {
  if (min <= 0) return 0;
  const r = min / goal;
  return r < 0.25 ? 1 : r < 0.5 ? 2 : r < 1 ? 3 : 4;
};

const TODAY = '2026-10-14'; // Wednesday
const doc = () => fixture('backup-valid.json');
const live = (d: any) => d.sessions.filter((s: any) => !s.deletedAt);
function minutesByDay(d: any): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of live(d)) m.set(s.day, (m.get(s.day) ?? 0) + s.focusedMs / MIN);
  return m;
}
function streaks(d: any, today: string) {
  const days = new Set(live(d).map((s: any) => s.day));
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  for (const day of days as Set<string>) {
    if (days.has(addDays(day, -1))) continue; // only run starts
    let n = 0;
    let c = day;
    while (days.has(c)) {
      n++;
      c = addDays(c, 1);
    }
    best = Math.max(best, n);
  }
  return { current, best, todayCounts: days.has(today) };
}
const sessionOf = (day: string, hour: number, minutes: number, task: any = null, n = 0) => {
  const [y, m, d] = day.split('-').map(Number);
  const startedAt = Date.UTC(y!, m! - 1, d!, hour + 7, n * 31); // October 2026 is PDT (UTC-7)
  return {
    id: `d2a9b6c4-0f3e-4d8a-9e21-${String(startedAt % 1e12).padStart(12, '0')}`,
    startedAt,
    endedAt: startedAt + minutes * MIN,
    day,
    tzOffsetMin: -420,
    plannedMs: minutes * MIN,
    focusedMs: minutes * MIN,
    taskId: task?.id ?? null,
    taskName: task?.name ?? null,
    categoryId: task?.categoryId ?? null,
    createdAt: startedAt + minutes * MIN,
    updatedAt: startedAt + minutes * MIN,
    deletedAt: null,
  };
};
/** The fixture with its sessions replaced. */
const docWith = (sessions: any[], patch: (d: any) => void = () => undefined) => {
  const d = doc();
  d.sessions = sessions;
  patch(d);
  return d;
};

const hits = (page: Page) => page.getByTestId('week-columns').locator('rect.hit');
const cell = (page: Page, day: string) => page.locator(`[data-testid="heatmap-cell"][data-day="${day}"]`);
const tooltip = (page: Page) => page.locator('.tooltip');
// v2 (design.md 7.3): the subtitle moved from under the section title to the first line of the chart card
const weekRange = (page: Page) => page.locator('[aria-labelledby="h-week"] .section__sub');
/** Scroll first and let the scroll event pass: the chart tooltip (rightly) hides on scroll. */
const reveal = async (page: Page, loc: ReturnType<Page['locator']>) => {
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
};
const tapOrHover = async (page: Page, project: { name: string }, loc: ReturnType<Page['locator']>) => {
  await reveal(page, loc);
  await (isMobile(project) ? loc.tap() : loc.hover());
};
/** Gives SVG nodes a real (lowercase) tabindex so a test can exercise the arrow-key logic on its own. */
const makeFocusable = (page: Page, selector: string, value: number) =>
  page.evaluate(([sel, v]) => document.querySelectorAll(sel as string).forEach((e) => e.setAttribute('tabindex', String(v))), [selector, value] as const);

test.describe('stats: week', () => {
  test('WK-1 WK-3 seven columns Monday to Sunday, a date range header and the week total', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
    await expect(weekRange(page)).toHaveText('Oct 12 to Oct 18');
    await expect(hits(page)).toHaveCount(7);
    const mins = minutesByDay(doc());
    for (let i = 0; i < 7; i++) {
      const day = addDays('2026-10-12', i);
      const n = live(doc()).filter((s: any) => s.day === day).length;
      await expect(hits(page).nth(i)).toHaveAttribute('aria-label', `${label(day)}: ${fmt(mins.get(day) ?? 0)}, ${n} ${n === 1 ? 'session' : 'sessions'}`);
    }
    // day labels along the axis
    await expect(page.getByTestId('week-columns').locator('text.axis-text').filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ })).toHaveText(
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    );
    const total = [0, 1, 2, 3, 4, 5, 6].reduce((a, i) => a + (mins.get(addDays('2026-10-12', i)) ?? 0), 0);
    await expect(page.getByTestId('week-total')).toContainText(fmt(total));
  });

  test('WK-1 "Week starts on" Sunday moves the range and the columns', async ({ page }) => {
    await boot(page, {
      seed: docWith(live(doc()), (d) => (d.settings.weekStartsOn = 0)),
      clock: true,
      route: 'stats',
    });
    await expect(weekRange(page)).toHaveText('Oct 11 to Oct 17');
    await expect(page.getByTestId('week-columns').locator('text.axis-text').filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ })).toHaveText(
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    );
    await expect(hits(page).first()).toHaveAttribute('aria-label', /^Sun, Oct 11:/);
  });

  test('WK-2 per-task totals sorted by minutes, deleted tasks labelled, untasked sessions under "No task"', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const d = doc();
    const wk = live(d).filter((s: any) => s.day >= '2026-10-12' && s.day <= '2026-10-18');
    const deleted = new Set(d.tasks.filter((t: any) => t.deletedAt).map((t: any) => t.id));
    const by = new Map<string, number>();
    for (const s of wk) {
      const n = s.taskName === null ? 'No task' : deleted.has(s.taskId) ? `${s.taskName} (deleted)` : s.taskName;
      by.set(n, (by.get(n) ?? 0) + s.focusedMs / MIN);
    }
    const expected = [...by.entries()].sort((a, b) => b[1] - a[1]);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(expected.some(([n]) => n.endsWith('(deleted)'))).toBe(true);
    const names = await page.getByTestId('task-totals').locator('.tbar__name').allTextContents();
    const vals = await page.getByTestId('task-totals').locator('.tbar__val').allTextContents();
    expect(names).toHaveLength(expected.length);
    // same rows, in descending order of minutes (ties may fall either way)
    expect(new Set(names.map((n, i) => `${n}|${vals[i]}`))).toEqual(new Set(expected.map(([n, m]) => `${n}|${fmt(m)}`)));
    expect(vals.map((v) => v)).toEqual(expected.map(([, m]) => fmt(m)));
    await expect(page.getByTestId('task-totals').locator('.tbar__name', { hasText: 'No task' })).toHaveCount(1);
    // category swatches: a bar per row painted with its category colour
    await expect(page.getByTestId('task-totals').locator('.tbar__bar').first()).toHaveCSS('background-color', /rgb/);
  });

  test('WK-2 more than 7 tasks: the rest fold into "Other tasks"', async ({ page }) => {
    const cats = doc().categories;
    const tasks = Array.from({ length: 10 }, (_, i) => ({ id: `4b0e2f8a-77c2-4a8e-8b7d-2a3c1e9f1${String(i).padStart(3, '0')}`, name: `Task ${i + 1}`, categoryId: cats[0].id }));
    // Task 1 has the most minutes, Task 10 the least
    const sessions = tasks.map((t, i) => sessionOf('2026-10-13', 8 + (i % 6), 100 - i * 8, t, i));
    const seed = docWith(sessions, (d) => {
      d.tasks = tasks.map((t) => ({ ...t, done: false, createdAt: 1, updatedAt: 1, deletedAt: null }));
    });
    await boot(page, { seed, clock: true, route: 'stats' });
    const names = page.getByTestId('task-totals').locator('.tbar__name');
    await expect(names).toHaveCount(8);
    await expect(names.nth(7)).toHaveText('Other tasks');
    await expect(names.first()).toHaveText('Task 1');
    const rest = tasks.slice(7).reduce((a, _t, k) => a + (100 - (7 + k) * 8), 0);
    await expect(page.getByTestId('task-totals').locator('.tbar__val').nth(7)).toHaveText(fmt(rest));
  });

  test('WK-1 each day column is a keyboard stop that shows its tooltip (A11Y-2)', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const tabs = await hits(page).evaluateAll((els) => els.map((e) => (e as unknown as SVGElement).tabIndex));
    expect(tabs).toEqual([0, 0, 0, 0, 0, 0, 0]);
    await hits(page).nth(2).focus();
    await expect(tooltip(page)).toContainText('Wed, Oct 14');
  });

  test('WK-4 previous and next arrows, "This week", and the first-session boundary', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const prev = page.getByTestId('week-prev');
    const next = page.getByTestId('week-next');
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();
    await expect(page.getByRole('button', { name: 'This week' })).toHaveCount(0);
    await prev.click();
    await expect(weekRange(page)).toHaveText('Oct 5 to Oct 11');
    await expect(next).toBeEnabled();
    await expect(page.getByRole('button', { name: 'This week' })).toBeVisible();
    await next.click();
    await expect(weekRange(page)).toHaveText('Oct 12 to Oct 18');
    // walk back to the week with the first-ever session
    const firstDay = live(doc()).map((s: any) => s.day).sort()[0] as string;
    const firstWeek = weekStart(firstDay, 1);
    const clicks = (utc('2026-10-12') - utc(firstWeek)) / (7 * 86_400_000);
    for (let i = 0; i < clicks; i++) {
      await expect(prev).toBeEnabled();
      await prev.click();
    }
    await expect(weekRange(page)).toHaveText(`${short(firstWeek)} to ${short(addDays(firstWeek, 6))}`);
    await expect(prev).toBeDisabled();
    await page.getByRole('button', { name: 'This week' }).click();
    await expect(weekRange(page)).toHaveText('Oct 12 to Oct 18');
    await expect(page.getByRole('button', { name: 'This week' })).toHaveCount(0);
  });

  test('WK-4 with no data both arrows are disabled', async ({ page }) => {
    await boot(page, { clock: true, route: 'stats' });
    await expect(page.getByTestId('week-prev')).toBeDisabled();
    await expect(page.getByTestId('week-next')).toBeDisabled();
  });

  test('WK-5 a session completed while Stats is open updates the week, the heatmap, the ring and the streak without a reload', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, stubs: true, route: 'timer' });
    await page.getByTestId('timer-play').click();
    await go(page, 'stats');
    const mins = minutesByDay(doc());
    const weekBefore = [0, 1, 2].reduce((a, i) => a + (mins.get(addDays('2026-10-12', i)) ?? 0), 0);
    await expect(page.getByTestId('week-total')).toContainText(fmt(weekBefore));
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('week-total')).toContainText(fmt(weekBefore + 25));
    const today = (mins.get(TODAY) ?? 0) + 25;
    await expect(hits(page).nth(2)).toHaveAttribute('aria-label', new RegExp(`^Wed, Oct 14: ${fmt(today)}, 4 sessions$`));
    await expect(page.getByTestId('goal-ring')).toHaveAttribute('aria-label', new RegExp(`^${Math.round(today)} of 120 minutes today`));
    await expect(cell(page, TODAY)).toHaveAttribute('data-level', String(levelOf(today, 120)));
  });
});

test.describe('stats: heatmap', () => {
  test('HM-1 nine week columns by seven day rows ending with the current week; no cells after today', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const days = (await page.getByTestId('heatmap-cell').evaluateAll((els) => els.map((e) => e.getAttribute('data-day')!))).sort();
    const start = addDays(weekStart(TODAY, 1), -8 * 7); // Mon 17 Aug
    expect(days[0]).toBe(start);
    expect(days.at(-1)).toBe(TODAY);
    expect(days).toHaveLength(8 * 7 + 3);
    expect(days.every((d) => d <= TODAY)).toBe(true);
    expect(new Set(days).size).toBe(days.length);
    // geometry: 9 distinct x positions, 7 distinct y positions
    const boxes = await page.getByTestId('heatmap-cell').evaluateAll((els) =>
      els.map((e) => [Math.round(e.getBoundingClientRect().x), Math.round(e.getBoundingClientRect().y)]),
    );
    expect(new Set(boxes.map((b) => b[0])).size).toBe(9);
    expect(new Set(boxes.map((b) => b[1])).size).toBe(7);
    // row labels
    await expect(page.getByTestId('heatmap').locator('text.axis-text').filter({ hasText: /^(Mon|Wed|Fri)$/ })).toHaveText(['Mon', 'Wed', 'Fri']);
  });

  test('HM-2 shades follow the daily goal: 0 / under 25% / 25-50% / 50-100% / goal or more', async ({ page }) => {
    const plan: Array<[string, number]> = [
      ['2026-10-05', 1], ['2026-10-06', 29], ['2026-10-07', 30], ['2026-10-08', 59], ['2026-10-09', 60],
      ['2026-10-10', 119], ['2026-10-11', 120], ['2026-10-12', 121], ['2026-10-13', 200],
    ];
    const seed = docWith(plan.map(([d, m], i) => sessionOf(d, 9, m, null, i)), (d) => (d.settings.dailyGoalMin = 120));
    await boot(page, { seed, clock: true, route: 'stats' });
    for (const [day, m] of plan) await expect(cell(page, day), `${day} ${m}m @120`).toHaveAttribute('data-level', String(levelOf(m, 120)));
    await expect(cell(page, '2026-10-04')).toHaveAttribute('data-level', '0'); // no sessions
    await expect(cell(page, TODAY)).toHaveAttribute('data-level', '0');
    // the spec example: 1 to 29, 30 to 59, 60 to 119, 120+
    expect(plan.map(([, m]) => levelOf(m, 120))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 4]);
  });

  test('HM-2 the thresholds move with the goal', async ({ page }) => {
    const plan: Array<[string, number]> = [
      ['2026-10-05', 5], ['2026-10-06', 14], ['2026-10-07', 15], ['2026-10-08', 29], ['2026-10-09', 30],
      ['2026-10-10', 59], ['2026-10-11', 60], ['2026-10-12', 61],
    ];
    const seed = docWith(plan.map(([d, m], i) => sessionOf(d, 9, m, null, i)), (d) => (d.settings.dailyGoalMin = 60));
    await boot(page, { seed, clock: true, route: 'stats' });
    for (const [day, m] of plan) await expect(cell(page, day), `${day} ${m}m @60`).toHaveAttribute('data-level', String(levelOf(m, 60)));
  });

  test('HM-2 the fixture heatmap matches levels computed from its own sessions', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const mins = minutesByDay(doc());
    const actual = await page.getByTestId('heatmap-cell').evaluateAll((els) => els.map((e) => [e.getAttribute('data-day')!, e.getAttribute('data-level')!]));
    expect(actual.length).toBe(59);
    for (const [day, level] of actual) expect(level, day).toBe(String(levelOf(mins.get(day!) ?? 0, 120)));
    const levels = new Set(actual.map((a) => a[1]));
    expect(levels.size).toBeGreaterThanOrEqual(3); // the fixture exercises several shades
  });

  test('HM-3 hover (desktop) or tap (phone) shows the date and total', async ({ page }, info) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const mins = minutesByDay(doc());
    const day = '2026-10-13';
    await tapOrHover(page, info.project, cell(page, day));
    await expect(tooltip(page)).toBeVisible();
    await expect(tooltip(page)).toContainText(label(day));
    await expect(tooltip(page)).toContainText(fmt(mins.get(day) ?? 0));
    // the cell's accessible name carries the same
    await expect(cell(page, day)).toHaveAttribute('aria-label', new RegExp(`^${label(day)} · ${fmt(mins.get(day) ?? 0)}, level ${levelOf(mins.get(day) ?? 0, 120)}$`));
    // a day with no sessions reads 0m
    await tapOrHover(page, info.project, cell(page, '2026-08-17'));
    await expect(tooltip(page)).toContainText(label('2026-08-17'));
  });

  test('HM-3 keyboard: the grid is exactly one tab stop and Tab reaches it', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const stops = await page.getByTestId('heatmap-cell').evaluateAll((els) => els.filter((e) => (e as unknown as SVGElement).tabIndex === 0).length);
    expect(stops).toBe(1);
    // Tab from the last control before the grid lands in it
    await page.getByRole('button', { name: 'Show as table' }).nth(0).focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('heatmap-cell');
  });

  test('HM-3 keyboard: arrow keys move between cells and show the tooltip (focus made possible by the test)', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    await makeFocusable(page, '[data-testid="heatmap-cell"]', -1);
    await reveal(page, cell(page, TODAY));
    await cell(page, TODAY).focus();
    await expect(tooltip(page)).toContainText(label(TODAY));
    await page.keyboard.press('ArrowUp'); // rows are weekdays: up is the day before
    await expect(cell(page, '2026-10-13')).toBeFocused();
    await expect(tooltip(page)).toContainText(label('2026-10-13'));
    await page.keyboard.press('ArrowUp');
    await expect(cell(page, '2026-10-12')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // previous week, same weekday
    await expect(cell(page, '2026-10-05')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, '2026-10-06')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // next week, same weekday
    await expect(cell(page, '2026-10-13')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // nothing after this week's column: stays put, no crash
    await expect(cell(page, '2026-10-13')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(cell(page, '2026-08-17')).toBeFocused();
    await page.keyboard.press('End');
    await expect(cell(page, TODAY)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tooltip(page)).toHaveCount(0);
  });

  test('HM-4 legend: Less, five shades, More, and the goal caption (accepted wording: "Strongest shade: daily goal met")', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const legend = page.locator('.heatlegend');
    await expect(legend).toContainText('Less');
    await expect(legend).toContainText('More');
    // spec HM-4 says "Darkest: daily goal met"; the accepted change is "Strongest shade: daily goal met"
    await expect(legend).toContainText('Strongest shade: daily goal met');
    await expect(legend.locator('.heatlegend__scale rect')).toHaveCount(5);
    const fills = await legend.locator('.heatlegend__scale rect').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
    expect(fills).toEqual([0, 1, 2, 3, 4].map((l) => `var(--em-heat-${l})`));
  });

  test('HM summary: active days, total time and best day come from the visible cells', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const mins = minutesByDay(doc());
    const start = addDays(weekStart(TODAY, 1), -56);
    const vis = [...mins.entries()].filter(([d]) => d >= start && d <= TODAY);
    const total = vis.reduce((a, [, m]) => a + m, 0);
    const best = vis.reduce((a, b) => (b[1] > a[1] ? b : a));
    const sum = page.locator('.summary__list');
    await expect(sum.locator('.summary__row').nth(0)).toContainText(String(vis.filter(([, m]) => m > 0).length));
    await expect(sum.locator('.summary__row').nth(1)).toContainText(fmt(total));
    await expect(sum.locator('.summary__row').nth(2)).toContainText(fmt(best[1]));
  });
});

test.describe('stats: trend', () => {
  test('TR-1 defaults to 30 days with faint dots and one line; 90 and 365 via the segmented toggle', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const chart = page.getByTestId('trend-chart');
    await expect(chart).toHaveAttribute('data-range', '30');
    await expect(page.getByTestId('trend-range-30')).toHaveAttribute('aria-checked', 'true');
    // 29 faint dots (today is drawn hollow instead) and a single line plus its area
    await expect(chart.locator('circle.trend__dot')).toHaveCount(29);
    await expect(chart.locator('path[fill="none"]')).toHaveCount(1);
    // the dots are faint: translucent fill, set by the .trend__dot class
    expect(Number(await chart.locator('circle.trend__dot').first().evaluate((e) => getComputedStyle(e).fillOpacity))).toBeLessThan(1);
    await page.getByTestId('trend-range-90').click();
    await expect(chart).toHaveAttribute('data-range', '90');
    await expect(chart.locator('circle.trend__dot')).toHaveCount(89);
    await page.getByTestId('trend-range-365').click();
    await expect(chart).toHaveAttribute('data-range', '365');
    // days before the first session have no dot: Jun 17 to Oct 13
    const first = live(doc()).map((s: any) => s.day).sort()[0] as string;
    const expected = (utc('2026-10-13') - utc(first)) / 86_400_000 + 1;
    await expect(chart.locator('circle.trend__dot')).toHaveCount(expected);
    await expect(chart.locator('path[fill="none"]')).toHaveCount(1);
  });

  test('TR-3 today is a hollow dot and the line stops at yesterday', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const chart = page.getByTestId('trend-chart');
    const hollow = chart.locator('circle[r="4"][fill="var(--em-surface)"]');
    await expect(hollow).toHaveCount(1);
    const cx = Number(await hollow.getAttribute('cx'));
    const d = (await chart.locator('path[fill="none"]').getAttribute('d'))!;
    const lastX = Number([...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].at(-1)![1]);
    const dotXs = await chart.locator('circle.trend__dot').evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))));
    const yesterdayX = Math.max(...dotXs);
    expect(Math.abs(lastX - yesterdayX)).toBeLessThan(1.5);
    expect(cx).toBeGreaterThan(lastX + 1);
  });

  test('TR-4 the trend chart is a keyboard stop (Tab reaches it)', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const tab = await page.getByTestId('trend-chart').locator('svg.trend').evaluate((e) => (e as unknown as SVGElement).tabIndex);
    expect(tab).toBe(0);
    await page.getByTestId('trend-range-365').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('class'))).toContain('trend');
  });

  test('TR-2 TR-4 the crosshair shows the date, the day total and the 7-day average; arrows move it (focus made possible by the test)', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    await makeFocusable(page, 'svg.trend', 0);
    const chart = page.getByTestId('trend-chart').locator('svg.trend');
    await reveal(page, chart);
    await chart.focus();
    await expect(tooltip(page)).toContainText('Wed, Oct 14 · today so far');
    await expect(tooltip(page)).not.toContainText('7-day avg');
    const mins = minutesByDay(doc());
    const avgAt = (day: string) => {
      let s = 0;
      for (let k = 0; k < 7; k++) s += mins.get(addDays(day, -k)) ?? 0;
      return s / 7;
    };
    for (let back = 1; back <= 3; back++) {
      await page.keyboard.press('ArrowLeft');
      const day = addDays(TODAY, -back);
      await expect(tooltip(page)).toContainText(label(day));
      await expect(tooltip(page)).toContainText(fmt(mins.get(day) ?? 0));
      await expect(tooltip(page)).toContainText(`7-day avg ${fmt(avgAt(day))}`);
    }
    await page.keyboard.press('ArrowRight');
    await expect(tooltip(page)).toContainText(label(addDays(TODAY, -2)));
    await page.keyboard.press('Home');
    await expect(tooltip(page)).toContainText(label(addDays(TODAY, -29)));
    await page.keyboard.press('End');
    await expect(tooltip(page)).toContainText('today so far');
    await expect(page.getByTestId('trend-chart').locator('line[stroke="var(--em-axis)"]')).not.toHaveCount(0);
  });

  test('TR-4 pointer: the crosshair snaps to the nearest day', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'pointer hover is a desktop interaction; the phone path is the keyboard test plus pointerdown');
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const hit = page.getByTestId('trend-chart').locator('rect.trend__hit');
    await reveal(page, hit);
    const b = (await hit.boundingBox())!;
    await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2);
    await expect(tooltip(page)).toContainText('today so far');
    await page.mouse.move(b.x + 1, b.y + b.height / 2);
    await expect(tooltip(page)).toContainText(label(addDays(TODAY, -29)));
    await page.mouse.move(b.x - 40, b.y - 40);
    await expect(tooltip(page)).toHaveCount(0);
  });

  test('TR-5 a goal hairline labelled "Goal"', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const chart = page.getByTestId('trend-chart');
    await expect(chart.locator('text', { hasText: /^Goal$/ })).toHaveCount(1);
    // it sits at the 120 minute level: between the 1h and 2h gridline labels
    const y = (t: string) => chart.locator('text.axis-text', { hasText: new RegExp(`^${t}$`) }).first().evaluate((e) => Number(e.getAttribute('y')));
    const goalY = await chart.locator('text', { hasText: /^Goal$/ }).evaluate((e) => Number(e.getAttribute('y')) + 5);
    const y0 = await y('0');
    expect(goalY).toBeLessThan(y0);
    const y1h = await y('1h');
    expect(goalY).toBeLessThan(y1h); // 2h is above 1h
  });

  test('TR-2 with only two days of data the line is absent and the chart says when it will appear', async ({ page }) => {
    const seed = docWith([sessionOf('2026-10-13', 9, 50), sessionOf(TODAY, 9, 25)]);
    await boot(page, { seed, clock: true, route: 'stats' });
    const chart = page.getByTestId('trend-chart');
    await expect(chart).toContainText('The average line appears after 3 days.');
    await expect(chart.locator('path[fill="none"]')).toHaveCount(0);
  });
});

test.describe('stats: streaks and goal', () => {
  test('STK-1..3 current and best streak are computed from days with a session', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const s = streaks(doc(), TODAY);
    expect(s.current).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('streak-current')).toContainText(`${s.current} ${s.current === 1 ? 'day' : 'days'}`);
    await expect(page.getByTestId('streak-best')).toContainText(`${s.best} ${s.best === 1 ? 'day' : 'days'}`);
    await expect(page.getByTestId('streak-current')).not.toContainText("Today's not counted yet");
  });

  test('STK-2 when today has no session yet but yesterday did: the streak is kept with a note', async ({ page }) => {
    const seed = docWith(live(doc()).filter((s: any) => s.day !== TODAY));
    await boot(page, { seed, clock: true, route: 'stats' });
    const s = streaks(seed, TODAY);
    expect(s.todayCounts).toBe(false);
    expect(s.current).toBeGreaterThan(0);
    await expect(page.getByTestId('streak-current')).toContainText(`${s.current} ${s.current === 1 ? 'day' : 'days'}`);
    await expect(page.getByTestId('streak-current')).toContainText("Today's not counted yet");
  });

  test('STK-2 a missed day resets the current streak to 0, and the best streak remembers the old run', async ({ page }) => {
    const seed = docWith(live(doc()).filter((s: any) => s.day !== TODAY && s.day !== '2026-10-13'));
    await boot(page, { seed, clock: true, route: 'stats' });
    const s = streaks(seed, TODAY);
    expect(s.current).toBe(0);
    await expect(page.getByTestId('streak-current')).toContainText('0 days');
    await expect(page.getByTestId('streak-current')).not.toContainText("Today's not counted yet");
    await expect(page.getByTestId('streak-best')).toContainText(`${s.best} days`);
    expect(s.best).toBeGreaterThan(0);
  });

  test('STK-1 the 6 AM rule: a session at 05:30 belongs to the day before, and the day turns over at 06:00 without a reload', async ({ page }) => {
    // Thu 15 Oct 05:58 PDT: still study day Wed 14 Oct
    const now = new Date('2026-10-15T05:58:00-07:00');
    await boot(page, { seed: 'backup-valid.json', clock: now, route: 'stats' });
    const ring = page.getByTestId('goal-ring');
    const todayMin = minutesByDay(doc()).get(TODAY)!;
    await expect(ring).toHaveAttribute('aria-label', new RegExp(`^${Math.round(todayMin)} of 120 minutes today`));
    const s = streaks(doc(), TODAY);
    await expect(page.getByTestId('streak-current')).toContainText(`${s.current} days`);
    await expect(page.getByTestId('streak-current')).not.toContainText("Today's not counted yet");
    await expect(weekRange(page)).toHaveText('Oct 12 to Oct 18');
    // cross 06:00
    await page.clock.fastForward(4 * 60_000);
    await expect(ring).toHaveAttribute('aria-label', /^0 of 120 minutes today/, { timeout: 15_000 });
    await expect(page.getByTestId('streak-current')).toContainText("Today's not counted yet");
    await expect(cell(page, '2026-10-15')).toHaveCount(1);
  });

  test('GOAL-1 the ring shows today against the goal; the same figures are on the desktop timer card (none on the phone Timer)', async ({ page }, info) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const todayMin = Math.round(minutesByDay(doc()).get(TODAY)!);
    const ring = page.getByTestId('goal-ring');
    await expect(ring).toHaveAttribute('aria-label', `${todayMin} of 120 minutes today, ${Math.round((todayMin / 120) * 100)} percent of goal`);
    await expect(ring.locator('.gring__value')).toHaveText(String(todayMin));
    await expect(ring.locator('.gring__sub')).toHaveText('of 120 min');
    await expect(page.getByTestId('today-tile')).toContainText('3 sessions today');
    await go(page, 'timer');
    if (info.project.name.startsWith('mobile')) await expect(page.getByTestId('today-goal').filter({ visible: true })).toHaveCount(0); // Timer simplification: no stats on the phone Timer
    else await expect(page.getByTestId('today-goal').filter({ visible: true }).first()).toContainText(String(todayMin));
  });

  test('GOAL-2 at or over goal the ring is full with a check and "Goal met"; no second lap', async ({ page }) => {
    const seed = docWith([...live(doc()).filter((s: any) => s.day !== TODAY), sessionOf(TODAY, 8, 120), sessionOf(TODAY, 10, 60, null, 1)]);
    await boot(page, { seed, clock: true, route: 'stats' });
    const ring = page.getByTestId('goal-ring');
    await expect(ring).toContainText('Goal met');
    await expect(ring).toHaveAttribute('aria-label', '180 of 120 minutes today, 150 percent of goal');
    await expect(ring.locator('.gring__sub--met svg')).toHaveCount(1);
    // the arc is capped at one full turn
    await expect(ring.locator('circle.gring__fill')).toHaveAttribute('stroke-dasharray', '1 2');
    // exactly at goal also counts
    const exact = docWith([sessionOf(TODAY, 8, 120)]);
    await page.evaluate((t) => localStorage.setItem('em-time:data', t), JSON.stringify(exact));
    await page.reload();
    await expect(page.getByTestId('goal-ring')).toContainText('Goal met');
    // one minute short is not
    const short1 = docWith([sessionOf(TODAY, 8, 119)]);
    await page.evaluate((t) => localStorage.setItem('em-time:data', t), JSON.stringify(short1));
    await page.reload();
    await expect(page.getByTestId('goal-ring')).not.toContainText('Goal met');
  });

  test('GOAL-3 a compact ring and today\'s minutes on the timer screen; they move after a session (desktop; superseded on the phone, where the Timer shows no stats)', async ({ page }, info) => {
    test.skip(info.project.name.startsWith('mobile'), 'Timer simplification: the phone Today strip was removed');
    await boot(page, { seed: docWith([sessionOf(TODAY, 8, 50)]), clock: true, stubs: true, route: 'timer' });
    const goal = page.getByTestId('today-goal').filter({ visible: true }).first();
    await expect(goal).toContainText('50');
    await runFocus(page);
    await expect(goal).toContainText('75');
  });
});

test.describe('stats: chart tables (A11Y-4)', () => {
  test('every chart has a real table alternative with the same numbers', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'stats' });
    const toggles = page.getByRole('button', { name: 'Show as table' });
    await expect(toggles).toHaveCount(3);
    const mins = minutesByDay(doc());

    // week + by task
    await toggles.nth(0).click();
    const wt = page.getByTestId('week-table');
    await expect(wt.locator('caption')).toContainText('Focus time per day');
    await expect(wt.locator('thead th[scope="col"]')).toHaveText(['Day', 'Focus time', 'Sessions']);
    await expect(wt.locator('tbody tr')).toHaveCount(7);
    await expect(wt.locator('tbody tr').nth(2)).toContainText(`Wed, Oct 14${fmt(mins.get(TODAY)!)}3`);
    await expect(page.getByTestId('task-table')).toBeVisible();
    await expect(page.getByTestId('task-table').locator('thead th')).toHaveText(['Task', 'Category', 'Focus time', 'Sessions']);
    await expect(page.getByRole('button', { name: 'Show as chart' })).toHaveAttribute('aria-pressed', 'true');

    // heatmap
    await page.getByRole('button', { name: 'Show as table' }).nth(0).click();
    const ht = page.getByTestId('heatmap-table');
    await expect(ht.locator('tbody tr')).toHaveCount(59);
    await expect(ht.locator('tbody tr').first()).toContainText(`Wed, Oct 14${fmt(mins.get(TODAY)!)}${levelOf(mins.get(TODAY)!, 120)}`);

    // trend
    await page.getByRole('button', { name: 'Show as table' }).nth(0).click();
    const tt = page.getByTestId('trend-table');
    await expect(tt.locator('tbody tr')).toHaveCount(30);
    await expect(tt.locator('thead th')).toHaveText(['Date', 'Focus time', '7-day average']);
    // back to the charts
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Show as chart' }).first().click();
    await expect(page.getByTestId('trend-chart')).toBeVisible();
    await expect(page.getByTestId('heatmap')).toBeVisible();
    await expect(page.getByTestId('week-columns')).toBeVisible();
  });
});

test.describe('stats: hidden tab and clock', () => {
  test('numbers read at 15:00 on a fixed day are stable across a hidden-tab round trip', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, stubs: true, route: 'stats' });
    const read = () => page.getByTestId('week-total').innerText();
    const before = await read();
    await setHidden(page, true);
    await page.clock.fastForward(5 * MIN);
    await setHidden(page, false);
    await expect.poll(read).toBe(before);
  });
});
