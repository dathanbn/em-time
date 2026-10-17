import { describe, expect, it } from 'vitest';
import { LIMITS, PRESETS, ValidationError, type EmStore } from '@core';
import { makeCore, minutes } from './harness';
import { CAT1, CAT2 } from './helpers';

const fresh = () => makeCore();
const expectValidation = (fn: () => unknown, field: string, reason: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).field).toBe(field);
    expect((e as ValidationError).reason).toBe(reason);
    return;
  }
  throw new Error(`expected ValidationError(${field}, ${reason})`);
};
const open = (s: EmStore) => s.get().tasks.filter((t) => t.deletedAt === null && !t.done);

describe('tasks (TSK-2, TSK-3, TSK-8)', () => {
  it('adds a trimmed name, defaulting to the first category, at the top of the open list', () => {
    const { core } = fresh();
    const a = core.store.addTask({ name: '  First  ' });
    const b = core.store.addTask({ name: 'Second' });
    expect(a.name).toBe('First');
    expect(a.categoryId).toBe(CAT1);
    expect(a).toMatchObject({ done: false, doneAt: null, deletedAt: null });
    const sorted = open(core.store).sort((x, y) => x.order - y.order).map((t) => t.name);
    expect(sorted).toEqual(['Second', 'First']);
    expect(b.order).toBeLessThan(a.order);
  });

  it('the category defaults to the last one used', () => {
    const { core } = fresh();
    core.store.addTask({ name: 'in reading', categoryId: CAT2 });
    expect(core.store.addTask({ name: 'next' }).categoryId).toBe(CAT2);
  });

  it('rejects empty, whitespace-only and over-long names (1 to 80)', () => {
    const { core } = fresh();
    expectValidation(() => core.store.addTask({ name: '' }), 'name', 'required');
    expectValidation(() => core.store.addTask({ name: '   ' }), 'name', 'required');
    expectValidation(() => core.store.addTask({ name: 'x'.repeat(81) }), 'name', 'too-long');
    expect(core.store.addTask({ name: 'x'.repeat(80) }).name).toHaveLength(80);
    expect(core.store.get().tasks).toHaveLength(1);
  });

  it('rename, move category, check off, uncheck', () => {
    const { core } = fresh();
    const t = core.store.addTask({ name: 'old' });
    expect(core.store.updateTask(t.id, { name: 'new' }).name).toBe('new');
    expect(core.store.updateTask(t.id, { categoryId: CAT2 }).categoryId).toBe(CAT2);
    const done = core.store.setTaskDone(t.id, true);
    expect(done).toMatchObject({ done: true });
    expect(done.doneAt).not.toBeNull();
    const back = core.store.setTaskDone(t.id, false);
    expect(back).toMatchObject({ done: false, doneAt: null });
    expectValidation(() => core.store.updateTask(t.id, { name: '' }), 'name', 'required');
  });

  it('updatedAt strictly increases on every change (drives last-write-wins)', () => {
    const { core } = fresh();
    const t = core.store.addTask({ name: 'a' });
    const u1 = core.store.updateTask(t.id, { name: 'b' }).updatedAt;
    const u2 = core.store.updateTask(t.id, { name: 'c' }).updatedAt;
    expect(u2).toBeGreaterThan(u1);
    expect(u1).toBeGreaterThanOrEqual(t.updatedAt);
  });

  it('deleting a task keeps its logged sessions; stats show them under the old name as deleted (TSK-3)', () => {
    const { core, clock } = fresh();
    const t = core.store.addTask({ name: 'Doomed' });
    core.store.setCurrentTask(t.id);
    core.timer.start();
    clock.advance(minutes(25) + 10);
    core.store.deleteTask(t.id);
    expect(core.store.get().sessions).toHaveLength(1);
    const row = core.select.week(0).perTask[0]!;
    expect(row).toMatchObject({ name: 'Doomed', deleted: true, color: null, focusMs: minutes(25) });
    expect(open(core.store)).toHaveLength(0);
  });

  it('Clear done removes every done task, returns the count, keeps sessions (TSK-8)', () => {
    const { core, clock } = fresh();
    const a = core.store.addTask({ name: 'a' });
    const b = core.store.addTask({ name: 'b' });
    core.store.addTask({ name: 'c' });
    core.store.setCurrentTask(a.id);
    core.timer.start();
    clock.advance(minutes(25) + 10);
    core.store.setTaskDone(a.id, true);
    core.store.setTaskDone(b.id, true);
    expect(core.store.clearDone()).toBe(2);
    expect(core.store.get().tasks.filter((t) => t.deletedAt === null).map((t) => t.name)).toEqual(['c']);
    expect(core.store.get().sessions).toHaveLength(1);
    expect(core.select.week(0).perTask[0]).toMatchObject({ name: 'a', deleted: true });
  });
});

describe('categories (TSK-6)', () => {
  it('renames, recolours; two categories may share a colour', () => {
    const { core } = fresh();
    expect(core.store.updateCategory(CAT1, { name: 'Lectures' }).name).toBe('Lectures');
    expect(core.store.updateCategory(CAT1, { color: 6 }).color).toBe(6);
    const c = core.store.addCategory({ name: 'Twin', color: 6 });
    expect(c.color).toBe(6);
    expectValidation(() => core.store.updateCategory(CAT1, { name: '' }), 'name', 'required');
    expectValidation(() => core.store.updateCategory(CAT1, { name: 'x'.repeat(31) }), 'name', 'too-long');
    expect(core.store.updateCategory(CAT1, { name: 'x'.repeat(30) }).name).toHaveLength(30);
  });

  it('allows at most 8 categories', () => {
    const { core } = fresh();
    for (let i = 0; i < 3; i++) core.store.addCategory({ name: `extra ${i}`, color: 1 });
    expect(core.store.get().categories.filter((c) => c.deletedAt === null)).toHaveLength(8);
    expectValidation(() => core.store.addCategory({ name: 'ninth', color: 2 }), 'categories', 'limit');
  });

  it('deleting a category moves its tasks to the chosen one; the last category cannot be deleted', () => {
    const { core } = fresh();
    const t = core.store.addTask({ name: 'moves', categoryId: CAT1 });
    core.store.deleteCategory(CAT1, CAT2);
    expect(core.store.get().tasks.find((x) => x.id === t.id)!.categoryId).toBe(CAT2);
    expect(core.store.get().categories.find((c) => c.id === CAT1)!.deletedAt).not.toBeNull();
    for (const c of core.store.get().categories.filter((c) => c.deletedAt === null && c.id !== CAT2)) {
      core.store.deleteCategory(c.id, CAT2);
    }
    expect(() => core.store.deleteCategory(CAT2, CAT2)).toThrowError(ValidationError);
    try {
      core.store.deleteCategory(CAT2, CAT2);
    } catch (e) {
      expect((e as ValidationError).reason).toBe('last-category');
    }
    expect(core.store.get().categories.filter((c) => c.deletedAt === null)).toHaveLength(1);
  });
});

describe('settings validation and presets (TMR-10, TMR-11, GOAL-1)', () => {
  it.each(Object.entries(PRESETS))('preset %s sets focus/short/long', (id, p) => {
    const { core } = fresh();
    core.store.updateSettings({ preset: id as keyof typeof PRESETS });
    expect(core.store.get().settings).toMatchObject({ focusMin: p.focusMin, shortMin: p.shortMin, longMin: p.longMin, longEvery: 4 });
  });

  it('preset durations are 25/5/15, 50/10/30, 90/20/30', () => {
    expect(PRESETS['25/5']).toEqual({ focusMin: 25, shortMin: 5, longMin: 15 });
    expect(PRESETS['50/10']).toEqual({ focusMin: 50, shortMin: 10, longMin: 30 });
    expect(PRESETS['90/20']).toEqual({ focusMin: 90, shortMin: 20, longMin: 30 });
  });

  it('custom ranges: focus 1-180, short 1-60, long 1-90, every 2-8, goal 15-720', () => {
    const { core } = fresh();
    const set = (p: object) => core.store.updateSettings(p as never);
    expect(set({ focusMin: 1 }).focusMin).toBe(1);
    expect(set({ focusMin: 180 }).focusMin).toBe(180);
    expect(set({ shortMin: 60 }).shortMin).toBe(60);
    expect(set({ longMin: 90 }).longMin).toBe(90);
    expect(set({ longEvery: 2 }).longEvery).toBe(2);
    expect(set({ longEvery: 8 }).longEvery).toBe(8);
    expect(set({ dailyGoalMin: 15 }).dailyGoalMin).toBe(15);
    expect(set({ dailyGoalMin: 720 }).dailyGoalMin).toBe(720);
    expect(core.store.get().settings.preset).toBe('custom');
    for (const [k, v] of [['focusMin', 0], ['focusMin', 181], ['shortMin', 0], ['shortMin', 61], ['longMin', 91], ['longEvery', 1], ['longEvery', 9], ['dailyGoalMin', 14], ['dailyGoalMin', 721]] as const) {
      expectValidation(() => set({ [k]: v }), k, 'limit');
    }
    expect(LIMITS.focusMin).toEqual([1, 180]);
  });

  it('changing a duration while a phase runs does not change that phase; an idle full phase updates at once (TMR-11)', () => {
    const { core, clock } = fresh();
    expect(core.timer.getState().plannedMs).toBe(minutes(25));
    core.store.updateSettings({ focusMin: 40 });
    expect(core.timer.getState()).toMatchObject({ status: 'idle', plannedMs: minutes(40), remainingMs: minutes(40) });
    core.timer.start();
    clock.advance(minutes(5));
    core.store.updateSettings({ focusMin: 60, shortMin: 10 });
    expect(core.timer.getState().plannedMs).toBe(minutes(40));
    expect(core.timer.remainingMs()).toBe(minutes(35));
    clock.advance(minutes(35) + 10);
    // the break picks up the new short duration
    expect(core.timer.getState()).toMatchObject({ phase: 'short', plannedMs: minutes(10) });
  });

  it('defaults: auto-start on, goal 120, Monday week start, volume 0.6, glass chime, light theme', () => {
    const { core } = fresh();
    expect(core.store.get().settings).toMatchObject({
      autoStart: true, dailyGoalMin: 120, weekStartsOn: 1, volume: 0.6, chime: 'glass', theme: 'light',
      notifications: true, keepAwake: true, breakPrompts: true, encouragement: true,
    });
  });
});

describe('dirty tracking and local-write hooks (DAT-1, SYNC-4)', () => {
  it('signed out nothing is queued; signed in every changed row is queued; onLocalWrite fires after persisting', () => {
    const { core } = fresh();
    core.store.addTask({ name: 'offline' });
    expect(core.store.takeDirty()).toEqual({ categories: [], tasks: [], sessions: [], settings: false });
    core.store.setSyncMeta({ userId: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b' });
    const seen: Array<string | null> = [];
    core.store.onLocalWrite((t) => seen.push(t));
    const t = core.store.addTask({ name: 'queued' });
    core.store.updateSettings({ dailyGoalMin: 60 });
    core.store.updateSettings({ theme: 'dark' });
    core.store.updateCategory(CAT1, { name: 'Renamed' });
    const dirty = core.store.takeDirty();
    expect(dirty.tasks).toEqual([t.id]);
    expect(dirty.categories).toEqual([CAT1]);
    expect(dirty.settings).toBe(true);
    expect(seen).toEqual(['tasks', 'settings', null, 'categories']);
  });
});
