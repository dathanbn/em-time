import { DAY_START_HOUR } from '../constants';
import type { ISODay } from '../types';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function fmt(y: number, m: number, d: number): ISODay {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Parses 'YYYY-MM-DD' into numbers. Throws on malformed input. */
export function parseDay(day: ISODay): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Invalid day key: ${day}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** True when `day` is a well-formed, real calendar date. */
export function isValidDay(day: unknown): day is ISODay {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Calendar-date arithmetic on Date.UTC, so DST can never shift a result. */
export function addDays(day: ISODay, n: number): ISODay {
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from `a` to `b` (b minus a). `addDays(a, diffDays(a, b)) === b`. */
export function diffDays(a: ISODay, b: ISODay): number {
  const pa = parseDay(a);
  const pb = parseDay(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** 0 Sunday .. 6 Saturday. */
export function isoWeekdayIndex(day: ISODay): number {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** First day of the week containing `day`. */
export function weekStart(day: ISODay, weekStartsOn: 0 | 1): ISODay {
  const back = (isoWeekdayIndex(day) - weekStartsOn + 7) % 7;
  return addDays(day, -back);
}

/**
 * Study day of a timestamp on the LOCAL wall clock: before `dayStartHour` it is the previous
 * calendar date. Wall-clock based, so DST nights behave like any other night.
 */
export function dayKey(ts: number, dayStartHour: number = DAY_START_HOUR): ISODay {
  const d = new Date(ts);
  const key = fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return d.getHours() < dayStartHour ? addDays(key, -1) : key;
}

export function todayKey(now: number): ISODay {
  return dayKey(now);
}
