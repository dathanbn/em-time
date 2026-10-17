import { MIN, STORAGE_KEY } from './constants';
import { createEmCore } from './core';
import fixture from './fixtures/stub-data.json';
import { createMemoryAdapter } from './storage/persist';
import {
  createDefaultCategories,
  createDefaultMeta,
  createDefaultSettings,
  sessionId,
} from './store/defaults';
import { addDays, dayKey, parseDay, todayKey, weekStart } from './time/calendar';
import { timerConfigFromSettings } from './timer/config';
import { initialTimerState } from './timer/reducer';
import type { EmCore, StubCoreOptions } from './api';
import type { AppData, Session, Task } from './types';

const STUB_DEVICE_ID = 'f00dcafe-0000-4000-8000-00000000d3ad';

interface FixtureTask {
  id: string;
  name: string;
  category: number; // 1..5, index into the default categories
  createdOff: number;
  done: boolean;
  doneOff?: number;
  deleted: boolean;
  deletedOff?: number;
}
interface FixtureSession {
  off: number;
  at: string;
  mins: number;
  task: string | null;
}

/**
 * Builds the stub document relative to `now`: day offsets in the fixture become local timestamps,
 * sessions that have not finished yet are dropped, and the fixture's empty week is cleared.
 */
export function buildStubData(now: number): AppData {
  const base = todayKey(now);
  const atLocal = (off: number, hhmm: string): number => {
    const { y, m, d } = parseDay(addDays(base, -off));
    const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  };

  const categories = createDefaultCategories();
  const catId = (slot: number): string => categories[slot - 1]!.id;

  const ftasks = fixture.tasks as FixtureTask[];
  const newestFirst = [...ftasks].sort((a, b) => a.createdOff - b.createdOff);
  const tasks: Task[] = newestFirst.map((t, i) => {
    const createdAt = atLocal(t.createdOff, '09:00');
    const doneAt = t.done && t.doneOff !== undefined ? atLocal(t.doneOff, '18:00') : null;
    const deletedAt = t.deleted && t.deletedOff !== undefined ? atLocal(t.deletedOff, '12:00') : null;
    return {
      id: t.id,
      name: t.name,
      categoryId: catId(t.category),
      done: t.done,
      doneAt,
      order: i,
      createdAt,
      updatedAt: Math.max(createdAt, doneAt ?? 0, deletedAt ?? 0),
      deletedAt,
    };
  });
  const taskById = new Map(tasks.map((t) => [t.id, t] as const));

  const settings = createDefaultSettings();
  const emptyStart = addDays(weekStart(base, settings.weekStartsOn), fixture.emptyWeek * 7);
  const emptyEnd = addDays(emptyStart, 6);

  const sessions: Session[] = [];
  for (const fs of fixture.sessions as FixtureSession[]) {
    const startedAt = atLocal(fs.off, fs.at);
    const endedAt = startedAt + fs.mins * MIN;
    if (endedAt > now) continue; // later today: has not happened yet
    const day = dayKey(startedAt);
    if (day >= emptyStart && day <= emptyEnd) continue; // the fixture's one empty week
    const task = fs.task ? taskById.get(fs.task) : undefined;
    sessions.push({
      id: sessionId(STUB_DEVICE_ID, startedAt),
      startedAt,
      endedAt,
      day,
      tzOffsetMin: -new Date(startedAt).getTimezoneOffset(),
      plannedMs: fs.mins * MIN,
      focusedMs: fs.mins * MIN,
      taskId: task?.id ?? null,
      taskName: task?.name ?? null,
      categoryId: task?.categoryId ?? null,
      createdAt: endedAt,
      updatedAt: endedAt,
      deletedAt: null,
    });
  }
  sessions.sort((a, b) => a.startedAt - b.startedAt);

  const todayCount = sessions.filter((s) => s.day === base).length;
  const timer = initialTimerState(timerConfigFromSettings(settings), now);
  timer.cycle = todayCount % settings.longEvery;

  const meta = createDefaultMeta(atLocal(69, '08:00'), STUB_DEVICE_ID);
  meta.currentTaskId = tasks.find((t) => t.deletedAt === null && !t.done)?.id ?? null;
  meta.lastCategoryId = categories[0]!.id;
  meta.lastExportAt = now - 2 * 24 * 60 * MIN; // keeps the export reminder quiet by default

  return { app: 'em-time', schemaVersion: 1, settings, categories, tasks, sessions, timer, meta };
}

/**
 * Same API as createEmCore, running on fixture data and an in-memory storage adapter with sync
 * disabled. It is the real core, so timer, store actions and selectors all behave for real; only
 * the starting data is canned. `empty: true` starts from a first-run state instead.
 */
export function createStubCore(opts: StubCoreOptions): EmCore {
  const clock = opts.now ?? Date.now;
  const seed: Record<string, string> = opts.empty
    ? {}
    : { [STORAGE_KEY]: JSON.stringify(buildStubData(clock())) };
  return createEmCore({
    storage: createMemoryAdapter(seed),
    copy: opts.copy,
    now: opts.now,
    syncEnv: {},
  });
}
