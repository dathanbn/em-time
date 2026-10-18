import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FriendWeek, FriendsApi, FriendsResult } from '@core';

const KEY = 'em-time:friends-cache';
const NOW = new Date('2026-10-17T12:00:00-07:00').getTime();
const USER = '9f1c2b3a-4d5e-4f60-8a7b-000000000001';

const hoisted = vi.hoisted(() => ({ api: null as unknown, loads: 0 }));
vi.mock('./coreBridge', async () => {
  const { signal } = await import('@preact/signals');
  return {
    data: signal({ meta: { sync: { userId: null as string | null } } }),
    core: {
      loadSync: async () => {
        hoisted.loads += 1;
        return hoisted.api ? { friends: hoisted.api } : null;
      },
    },
  };
});

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    api: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  };
}

const entry = (over: Partial<FriendWeek> = {}): FriendWeek => ({
  code: 'K7QP2MXD',
  nickname: 'Cathy',
  displayName: 'Cat',
  color: 1,
  active: true,
  days: { '2026-10-16': 600_000 },
  ...over,
});

interface Calls {
  share: number;
  week: Array<[string, string]>;
}
function makeApi(over: Partial<FriendsApi> = {}): { api: FriendsApi; calls: Calls } {
  const calls: Calls = { share: 0, week: [] };
  const never = () => Promise.resolve({ ok: false, error: 'unknown' } as const);
  const api: FriendsApi = {
    getShare: async () => (calls.share++, { ok: true, value: 'ABCD1234' }),
    enableShare: never,
    rotateShare: never,
    disableShare: never,
    add: never,
    rename: never,
    remove: never,
    week: async (from, to) => (calls.week.push([from, to]), { ok: true, value: [entry()] }),
    ...over,
  };
  hoisted.api = api;
  return { api, calls };
}

/** A fresh set of modules per test; sync is configured unless `env` is false. */
async function load(opts: { env?: boolean; stored?: Record<string, string>; userId?: string | null } = {}) {
  vi.resetModules();
  hoisted.loads = 0;
  if (opts.env !== false) {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://qa-fake.example.test');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'k');
  } else {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  }
  const store = fakeStorage(opts.stored);
  vi.stubGlobal('localStorage', store.api);
  vi.stubGlobal('location', { search: '' });
  const bridge = (await import('./coreBridge')) as unknown as {
    data: { value: { meta: { sync: { userId: string | null } } } };
  };
  bridge.data.value = { meta: { sync: { userId: opts.userId === undefined ? USER : opts.userId } } };
  const f = await import('./friends');
  const run = await import('./friendsRun');
  f.initFriends();
  return { f, run, store, bridge };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('friends state (app/friends.ts)', () => {
  it('is off when sync is not configured: nothing to load, nothing requested', async () => {
    makeApi();
    const { f } = await load({ env: false });
    expect(f.friends.value.status).toBe('off');
    await f.refreshFriends({ force: true });
    expect(hoisted.loads).toBe(0);
    expect(f.friends.value.status).toBe('off');
  });

  it('is signed-out without an account, and clears the cache', async () => {
    const { f, store } = await load({ userId: null, stored: { [KEY]: '{"v":1}' } });
    expect(f.friends.value).toEqual({ status: 'signed-out', share: null, list: [], fetchedAt: null, error: null });
    expect(store.m.has(KEY)).toBe(false);
    await f.refreshFriends({ force: true });
    expect(hoisted.loads).toBe(0);
  });

  it('a signed-in account starts as loading and the first refresh fills it and writes the cache', async () => {
    const { calls } = makeApi();
    const { f, store } = await load();
    expect(f.friends.value.status).toBe('loading');
    await f.refreshFriends();
    expect(calls.week).toEqual([['2026-10-11', '2026-10-17']]);
    expect(f.friends.value).toEqual({ status: 'ready', share: 'ABCD1234', list: [entry()], fetchedAt: NOW, error: null });
    const cached = JSON.parse(store.m.get(KEY)!);
    expect(cached).toMatchObject({ v: 1, userId: USER, share: 'ABCD1234', from: '2026-10-11', to: '2026-10-17', fetchedAt: NOW });
    expect(cached.list).toEqual([entry()]);
  });

  it('shows the cache at once, then refreshes (the cached list is on screen while the server answers)', async () => {
    const cache = { v: 1, userId: USER, share: 'ABCD1234', list: [entry()], from: '2026-10-11', to: '2026-10-17', fetchedAt: NOW - 7_200_000 };
    let release!: (r: FriendsResult<FriendWeek[]>) => void;
    makeApi({ week: () => new Promise((r) => (release = r)) });
    const { f } = await load({ stored: { [KEY]: JSON.stringify(cache) } });
    const p = f.refreshFriends();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(f.friends.value.status).toBe('ready'));
    expect(f.friends.value).toMatchObject({ status: 'ready', fetchedAt: NOW - 7_200_000, list: [entry()] });
    release({ ok: true, value: [entry({ days: { '2026-10-17': 5 * 60_000 } })] });
    await p;
    expect(f.friends.value.fetchedAt).toBe(NOW);
    expect(f.friends.value.list[0]!.days).toEqual({ '2026-10-17': 300_000 });
  });

  describe('cache validation', () => {
    const good = { v: 1, userId: USER, share: null, list: [entry()], from: '2026-10-11', to: '2026-10-17', fetchedAt: NOW };
    const read = async (raw: unknown, user = USER) => {
      const { run } = await load({ stored: { [KEY]: typeof raw === 'string' ? raw : JSON.stringify(raw) } });
      return run.readFriendsCache(user);
    };
    it('accepts a good cache', async () => {
      expect(await read(good)).toEqual({ share: null, list: [entry()], from: '2026-10-11', to: '2026-10-17', fetchedAt: NOW });
    });
    it('ignores a cache from a different account', async () => {
      expect(await read(good, '00000000-0000-4000-8000-000000000009')).toBeNull();
    });
    it.each([
      ['not json', 'nope{'],
      ['null', 'null'],
      ['an array', '[]'],
      ['another version', { ...good, v: 2 }],
      ['no user', { ...good, userId: undefined }],
      ['a bad share code', { ...good, share: 'abc' }],
      ['a number as share', { ...good, share: 5 }],
      ['reversed window', { ...good, from: '2026-10-17', to: '2026-10-11' }],
      ['a bad day', { ...good, from: '2026-13-01' }],
      ['a text timestamp', { ...good, fetchedAt: 'now' }],
      ['a negative timestamp', { ...good, fetchedAt: -1 }],
      ['no list', { ...good, list: undefined }],
      ['a list that is not an array', { ...good, list: {} }],
    ])('ignores %s', async (_n, raw) => {
      expect(await read(raw)).toBeNull();
    });
    it('keeps the good entries of a damaged list and clamps what it can', async () => {
      const c = await read({
        ...good,
        list: [entry({ days: { '2026-10-16': -5 } }), { code: 'bad' }, null, entry({ code: 'ABCD0123', color: 9 as never })],
      });
      expect(c!.list).toEqual([entry({ days: { '2026-10-16': 0 } })]);
    });
    it('a storage that throws reads as no cache', async () => {
      const { run } = await load();
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      });
      expect(run.readFriendsCache(USER)).toBeNull();
      expect(() => run.writeFriendsCache(USER, { share: null, list: [], from: 'a', to: 'b', fetchedAt: 1 })).not.toThrow();
    });
  });

  describe('throttle', () => {
    it('asks once a minute unless forced', async () => {
      const { calls } = makeApi();
      const { f } = await load();
      await f.refreshFriends();
      await f.refreshFriends();
      await f.refreshFriends();
      expect(calls.week).toHaveLength(1);
      await f.refreshFriends({ force: true });
      expect(calls.week).toHaveLength(2);
      vi.setSystemTime(NOW + 59_000);
      await f.refreshFriends();
      expect(calls.week).toHaveLength(2);
      vi.setSystemTime(NOW + 61_000);
      await f.refreshFriends();
      expect(calls.week).toHaveLength(3);
    });

    it('one request pair at a time: callers share the running one, a forced call runs again after it', async () => {
      let release!: (r: FriendsResult<FriendWeek[]>) => void;
      let n = 0;
      const { calls } = makeApi({
        week: () => {
          n += 1;
          return n === 1 ? new Promise((r) => (release = r)) : Promise.resolve({ ok: true as const, value: [entry({ nickname: `v${n}` })] });
        },
      });
      const { f } = await load();
      const a = f.refreshFriends();
      const b = f.refreshFriends();
      const c = f.refreshFriends({ force: true });
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(typeof release).toBe('function'));
      release({ ok: true, value: [entry({ nickname: 'v1' })] });
      await Promise.all([a, b, c]);
      expect(n).toBe(2);
      expect(calls.share).toBe(2);
      expect(f.friends.value.list[0]!.nickname).toBe('v2');
    });

    it('uses the study day: before 6 AM the window still ends on the previous day', async () => {
      const { run } = await load();
      expect(run.friendsWindow(new Date('2026-10-17T03:00:00-07:00').getTime())).toEqual({ from: '2026-10-10', to: '2026-10-16' });
      expect(run.friendsWindow(new Date('2026-10-17T06:00:00-07:00').getTime())).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    });
  });

  describe('failures', () => {
    it('offline keeps what was shown, notes why, and a later success recovers', async () => {
      let fail: 'offline' | 'auth-expired' | 'unknown' | null = null;
      makeApi({
        week: async () => (fail ? { ok: false, error: fail } : { ok: true, value: [entry()] }),
      });
      const { f } = await load();
      await f.refreshFriends();
      const before = f.friends.value;
      fail = 'offline';
      await f.refreshFriends({ force: true });
      expect(f.friends.value).toMatchObject({ status: 'offline', error: 'offline', fetchedAt: before.fetchedAt, list: before.list });
      fail = 'auth-expired';
      await f.refreshFriends({ force: true });
      expect(f.friends.value).toMatchObject({ status: 'error', error: 'auth-expired', list: before.list });
      fail = 'unknown';
      await f.refreshFriends({ force: true });
      expect(f.friends.value).toMatchObject({ status: 'error', error: 'unknown' });
      fail = null;
      await f.refreshFriends({ force: true });
      expect(f.friends.value).toMatchObject({ status: 'ready', error: null });
    });

    it('a failed first load is offline or error without data', async () => {
      makeApi({ week: async () => ({ ok: false, error: 'offline' }) });
      const { f } = await load();
      await f.refreshFriends();
      expect(f.friends.value).toMatchObject({ status: 'offline', fetchedAt: null, list: [] });
    });

    it('no engine (sync not available) is an error, never a throw', async () => {
      hoisted.api = null;
      const { f } = await load();
      await expect(f.refreshFriends()).resolves.toBeUndefined();
      expect(f.friends.value.status).toBe('error');
    });

    it('either request failing fails the refresh (and keeps the share I had)', async () => {
      makeApi({ getShare: async () => ({ ok: false, error: 'offline' }) });
      const { f } = await load();
      await f.refreshFriends();
      expect(f.friends.value.status).toBe('offline');
      expect(f.friends.value.list).toEqual([]);
    });
  });

  describe('account changes', () => {
    it('signing out resets to signed-out and wipes the cache; an answer in flight is dropped', async () => {
      let release!: (r: FriendsResult<FriendWeek[]>) => void;
      makeApi({ week: () => new Promise((r) => (release = r)) });
      const { f, store, bridge } = await load();
      store.m.set(KEY, '{"v":1}');
      const p = f.refreshFriends();
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(typeof release).toBe('function'));
      bridge.data.value = { meta: { sync: { userId: null } } };
      await vi.advanceTimersByTimeAsync(0);
      expect(f.friends.value.status).toBe('signed-out');
      expect(store.m.has(KEY)).toBe(false);
      release({ ok: true, value: [entry()] });
      await p;
      expect(f.friends.value.status).toBe('signed-out');
      expect(f.friends.value.list).toEqual([]);
      expect(store.m.has(KEY)).toBe(false);
    });

    it('clearFriends (Erase all data) forgets the cache and the list', async () => {
      makeApi();
      const { f, store } = await load();
      await f.refreshFriends();
      expect(store.m.has(KEY)).toBe(true);
      f.clearFriends();
      expect(store.m.has(KEY)).toBe(false);
      expect(f.friends.value.status).toBe('signed-out');
      expect(f.friends.value.list).toEqual([]);
    });

    it('clearFriends is just off when sync is not configured', async () => {
      const { f } = await load({ env: false });
      f.clearFriends();
      expect(f.friends.value.status).toBe('off');
    });
  });
});

describe('friends wording (app/friendsText.ts)', () => {
  it('names: nickname, then display name, then Friend N', async () => {
    const { friendName, agoText } = await import('./friendsText');
    expect(friendName(entry(), 0)).toBe('Cathy');
    expect(friendName(entry({ nickname: null }), 0)).toBe('Cat');
    expect(friendName(entry({ nickname: null, displayName: null }), 2)).toBe('Friend 3');
    expect(agoText(NOW - 10_000, NOW)).toBe('just now');
    expect(agoText(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(agoText(NOW - 2 * 3_600_000, NOW)).toBe('2 h ago');
    expect(agoText(NOW - 30 * 3_600_000, NOW)).toBe('Oct 16');
    expect(agoText(NOW + 5000, NOW)).toBe('just now');
  });
});
