// Step 0 smoke tests. The full per-module suites (90% coverage target) come with the real-core work.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  createBag,
  createDefaultData,
  createMemoryAdapter,
  dayKey,
  diffDays,
  exportData,
  formatClock,
  formatDuration,
  initialTimerState,
  nextFromBag,
  numberWord,
  parseImport,
  renderMessage,
  sessionId,
  timerReducer,
  ValidationError,
  weekStart,
  createEmCore,
  MIN,
  type TimerConfig,
} from './index';
import { TEST_COPY } from './fixtures/test-copy';

const cfg: TimerConfig = {
  focusMs: 25 * MIN,
  shortMs: 5 * MIN,
  longMs: 15 * MIN,
  longEvery: 4,
  autoStart: true,
};

describe('calendar and format', () => {
  it('rolls the study day over at 06:00 local', () => {
    expect(dayKey(new Date(2026, 9, 14, 5, 59).getTime())).toBe('2026-10-13');
    expect(dayKey(new Date(2026, 9, 14, 6, 0).getTime())).toBe('2026-10-14');
    expect(dayKey(new Date(2026, 9, 14, 23, 59).getTime())).toBe('2026-10-14');
    expect(dayKey(new Date(2026, 10, 1, 1, 30).getTime())).toBe('2026-10-31');
  });
  it('does date math on calendar dates', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(diffDays('2026-10-01', '2026-10-14')).toBe(13);
    expect(weekStart('2026-10-14', 1)).toBe('2026-10-12');
    expect(weekStart('2026-10-14', 0)).toBe('2026-10-11');
  });
  it('formats', () => {
    expect([0, 45 * MIN, 60 * MIN, 85 * MIN].map(formatDuration)).toEqual(['0m', '45m', '1h', '1h 25m']);
    expect([25 * MIN, 25 * MIN - 1, 59_000, 0, 5400_000].map(formatClock)).toEqual([
      '25:00',
      '25:00',
      '0:59',
      '0:00',
      '1:30:00',
    ]);
    expect([1, 2, 12, 13].map(numberWord)).toEqual(['1', 'two', 'twelve', '13']);
  });
  it('session ids are UUID-shaped', () => {
    const id = sessionId('d2a9b6c4-0f3e-4d8a-9e21-5c7b8a6d4e33', 1791990900000);
    expect(id).toBe('d2a9b6c4-0f3e-4d8a-9e21-01a13afb2520'); // contract.md section 5 example
    expect(id).toHaveLength(36);
  });
});

describe('timer reducer', () => {
  const t0 = 1_000_000_000_000;
  it('runs, ends, chains with auto-start, and counts the cycle', () => {
    let s = initialTimerState(cfg, t0);
    s = timerReducer(s, { type: 'start' }, t0, cfg).state;
    expect(s.endsAt).toBe(t0 + 25 * MIN);
    const r = timerReducer(s, { type: 'sync' }, t0 + 25 * MIN + 500, cfg);
    expect(r.ended).toMatchObject({ phase: 'focus', late: false, endedAt: t0 + 25 * MIN });
    expect(r.state).toMatchObject({ phase: 'short', status: 'running', cycle: 1, endsAt: t0 + 30 * MIN });
    expect(r.autoStarted).toBe(true);
  });
  it('a late catch-up ends once and waits idle', () => {
    let s = timerReducer(initialTimerState(cfg, 0), { type: 'start' }, 0, cfg).state;
    s = timerReducer(s, { type: 'sync' }, 6 * 60 * MIN, cfg).state;
    expect(s.status).toBe('idle');
    const again = timerReducer(
      timerReducer(initialTimerState(cfg, 0), { type: 'start' }, 0, cfg).state,
      { type: 'sync' },
      6 * 60 * MIN,
      cfg,
    );
    expect(again.ended!.late).toBe(true);
    expect(again.autoStarted).toBe(false);
    expect(again.state).toMatchObject({ phase: 'short', status: 'idle', remainingMs: 5 * MIN });
  });
  it('4th focus leads to a long break and zeroes the cycle', () => {
    let s = { ...initialTimerState(cfg, 0), cycle: 3 };
    s = timerReducer(s, { type: 'start' }, 0, cfg).state;
    const r = timerReducer(s, { type: 'sync' }, 25 * MIN, cfg);
    expect(r.state).toMatchObject({ phase: 'long', cycle: 0 });
  });
  it('skip and reset never end a phase; double reset zeroes the cycle', () => {
    let s = { ...initialTimerState(cfg, 0), cycle: 2 };
    s = timerReducer(s, { type: 'start' }, 0, cfg).state;
    const skipped = timerReducer(s, { type: 'skip' }, 10_000, cfg);
    expect(skipped.ended).toBeNull();
    expect(skipped.state).toMatchObject({ phase: 'short', status: 'idle', cycle: 2 });
    const reset1 = timerReducer(s, { type: 'reset' }, 10_000, cfg).state;
    expect(reset1).toMatchObject({ phase: 'focus', status: 'idle', cycle: 2 });
    expect(timerReducer(reset1, { type: 'reset' }, 10_000, cfg).state.cycle).toBe(0);
  });
  it('pause freezes remaining time and resume continues', () => {
    let s = timerReducer(initialTimerState(cfg, 0), { type: 'start' }, 0, cfg).state;
    s = timerReducer(s, { type: 'pause' }, 60_000, cfg).state;
    expect(s).toMatchObject({ status: 'paused', remainingMs: 24 * MIN, endsAt: null });
    s = timerReducer(s, { type: 'resume' }, 10 * MIN, cfg).state;
    expect(s.endsAt).toBe(10 * MIN + 24 * MIN);
  });
  it('config changes reach an idle phase only', () => {
    const idle = initialTimerState(cfg, 0);
    const next = timerReducer(idle, { type: 'config', cfg: { ...cfg, focusMs: 50 * MIN } }, 1, cfg).state;
    expect(next.remainingMs).toBe(50 * MIN);
    const running = timerReducer(idle, { type: 'start' }, 0, cfg).state;
    expect(timerReducer(running, { type: 'config', cfg: { ...cfg, focusMs: 50 * MIN } }, 1, cfg).state).toBe(
      running,
    );
  });
});

describe('copy picker', () => {
  it('draws without repeats until the bag is exhausted', () => {
    let bag = createBag(5, Math.random);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = nextFromBag(bag, () => true, 5, Math.random);
      seen.push(r.index);
      bag = r.bag;
    }
    expect(new Set(seen).size).toBe(5);
  });
  it('renders the {sessions} token', () => {
    expect(renderMessage('{sessions} sessions in. Nicely done.', 1)).toBeNull();
    expect(renderMessage('{sessions} sessions in. Nicely done.', 3)).toBe('Three sessions in. Nicely done.');
    expect(renderMessage("That's {sessions} today. Steady work.", 3)).toBe(
      "That's three today. Steady work.",
    );
    expect(renderMessage("That's {sessions} today. Steady work.", 14)).toBe("That's 14 today. Steady work.");
    expect(renderMessage('Well earned.', 0)).toBe('Well earned.');
  });
});

describe('import and export', () => {
  const now = new Date(2026, 9, 14, 12).getTime();
  it('round-trips an export and strips sync state', () => {
    const data = createDefaultData(now);
    data.meta.sync.userId = 'abc';
    const { filename, json } = exportData(data, now);
    expect(filename).toBe('em-time-backup-2026-10-14.json');
    const r = parseImport(json, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.meta.sync.userId).toBeNull();
      expect(r.summary.categories).toBe(5);
    }
  });
  it('rejects bad files with the contract error codes', () => {
    const err = (t: string) => {
      const r = parseImport(t, now);
      return r.ok ? 'ok' : r.error;
    };
    expect(err('')).toBe('empty');
    expect(err('nope')).toBe('not-json');
    expect(err('{"app":"other"}')).toBe('not-em-time');
    expect(err('{"app":"em-time","schemaVersion":99,"sessions":[],"tasks":[],"categories":[]}')).toBe(
      'newer-version',
    );
    expect(err('{"app":"em-time","schemaVersion":1,"sessions":"x","tasks":[],"categories":[]}')).toBe(
      'invalid-shape',
    );
  });
});

describe('store', () => {
  const mk = () => {
    let t = 1_700_000_000_000;
    const adapter = createMemoryAdapter();
    const core = createEmCore({ storage: adapter, copy: TEST_COPY, syncEnv: {}, now: () => (t += 1) });
    return { core, adapter };
  };
  it('validates, persists synchronously and tombstones', () => {
    const { core, adapter } = mk();
    const { store } = core;
    expect(() => store.addTask({ name: '   ' })).toThrow(ValidationError);
    expect(() => store.addTask({ name: 'x'.repeat(81) })).toThrow(ValidationError);
    const a = store.addTask({ name: '  Read ch. 3 ' });
    const b = store.addTask({ name: 'Second' });
    expect(a.name).toBe('Read ch. 3');
    expect(b.order).toBe(a.order - 1);
    expect(JSON.parse(adapter.read('em-time:data')!).tasks).toHaveLength(2);
    store.setCurrentTask(a.id);
    store.deleteTask(a.id);
    expect(store.get().meta.currentTaskId).toBeNull();
    expect(store.get().tasks.find((t) => t.id === a.id)!.deletedAt).not.toBeNull();
    core.dispose();
  });
  it('enforces category rules', () => {
    const { core } = mk();
    const { store } = core;
    const cats = store.get().categories;
    expect(() => store.deleteCategory(cats[0]!.id, cats[0]!.id)).toThrow(ValidationError);
    store.addCategory({ name: 'A', color: 6 });
    store.addCategory({ name: 'B', color: 7 });
    store.addCategory({ name: 'C', color: 8 });
    expect(() => store.addCategory({ name: 'D', color: 1 })).toThrow(ValidationError);
    for (const c of store
      .get()
      .categories.filter((c) => c.deletedAt === null)
      .slice(1)) {
      store.deleteCategory(c.id, cats[0]!.id);
    }
    expect(() => store.deleteCategory(cats[0]!.id, cats[0]!.id)).toThrow(ValidationError);
    core.dispose();
  });
  it('bumps settings.updatedAt only for synced keys', () => {
    const { core } = mk();
    const { store } = core;
    store.updateSettings({ theme: 'dark', volume: 0.3 });
    expect(store.get().settings.updatedAt).toBe(0);
    store.updateSettings({ dailyGoalMin: 90 });
    expect(store.get().settings.updatedAt).toBeGreaterThan(0);
    store.updateSettings({ focusMin: 30 });
    expect(store.get().settings.preset).toBe('custom');
    store.updateSettings({ preset: '50/10' });
    expect(store.get().settings).toMatchObject({ focusMin: 50, shortMin: 10, longMin: 30 });
    expect(() => store.updateSettings({ focusMin: 500 })).toThrow(ValidationError);
    core.dispose();
  });
  it('logs a completed focus session exactly once and emits the event', () => {
    let now = new Date(2026, 9, 14, 10).getTime();
    const timers: Array<{ at: number; fn: () => void }> = [];
    const deps = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimeout: (h: unknown) => void timers.splice(timers.indexOf(h as (typeof timers)[0]), 1),
    };
    const core = createEmCore({ storage: createMemoryAdapter(), copy: TEST_COPY, deps, syncEnv: {} });
    const events: any[] = [];
    core.onPhaseComplete((e) => events.push(e));
    const task = core.store.addTask({ name: 'Orgo' });
    core.store.setCurrentTask(task.id);
    core.timer.start();
    now += 25 * MIN;
    timers.shift()!.fn();
    expect(events).toHaveLength(1);
    expect(events[0].session).toMatchObject({
      taskId: task.id,
      taskName: 'Orgo',
      focusedMs: 25 * MIN,
      plannedMs: 25 * MIN,
    });
    expect(events[0].message).toMatch(/\S/);
    expect(events[0].breakPrompt).toMatch(/\S/);
    expect(events[0]).toMatchObject({ phase: 'focus', nextPhase: 'short', late: false, autoStarted: true });
    expect(core.store.get().sessions).toHaveLength(1);
    expect(core.select.today(now).sessions).toBe(1);
    core.dispose();
  });
});
