import { APP_ID, SCHEMA_VERSION } from '../constants';
import type { AppData } from '../types';

export class MigrationError extends Error {
  constructor(public readonly code: 'newer-version' | 'invalid') {
    super(`Migration failed: ${code}`);
    this.name = 'MigrationError';
  }
}

/**
 * MIGRATIONS[v] upgrades a document of schemaVersion v to v + 1. A document without a step for
 * its version is carried forward unchanged (its schemaVersion is stamped).
 * Tests register synthetic steps here to prove the hook runs.
 */
export const MIGRATIONS: Record<number, (doc: any) => any> = {
  /**
   * v1 to v2 (Sky diary, contract V2.3): theme 'light' becomes 'sky' ('dark' stays); adds
   * displayName 'Em', mascot true and stickers true when absent. settings.updatedAt is not touched,
   * so device-only and seeded values can never win a sync.
   */
  1(doc) {
    const s = doc?.settings;
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return doc;
    const settings = { ...s };
    if (settings.theme === 'light') settings.theme = 'sky';
    if (!('displayName' in settings)) settings.displayName = 'Em';
    if (!('mascot' in settings)) settings.mascot = true;
    if (!('stickers' in settings)) settings.stickers = true;
    return { ...doc, settings };
  },
};

/** Brings a parsed document up to SCHEMA_VERSION. Does not validate records (see validate.ts). */
export function migrate(raw: unknown): AppData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new MigrationError('invalid');
  let doc = raw as Record<string, unknown>;
  if (doc.app !== APP_ID) throw new MigrationError('invalid');
  const version =
    typeof doc.schemaVersion === 'number' && Number.isInteger(doc.schemaVersion) ? doc.schemaVersion : 0;
  if (version > SCHEMA_VERSION) throw new MigrationError('newer-version');
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) doc = step(doc) as Record<string, unknown>;
    doc = { ...doc, schemaVersion: v + 1 };
  }
  return doc as unknown as AppData;
}
