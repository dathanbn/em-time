import { describe, expect, it } from 'vitest';
import {
  AUTH_STORAGE_KEY,
  CORRUPT_KEY_PREFIX,
  createDefaultData,
  createEmCore,
  createMemoryAdapter,
  loadData,
  migrate,
  MIGRATIONS,
  MigrationError,
  parseImport,
  saveData,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type AppData,
  type StorageAdapter,
} from '@core';
import { at, copyFixture, DEVICE_A } from './helpers';
import { FakeClock, makeCore } from './harness';
import { readFileSync } from 'node:fs';

const NOW = at(2026, 10, 14, 10, 0);
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

function guarded(inner = createMemoryAdapter()) {
  const state = { failWrite: null as null | 'quota' | 'unavailable', failRead: false, writes: 0 };
  const adapter: StorageAdapter = {
    read: (k) => {
      if (state.failRead) throw new Error('SecurityError');
      return inner.read(k);
    },
    write: (k, v) => {
      if (state.failWrite === 'quota') {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      if (state.failWrite === 'unavailable') throw new Error('SecurityError');
      state.writes++;
      inner.write(k, v);
    },
    remove: (k) => inner.remove(k),
    keys: () => inner.keys(),
  };
  return { adapter, state, inner };
}

describe('first run (TSK-1, EDGE-8)', () => {
  it('an empty storage boots to the seeded defaults', () => {
    const r = loadData(createMemoryAdapter(), NOW);
    expect(r.status).toBe('new');
    const d = r.data;
    expect(d.categories.map((c) => [c.id, c.name, c.color])).toEqual([
      ['5e5e0000-0000-4000-8000-000000000001', 'Study', 1],
      ['5e5e0000-0000-4000-8000-000000000002', 'Reading', 2],
      ['5e5e0000-0000-4000-8000-000000000003', 'Problem sets', 3],
      ['5e5e0000-0000-4000-8000-000000000004', 'Writing', 4],
      ['5e5e0000-0000-4000-8000-000000000005', 'Review', 5],
    ]);
    expect(d.categories.every((c) => c.updatedAt === 0 && c.createdAt === 0)).toBe(true);
    expect(d.tasks).toEqual([]);
    expect(d.sessions).toEqual([]);
    expect(d.settings).toMatchObject({ preset: '25/5', focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: true, dailyGoalMin: 120, weekStartsOn: 1, theme: 'sky', displayName: 'Em', mascot: true, stickers: true, chime: 'glass', volume: 0.6, updatedAt: 0 });
    expect(d.timer).toMatchObject({ phase: 'focus', status: 'idle', remainingMs: 25 * 60_000 });
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('corrupt storage (EDGE-6)', () => {
  it.each([
    ['unparsable JSON', '{"app": "em-time", '],
    ['array root', '[1,2,3]'],
    ['string root', '"hello"'],
    ['null root', 'null'],
    ['wrong app marker', '{"app":"something-else","schemaVersion":1}'],
  ])('%s: raw string is copied to a backup key and the app starts fresh', (_n, raw) => {
    const a = createMemoryAdapter({ [STORAGE_KEY]: raw });
    const r = loadData(a, NOW);
    expect(r.status).toBe('recovered-corrupt');
    if (r.status !== 'recovered-corrupt') throw new Error('unreachable');
    expect(r.backupKey.startsWith(CORRUPT_KEY_PREFIX)).toBe(true);
    expect(a.read(r.backupKey)).toBe(raw);
    expect(r.data.sessions).toEqual([]);
    expect(r.data.categories).toHaveLength(5);
    // the fresh document replaced the broken one, so the next boot is clean
    expect(loadData(a, NOW + 1).status).toBe('ok');
  });

  it('the core boots empty and reports the backup key for the banner', () => {
    const raw = '<<<garbage>>>';
    const { core, storage } = makeCore({ storage: createMemoryAdapter({ [STORAGE_KEY]: raw }) });
    expect(core.boot.status).toBe('recovered-corrupt');
    expect(core.boot.backupKey).not.toBeNull();
    expect(storage.read(core.boot.backupKey!)).toBe(raw);
    expect(core.store.get().sessions).toHaveLength(0);
    expect(core.select.today().focusMs).toBe(0);
    expect(core.select.streak().current).toBe(0);
  });
});

describe('unusual storage states', () => {
  it('newer schema version: read-only, never overwritten (contract section 6)', () => {
    const newer = { ...createDefaultData(NOW, DEVICE_A), schemaVersion: SCHEMA_VERSION + 5 };
    const raw = JSON.stringify(newer);
    const a = createMemoryAdapter({ [STORAGE_KEY]: raw });
    const r = loadData(a, NOW);
    expect(r.status).toBe('read-only-newer');
    expect(saveData(a, r.data)).toEqual({ ok: false, error: 'read-only-newer' });
    const { core, storage } = makeCore({ storage: a });
    expect(core.store.status()).toBe('read-only-newer');
    core.store.addTask({ name: 'Should stay in memory' });
    expect(storage.read(STORAGE_KEY)).toBe(raw);
  });

  it('quota exceeded: status quota, the change stays in memory, the next write retries', () => {
    const g = guarded();
    const { core } = makeCore({ storage: g.adapter });
    core.store.addTask({ name: 'first' });
    g.state.failWrite = 'quota';
    core.store.addTask({ name: 'second' });
    expect(core.store.status()).toBe('quota');
    expect(core.store.get().tasks.map((t) => t.name)).toContain('second');
    g.state.failWrite = null;
    core.store.addTask({ name: 'third' });
    const saved = JSON.parse(g.inner.read(STORAGE_KEY)!) as AppData;
    expect(saved.tasks.map((t) => t.name).sort()).toEqual(['first', 'second', 'third']);
    expect(core.store.status()).toBe('ok');
  });

  it('saveData reports quota and unavailable distinctly', () => {
    const g = guarded();
    const data = createDefaultData(NOW, DEVICE_A);
    g.state.failWrite = 'quota';
    expect(saveData(g.adapter, data)).toEqual({ ok: false, error: 'quota' });
    g.state.failWrite = 'unavailable';
    expect(saveData(g.adapter, data)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('unreadable storage: the app runs in memory with status unavailable', () => {
    const g = guarded();
    g.state.failRead = true;
    g.state.failWrite = 'unavailable';
    const { core } = makeCore({ storage: g.adapter });
    expect(core.boot.status).toBe('unavailable');
    expect(core.store.status()).toBe('unavailable');
    const t = core.store.addTask({ name: 'still works' });
    expect(core.store.get().tasks).toContainEqual(expect.objectContaining({ id: t.id }));
  });

  it('bad records inside a valid document are dropped and counted, not fatal', () => {
    const doc = JSON.parse(fixture('backup-bad-records.json')) as AppData;
    const a = createMemoryAdapter({ [STORAGE_KEY]: JSON.stringify(doc) });
    const r = loadData(a, NOW);
    // the fixture is a v1 document: it loads as `migrated`, with the same drop accounting as `ok`
    expect(r.status).toBe('migrated');
    if (r.status !== 'migrated') throw new Error('unreachable');
    expect(r.dropped).toBe(2);
    expect(r.data.sessions).toHaveLength(7);
  });
});

describe('write path (DAT-1)', () => {
  it('every state change is in storage before the call returns', () => {
    const { core, storage } = makeCore();
    const read = () => JSON.parse(storage.read(STORAGE_KEY)!) as AppData;
    const t = core.store.addTask({ name: 'Persist me' });
    expect(read().tasks.map((x) => x.id)).toContain(t.id);
    core.store.setCurrentTask(t.id);
    expect(read().meta.currentTaskId).toBe(t.id);
    core.store.updateSettings({ dailyGoalMin: 90 });
    expect(read().settings.dailyGoalMin).toBe(90);
    core.store.updateSettings({ theme: 'dark' });
    expect(read().settings.theme).toBe('dark');
    core.timer.start();
    expect(read().timer.status).toBe('running');
  });

  it('ticking does not write', () => {
    const g = guarded();
    const clock = new FakeClock();
    const { core } = makeCore({ storage: g.adapter, clock });
    core.timer.start();
    const before = g.state.writes;
    for (let i = 0; i < 600; i++) clock.advance(1000); // ten minutes of seconds
    clock.becomeVisible();
    expect(g.state.writes).toBe(before);
  });

  it('a settings change that touches only device keys does not bump the synced updatedAt', () => {
    const { core } = makeCore();
    core.store.updateSettings({ theme: 'dark', chime: 'bowl', volume: 0.3 });
    expect(core.store.get().settings.updatedAt).toBe(0);
    core.store.updateSettings({ dailyGoalMin: 45 });
    expect(core.store.get().settings.updatedAt).toBeGreaterThan(0);
  });
});

describe('migration', () => {
  it('v0 fixture migrates to the current version', () => {
    const doc = JSON.parse(fixture('backup-v0.json'));
    expect(doc.schemaVersion).toBe(0);
    const out = migrate(doc);
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.sessions).toHaveLength(doc.sessions.length);
  });

  it('a registered migration step runs and can reshape the document', () => {
    const doc = JSON.parse(fixture('backup-v0.json'));
    doc.legacyGoal = 77;
    const original = MIGRATIONS[0];
    MIGRATIONS[0] = (d: any) => {
      d.settings.dailyGoalMin = d.legacyGoal;
      delete d.legacyGoal;
      return d;
    };
    try {
      const out = migrate(JSON.parse(JSON.stringify(doc)));
      expect(out.settings.dailyGoalMin).toBe(77);
      expect(out.schemaVersion).toBe(SCHEMA_VERSION);
      const r = parseImport(JSON.stringify(doc), NOW);
      expect(r.ok && r.data.settings.dailyGoalMin).toBe(77);
    } finally {
      if (original) MIGRATIONS[0] = original;
      else delete MIGRATIONS[0];
    }
  });

  it('newer and invalid documents throw MigrationError', () => {
    expect(() => migrate({ app: 'em-time', schemaVersion: SCHEMA_VERSION + 1 })).toThrow(MigrationError);
    expect(() => migrate('nope')).toThrow(MigrationError);
    try {
      migrate({ app: 'em-time', schemaVersion: 99 });
    } catch (e) {
      expect((e as MigrationError).code).toBe('newer-version');
    }
  });
});

describe('export (DAT-2) never contains credentials', () => {
  it('omits auth tokens, sync identity and cursors; filename carries the date', () => {
    const secret = 'eyJhbGciOiJIUzI1NiJ9.SECRET-ACCESS-TOKEN.sig';
    const storage = createMemoryAdapter({
      [AUTH_STORAGE_KEY]: JSON.stringify({ access_token: secret, refresh_token: 'REFRESH-SECRET', user: { id: 'u' } }),
      'em-time:auth-code-verifier': 'VERIFIER-SECRET',
    });
    const { core } = makeCore({ storage });
    core.store.addTask({ name: 'Visible in backup' });
    core.store.setSyncMeta({
      userId: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b',
      email: 'her@example.com',
      lastUserId: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b',
      cursors: { categories: '2026-10-14T15:00:02.118Z', tasks: null, sessions: null, settings: null },
      lastSyncedAt: 123456,
    });
    const out = core.store.exportNow(at(2026, 10, 14, 10, 0));
    expect(out.filename).toBe('em-time-backup-2026-10-14.json');
    for (const needle of [secret, 'REFRESH-SECRET', 'VERIFIER-SECRET', 'access_token', 'refresh_token', AUTH_STORAGE_KEY, 'her@example.com', '9f1c2b3a', '2026-10-14T15:00:02.118Z']) {
      expect(out.json).not.toContain(needle);
    }
    const doc = JSON.parse(out.json) as AppData;
    expect(doc.app).toBe('em-time');
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof doc.exportedAt).toBe('number');
    expect(doc.meta.sync).toMatchObject({ userId: null, email: null, lastUserId: null, lastSyncedAt: null, rejected: 0 });
    expect(doc.meta.sync.cursors).toEqual({ categories: null, tasks: null, sessions: null, settings: null });
    expect(doc.meta.sync.dirty).toEqual({ categories: [], tasks: [], sessions: [], settings: false });
    expect(doc.tasks.map((t) => t.name)).toContain('Visible in backup');
  });

  it('exportNow does not mark the backup as done; markExported does', () => {
    const { core } = makeCore();
    core.store.exportNow(NOW);
    expect(core.store.get().meta.lastExportAt).toBeNull();
    core.store.markExported(NOW);
    expect(core.store.get().meta.lastExportAt).toBe(NOW);
  });

  it('an export parses back into the same data (round trip)', () => {
    const { core } = makeCore();
    const t = core.store.addTask({ name: 'Round trip' });
    core.store.setCurrentTask(t.id);
    const out = core.store.exportNow(NOW);
    const back = parseImport(out.json, NOW);
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error('unreachable');
    expect(back.data.tasks.map((x) => x.name)).toEqual(['Round trip']);
    expect(back.data.categories).toHaveLength(5);
    expect(back.warnings).toEqual([]);
    expect(createEmCore).toBeTypeOf('function');
    expect(copyFixture.aboutLine).toBeTruthy();
  });
});
