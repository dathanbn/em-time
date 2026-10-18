import { describe, expect, it } from 'vitest';
import { MIN, type FriendWeek } from '../../frontend/src/core';
import {
  YOU_COLOR,
  buildFriendSeries,
  seriesPath,
  seriesSummary,
  seriesTop,
  spoken,
  standings,
} from '../../frontend/src/charts/friendsSeries';
import { evenX } from '../../frontend/src/charts/friendsGeometry';

const DAYS = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
const friend = (over: Partial<FriendWeek>): FriendWeek => ({
  code: 'C4TH7YQ2',
  nickname: null,
  displayName: null,
  color: 1,
  active: true,
  days: {},
  ...over,
});
const YOU = [0, 25, 50, 0, 75, 10, 50];

describe('friends series (v6.1), shared by the Stats chart and the Timer card', () => {
  const list = [
    friend({ nickname: 'Cathy', days: { '2026-10-14': 80 * MIN, '2026-10-13': 150 * MIN } }),
    friend({ code: 'J0RD4N8M', color: 2, displayName: 'Jordan R.', days: { '2026-10-14': 35 * MIN } }),
    friend({ code: 'S4M2P9XK', color: 3, active: false }),
  ];
  const series = buildFriendSeries(list, DAYS, YOU);

  it('You comes first, solid ink; friends follow in list order in the color the server gave them', () => {
    expect(series.map((s) => s.name)).toEqual(['You', 'Cathy', 'Jordan R.', 'Friend 3']);
    expect(series[0]).toMatchObject({ key: 'you', you: true, color: YOU_COLOR, values: YOU });
    expect(YOU_COLOR).toBe('var(--em-ink)');
    expect(series.map((s) => s.color)).toEqual(['var(--em-ink)', 'var(--em-cat-1)', 'var(--em-cat-2)', 'var(--em-cat-3)']);
    expect(series[3]!.inactive).toBe(true);
  });

  it('friend values are minutes per day, 0 where the day is missing', () => {
    expect(series[1]!.values).toEqual([0, 0, 0, 0, 0, 150, 80]);
    expect(series[2]!.values).toEqual([0, 0, 0, 0, 0, 0, 35]);
  });

  it('seriesTop ignores inactive friends', () => {
    expect(seriesTop(series)).toBe(150);
    expect(seriesTop([])).toBe(0);
    const off = buildFriendSeries([friend({ active: false, days: { '2026-10-14': 600 * MIN } })], DAYS, YOU);
    expect(seriesTop(off)).toBe(75);
  });

  it('standings: active series only, You first, with the minutes of the last day', () => {
    expect(standings(series).map((s) => [s.name, s.min])).toEqual([
      ['You', 50],
      ['Cathy', 80],
      ['Jordan R.', 35],
    ]);
    expect(standings(buildFriendSeries([], DAYS, [0, 0, 0, 0, 0, 0, 0])).map((s) => s.min)).toEqual([0]);
  });

  it('spoken and the summary', () => {
    expect([0, 45, 60, 130, 59.6].map(spoken)).toEqual(['0 min', '45 min', '1 h', '2 h 10 min', '1 h']);
    expect(seriesSummary(series)).toBe(
      'You 3 h 30 min total, Cathy 3 h 50 min total, Jordan R. 35 min total, Friend 3, code off',
    );
  });

  it('seriesPath: one continuous monotone path (one move, only curves) through every day value', () => {
    const xOf = (i: number) => evenX(i, 7, 4, 300);
    const yOf = (m: number) => 100 - m;
    const d = seriesPath(YOU, xOf, yOf);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/C/g)).toHaveLength(6);
    expect(d).not.toMatch(/L/);
    expect(d.startsWith('M4,100C')).toBe(true);
    // passes through each day: the end point of every segment is that day
    const ends = [...d.matchAll(/([\d.]+),([\d.]+)(?=C|$)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(ends).toEqual(YOU.map((v, i) => [Number(xOf(i).toFixed(2)), 100 - v]));
  });

  it('seriesPath never overshoots: every control point stays within its two neighbours', () => {
    const vals = [0, 0, 100, 0, 0, 90, 10];
    const d = seriesPath(vals, (i) => i * 50, (m) => 200 - m);
    const nums = [...d.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)];
    expect(nums).toHaveLength(6);
    for (const [i, m] of nums.entries()) {
      const lo = 200 - Math.max(vals[i]!, vals[i + 1]!);
      const hi = 200 - Math.min(vals[i]!, vals[i + 1]!);
      for (const y of [Number(m[2]), Number(m[4])]) {
        expect(y).toBeGreaterThanOrEqual(lo - 1e-6);
        expect(y).toBeLessThanOrEqual(hi + 1e-6);
      }
    }
  });
});
