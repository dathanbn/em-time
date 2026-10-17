import { MA_MIN_DAYS, MA_WINDOW_DAYS, MIN } from '../constants';
import { addDays, diffDays } from '../time/calendar';
import type { ISODay, Session, TrendPoint, TrendRange } from '../types';
import { bucketByDay, firstSessionDay } from './daily';

/**
 * TR-1..3. valueMin: that day's focus minutes (null before the first-ever session day).
 * avgMin: trailing mean of the day and up to 6 days before it, zero days included, using days
 * before the visible range; null until 3 days of data exist, null for today.
 */
export function trendSeries(sessions: Session[], today: ISODay, range: TrendRange): TrendPoint[] {
  const first = firstSessionDay(sessions);
  const buckets = bucketByDay(sessions);
  const minutes = (day: ISODay): number => (buckets.get(day)?.focusMs ?? 0) / MIN;
  const out: TrendPoint[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const isToday = i === 0;
    if (first === null || day < first) {
      out.push({ day, valueMin: null, avgMin: null, isToday });
      continue;
    }
    let avgMin: number | null = null;
    const dataDays = diffDays(first, day) + 1;
    if (!isToday && dataDays >= MA_MIN_DAYS) {
      const n = Math.min(MA_WINDOW_DAYS, dataDays);
      let sum = 0;
      for (let k = 0; k < n; k++) sum += minutes(addDays(day, -k));
      avgMin = sum / n;
    }
    out.push({ day, valueMin: minutes(day), avgMin, isToday });
  }
  return out;
}
