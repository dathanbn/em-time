// Bridges the framework-free core into Preact signals. Screens read these signals and call core
// through the `core` binding; they never keep their own copy of persisted data.
import { signal } from '@preact/signals';
import type { AppData, EmCore, TimerState } from '@core';

export let core: EmCore;

export const data = signal<AppData>(undefined as unknown as AppData);
export const timerState = signal<TimerState>(undefined as unknown as TimerState);
/** Bumps once a minute so selectors that depend on "now" (today, week, streak) refresh. */
export const clockTick = signal(0);

export function initBridge(c: EmCore): void {
  core = c;
  data.value = c.store.get();
  timerState.value = c.timer.getState();
  c.store.subscribe((d) => {
    data.value = d;
  });
  c.timer.on('change', (s) => {
    timerState.value = s;
  });
  setInterval(() => {
    clockTick.value++;
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clockTick.value++;
  });
}

/** Read inside a component or computed so it re-runs after data or the clock changes. */
export function track(): void {
  void data.value;
  void clockTick.value;
}
