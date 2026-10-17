// What the cloud friend is doing. Priority: celebrate > wave > focusing > break > idle.
import { effect, signal } from '@preact/signals';
import { todayKey, type ISODay } from '@core';
import type { MascotState } from '../components/Mascot';
import { readLastWaveDay, writeLastWaveDay } from '../platform/uiMemory';
import { timerState } from './coreBridge';

const celebrating = signal(false);
const waving = signal(false);

let celebrateTimer = 0;
let waveTimer = 0;

export function celebrate(): void {
  celebrating.value = true;
  window.clearTimeout(celebrateTimer);
  celebrateTimer = window.setTimeout(() => (celebrating.value = false), 1600);
}

export function wave(): void {
  waving.value = true;
  window.clearTimeout(waveTimer);
  waveTimer = window.setTimeout(() => (waving.value = false), 1800);
}

// Daily goal met: thumbs up for about 3 seconds. Never while a focus session is running or while
// the celebrate pose is still playing; it waits for the next break or idle moment.
const thumbing = signal(false);
const THUMBS_MS = 3000;
let thumbPending = false;
let thumbTimer = 0;
let goalDay = '';
let goalMet = false;

function flushThumbs(): void {
  if (!thumbPending || celebrating.value) return;
  const s = timerState.value;
  if (s.status === 'running' && s.phase === 'focus') return;
  thumbPending = false;
  thumbing.value = true;
  window.clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => (thumbing.value = false), THUMBS_MS);
}

/** Starts watching for the moment to show a pending thumbs up. Call once at startup. */
export function initThumbs(): void {
  effect(() => {
    void celebrating.value;
    void timerState.value;
    flushThumbs();
  });
}

/**
 * Reports today's goal state after a focus session. The first time it flips to met on a day the
 * thumbs up is queued; `quiet` only records the baseline (startup, late catch-up events).
 */
export function noteGoalProgress(met: boolean, day: string, quiet = false): void {
  if (day !== goalDay) {
    goalDay = day;
    goalMet = false;
  }
  if (met && !goalMet && !quiet) {
    thumbPending = true;
    flushThumbs();
  }
  goalMet = met;
}

/** Waves hello on the first open of each study day (D-61). */
export function initFirstOpenWave(): void {
  const day: ISODay = todayKey(Date.now());
  if (readLastWaveDay() === day) return;
  writeLastWaveDay(day);
  wave();
}

/** Reads signals, so call it while rendering. `idleOnly` is for the small page-title mascots. */
export function currentMascotState(idleOnly = false): MascotState {
  if (!idleOnly && celebrating.value) return 'celebrate';
  if (waving.value) return 'wave';
  if (idleOnly) return 'idle';
  if (thumbing.value) return 'thumbs';
  const s = timerState.value;
  if (s.phase !== 'focus') return 'break';
  return s.status === 'running' ? 'focusing' : 'idle';
}
