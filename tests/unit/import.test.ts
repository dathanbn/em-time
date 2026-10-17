import { describe, expect, it } from 'vitest';
import {
  applyRemoteRow,
  IMPORT_MAX_BYTES,
  mergeData,
  parseImport,
  statsSessions,
  type AppData,
  type ImportResult,
  type Task,
} from '@core';
import { at, CAT1, DEVICE_A, mkSession, mkTask, onDay } from './helpers';
import { makeCore } from './harness';
import { readFileSync } from 'node:fs';

// 20:00 PDT on Oct 14, as an absolute instant so the fixtures behave the same in every time zone
const NOW = Date.UTC(2026, 9, 15, 3, 0);
const text = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(text(name)) as AppData;
const ok = (r: ImportResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
};

describe('DAT-3 import fixtures', () => {
  it('backup-valid.json (a v1 export): accepted with a full summary, one migration notice, and v2 defaults', () => {
    const src = json('backup-valid.json');
    const r = ok(parseImport(text('backup-valid.json'), NOW));
    expect(r.summary.sessions).toBe(src.sessions.length);
    expect(r.summary.categories).toBe(5);
    const days = src.sessions.map((s) => s.day).sort();
    expect(r.summary.firstDay).toBe(days[0]);
    expect(r.summary.lastDay).toBe(days[days.length - 1]);
    expect(r.summary.tasks).toBeGreaterThanOrEqual(4);
    // the v1 fixture is a v1 document, so the only warning is the v1 to v2 migration notice
    expect(r.warnings).toEqual([{ code: 'migrated', from: 1 }]);
    expect(r.data.schemaVersion).toBe(2);
    expect(src.settings.theme).toBe('light'); // the fixture itself stays a genuine v1 file
    expect(r.data.settings).toMatchObject({ theme: 'sky', displayName: 'Em', mascot: true, stickers: true });
    expect(r.data.sessions).toHaveLength(src.sessions.length);
    expect(r.data.sessions.every((s, i, a) => i === 0 || a[i - 1]!.startedAt <= s.startedAt)).toBe(true);
  });

  it('backup-future.json: kept, warned, and hidden from stats until their day (EDGE-5)', () => {
    const r = ok(parseImport(text('backup-future.json'), NOW));
    expect(r.warnings).toContainEqual({ code: 'future-sessions', count: 3 });
    expect(r.data.sessions).toHaveLength(7 + 3);
    const visible = statsSessions(r.data.sessions, '2026-10-14');
    expect(visible).toHaveLength(7);
    expect(visible.every((s) => s.day <= '2026-10-14')).toBe(true);
    // when their day arrives they appear
    expect(statsSessions(r.data.sessions, '2030-01-03')).toHaveLength(10);
  });

  it('a session only just ahead of the clock (inside the 10 minute tolerance) is not flagged', () => {
    const d = json('backup-valid.json');
    d.sessions = [mkSession(NOW + 5 * 60_000)];
    const r = ok(parseImport(JSON.stringify(d), NOW));
    expect(r.warnings.find((w) => w.code === 'future-sessions')).toBeUndefined();
    d.sessions = [mkSession(NOW + 11 * 60_000)];
    expect(ok(parseImport(JSON.stringify(d), NOW)).warnings).toContainEqual({ code: 'future-sessions', count: 1 });
  });

  it('backup-v0.json: migrated through the hook and reported', () => {
    const r = ok(parseImport(text('backup-v0.json'), NOW));
    expect(r.warnings).toContainEqual({ code: 'migrated', from: 0 });
    expect(r.data.schemaVersion).toBe(2); // v0 runs through the hook and on to the current version
    expect(r.data.sessions).toHaveLength(7);
  });

  it.each([
    ['backup-not-json.txt', 'not-json'],
    ['backup-wrong-app.json', 'not-em-time'],
    ['backup-newer.json', 'newer-version'],
    ['backup-damaged.json', 'invalid-shape'],
    ['backup-empty.txt', 'empty'],
  ] as const)('%s is rejected as %s', (file, error) => {
    expect(parseImport(text(file), NOW)).toEqual({ ok: false, error });
  });

  it('a file over 10 MB is rejected as too-large', () => {
    const big = ' '.repeat(IMPORT_MAX_BYTES + 1);
    expect(parseImport(big, NOW)).toEqual({ ok: false, error: 'too-large' });
  });

  it('whitespace-only is not-json or empty, never a crash', () => {
    const r = parseImport('   \n  ', NOW);
    expect(r.ok).toBe(false);
  });

  it('backup-bad-records.json: two invalid sessions dropped with a count, orphan task kept and reported', () => {
    const r = ok(parseImport(text('backup-bad-records.json'), NOW));
    expect(r.data.sessions).toHaveLength(7);
    expect(r.warnings).toContainEqual({ code: 'dropped-records', count: 2 });
    expect(r.warnings).toContainEqual({ code: 'orphan-task-refs', count: 1 });
    const orphan = r.data.tasks.find((t) => t.name === 'Orphan task')!;
    expect(orphan).toBeDefined();
    expect(orphan.categoryId).toBe('99999999-9999-4999-8999-999999999999'); // not rewritten (avoids sync churn)
  });

  it('records with non-UUID ids are dropped rather than imported', () => {
    const d = json('backup-valid.json');
    d.tasks = [...d.tasks, { ...d.tasks[0]!, id: 'not-a-uuid', name: 'bad id' }];
    const r = ok(parseImport(JSON.stringify(d), NOW));
    expect(r.data.tasks.find((t) => t.name === 'bad id')).toBeUndefined();
  });
});

describe('importing into the store (DAT-3, SYNC-7)', () => {
  it('Replace swaps everything; invalid files change nothing', () => {
    const { core } = makeCore();
    core.store.addTask({ name: 'Local only' });
    const bad = parseImport(text('backup-damaged.json'), NOW);
    expect(bad.ok).toBe(false);
    expect(core.store.get().tasks.map((t) => t.name)).toEqual(['Local only']);
    const good = ok(parseImport(text('backup-valid.json'), NOW));
    core.store.importData(good.data, 'replace');
    const d = core.store.get();
    expect(d.sessions).toHaveLength(good.data.sessions.length);
    expect(d.tasks.some((t) => t.name === 'Local only')).toBe(false);
  });

  it('Merge adds sessions and tasks by id and keeps local settings', () => {
    const { core } = makeCore();
    core.store.updateSettings({ dailyGoalMin: 45, theme: 'dark' });
    const local = core.store.addTask({ name: 'Local only' });
    const good = ok(parseImport(text('backup-valid.json'), NOW));
    core.store.importData(good.data, 'merge');
    const d = core.store.get();
    expect(d.settings.dailyGoalMin).toBe(45);
    expect(d.settings.theme).toBe('dark');
    expect(d.tasks.map((t) => t.id)).toContain(local.id);
    expect(d.tasks.length).toBeGreaterThan(1);
    expect(d.sessions).toHaveLength(good.data.sessions.length);
    // merging the same file again adds nothing
    core.store.importData(good.data, 'merge');
    expect(core.store.get().sessions).toHaveLength(good.data.sessions.length);
    expect(core.store.get().categories).toHaveLength(5);
  });

  it('while signed in, imported rows are queued for sync; signed out, nothing is queued', () => {
    const a = makeCore();
    const good = ok(parseImport(text('backup-valid.json'), NOW));
    a.core.store.importData(good.data, 'merge');
    expect(a.core.store.takeDirty().sessions).toEqual([]);

    const b = makeCore();
    b.core.store.setSyncMeta({ userId: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b', email: 'her@example.com' });
    b.core.store.importData(good.data, 'merge');
    const dirty = b.core.store.takeDirty();
    expect(dirty.sessions.length).toBe(good.data.sessions.length);
    expect(dirty.tasks.length).toBeGreaterThan(0);
  });
});

describe('mergeData and applyRemoteRow: last-write-wins (section 3.7)', () => {
  const base = (): AppData => json('backup-valid.json');

  it('applyRemoteRow: greater updatedAt wins, lesser loses, tie goes to the tombstone, otherwise local', () => {
    const local = mkTask({ name: 'local', updatedAt: 100 });
    const newer: Task = { ...local, name: 'remote', updatedAt: 200 };
    const older: Task = { ...local, name: 'remote', updatedAt: 50 };
    expect(applyRemoteRow(local, newer).name).toBe('remote');
    expect(applyRemoteRow(local, older).name).toBe('local');
    const tieLive: Task = { ...local, name: 'remote', updatedAt: 100 };
    expect(applyRemoteRow(local, tieLive).name).toBe('local');
    const tieDeleted: Task = { ...local, name: 'remote', updatedAt: 100, deletedAt: 100 };
    expect(applyRemoteRow(local, tieDeleted).deletedAt).toBe(100);
    const localDeleted = { ...local, deletedAt: 100 };
    expect(applyRemoteRow(localDeleted, tieLive).deletedAt).toBe(100);
    expect(applyRemoteRow(undefined, newer)).toEqual(newer);
  });

  it('an older tombstone loses to a newer edit; a newer tombstone wins', () => {
    const local = mkTask({ updatedAt: 300 });
    expect(applyRemoteRow(local, { ...local, updatedAt: 200, deletedAt: 200 }).deletedAt).toBeNull();
    expect(applyRemoteRow(local, { ...local, updatedAt: 400, deletedAt: 400 }).deletedAt).toBe(400);
  });

  it('mergeData: union by id, later updatedAt wins per entity, local settings/timer/meta kept', () => {
    const local = base();
    const incoming = base();
    const shared = local.tasks[0]!;
    local.tasks[0] = { ...shared, name: 'edited locally', updatedAt: 500 };
    incoming.tasks[0] = { ...shared, name: 'edited remotely', updatedAt: 900 };
    incoming.tasks[1] = { ...incoming.tasks[1]!, name: 'older remote', updatedAt: 1 };
    local.tasks[1] = { ...local.tasks[1]!, name: 'newer local', updatedAt: 50 };
    const extraTask = mkTask({ name: 'only remote' });
    incoming.tasks.push(extraTask);
    const extraSession = mkSession(at(2026, 10, 1, 9, 0));
    incoming.sessions.push(extraSession);
    local.settings = { ...local.settings, dailyGoalMin: 30, theme: 'dark' };
    incoming.settings = { ...incoming.settings, dailyGoalMin: 600, updatedAt: 99999 };
    local.meta.deviceId = DEVICE_A;
    const m = mergeData(local, incoming);
    expect(m.tasks.find((t) => t.id === shared.id)!.name).toBe('edited remotely');
    expect(m.tasks.find((t) => t.id === local.tasks[1]!.id)!.name).toBe('newer local');
    expect(m.tasks.map((t) => t.id)).toContain(extraTask.id);
    expect(m.sessions.map((s) => s.id)).toContain(extraSession.id);
    expect(m.sessions).toHaveLength(local.sessions.length + 1);
    expect(new Set(m.sessions.map((s) => s.id)).size).toBe(m.sessions.length);
    expect(m.settings.dailyGoalMin).toBe(30);
    expect(m.settings.theme).toBe('dark');
    expect(m.meta.deviceId).toBe(DEVICE_A);
  });

  it('mergeData carries tombstones both ways and does not resurrect deleted rows', () => {
    const local = base();
    const incoming = base();
    const t = local.tasks[0]!;
    const stamp = t.updatedAt + 1000;
    incoming.tasks[0] = { ...t, deletedAt: stamp, updatedAt: stamp };
    const m = mergeData(local, incoming);
    expect(m.tasks.find((x) => x.id === t.id)!.deletedAt).toBe(stamp);
    const m2 = mergeData(incoming, local); // other direction: the stale live copy must lose
    expect(m2.tasks.find((x) => x.id === t.id)!.deletedAt).toBe(stamp);
  });

  it('mergeData keeps sessions sorted by startedAt and never duplicates default categories', () => {
    const local = base();
    const incoming = base();
    incoming.sessions.push(onDay(2026, 6, 1, 9));
    const m = mergeData(local, incoming);
    for (let i = 1; i < m.sessions.length; i++) expect(m.sessions[i]!.startedAt).toBeGreaterThanOrEqual(m.sessions[i - 1]!.startedAt);
    expect(m.categories.filter((c) => c.id === CAT1)).toHaveLength(1);
    expect(m.categories).toHaveLength(5);
  });
});
