// v4 focus sounds settings: defaults, validation on load and import, store rules, and the
// device-only guarantees (never pushed, never applied from a pulled row). No schema bump.
import { describe, expect, it } from 'vitest';
import {
  createDefaultData,
  createDefaultSettings,
  createEmCore,
  createMemoryAdapter,
  exportData,
  LIMITS,
  NOISE_IDS,
  parseImport,
  SCHEMA_VERSION,
  SYNCED_SETTINGS_KEYS,
  ValidationError,
} from './index';
import { loadData } from './storage/persist';
import { validateSettings } from './storage/validate';
import { fromRow, toRow } from './sync/rows';
import { TEST_COPY } from './fixtures/test-copy';
import type { AppData } from './types';

const NOW = 1791990000000;
const KEY = 'em-time:data';
const NOISE_KEYS = ['noiseOn', 'noise', 'noiseVolume'] as const;

const mk = (seed?: Record<string, string>) => {
  let t = NOW;
  const adapter = createMemoryAdapter(seed);
  const core = createEmCore({ storage: adapter, copy: TEST_COPY, syncEnv: {}, now: () => (t += 1) });
  return { core, adapter };
};

describe('catalog and defaults', () => {
  it('lists the nine sounds in catalog order', () => {
    expect([...NOISE_IDS]).toEqual([
      'white', 'pink', 'brown', 'rain', 'waves', 'stream', 'cafe', 'fireplace', 'night',
    ]);
  });
  it('seeds noise off, rain, volume 0.5, and the volume range is 0..1', () => {
    expect(createDefaultSettings()).toMatchObject({ noiseOn: false, noise: 'rain', noiseVolume: 0.5 });
    expect(LIMITS.noiseVolume).toEqual([0, 1]);
  });
  it('is additive: no schema bump', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(mk().core.store.get().schemaVersion).toBe(2);
  });
  it('none of the new keys is synced', () => {
    expect(SYNCED_SETTINGS_KEYS).toHaveLength(11);
    for (const k of NOISE_KEYS) expect(SYNCED_SETTINGS_KEYS).not.toContain(k);
  });
});

describe('validateSettings (load and import)', () => {
  it('fills missing keys with defaults', () => {
    expect(validateSettings({})).toMatchObject({ noiseOn: false, noise: 'rain', noiseVolume: 0.5 });
  });
  it('replaces an unknown noise id and non-boolean noiseOn with the defaults', () => {
    for (const bad of ['thunder', '', 4, null, {}, 'RAIN']) {
      expect(validateSettings({ noise: bad }).noise).toBe('rain');
    }
    for (const bad of ['yes', 1, null]) expect(validateSettings({ noiseOn: bad }).noiseOn).toBe(false);
  });
  it('keeps every catalog id and a true switch', () => {
    for (const noise of NOISE_IDS) expect(validateSettings({ noise }).noise).toBe(noise);
    expect(validateSettings({ noiseOn: true }).noiseOn).toBe(true);
  });
  it('clamps the volume to 0..1 and defaults a non-number', () => {
    expect(validateSettings({ noiseVolume: 3 }).noiseVolume).toBe(1);
    expect(validateSettings({ noiseVolume: -2 }).noiseVolume).toBe(0);
    expect(validateSettings({ noiseVolume: 0.25 }).noiseVolume).toBe(0.25);
    for (const bad of ['0.2', null, NaN, undefined]) expect(validateSettings({ noiseVolume: bad }).noiseVolume).toBe(0.5);
  });
  it('a stored document from before v4 loads with the defaults and keeps its other settings', () => {
    const d = createDefaultData(NOW, 'dev-a') as unknown as { settings: Record<string, unknown> };
    for (const k of NOISE_KEYS) delete d.settings[k];
    d.settings.volume = 0.2;
    const r = loadData(createMemoryAdapter({ [KEY]: JSON.stringify(d) }), NOW);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') throw new Error('unreachable');
    expect(r.data.settings).toMatchObject({ noiseOn: false, noise: 'rain', noiseVolume: 0.5, volume: 0.2 });
  });
});

describe('store.updateSettings (v4)', () => {
  it('accepts every id, the switch and a volume in range', () => {
    const { core } = mk();
    for (const noise of NOISE_IDS) expect(core.store.updateSettings({ noise }).noise).toBe(noise);
    expect(core.store.updateSettings({ noiseOn: true }).noiseOn).toBe(true);
    expect(core.store.updateSettings({ noiseVolume: 0 }).noiseVolume).toBe(0);
    expect(core.store.updateSettings({ noiseVolume: 1 }).noiseVolume).toBe(1);
    expect(core.store.updateSettings({ noiseVolume: 0.37 }).noiseVolume).toBe(0.37);
  });
  it("rejects an unknown id with ValidationError('noise', 'required')", () => {
    const { core } = mk();
    for (const bad of ['thunder', '', 7, null]) {
      expect(() => core.store.updateSettings({ noise: bad as never })).toThrow(ValidationError);
    }
    try {
      core.store.updateSettings({ noise: 'thunder' as never });
    } catch (e) {
      expect(e).toMatchObject({ field: 'noise', reason: 'required' });
    }
    expect(core.store.get().settings.noise).toBe('rain');
  });
  it("rejects a volume outside 0..1 with reason 'limit'", () => {
    const { core } = mk();
    for (const bad of [-0.01, 1.01, NaN, 50]) {
      expect(() => core.store.updateSettings({ noiseVolume: bad })).toThrow(ValidationError);
    }
    try {
      core.store.updateSettings({ noiseVolume: 2 });
    } catch (e) {
      expect(e).toMatchObject({ field: 'noiseVolume', reason: 'limit' });
    }
    expect(core.store.get().settings.noiseVolume).toBe(0.5);
  });
  it("rejects a non-boolean noiseOn with reason 'required'", () => {
    const { core } = mk();
    for (const bad of [1, 'on', null]) {
      expect(() => core.store.updateSettings({ noiseOn: bad as never })).toThrow(ValidationError);
    }
    try {
      core.store.updateSettings({ noiseOn: 'on' as never });
    } catch (e) {
      expect(e).toMatchObject({ field: 'noiseOn', reason: 'required' });
    }
  });
  it('a rejected patch changes nothing, even for its valid keys', () => {
    const { core } = mk();
    expect(() => core.store.updateSettings({ noiseOn: true, noise: 'x' as never })).toThrow(ValidationError);
    expect(core.store.get().settings.noiseOn).toBe(false);
  });
  it('is device-only: no updatedAt bump, no dirty flag, no write notification (same as mascot)', () => {
    const { core } = mk();
    core.store.setSyncMeta({ userId: 'u1' });
    const writes: Array<string | null> = [];
    core.store.onLocalWrite((t) => writes.push(t));
    core.store.updateSettings({ noiseOn: true, noise: 'brown', noiseVolume: 0.9 });
    expect(core.store.get().settings).toMatchObject({
      noiseOn: true,
      noise: 'brown',
      noiseVolume: 0.9,
      updatedAt: 0,
    });
    expect(core.store.takeDirty().settings).toBe(false);
    expect(writes).toEqual([null]);
    // and it behaves exactly like another device-only key
    const { core: other } = mk();
    other.store.setSyncMeta({ userId: 'u1' });
    const otherWrites: Array<string | null> = [];
    other.store.onLocalWrite((t) => otherWrites.push(t));
    other.store.updateSettings({ mascot: false });
    expect(otherWrites).toEqual(writes);
  });
  it('an unchanged value is a no-op', () => {
    const { core } = mk();
    const before = core.store.get().settings;
    expect(core.store.updateSettings({ noise: 'rain', noiseVolume: 0.5, noiseOn: false })).toBe(before);
  });
  it('a synced edit still bumps updatedAt as before and does not disturb the sound settings', () => {
    const { core } = mk();
    core.store.updateSettings({ noiseOn: true, noise: 'cafe' });
    const next = core.store.updateSettings({ displayName: 'Mia' });
    expect(next.updatedAt).toBeGreaterThan(0);
    expect(next).toMatchObject({ noiseOn: true, noise: 'cafe' });
  });
  it('persists and survives a reload', () => {
    const { core, adapter } = mk();
    core.store.updateSettings({ noiseOn: true, noise: 'night', noiseVolume: 0.8 });
    const again = createEmCore({ storage: adapter, copy: TEST_COPY, syncEnv: {} });
    expect(again.store.get().settings).toMatchObject({ noiseOn: true, noise: 'night', noiseVolume: 0.8 });
  });
});

describe('export and import', () => {
  it('exports and re-imports the sound settings like other device-only settings', () => {
    const d: AppData = createDefaultData(NOW, 'dev-a');
    d.settings = { ...d.settings, noiseOn: true, noise: 'stream', noiseVolume: 0.3 };
    const out = exportData(d, NOW);
    expect(JSON.parse(out.json).settings).toMatchObject({ noiseOn: true, noise: 'stream', noiseVolume: 0.3 });
    const r = parseImport(out.json, NOW);
    if (!r.ok) throw new Error('unreachable');
    expect(r.data.settings).toMatchObject({ noiseOn: true, noise: 'stream', noiseVolume: 0.3 });
  });
  it('a backup without the keys, or with bad ones, imports with defaults and no warning', () => {
    const d = JSON.parse(exportData(createDefaultData(NOW, 'dev-a'), NOW).json);
    for (const k of NOISE_KEYS) delete d.settings[k];
    const missing = parseImport(JSON.stringify(d), NOW);
    if (!missing.ok) throw new Error('unreachable');
    expect(missing.data.settings).toMatchObject({ noiseOn: false, noise: 'rain', noiseVolume: 0.5 });
    expect(missing.warnings).toEqual([]);
    d.settings.noise = 'thunder';
    d.settings.noiseVolume = 9;
    const bad = parseImport(JSON.stringify(d), NOW);
    if (!bad.ok) throw new Error('unreachable');
    expect(bad.data.settings).toMatchObject({ noise: 'rain', noiseVolume: 1 });
  });
});

describe('sync (device-only)', () => {
  it('toRow never pushes the sound settings', () => {
    const s = { ...validateSettings({}), noiseOn: true, noise: 'brown' as const, noiseVolume: 0.9, updatedAt: 9 };
    const data = toRow('settings', s, 'u1').data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([...SYNCED_SETTINGS_KEYS].sort());
    for (const k of NOISE_KEYS) expect(data).not.toHaveProperty(k);
  });
  it('fromRow drops the sound keys even when another device sends them', () => {
    const out = fromRow('settings', {
      updated_at: 5,
      data: { noiseOn: true, noise: 'brown', noiseVolume: 1, longEvery: 3 },
    }) as Record<string, unknown>;
    expect(out).toEqual({ updatedAt: 5, longEvery: 3 });
  });
  it('applyRemote never applies the sound keys, while synced keys of the same row do apply', () => {
    const { core } = mk();
    core.store.updateSettings({ noiseOn: true, noise: 'fireplace', noiseVolume: 0.2 });
    const r = core.store.applyRemote('settings', [
      { updatedAt: 10, longEvery: 3, noiseOn: false, noise: 'brown', noiseVolume: 1 },
    ]);
    expect(r.applied).toBe(1);
    expect(core.store.get().settings).toMatchObject({
      longEvery: 3,
      updatedAt: 10,
      noiseOn: true,
      noise: 'fireplace',
      noiseVolume: 0.2,
    });
  });
});
