// Friends (v6), the part that talks to the server and the device cache. Lazy: it ships in the
// friends chunk with the Stats tile body and the Settings card. See app/friends.ts for the state.
import {
  addDays,
  isSyncConfigured,
  parseFriendWeek,
  readSyncEnv,
  storedFriendCode,
  todayKey,
  type FriendWeek,
  type FriendsApi,
  type ISODay,
} from '@core';
import { core, data } from './coreBridge';
import { FRIENDS_CACHE_KEY, friends, friendsRunState, type FriendsStatus } from './friends';

export const FRIENDS_THROTTLE_MS = 60_000;

// ---- cache ---------------------------------------------------------------------------------------

export interface FriendsCache {
  share: string | null;
  list: FriendWeek[];
  from: ISODay;
  to: ISODay;
  fetchedAt: number;
}

const isDay = (v: unknown): v is ISODay => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The cached answer for this account, or null (no cache, bad shape, or someone else's). */
export function readFriendsCache(userId: string): FriendsCache | null {
  try {
    const v = JSON.parse(localStorage.getItem(FRIENDS_CACHE_KEY) ?? 'null') as Record<string, unknown> | null;
    if (typeof v !== 'object' || v === null || v.v !== 1 || v.userId !== userId) return null;
    const { from, to, fetchedAt } = v;
    if (!isDay(from) || !isDay(to) || from > to) return null;
    if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt) || fetchedAt < 0) return null;
    const share = v.share === null ? null : storedFriendCode(v.share);
    if (v.share !== null && share === null) return null;
    const list = parseFriendWeek(v.list, from, to);
    return list === null ? null : { share, list, from, to, fetchedAt };
  } catch {
    return null;
  }
}

export function writeFriendsCache(userId: string, c: FriendsCache): void {
  try {
    localStorage.setItem(FRIENDS_CACHE_KEY, JSON.stringify({ v: 1, userId, ...c }));
  } catch {
    /* storage unavailable: the next visit just asks the server */
  }
}

// ---- window --------------------------------------------------------------------------------------

/** The last 7 study days: 6 days ago through today. */
export function friendsWindow(now: number): { from: ISODay; to: ISODay } {
  const to = todayKey(now);
  return { from: addDays(to, -6), to };
}

// ---- fetching ------------------------------------------------------------------------------------

let inflight: Promise<void> | null = null;
let stubApi: Promise<FriendsApi> | null = null;

/** The engine's friends api, or the in-memory dev fixture under ?stub. Null when sync is not available. */
export async function friendsApi(): Promise<FriendsApi | null> {
  // Dev only, and written out here (not behind a function) so a production build drops the import.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('stub')) {
    return (stubApi ??= import('./friendsFixture').then((m) => m.stubFriendsApi()));
  }
  try {
    return (await core.loadSync())?.friends ?? null;
  } catch {
    return null;
  }
}

const userId = (): string | null => data.value.meta.sync.userId;

async function run(): Promise<void> {
  const g = friendsRunState.gen;
  const now = Date.now();
  const { from, to } = friendsWindow(now);
  const id = userId();
  if (friends.value.fetchedAt === null) {
    // First answer of this account on this device: paint the cache at once, then ask the server.
    const c = id === null ? null : readFriendsCache(id);
    friends.value = c
      ? { status: 'ready', share: c.share, list: c.list, fetchedAt: c.fetchedAt, error: null }
      : { ...friends.value, status: 'loading', error: null };
  }
  const api = await friendsApi();
  const [share, week] = api
    ? await Promise.all([api.getShare(), api.week(from, to)])
    : ([{ ok: false, error: 'unknown' }, { ok: false, error: 'unknown' }] as const);
  if (g !== friendsRunState.gen) return; // the account changed while we waited
  if (!share.ok || !week.ok) {
    const error = !week.ok ? week.error : !share.ok ? share.error : 'unknown';
    const status: FriendsStatus = error === 'offline' ? 'offline' : error === 'signed_out' ? 'signed-out' : 'error';
    friends.value = { ...friends.value, status, error };
    return;
  }
  friendsRunState.lastOkAt = now;
  friends.value = { status: 'ready', share: share.value, list: week.value, fetchedAt: now, error: null };
  if (id !== null) writeFriendsCache(id, { share: share.value, list: week.value, from, to, fetchedAt: now });
}

/** See `refreshFriends` in app/friends.ts. */
export function refresh(opts: { force?: boolean } = {}): Promise<void> {
  if (!isSyncConfigured(readSyncEnv()) && !(import.meta.env.DEV && location.search.includes('stub'))) {
    return Promise.resolve();
  }
  const s = friends.value.status;
  if (s === 'off' || s === 'signed-out') return Promise.resolve();
  if (inflight) return opts.force ? inflight.then(() => refresh(opts)) : inflight;
  if (!opts.force && Date.now() - friendsRunState.lastOkAt < FRIENDS_THROTTLE_MS) return Promise.resolve();
  inflight = run()
    .catch(() => {
      friends.value = { ...friends.value, status: 'error', error: 'unknown' };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
