// Barebones stopwatch (v5). Device-only UI state, deliberately outside core: it is never part of
// AppData, never exported or synced, and never touches the Pomodoro timer. Persisted under its own
// key as { startedAt, accumulatedMs } and timestamp based (Date.now()), so a hidden tab, a locked
// phone or a reload cannot make it drift.
import { signal } from '@preact/signals';
import { announce } from '../platform/announce';

const KEY = 'em-time:stopwatch';

export interface StopwatchState {
  /** Date.now() when the current run began, or null when not running. */
  startedAt: number | null;
  /** Time banked by earlier runs since the last reset. */
  accumulatedMs: number;
}
export type StopwatchPhase = 'idle' | 'running' | 'stopped';

const IDLE: StopwatchState = { startedAt: null, accumulatedMs: 0 };

function read(): StopwatchState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StopwatchState> | null;
    const acc = v?.accumulatedMs;
    const at = v?.startedAt;
    if (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0) return IDLE;
    if (at !== null && (typeof at !== 'number' || !Number.isFinite(at))) return IDLE;
    return { startedAt: at ?? null, accumulatedMs: acc };
  } catch {
    return IDLE;
  }
}

function write(s: StopwatchState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: it keeps working until the page closes */
  }
}

export const stopwatch = signal<StopwatchState>(read());

export const elapsedMs = (s: StopwatchState, now: number): number =>
  s.accumulatedMs + (s.startedAt === null ? 0 : Math.max(0, now - s.startedAt));

export const stopwatchPhase = (s: StopwatchState): StopwatchPhase =>
  s.startedAt !== null ? 'running' : s.accumulatedMs > 0 ? 'stopped' : 'idle';

/** m:ss under one hour, h:mm:ss from one hour. */
export function formatStopwatch(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function toggleStopwatch(): void {
  const s = stopwatch.value;
  const now = Date.now();
  const next: StopwatchState =
    s.startedAt === null
      ? { startedAt: now, accumulatedMs: s.accumulatedMs }
      : { startedAt: null, accumulatedMs: elapsedMs(s, now) };
  stopwatch.value = next;
  write(next);
  announce(next.startedAt === null ? 'Stopwatch stopped' : 'Stopwatch started');
}

/** Zeroes and stops; does nothing when already at zero and stopped. */
export function resetStopwatch(): void {
  if (stopwatchPhase(stopwatch.value) === 'idle') return;
  stopwatch.value = IDLE;
  write(IDLE);
  announce('Stopwatch reset');
}

/** Erase all data: forget the stored value too. */
export function clearStopwatch(): void {
  stopwatch.value = IDLE;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
