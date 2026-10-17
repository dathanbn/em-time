import { describe, expect, it } from 'vitest';
import { MIN, statsSessions, weekSummary, type Session } from '@core';
import { at, CAT1, defaultCats, mkCategory, mkSession, mkTask, onDay } from './helpers';

const cats = defaultCats();
const week = (sessions: Session[], tasks = [] as ReturnType<typeof mkTask>[], today = '2026-10-14', ws: 0 | 1 = 1, offset = 0) =>
  weekSummary(statsSessions(sessions, today), tasks, cats, today, ws, offset);
const mins = (n: number) => ({ plannedMs: n * MIN, focusedMs: n * MIN });

describe('weekSummary: boundaries (WK-1, WK-4)', () => {
  it('Monday start: Mon 12th to Sun 18th, seven ordered days, todayIndex of a Wednesday is 2', () => {
    const w = week([]);
    expect(w.start).toBe('2026-10-12');
    expect(w.end).toBe('2026-10-18');
    expect(w.days.map((d) => d.day)).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
    expect(w.offset).toBe(0);
    expect(w.todayIndex).toBe(2);
    expect(w.hasNext).toBe(false);
  });

  it('Sunday start: Sun 11th to Sat 17th, todayIndex 3', () => {
    const w = week([], [], '2026-10-14', 0);
    expect(w.start).toBe('2026-10-11');
    expect(w.end).toBe('2026-10-17');
    expect(w.todayIndex).toBe(3);
  });

  it('offset -1 is the previous week and has no todayIndex; hasNext is true', () => {
    const w = week([], [], '2026-10-14', 1, -1);
    expect(w.start).toBe('2026-10-05');
    expect(w.end).toBe('2026-10-11');
    expect(w.todayIndex).toBeNull();
    expect(w.hasNext).toBe(true);
    expect(w.offset).toBe(-1);
  });

  it('a session at 05:30 Monday lands on Sunday: previous week with Monday start, current with Sunday start', () => {
    const s = [mkSession(at(2026, 10, 12, 5, 30), mins(25))];
    expect(s[0]!.day).toBe('2026-10-11');
    expect(week(s, [], '2026-10-14', 1, 0).totalMs).toBe(0);
    expect(week(s, [], '2026-10-14', 1, -1).totalMs).toBe(25 * MIN);
    expect(week(s, [], '2026-10-14', 0, 0).totalMs).toBe(25 * MIN);
  });

  it('Sunday 23:50 and Monday 05:59 stay in the old week; Monday 06:00 opens the new one', () => {
    const s = [
      mkSession(at(2026, 10, 18, 23, 50), mins(25)),
      mkSession(at(2026, 10, 19, 5, 59), mins(25)),
      mkSession(at(2026, 10, 19, 6, 0), mins(30)),
    ];
    const today = '2026-10-20';
    expect(week(s, [], today, 1, -1).totalMs).toBe(50 * MIN);
    expect(week(s, [], today, 1, 0).totalMs).toBe(30 * MIN);
    const prev = week(s, [], today, 1, -1);
    expect(prev.days[6]!.focusMs).toBe(50 * MIN);
    expect(prev.days[6]!.sessions).toBe(2);
  });

  it('daily totals, week total and session count add up', () => {
    const s = [onDay(2026, 10, 12, 9), onDay(2026, 10, 12, 11), onDay(2026, 10, 14, 9, 0, mins(50))];
    const w = week(s);
    expect(w.days[0]).toMatchObject({ day: '2026-10-12', focusMs: 50 * MIN, sessions: 2 });
    expect(w.days[1]!.focusMs).toBe(0);
    expect(w.days[2]!.focusMs).toBe(50 * MIN);
    expect(w.totalMs).toBe(100 * MIN);
    expect(w.sessions).toBe(3);
  });

  it('a week containing the spring-forward day has seven distinct consecutive dates', () => {
    const w = week([onDay(2026, 3, 8, 7)], [], '2026-03-10', 1, -1);
    expect(w.days.map((d) => d.day)).toEqual([
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
    ]);
    expect(w.days[6]!.sessions).toBe(1);
    const f = week([onDay(2026, 11, 1, 7)], [], '2026-11-03', 0, 0);
    expect(f.days.map((d) => d.day)).toEqual([
      '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07',
    ]);
    expect(f.days[0]!.sessions).toBe(1);
  });

  it('hasPrev is false on the week of the first-ever session and when there is no data', () => {
    expect(week([]).hasPrev).toBe(false);
    const s = [onDay(2026, 10, 6, 10)]; // Tuesday of the week of Oct 5
    expect(week(s, [], '2026-10-14', 1, 0).hasPrev).toBe(true);
    expect(week(s, [], '2026-10-14', 1, -1).hasPrev).toBe(false);
    // a first session on Sunday 4th (with Monday start) belongs to the week of Sep 28
    const s2 = [onDay(2026, 10, 4, 10)];
    expect(week(s2, [], '2026-10-14', 1, -1).hasPrev).toBe(true);
    expect(week(s2, [], '2026-10-14', 1, -2).hasPrev).toBe(false);
  });
});

describe('weekSummary: per-task totals (WK-2, EDGE-9)', () => {
  const task = (name: string, over = {}) => mkTask({ name, ...over });

  it('sorts by minutes descending with names, colors and counts', () => {
    const a = task('Alpha', { categoryId: cats[0]!.id });
    const b = task('Beta', { categoryId: cats[2]!.id });
    const s = [
      onDay(2026, 10, 12, 9, 0, { taskId: a.id, taskName: 'Alpha', ...mins(25) }),
      onDay(2026, 10, 13, 9, 0, { taskId: b.id, taskName: 'Beta', ...mins(50) }),
      onDay(2026, 10, 14, 9, 0, { taskId: b.id, taskName: 'Beta', ...mins(25) }),
    ];
    const w = week(s, [a, b]);
    expect(w.perTask.map((t) => t.name)).toEqual(['Beta', 'Alpha']);
    expect(w.perTask[0]).toMatchObject({ taskId: b.id, focusMs: 75 * MIN, sessions: 2, color: 3, deleted: false });
    expect(w.perTask[1]).toMatchObject({ taskId: a.id, focusMs: 25 * MIN, color: 1 });
  });

  it('sessions with no task appear as "No task" with a neutral swatch', () => {
    const w = week([onDay(2026, 10, 12, 9)]);
    expect(w.perTask).toHaveLength(1);
    expect(w.perTask[0]).toMatchObject({ taskId: null, name: 'No task', color: null, focusMs: 25 * MIN });
  });

  it('a deleted task keeps its snapshot name, is flagged deleted, and has a neutral swatch', () => {
    const t = task('Old essay', { deletedAt: at(2026, 10, 13, 12), categoryId: CAT1 });
    const s = [onDay(2026, 10, 12, 9, 0, { taskId: t.id, taskName: 'Old essay', categoryId: CAT1 })];
    const w = week(s, [t]);
    expect(w.perTask[0]).toMatchObject({ taskId: t.id, name: 'Old essay', deleted: true, color: null });
  });

  it('a session whose task no longer exists at all is also "deleted"', () => {
    const s = [onDay(2026, 10, 12, 9, 0, { taskId: '11111111-1111-4111-8111-111111111111', taskName: 'Gone' })];
    expect(week(s).perTask[0]).toMatchObject({ name: 'Gone', deleted: true, color: null });
  });

  it('a task renamed after logging shows its live name', () => {
    const t = task('New name');
    const s = [onDay(2026, 10, 12, 9, 0, { taskId: t.id, taskName: 'Old name' })];
    expect(week(s, [t]).perTask[0]!.name).toBe('New name');
  });

  it('folds everything beyond the top 7 rows into "Other tasks" (8 or more rows)', () => {
    const ts = Array.from({ length: 9 }, (_, i) => task(`T${i + 1}`));
    const s = ts.map((t, i) =>
      onDay(2026, 10, 12, 8 + i, 0, { taskId: t.id, taskName: t.name, ...mins(10 * (i + 1)) }),
    ); // 10..90 minutes
    const w = week(s, ts);
    expect(w.perTask).toHaveLength(8);
    expect(w.perTask.slice(0, 7).map((t) => t.name)).toEqual(['T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3']);
    const other = w.perTask[7]!;
    expect(other).toMatchObject({ taskId: '__other__', name: 'Other tasks', color: null });
    expect(other.focusMs).toBe((10 + 20) * MIN);
    expect(other.sessions).toBe(2);
    // sorted descending among real rows
    const real = w.perTask.slice(0, 7).map((t) => t.focusMs);
    expect([...real].sort((x, y) => y - x)).toEqual(real);
  });

  it('exactly 7 tasks does not fold', () => {
    const ts = Array.from({ length: 7 }, (_, i) => task(`T${i}`));
    const s = ts.map((t, i) => onDay(2026, 10, 12, 8 + i, 0, { taskId: t.id, taskName: t.name }));
    const w = week(s, ts);
    expect(w.perTask).toHaveLength(7);
    expect(w.perTask.some((t) => t.taskId === '__other__')).toBe(false);
  });

  it('category color slot follows the task category, including custom categories', () => {
    const cat = mkCategory({ color: 7 });
    const t = task('Custom', { categoryId: cat.id });
    const s = [onDay(2026, 10, 12, 9, 0, { taskId: t.id, taskName: 'Custom', categoryId: cat.id })];
    const w = weekSummary(statsSessions(s, '2026-10-14'), [t], [...cats, cat], '2026-10-14', 1, 0);
    expect(w.perTask[0]!.color).toBe(7);
  });
});
