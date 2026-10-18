// Dev only (`npm run dev` with ?stub): a made-up friends list so the Stats tile and the Settings card
// can be looked at without a server. Loaded with a dynamic import behind import.meta.env.DEV, so it
// is never part of a production build.
import { MIN, addDays, normalizeFriendCode, type FriendWeek, type FriendsApi, type ISODay } from '@core';

export const STUB_SHARE = 'M3RV8TQB';

const WEEK_MIN: Record<string, number[]> = {
  Cathy: [95, 120, 60, 150, 85, 110, 130],
  Jordan: [30, 0, 45, 80, 25, 60, 40],
};

/** Cathy (color 1), Jordan (color 2) and an inactive Sam (color 3), minutes per day for from..to. */
export function stubFriendList(from: ISODay, to: ISODay): FriendWeek[] {
  const days = (mins: number[]): Record<ISODay, number> => {
    const out: Record<ISODay, number> = {};
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(to, i - 6);
      if (d >= from && d <= to && mins[i]! > 0) out[d] = mins[i]! * MIN;
    }
    return out;
  };
  return [
    { code: 'C4TH7YQ2', nickname: 'Cathy', displayName: 'Cathy', color: 1, active: true, days: days(WEEK_MIN.Cathy!) },
    { code: 'J0RD4N8M', nickname: 'Jordan', displayName: 'Jordan R.', color: 2, active: true, days: days(WEEK_MIN.Jordan!) },
    { code: 'S4M2P9XK', nickname: 'Sam', displayName: null, color: 3, active: false, days: {} },
  ];
}

/** An in-memory FriendsApi for the Settings card in the dev stub. */
export function stubFriendsApi(): FriendsApi {
  let share: string | null = STUB_SHARE;
  let rotations = 0;
  const list = stubFriendList('0000-00-00', '9999-99-99');
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
  const no = (error: 'invalid' | 'duplicate' | 'limit') => Promise.resolve({ ok: false as const, error });
  return {
    getShare: () => ok(share),
    enableShare: () => ok((share ??= STUB_SHARE)),
    rotateShare: () => ok((share = `R0T4T${String(++rotations).padStart(3, '0')}`)),
    disableShare: () => ((share = null), ok(null)),
    add(code, nickname) {
      const c = normalizeFriendCode(code);
      if (!c.ok) return no('invalid');
      if (list.some((f) => f.code === c.code)) return no('duplicate');
      const color = ([1, 2, 3, 4, 5] as const).find((x) => !list.some((f) => f.color === x));
      if (color === undefined) return no('limit');
      list.push({ code: c.code, nickname: nickname?.trim() || null, displayName: 'New friend', color, active: true, days: {} });
      return Promise.resolve({ ok: true as const });
    },
    rename(code, nickname) {
      const f = list.find((x) => x.code === code);
      if (f) f.nickname = nickname.trim() || null;
      return ok(null);
    },
    remove(code) {
      const i = list.findIndex((x) => x.code === code);
      if (i >= 0) list.splice(i, 1);
      return ok(null);
    },
    week(from, to) {
      const days = new Map(stubFriendList(from, to).map((f) => [f.code, f.days] as const));
      return ok(list.map((f) => ({ ...f, days: days.get(f.code) ?? {} })));
    },
  };
}
