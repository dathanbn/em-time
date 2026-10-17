import type { AppData, Category, Task } from '@core';

export const CAT_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Magenta', 'Green', 'Violet', 'Red'] as const;

export const liveCategories = (d: AppData): Category[] =>
  d.categories.filter((c) => c.deletedAt === null).sort((a, b) => a.order - b.order);

export const openTasks = (d: AppData): Task[] =>
  d.tasks.filter((t) => t.deletedAt === null && !t.done).sort((a, b) => a.order - b.order);

export const doneTasks = (d: AppData): Task[] =>
  d.tasks.filter((t) => t.deletedAt === null && t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

export const currentTask = (d: AppData): Task | null =>
  d.meta.currentTaskId
    ? (d.tasks.find((t) => t.id === d.meta.currentTaskId && t.deletedAt === null) ?? null)
    : null;

/** A task with an unknown category shows under the first category (contract section 6). */
export function categoryOf(d: AppData, t: Task): Category {
  const cats = liveCategories(d);
  return cats.find((c) => c.id === t.categoryId) ?? cats[0]!;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
