// Device-only UI memory (contract V2.7): `em-time:ui`, JSON { lastWaveDay }. Always wrapped in
// try/catch; nothing depends on it, it is never exported or synced.
import type { ISODay } from '@core';

const KEY = 'em-time:ui';

export function readLastWaveDay(): ISODay | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { lastWaveDay?: unknown } | null;
    return typeof v?.lastWaveDay === 'string' ? v.lastWaveDay : null;
  } catch {
    return null;
  }
}

export function writeLastWaveDay(day: ISODay): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ lastWaveDay: day }));
  } catch {
    /* storage unavailable: the wave just plays again next visit */
  }
}

export function clearUiMemory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
