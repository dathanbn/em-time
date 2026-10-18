// Validation of the friends data (v6): what em_friends_week returns, and what app/friends.ts reads
// back from its localStorage cache. Pure and main-chunk safe; the engine and the app share it.
import { isValidDay } from '../time/calendar';
import type { ISODay } from '../types';
import { FRIENDS_MAX, normalizeFriendCode } from './friendCode';
import type { FriendWeek } from './engine'; // type only

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored friend code ('K7QP2MXD'): already normalized, exactly 8 characters of the alphabet. */
export function storedFriendCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = normalizeFriendCode(v);
  return n.ok && n.code === v ? v : null;
}

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = Array.from(v.trim()).slice(0, max).join('');
  return t.length > 0 ? t : null;
};

/**
 * Keeps well-formed entries (at most 5), clamps minutes to >= 0, drops days outside from..to and
 * every day of an inactive friend. Returns null when `data` is not an array at all.
 */
export function parseFriendWeek(data: unknown, from: ISODay, to: ISODay): FriendWeek[] | null {
  if (!Array.isArray(data)) return null;
  const out: FriendWeek[] = [];
  const seen = new Set<string>();
  for (const e of data) {
    if (!isRecord(e)) continue;
    const code = storedFriendCode(e.code);
    const color = e.color;
    if (code === null || seen.has(code)) continue;
    if (typeof color !== 'number' || !Number.isInteger(color) || color < 1 || color > 5) continue;
    if (typeof e.active !== 'boolean') continue;
    const days: Record<ISODay, number> = {};
    if (e.active && isRecord(e.days)) {
      for (const [day, ms] of Object.entries(e.days)) {
        if (!isValidDay(day) || day < from || day > to) continue;
        if (typeof ms !== 'number' || !Number.isFinite(ms)) continue;
        days[day] = Math.max(0, Math.round(ms));
      }
    }
    seen.add(code);
    out.push({
      code,
      nickname: clip(e.nickname, 24),
      displayName: e.active ? clip(e.displayName, 24) : null,
      color: color as FriendWeek['color'],
      active: e.active,
      days,
    });
    if (out.length === FRIENDS_MAX) break;
  }
  return out;
}
