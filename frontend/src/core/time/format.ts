import type { ISODay } from '../types';
import { isoWeekdayIndex, parseDay } from './calendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WORDS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** '0m', '45m', '1h', '1h 25m' (minutes rounded). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Countdown text from remaining ms, rounding seconds UP: '25:00', '0:59', '1:30:00'. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 'Tue, Oct 14' */
export function formatDayLabel(day: ISODay): string {
  const { m, d } = parseDay(day);
  return `${WEEKDAYS[isoWeekdayIndex(day)]}, ${MONTHS[m - 1]} ${d}`;
}

/** 'Oct 14' */
export function formatShortDate(day: ISODay): string {
  const { m, d } = parseDay(day);
  return `${MONTHS[m - 1]} ${d}`;
}

/** 'Oct 13 to Oct 19' */
export function formatRange(start: ISODay, end: ISODay): string {
  return `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

/** 2..12 -> 'two'..'twelve', anything else -> digits. */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 2 && n <= 12 ? WORDS[n - 2]! : String(n);
}
