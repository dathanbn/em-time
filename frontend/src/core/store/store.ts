import { CORRUPT_KEY_PREFIX, LIMITS, PRESETS, SYNCED_SETTINGS_KEYS } from '../constants';
import { exportData, mergeData } from '../storage/exportImport';
import { applyRemoteRow } from '../storage/lww';
import { saveData } from '../storage/persist';
import { isRecord, validateCategory, validateSession, validateTask } from '../storage/validate';
import type {
  AppData,
  Category,
  CategoryColorSlot,
  EntityMeta,
  Meta,
  Session,
  Settings,
  StorageStatus,
  SyncMeta,
  SyncTable,
  Task,
  TimerState,
} from '../types';
import type { EmStore, StorageAdapter } from '../api';
import { createDefaultData, uuid } from './defaults';
import { ValidationError } from './errors';

/** Methods only core.ts uses; they are not part of the public EmStore interface. */
export interface StoreInternals {
  /** Idempotent by id. Returns true when the session was new. */
  logSession(s: Session): boolean;
  /** Persists timer state without notifying subscribers (ticking never calls this). */
  setTimer(t: TimerState): void;
  setBags(bags: Meta['bags']): void;
  addMilestonesShown(keys: string[]): void;
  /** Multi-tab: adopt data another tab wrote. No persist, no sync dirtying. */
  replaceFromStorage(data: AppData): void;
}

const live = <T extends EntityMeta>(xs: T[]): T[] => xs.filter((x) => x.deletedAt === null);
const unique = (xs: string[]): string[] => [...new Set(xs)];

export function createStore(opts: {
  data: AppData;
  adapter: StorageAdapter;
  now: () => number;
  status?: StorageStatus;
}): EmStore & StoreInternals {
  let data = opts.data;
  let status: StorageStatus = opts.status ?? 'ok';
  const subs = new Set<(d: AppData) => void>();
  const writeListeners = new Set<(t: SyncTable | null) => void>();
  const now = opts.now;

  const stamp = (prev: number): number => Math.max(now(), prev + 1);

  function persist(): void {
    const r = saveData(opts.adapter, data);
    if (r.ok) {
      if (status === 'quota' || status === 'unavailable') status = 'ok';
    } else {
      status = r.error;
    }
  }

  function commit(next: AppData, tables: Array<SyncTable | null>, notify = true): void {
    data = next;
    persist();
    if (notify) for (const fn of [...subs]) fn(data);
    const seen = new Set<SyncTable | null>(tables.length === 0 ? [null] : tables);
    for (const t of seen) for (const fn of [...writeListeners]) fn(t);
  }

  /** Adds ids to the dirty queue, only while signed in. */
  function dirtyMeta(meta: Meta, table: SyncTable, ids: string[] | true): Meta {
    if (meta.sync.userId === null) return meta;
    const dirty = { ...meta.sync.dirty };
    if (table === 'settings') dirty.settings = true;
    else if (Array.isArray(ids)) dirty[table] = unique([...dirty[table], ...ids]);
    return { ...meta, sync: { ...meta.sync, dirty } };
  }

  const activeTask = (id: string): Task => {
    const t = data.tasks.find((x) => x.id === id && x.deletedAt === null);
    if (!t) throw new ValidationError('id', 'required');
    return t;
  };
  const activeCategory = (id: string): Category => {
    const c = data.categories.find((x) => x.id === id && x.deletedAt === null);
    if (!c) throw new ValidationError('categoryId', 'required');
    return c;
  };

  function checkName(field: string, raw: unknown, max: number): string {
    if (typeof raw !== 'string') throw new ValidationError(field, 'required');
    const name = raw.trim();
    if (name.length < 1) throw new ValidationError(field, 'required');
    if (name.length > max) throw new ValidationError(field, 'too-long');
    return name;
  }

  function replaceTask(t: Task): AppData {
    return { ...data, tasks: data.tasks.map((x) => (x.id === t.id ? t : x)) };
  }

  function metaOnly(patch: Partial<Meta>): void {
    commit({ ...data, meta: { ...data.meta, ...patch } }, [null]);
  }

  function firstLiveCategory(): Category {
    const cats = live(data.categories).sort((a, b) => a.order - b.order);
    return cats[0]!;
  }

  const store: EmStore & StoreInternals = {
    get: () => data,
    status: () => status,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },

    addTask(input) {
      const name = checkName('name', input.name, LIMITS.taskName[1]);
      const categoryId =
        input.categoryId !== undefined
          ? activeCategory(input.categoryId).id
          : data.meta.lastCategoryId !== null &&
              data.categories.some((c) => c.id === data.meta.lastCategoryId && c.deletedAt === null)
            ? data.meta.lastCategoryId
            : firstLiveCategory().id;
      const t = now();
      const open = live(data.tasks);
      const task: Task = {
        id: uuid(),
        name,
        categoryId,
        done: false,
        doneAt: null,
        order: open.length === 0 ? 0 : Math.min(...open.map((x) => x.order)) - 1,
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      };
      commit(
        {
          ...data,
          tasks: [...data.tasks, task],
          meta: dirtyMeta({ ...data.meta, lastCategoryId: categoryId }, 'tasks', [task.id]),
        },
        ['tasks'],
      );
      return task;
    },

    updateTask(id, patch) {
      const cur = activeTask(id);
      const next: Task = { ...cur };
      if (patch.name !== undefined) next.name = checkName('name', patch.name, LIMITS.taskName[1]);
      if (patch.categoryId !== undefined) next.categoryId = activeCategory(patch.categoryId).id;
      if (patch.order !== undefined) {
        if (!Number.isInteger(patch.order)) throw new ValidationError('order', 'limit');
        next.order = patch.order;
      }
      if (next.name === cur.name && next.categoryId === cur.categoryId && next.order === cur.order)
        return cur;
      next.updatedAt = stamp(cur.updatedAt);
      const lastCat = patch.categoryId !== undefined ? next.categoryId : data.meta.lastCategoryId;
      commit(
        {
          ...replaceTask(next),
          meta: dirtyMeta({ ...data.meta, lastCategoryId: lastCat }, 'tasks', [id]),
        },
        ['tasks'],
      );
      return next;
    },

    setTaskDone(id, done) {
      const cur = activeTask(id);
      if (cur.done === done) return cur;
      const t = now();
      const next: Task = { ...cur, done, doneAt: done ? t : null, updatedAt: stamp(cur.updatedAt) };
      commit({ ...replaceTask(next), meta: dirtyMeta(data.meta, 'tasks', [id]) }, ['tasks']);
      return next;
    },

    deleteTask(id) {
      const cur = activeTask(id);
      const t = now();
      const next: Task = { ...cur, deletedAt: t, updatedAt: stamp(cur.updatedAt) };
      const meta = dirtyMeta(data.meta, 'tasks', [id]);
      commit(
        {
          ...replaceTask(next),
          meta: data.meta.currentTaskId === id ? { ...meta, currentTaskId: null } : meta,
        },
        ['tasks'],
      );
    },

    clearDone() {
      const doomed = live(data.tasks).filter((t) => t.done);
      if (doomed.length === 0) return 0;
      const t = now();
      const ids = new Set(doomed.map((x) => x.id));
      const tasks = data.tasks.map((x) =>
        ids.has(x.id) ? { ...x, deletedAt: t, updatedAt: stamp(x.updatedAt) } : x,
      );
      const meta = dirtyMeta(data.meta, 'tasks', [...ids]);
      commit(
        {
          ...data,
          tasks,
          meta:
            meta.currentTaskId !== null && ids.has(meta.currentTaskId)
              ? { ...meta, currentTaskId: null }
              : meta,
        },
        ['tasks'],
      );
      return doomed.length;
    },

    setCurrentTask(id) {
      if (id !== null) activeTask(id);
      if (data.meta.currentTaskId === id) return;
      metaOnly({ currentTaskId: id });
    },

    addCategory(input) {
      const name = checkName('name', input.name, LIMITS.categoryName[1]);
      if (!Number.isInteger(input.color) || input.color < 1 || input.color > 8) {
        throw new ValidationError('color', 'limit');
      }
      const cats = live(data.categories);
      if (cats.length >= LIMITS.categories[1]) throw new ValidationError('categories', 'limit');
      const t = now();
      const cat: Category = {
        id: uuid(),
        name,
        color: input.color,
        order: cats.length === 0 ? 0 : Math.max(...cats.map((c) => c.order)) + 1,
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      };
      commit(
        {
          ...data,
          categories: [...data.categories, cat],
          meta: dirtyMeta(data.meta, 'categories', [cat.id]),
        },
        ['categories'],
      );
      return cat;
    },

    updateCategory(id, patch) {
      const cur = activeCategory(id);
      const next: Category = { ...cur };
      if (patch.name !== undefined) next.name = checkName('name', patch.name, LIMITS.categoryName[1]);
      if (patch.color !== undefined) {
        if (!Number.isInteger(patch.color) || patch.color < 1 || patch.color > 8) {
          throw new ValidationError('color', 'limit');
        }
        next.color = patch.color as CategoryColorSlot;
      }
      if (patch.order !== undefined) {
        if (!Number.isInteger(patch.order)) throw new ValidationError('order', 'limit');
        next.order = patch.order;
      }
      if (next.name === cur.name && next.color === cur.color && next.order === cur.order) return cur;
      next.updatedAt = stamp(cur.updatedAt);
      commit(
        {
          ...data,
          categories: data.categories.map((c) => (c.id === id ? next : c)),
          meta: dirtyMeta(data.meta, 'categories', [id]),
        },
        ['categories'],
      );
      return next;
    },

    deleteCategory(id, moveTasksTo) {
      const cur = activeCategory(id);
      if (live(data.categories).length <= 1) throw new ValidationError('categories', 'last-category');
      if (moveTasksTo === id) throw new ValidationError('moveTasksTo', 'required');
      try {
        activeCategory(moveTasksTo);
      } catch {
        throw new ValidationError('moveTasksTo', 'required');
      }
      const t = now();
      const movedIds: string[] = [];
      const tasks = data.tasks.map((x) => {
        if (x.deletedAt === null && x.categoryId === id) {
          movedIds.push(x.id);
          return { ...x, categoryId: moveTasksTo, updatedAt: stamp(x.updatedAt) };
        }
        return x;
      });
      const categories = data.categories.map((c) =>
        c.id === id ? { ...cur, deletedAt: t, updatedAt: stamp(cur.updatedAt) } : c,
      );
      let meta = dirtyMeta(data.meta, 'categories', [id]);
      meta = dirtyMeta(meta, 'tasks', movedIds);
      if (meta.lastCategoryId === id) meta = { ...meta, lastCategoryId: moveTasksTo };
      commit(
        { ...data, tasks, categories, meta },
        movedIds.length > 0 ? ['categories', 'tasks'] : ['categories'],
      );
    },

    updateSettings(patch) {
      const cur = data.settings;
      const next: Settings = { ...cur };
      const ranged = ['focusMin', 'shortMin', 'longMin', 'longEvery', 'dailyGoalMin'] as const;
      const bools = ['autoStart', 'breakPrompts', 'encouragement', 'notifications', 'keepAwake'] as const;
      for (const k of ranged) {
        const v = patch[k];
        if (v === undefined) continue;
        const [lo, hi] = LIMITS[k];
        if (!Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(k, 'limit');
      }
      for (const k of bools) {
        if (patch[k] !== undefined && typeof patch[k] !== 'boolean') throw new ValidationError(k, 'required');
      }
      if (patch.volume !== undefined && !(patch.volume >= 0 && patch.volume <= 1)) {
        throw new ValidationError('volume', 'limit');
      }
      if (patch.weekStartsOn !== undefined && patch.weekStartsOn !== 0 && patch.weekStartsOn !== 1) {
        throw new ValidationError('weekStartsOn', 'limit');
      }
      if (patch.theme !== undefined && patch.theme !== 'light' && patch.theme !== 'dark') {
        throw new ValidationError('theme', 'required');
      }
      if (patch.chime !== undefined && !['glass', 'bowl', 'bell', 'wood', 'none'].includes(patch.chime)) {
        throw new ValidationError('chime', 'required');
      }
      if (patch.preset !== undefined && !['25/5', '50/10', '90/20', 'custom'].includes(patch.preset)) {
        throw new ValidationError('preset', 'required');
      }

      const { updatedAt: _ignored, preset, focusMin, shortMin, longMin, ...rest } = patch;
      Object.assign(next, rest);
      if (preset !== undefined && preset !== 'custom') {
        next.preset = preset;
        Object.assign(next, PRESETS[preset]);
      } else {
        if (preset === 'custom') next.preset = 'custom';
        if (focusMin !== undefined) next.focusMin = focusMin;
        if (shortMin !== undefined) next.shortMin = shortMin;
        if (longMin !== undefined) next.longMin = longMin;
        if (
          preset === undefined &&
          (next.focusMin !== cur.focusMin || next.shortMin !== cur.shortMin || next.longMin !== cur.longMin)
        ) {
          next.preset = 'custom';
        }
      }

      const keys = Object.keys(cur) as Array<keyof Settings>;
      if (keys.every((k) => next[k] === cur[k])) return cur;
      const syncedChanged = SYNCED_SETTINGS_KEYS.some((k) => next[k] !== cur[k]);
      if (syncedChanged) next.updatedAt = stamp(cur.updatedAt);
      commit(
        { ...data, settings: next, meta: syncedChanged ? dirtyMeta(data.meta, 'settings', true) : data.meta },
        [syncedChanged ? 'settings' : null],
      );
      return next;
    },

    markExported: (at) => metaOnly({ lastExportAt: at, exportReminderSnoozedUntil: null }),
    snoozeExportReminder: (until) => metaOnly({ exportReminderSnoozedUntil: until }),
    markNotificationPrompted: (at) => metaOnly({ notificationPromptedAt: at }),
    markPersistRequested: (at) => metaOnly({ persistRequestedAt: at }),

    exportNow: (at) => exportData(data, at),

    importData(incoming, mode) {
      const signedIn = data.meta.sync.userId !== null;
      if (mode === 'merge') {
        const merged = mergeData(data, incoming);
        const meta = signedIn
          ? dirtyMeta(
              dirtyMeta(
                dirtyMeta(
                  data.meta,
                  'categories',
                  incoming.categories.map((x) => x.id),
                ),
                'tasks',
                incoming.tasks.map((x) => x.id),
              ),
              'sessions',
              incoming.sessions.map((x) => x.id),
            )
          : data.meta;
        commit({ ...merged, meta }, ['categories', 'tasks', 'sessions']);
        return;
      }
      const settings: Settings = { ...incoming.settings, updatedAt: stamp(data.settings.updatedAt) };
      const taskIds = new Set(live(incoming.tasks).map((t) => t.id));
      let meta: Meta = {
        ...data.meta,
        currentTaskId:
          data.meta.currentTaskId !== null && taskIds.has(data.meta.currentTaskId)
            ? data.meta.currentTaskId
            : null,
        lastCategoryId: incoming.categories.some((c) => c.id === data.meta.lastCategoryId)
          ? data.meta.lastCategoryId
          : null,
        milestonesShown: unique([...data.meta.milestonesShown, ...incoming.meta.milestonesShown]),
      };
      if (signedIn) {
        meta = {
          ...meta,
          sync: {
            ...meta.sync,
            dirty: {
              categories: incoming.categories.map((x) => x.id),
              tasks: incoming.tasks.map((x) => x.id),
              sessions: incoming.sessions.map((x) => x.id),
              settings: true,
            },
          },
        };
      }
      commit(
        {
          ...data,
          settings,
          categories: incoming.categories,
          tasks: incoming.tasks,
          sessions: incoming.sessions,
          meta,
        },
        ['categories', 'tasks', 'sessions', 'settings'],
      );
    },

    eraseAll(at) {
      for (const k of opts.adapter.keys()) {
        if (k.startsWith(CORRUPT_KEY_PREFIX)) {
          try {
            opts.adapter.remove(k);
          } catch {
            /* ignore */
          }
        }
      }
      const fresh = createDefaultData(at, data.meta.deviceId);
      fresh.meta.sync.lastUserId = data.meta.sync.lastUserId ?? data.meta.sync.userId;
      commit(fresh, [null]);
    },

    applyRemote(table, rows) {
      let applied = 0;
      let dropped = 0;
      if (table === 'settings') {
        let settings = data.settings;
        for (const row of rows) {
          if (!isRecord(row) || typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)) {
            dropped += 1;
            continue;
          }
          if (row.updatedAt > settings.updatedAt) {
            const merged: Record<string, unknown> = { ...settings };
            for (const k of SYNCED_SETTINGS_KEYS) if (k in row) merged[k] = row[k];
            merged.updatedAt = row.updatedAt;
            settings = merged as unknown as Settings;
            applied += 1;
          }
        }
        if (applied > 0) {
          // Re-run through the same clamping rules as import.
          const prev = data;
          data = { ...data, settings: clampSettings(settings, prev.settings) };
          persist();
          for (const fn of [...subs]) fn(data);
        }
        return { applied, dropped };
      }

      const validator =
        table === 'categories' ? validateCategory : table === 'tasks' ? validateTask : validateSession;
      const incoming: Array<Category | Task | Session> = [];
      for (const row of rows) {
        const v = (validator as (x: unknown) => Category | Task | Session | null)(row);
        if (v === null) dropped += 1;
        else incoming.push(v);
      }
      const list = (
        table === 'categories' ? data.categories : table === 'tasks' ? data.tasks : data.sessions
      ) as EntityMeta[];
      const map = new Map<string, EntityMeta>(list.map((x) => [x.id, x] as const));
      for (const item of incoming) {
        const cur = map.get(item.id);
        const chosen = applyRemoteRow(cur, item);
        if (chosen !== cur) {
          map.set(item.id, chosen);
          applied += 1;
        }
      }
      if (applied > 0) {
        let merged = [...map.values()];
        if (table === 'sessions')
          merged = (merged as Session[]).sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
        else merged = (merged as Array<Category | Task>).sort((a, b) => a.order - b.order);
        data = { ...data, [table]: merged } as AppData;
        if (table === 'tasks' && data.meta.currentTaskId !== null) {
          // a task deleted on another device can no longer be the current one here
          const cur = (merged as Task[]).find((t) => t.id === data.meta.currentTaskId);
          if (!cur || cur.deletedAt !== null) data = { ...data, meta: { ...data.meta, currentTaskId: null } };
        }
        persist();
        for (const fn of [...subs]) fn(data);
      }
      return { applied, dropped };
    },

    takeDirty(): SyncMeta['dirty'] {
      const d = data.meta.sync.dirty;
      return {
        categories: [...d.categories],
        tasks: [...d.tasks],
        sessions: [...d.sessions],
        settings: d.settings,
      };
    },

    clearDirty(table, ids, snapshot) {
      const sync = data.meta.sync;
      const dirty = { ...sync.dirty };
      if (table === 'settings') {
        const snap = snapshot.settings;
        if (snap === undefined || snap === data.settings.updatedAt) dirty.settings = false;
      } else {
        const entities = (
          table === 'categories' ? data.categories : table === 'tasks' ? data.tasks : data.sessions
        ) as EntityMeta[];
        const byId = new Map(entities.map((e) => [e.id, e] as const));
        const target = ids === true ? dirty[table] : ids;
        const clear = new Set(
          target.filter((id) => {
            const e = byId.get(id);
            const snap = snapshot[id];
            return e === undefined || snap === undefined || e.updatedAt === snap;
          }),
        );
        dirty[table] = dirty[table].filter((id) => !clear.has(id));
      }
      data = { ...data, meta: { ...data.meta, sync: { ...sync, dirty } } };
      persist();
    },

    markAllDirty() {
      const sync = data.meta.sync;
      data = {
        ...data,
        meta: {
          ...data.meta,
          sync: {
            ...sync,
            dirty: {
              categories: data.categories.map((x) => x.id),
              tasks: data.tasks.map((x) => x.id),
              sessions: data.sessions.map((x) => x.id),
              settings: true,
            },
          },
        },
      };
      persist();
    },

    tombstoneAll(at) {
      const kill = <T extends EntityMeta>(xs: T[]): T[] =>
        xs.map((x) => (x.deletedAt === null ? { ...x, deletedAt: at, updatedAt: stamp(x.updatedAt) } : x));
      const categories = kill(data.categories);
      const tasks = kill(data.tasks);
      const sessions = kill(data.sessions);
      let meta = dirtyMeta(
        data.meta,
        'categories',
        categories.map((x) => x.id),
      );
      meta = dirtyMeta(
        meta,
        'tasks',
        tasks.map((x) => x.id),
      );
      meta = dirtyMeta(
        meta,
        'sessions',
        sessions.map((x) => x.id),
      );
      commit({ ...data, categories, tasks, sessions, meta: { ...meta, currentTaskId: null } }, [
        'categories',
        'tasks',
        'sessions',
      ]);
    },

    setSyncMeta(patch) {
      data = { ...data, meta: { ...data.meta, sync: { ...data.meta.sync, ...patch } } };
      persist();
      for (const fn of [...subs]) fn(data);
    },

    onLocalWrite(fn) {
      writeListeners.add(fn);
      return () => {
        writeListeners.delete(fn);
      };
    },

    // ---- internals for core.ts ------------------------------------------------

    logSession(s) {
      if (data.sessions.some((x) => x.id === s.id)) return false;
      const sessions = [...data.sessions, s].sort(
        (a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1),
      );
      commit({ ...data, sessions, meta: dirtyMeta(data.meta, 'sessions', [s.id]) }, ['sessions']);
      return true;
    },

    setTimer(t) {
      data = { ...data, timer: t };
      persist();
    },

    setBags(bags) {
      metaOnly({ bags });
    },

    addMilestonesShown(keys) {
      metaOnly({ milestonesShown: unique([...data.meta.milestonesShown, ...keys]) });
    },

    replaceFromStorage(next) {
      data = next;
      for (const fn of [...subs]) fn(data);
    },
  };
  return store;
}

function clampSettings(s: Settings, fallback: Settings): Settings {
  // Remote synced keys come from another device; keep them inside this build's limits.
  const within = (v: number, [lo, hi]: readonly [number, number], d: number) =>
    Number.isInteger(v) && v >= lo && v <= hi ? v : d;
  return {
    ...s,
    focusMin: within(s.focusMin, LIMITS.focusMin, fallback.focusMin),
    shortMin: within(s.shortMin, LIMITS.shortMin, fallback.shortMin),
    longMin: within(s.longMin, LIMITS.longMin, fallback.longMin),
    longEvery: within(s.longEvery, LIMITS.longEvery, fallback.longEvery),
    dailyGoalMin: within(s.dailyGoalMin, LIMITS.dailyGoalMin, fallback.dailyGoalMin),
    weekStartsOn: s.weekStartsOn === 0 ? 0 : 1,
  };
}
