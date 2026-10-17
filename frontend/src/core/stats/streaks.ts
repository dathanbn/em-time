import { addDays, diffDays } from '../time/calendar';
import type { ISODay, Session, StreakInfo } from '../types';

/**
 * STK-1..3. A study day counts if it has at least one session. Current streak ends today if
 * today counts, else yesterday; best is the longest run ever (including the current one).
 * `lastCountingDay` is the most recent day (not after `today`) that counts, whether or not it is
 * part of the current run.
 */
export function streakInfo(sessions: Session[], today: ISODay): StreakInfo {
  const days = new Set<ISODay>();
  for (const s of sessions) if (s.deletedAt === null && s.day <= today) days.add(s.day);
  const sorted = [...days].sort();

  let best = 0;
  let run = 0;
  let prev: ISODay | null = null;
  for (const d of sorted) {
    run = prev !== null && diffDays(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }

  const todayCounts = days.has(today);
  const endDay = todayCounts ? today : days.has(addDays(today, -1)) ? addDays(today, -1) : null;
  let current = 0;
  let currentStartDay: ISODay | null = null;
  if (endDay !== null) {
    let d = endDay;
    while (days.has(d)) {
      current += 1;
      currentStartDay = d;
      d = addDays(d, -1);
    }
  }

  return {
    current,
    best,
    todayCounts,
    currentStartDay,
    lastCountingDay: sorted.length > 0 ? sorted[sorted.length - 1]! : null,
  };
}
