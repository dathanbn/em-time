// Pure geometry for the Friends chart (v6). Kept apart from geometry.ts so the main chunk does not carry it.

/** Friends chart axis maximum: 30-minute steps up to 2 h, whole hours above; never below 1 h. */
export function niceFriendsMax(maxMin: number): { max: number; step: number } {
  const m = Number.isFinite(maxMin) ? Math.max(0, maxMin) : 0;
  if (m <= 120) return { max: Math.max(60, Math.ceil(m / 30) * 30), step: 30 };
  return { max: Math.ceil(m / 60) * 60, step: 60 };
}

/** Short axis label for a minute value: 0, 30m, 1h, 1.5h, 2h. */
export function shortMinutes(min: number): string {
  if (min <= 0) return '0';
  if (min < 60) return `${Math.round(min)}m`;
  return `${Math.round((min / 60) * 10) / 10}h`;
}

/** x of point `i` of `n` spread evenly over `width` pixels starting at `left`. */
export function evenX(i: number, n: number, left: number, width: number): number {
  return left + (n <= 1 ? width / 2 : (i / (n - 1)) * width);
}

/** Index of the point nearest to pixel `x` (clamped to 0..n-1). */
export function nearestIndex(x: number, n: number, left: number, width: number): number {
  if (n <= 1 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.round(((x - left) / width) * (n - 1))));
}
