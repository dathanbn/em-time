import { CORRUPT_KEY_PREFIX, SCHEMA_VERSION, STORAGE_KEY } from '../constants';
import { createDefaultData } from '../store/defaults';
import type { AppData } from '../types';
import type { LoadResult, SaveResult, StorageAdapter } from '../api';
import { MigrationError, migrate } from './migrate';
import { normalizeDocument } from './validate';

/** localStorage, resolved lazily so a blocked or missing localStorage throws only when used. */
export function createLocalStorageAdapter(): StorageAdapter {
  const ls = (): Storage => (globalThis as { localStorage: Storage }).localStorage;
  return {
    read: (key) => ls().getItem(key),
    write: (key, value) => ls().setItem(key, value),
    remove: (key) => ls().removeItem(key),
    keys() {
      const s = ls();
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    },
  };
}

export function createMemoryAdapter(seed: Record<string, string> = {}): StorageAdapter {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return (
    !!err &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  );
}

export function saveData(adapter: StorageAdapter, data: AppData): SaveResult {
  if (data.schemaVersion > SCHEMA_VERSION) return { ok: false, error: 'read-only-newer' };
  try {
    adapter.write(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}

/** read -> JSON.parse -> migrate -> validate/normalize. Never throws. */
export function loadData(adapter: StorageAdapter, now: number): LoadResult {
  let raw: string | null;
  try {
    raw = adapter.read(STORAGE_KEY);
  } catch {
    return { status: 'unavailable', data: createDefaultData(now) };
  }
  if (raw === null) return { status: 'new', data: createDefaultData(now) };

  const recover = (): LoadResult => {
    const backupKey = CORRUPT_KEY_PREFIX + now;
    try {
      adapter.write(backupKey, raw as string);
    } catch {
      /* keep going: fresh data in memory is better than nothing */
    }
    const data = createDefaultData(now);
    saveData(adapter, data);
    return { status: 'recovered-corrupt', data, backupKey };
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return recover();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return recover();
  if ((parsed as { app?: unknown }).app !== 'em-time') return recover();

  const storedVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  let doc: AppData;
  try {
    doc = migrate(parsed);
  } catch (e) {
    if (e instanceof MigrationError && e.code === 'newer-version') {
      // Run read-only from memory; keep the newer schemaVersion so saveData refuses to overwrite it.
      const { data } = normalizeDocument(parsed, now, { strict: false });
      return { status: 'read-only-newer', data: { ...data, schemaVersion: storedVersion as number } };
    }
    return recover();
  }
  const { data, dropped } = normalizeDocument(doc, now, { strict: false });
  const migrated = (typeof storedVersion === 'number' ? storedVersion : 0) < SCHEMA_VERSION;
  return { status: migrated ? 'migrated' : 'ok', data, dropped };
}
