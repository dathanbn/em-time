import { HEAT_FRACTIONS, HEATMAP_WEEKS, MIN } from '../constants';
import { addDays, weekStart } from '../time/calendar';
import { formatDayLabel, formatDuration } from '../time/format';
import type { HeatLevel, HeatmapCell, ISODay, Session } from '../types';
import { bucketByDay } from './daily';

/** HM-2: 0 for no focus, then under 25% / under 50% / under 100% of goal, 4 when the goal is met. */
export function heatLevel(focusMs: number, goalMin: number): HeatLevel {
  if (focusMs <= 0) return 0;
  const goalMs = goalMin * MIN;
  if (goalMs <= 0) return 4;
  if (focusMs < goalMs * HEAT_FRACTIONS[0]) return 1;
  if (focusMs < goalMs * HEAT_FRACTIONS[1]) return 2;
  if (focusMs < goalMs * HEAT_FRACTIONS[2]) return 3;
  return 4;
}

/** HM-1: 9 week-columns by 7 day-rows ending with the current week. Future days are omitted. */
export function heatmapCells(
  sessions: Session[],
  today: ISODay,
  weekStartsOn: 0 | 1,
  goalMin: number,
): HeatmapCell[] {
  const buckets = bucketByDay(sessions);
  const first = addDays(weekStart(today, weekStartsOn), -(HEATMAP_WEEKS - 1) * 7);
  const cells: HeatmapCell[] = [];
  for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
    const day = addDays(first, i);
    if (day > today) break;
    const focusMs = buckets.get(day)?.focusMs ?? 0;
    cells.push({
      day,
      col: Math.floor(i / 7),
      row: i % 7,
      focusMs,
      level: heatLevel(focusMs, goalMin),
      isToday: day === today,
      label: `${formatDayLabel(day)} · ${formatDuration(focusMs)}`,
    });
  }
  return cells;
}
