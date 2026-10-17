import { describe, expect, it } from 'vitest';
import { addDays, MIN, statsSessions, trendSeries, type Session } from '@core';
import { onDay } from './helpers';

const TODAY = '2026-10-14';
/** minutes per day -> sessions; each session is `min` minutes long. */
function days(spec: Record<string, number>): Session[] {
  return Object.entries(spec).map(([day, min]) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return onDay(y, m, d, 10, 0, { plannedMs: min * MIN, focusedMs: min * MIN });
  });
}
const series = (spec: Record<string, number>, range: 30 | 90 | 365 = 30) =>
  trendSeries(statsSessions(days(spec), TODAY), TODAY, range);
const byDay = (pts: ReturnType<typeof series>, day: string) => pts.find((p) => p.day === day)!;

describe('trendSeries (TR-1..3)', () => {
  it('returns exactly `range` points, oldest first, ending today', () => {
    for (const r of [30, 90, 365] as const) {
      const pts = series({ '2026-10-10': 25 }, r);
      expect(pts).toHaveLength(r);
      expect(pts[pts.length - 1]!.day).toBe(TODAY);
      expect(pts[0]!.day).toBe(addDays(TODAY, -(r - 1)));
    }
  });

  it('with no data every value is null', () => {
    const pts = series({});
    expect(pts.every((p) => p.valueMin === null && p.avgMin === null)).toBe(true);
    expect(pts[pts.length - 1]!.isToday).toBe(true);
  });

  it('days before the first session have null value and average', () => {
    const pts = series({ '2026-10-01': 50 });
    expect(byDay(pts, '2026-09-30').valueMin).toBeNull();
    expect(byDay(pts, '2026-09-15').avgMin).toBeNull();
    expect(byDay(pts, '2026-10-01').valueMin).toBe(50);
  });

  it('average is undefined until 3 days of data exist, then averages the available days (zeros included)', () => {
    const pts = series({ '2026-10-01': 60 });
    expect(byDay(pts, '2026-10-01').avgMin).toBeNull(); // day 1
    expect(byDay(pts, '2026-10-02').avgMin).toBeNull(); // day 2
    expect(byDay(pts, '2026-10-03').avgMin).toBeCloseTo(20); // day 3: 60/3
    expect(byDay(pts, '2026-10-04').avgMin).toBeCloseTo(15); // 60/4
    expect(byDay(pts, '2026-10-06').avgMin).toBeCloseTo(10); // 60/6
    expect(byDay(pts, '2026-10-07').avgMin).toBeCloseTo(60 / 7); // first full window
    expect(byDay(pts, '2026-10-08').avgMin).toBeCloseTo(0); // day 1 left the window
  });

  it('is a trailing 7-day window ending on the day itself', () => {
    const spec: Record<string, number> = {};
    for (let d = 1; d <= 13; d++) spec[`2026-10-${String(d).padStart(2, '0')}`] = d * 10;
    const pts = series(spec);
    // Oct 10: days 4..10 -> 40..100 -> mean 70
    expect(byDay(pts, '2026-10-10').avgMin).toBeCloseTo(70);
    // Oct 13: days 7..13 -> 70..130 -> mean 100
    expect(byDay(pts, '2026-10-13').avgMin).toBeCloseTo(100);
  });

  it('uses data before the visible range so the left edge is not truncated', () => {
    const spec: Record<string, number> = {};
    for (let i = 0; i < 80; i++) if (i % 3 !== 0) spec[addDays(TODAY, -i)] = 20 + (i % 7) * 10;
    const p30 = series(spec, 30);
    const p90 = series(spec, 90);
    const tail = p90.slice(-30);
    expect(p30.map((p) => p.avgMin)).toEqual(tail.map((p) => p.avgMin));
    expect(p30.map((p) => p.valueMin)).toEqual(tail.map((p) => p.valueMin));
    // and the first visible point is a real number, not a short-window artefact
    expect(p30[0]!.avgMin).not.toBeNull();
    const first = p30[0]!.day;
    let sum = 0;
    for (let k = 0; k < 7; k++) sum += spec[addDays(first, -k)] ?? 0;
    expect(p30[0]!.avgMin).toBeCloseTo(sum / 7);
  });

  it('today is flagged, keeps its value, and has no average (the line does not dip)', () => {
    const pts = series({ '2026-10-10': 30, '2026-10-11': 30, '2026-10-12': 30, '2026-10-13': 30, [TODAY]: 5 });
    const today = pts[pts.length - 1]!;
    expect(today.isToday).toBe(true);
    expect(today.avgMin).toBeNull();
    expect(today.valueMin).toBe(5);
    expect(pts.filter((p) => p.isToday)).toHaveLength(1);
    // yesterday's average is unaffected by today's low total
    expect(byDay(pts, '2026-10-13').avgMin).toBeCloseTo(120 / 4);
  });

  it('only-today data: no average anywhere', () => {
    const pts = series({ [TODAY]: 25 });
    expect(pts.every((p) => p.avgMin === null)).toBe(true);
    expect(pts[pts.length - 1]!.valueMin).toBe(25);
  });

  it('first session 3 days before today: the day before today (2nd data day) is still null', () => {
    const pts = series({ '2026-10-12': 30 });
    expect(byDay(pts, '2026-10-13').avgMin).toBeNull();
    expect(pts[pts.length - 1]!.avgMin).toBeNull(); // today excluded anyway
  });

  it('365-day range reaches back a full year', () => {
    const pts = series({ '2025-10-20': 25, '2026-10-13': 25 }, 365);
    expect(pts[0]!.day).toBe('2025-10-15');
    expect(byDay(pts, '2025-10-20').valueMin).toBe(25);
    expect(byDay(pts, '2025-10-19').valueMin).toBeNull();
  });
});
