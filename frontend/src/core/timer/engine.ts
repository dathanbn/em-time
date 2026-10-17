import type { Phase, TimerState } from '../types';
import type { PhaseEnd, TimerAction, TimerConfig, TimerDeps, TimerEngine, TimerEvents } from '../api';
import { initialTimerState, timerReducer } from './reducer';

export { initialTimerState, timerReducer };
export type { TimerConfig };

/** Real clock, timers and (when present) page visibility events. Browser globals are guarded. */
export function createDefaultTimerDeps(now: () => number = Date.now): TimerDeps {
  return {
    now,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onVisibility(fn) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
      const onVis = () => {
        if (document.visibilityState === 'visible') fn();
      };
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', fn);
      window.addEventListener('pageshow', fn);
      return () => {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('focus', fn);
        window.removeEventListener('pageshow', fn);
      };
    },
  };
}

/** Extra ms added to the single scheduled timeout so it never fires a hair early. */
const SCHEDULE_PAD_MS = 5;

export function createTimerEngine(opts: {
  initial: TimerState;
  config: () => TimerConfig;
  deps?: TimerDeps;
}): TimerEngine {
  const deps = opts.deps ?? createDefaultTimerDeps();
  let state = opts.initial;
  let handle: unknown = null;
  let disposed = false;
  const listeners: { [K in keyof TimerEvents]: Set<(e: TimerEvents[K]) => void> } = {
    change: new Set(),
    phaseEnd: new Set(),
  };

  function emit<K extends keyof TimerEvents>(k: K, e: TimerEvents[K]): void {
    for (const fn of [...listeners[k]]) fn(e);
  }

  function schedule(): void {
    if (handle !== null) {
      deps.clearTimeout(handle);
      handle = null;
    }
    if (disposed || state.status !== 'running' || state.endsAt === null) return;
    const delay = Math.max(0, state.endsAt - deps.now()) + SCHEDULE_PAD_MS;
    handle = deps.setTimeout(() => {
      handle = null;
      dispatch({ type: 'sync' });
    }, delay);
  }

  function dispatch(action: TimerAction): void {
    if (disposed) return;
    const now = deps.now();
    const cfg = opts.config();
    let nextEnd: (PhaseEnd & { nextPhase: Phase; autoStarted: boolean }) | null = null;
    let next = state;
    // A phase that is already over is closed out before any user action is applied.
    if (
      action.type !== 'sync' &&
      state.status === 'running' &&
      state.endsAt !== null &&
      now >= state.endsAt
    ) {
      const r = timerReducer(next, { type: 'sync' }, now, cfg);
      next = r.state;
      if (r.ended) nextEnd = { ...r.ended, nextPhase: r.state.phase, autoStarted: r.autoStarted };
    }
    const result = timerReducer(next, action, now, cfg);
    if (result.ended) {
      nextEnd = { ...result.ended, nextPhase: result.state.phase, autoStarted: result.autoStarted };
    }
    const stateChanged = result.state !== state;
    state = result.state;
    schedule();
    if (stateChanged) emit('change', state);
    if (nextEnd) emit('phaseEnd', nextEnd);
  }

  const offVisibility = deps.onVisibility?.(() => dispatch({ type: 'sync' })) ?? null;
  schedule();

  return {
    getState: () => state,
    remainingMs(at) {
      if (state.status === 'running' && state.endsAt !== null) {
        return Math.max(0, state.endsAt - (at ?? deps.now()));
      }
      return state.remainingMs;
    },
    progress(at) {
      if (state.plannedMs <= 0) return 0;
      const remaining =
        state.status === 'running' && state.endsAt !== null
          ? Math.max(0, state.endsAt - (at ?? deps.now()))
          : state.remainingMs;
      return Math.min(1, remaining / state.plannedMs);
    },
    start: () => dispatch({ type: 'start' }),
    pause: () => dispatch({ type: 'pause' }),
    resume: () => dispatch({ type: 'resume' }),
    toggle: () => dispatch({ type: 'toggle' }),
    skip: () => dispatch({ type: 'skip' }),
    reset: () => dispatch({ type: 'reset' }),
    setPhase: (phase) => dispatch({ type: 'setPhase', phase }),
    sync: () => dispatch({ type: 'sync' }),
    configChanged: () => dispatch({ type: 'config', cfg: opts.config() }),
    adopt(adopted) {
      if (disposed) return;
      state = adopted;
      schedule();
      emit('change', state);
      dispatch({ type: 'sync' });
    },
    on(k, fn) {
      const set = listeners[k] as Set<typeof fn>;
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    dispose() {
      disposed = true;
      if (handle !== null) deps.clearTimeout(handle);
      handle = null;
      offVisibility?.();
      listeners.change.clear();
      listeners.phaseEnd.clear();
    },
  };
}
