// THEME-4, THEME-5, NAME-2 (sync), NAME-3 (limits): settings schema v1 -> v2, written from
// contract V2.1 to V2.4 and spec v2.5, independent of core/settings.v2.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  SYNCED_SETTINGS_KEYS,
  ValidationError,
  createDefaultSettings,
  createMemoryAdapter,
  fromRow,
  loadData,
  mergeData,
  migrate,
  parseImport,
  toRow,
  type AppData,
} from '@core';
import { makeCore } from './harness';
import { at } from './helpers';
import { FakeServer, flush, makeDevice } from './syncHarness';

const NOW = at(2026, 10, 14, 15, 0);
const fixtureText = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');
const v1 = (n = 'backup-valid.json') => JSON.parse(fixtureText(n)) as any;
const withTheme = (theme: unknown, extra: Record<string, unknown> = {}) => {
  const d = v1();
  d.settings = { ...d.settings, theme, ...extra };
  return d;
};
const NEW_KEYS = ['displayName', 'mascot', 'stickers'];

describe('schema version', () => {
  it('is 2 and MIGRATIONS has the v1 step', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(typeof MIGRATIONS[1]).toBe('function');
  });
  it('the v1 fixtures really are v1 documents (they stay as migration cases)', () => {
    expect(v1().schemaVersion).toBe(1);
    expect(v1().settings.theme).toBe('light');
    for (const k of NEW_KEYS) expect(k in v1().settings).toBe(false);
  });
});

describe('MIGRATIONS[1]: light to sky, dark stays dark, new keys added (THEME-4)', () => {
  it('light becomes sky; the new keys get "Em", true, true', () => {
    const out = migrate(withTheme('light'));
    expect(out.schemaVersion).toBe(2);
    expect(out.settings).toMatchObject({ theme: 'sky', displayName: 'Em', mascot: true, stickers: true });
  });
  it('dark stays dark', () => {
    expect(migrate(withTheme('dark')).settings.theme).toBe('dark');
  });
  it('does not touch settings.updatedAt, so seeded or device values never win a sync', () => {
    for (const updatedAt of [0, 1234567890123]) {
      expect(migrate(withTheme('light', { updatedAt })).settings.updatedAt).toBe(updatedAt);
    }
  });
  it('does not overwrite new keys that are already present', () => {
    const out = migrate(withTheme('light', { displayName: 'Emily', mascot: false, stickers: false })).settings;
    expect(out).toMatchObject({ displayName: 'Emily', mascot: false, stickers: false, theme: 'sky' });
  });
  it('changes nothing else: every other setting, category, task and session is byte-identical', () => {
    const src = v1();
    const out = migrate(JSON.parse(JSON.stringify(src))) as any;
    const { theme: _t, ...restSrc } = src.settings;
    const rest = { ...out.settings };
    for (const k of NEW_KEYS) delete rest[k];
    delete rest.theme;
    expect(rest).toEqual(restSrc);
    for (const k of ['categories', 'tasks', 'sessions', 'timer', 'meta']) expect(out[k], k).toEqual(src[k]);
  });
  it('v0 documents go through both steps', () => {
    const out = migrate(v1('backup-v0.json'));
    expect(out.schemaVersion).toBe(2);
    expect(out.settings.theme).not.toBe('light');
    expect(out.settings.displayName).toBeTypeOf('string');
  });
  it('a v2 document is not migrated again', () => {
    const once = migrate(v1());
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

describe('loading stored data (validateSettings fills defaults, nothing is dropped)', () => {
  const load = (doc: unknown) => loadData(createMemoryAdapter({ [STORAGE_KEY]: JSON.stringify(doc) }), NOW);
  it('a stored v1 document loads as `migrated` with theme sky and the new defaults; sessions untouched', () => {
    const r = load(v1());
    expect(r.status).toBe('migrated');
    if (r.status === 'migrated') {
      expect(r.data.settings).toMatchObject({ theme: 'sky', displayName: 'Em', mascot: true, stickers: true });
      expect(r.data.sessions).toHaveLength(v1().sessions.filter((s: any) => !s.deletedAt).length + v1().sessions.filter((s: any) => s.deletedAt).length);
    }
  });
  it('a stored v1 dark document keeps dark', () => {
    const r = load(withTheme('dark'));
    expect(r.status).toBe('migrated');
    if (r.status === 'migrated') expect(r.data.settings.theme).toBe('dark');
  });
  it.each([
    ['unknown theme string', 'sepia'],
    ['null theme', null],
    ['numeric theme', 3],
    ['missing theme', undefined],
  ])('v1 document with %s loads with theme sky', (_n, theme) => {
    const d = withTheme(theme);
    if (theme === undefined) delete d.settings.theme;
    const r = load(d);
    expect(r.status === 'migrated' || r.status === 'ok').toBe(true);
    if (r.status === 'migrated' || r.status === 'ok') expect(r.data.settings.theme).toBe('sky');
  });
  it.each([
    ['a v2 document with an invalid theme', { theme: 'neon' }, { theme: 'sky' }],
    ['a v2 document with theme "sky"', { theme: 'sky' }, { theme: 'sky' }],
    ['a v2 document with theme "light" (an explicit choice: kept)', { theme: 'light' }, { theme: 'light' }],
    ['a v2 document with theme "dark"', { theme: 'dark' }, { theme: 'dark' }],
    ['non-string displayName', { displayName: 42 }, { displayName: 'Em' }],
    ['null displayName', { displayName: null }, { displayName: 'Em' }],
    ['blank displayName is kept blank', { displayName: '   ' }, { displayName: '' }],
    ['padded displayName is trimmed', { displayName: '  Emily  ' }, { displayName: 'Emily' }],
    ['control characters are removed', { displayName: 'Em\u0000\u0007ily\u007f\n' }, { displayName: 'Emily' }],
    ['a 30 character name is cut to 24 code points', { displayName: 'abcdefghijklmnopqrstuvwxyz0123' }, { displayName: 'abcdefghijklmnopqrstuvwx' }],
    ['24 emoji code points are kept, extras cut', { displayName: '😀'.repeat(30) }, { displayName: '😀'.repeat(24) }],
    ['non-boolean mascot', { mascot: 'yes' }, { mascot: true }],
    ['non-boolean stickers', { stickers: 0 }, { stickers: true }],
    ['mascot false is kept', { mascot: false }, { mascot: false }],
    ['stickers false is kept', { stickers: false }, { stickers: false }],
  ])('%s', (_n, patch, want) => {
    const d = { ...v1(), schemaVersion: 2, settings: { ...v1().settings, displayName: 'Em', mascot: true, stickers: true, theme: 'sky', ...patch } };
    const r = load(d);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.data.settings).toMatchObject(want);
      expect(r.data.sessions.length).toBeGreaterThan(0); // never dropped because of a settings key
    }
  });
});

describe('importing a v1 export (THEME-4)', () => {
  it('backup-valid.json imports with theme sky and the new defaults, reports one migration notice', () => {
    const r = parseImport(fixtureText('backup-valid.json'), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.settings).toMatchObject({ theme: 'sky', displayName: 'Em', mascot: true, stickers: true });
      expect(r.warnings).toEqual([{ code: 'migrated', from: 1 }]);
    }
  });
  it('a v1 export with theme dark keeps dark; an export of the current version has no migration notice', () => {
    const r = parseImport(JSON.stringify(withTheme('dark')), NOW);
    expect(r.ok && r.data.settings.theme).toBe('dark');
    const { core } = makeCore();
    const out = parseImport(core.store.exportNow(NOW).json, NOW);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.warnings.find((w) => w.code === 'migrated')).toBeUndefined();
  });
  it('an export written by v2 carries schemaVersion 2 and the new keys', () => {
    const { core } = makeCore();
    core.store.updateSettings({ displayName: 'Emily', mascot: false, stickers: false, theme: 'dark' });
    const parsed = JSON.parse(core.store.exportNow(NOW).json);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.settings).toMatchObject({ displayName: 'Emily', mascot: false, stickers: false, theme: 'dark' });
  });
  it('export then import round-trips the v2 settings exactly', () => {
    const { core } = makeCore();
    core.store.updateSettings({ displayName: 'Emily', mascot: false, stickers: false, theme: 'light' });
    const r = parseImport(core.store.exportNow(NOW).json, NOW);
    expect(r.ok && r.data.settings).toEqual(core.store.get().settings);
  });
  it('mergeData of a v1 export into v2 data keeps the local device-only values', () => {
    const { core } = makeCore();
    core.store.updateSettings({ displayName: 'Emily', mascot: false, theme: 'dark' });
    const r = parseImport(fixtureText('backup-valid.json'), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const merged: AppData = mergeData(core.store.get(), r.data);
    expect(merged.settings.theme).toBe('dark');
    expect(merged.settings.mascot).toBe(false);
    expect(merged.settings.displayName).toBe('Emily'); // the import's seeded defaults (updatedAt 0) never win
    expect(merged.schemaVersion).toBe(2);
  });
});

describe('defaults and validation (NAME-3, THEME-1, THEME-6)', () => {
  it('createDefaultSettings: sky, "Em", cloud friend on, stickers on, seeded updatedAt 0', () => {
    expect(createDefaultSettings()).toMatchObject({ theme: 'sky', displayName: 'Em', mascot: true, stickers: true, updatedAt: 0 });
  });
  it('displayName is a synced key; theme, mascot and stickers are not (THEME-5)', () => {
    expect(SYNCED_SETTINGS_KEYS).toContain('displayName');
    expect(SYNCED_SETTINGS_KEYS[SYNCED_SETTINGS_KEYS.length - 1]).toBe('displayName');
    for (const k of ['theme', 'mascot', 'stickers', 'chime', 'volume', 'notifications', 'keepAwake']) expect(SYNCED_SETTINGS_KEYS).not.toContain(k);
  });
  it('updateSettings accepts the three themes and rejects anything else', () => {
    const { core } = makeCore();
    for (const t of ['sky', 'light', 'dark'] as const) expect(core.store.updateSettings({ theme: t }).theme).toBe(t);
    for (const bad of ['sepia', '', null, 1]) {
      expect(() => core.store.updateSettings({ theme: bad as never })).toThrow(ValidationError);
    }
    expect(core.store.get().settings.theme).toBe('dark'); // the last good value survives the failures
  });
  it('updateSettings trims the name, allows blank, allows exactly 24, rejects 25 with too-long', () => {
    const { core } = makeCore();
    expect(core.store.updateSettings({ displayName: '  Emily ' }).displayName).toBe('Emily');
    expect(core.store.updateSettings({ displayName: '' }).displayName).toBe('');
    expect(core.store.updateSettings({ displayName: '   ' }).displayName).toBe('');
    const name24 = 'abcdefghijklmnopqrstuvwx';
    expect(core.store.updateSettings({ displayName: name24 }).displayName).toBe(name24);
    try {
      core.store.updateSettings({ displayName: name24 + 'y' });
      throw new Error('expected a ValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe('displayName');
      expect((e as ValidationError).reason).toBe('too-long');
    }
    expect(core.store.get().settings.displayName).toBe(name24);
  });
  it('the 24 limit counts code points, not UTF-16 units (24 emoji ok, 25 not)', () => {
    const { core } = makeCore();
    expect(core.store.updateSettings({ displayName: '😀'.repeat(24) }).displayName).toBe('😀'.repeat(24));
    expect(() => core.store.updateSettings({ displayName: '😀'.repeat(25) })).toThrow(ValidationError);
  });
  it('a name that is only whitespace plus 24 characters is measured after trimming', () => {
    const { core } = makeCore();
    expect(core.store.updateSettings({ displayName: `   ${'a'.repeat(24)}   ` }).displayName).toBe('a'.repeat(24));
  });
  it('markup in the name is stored literally', () => {
    const { core } = makeCore();
    expect(core.store.updateSettings({ displayName: '<b>x</b>' }).displayName).toBe('<b>x</b>');
  });
  it('non-string name and non-boolean flags are rejected', () => {
    const { core } = makeCore();
    expect(() => core.store.updateSettings({ displayName: 5 as never })).toThrow(ValidationError);
    expect(() => core.store.updateSettings({ mascot: 'yes' as never })).toThrow(ValidationError);
    expect(() => core.store.updateSettings({ stickers: 1 as never })).toThrow(ValidationError);
    expect(core.store.updateSettings({ mascot: false, stickers: false })).toMatchObject({ mascot: false, stickers: false });
  });
  it('a displayName change bumps settings.updatedAt; a theme, mascot or stickers change does not', () => {
    const { core, clock } = makeCore();
    const base = core.store.get().settings.updatedAt;
    expect(base).toBe(0);
    clock.advance(1000);
    core.store.updateSettings({ theme: 'dark', mascot: false, stickers: false });
    expect(core.store.get().settings.updatedAt).toBe(0);
    clock.advance(1000);
    core.store.updateSettings({ displayName: 'Emily' });
    expect(core.store.get().settings.updatedAt).toBeGreaterThan(0);
  });
  it('the change persists to storage before the call returns', () => {
    const { core, storage } = makeCore();
    core.store.updateSettings({ displayName: 'Emily', mascot: false });
    const doc = JSON.parse(storage.read(STORAGE_KEY)!);
    expect(doc.settings).toMatchObject({ displayName: 'Emily', mascot: false });
    expect(doc.schemaVersion).toBe(2);
  });
});

describe('sync keys (THEME-5) and the name across devices (NAME-2)', () => {
  const uid = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
  it('toRow(settings).data has displayName and never theme, mascot or stickers', () => {
    const { core } = makeCore();
    const s = core.store.updateSettings({ displayName: 'Emily', theme: 'dark', mascot: false, stickers: false });
    const row = toRow('settings', s, uid) as { data: Record<string, unknown> };
    expect(row.data.displayName).toBe('Emily');
    for (const k of ['theme', 'mascot', 'stickers']) expect(k in row.data).toBe(false);
    expect(Object.keys(row.data).sort()).toEqual([...SYNCED_SETTINGS_KEYS].sort());
  });
  it('fromRow ignores a pulled displayName that is not a valid string (local value kept)', () => {
    const { core } = makeCore();
    const s = core.store.updateSettings({ displayName: 'Emily' });
    const base = toRow('settings', s, uid) as any;
    for (const bad of [42, null, { a: 1 }, ['x'], 'x'.repeat(25)]) {
      const row = { ...base, data: { ...base.data, displayName: bad } };
      const back = fromRow('settings', row) as Record<string, unknown>;
      expect('displayName' in back && back.displayName !== undefined, `${String(bad)} must be ignored`).toBe(false);
      expect(back.dailyGoalMin).toBe(s.dailyGoalMin); // the rest of the row still applies
    }
    // a valid name is carried, trimmed
    const ok = fromRow('settings', { ...base, data: { ...base.data, displayName: '  Zoe ' } }) as Record<string, unknown>;
    expect(ok.displayName).toBe('Zoe');
    const empty = fromRow('settings', { ...base, data: { ...base.data, displayName: '' } }) as Record<string, unknown>;
    expect(empty.displayName).toBe('');
  });
  it('a row from a v1 device (no displayName) leaves the local name alone', async () => {
    const server = new FakeServer();
    const a = makeDevice(server, 'A', NOW);
    a.core.store.updateSettings({ displayName: 'Emily', dailyGoalMin: 50 });
    await a.signIn('her-sync-code');
    await a.engine!.syncNow();
    const row = server.rows('settings')[0]!;
    delete (row.data as Record<string, unknown>).displayName; // what a v1 device would have pushed
    const b = makeDevice(server, 'B', NOW + 3_600_000);
    b.core.store.updateSettings({ displayName: 'Local' });
    await b.signIn('her-sync-code');
    await b.engine!.syncNow();
    expect(b.core.store.get().settings.displayName).toBe('Local');
  });
  it('NAME-2: a name changed on device A reaches device B; theme, mascot and stickers stay per device', async () => {
    const server = new FakeServer();
    const a = makeDevice(server, 'A', NOW);
    const b = makeDevice(server, 'B', NOW + 3_600_000);
    await b.signIn('her-sync-code');
    await b.engine!.syncNow();
    expect(b.core.store.get().settings.displayName).toBe('Em');
    a.core.store.updateSettings({ displayName: 'Emily', theme: 'dark', mascot: false, stickers: false });
    await a.signIn('her-sync-code');
    await a.engine!.syncNow();
    await flush();
    await b.engine!.syncNow();
    const s = b.core.store.get().settings;
    expect(s.displayName).toBe('Emily');
    expect(s.theme).toBe('sky');
    expect(s.mascot).toBe(true);
    expect(s.stickers).toBe(true);
    const row = server.rows('settings')[0]!;
    expect(Object.keys(row.data).sort()).toEqual([...SYNCED_SETTINGS_KEYS].sort());
    for (const k of ['theme', 'mascot', 'stickers']) expect(k in row.data).toBe(false);
  });
  it('device-only changes (theme, mascot, stickers) do not trigger a push', async () => {
    const server = new FakeServer();
    const a = makeDevice(server, 'A', NOW);
    await a.signIn('her-sync-code');
    await a.engine!.syncNow();
    const before = server.rows('settings').length;
    a.core.store.updateSettings({ theme: 'dark', mascot: false, stickers: false });
    await a.engine!.syncNow();
    expect(server.rows('settings').length).toBe(before);
    a.core.store.updateSettings({ displayName: 'Emily' });
    await a.engine!.syncNow();
    expect(server.rows('settings')).toHaveLength(1);
    expect((server.rows('settings')[0]!.data as any).displayName).toBe('Emily');
  });
});
