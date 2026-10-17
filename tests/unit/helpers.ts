// Shared builders for the QA unit tests. Written from docs/contract.md, not from the core's own
// tests: the study-day rule is re-implemented here on purpose, so a bug in dayKey cannot hide.
import type { Category, Copy, Session, Task } from '@core';
import { MIN } from '@core';

export const LA = 'America/Los_Angeles';
export const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const inLA = zone === LA;

/** Local wall-clock timestamp (month is 1-based). */
export const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number =>
  new Date(y, mo - 1, d, h, mi, s, ms).getTime();

const p2 = (n: number) => String(n).padStart(2, '0');

/** Independent study-day rule: wall-clock hour below 6 belongs to the previous calendar date. */
export function expectedDay(y: number, mo: number, d: number, h: number): string {
  const t = new Date(Date.UTC(y, mo - 1, d - (h < 6 ? 1 : 0)));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

export const DEVICE_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
export const DEVICE_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
export const CAT1 = '5e5e0000-0000-4000-8000-000000000001';
export const CAT2 = '5e5e0000-0000-4000-8000-000000000002';

let seq = 0;
export const uid = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

/** A valid logged session starting at `startedAt`, 25 minutes long unless told otherwise. */
export function mkSession(startedAt: number, over: Partial<Session> = {}): Session {
  const d = new Date(startedAt);
  const planned = over.plannedMs ?? 25 * MIN;
  const day = expectedDay(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours());
  return {
    id: uid(),
    createdAt: startedAt + planned,
    updatedAt: startedAt + planned,
    deletedAt: null,
    startedAt,
    endedAt: startedAt + planned,
    day,
    tzOffsetMin: -d.getTimezoneOffset(),
    plannedMs: planned,
    focusedMs: planned,
    taskId: null,
    taskName: null,
    categoryId: null,
    ...over,
  };
}

/** Session on a given local date/hour, with an optional `min` override for the focused minutes. */
export function onDay(y: number, mo: number, d: number, h = 10, mi = 0, over: Partial<Session> = {}): Session {
  return mkSession(at(y, mo, d, h, mi), over);
}

export function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: uid(),
    name: 'Task',
    categoryId: CAT1,
    done: false,
    doneAt: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...over,
  };
}

export function mkCategory(over: Partial<Category> = {}): Category {
  return { id: uid(), name: 'Cat', color: 1, order: 0, createdAt: 1, updatedAt: 1, deletedAt: null, ...over };
}

export const defaultCats = (): Category[] =>
  [
    ['Study', 1],
    ['Reading', 2],
    ['Problem sets', 3],
    ['Writing', 4],
    ['Review', 5],
  ].map(([name, color], i) => ({
    id: `5e5e0000-0000-4000-8000-00000000000${i + 1}`,
    name: name as string,
    color: color as Category['color'],
    order: i,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  }));

export const copyFixture: Copy = {
  encouragement: ['{sessions} sessions in. Nicely done.', 'One more session in the books.', 'That counted. Take your break.'],
  breakPrompts: ['Drink a glass of water.', 'Stand up and stretch your arms overhead.', 'Roll your shoulders back five times.'],
  milestones: {
    'sessions-10': 'Ten sessions. A real habit is starting.',
    'sessions-50': 'Fifty sessions. That\'s a lot of focused hours.',
    'sessions-100': 'One hundred sessions. Remarkable consistency.',
    'sessions-250': 'Two hundred fifty sessions. Look how far you\'ve come.',
    'streak-7': 'Seven days in a row. A full week of showing up.',
    'streak-30': 'Thirty days straight. That\'s a real rhythm.',
  },
  aboutLine: 'Made with care, for you.',
};

