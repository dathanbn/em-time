import { describe, expect, it } from 'vitest';
import {
  fromRow,
  isSyncConfigured,
  mergeData,
  SYNCED_SETTINGS_KEYS,
  SYNC_BACKOFF_MAX_MS,
  toRow,
  type Session,
} from '@core';
import { at, mkSession, mkTask, mkCategory, CAT1 } from './helpers';
import { makeCore } from './harness';
import { completeSession, flush, makeDevice, FakeServer } from './syncHarness';

const T0 = at(2026, 10, 14, 10, 0);
const setup = () => {
  const server = new FakeServer();
  const a = makeDevice(server, 'A', T0);
  const b = makeDevice(server, 'B', T0 + 3 * 3_600_000);
  return { server, a, b };
};
const live = <T extends { deletedAt: number | null }>(xs: T[]) => xs.filter((x) => x.deletedAt === null);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe('SYNC-1: configuration', () => {
  it('isSyncConfigured needs a non-empty https url (or localhost) and a non-empty key', () => {
    expect(isSyncConfigured({})).toBe(false);
    expect(isSyncConfigured({ url: 'https://x.supabase.co' })).toBe(false);
    expect(isSyncConfigured({ anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: '', anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: 'https://x.supabase.co', anonKey: '' })).toBe(false);
    expect(isSyncConfigured({ url: 'http://example.com', anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: 'ftp://x', anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: 'https://x.supabase.co', anonKey: 'k' })).toBe(true);
    expect(isSyncConfigured({ url: 'http://localhost:54321', anonKey: 'k' })).toBe(true);
  });

  it('loadSync resolves to null when not configured', async () => {
    const { core } = makeCore();
    await expect(core.loadSync()).resolves.toBeNull();
  });
});

describe('row mapping round trips', () => {
  const uid = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
  it('categories', () => {
    const c = mkCategory({ name: 'Cat', color: 4, order: 3, updatedAt: 55 });
    const row = toRow('categories', c, uid);
    expect(row).toMatchObject({ user_id: uid, id: c.id, name: 'Cat', color: 4, sort_order: 3, created_at: c.createdAt, updated_at: 55, deleted_at: null });
    expect(fromRow('categories', row)).toEqual(c);
  });
  it('tasks', () => {
    const t = mkTask({ name: 'T', done: true, doneAt: 77, order: -2, deletedAt: 90, updatedAt: 90 });
    const row = toRow('tasks', t, uid);
    expect(row).toMatchObject({ category_id: t.categoryId, done: true, done_at: 77, sort_order: -2, deleted_at: 90 });
    expect(fromRow('tasks', row)).toEqual(t);
  });
  it('sessions', () => {
    const s = mkSession(at(2026, 10, 1, 9, 0), { taskId: mkTask().id, taskName: 'n', categoryId: CAT1 });
    const row = toRow('sessions', s, uid);
    expect(row).toMatchObject({ started_at: s.startedAt, ended_at: s.endedAt, day: s.day, tz_offset_min: s.tzOffsetMin, planned_ms: s.plannedMs, focused_ms: s.focusedMs, task_name: 'n' });
    expect(fromRow('sessions', row)).toEqual(s);
    expect('server_updated_at' in row).toBe(false);
  });
  it('settings carry only the synced keys', () => {
    const { core } = makeCore();
    const settings = { ...core.store.updateSettings({ dailyGoalMin: 90, theme: 'dark', chime: 'bowl', volume: 0.2 }) };
    const row = toRow('settings', settings, uid) as { data: Record<string, unknown>; updated_at: number; user_id: string };
    expect(Object.keys(row.data).sort()).toEqual([...SYNCED_SETTINGS_KEYS].sort());
    expect(row.data.dailyGoalMin).toBe(90);
    expect(row.updated_at).toBe(settings.updatedAt);
    const back = fromRow('settings', row as never) as Record<string, unknown>;
    expect(back.dailyGoalMin).toBe(90);
    expect('theme' in back).toBe(false);
  });
  it('invalid rows are rejected as null', () => {
    expect(fromRow('sessions', { id: 'nope' })).toBeNull();
    expect(fromRow('tasks', {})).toBeNull();
  });
});

describe('SYNC-4 / SYNC-5: local writes never wait; push is debounced', () => {
  it('a write while a request is hanging returns immediately and is already stored', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    let release!: () => void;
    server.hold = new Promise<void>((r) => (release = r));
    const t = a.core.store.addTask({ name: 'written while the network hangs' }); // sync call
    expect(a.core.store.get().tasks.map((x) => x.id)).toContain(t.id);
    const saved = JSON.parse(a.storage.read('em-time:data')!);
    expect(saved.tasks.map((x: { id: string }) => x.id)).toContain(t.id);
    a.core.store.updateSettings({ dailyGoalMin: 99 });
    a.clock.advance(2_100);
    await flush(3);
    expect(a.engine!.state().status).toBe('syncing'); // request in flight, nothing blocked
    expect(a.core.store.get().settings.dailyGoalMin).toBe(99);
    release();
    server.hold = null;
    await flush();
    expect(a.engine!.state().status).toBe('idle');
  });

  it('pushes 2 s after the last write (debounce) and never later than 10 s after the first (max wait)', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    server.calls.length = 0;
    a.core.store.addTask({ name: 'one' });
    a.clock.advance(1_900);
    await flush(3);
    expect(server.calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
    a.clock.advance(300);
    await flush();
    expect(server.calls.filter((c) => c.op === 'upsert' && c.table === 'tasks')).toHaveLength(1);
    expect(server.rows('tasks').map((r) => r.name)).toEqual(['one']);

    // a steady stream of edits one second apart keeps resetting the debounce, but not the max wait
    server.calls.length = 0;
    const firstWrite = a.clock.now();
    let pushedAt: number | null = null;
    for (let s = 0; s < 14; s++) {
      a.core.store.addTask({ name: `burst ${s}` });
      a.clock.advance(1_000);
      await flush(2);
      if (pushedAt === null && server.calls.some((c) => c.op === 'upsert')) pushedAt = a.clock.now();
    }
    expect(pushedAt).not.toBeNull();
    expect(pushedAt! - firstWrite).toBeLessThanOrEqual(11_000);
    expect(pushedAt! - firstWrite).toBeGreaterThanOrEqual(8_000); // not at the first debounce
  });

  it('device-only changes (theme, chime) do not trigger a push', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    await flush();
    server.calls.length = 0;
    a.core.store.updateSettings({ theme: 'dark', chime: 'wood', volume: 0.1 });
    a.clock.advance(15_000);
    await flush();
    expect(server.calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
  });
});

describe('SYNC-6: triggers', () => {
  it('visibility, online and syncNow each run a sync; overlapping triggers coalesce into one follow-up', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    await flush();
    const selects = () => server.calls.filter((c) => c.op === 'select' && c.table === 'categories').length;
    let before = selects();
    a.visible.forEach((f) => f());
    await flush();
    expect(selects()).toBe(before + 1);
    before = selects();
    a.onlineHandlers.forEach((f) => f());
    await flush();
    expect(selects()).toBe(before + 1);
    before = selects();
    await a.engine!.syncNow();
    expect(selects()).toBe(before + 1);

    // overlapping: hold a run open and fire three triggers
    let release!: () => void;
    server.hold = new Promise<void>((r) => (release = r));
    before = selects();
    const first = a.engine!.syncNow();
    await flush(3);
    a.visible.forEach((f) => f());
    a.onlineHandlers.forEach((f) => f());
    a.visible.forEach((f) => f());
    server.hold = null;
    release();
    await first;
    await flush();
    expect(selects() - before).toBe(2); // the running one plus exactly one follow-up
  });

  it('offline: status offline and no requests; back online it syncs', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    a.online = false;
    a.core.store.addTask({ name: 'while offline' });
    server.calls.length = 0;
    a.clock.advance(12_000);
    await flush();
    expect(server.calls).toHaveLength(0);
    expect(a.engine!.state().status).toBe('offline');
    a.online = true;
    a.onlineHandlers.forEach((f) => f());
    await flush();
    expect(a.engine!.state().status).toBe('idle');
    expect(server.rows('tasks').map((r) => r.name)).toEqual(['while offline']);
  });
});

describe('SYNC-7 / EDGE-11 / SYNC-14: two devices with disjoint offline history', () => {
  it('converge on the union with no duplicate sessions and a single set of default categories', async () => {
    const { server, a, b } = setup();
    const ta = a.core.store.addTask({ name: 'A task' });
    const tb = b.core.store.addTask({ name: 'B task' });
    completeSession(a, ta.id);
    completeSession(a, ta.id);
    completeSession(b, tb.id);
    expect(a.core.store.get().sessions).toHaveLength(2);
    expect(b.core.store.get().sessions).toHaveLength(1);

    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    await b.signIn('her@example.com');
    await b.engine!.syncNow();
    await a.engine!.syncNow();

    for (const d of [a, b]) {
      const data = d.core.store.get();
      expect(data.sessions).toHaveLength(3);
      expect(new Set(data.sessions.map((s) => s.id)).size).toBe(3);
      expect(live(data.tasks).map((t) => t.name).sort()).toEqual(['A task', 'B task']);
      expect(live(data.categories)).toHaveLength(5);
    }
    expect(ids(a.core.store.get().sessions)).toEqual(ids(b.core.store.get().sessions));
    expect(server.rows('sessions')).toHaveLength(3);
    expect(server.rows('categories')).toHaveLength(5);
    expect(a.core.select.today().sessions).toBe(b.core.select.today().sessions);
  });

  it('repeated syncs and the pull overlap window never duplicate rows', async () => {
    const { server, a, b } = setup();
    completeSession(a);
    await a.signIn('her@example.com');
    await b.signIn('her@example.com');
    for (let i = 0; i < 4; i++) {
      await a.engine!.syncNow();
      await b.engine!.syncNow();
    }
    expect(b.core.store.get().sessions).toHaveLength(1);
    expect(server.rows('sessions')).toHaveLength(1);
  });

  it('default categories carry updatedAt 0 and never overwrite a customised one (SYNC-14)', async () => {
    const { a, b } = setup();
    a.core.store.updateCategory(CAT1, { name: 'Lectures' });
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    expect(b.core.store.get().categories.find((c) => c.id === CAT1)!.updatedAt).toBe(0);
    await b.signIn('her@example.com');
    await b.engine!.syncNow();
    await a.engine!.syncNow();
    expect(a.core.store.get().categories.find((c) => c.id === CAT1)!.name).toBe('Lectures');
    expect(b.core.store.get().categories.find((c) => c.id === CAT1)!.name).toBe('Lectures');
  });
});

describe('SYNC-8 / SYNC-9: last-write-wins and soft delete', () => {
  it('the later edit wins on both devices regardless of who syncs first', async () => {
    const { a, b } = setup();
    const t = a.core.store.addTask({ name: 'original' });
    await a.signIn('her@example.com');
    await b.signIn('her@example.com');
    await a.engine!.syncNow();
    await b.engine!.syncNow();
    expect(b.core.store.get().tasks.find((x) => x.id === t.id)!.name).toBe('original');

    a.clock.jump(60_000);
    b.clock.jump(2 * 60_000);
    a.core.store.updateTask(t.id, { name: 'edited on A' });
    b.core.store.updateTask(t.id, { name: 'edited on B (later)' });
    // B is later, but A syncs after B
    await b.engine!.syncNow();
    await a.engine!.syncNow();
    await b.engine!.syncNow();
    expect(a.core.store.get().tasks.find((x) => x.id === t.id)!.name).toBe('edited on B (later)');
    expect(b.core.store.get().tasks.find((x) => x.id === t.id)!.name).toBe('edited on B (later)');
  });

  it('a delete propagates as a tombstone and nothing is ever hard deleted', async () => {
    const { server, a, b } = setup();
    const t = a.core.store.addTask({ name: 'to delete' });
    await a.signIn('her@example.com');
    await b.signIn('her@example.com');
    await a.engine!.syncNow();
    await b.engine!.syncNow();
    expect(live(b.core.store.get().tasks)).toHaveLength(1);
    a.clock.jump(60_000);
    a.core.store.deleteTask(t.id);
    await a.engine!.syncNow();
    await b.engine!.syncNow();
    expect(live(b.core.store.get().tasks)).toHaveLength(0);
    const row = server.rows('tasks').find((r) => r.id === t.id)!;
    expect(row).toBeDefined();
    expect(row.deleted_at).not.toBeNull();
  });

  it('a stale write cannot overwrite a newer server row (trigger rule)', async () => {
    const { server, a, b } = setup();
    const t = a.core.store.addTask({ name: 'v1' });
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    a.clock.jump(120_000);
    a.core.store.updateTask(t.id, { name: 'v2' });
    await a.engine!.syncNow();
    // B pushes an older version of the same row
    await b.signIn('her@example.com');
    b.core.store.applyRemote('tasks', [{ ...t }]);
    b.core.store.markAllDirty();
    await b.engine!.syncNow();
    expect(server.rows('tasks').find((r) => r.id === t.id)!.name).toBe('v2');
    expect(b.core.store.get().tasks.find((x) => x.id === t.id)!.name).toBe('v2');
  });
});

describe('SYNC-13: synced and device-only settings', () => {
  it('pushes only synced keys; seeded defaults are never pushed; remote customisation reaches a fresh device', async () => {
    const { server, a, b } = setup();
    await b.signIn('her@example.com'); // untouched defaults
    await b.engine!.syncNow();
    expect(server.rows('settings')).toHaveLength(0);

    a.core.store.updateSettings({ dailyGoalMin: 45, autoStart: false, theme: 'dark', chime: 'bowl', volume: 0.1, keepAwake: false, notifications: false });
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    const row = server.rows('settings')[0]!;
    expect(Object.keys(row.data).sort()).toEqual([...SYNCED_SETTINGS_KEYS].sort());
    for (const k of ['theme', 'chime', 'volume', 'keepAwake', 'notifications', 'updatedAt']) expect(k in row.data).toBe(false);

    await b.engine!.syncNow();
    const s = b.core.store.get().settings;
    expect(s.dailyGoalMin).toBe(45);
    expect(s.autoStart).toBe(false);
    expect(s.theme).toBe('light'); // device-only keys stay put
    expect(s.chime).toBe('glass');
    expect(s.volume).toBe(0.6);
  });
});

describe('SYNC-15: pulled data is quiet', () => {
  it('pulled sessions emit no completion event, set no milestone, and the screens see them at once', async () => {
    const { a, b } = setup();
    for (let i = 0; i < 11; i++) {
      a.core.store.importData({ ...a.core.store.get(), sessions: [...a.core.store.get().sessions, mkSession(at(2026, 9, 1 + i, 9, 0))] }, 'merge');
    }
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    await b.signIn('her@example.com');
    await b.engine!.syncNow();
    expect(b.core.store.get().sessions).toHaveLength(11);
    expect(b.events).toHaveLength(0);
    expect(b.core.store.get().meta.milestonesShown).toEqual([]);
    expect(b.core.select.week(-2).totalMs).toBeGreaterThanOrEqual(0);
    let notified = 0;
    b.core.store.subscribe(() => notified++);
    a.core.store.addTask({ name: 'new on A' });
    await a.engine!.syncNow();
    await b.engine!.syncNow();
    expect(notified).toBeGreaterThan(0);
    expect(b.events).toHaveLength(0);
  });
});

describe('EDGE-12 / SYNC-11: account changes and sign-out', () => {
  it('signing in as a different account merges local data into it and discards nothing', async () => {
    const { server, a } = setup();
    a.core.store.addTask({ name: 'mine' });
    await a.signIn('first@example.com');
    await a.engine!.syncNow();
    await a.engine!.signOut();
    expect(a.core.store.get().meta.sync.userId).toBeNull();
    expect(live(a.core.store.get().tasks)).toHaveLength(1);
    await a.signIn('second@example.com');
    await a.engine!.syncNow();
    expect(live(a.core.store.get().tasks)).toHaveLength(1);
    const first = server.uidFor('first@example.com');
    const second = server.uidFor('second@example.com');
    expect(first).not.toBe(second);
    expect(server.rows('tasks', first)).toHaveLength(1);
    expect(server.rows('tasks', second)).toHaveLength(1);
  });

  it('sign out stops syncing and keeps every local row', async () => {
    const { server, a } = setup();
    a.core.store.addTask({ name: 'stay' });
    completeSession(a);
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    await a.engine!.signOut();
    server.calls.length = 0;
    a.core.store.addTask({ name: 'after sign out' });
    a.clock.advance(20_000);
    await flush();
    expect(server.calls).toHaveLength(0);
    expect(live(a.core.store.get().tasks)).toHaveLength(2);
    expect(a.core.store.get().sessions).toHaveLength(1);
    expect(a.core.store.takeDirty()).toEqual({ categories: [], tasks: [], sessions: [], settings: false });
  });
});

describe('EDGE-13 / EDGE-14: failures', () => {
  it('an expired token pauses sync, keeps dirty rows and local use; a new sign-in pushes them', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    server.failNext = { kind: 'auth' };
    a.core.store.addTask({ name: 'queued' });
    await a.engine!.syncNow();
    expect(a.engine!.state().status).toBe('auth-expired');
    expect(a.core.store.takeDirty().tasks).toHaveLength(1);
    a.core.store.addTask({ name: 'still works locally' });
    expect(live(a.core.store.get().tasks)).toHaveLength(2);
    server.calls.length = 0;
    a.clock.advance(30_000);
    await flush();
    expect(server.calls).toHaveLength(0); // paused
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    expect(server.rows('tasks').map((r) => r.name).sort()).toEqual(['queued', 'still works locally']);
  });

  it('server errors back off 5 s, 10 s, 20 s ... capped at 5 min, and recover', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    server.failAll = true;
    a.core.store.addTask({ name: 'retry me' });
    const delays: number[] = [];
    a.clock.advance(2_100); // the debounced push fires and fails
    await flush();
    expect(a.engine!.state().status).toBe('error');
    delays.push(a.engine!.state().nextRetryAt! - a.clock.now());
    for (let i = 0; i < 9; i++) {
      a.clock.advance(a.engine!.state().nextRetryAt! - a.clock.now() + 1);
      await flush();
      delays.push(a.engine!.state().nextRetryAt! - a.clock.now());
    }
    expect(delays.slice(0, 4).map((d) => Math.round(d / 1000))).toEqual([5, 10, 20, 40]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(SYNC_BACKOFF_MAX_MS + 5);
    expect(delays[delays.length - 1]).toBeGreaterThanOrEqual(SYNC_BACKOFF_MAX_MS - 5);
    // the local write was never blocked or rolled back
    expect(live(a.core.store.get().tasks)).toHaveLength(1);
    server.failAll = false;
    a.clock.advance(SYNC_BACKOFF_MAX_MS + 100);
    await flush();
    expect(a.engine!.state().status).toBe('idle');
    expect(server.rows('tasks').map((r) => r.name)).toEqual(['retry me']);
  });

  it('a network failure reads as offline and retries', async () => {
    const { server, a } = setup();
    await a.signIn('her@example.com');
    a.core.store.addTask({ name: 'x' });
    server.failNext = { kind: 'network' };
    await a.engine!.syncNow();
    expect(a.engine!.state().status).toBe('offline');
    a.clock.advance(6_000);
    await flush();
    expect(a.engine!.state().status).toBe('idle');
  });

  it('a row the server rejects (constraint) is dropped and counted; the rest are pushed', async () => {
    const { server, a } = setup();
    a.core.store.addTask({ name: 'fine one' });
    a.core.store.addTask({ name: 'REJECT me' });
    a.core.store.addTask({ name: 'fine two' });
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    expect(server.rows('tasks').map((r) => r.name).sort()).toEqual(['fine one', 'fine two']);
    expect(a.engine!.state().rejected).toBe(1);
    expect(a.core.store.takeDirty().tasks).toHaveLength(0); // dropped from the queue
    expect(live(a.core.store.get().tasks)).toHaveLength(3); // local data untouched
  });
});

describe('DAT-5: erase the cloud', () => {
  it('tombstones every synced row, then resets locally; offline it refuses', async () => {
    const { server, a } = setup();
    a.core.store.addTask({ name: 'erase me' });
    completeSession(a);
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    a.online = false;
    expect(await a.engine!.eraseCloud()).toEqual({ ok: false });
    expect(live(a.core.store.get().tasks)).toHaveLength(1);
    a.online = true;
    a.clock.jump(1000);
    expect(await a.engine!.eraseCloud()).toEqual({ ok: true });
    expect(server.rows('tasks').every((r) => r.deleted_at != null)).toBe(true);
    expect(server.rows('sessions').every((r) => r.deleted_at != null)).toBe(true);
    expect(server.rows('sessions')).toHaveLength(1); // still there, as a tombstone
    expect(a.core.store.get().sessions).toHaveLength(0);
    expect(a.core.store.get().tasks).toHaveLength(0);
  });
});

describe('SYNC-10 (client side)', () => {
  it('a pull as another user returns nothing under the fake RLS', async () => {
    const { server, a } = setup();
    a.core.store.addTask({ name: 'private' });
    await a.signIn('her@example.com');
    await a.engine!.syncNow();
    const intruder = makeDevice(server, 'X', T0);
    await intruder.signIn('intruder@example.com');
    await intruder.engine!.syncNow();
    expect(live(intruder.core.store.get().tasks)).toHaveLength(0);
    expect(intruder.core.store.get().sessions).toHaveLength(0);
  });
});

void mergeData;
void ({} as Session);
