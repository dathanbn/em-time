import { describe, expect, it } from 'vitest';
import { evenX, nearestIndex, niceFriendsMax, shortMinutes } from '../../frontend/src/charts/friendsGeometry';
import { durationTicks } from '../../frontend/src/charts/geometry';

describe('friends chart geometry (v6)', () => {
  it('niceFriendsMax: the smallest step that needs at most 4 gridlines, and at least 2 steps', () => {
    const f = niceFriendsMax;
    // small: 20 min of focus is 0 / 15m / 30m
    expect(f(20)).toEqual({ max: 30, step: 15 });
    expect(f(15)).toEqual({ max: 30, step: 15 });
    expect(f(1)).toEqual({ max: 30, step: 15 });
    expect(f(60)).toEqual({ max: 60, step: 15 }); // 4 steps of 15
    expect(f(61)).toEqual({ max: 90, step: 30 }); // 5 steps of 15 is too many
    expect(f(120)).toEqual({ max: 120, step: 30 });
    // mid: 2 h 50 is 0 / 1h / 2h / 3h
    expect(f(170)).toEqual({ max: 180, step: 60 });
    expect(f(240)).toEqual({ max: 240, step: 60 });
    expect(f(241)).toEqual({ max: 360, step: 120 });
    // large: 9 h is 0 / 3h / 6h / 9h
    expect(f(540)).toEqual({ max: 540, step: 180 });
    expect(f(270)).toEqual({ max: 360, step: 120 }); // 4 h 30
    expect(f(720)).toEqual({ max: 720, step: 180 });
    expect(f(1440)).toEqual({ max: 1440, step: 360 });
    expect(f(1500)).toEqual({ max: 1800, step: 360 }); // past a day: the largest step keeps going
  });

  it('niceFriendsMax: no data (or bad numbers) is 0 to 30m', () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY * 0])
      expect(niceFriendsMax(v)).toEqual({ max: 30, step: 15 });
  });

  it('niceFriendsMax: always 2 to 4 gridlines above zero, all on whole steps, the data never above the top', () => {
    for (let top = 0; top <= 1440; top += 7) {
      const { max, step } = niceFriendsMax(top);
      const lines = durationTicks(max, step).filter((t) => t > 0);
      expect(lines.length, `top ${top}`).toBeGreaterThanOrEqual(2);
      expect(lines.length, `top ${top}`).toBeLessThanOrEqual(4);
      expect(max, `top ${top}`).toBeGreaterThanOrEqual(top);
      expect(max % step).toBe(0);
    }
    const labels = (top: number) => {
      const { max, step } = niceFriendsMax(top);
      return durationTicks(max, step).map(shortMinutes);
    };
    expect(labels(20)).toEqual(['0', '15m', '30m']);
    expect(labels(170)).toEqual(['0', '1h', '2h', '3h']);
    expect(labels(540)).toEqual(['0', '3h', '6h', '9h']);
    expect(labels(0)).toEqual(['0', '15m', '30m']);
    expect(labels(45)).toEqual(['0', '15m', '30m', '45m']);
  });

  it('shortMinutes: 0, 15m, 45m, 1h, 1.5h, 2h', () => {
    expect([0, 15, 30, 45, 60, 90, 120, 180, 600].map(shortMinutes)).toEqual([
      '0', '15m', '30m', '45m', '1h', '1.5h', '2h', '3h', '10h',
    ]);
    expect(shortMinutes(-1)).toBe('0');
    expect(shortMinutes(45.4)).toBe('45m');
  });

  it('evenX spreads 7 points from the left edge to the right edge', () => {
    const xs = Array.from({ length: 7 }, (_, i) => evenX(i, 7, 34, 300));
    expect(xs[0]).toBe(34);
    expect(xs[6]).toBe(334);
    for (let i = 1; i < 7; i += 1) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(50, 9);
    expect(evenX(0, 1, 10, 100)).toBe(60); // a single point sits in the middle
  });

  it('nearestIndex inverts evenX and clamps outside the plot', () => {
    for (let i = 0; i < 7; i += 1) expect(nearestIndex(evenX(i, 7, 34, 300), 7, 34, 300)).toBe(i);
    expect(nearestIndex(evenX(2, 7, 34, 300) + 24, 7, 34, 300)).toBe(2);
    expect(nearestIndex(evenX(2, 7, 34, 300) + 26, 7, 34, 300)).toBe(3);
    expect(nearestIndex(-100, 7, 34, 300)).toBe(0);
    expect(nearestIndex(9999, 7, 34, 300)).toBe(6);
    expect(nearestIndex(50, 1, 34, 300)).toBe(0);
    expect(nearestIndex(50, 7, 34, 0)).toBe(0);
  });
});
