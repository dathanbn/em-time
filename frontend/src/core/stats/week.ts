import { WEEK_TASK_ROWS } from '../constants';
import { addDays, weekStart } from '../time/calendar';
import type { Category, CategoryColorSlot, ISODay, Session, Task, TaskTotal, WeekSummary } from '../types';
import { dailyStats, firstSessionDay } from './daily';

export const OTHER_TASKS_ID = '__other__';

interface Acc {
  key: string;
  total: TaskTotal;
}

/** Category a live task is shown under: its own, else the first live category (never rewritten). */
function colorFor(
  categoryId: string | null,
  cats: Category[],
): { id: string | null; color: CategoryColorSlot | null } {
  const live = cats.filter((c) => c.deletedAt === null).sort((a, b) => a.order - b.order);
  const found = live.find((c) => c.id === categoryId) ?? live[0];
  return found ? { id: found.id, color: found.color } : { id: null, color: null };
}

/**
 * WK-1..4. `name` is the live task name, else the session snapshot; the UI appends " (deleted)"
 * when `deleted` is true.
 */
export function weekSummary(
  sessions: Session[],
  tasks: Task[],
  categories: Category[],
  today: ISODay,
  weekStartsOn: 0 | 1,
  offset: number,
): WeekSummary {
  const start = addDays(weekStart(today, weekStartsOn), offset * 7);
  const end = addDays(start, 6);
  const days = dailyStats(sessions, start, end);
  const todayIndex = days.findIndex((d) => d.day === today);
  const inWeek = sessions.filter((s) => s.deletedAt === null && s.day >= start && s.day <= end);

  const taskById = new Map(tasks.map((t) => [t.id, t] as const));
  const accs = new Map<string, Acc>();
  for (const s of inWeek) {
    const key = s.taskId ?? '__none__';
    let acc = accs.get(key);
    if (!acc) {
      const live = s.taskId !== null ? taskById.get(s.taskId) : undefined;
      let total: TaskTotal;
      if (s.taskId === null) {
        total = {
          taskId: null,
          name: 'No task',
          categoryId: null,
          color: null,
          deleted: false,
          focusMs: 0,
          sessions: 0,
        };
      } else if (live && live.deletedAt === null) {
        const c = colorFor(live.categoryId, categories);
        total = {
          taskId: live.id,
          name: live.name,
          categoryId: c.id,
          color: c.color,
          deleted: false,
          focusMs: 0,
          sessions: 0,
        };
      } else {
        total = {
          taskId: s.taskId,
          name: live?.name ?? s.taskName ?? 'Deleted task',
          categoryId: s.categoryId,
          color: null,
          deleted: true,
          focusMs: 0,
          sessions: 0,
        };
      }
      acc = { key, total };
      accs.set(key, acc);
    }
    acc.total.focusMs += s.focusedMs;
    acc.total.sessions += 1;
  }

  const sorted = [...accs.values()]
    .map((a) => a.total)
    .sort((a, b) => b.focusMs - a.focusMs || b.sessions - a.sessions || a.name.localeCompare(b.name));
  let perTask = sorted;
  if (sorted.length > WEEK_TASK_ROWS) {
    const rest = sorted.slice(WEEK_TASK_ROWS);
    perTask = [
      ...sorted.slice(0, WEEK_TASK_ROWS),
      {
        taskId: OTHER_TASKS_ID,
        name: 'Other tasks',
        categoryId: null,
        color: null,
        deleted: false,
        focusMs: rest.reduce((n, t) => n + t.focusMs, 0),
        sessions: rest.reduce((n, t) => n + t.sessions, 0),
      },
    ];
  }

  const first = firstSessionDay(sessions);
  return {
    start,
    end,
    offset,
    days,
    todayIndex: todayIndex === -1 ? null : todayIndex,
    totalMs: days.reduce((n, d) => n + d.focusMs, 0),
    sessions: days.reduce((n, d) => n + d.sessions, 0),
    perTask,
    hasPrev: first !== null && first < start,
    hasNext: offset < 0,
  };
}
