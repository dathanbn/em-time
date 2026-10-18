// Pure geometry for the Friends chart (v6). Kept apart from geometry.ts so the main chunk does not carry it.

/** Gridline steps the Friends chart may use, in minutes. */
export const FRIENDS_STEPS = [15, 30, 60, 120, 180, 240, 360];

/**
 * Friends chart scale that follows the data: the smallest step from FRIENDS_STEPS that needs at most
 * 4 gridlines above zero, and a maximum of at least 2 steps. 20 min gives 0..30m, 2 h 50 gives
 * 0/1h/2h/3h, 9 h gives 0/3h/6h/9h, no data gives 0..30m.
 */
export function niceFriendsMax(maxMin: number): { max: number; step: number } {
  const top = Number.isFinite(maxMin) ? Math.max(0, maxMin) : 0;
  const last = FRIENDS_STEPS[FRIENDS_STEPS.length - 1]!;
  const step = FRIENDS_STEPS.find((s) => Math.ceil(top / s) <= 4) ?? last;
  return { max: Math.max(step * 2, Math.ceil(top / step) * step), step };
}

/** Short axis label for a minute value: 0, 15m, 45m, 1h, 1.5h, 2h. */
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
