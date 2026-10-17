import { SYNCED_SETTINGS_KEYS } from '../constants';
import {
  isRecord,
  parseRemoteDisplayName,
  validateCategory,
  validateSession,
  validateSettings,
  validateTask,
} from '../storage/validate';
import type { Category, Session, Settings, SyncTable, Task } from '../types';

/** bigint columns arrive as numbers from PostgREST, but tolerate numeric strings. */
function num(x: unknown): unknown {
  if (typeof x === 'string' && /^-?\d+$/.test(x)) return Number(x);
  return x;
}

/** Entity -> database row (camelCase to snake_case, contract.md 3.7). Every row carries user_id. */
export function toRow(
  table: SyncTable,
  entity: Category | Task | Session | Settings,
  userId: string,
): Record<string, unknown> {
  switch (table) {
    case 'categories': {
      const c = entity as Category;
      return {
        user_id: userId,
        id: c.id,
        name: c.name,
        color: c.color,
        sort_order: c.order,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        deleted_at: c.deletedAt,
      };
    }
    case 'tasks': {
      const t = entity as Task;
      return {
        user_id: userId,
        id: t.id,
        name: t.name,
        category_id: t.categoryId,
        done: t.done,
        done_at: t.doneAt,
        sort_order: t.order,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        deleted_at: t.deletedAt,
      };
    }
    case 'sessions': {
      const s = entity as Session;
      return {
        user_id: userId,
        id: s.id,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        day: s.day,
        tz_offset_min: s.tzOffsetMin,
        planned_ms: s.plannedMs,
        focused_ms: s.focusedMs,
        task_id: s.taskId,
        task_name: s.taskName,
        category_id: s.categoryId,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        deleted_at: s.deletedAt,
      };
    }
    case 'settings': {
      const s = entity as Settings;
      const data: Record<string, unknown> = {};
      for (const k of SYNCED_SETTINGS_KEYS) data[k] = s[k];
      return { user_id: userId, data, updated_at: s.updatedAt };
    }
  }
}

/**
 * Database row -> entity, validated with the same rules as import. Returns null for an invalid
 * row. For settings it returns only the synced keys present in `data`, plus updatedAt.
 * `user_id` and `server_updated_at` are ignored here (the engine reads the latter for cursors).
 */
export function fromRow(
  table: SyncTable,
  row: Record<string, unknown>,
): Category | Task | Session | Partial<Settings> | null {
  if (!isRecord(row)) return null;
  switch (table) {
    case 'categories':
      return validateCategory({
        id: row.id,
        name: row.name,
        color: num(row.color),
        order: num(row.sort_order),
        createdAt: num(row.created_at),
        updatedAt: num(row.updated_at),
        deletedAt: num(row.deleted_at),
      });
    case 'tasks':
      return validateTask({
        id: row.id,
        name: row.name,
        categoryId: row.category_id,
        done: row.done,
        doneAt: num(row.done_at),
        order: num(row.sort_order),
        createdAt: num(row.created_at),
        updatedAt: num(row.updated_at),
        deletedAt: num(row.deleted_at),
      });
    case 'sessions':
      return validateSession({
        id: row.id,
        startedAt: num(row.started_at),
        endedAt: num(row.ended_at),
        day: row.day,
        tzOffsetMin: num(row.tz_offset_min),
        plannedMs: num(row.planned_ms),
        focusedMs: num(row.focused_ms),
        taskId: row.task_id,
        taskName: row.task_name,
        categoryId: row.category_id,
        createdAt: num(row.created_at),
        updatedAt: num(row.updated_at),
        deletedAt: num(row.deleted_at),
      });
    case 'settings': {
      const updatedAt = num(row.updated_at);
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) return null;
      if (!isRecord(row.data)) return null;
      // Same clamping as local settings; keep only keys the other device actually sent.
      const clean = validateSettings(row.data);
      const out: Partial<Settings> = { updatedAt: Math.floor(updatedAt) };
      for (const k of SYNCED_SETTINGS_KEYS) {
        if (!(k in row.data)) continue;
        if (k === 'displayName') {
          // an invalid pulled name is ignored (the local one stays), not replaced by the default
          const name = parseRemoteDisplayName(row.data[k]);
          if (name !== null) out.displayName = name;
        } else (out as Record<string, unknown>)[k] = clean[k];
      }
      return out;
    }
  }
}
