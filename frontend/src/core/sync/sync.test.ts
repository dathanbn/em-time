import { describe, expect, it } from 'vitest';
import {
  AUTH_STORAGE_KEY,
  MIN,
  SYNC_BACKOFF_MAX_MS,
  SYNC_DEBOUNCE_MS,
  SYNC_MAX_WAIT_MS,
  SYNC_PULL_OVERLAP_MS,
} from '../constants';
import { createMemoryAdapter } from '../storage/persist';
import { createDefaultData, sessionId } from '../store/defaults';
import { createStore, type StoreInternals } from '../store/store';
import { TEST_COPY } from '../fixtures/test-copy';
import type { EmStore, SyncDeps } from '../api';
import type { Session } from '../types';
import { createEmCore } from '../core';
import { createSyncEngine } from './engine';
import { createFakeServer, fakeFactory, type FakeServer } from './fakeSupabase';

const ENV = { url: 'https://svbpsgllxlcjgkrlagrp.supabase.co', anonKey: 'sb_publishable_test' };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface Timer {
  at: number;
  fn: () => void;
}

function makeDevice(server: FakeServer, deviceId: string, clock: { now: number }) {
  const store = createStore({
    data: createDefaultData(clock.now, deviceId),
    adapter: createMemoryAdapter(),
    now: () => clock.now,
  }) as EmStore & StoreInternals;
  const timers: Timer[] = [];
  const handlers = { online: new Set<() => void>(), visible: new Set<() => void>() };
  const flags = { online: true };
  const deps: SyncDeps = {
    now: () => clock.now,
    setTimeout: (fn, ms) => {
      const t = { at: clock.now + ms, fn };
      timers.push(t);
      return t;
    },
    clearTimeout: (h) => {
      const i = timers.indexOf(h as Timer);
      if (i >= 0) timers.splice(i, 1);
    },
    isOnline: () => flags.online,
    onOnline: (fn) => {
      handlers.online.add(fn);
      return () => handlers.online.delete(fn);
    },
    onVisible: (fn) => {
      handlers.visible.add(fn);
      return () => handlers.visible.delete(fn);
    },
    isVisible: () => true,
  };
  /** Moves the clock forward, firing due timers in order and letting async work settle. */
  const advance = async (ms: number) => {
    const end = clock.now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      clock.now = Math.max(clock.now, next.at);
      next.fn();
      await flush();
    }
    clock.now = end;
    await flush();
  };
  const f = fakeFactory(server);
  const engine = createSyncEngine({ store, env: ENV, createClient: f.factory, deps });
  const fc = f.clients[0]!;
  return { store, engine, fc, deps, timers, handlers, flags, advance, factory: f, deviceId };
}
type Device = ReturnType<typeof makeDevice>;

async function signIn(d: Device, code: string) {
  const r = await d.engine.signInWithCode(code);
  expect(r).toEqual({ ok: true });
  await d.advance(0); // lets the deferred SIGNED_IN event handler run
  await d.engine.syncNow();
}

const D1 = 'aaaaaaaa-0000-4000-8000-00000000000a';
const D2 = 'bbbbbbbb-0000-4000-8000-00000000000b';

function session(
  store: EmStore & StoreInternals,
  deviceId: string,
  startedAt: number,
  taskId: string | null = null,
): Session {
  const s: Session = {
    id: sessionId(deviceId, startedAt),
    startedAt,
    endedAt: startedAt + 25 * MIN,
    day: '2026-10-14',
    tzOffsetMin: -420,
    plannedMs: 25 * MIN,
    focusedMs: 25 * MIN,
    taskId,
    taskName: taskId ? 'Task' : null,
    categoryId: null,
    createdAt: startedAt + 25 * MIN,
    updatedAt: startedAt + 25 * MIN,
    deletedAt: null,
  };
  store.logSession(s);
  return s;
}

const serverRows = (server: FakeServer, table: 'categories' | 'tasks' | 'sessions' | 'settings') => [
  ...server.tables[table].values(),
];

describe('client setup', () => {
  it('creates the client with a persisted session and the em-time:auth key', () => {
    const server = createFakeServer();
    const d = makeDevice(server, D1, { now: 1_000_000 });
    expect(d.factory.calls).toHaveLength(1);
    expect(d.factory.calls[0]).toMatchObject({
      url: ENV.url,
      key: ENV.anonKey,
      options: {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: AUTH_STORAGE_KEY,
        },
      },
    });
    expect(d.engine.state().status).toBe('signed-out');
    d.engine.dispose();
  });
});

describe('push', () => {
  it('pushes dirty rows as snake_case rows with epoch-ms bigints and an ISO day', async () => {
    const clock = { now: Date.UTC(2026, 9, 14, 15, 0, 0) };
    const server = createFakeServer(clock.now);
    const d = makeDevice(server, D1, clock);
    const task = d.store.addTask({ name: 'Orgo' });
    session(d.store, D1, clock.now - 30 * MIN, task.id);
    await signIn(d, 'em-sync-code');

    const tasks = serverRows(server, 'tasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: task.id,
      name: 'Orgo',
      category_id: task.categoryId,
      done: false,
      done_at: null,
      sort_order: 0,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      deleted_at: null,
    });
    expect(tasks[0]!.user_id).toBe(d.fc.session()!.user.id);
    expect(serverRows(server, 'categories')).toHaveLength(5);
    const s = serverRows(server, 'sessions')[0]!;
    expect(s).toMatchObject({
      day: '2026-10-14',
      tz_offset_min: -420,
      planned_ms: 25 * MIN,
      focused_ms: 25 * MIN,
      task_id: task.id,
    });
    expect(typeof s.started_at).toBe('number');
    expect(d.store.takeDirty()).toEqual({ categories: [], tasks: [], sessions: [], settings: false });
    expect(d.engine.state()).toMatchObject({ status: 'idle', pending: 0, rejected: 0 });
    expect(d.engine.state().lastSyncedAt).toBe(clock.now);
    d.engine.dispose();
  });

  it('does not clear a row that changed while its push was in flight', async () => {
    const server = createFakeServer();
    const clock = { now: 10_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    const t = d.store.addTask({ name: 'First' });
    let release!: () => void;
    server.gate = new Promise<void>((r) => (release = r));
    d.store.updateTask(t.id, { name: 'Draft' }); // dirty again
    const run = d.engine.syncNow();
    await flush();
    clock.now += 5;
    d.store.updateTask(t.id, { name: 'Final' }); // edited mid-flight
    server.gate = null;
    release();
    await run;
    // the first run pushed 'Draft'; 'Final' is still pending and a follow-up run (debounce) sends it
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    expect(serverRows(server, 'tasks')[0]!.name).toBe('Final');
    expect(d.store.takeDirty().tasks).toEqual([]);
    d.engine.dispose();
  });

  it('syncs settings as one jsonb object holding only the synced keys', async () => {
    const server = createFakeServer();
    const clock = { now: 20_000_000 };
    const a = makeDevice(server, D1, clock);
    await signIn(a, 'em-sync-code');
    // seeded defaults (updatedAt 0) never reach the server
    expect(serverRows(server, 'settings')).toHaveLength(0);
    clock.now += 100;
    a.store.updateSettings({
      dailyGoalMin: 90,
      autoStart: false,
      theme: 'dark',
      volume: 0.2,
      weekStartsOn: 0,
    });
    await a.advance(SYNC_DEBOUNCE_MS + 10);
    const row = serverRows(server, 'settings')[0]!;
    expect(row.updated_at).toBe(a.store.get().settings.updatedAt);
    expect(row.data).toEqual({
      preset: '25/5',
      focusMin: 25,
      shortMin: 5,
      longMin: 15,
      longEvery: 4,
      autoStart: false,
      dailyGoalMin: 90,
      weekStartsOn: 0,
      breakPrompts: true,
      encouragement: true,
      displayName: 'Em',
    });
    expect(row.data).not.toHaveProperty('theme');
    expect(row.data).not.toHaveProperty('mascot');
    expect(row.data).not.toHaveProperty('stickers');

    const b = makeDevice(server, D2, clock);
    b.store.updateSettings({ theme: 'dark', chime: 'bell' });
    await signIn(b, 'em-sync-code');
    expect(b.store.get().settings).toMatchObject({
      dailyGoalMin: 90,
      autoStart: false,
      weekStartsOn: 0,
      theme: 'dark',
      chime: 'bell',
    });
    expect(b.store.get().settings.updatedAt).toBe(row.updated_at);
    a.engine.dispose();
    b.engine.dispose();
  });
});

describe('pull', () => {
  async function seeded() {
    const server = createFakeServer();
    const clock = { now: 50_000_000 };
    const a = makeDevice(server, D1, clock);
    const b = makeDevice(server, D2, clock);
    return { server, clock, a, b };
  }

  it('applies newer rows, ignores older ones, and tombstones win', async () => {
    const { server, clock, a, b } = await seeded();
    const t1 = a.store.addTask({ name: 'Shared' });
    clock.now += 10;
    const t2 = a.store.addTask({ name: 'Other' });
    await signIn(a, 'em-sync-code');
    await signIn(b, 'em-sync-code');
    expect(
      b.store
        .get()
        .tasks.map((t) => t.name)
        .sort(),
    ).toEqual(['Other', 'Shared']);

    // B edits t1 later (wins); A edits t2 earlier than B's copy would (loses)
    clock.now += 1000;
    b.store.updateTask(t1.id, { name: 'Shared v2' });
    const bStamp = b.store.get().tasks.find((t) => t.id === t1.id)!.updatedAt;
    await b.advance(SYNC_DEBOUNCE_MS + 10);
    await a.engine.syncNow();
    expect(a.store.get().tasks.find((t) => t.id === t1.id)!.name).toBe('Shared v2');

    // a stale write (older updatedAt) from A must not overwrite B's newer row on the server or locally
    const row = server.tables.tasks.get(`${a.fc.session()!.user.id}|${t1.id}`)!;
    expect(row.updated_at).toBe(bStamp);
    server.tables.tasks.set(`${a.fc.session()!.user.id}|${t2.id}`, {
      ...server.tables.tasks.get(`${a.fc.session()!.user.id}|${t2.id}`)!,
      name: 'Ancient',
      updated_at: 1,
      server_updated_at: new Date(server.serverNow + 5).toISOString(),
    });
    server.serverNow += 5;
    await b.engine.syncNow();
    expect(b.store.get().tasks.find((t) => t.id === t2.id)!.name).toBe('Other');

    // delete propagates as a tombstone
    clock.now += 1000;
    a.store.deleteTask(t2.id);
    await a.advance(SYNC_DEBOUNCE_MS + 10);
    await b.engine.syncNow();
    expect(b.store.get().tasks.find((t) => t.id === t2.id)!.deletedAt).not.toBeNull();
    expect(a.store.get().tasks.find((t) => t.id === t2.id)!.deletedAt).not.toBeNull();
    a.engine.dispose();
    b.engine.dispose();
  });

  it('a tombstone beats a live row with the same updatedAt', async () => {
    const { server, clock, a } = await seeded();
    const t = a.store.addTask({ name: 'Tie' });
    await signIn(a, 'em-sync-code');
    const uid = a.fc.session()!.user.id;
    const key = `${uid}|${t.id}`;
    const live = server.tables.tasks.get(key)!;
    server.serverNow += 10;
    server.tables.tasks.set(key, {
      ...live,
      deleted_at: clock.now,
      server_updated_at: new Date(server.serverNow).toISOString(),
    });
    await a.engine.syncNow();
    expect(a.store.get().tasks.find((x) => x.id === t.id)!.deletedAt).toBe(clock.now);
    a.engine.dispose();
  });

  it('re-reads a 60 s overlap on every pull and stays idempotent', async () => {
    const { server, clock, a, b } = await seeded();
    b.store.addTask({ name: 'From B' });
    await signIn(b, 'em-sync-code');
    await signIn(a, 'em-sync-code');
    const cursor = a.store.get().meta.sync.cursors.tasks!;
    expect(Date.parse(cursor)).toBeGreaterThan(0);
    const before = a.store.get().tasks.length;
    server.log.length = 0;
    const r = await a.engine.syncNow();
    const pulls = server.log.filter((o) => o.kind === 'select' && o.table === 'tasks');
    expect(pulls).toHaveLength(1);
    expect(Date.parse(pulls[0]!.since!)).toBe(Date.parse(cursor) - SYNC_PULL_OVERLAP_MS);
    expect(r.pulled.tasks).toBe(0); // re-read, nothing applied
    expect(a.store.get().tasks).toHaveLength(before);
    // a row committed slightly out of order inside the overlap window is still picked up
    clock.now += 1;
    const t = b.store.addTask({ name: 'Late arrival' });
    await b.advance(SYNC_DEBOUNCE_MS + 10);
    const key = `${b.fc.session()!.user.id}|${t.id}`;
    const row = server.tables.tasks.get(key)!;
    server.tables.tasks.set(key, {
      ...row,
      server_updated_at: new Date(Date.parse(cursor) - 30_000).toISOString(),
    });
    const r2 = await a.engine.syncNow();
    expect(r2.pulled.tasks).toBe(1);
    expect(a.store.get().tasks.map((x) => x.name)).toContain('Late arrival');
    a.engine.dispose();
    b.engine.dispose();
  });

  it('pages through large result sets', async () => {
    const { server, a } = await seeded();
    await signIn(a, 'em-sync-code');
    const uid = a.fc.session()!.user.id;
    for (let i = 0; i < 2300; i++) {
      server.serverNow += 1;
      const id = `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const startedAt = 1_700_000_000_000 + i * 60_000;
      server.tables.sessions.set(`${uid}|${id}`, {
        user_id: uid,
        id,
        started_at: startedAt,
        ended_at: startedAt + 25 * MIN,
        day: '2026-09-01',
        tz_offset_min: -420,
        planned_ms: 25 * MIN,
        focused_ms: 25 * MIN,
        task_id: null,
        task_name: null,
        category_id: null,
        created_at: startedAt,
        updated_at: startedAt,
        deleted_at: null,
        server_updated_at: new Date(server.serverNow).toISOString(),
      });
    }
    const r = await a.engine.syncNow();
    expect(r.pulled.sessions).toBe(2300);
    expect(a.store.get().sessions).toHaveLength(2300);
    a.engine.dispose();
  });
});

describe('first sign-in with unsynced history on two devices (EDGE-11)', () => {
  it('ends with the same union on both, nothing discarded, no duplicates', async () => {
    const clock = { now: Date.UTC(2026, 9, 14, 15, 0, 0) };
    const server = createFakeServer(clock.now);
    const a = makeDevice(server, D1, clock);
    const b = makeDevice(server, D2, clock);
    const ta = a.store.addTask({ name: 'A task' });
    const tb = b.store.addTask({ name: 'B task' });
    session(a.store, D1, clock.now - 120 * MIN, ta.id);
    session(a.store, D1, clock.now - 90 * MIN, ta.id);
    session(b.store, D2, clock.now - 60 * MIN, tb.id);
    const aGoal = ((clock.now += 50), a.store.updateSettings({ dailyGoalMin: 60 }));
    clock.now += 100;
    b.store.updateSettings({ dailyGoalMin: 180 }); // later: wins
    expect(aGoal.dailyGoalMin).toBe(60);

    await signIn(a, 'em-sync-code');
    await signIn(b, 'em-sync-code');
    await a.engine.syncNow();

    for (const d of [a, b]) {
      const data = d.store.get();
      expect(data.sessions).toHaveLength(3);
      expect(new Set(data.sessions.map((s) => s.id)).size).toBe(3);
      expect(data.tasks.map((t) => t.name).sort()).toEqual(['A task', 'B task']);
      expect(data.categories.filter((c) => c.deletedAt === null)).toHaveLength(5); // fixed ids: no duplicates
      expect(data.settings.dailyGoalMin).toBe(180);
    }
    expect(serverRows(server, 'sessions')).toHaveLength(3);
    expect(serverRows(server, 'categories')).toHaveLength(5);
    expect(a.store.get().sessions.map((s) => s.id)).toEqual(b.store.get().sessions.map((s) => s.id));
    a.engine.dispose();
    b.engine.dispose();
  });

  it('signing in as a different account merges local data into it and resets cursors', async () => {
    const server = createFakeServer();
    const clock = { now: 70_000_000 };
    const a = makeDevice(server, D1, clock);
    a.store.addTask({ name: 'Mine' });
    await signIn(a, 'sync-code-one');
    expect(a.store.get().meta.sync.cursors.tasks).not.toBeNull();
    await a.engine.signOut();
    expect(a.store.get().meta.sync).toMatchObject({ userId: null, cursors: { tasks: null } });
    a.store.addTask({ name: 'Offline edit' });
    await signIn(a, 'sync-code-two');
    const second = [...server.users.values()][1]!;
    const names = serverRows(server, 'tasks')
      .filter((r) => r.user_id === second)
      .map((r) => r.name)
      .sort();
    expect(names).toEqual(['Mine', 'Offline edit']);
    expect(a.store.get().tasks).toHaveLength(2); // nothing discarded
    a.engine.dispose();
  });
});

describe('triggers and scheduling', () => {
  it('debounces local writes by 2 s with a 10 s maximum wait', async () => {
    const server = createFakeServer();
    const clock = { now: 80_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    server.log.length = 0;
    const upserts = () => server.log.filter((o) => o.kind === 'upsert' && o.table === 'tasks').length;

    d.store.addTask({ name: 'one' });
    await d.advance(SYNC_DEBOUNCE_MS - 100);
    expect(upserts()).toBe(0);
    await d.advance(200);
    expect(upserts()).toBe(1);

    // continuous writes every second: the max wait forces a push at 10 s
    const start = clock.now;
    let pushedAt: number | null = null;
    for (let i = 0; i < 14; i++) {
      d.store.addTask({ name: `w${i}` });
      await d.advance(1000);
      if (pushedAt === null && upserts() === 2) pushedAt = clock.now - start;
    }
    expect(pushedAt).not.toBeNull();
    expect(pushedAt!).toBeGreaterThanOrEqual(SYNC_MAX_WAIT_MS - 1000);
    expect(pushedAt!).toBeLessThanOrEqual(SYNC_MAX_WAIT_MS + 1000);
    d.engine.dispose();
  });

  it('runs on visibility and on the online event, and coalesces overlapping triggers', async () => {
    const server = createFakeServer();
    const clock = { now: 90_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    const runs = () => server.log.filter((o) => o.kind === 'getSession').length;

    let base = runs();
    d.handlers.visible.forEach((fn) => fn());
    await flush();
    expect(runs() - base).toBe(1);

    base = runs();
    let release!: () => void;
    server.gate = new Promise<void>((r) => (release = r));
    d.handlers.online.forEach((fn) => fn());
    await flush();
    d.handlers.visible.forEach((fn) => fn());
    d.handlers.visible.forEach((fn) => fn());
    void d.engine.syncNow();
    server.gate = null;
    release();
    await flush();
    await flush();
    expect(runs() - base).toBe(2); // the run in flight plus exactly one follow-up
    d.engine.dispose();
  });

  it('is offline-safe: no calls while offline, runs when the browser comes back', async () => {
    const server = createFakeServer();
    const clock = { now: 95_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    d.flags.online = false;
    d.store.addTask({ name: 'offline task' });
    server.log.length = 0;
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    expect(server.log).toHaveLength(0);
    expect(d.engine.state().status).toBe('offline');
    expect(d.engine.state().pending).toBe(1);
    d.flags.online = true;
    d.handlers.online.forEach((fn) => fn());
    await flush();
    await flush();
    expect(d.engine.state()).toMatchObject({ status: 'idle', pending: 0 });
    expect(serverRows(server, 'tasks').map((r) => r.name)).toContain('offline task');
    d.engine.dispose();
  });

  it('local writes never wait for the network', async () => {
    const server = createFakeServer();
    const clock = { now: 96_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    server.gate = new Promise<void>(() => undefined); // the network never answers
    const t = d.store.addTask({ name: 'instant' });
    expect(d.store.get().tasks.find((x) => x.id === t.id)).toBeDefined();
    d.store.setTaskDone(t.id, true);
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    expect(d.store.get().tasks.find((x) => x.id === t.id)!.done).toBe(true);
    d.engine.dispose();
  });
});

describe('failures', () => {
  it('backs off 5 s, 10 s, 20 s and caps at 5 minutes, then recovers', async () => {
    const server = createFakeServer();
    const clock = { now: 100_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    d.store.addTask({ name: 'x' });
    server.failWhen = (op) =>
      op.kind === 'upsert' ? { message: 'upstream down', code: '', status: 503 } : null;
    const failedAt = clock.now + SYNC_DEBOUNCE_MS; // the debounced push fires and fails here
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    const delays: number[] = [];
    const seen = () => d.engine.state();
    expect(seen().status).toBe('error');
    let previous = failedAt;
    for (let i = 0; i < 9; i++) {
      const s = seen();
      delays.push(s.nextRetryAt! - previous);
      previous = s.nextRetryAt!;
      await d.advance(s.nextRetryAt! - clock.now + 1);
      expect(seen().status).toBe('error');
    }
    expect(delays.slice(0, 3)).toEqual([5000, 10_000, 20_000]);
    expect(Math.max(...delays)).toBe(SYNC_BACKOFF_MAX_MS);
    expect(delays.at(-1)).toBe(SYNC_BACKOFF_MAX_MS);
    expect(d.store.takeDirty().tasks).toHaveLength(1); // kept
    server.failWhen = null;
    await d.advance(seen().nextRetryAt! - clock.now + 1);
    expect(seen()).toMatchObject({ status: 'idle', nextRetryAt: null, pending: 0 });
    d.engine.dispose();
  });

  it('treats a fetch TypeError as offline', async () => {
    const server = createFakeServer();
    const clock = { now: 110_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    server.failWhen = (op) => (op.kind === 'select' ? new TypeError('Failed to fetch') : null);
    const r = await d.engine.syncNow();
    expect(r.ok).toBe(false);
    expect(d.engine.state().status).toBe('offline');
    d.engine.dispose();
  });

  it('drops a row the database rejects, counts it, and still pushes the others', async () => {
    const server = createFakeServer();
    const clock = { now: 120_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    d.store.addTask({ name: 'good 1' });
    d.store.addTask({ name: 'BAD' });
    d.store.addTask({ name: 'good 2' });
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    expect(
      serverRows(server, 'tasks')
        .map((r) => r.name)
        .sort(),
    ).toEqual(['good 1', 'good 2']);
    expect(d.store.takeDirty().tasks).toEqual([]);
    expect(d.engine.state()).toMatchObject({ status: 'idle', rejected: 1 });
    expect(d.store.get().tasks).toHaveLength(3); // the local row is untouched
    d.engine.dispose();
  });

  it('pauses on auth expiry, keeps the dirty queue, and resumes after signing in again as the same user', async () => {
    const server = createFakeServer();
    const clock = { now: 130_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    d.fc.setSession(null); // refresh token revoked
    d.store.addTask({ name: 'queued' });
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    expect(d.engine.state()).toMatchObject({ status: 'auth-expired', pending: 1 });
    expect(d.store.get().meta.sync.userId).not.toBeNull();
    server.log.length = 0;
    d.store.addTask({ name: 'queued 2' });
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    expect(server.log).toHaveLength(0); // no runs while expired
    expect((await d.engine.syncNow()).ok).toBe(false);

    await signIn(d, 'em-sync-code');
    expect(d.engine.state()).toMatchObject({ status: 'idle', pending: 0 });
    expect(
      serverRows(server, 'tasks')
        .map((r) => r.name)
        .sort(),
    ).toEqual(['queued', 'queued 2']);
    d.engine.dispose();
  });

  it('treats a 401 from the API as auth-expired', async () => {
    const server = createFakeServer();
    const clock = { now: 140_000_000 };
    const d = makeDevice(server, D1, clock);
    await signIn(d, 'em-sync-code');
    server.failWhen = (op) => (op.kind === 'select' ? { message: 'JWT expired', code: 'PGRST301' } : null);
    await d.engine.syncNow();
    expect(d.engine.state().status).toBe('auth-expired');
    d.engine.dispose();
  });
});

describe('sign-in, sign-out and erase', () => {
  it('maps auth failures to result codes', async () => {
    const server = createFakeServer();
    const d = makeDevice(server, D1, { now: 1 });
    await d.advance(0);
    server.log.length = 0;
    expect(await d.engine.signInWithCode('short')).toEqual({ ok: false, error: 'code_too_short' });
    expect(server.log).toEqual([]); // rejected before any request
    server.failWhen = () => ({
      message: 'rate limit exceeded',
      code: 'over_request_rate_limit',
      status: 429,
    });
    expect(await d.engine.signInWithCode('em-sync-code')).toEqual({ ok: false, error: 'rate_limited' });
    server.failWhen = () => new TypeError('Failed to fetch');
    expect(await d.engine.signInWithCode('em-sync-code')).toEqual({ ok: false, error: 'network' });
    server.failWhen = () => ({ message: 'boom', status: 500 });
    expect(await d.engine.signInWithCode('em-sync-code')).toEqual({ ok: false, error: 'unknown' });
    server.failWhen = null;
    expect(await d.engine.signInWithCode('em-sync-code')).toEqual({ ok: true });
    d.engine.dispose();
  });

  it('completes a sign-in that arrives as an auth event', async () => {
    const server = createFakeServer();
    const clock = { now: 150_000_000 };
    const d = makeDevice(server, D1, clock);
    d.store.addTask({ name: 'before link' });
    d.fc.setSession('9f1c2b3a-4d5e-4f60-8a7b-000000000001', 'em@example.com');
    d.fc.emit('SIGNED_IN', d.fc.session());
    await d.advance(10);
    await flush();
    expect(d.store.get().meta.sync.userId).toBe('9f1c2b3a-4d5e-4f60-8a7b-000000000001');
    expect(serverRows(server, 'tasks').map((r) => r.name)).toEqual(['before link']);
    expect(d.engine.state().status).toBe('idle');
    d.engine.dispose();
  });

  it('resumes an existing session when the engine is created (app open)', async () => {
    const server = createFakeServer();
    const clock = { now: 160_000_000 };
    const first = makeDevice(server, D1, clock);
    first.store.addTask({ name: 'kept' });
    await signIn(first, 'em-sync-code');
    const second = createSyncEngine({
      store: first.store,
      env: ENV,
      createClient: (...args) => {
        const f = first.factory.factory(...args);
        first.factory.clients.at(-1)!.setSession(first.fc.session()!.user.id, 'em@example.com');
        return f;
      },
      deps: first.deps,
    });
    await flush();
    await flush();
    expect(second.state().status).toBe('idle');
    second.dispose();
    first.engine.dispose();
  });

  it('sign out keeps all local data and clears only the sync state', async () => {
    const server = createFakeServer();
    const clock = { now: 170_000_000 };
    const d = makeDevice(server, D1, clock);
    d.store.addTask({ name: 'stays' });
    await signIn(d, 'em-sync-code');
    d.store.addTask({ name: 'stays too' });
    await d.engine.signOut();
    expect(d.fc.signOutCalls).toEqual([{ scope: 'local' }]); // other devices stay signed in
    const data = d.store.get();
    expect(data.tasks.map((t) => t.name).sort()).toEqual(['stays', 'stays too']);
    expect(data.meta.sync).toMatchObject({
      userId: null,
      email: null,
      dirty: { categories: [], tasks: [], sessions: [], settings: false },
      cursors: { categories: null, tasks: null, sessions: null, settings: null },
    });
    expect(data.meta.sync.lastUserId).not.toBeNull();
    expect(d.engine.state().status).toBe('signed-out');
    server.log.length = 0;
    d.store.addTask({ name: 'local only' });
    await d.advance(SYNC_DEBOUNCE_MS + 10);
    expect(server.log.filter((o) => o.kind === 'upsert')).toHaveLength(0);
    d.engine.dispose();
  });

  it('erase cloud tombstones every row on the server, then resets this device', async () => {
    const server = createFakeServer();
    const clock = { now: 180_000_000 };
    const d = makeDevice(server, D1, clock);
    const t = d.store.addTask({ name: 'gone' });
    session(d.store, D1, clock.now - 30 * MIN, t.id);
    await signIn(d, 'em-sync-code');
    clock.now += 1000;
    expect(await d.engine.eraseCloud()).toEqual({ ok: true });
    for (const table of ['categories', 'tasks', 'sessions'] as const) {
      for (const row of serverRows(server, table)) expect(row.deleted_at).not.toBeNull();
    }
    const data = d.store.get();
    expect(data.tasks).toHaveLength(0);
    expect(data.sessions).toHaveLength(0);
    expect(data.meta.deviceId).toBe(D1);
    expect(data.meta.sync.userId).toBeNull();
    expect(d.engine.state().status).toBe('signed-out');
    d.engine.dispose();
  });

  it('erase cloud refuses when offline and changes nothing', async () => {
    const server = createFakeServer();
    const d = makeDevice(server, D1, { now: 190_000_000 });
    d.store.addTask({ name: 'safe' });
    await signIn(d, 'em-sync-code');
    d.flags.online = false;
    expect(await d.engine.eraseCloud()).toEqual({ ok: false });
    expect(d.store.get().tasks[0]!.deletedAt).toBeNull();
    d.engine.dispose();
  });
});

describe('core integration', () => {
  it('pulled sessions never fire phase events, chimes or milestones', async () => {
    const clock = { now: Date.UTC(2026, 9, 14, 15, 0, 0) };
    const server = createFakeServer(clock.now);
    // device A has 12 sessions (would cross the 10-session milestone if they were "completed" here)
    const a = makeDevice(server, D1, clock);
    for (let i = 0; i < 12; i++) session(a.store, D1, clock.now - (i + 1) * 40 * MIN);
    await signIn(a, 'em-sync-code');

    const f = fakeFactory(server);
    const core = createEmCore({
      storage: createMemoryAdapter(),
      copy: TEST_COPY,
      now: () => clock.now,
      syncEnv: ENV,
      loadSupabase: async () => f.factory,
    });
    const events: unknown[] = [];
    core.onPhaseComplete((e) => events.push(e));
    const engine = (await core.loadSync())!;
    expect(engine).not.toBeNull();
    expect(await core.loadSync()).toBe(engine); // memoized
    await engine.signInWithCode('em-sync-code');
    await engine.syncNow();
    expect(core.store.get().sessions).toHaveLength(12);
    expect(core.select.today(clock.now).sessions).toBeGreaterThan(0); // visible in stats
    expect(events).toHaveLength(0);
    expect(core.store.get().meta.milestonesShown).toEqual([]);
    core.dispose();
    a.engine.dispose();
  });
});
