import { APP_ID, IMPORT_MAX_BYTES, SCHEMA_VERSION } from '../constants';
import { createDefaultSyncMeta } from '../store/defaults';
import { dayKey } from '../time/calendar';
import type { AppData, EntityMeta } from '../types';
import type { ImportResult, ImportWarning } from '../api';
import { applyRemoteRow } from './lww';
import { MigrationError, migrate } from './migrate';
import { isRecord, normalizeDocument } from './validate';

export { applyRemoteRow };

/** em-time-backup-YYYY-MM-DD.json, dated by the local calendar date of `now`. */
export function exportData(data: AppData, now: number): { filename: string; json: string } {
  const doc: AppData = {
    ...data,
    exportedAt: now,
    meta: { ...data.meta, sync: createDefaultSyncMeta() },
  };
  return { filename: `em-time-backup-${dayKey(now, 0)}.json`, json: JSON.stringify(doc, null, 2) };
}

export function parseImport(text: string, now: number): ImportResult {
  if (text.length === 0) return { ok: false, error: 'empty' };
  if (text.length > IMPORT_MAX_BYTES || new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
    return { ok: false, error: 'too-large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!isRecord(parsed) || parsed.app !== APP_ID) return { ok: false, error: 'not-em-time' };
  const from = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (from > SCHEMA_VERSION) return { ok: false, error: 'newer-version' };
  if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.categories)) {
    return { ok: false, error: 'invalid-shape' };
  }

  let doc: AppData;
  try {
    doc = migrate(parsed);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof MigrationError && e.code === 'newer-version' ? 'newer-version' : 'invalid-shape',
    };
  }
  const { data, dropped, futureSessions, orphanTasks } = normalizeDocument(doc, now);
  // A backup never carries credentials, cursors or the dirty queue, whatever the file says.
  data.meta = { ...data.meta, sync: createDefaultSyncMeta() };

  const warnings: ImportWarning[] = [];
  if (from < SCHEMA_VERSION) warnings.push({ code: 'migrated', from });
  if (dropped > 0) warnings.push({ code: 'dropped-records', count: dropped });
  if (futureSessions > 0) warnings.push({ code: 'future-sessions', count: futureSessions });
  if (orphanTasks > 0) warnings.push({ code: 'orphan-task-refs', count: orphanTasks });

  const live = data.sessions.filter((s) => s.deletedAt === null);
  let firstDay: string | null = null;
  let lastDay: string | null = null;
  for (const s of live) {
    if (firstDay === null || s.day < firstDay) firstDay = s.day;
    if (lastDay === null || s.day > lastDay) lastDay = s.day;
  }
  return {
    ok: true,
    data,
    warnings,
    summary: {
      sessions: live.length,
      tasks: data.tasks.filter((t) => t.deletedAt === null).length,
      categories: data.categories.filter((c) => c.deletedAt === null).length,
      firstDay,
      lastDay,
    },
  };
}

function unionById<T extends EntityMeta>(local: T[], incoming: T[]): T[] {
  const map = new Map<string, T>(local.map((x) => [x.id, x] as const));
  for (const item of incoming) map.set(item.id, applyRemoteRow(map.get(item.id), item));
  return [...map.values()];
}

/** Merge import: union by id with per-entity last-write-wins. Local settings, timer and meta are kept. */
export function mergeData(local: AppData, incoming: AppData): AppData {
  return {
    ...local,
    categories: unionById(local.categories, incoming.categories).sort((a, b) => a.order - b.order),
    tasks: unionById(local.tasks, incoming.tasks).sort((a, b) => a.order - b.order),
    sessions: unionById(local.sessions, incoming.sessions).sort(
      (a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1),
    ),
  };
}
