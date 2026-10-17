import { MIN } from '../constants';
import { addDays, diffDays, isValidDay } from '../time/calendar';
import type { DailyStat, ISODay, Session, TodaySummary } from '../types';

/**
 * Sessions that may be shown in stats: not deleted, structurally valid, and not on a future study day.
 * (A session dated in the future is kept in storage and simply hidden until its day arrives.)
 */
export function statsSessions(sessions: Session[], today: ISODay): Session[] {
  return sessions.filter(
    (s) =>
      s.deletedAt === null &&
      isValidDay(s.day) &&
      s.day <= today &&
      s.endedAt >= s.startedAt &&
      s.focusedMs >= 0 &&
      s.focusedMs <= s.plannedMs,
  );
}

/** Earliest study day that has a (non-deleted) session, or null. */
export function firstSessionDay(sessions: Session[]): ISODay | null {
  let first: ISODay | null = null;
  for (const s of sessions) {
    if (s.deletedAt !== null) continue;
    if (first === null || s.day < first) first = s.day;
  }
  return first;
}

/** Sums by study day. Used by every other selector. */
export function bucketByDay(sessions: Session[]): Map<ISODay, DailyStat> {
  const map = new Map<ISODay, DailyStat>();
  for (const s of sessions) {
    if (s.deletedAt !== null) continue;
    const cur = map.get(s.day);
    if (cur) {
      cur.focusMs += s.focusedMs;
      cur.sessions += 1;
    } else {
      map.set(s.day, { day: s.day, focusMs: s.focusedMs, sessions: 1 });
    }
  }
  return map;
}

/** One entry per day from `from` to `to` inclusive (zero days included). */
export function dailyStats(sessions: Session[], from: ISODay, to: ISODay): DailyStat[] {
  const buckets = bucketByDay(sessions);
  const out: DailyStat[] = [];
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) {
    const day = addDays(from, i);
    const b = buckets.get(day);
    out.push({ day, focusMs: b?.focusMs ?? 0, sessions: b?.sessions ?? 0 });
  }
  return out;
}

export function todaySummary(sessions: Session[], today: ISODay, goalMin: number): TodaySummary {
  const b = bucketByDay(sessions).get(today);
  const focusMs = b?.focusMs ?? 0;
  const goalMs = goalMin * MIN;
  return {
    day: today,
    focusMs,
    sessions: b?.sessions ?? 0,
    goalMs,
    progress: goalMs > 0 ? focusMs / goalMs : 0,
    goalMet: goalMs > 0 && focusMs >= goalMs,
  };
}
