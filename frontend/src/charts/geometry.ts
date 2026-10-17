// Pure chart geometry (contract.md section 4). Tested by QA.
export interface Pt {
  x: number;
  y: number;
}

const f = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Monotone cubic interpolation (Fritsch-Carlson, same result as d3 curveMonotoneX): one path of
 * cubic segments that never overshoots its neighbours. 0 points give '', 1 point gives a bare move.
 */
export function monotonePath(points: Pt[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0]!;
  if (n === 1) return `M${f(p0.x)},${f(p0.y)}`;

  const dx: number[] = [];
  const sec: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const w = points[i + 1]!.x - points[i]!.x;
    dx.push(w);
    sec.push(w === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / w);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = sec[0]!;
  m[n - 1] = sec[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = sec[i - 1]!;
    const b = sec[i]!;
    m[i] = a * b <= 0 ? 0 : (a + b) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const s = sec[i]!;
    if (s === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / s;
    const b = m[i + 1]! / s;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * s;
      m[i + 1] = t * b * s;
    }
  }
  let d = `M${f(p0.x)},${f(p0.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const w = dx[i]! / 3;
    d += `C${f(a.x + w)},${f(a.y + m[i]! * w)} ${f(b.x - w)},${f(b.y - m[i + 1]! * w)} ${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** Splits at null gaps into runs of consecutive points. */
export function splitRuns(points: (Pt | null)[]): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of points) {
    if (p) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** One monotone path per run of consecutive points; null entries break the line. */
export function linePaths(points: (Pt | null)[]): string[] {
  return splitRuns(points).map(monotonePath);
}

/** Axis maximum rounded up to a step of 30 minutes below 3 h, 60 minutes from 3 h. */
export function niceMaxMinutes(maxMin: number): { max: number; step: number } {
  const step = maxMin < 180 ? 30 : 60;
  const max = Math.max(step, Math.ceil(Math.max(0, maxMin) / step) * step);
  return { max, step };
}

/** 0, step, 2*step ... max, inclusive. */
export function durationTicks(max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** At most `levels` gridline values above zero, evenly thinned. */
export function thinTicks(ticks: number[], levels = 3): number[] {
  const n = ticks.length - 1;
  if (n <= levels) return ticks;
  const k = Math.ceil(n / levels);
  return ticks.filter((_, i) => i % k === 0);
}
