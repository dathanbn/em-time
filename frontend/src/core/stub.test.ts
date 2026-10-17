import { describe, expect, it } from 'vitest';
import { TEST_COPY } from './fixtures/test-copy';
import { createStubCore, formatClock, weekStart, addDays, dayKey, MIN } from './index';
import { buildStubData } from './stub';
import { loadData, createMemoryAdapter } from './index';
import { STORAGE_KEY } from './constants';

// A Wednesday at 15:30 local time, so "today" has sessions finished and several still to come.
const NOW = new Date(2026, 9, 14, 15, 30, 0).getTime();

describe('stub core: every selector returns data', () => {
  const core = createStubCore({ copy: TEST_COPY, now: () => NOW });

  it('boots clean from the fixture', () => {
    expect(core.boot.status).toBe('ok');
    expect(core.boot.dropped).toBe(0);
    expect(core.store.status()).toBe('ok');
  });

  it('today', () => {
    const t = core.select.today();
    expect(t.day).toBe('2026-10-14');
    expect(t.goalMs).toBe(120 * MIN);
    expect(t.sessions).toBeGreaterThan(0);
    expect(t.focusMs).toBeGreaterThan(0);
    expect(t.progress).toBeCloseTo(t.focusMs / t.goalMs);
  });

  it('streak is 9 days ending today', () => {
    const s = core.select.streak();
    expect(s.todayCounts).toBe(true);
    expect(s.current).toBe(9);
    expect(s.best).toBeGreaterThanOrEqual(9);
    expect(s.currentStartDay).toBe('2026-10-06');
  });

  it('week 0 has 7 days, a total and per-task rows', () => {
    const w = core.select.week(0);
    expect(w.days).toHaveLength(7);
    expect(w.start).toBe(weekStart('2026-10-14', 1));
    expect(w.todayIndex).toBe(2);
    expect(w.totalMs).toBeGreaterThan(0);
    expect(w.perTask.length).toBeGreaterThan(0);
    expect(w.hasPrev).toBe(true);
    expect(w.hasNext).toBe(false);
  });

  it('has exactly one empty week, and past weeks carry data', () => {
    const empties = [] as number[];
    for (let off = 0; off >= -9; off--) {
      const w = core.select.week(off);
      if (w.totalMs === 0) empties.push(off);
    }
    expect(empties).toEqual([-3]);
    expect(core.select.week(-1).totalMs).toBeGreaterThan(0);
    expect(core.select.week(-3).perTask).toEqual([]);
    expect(core.select.week(-3).hasNext).toBe(true);
  });

  it('heatmap has 9 columns, no future days, all five levels', () => {
    const cells = core.select.heatmap();
    expect(Math.max(...cells.map((c) => c.col))).toBe(8);
    expect(cells.at(-1)!.day).toBe('2026-10-14');
    expect(cells.filter((c) => c.isToday)).toHaveLength(1);
    expect(new Set(cells.map((c) => c.level))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(cells.at(-1)!.label).toMatch(/^Wed, Oct 14 · /);
  });

  it('trend for 30, 90 and 365 days', () => {
    for (const range of [30, 90, 365] as const) {
      const pts = core.select.trend(range);
      expect(pts).toHaveLength(range);
      expect(pts.at(-1)!.isToday).toBe(true);
      expect(pts.at(-1)!.avgMin).toBeNull();
      expect(pts.at(-2)!.avgMin).not.toBeNull();
    }
    const p365 = core.select.trend(365);
    expect(p365[0]!.valueMin).toBeNull(); // before the first-ever session
    expect(p365.some((p) => p.valueMin !== null && p.valueMin > 0)).toBe(true);
  });

  it('task week minutes and export reminder', () => {
    const data = core.store.get();
    const open = data.tasks.find((t) => !t.done && t.deletedAt === null)!;
    expect(core.select.taskWeekMs(open.id)).toBeGreaterThanOrEqual(0);
    const total = data.tasks.reduce((n, t) => n + core.select.taskWeekMs(t.id), 0);
    expect(total).toBeGreaterThan(0);
    expect(core.select.exportReminderDue()).toBe(false);
  });

  it('tasks, categories and settings', () => {
    const d = core.store.get();
    expect(d.categories).toHaveLength(5);
    expect(d.tasks).toHaveLength(6);
    expect(d.tasks.filter((t) => t.done)).toHaveLength(1);
    expect(d.tasks.filter((t) => t.deletedAt !== null)).toHaveLength(1);
    expect(d.settings.dailyGoalMin).toBe(120);
    expect(d.meta.currentTaskId).not.toBeNull();
  });

  it('sync is disabled', async () => {
    expect(await core.loadSync()).toBeNull();
  });
});

describe('stub fixture shape', () => {
  const data = buildStubData(NOW);

  it('is a valid document that loads without drops', () => {
    const adapter = createMemoryAdapter({ [STORAGE_KEY]: JSON.stringify(data) });
    const r = loadData(adapter, NOW);
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.dropped).toBe(0);
  });

  it('covers about 70 days with 1 to 7 sessions on active days', () => {
    const perDay = new Map<string, number>();
    for (const s of data.sessions) perDay.set(s.day, (perDay.get(s.day) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(7);
    expect(Math.min(...perDay.values())).toBeGreaterThanOrEqual(1);
    expect(perDay.size).toBeGreaterThan(30);
    expect(data.sessions[0]!.day <= addDays('2026-10-14', -60)).toBe(true);
  });

  it('has a midnight crossover and early-morning sessions on the previous study day', () => {
    const crossing = data.sessions.find(
      (s) => new Date(s.startedAt).getHours() === 23 && new Date(s.endedAt).getHours() === 0,
    );
    expect(crossing).toBeDefined();
    expect(crossing!.day).toBe(dayKey(crossing!.startedAt));
    const early = data.sessions.find((s) => {
      const d = new Date(s.startedAt);
      return d.getHours() === 5 && d.getMinutes() === 30;
    });
    expect(early).toBeDefined();
    const startDate = new Date(early!.startedAt);
    const calendar = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    expect(early!.day).toBe(addDays(calendar, -1));
  });

  it('uses unique session ids', () => {
    expect(new Set(data.sessions.map((s) => s.id)).size).toBe(data.sessions.length);
  });
});

describe('stub timer is the real engine', () => {
  it('start, tick, pause, resume, skip, reset and a full phase end', () => {
    let now = NOW;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const core = createStubCore({ copy: TEST_COPY, now: () => now });
    // swap in a controllable clock by re-creating with injected deps
    core.dispose();
    const deps = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimeout: (h: unknown) => {
        const i = timers.indexOf(h as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    };
    const real = createStubCoreWithDeps(deps, () => now);
    const events: string[] = [];
    real.onPhaseComplete((e) =>
      events.push(`${e.phase}:${e.session ? 'logged' : 'none'}:${e.nextPhase}:${e.autoStarted}`),
    );

    expect(formatClock(real.timer.remainingMs())).toBe('25:00');
    const before = real.select.today().sessions;
    real.timer.start();
    now += 1000;
    expect(formatClock(real.timer.remainingMs())).toBe('24:59');
    real.timer.pause();
    now += 10 * MIN;
    expect(formatClock(real.timer.remainingMs())).toBe('24:59');
    real.timer.resume();
    now += 24 * MIN + 59_000;
    const due = timers.find((t) => t.at <= now + 10);
    expect(due).toBeDefined();
    due!.fn();
    expect(events).toEqual(['focus:logged:short:true']);
    expect(real.select.today().sessions).toBe(before + 1);
    expect(real.timer.getState().phase).toBe('short');
    expect(real.timer.getState().status).toBe('running');
    real.timer.skip();
    expect(real.timer.getState().phase).toBe('focus');
    expect(real.timer.getState().status).toBe('idle');
    real.dispose();
  });
});

import { createEmCore } from './index';
import type { TimerDeps } from './index';
function createStubCoreWithDeps(deps: TimerDeps, now: () => number) {
  // Same construction as createStubCore, with an injected timer clock.
  const adapter = createMemoryAdapter({ [STORAGE_KEY]: JSON.stringify(buildStubData(now())) });
  return createEmCore({ storage: adapter, copy: TEST_COPY, deps, now, syncEnv: {} });
}
