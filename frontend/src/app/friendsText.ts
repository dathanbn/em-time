// Small wording helpers for the friends UI (the Stats tile and the Settings card). Lazy chunks only.
import { formatShortDate, todayKey, type FriendWeek } from '@core';

/** 'just now', '5 min ago', '2 h ago', or a short date after a day. */
export function agoText(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return formatShortDate(todayKey(ts));
}

/** A friend's name in the app: nickname, else their display name, else "Friend N" (N from 1, list order). */
export const friendName = (f: FriendWeek, index: number): string =>
  f.nickname ?? f.displayName ?? `Friend ${index + 1}`;

