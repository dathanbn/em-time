import { MIN, EXPORT_REMINDER, STORAGE_KEY } from './constants';
import { nextFromBag, renderMessage } from './copy/picker';
import { milestonesReached } from './stats/milestones';
import { statsSessions, todaySummary } from './stats/daily';
import { heatmapCells } from './stats/heatmap';
import { streakInfo } from './stats/streaks';
import { trendSeries } from './stats/trend';
import { weekSummary } from './stats/week';
import { createLocalStorageAdapter, loadData } from './storage/persist';
import { sessionId } from './store/defaults';
import { createStore } from './store/store';
import { hasStoredAuth, isSyncConfigured, readSyncEnv } from './sync/env';
import type { SyncEngine } from './sync/engine';
import { dayKey, todayKey, weekStart } from './time/calendar';
import { timerConfigFromSettings } from './timer/config';
import { createDefaultTimerDeps, createTimerEngine } from './timer/engine';
import type { EmCore, EmCoreOptions, TimerEvents } from './api';
import type { AppData, ISODay, PhaseCompleteEvent, Session, StorageStatus } from './types';

/**
 * Wires timer, store, copy and stats into the EmCore the UI uses.
 * Sync is lazy: nothing here imports supabase-js (see loadSync).
 */
export function createEmCore(opts: EmCoreOptions): EmCore {
  const deps = opts.deps ?? createDefaultTimerDeps(opts.now);
  const now = opts.now ?? (() => deps.now());
  const random = opts.random ?? Math.random;
  const copy = opts.copy;
  const adapter = opts.storage ?? createLocalStorageAdapter();

  const loaded = loadData(adapter, now());
  const initialStatus: StorageStatus =
    loaded.status === 'unavailable'
      ? 'unavailable'
      : loaded.status === 'read-only-newer'
        ? 'read-only-newer'
        : 'ok';
  const store = createStore({ data: loaded.data, adapter, now, status: initialStatus });
  const boot: EmCore['boot'] = {
    status: loaded.status,
    backupKey: loaded.status === 'recovered-corrupt' ? loaded.backupKey : null,
    dropped: loaded.status === 'ok' || loaded.status === 'migrated' ? loaded.dropped : 0,
  };

  const timerConfig = () => timerConfigFromSettings(store.get().settings);
  const timer = createTimerEngine({ initial: store.get().timer, config: timerConfig, deps });

  // ---- statistics (memoized on the sessions array identity and today) -----------------------
  let memo: { sessions: Session[]; today: ISODay; visible: Session[] } | null = null;
  function visibleSessions(today: ISODay): Session[] {
    const sessions = store.get().sessions;
    if (!memo || memo.sessions !== sessions || memo.today !== today) {
      memo = { sessions, today, visible: statsSessions(sessions, today) };
    }
    return memo.visible;
  }

  // ---- phase completion ------------------------------------------------------------------
  const listeners = new Set<(e: PhaseCompleteEvent) => void>();
  let adopting = false;
  // A phase that ended while the app was closed completes inside createEmCore, before the UI can
  // subscribe. Those events are held and replayed to the first subscriber (MSG-1, MIL-2).
  let everSubscribed = false;
  const heldEvents: PhaseCompleteEvent[] = [];

  function pickFromBag(kind: 'messages' | 'prompts', lines: string[], sessionsToday: number): string | null {
    if (lines.length === 0) return null;
    const bags = store.get().meta.bags;
    const render = (i: number) => renderMessage(lines[i]!, sessionsToday);
    const { index, bag } = nextFromBag(bags[kind], (i) => render(i) !== null, lines.length, random);
    store.setBags({ ...store.get().meta.bags, [kind]: bag });
    return index < 0 ? null : render(index);
  }

  function handlePhaseEnd(end: TimerEvents['phaseEnd']): void {
    let session: Session | null = null;
    let message: string | null = null;
    let milestone: PhaseCompleteEvent['milestone'] = null;
    let breakPrompt: string | null = null;

    if (end.phase === 'focus') {
      const t = now();
      const today = todayKey(t);
      const before = visibleSessions(today);
      const prev = { total: before.length, streak: streakInfo(before, today) };
      const data = store.get();
      const task = data.meta.currentTaskId
        ? data.tasks.find((x) => x.id === data.meta.currentTaskId && x.deletedAt === null)
        : undefined;
      const candidate: Session = {
        id: sessionId(data.meta.deviceId, end.phaseStartedAt),
        startedAt: end.phaseStartedAt,
        endedAt: end.endedAt,
        day: dayKey(end.phaseStartedAt),
        tzOffsetMin: -new Date(end.phaseStartedAt).getTimezoneOffset(),
        plannedMs: end.plannedMs,
        focusedMs: end.plannedMs,
        taskId: task?.id ?? null,
        taskName: task?.name ?? null,
        categoryId: task?.categoryId ?? null,
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      };
      if (store.logSession(candidate)) {
        session = candidate;
        const after = visibleSessions(today);
        const next = { total: after.length, streak: streakInfo(after, today) };
        const reached = milestonesReached(prev, next, store.get().meta.milestonesShown, copy);
        if (reached.length > 0) {
          milestone = reached[reached.length - 1]!;
          store.addMilestonesShown(reached.map((m) => m.key));
        }
        const settings = store.get().settings;
        if (milestone)
          message = milestone.text; // MIL-4: replaces the encouraging line
        else if (settings.encouragement) {
          message = pickFromBag(
            'messages',
            copy.encouragement,
            todaySummary(after, today, settings.dailyGoalMin).sessions,
          );
        }
        if (settings.breakPrompts) breakPrompt = pickFromBag('prompts', copy.breakPrompts, 0);
      }
    }

    const event: PhaseCompleteEvent = {
      phase: end.phase,
      late: end.late,
      session,
      nextPhase: end.nextPhase,
      autoStarted: end.autoStarted,
      message,
      milestone,
      breakPrompt,
    };
    if (!everSubscribed) heldEvents.push(event);
    for (const fn of [...listeners]) fn(event);
  }

  const offChange = timer.on('change', (s) => {
    if (!adopting) store.setTimer(s);
  });
  const offEnd = timer.on('phaseEnd', handlePhaseEnd);
  // Changed durations reach an idle timer immediately (TMR-11); running phases are untouched.
  const offStore = store.subscribe(() => timer.configChanged());

  // ---- multi-tab (EDGE-7): only for the real localStorage adapter --------------------------
  let offStorage: (() => void) | null = null;
  if (!opts.storage && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      const r = loadData(adapter, now());
      if (r.status !== 'ok' && r.status !== 'migrated' && r.status !== 'new') return;
      store.replaceFromStorage(r.data);
      adopting = true;
      try {
        timer.adopt(r.data.timer);
      } finally {
        adopting = false;
      }
    };
    window.addEventListener('storage', onStorage);
    offStorage = () => window.removeEventListener('storage', onStorage);
  }

  // ---- sync (lazy) -----------------------------------------------------------------------
  let syncPromise: Promise<SyncEngine | null> | null = null;
  let syncEngine: SyncEngine | null = null;
  function loadSync(): Promise<SyncEngine | null> {
    if (syncPromise === null) {
      syncPromise = (async () => {
        const env = opts.syncEnv ?? readSyncEnv();
        if (!isSyncConfigured(env) || store.status() === 'read-only-newer') return null;
        const mod = await import('./sync/engine');
        const createClient = await (opts.loadSupabase ? opts.loadSupabase() : mod.loadSupabaseFactory());
        syncEngine = mod.createSyncEngine({ store, env, createClient });
        return syncEngine;
      })().catch((err) => {
        syncPromise = null;
        throw err;
      });
    }
    return syncPromise;
  }
  if (isSyncConfigured(opts.syncEnv ?? readSyncEnv()) && hasStoredAuth()) {
    loadSync().catch((err) => console.warn('Em Time: sync could not start', err));
  }

  // A phase that ended while the app was closed is closed out now (TMR-15, EDGE-1).
  timer.sync();

  return {
    store,
    timer,
    copy,
    boot,
    onPhaseComplete(fn) {
      listeners.add(fn);
      if (!everSubscribed) {
        everSubscribed = true;
        const replay = heldEvents.splice(0);
        for (const e of replay) fn(e);
      }
      return () => {
        listeners.delete(fn);
      };
    },
    select: {
      today(at = now()) {
        const today = todayKey(at);
        return todaySummary(visibleSessions(today), today, store.get().settings.dailyGoalMin);
      },
      streak(at = now()) {
        const today = todayKey(at);
        return streakInfo(visibleSessions(today), today);
      },
      week(offset, at = now()) {
        const today = todayKey(at);
        const d: AppData = store.get();
        return weekSummary(
          visibleSessions(today),
          d.tasks,
          d.categories,
          today,
          d.settings.weekStartsOn,
          offset,
        );
      },
      heatmap(at = now()) {
        const today = todayKey(at);
        const s = store.get().settings;
        return heatmapCells(visibleSessions(today), today, s.weekStartsOn, s.dailyGoalMin);
      },
      trend(range, at = now()) {
        const today = todayKey(at);
        return trendSeries(visibleSessions(today), today, range);
      },
      taskWeekMs(taskId, at = now()) {
        const today = todayKey(at);
        const start = weekStart(today, store.get().settings.weekStartsOn);
        let sum = 0;
        for (const s of visibleSessions(today)) if (s.taskId === taskId && s.day >= start) sum += s.focusedMs;
        return sum;
      },
      exportReminderDue(at = now()) {
        const d = store.get();
        const m = d.meta;
        if (m.exportReminderSnoozedUntil !== null && at < m.exportReminderSnoozedUntil) return false;
        if (
          m.sync.userId !== null &&
          m.sync.lastSyncedAt !== null &&
          at - m.sync.lastSyncedAt < EXPORT_REMINDER.suppressIfSyncedWithinDays * 24 * 60 * MIN
        ) {
          return false;
        }
        const sessions = d.sessions.filter((s) => s.deletedAt === null);
        if (m.lastExportAt === null) return sessions.length >= EXPORT_REMINDER.firstAfterSessions;
        const sinceExport = sessions.some((s) => s.createdAt > (m.lastExportAt as number));
        return sinceExport && at - m.lastExportAt >= EXPORT_REMINDER.everyDays * 24 * 60 * MIN;
      },
    },
    loadSync,
    pickBreakPrompt() {
      const settings = store.get().settings;
      if (!settings.breakPrompts) return null;
      return pickFromBag('prompts', copy.breakPrompts, 0);
    },
    dispose() {
      offChange();
      offEnd();
      offStore();
      offStorage?.();
      listeners.clear();
      timer.dispose();
      syncEngine?.dispose();
    },
  };
}
