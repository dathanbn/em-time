import { SESSION_MILESTONES, STREAK_MILESTONES } from '../constants';
import type { Copy, Milestone, StreakInfo } from '../types';

/**
 * MIL-1. Only thresholds crossed between `prev` and `next` and not already shown.
 * Session milestones key on their id; streak milestones key on 'streak-N@<startDay>' (once per run).
 */
export function milestonesReached(
  prev: { total: number; streak: StreakInfo },
  next: { total: number; streak: StreakInfo },
  shown: string[],
  copy: Copy,
): Milestone[] {
  const out: Milestone[] = [];
  for (const n of SESSION_MILESTONES) {
    const id = `sessions-${n}` as const;
    if (prev.total < n && next.total >= n && !shown.includes(id)) {
      out.push({ id, key: id, text: copy.milestones[id] });
    }
  }
  for (const n of STREAK_MILESTONES) {
    const id = `streak-${n}` as const;
    const key = `${id}@${next.streak.currentStartDay ?? ''}`;
    if (prev.streak.current < n && next.streak.current >= n && !shown.includes(key)) {
      out.push({ id, key, text: copy.milestones[id] });
    }
  }
  return out;
}
