// v2 "Sky diary" settings: migration, validation, store rules, push payload and pulled values.
import { describe, expect, it } from 'vitest';
import {
  createDefaultData,
  createEmCore,
  createMemoryAdapter,
  exportData,
  parseImport,
  SCHEMA_VERSION,
  SYNCED_SETTINGS_KEYS,
  ValidationError,
} from './index';
import { MIGRATIONS, migrate } from './storage/migrate';
import { loadData } from './storage/persist';
import { validateSettings } from './storage/validate';
import { fromRow, toRow } from './sync/rows';
import { TEST_COPY } from './fixtures/test-copy';
import type { AppData } from './types';

const NOW = 1791990000000;
const KEY = 'em-time:data';

function v1Doc(theme: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const d = createDefaultData(NOW, 'dev-a') as unknown as Record<string, unknown>;
  const settings: Record<string, unknown> = {
    ...(d.settings as Record<string, unknown>),
    theme,
    updatedAt: 0,
  };
  delete settings.displayName;
  delete settings.mascot;
  delete settings.stickers;
  Object.assign(settings, extra);
  return { ...d, schemaVersion: 1, settings };
}

const mk = (seed?: Record<string, string>) => {
  let t = NOW;
  const adapter = createMemoryAdapter(seed);
  const core = createEmCore({ storage: adapter, copy: TEST_COPY, syncEnv: {}, now: () => (t += 1) });
  return { core, adapter };
};

describe('v2 defaults', () => {
  it('seeds sky, Em, mascot and stickers on, and a version 2 document', () => {
    const { core } = mk();
    expect(core.store.get().settings).toMatchObject({
      theme: 'sky',
      displayName: 'Em',
      mascot: true,
      stickers: true,
      updatedAt: 0,
    });
    expect(core.store.get().schemaVersion).toBe(2);
    expect(SCHEMA_VERSION).toBe(2);
  });
  it('the synced subset is the old ten plus displayName, appended last', () => {
    expect(SYNCED_SETTINGS_KEYS).toHaveLength(11);
    expect(SYNCED_SETTINGS_KEYS[10]).toBe('displayName');
    for (const k of ['theme', 'mascot', 'stickers'] as const) {
      expect(SYNCED_SETTINGS_KEYS).not.toContain(k);
    }
  });
});

describe('v1 to v2 migration', () => {
  it('light becomes sky, dark stays dark, new keys are added, updatedAt is untouched', () => {
    const light = MIGRATIONS[1]!(v1Doc('light', { updatedAt: 0 }));
    expect(light.settings).toMatchObject({
      theme: 'sky',
      displayName: 'Em',
      mascot: true,
      stickers: true,
      updatedAt: 0,
    });
    const dark = MIGRATIONS[1]!(v1Doc('dark', { updatedAt: 1234 }));
    expect(dark.settings).toMatchObject({ theme: 'dark', displayName: 'Em', updatedAt: 1234 });
  });
  it('keeps new keys that are already present', () => {
    const out = MIGRATIONS[1]!(v1Doc('dark', { displayName: 'Mia', mascot: false, stickers: false }));
    expect(out.settings).toMatchObject({ displayName: 'Mia', mascot: false, stickers: false });
  });
  it('does not throw when settings is missing', () => {
    expect(MIGRATIONS[1]!({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
  });
  it('a stored v1 document loads as v2 and is not marked as a read-only or corrupt case', () => {
    const { adapter } = mk({ [KEY]: JSON.stringify(v1Doc('light')) });
    const r = loadData(adapter, NOW);
    expect(r.status).toBe('migrated');
    if (r.status !== 'migrated') throw new Error('unreachable');
    expect(r.data.schemaVersion).toBe(2);
    expect(r.data.settings).toMatchObject({ theme: 'sky', displayName: 'Em', mascot: true, stickers: true });
    expect(r.data.settings.updatedAt).toBe(0);
  });
  it('a v1 export file imports, with the migrated warning', () => {
    const r = parseImport(JSON.stringify(v1Doc('dark')), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.warnings).toContainEqual({ code: 'migrated', from: 1 });
    expect(r.data.settings.theme).toBe('dark');
    expect(r.data.settings.displayName).toBe('Em');
  });
  it('migrate() reaches the current version from 0 too', () => {
    const doc = { ...v1Doc('light'), schemaVersion: 0 };
    expect(migrate(doc).schemaVersion).toBe(2);
  });
  it('a newer document is still refused', () => {
    expect(() => migrate({ app: 'em-time', schemaVersion: SCHEMA_VERSION + 1 })).toThrow();
  });
  it('exports carry schemaVersion 2 and round-trip the new keys', () => {
    const d: AppData = createDefaultData(NOW, 'dev-a');
    d.settings = { ...d.settings, displayName: 'Mia', mascot: false, theme: 'dark' };
    const out = exportData(d, NOW);
    expect(JSON.parse(out.json).schemaVersion).toBe(2);
    const r = parseImport(out.json, NOW);
    if (!r.ok) throw new Error('unreachable');
    expect(r.data.settings).toMatchObject({ displayName: 'Mia', mascot: false, theme: 'dark' });
  });
});

describe('validateSettings (load and import)', () => {
  it('fills missing or invalid v2 keys with defaults and never drops the document', () => {
    expect(validateSettings({ theme: 'neon', displayName: 5, mascot: 'yes', stickers: null })).toMatchObject({
      theme: 'sky',
      displayName: 'Em',
      mascot: true,
      stickers: true,
    });
    expect(validateSettings({})).toMatchObject({ theme: 'sky', displayName: 'Em' });
  });
  it('keeps all three themes', () => {
    for (const theme of ['sky', 'light', 'dark']) expect(validateSettings({ theme }).theme).toBe(theme);
  });
  it('trims, strips control characters, and cuts to 24 code points', () => {
    expect(validateSettings({ displayName: '  Mia\u0000\u001f\u007f  ' }).displayName).toBe('Mia');
    expect(validateSettings({ displayName: 'x'.repeat(40) }).displayName).toBe('x'.repeat(24));
    const emoji = '🌸'.repeat(30);
    expect(Array.from(validateSettings({ displayName: emoji }).displayName)).toHaveLength(24);
  });
  it('an empty name is valid', () => {
    expect(validateSettings({ displayName: '   ' }).displayName).toBe('');
  });
});

describe('store.updateSettings (v2)', () => {
  it('trims displayName and allows the empty string', () => {
    const { core } = mk();
    expect(core.store.updateSettings({ displayName: '  Mia  ' }).displayName).toBe('Mia');
    expect(core.store.updateSettings({ displayName: '' }).displayName).toBe('');
  });
  it('rejects more than 24 code points, counting emoji as one each', () => {
    const { core } = mk();
    expect(() => core.store.updateSettings({ displayName: 'x'.repeat(25) })).toThrow(ValidationError);
    try {
      core.store.updateSettings({ displayName: 'x'.repeat(25) });
    } catch (e) {
      expect(e).toMatchObject({ field: 'displayName', reason: 'too-long' });
    }
    expect(core.store.updateSettings({ displayName: '🌸'.repeat(24) }).displayName).toBe('🌸'.repeat(24));
    expect(() => core.store.updateSettings({ displayName: '🌸'.repeat(25) })).toThrow(ValidationError);
    expect(core.store.get().settings.displayName).toBe('🌸'.repeat(24));
  });
  it('a displayName change is a synced change: bumps updatedAt and marks settings dirty', () => {
    const { core } = mk();
    core.store.setSyncMeta({ userId: 'u1' });
    const writes: Array<string | null> = [];
    core.store.onLocalWrite((t) => writes.push(t));
    expect(core.store.get().settings.updatedAt).toBe(0);
    const next = core.store.updateSettings({ displayName: 'Mia' });
    expect(next.updatedAt).toBeGreaterThan(0);
    expect(core.store.takeDirty().settings).toBe(true);
    expect(writes).toEqual(['settings']);
  });
  it('an unchanged name does nothing', () => {
    const { core } = mk();
    core.store.setSyncMeta({ userId: 'u1' });
    core.store.updateSettings({ displayName: 'Em' });
    expect(core.store.get().settings.updatedAt).toBe(0);
    expect(core.store.takeDirty().settings).toBe(false);
  });
  it('theme, mascot and stickers are device-only: no bump, no dirty flag', () => {
    const { core } = mk();
    core.store.setSyncMeta({ userId: 'u1' });
    core.store.updateSettings({ theme: 'dark', mascot: false, stickers: false });
    expect(core.store.get().settings).toMatchObject({
      theme: 'dark',
      mascot: false,
      stickers: false,
      updatedAt: 0,
    });
    expect(core.store.takeDirty().settings).toBe(false);
    core.store.updateSettings({ theme: 'sky' });
    expect(core.store.get().settings.theme).toBe('sky');
  });
  it('rejects a bad theme and non-boolean switches', () => {
    const { core } = mk();
    expect(() => core.store.updateSettings({ theme: 'neon' as never })).toThrow(ValidationError);
    expect(() => core.store.updateSettings({ mascot: 1 as never })).toThrow(ValidationError);
    expect(() => core.store.updateSettings({ stickers: 'on' as never })).toThrow(ValidationError);
    expect(() => core.store.updateSettings({ displayName: 3 as never })).toThrow(ValidationError);
  });
  it('persists the new keys and they survive a reload', () => {
    const { core, adapter } = mk();
    core.store.updateSettings({ displayName: 'Mia', mascot: false, theme: 'dark' });
    const again = createEmCore({ storage: adapter, copy: TEST_COPY, syncEnv: {} });
    expect(again.store.get().settings).toMatchObject({ displayName: 'Mia', mascot: false, theme: 'dark' });
  });
});

describe('sync rows (v2)', () => {
  it('toRow pushes displayName and never theme, mascot or stickers', () => {
    const s = {
      ...validateSettings({}),
      displayName: 'Mia',
      theme: 'dark' as const,
      mascot: false,
      stickers: false,
    };
    const row = toRow('settings', { ...s, updatedAt: 9 }, 'u1');
    const data = row.data as Record<string, unknown>;
    expect(data.displayName).toBe('Mia');
    expect(Object.keys(data).sort()).toEqual([...SYNCED_SETTINGS_KEYS].sort());
    for (const k of ['theme', 'mascot', 'stickers']) expect(data).not.toHaveProperty(k);
  });
  it('fromRow applies a valid pulled name (sanitized)', () => {
    const out = fromRow('settings', { updated_at: 5, data: { displayName: '  Mia\u0000 ' } });
    expect(out).toEqual({ updatedAt: 5, displayName: 'Mia' });
  });
  it('fromRow ignores an invalid pulled name instead of defaulting it', () => {
    for (const bad of [7, null, {}, 'x'.repeat(25), '🌸'.repeat(25)]) {
      const out = fromRow('settings', { updated_at: 5, data: { displayName: bad, longEvery: 3 } }) as Record<
        string,
        unknown
      >;
      expect(out).not.toHaveProperty('displayName');
      expect(out.longEvery).toBe(3);
    }
  });
  it('a v1-shaped row (no displayName) leaves the key out', () => {
    const out = fromRow('settings', { updated_at: 5, data: { longEvery: 3 } }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('displayName');
  });
});

describe('store.applyRemote settings (v2)', () => {
  it('a newer row with a name replaces the local name; device-only keys are untouched', () => {
    const { core } = mk();
    core.store.updateSettings({ theme: 'dark', mascot: false });
    const r = core.store.applyRemote('settings', [{ updatedAt: 10, displayName: 'Mia' }]);
    expect(r.applied).toBe(1);
    expect(core.store.get().settings).toMatchObject({
      displayName: 'Mia',
      theme: 'dark',
      mascot: false,
      updatedAt: 10,
    });
  });
  it('an invalid pulled name is ignored while the other keys still apply', () => {
    const { core } = mk();
    core.store.updateSettings({ displayName: 'Mia' });
    const t = core.store.get().settings.updatedAt;
    core.store.applyRemote('settings', [{ updatedAt: t + 100, displayName: 'x'.repeat(30), longEvery: 3 }]);
    expect(core.store.get().settings).toMatchObject({ displayName: 'Mia', longEvery: 3 });
    core.store.applyRemote('settings', [{ updatedAt: t + 200, displayName: 42 }]);
    expect(core.store.get().settings.displayName).toBe('Mia');
  });
  it('a v1-shaped remote row keeps the local name', () => {
    const { core } = mk();
    core.store.updateSettings({ displayName: 'Mia' });
    const t = core.store.get().settings.updatedAt;
    core.store.applyRemote('settings', [{ updatedAt: t + 100, longEvery: 3 }]);
    expect(core.store.get().settings).toMatchObject({ displayName: 'Mia', longEvery: 3 });
  });
  it('an older row does not overwrite the local name', () => {
    const { core } = mk();
    core.store.updateSettings({ displayName: 'Mia' });
    const t = core.store.get().settings.updatedAt;
    core.store.applyRemote('settings', [{ updatedAt: t - 1, displayName: 'Old' }]);
    expect(core.store.get().settings.displayName).toBe('Mia');
  });
});
