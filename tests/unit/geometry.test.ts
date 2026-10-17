import { describe, expect, it } from 'vitest';
import { durationTicks, linePaths, monotonePath, niceMaxMinutes } from '../../frontend/src/charts/geometry';

type Pt = { x: number; y: number };

/** Parses an "M x,y C c1 c2 p ..." path into its anchor points and control points. */
function parse(path: string): { start: Pt; segs: Array<{ c1: Pt; c2: Pt; p: Pt }> } {
  const nums = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const start = { x: nums[0]!, y: nums[1]! };
  const segs = [];
  for (let i = 2; i + 5 < nums.length + 0; i += 6) {
    segs.push({ c1: { x: nums[i]!, y: nums[i + 1]! }, c2: { x: nums[i + 2]!, y: nums[i + 3]! }, p: { x: nums[i + 4]!, y: nums[i + 5]! } });
  }
  return { start, segs };
}
const bez = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

describe('monotonePath (D-3)', () => {
  it('handles 0, 1 and 2 points', () => {
    expect(monotonePath([])).toBe('');
    expect(monotonePath([{ x: 5, y: 7 }])).toMatch(/^M5,?\s?7/);
    const two = parse(monotonePath([{ x: 0, y: 10 }, { x: 10, y: 20 }]));
    expect(two.segs).toHaveLength(1);
    expect(two.segs[0]!.p).toEqual({ x: 10, y: 20 });
  });

  it('never leaves the y range of the two neighbouring points on any segment (50 samples each)', () => {
    const series: Pt[][] = [
      [0, 0, 0, 90, 0, 0, 60, 60, 60, 0, 10, 100].map((y, i) => ({ x: i * 20, y })),
      [5, 5, 5, 5, 5].map((y, i) => ({ x: i * 20, y })),
      [0, 100, 0, 100, 0, 100].map((y, i) => ({ x: i * 20, y })),
      [100, 80, 40, 10, 0, 0, 0, 30, 90].map((y, i) => ({ x: i * 20, y })),
      [3, 50, 51, 52, 3].map((y, i) => ({ x: i * 13.5, y })),
    ];
    for (const pts of series) {
      const { start, segs } = parse(monotonePath(pts));
      let prev = start;
      segs.forEach((s, i) => {
        expect(prev).toEqual({ x: pts[i]!.x, y: pts[i]!.y });
        const lo = Math.min(pts[i]!.y, pts[i + 1]!.y);
        const hi = Math.max(pts[i]!.y, pts[i + 1]!.y);
        for (let k = 0; k <= 50; k++) {
          const y = bez(prev.y, s.c1.y, s.c2.y, s.p.y, k / 50);
          expect(y).toBeGreaterThanOrEqual(lo - 0.011);
          expect(y).toBeLessThanOrEqual(hi + 0.011);
        }
        prev = s.p;
      });
      expect(segs).toHaveLength(pts.length - 1);
    }
  });

  it('smoothing never dips below zero minutes (y never passes the baseline) and has n-1 curve segments', () => {
    const baseline = 200; // screen y of 0 minutes; larger y is lower on screen
    const minutes = [0, 0, 120, 0, 0, 0, 45, 0, 200, 0, 0, 15, 0];
    const pts = minutes.map((m, i) => ({ x: i * 10, y: baseline - m }));
    const { start, segs } = parse(monotonePath(pts));
    expect(segs).toHaveLength(minutes.length - 1);
    let prev = start;
    for (const s of segs) {
      for (let k = 0; k <= 50; k++) expect(bez(prev.y, s.c1.y, s.c2.y, s.p.y, k / 50)).toBeLessThanOrEqual(baseline + 1e-6);
      prev = s.p;
    }
  });

  it('x is monotone along every segment (no loops)', () => {
    const pts = [0, 40, 10, 80, 20].map((y, i) => ({ x: i * 30, y }));
    const { start, segs } = parse(monotonePath(pts));
    let prev = start;
    for (const s of segs) {
      for (let k = 1; k <= 50; k++) {
        expect(bez(prev.x, s.c1.x, s.c2.x, s.p.x, k / 50)).toBeGreaterThanOrEqual(bez(prev.x, s.c1.x, s.c2.x, s.p.x, (k - 1) / 50) - 1e-9);
      }
      prev = s.p;
    }
  });
});

describe('linePaths', () => {
  it('splits into one path per run of non-null points', () => {
    const p = (x: number, y: number) => ({ x, y });
    const paths = linePaths([p(0, 1), p(1, 2), p(2, 3), null, null, p(5, 1), p(6, 2), null, p(8, 3)]);
    expect(paths).toHaveLength(3);
    expect(paths[0]!.startsWith('M0')).toBe(true);
    expect(paths[1]!.startsWith('M5')).toBe(true);
    expect(linePaths([null, null])).toEqual([]);
    expect(linePaths([])).toEqual([]);
  });
});

describe('axis helpers', () => {
  it('niceMaxMinutes: step 30 below 180, 60 at or above', () => {
    expect(niceMaxMinutes(1).step).toBe(30);
    expect(niceMaxMinutes(1).max).toBe(30);
    expect(niceMaxMinutes(0).max).toBeGreaterThan(0);
    expect(niceMaxMinutes(95)).toEqual({ max: 120, step: 30 });
    expect(niceMaxMinutes(179)).toEqual({ max: 180, step: 30 });
    expect(niceMaxMinutes(180).step).toBe(60);
    expect(niceMaxMinutes(181)).toEqual({ max: 240, step: 60 });
  });
  it('durationTicks runs from 0 to max inclusive', () => {
    expect(durationTicks(120, 30)).toEqual([0, 30, 60, 90, 120]);
    expect(durationTicks(240, 60)).toEqual([0, 60, 120, 180, 240]);
  });
});
