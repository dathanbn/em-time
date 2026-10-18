import { describe, expect, it } from 'vitest';
import { evenX, nearestIndex, niceFriendsMax, shortMinutes } from '../../frontend/src/charts/friendsGeometry';
import { durationTicks, thinTicks } from '../../frontend/src/charts/geometry';

describe('friends chart geometry (v6)', () => {
  it('niceFriendsMax: 30-minute steps up to 2 h, whole hours above, never below 1 h', () => {
    const f = niceFriendsMax;
    expect(f(0)).toEqual({ max: 60, step: 30 });
    expect(f(-5)).toEqual({ max: 60, step: 30 });
    expect(f(Number.NaN)).toEqual({ max: 60, step: 30 });
    expect(f(1)).toEqual({ max: 60, step: 30 });
    expect(f(45)).toEqual({ max: 60, step: 30 });
    expect(f(61)).toEqual({ max: 90, step: 30 });
    expect(f(90)).toEqual({ max: 90, step: 30 });
    expect(f(119)).toEqual({ max: 120, step: 30 });
    expect(f(120)).toEqual({ max: 120, step: 30 });
    expect(f(121)).toEqual({ max: 180, step: 60 });
    expect(f(180)).toEqual({ max: 180, step: 60 });
    expect(f(181)).toEqual({ max: 240, step: 60 });
    expect(f(600)).toEqual({ max: 600, step: 60 });
  });

  it('the gridlines stay at 2 or 3 labelled levels above zero', () => {
    for (const top of [0, 30, 60, 75, 120, 150, 200, 300, 480, 720]) {
      const { max, step } = niceFriendsMax(top);
      const levels = thinTicks(durationTicks(max, step), 3).filter((t) => t > 0);
      expect(levels.length, `max ${max}`).toBeGreaterThanOrEqual(2);
      expect(levels.length, `max ${max}`).toBeLessThanOrEqual(3);
    }
    const lv = (top: number) => {
      const { max, step } = niceFriendsMax(top);
      return thinTicks(durationTicks(max, step), 3);
    };
    expect(lv(120)).toEqual([0, 60, 120]); // 0, 1h, 2h
    expect(lv(0)).toEqual([0, 30, 60]);
  });

  it('shortMinutes: 0, 30m, 1h, 1.5h, 2h', () => {
    expect([0, 30, 60, 90, 120, 180, 600].map(shortMinutes)).toEqual(['0', '30m', '1h', '1.5h', '2h', '3h', '10h']);
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
