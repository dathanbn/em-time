import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from '../storage/persist';
import { createDefaultData } from '../store/defaults';
import { createStore, type StoreInternals } from '../store/store';
import type { EmStore, SyncDeps } from '../api';
import { createSyncEngine, type FriendWeek, type FriendsResult } from './engine';
import { createFakeServer, fakeFactory, type FakeServer } from './fakeSupabase';

const ENV = { url: 'https://svbpsgllxlcjgkrlagrp.supabase.co', anonKey: 'sb_publishable_test' };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const CLOCK = Date.UTC(2026, 9, 17, 18, 0, 0);

function makeUser(server: FakeServer, name: string) {
  const flags = { online: true };
  const store = createStore({
    data: createDefaultData(CLOCK, `de71ce00-0000-4000-8000-${String(server.users.size + 1).padStart(12, '0')}`),
    adapter: createMemoryAdapter(),
    now: () => CLOCK,
  }) as EmStore & StoreInternals;
  const deps: SyncDeps = {
    now: () => CLOCK,
    setTimeout: () => ({}), // no retries or debounce in these tests
    clearTimeout: () => undefined,
    isOnline: () => flags.online,
    onOnline: () => () => undefined,
    onVisible: () => () => undefined,
    isVisible: () => true,
  };
  const f = fakeFactory(server);
  const engine = createSyncEngine({ store, env: ENV, createClient: f.factory, deps });
  const fc = f.clients[0]!;
  const signIn = async () => {
    const r = await engine.signInWithCode(`${name} secret code`);
    expect(r).toEqual({ ok: true });
    await flush();
  };
  const uid = () => store.get().meta.sync.userId!;
  return { store, engine, fc, flags, signIn, uid, friends: engine.friends, name };
}
type User = ReturnType<typeof makeUser>;

const rpcCalls = (server: FakeServer) => server.log.filter((o) => o.kind === 'rpc');

async function setup(names = ['ann', 'bo', 'cy']) {
  const server = createFakeServer();
  const users: Record<string, User> = {};
  for (const n of names) {
    users[n] = makeUser(server, n);
    await users[n]!.signIn();
  }
  return { server, users, u: (n: string) => users[n]! };
}

const ok = <T>(r: FriendsResult<T>): T => {
  expect(r.ok).toBe(true);
  return (r as { ok: true; value: T }).value;
};

/** A session row on the fake server, as the sync would have pushed it. */
function putSession(server: FakeServer, uid: string, day: string, focusedMs: number, deleted = false, n = Math.random()) {
  server.tables.sessions.set(`${uid}|${n}`, {
    user_id: uid,
    id: String(n),
    day,
    focused_ms: focusedMs,
    planned_ms: 25 * 60_000,
    deleted_at: deleted ? 5 : null,
    updated_at: 1,
    server_updated_at: new Date(0).toISOString(),
  });
}
const putName = (server: FakeServer, uid: string, displayName: unknown) =>
  server.tables.settings.set(uid, {
    user_id: uid,
    data: { displayName },
    updated_at: 1,
    server_updated_at: new Date(0).toISOString(),
  });

describe('friends api: signed out and error classes', () => {
  it('signed out: every call answers signed_out and sends nothing', async () => {
    const server = createFakeServer();
    const a = makeUser(server, 'ann');
    await flush();
    const f = a.friends;
    const code = 'K7QP2MXD';
    expect(await f.getShare()).toEqual({ ok: false, error: 'signed_out' });
    expect(await f.enableShare()).toEqual({ ok: false, error: 'signed_out' });
    expect(await f.rotateShare()).toEqual({ ok: false, error: 'signed_out' });
    expect(await f.disableShare()).toEqual({ ok: false, error: 'signed_out' });
    expect(await f.add(code)).toEqual({ ok: false, error: 'signed_out' });
    expect(await f.rename(code, 'x')).toEqual({ ok: false, error: 'signed_out' });
    expect(await f.remove(code)).toEqual({ ok: false, error: 'signed_out' });
    expect(await f.week('2026-10-11', '2026-10-17')).toEqual({ ok: false, error: 'signed_out' });
    expect(rpcCalls(server)).toHaveLength(0);
  });

  it('offline: answers offline without a request', async () => {
    const { server, u } = await setup(['ann']);
    u('ann').flags.online = false;
    expect(await u('ann').friends.getShare()).toEqual({ ok: false, error: 'offline' });
    expect(await u('ann').friends.add('K7QP2MXD')).toEqual({ ok: false, error: 'offline' });
    expect(rpcCalls(server)).toHaveLength(0);
  });

  it('a network failure inside the call is offline, a 401 or JWT error is auth-expired, anything else unknown', async () => {
    const { server, u } = await setup(['ann']);
    const f = u('ann').friends;
    server.failWhen = (op) => (op.kind === 'rpc' ? new TypeError('Failed to fetch') : null);
    expect(await f.getShare()).toEqual({ ok: false, error: 'offline' });
    server.failWhen = (op) => (op.kind === 'rpc' ? { message: 'TypeError: Failed to fetch' } : null);
    expect(await f.getShare()).toEqual({ ok: false, error: 'offline' });
    server.failWhen = (op) => (op.kind === 'rpc' ? { message: 'JWT expired', code: 'PGRST301' } : null);
    expect(await f.getShare()).toEqual({ ok: false, error: 'auth-expired' });
    server.failWhen = (op) => (op.kind === 'rpc' ? { message: 'x', code: '42501' } : null);
    expect(await f.enableShare()).toEqual({ ok: false, error: 'auth-expired' });
    server.failWhen = (op) => (op.kind === 'rpc' ? { message: 'boom', code: '500' } : null);
    expect(await f.getShare()).toEqual({ ok: false, error: 'unknown' });
    server.failWhen = (op) => (op.kind === 'rpc' ? new Error('weird') : null);
    expect(await f.getShare()).toEqual({ ok: false, error: 'unknown' });
    server.failWhen = null;
    expect(await f.getShare()).toEqual({ ok: true, value: null });
  });

  it('a session the server no longer accepts reads as auth-expired (not signed in, 42501)', async () => {
    const { u } = await setup(['ann']);
    u('ann').fc.setSession(null); // the token is gone, the store still says signed in
    expect(await u('ann').friends.getShare()).toEqual({ ok: false, error: 'auth-expired' });
  });

  it('when the sync engine is already auth-expired no request is made', async () => {
    const { server, u } = await setup(['ann']);
    u('ann').fc.setSession(null);
    await u('ann').engine.syncNow();
    await flush();
    expect(u('ann').engine.state().status).toBe('auth-expired');
    const before = rpcCalls(server).length;
    expect(await u('ann').friends.getShare()).toEqual({ ok: false, error: 'auth-expired' });
    expect(rpcCalls(server)).toHaveLength(before);
  });

  it('never throws, even when the client throws or returns junk', async () => {
    const { u } = await setup(['ann']);
    const f = u('ann').friends;
    type Rpc = typeof u extends (n: string) => infer U ? (U extends { fc: { client: { rpc: infer R } } } ? R : never) : never;
    u('ann').fc.client.rpc = (() => {
      throw new Error('sync throw');
    }) as Rpc;
    expect(await f.getShare()).toEqual({ ok: false, error: 'unknown' });
    u('ann').fc.client.rpc = (async () => ({ data: 42, error: null })) as Rpc;
    expect(await f.enableShare()).toEqual({ ok: false, error: 'unknown' });
    expect(await f.getShare()).toEqual({ ok: false, error: 'unknown' });
    expect(await f.add('K7QP2MXD')).toEqual({ ok: false, error: 'unknown' });
    expect(await f.week('2026-10-11', '2026-10-17')).toEqual({ ok: false, error: 'unknown' });
  });
});

describe('friends api: my share code', () => {
  it('enable gives a code once, rotate replaces it, disable removes it', async () => {
    const { server, u } = await setup(['ann']);
    const f = u('ann').friends;
    expect(ok(await f.getShare())).toBeNull();
    const first = ok(await f.enableShare());
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(ok(await f.enableShare())).toBe(first);
    expect(ok(await f.getShare())).toBe(first);
    const second = ok(await f.rotateShare());
    expect(second).not.toBe(first);
    expect(ok(await f.getShare())).toBe(second);
    expect(await f.disableShare()).toEqual({ ok: true, value: null });
    expect(ok(await f.getShare())).toBeNull();
    // rotate with no share creates one
    expect(ok(await f.rotateShare())).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(server.shares.size).toBe(1);
  });

  it('a malformed code from the server is an unknown error, not a value', async () => {
    const { server, u } = await setup(['ann']);
    server.newCode = () => 'not a code';
    expect(await u('ann').friends.enableShare()).toEqual({ ok: false, error: 'unknown' });
  });

  it('the request carries no sync code, email or password', async () => {
    const { server, u } = await setup(['ann']);
    await u('ann').friends.enableShare();
    await u('ann').friends.add('FAKE0099', 'x');
    await u('ann').friends.week('2026-10-11', '2026-10-17');
    const text = JSON.stringify(rpcCalls(server));
    expect(text).not.toMatch(/secret|dathanbn|password|@/);
  });
});

describe('friends api: add, rename, remove', () => {
  async function two() {
    const ctx = await setup(['ann', 'bo', 'cy']);
    const codes = {
      ann: ok(await ctx.u('ann').friends.enableShare()),
      bo: ok(await ctx.u('bo').friends.enableShare()),
      cy: ok(await ctx.u('cy').friends.enableShare()),
    };
    return { ...ctx, codes };
  }

  it('invalid codes are refused before any request', async () => {
    const { server, u } = await two();
    const before = rpcCalls(server).length;
    for (const bad of ['', 'abc', 'UUUUUUUU', 'K7QP2MXDD', '----']) {
      expect(await u('ann').friends.add(bad)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(rpcCalls(server)).toHaveLength(before);
  });

  it('own code, unknown code, duplicate', async () => {
    const { u, codes } = await two();
    const f = u('ann').friends;
    expect(await f.add(codes.ann)).toEqual({ ok: false, error: 'own_code' });
    expect(await f.add('ZZZZZZZZ')).toEqual({ ok: false, error: 'not_found' });
    expect(await f.add(codes.bo)).toEqual({ ok: true });
    expect(await f.add(codes.bo)).toEqual({ ok: false, error: 'duplicate' });
  });

  it('the app normalizes before sending: dashes, case and look-alikes reach the server as the stored code', async () => {
    const { server, u } = await two();
    server.shares.set(u('cy').uid(), { code: '10100ZZZ', createdAt: 0 });
    expect(await u('ann').friends.add('lolo-ozzz')).toEqual({ ok: true });
    const call = rpcCalls(server).filter((o) => o.fn === 'em_friend_add').pop()!;
    expect(call.args).toEqual({ p_code: '10100ZZZ', p_nickname: null });
  });

  it('the server normalizes too (a raw call with a messy code)', async () => {
    const { server, u } = await two();
    server.shares.set(u('cy').uid(), { code: '10100ZZZ', createdAt: 0 });
    const r = await u('ann').fc.client.rpc('em_friend_add', { p_code: ' lolo ozzz ', p_nickname: null });
    expect(r.data).toBe('ok');
    expect((await u('ann').fc.client.rpc('em_friend_add', { p_code: '10100zzz', p_nickname: null })).data).toBe('duplicate');
  });

  it('colors are the lowest free 1..5, a removed friend frees theirs, the limit is 5', async () => {
    const { server, u, codes } = await two();
    const extra: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const code = `EXTRA00${i}`.slice(0, 8);
      server.shares.set(`other-${i}`, { code, createdAt: 0 });
      extra.push(code);
    }
    const f = u('ann').friends;
    expect(await f.add(codes.bo)).toEqual({ ok: true });
    expect(await f.add(codes.cy)).toEqual({ ok: true });
    for (const c of extra.slice(0, 3)) expect(await f.add(c)).toEqual({ ok: true });
    expect(await f.add(extra[3]!)).toEqual({ ok: false, error: 'limit' });
    let week = ok(await f.week('2026-10-11', '2026-10-17'));
    expect(week.map((w) => w.color)).toEqual([1, 2, 3, 4, 5]);
    expect(await f.remove(codes.cy)).toEqual({ ok: true, value: null }); // frees color 2
    expect(await f.add(extra[3]!)).toEqual({ ok: true });
    week = ok(await f.week('2026-10-11', '2026-10-17'));
    expect(week.map((w) => [w.code, w.color])).toEqual([
      [codes.bo, 1],
      [extra[0], 3],
      [extra[1], 4],
      [extra[2], 5],
      [extra[3], 2],
    ]);
  });

  it('nicknames: trimmed, empty is none, cut to 24 code points; rename follows the same rules', async () => {
    const { u, codes } = await two();
    const f = u('ann').friends;
    await f.add(codes.bo, '   Bo the great  ');
    await f.add(codes.cy, '😀'.repeat(30));
    let week = ok(await f.week('2026-10-11', '2026-10-17'));
    expect(week[0]!.nickname).toBe('Bo the great');
    expect(Array.from(week[1]!.nickname!)).toHaveLength(24);
    await f.rename(codes.bo, '  Bobby ');
    await f.rename(codes.cy, '   ');
    week = ok(await f.week('2026-10-11', '2026-10-17'));
    expect(week[0]!.nickname).toBe('Bobby');
    expect(week[1]!.nickname).toBeNull();
    // unknown or invalid codes: no change, no throw
    expect(await f.rename('ZZZZZZZZ', 'x')).toEqual({ ok: true, value: null });
    expect((await f.rename('nope', 'x')).ok).toBe(false);
    expect((await f.remove('nope')).ok).toBe(false);
  });

  it('every call has its own list: another user sees none of it', async () => {
    const { u, codes } = await two();
    await u('ann').friends.add(codes.bo);
    expect(ok(await u('bo').friends.week('2026-10-11', '2026-10-17'))).toEqual([]);
  });
});

describe('friends api: week', () => {
  it('sums a friend\'s focused ms per study day inside the window, skipping deleted sessions', async () => {
    const { server, u } = await setup(['ann', 'bo']);
    const code = ok(await u('bo').friends.enableShare());
    await u('ann').friends.add(code, 'B');
    putName(server, u('bo').uid(), 'Bo');
    const bo = u('bo').uid();
    putSession(server, bo, '2026-10-11', 25 * 60_000); // first day of the window
    putSession(server, bo, '2026-10-11', 10 * 60_000);
    putSession(server, bo, '2026-10-13', 20 * 60_000, true); // deleted
    putSession(server, bo, '2026-10-17', 5 * 60_000); // last day
    putSession(server, bo, '2026-10-10', 25 * 60_000); // before the window
    putSession(server, bo, '2026-10-18', 25 * 60_000); // after the window
    putSession(server, u('ann').uid(), '2026-10-12', 99 * 60_000); // mine, never part of the answer
    const week = ok(await u('ann').friends.week('2026-10-11', '2026-10-17'));
    expect(week).toEqual<FriendWeek[]>([
      {
        code,
        nickname: 'B',
        displayName: 'Bo',
        color: 1,
        active: true,
        days: { '2026-10-11': 35 * 60_000, '2026-10-17': 5 * 60_000 },
      },
    ]);
  });

  it('is in the order friends were added', async () => {
    const { u } = await setup(['ann', 'bo', 'cy']);
    const cy = ok(await u('cy').friends.enableShare());
    const bo = ok(await u('bo').friends.enableShare());
    await u('ann').friends.add(cy);
    await u('ann').friends.add(bo);
    expect(ok(await u('ann').friends.week('2026-10-11', '2026-10-17')).map((w) => w.code)).toEqual([cy, bo]);
  });

  it('a friend turning sharing off or rotating the code goes inactive: no name, no minutes', async () => {
    const { server, u } = await setup(['ann', 'bo']);
    const first = ok(await u('bo').friends.enableShare());
    await u('ann').friends.add(first);
    putName(server, u('bo').uid(), 'Bo');
    putSession(server, u('bo').uid(), '2026-10-15', 30 * 60_000);
    expect(ok(await u('ann').friends.week('2026-10-11', '2026-10-17'))[0]).toMatchObject({ active: true, displayName: 'Bo' });
    const second = ok(await u('bo').friends.rotateShare());
    let w = ok(await u('ann').friends.week('2026-10-11', '2026-10-17'))[0]!;
    expect(w).toEqual({ code: first, nickname: null, displayName: null, color: 1, active: false, days: {} });
    // the new code is a different friend, the old link stays dead
    expect(await u('ann').friends.add(second)).toEqual({ ok: true });
    await u('bo').friends.disableShare();
    w = ok(await u('ann').friends.week('2026-10-11', '2026-10-17'))[1]!;
    expect(w).toMatchObject({ code: second, active: false, days: {}, displayName: null });
    // and back on: the old link is still dead (a new code)
    const third = ok(await u('bo').friends.enableShare());
    expect(third).not.toBe(first);
    expect(ok(await u('ann').friends.week('2026-10-11', '2026-10-17')).every((x) => !x.active || x.code === third)).toBe(true);
  });

  it('a friend with no settings row has no display name', async () => {
    const { u } = await setup(['ann', 'bo']);
    await u('ann').friends.add(ok(await u('bo').friends.enableShare()));
    expect(ok(await u('ann').friends.week('2026-10-11', '2026-10-17'))[0]!.displayName).toBeNull();
  });

  it('two users who add each other see each other, and only the other', async () => {
    const { server, u } = await setup(['ann', 'bo']);
    const a = ok(await u('ann').friends.enableShare());
    const b = ok(await u('bo').friends.enableShare());
    await u('ann').friends.add(b);
    await u('bo').friends.add(a);
    putSession(server, u('ann').uid(), '2026-10-16', 11 * 60_000);
    putSession(server, u('bo').uid(), '2026-10-16', 22 * 60_000);
    expect(ok(await u('ann').friends.week('2026-10-11', '2026-10-17'))[0]!.days).toEqual({ '2026-10-16': 22 * 60_000 });
    expect(ok(await u('bo').friends.week('2026-10-11', '2026-10-17'))[0]!.days).toEqual({ '2026-10-16': 11 * 60_000 });
  });

  it('window rules: 1 to 14 days; anything else is refused locally and by the server', async () => {
    const { server, u } = await setup(['ann']);
    const f = u('ann').friends;
    expect((await f.week('2026-10-17', '2026-10-17')).ok).toBe(true);
    expect((await f.week('2026-10-04', '2026-10-17')).ok).toBe(true); // 14 days
    const before = rpcCalls(server).length;
    expect(await f.week('2026-10-03', '2026-10-17')).toEqual({ ok: false, error: 'unknown' }); // 15 days
    expect(await f.week('2026-10-17', '2026-10-16')).toEqual({ ok: false, error: 'unknown' });
    expect(await f.week('bad', '2026-10-16')).toEqual({ ok: false, error: 'unknown' });
    expect(rpcCalls(server)).toHaveLength(before);
    const raw = await u('ann').fc.client.rpc('em_friends_week', { p_from: '2026-10-01', p_to: '2026-10-17' });
    expect(raw.error?.code).toBe('22023');
  });

  it('validates the jsonb defensively: drops malformed entries, clamps ms, drops bad and out-of-window days', async () => {
    const { u } = await setup(['ann']);
    const good = (over: object = {}) => ({
      code: 'K7QP2MXD',
      nickname: 'Cathy',
      displayName: 'Cat',
      color: 2,
      active: true,
      days: { '2026-10-15': 600_000 },
      ...over,
    });
    const respond = (data: unknown) => {
      const orig = u('ann').fc.client.rpc;
      u('ann').fc.client.rpc = (async (fn: string, args?: object) =>
        fn === 'em_friends_week' ? { data, error: null } : orig(fn, args)) as typeof orig;
    };
    respond([
      good(),
      null,
      'str',
      good({ code: 'short' }),
      good({ code: 'k7qp2mxd' }), // not canonical
      good({ code: 'ABCD0123', color: 6 }),
      good({ code: 'ABCD0124', color: 1.5 }),
      good({ code: 'ABCD0125', color: '2' }),
      good({ code: 'ABCD0126', active: 'yes' }),
      good({ code: 'K7QP2MXD' }), // duplicate code
      good({
        code: 'ABCD0127',
        color: 3,
        nickname: '   ',
        displayName: 42,
        days: {
          '2026-10-15': -5,
          '2026-10-16': '5',
          '2026-10-17': 90_000.4,
          '2026-10-18': 1, // after the window
          '2026-10-10': 1, // before the window
          '2026-02-30': 1, // not a date
          nope: 1,
          '2026-10-14': Number.NaN,
        },
      }),
    ]);
    const week = ok(await u('ann').friends.week('2026-10-11', '2026-10-17'));
    expect(week).toEqual<FriendWeek[]>([
      { code: 'K7QP2MXD', nickname: 'Cathy', displayName: 'Cat', color: 2, active: true, days: { '2026-10-15': 600_000 } },
      { code: 'ABCD0127', nickname: null, displayName: null, color: 3, active: true, days: { '2026-10-15': 0, '2026-10-17': 90_000 } },
    ]);
    respond({ not: 'an array' });
    expect(await u('ann').friends.week('2026-10-11', '2026-10-17')).toEqual({ ok: false, error: 'unknown' });
    respond(null);
    expect(await u('ann').friends.week('2026-10-11', '2026-10-17')).toEqual({ ok: false, error: 'unknown' });
  });

  it('clips long names, ignores days of an inactive friend and never returns more than 5 friends', async () => {
    const { u } = await setup(['ann']);
    const entry = (i: number, over: object = {}) => ({
      code: `ABCD012${i}`,
      nickname: 'n'.repeat(40),
      displayName: 'd'.repeat(40),
      color: (i % 5) + 1,
      active: true,
      days: {},
      ...over,
    });
    const orig = u('ann').fc.client.rpc;
    u('ann').fc.client.rpc = (async (fn: string, args?: object) =>
      fn === 'em_friends_week'
        ? { data: [0, 1, 2, 3, 4, 5, 6].map((i) => (i === 1 ? entry(i, { active: false, days: { '2026-10-15': 5 } }) : entry(i))), error: null }
        : orig(fn, args)) as typeof orig;
    const week = ok(await u('ann').friends.week('2026-10-11', '2026-10-17'));
    expect(week).toHaveLength(5);
    expect(week[0]!.nickname).toHaveLength(24);
    expect(week[0]!.displayName).toHaveLength(24);
    expect(week[1]).toMatchObject({ active: false, days: {}, displayName: null });
  });
});
