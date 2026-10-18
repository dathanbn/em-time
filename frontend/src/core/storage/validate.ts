import { APP_ID, FUTURE_TOLERANCE_MS, LIMITS, NOISE_IDS, PRESETS, SCHEMA_VERSION } from '../constants';
import { dayKey, isValidDay } from '../time/calendar';
import {
  createDefaultCategories,
  createDefaultMeta,
  createDefaultSettings,
  createDefaultSyncMeta,
} from '../store/defaults';
import { timerConfigFromSettings } from '../timer/config';
import { initialTimerState, phaseMs } from '../timer/reducer';
import type {
  AppData,
  Category,
  CategoryColorSlot,
  ChimeId,
  EntityMeta,
  Meta,
  NoiseId,
  PresetId,
  Session,
  Settings,
  SyncMeta,
  Task,
  ThemeId,
  TimerState,
} from '../types';
import type { TimerConfig } from '../api';
import { applyRemoteRow } from './lww';

type Rec = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT32_MAX = 2_147_483_647;

export const isRecord = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isMs = (x: unknown): x is number => isNum(x) && x >= 0 && Number.isSafeInteger(Math.floor(x));
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);

function entityMeta(r: Rec, fallbackCreated: number): EntityMeta | null {
  if (!isUuid(r.id)) return null;
  const createdAt = isMs(r.createdAt) ? Math.floor(r.createdAt) : fallbackCreated;
  const updatedAt = isMs(r.updatedAt) ? Math.floor(r.updatedAt) : createdAt;
  const deletedAt = isMs(r.deletedAt) ? Math.floor(r.deletedAt) : null;
  return { id: r.id, createdAt, updatedAt, deletedAt };
}

function cleanName(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  const name = x.trim();
  return name.length >= 1 && name.length <= max ? name : null;
}

export function validateCategory(x: unknown, index = 0): Category | null {
  if (!isRecord(x)) return null;
  const m = entityMeta(x, 0);
  const name = cleanName(x.name, LIMITS.categoryName[1]);
  if (!m || !name) return null;
  if (!isInt(x.color) || x.color < 1 || x.color > 8) return null;
  const order = isInt(x.order) ? x.order : index;
  return { ...m, name, color: x.color as CategoryColorSlot, order };
}

export function validateTask(x: unknown, index = 0): Task | null {
  if (!isRecord(x)) return null;
  const m = entityMeta(x, 0);
  const name = cleanName(x.name, LIMITS.taskName[1]);
  if (!m || !name || !isUuid(x.categoryId)) return null;
  const done = x.done === true;
  return {
    ...m,
    name,
    categoryId: x.categoryId,
    done,
    doneAt: done && isMs(x.doneAt) ? Math.floor(x.doneAt) : done ? m.updatedAt : null,
    order: isInt(x.order) ? x.order : index,
  };
}

/** EDGE-5: a session that ends before it starts, or with focusedMs outside 0..plannedMs, is dropped. */
export function validateSession(x: unknown): Session | null {
  if (!isRecord(x)) return null;
  if (!isMs(x.startedAt) || !isMs(x.endedAt) || x.endedAt < x.startedAt) return null;
  const startedAt = Math.floor(x.startedAt);
  const endedAt = Math.floor(x.endedAt);
  if (!isInt(x.plannedMs) || x.plannedMs <= 0 || x.plannedMs > INT32_MAX) return null;
  if (!isInt(x.focusedMs) || x.focusedMs < 0 || x.focusedMs > x.plannedMs) return null;
  const m = entityMeta(x, endedAt);
  if (!m) return null;
  const day = isValidDay(x.day) ? x.day : dayKey(startedAt);
  const tz =
    isInt(x.tzOffsetMin) && Math.abs(x.tzOffsetMin) <= 840
      ? x.tzOffsetMin
      : -new Date(startedAt).getTimezoneOffset();
  return {
    ...m,
    startedAt,
    endedAt,
    day,
    tzOffsetMin: tz,
    plannedMs: x.plannedMs,
    focusedMs: x.focusedMs,
    taskId: isUuid(x.taskId) ? x.taskId : null,
    taskName: typeof x.taskName === 'string' ? x.taskName.slice(0, LIMITS.taskName[1]) : null,
    categoryId: isUuid(x.categoryId) ? x.categoryId : null,
  };
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const DISPLAY_NAME_MAX = LIMITS.displayName[1];

/** Strips control characters (U+0000 to U+001F, U+007F) and trims. Length is not limited here. */
export function sanitizeDisplayName(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').trim();
}

/** Local load/import rule (V2.3): sanitize, then cut to 24 code points. Non-string gives null. */
function normalizeDisplayName(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = sanitizeDisplayName(x);
  const points = Array.from(s);
  return points.length > DISPLAY_NAME_MAX ? points.slice(0, DISPLAY_NAME_MAX).join('').trim() : s;
}

/** Pulled value rule (V2.4): a string that is within 24 code points after sanitizing, else null (ignored). */
export function parseRemoteDisplayName(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = sanitizeDisplayName(x);
  return Array.from(s).length <= DISPLAY_NAME_MAX ? s : null;
}

const THEMES: ThemeId[] = ['sky', 'light', 'dark'];

const clamp = (n: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, n));
const PRESET_IDS: PresetId[] = ['25/5', '50/10', '90/20', 'custom'];
const CHIMES: ChimeId[] = ['glass', 'bowl', 'bell', 'wood', 'none'];

/** Fills missing or invalid keys from defaults and clamps ranges (TMR-10). */
export function validateSettings(x: unknown): Settings {
  const d = createDefaultSettings();
  if (!isRecord(x)) return d;
  const int = (v: unknown, def: number, lim: readonly [number, number]) =>
    isNum(v) ? clamp(Math.round(v), lim) : def;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const preset: PresetId = PRESET_IDS.includes(x.preset as PresetId) ? (x.preset as PresetId) : d.preset;
  const mins =
    preset === 'custom'
      ? {
          focusMin: int(x.focusMin, d.focusMin, LIMITS.focusMin),
          shortMin: int(x.shortMin, d.shortMin, LIMITS.shortMin),
          longMin: int(x.longMin, d.longMin, LIMITS.longMin),
        }
      : { ...PRESETS[preset] };
  return {
    preset,
    ...mins,
    longEvery: int(x.longEvery, d.longEvery, LIMITS.longEvery),
    autoStart: bool(x.autoStart, d.autoStart),
    dailyGoalMin: int(x.dailyGoalMin, d.dailyGoalMin, LIMITS.dailyGoalMin),
    weekStartsOn: x.weekStartsOn === 0 ? 0 : x.weekStartsOn === 1 ? 1 : d.weekStartsOn,
    breakPrompts: bool(x.breakPrompts, d.breakPrompts),
    encouragement: bool(x.encouragement, d.encouragement),
    updatedAt: isMs(x.updatedAt) ? Math.floor(x.updatedAt) : 0,
    theme: THEMES.includes(x.theme as ThemeId) ? (x.theme as ThemeId) : d.theme,
    chime: CHIMES.includes(x.chime as ChimeId) ? (x.chime as ChimeId) : d.chime,
    volume: isNum(x.volume) ? clamp(x.volume, LIMITS.volume) : d.volume,
    notifications: bool(x.notifications, d.notifications),
    keepAwake: bool(x.keepAwake, d.keepAwake),
    displayName: normalizeDisplayName(x.displayName) ?? d.displayName,
    mascot: bool(x.mascot, d.mascot),
    stickers: bool(x.stickers, d.stickers),
    noiseOn: bool(x.noiseOn, d.noiseOn),
    noise: NOISE_IDS.includes(x.noise as NoiseId) ? (x.noise as NoiseId) : d.noise,
    noiseVolume: isNum(x.noiseVolume) ? clamp(x.noiseVolume, LIMITS.noiseVolume) : d.noiseVolume,
  };
}

/** A stored timer that does not make sense is replaced by a fresh idle focus phase. */
function validateTimer(x: unknown, cfg: TimerConfig, now: number): TimerState {
  const fresh = initialTimerState(cfg, now);
  if (!isRecord(x)) return fresh;
  const phase = x.phase;
  const status = x.status;
  if (phase !== 'focus' && phase !== 'short' && phase !== 'long') return fresh;
  if (status !== 'idle' && status !== 'running' && status !== 'paused') return fresh;
  if (!isNum(x.plannedMs) || x.plannedMs <= 0) return fresh;
  const cycle = isInt(x.cycle) && x.cycle >= 0 ? x.cycle : 0;
  const updatedAt = isMs(x.updatedAt) ? x.updatedAt : now;
  const planned = x.plannedMs;
  if (status === 'idle') {
    const p = phaseMs(phase, cfg);
    return {
      phase,
      status,
      plannedMs: p,
      remainingMs: p,
      endsAt: null,
      phaseStartedAt: null,
      cycle,
      updatedAt,
    };
  }
  if (status === 'paused') {
    if (!isNum(x.remainingMs) || x.remainingMs < 0 || x.remainingMs > planned) return fresh;
    return {
      phase,
      status,
      plannedMs: planned,
      remainingMs: x.remainingMs,
      endsAt: null,
      phaseStartedAt: isMs(x.phaseStartedAt) ? x.phaseStartedAt : null,
      cycle,
      updatedAt,
    };
  }
  if (!isMs(x.endsAt) || !isMs(x.phaseStartedAt)) return fresh;
  return {
    phase,
    status,
    plannedMs: planned,
    remainingMs:
      isNum(x.remainingMs) && x.remainingMs >= 0 && x.remainingMs <= planned ? x.remainingMs : planned,
    endsAt: x.endsAt,
    phaseStartedAt: x.phaseStartedAt,
    cycle,
    updatedAt,
  };
}

function validateSyncMeta(x: unknown): SyncMeta {
  const d = createDefaultSyncMeta();
  if (!isRecord(x)) return d;
  const strOrNull = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  const idList = (v: unknown) => (Array.isArray(v) ? v.filter(isUuid) : []);
  const cur = isRecord(x.cursors) ? x.cursors : {};
  const dirty = isRecord(x.dirty) ? x.dirty : {};
  return {
    userId: strOrNull(x.userId),
    email: strOrNull(x.email),
    lastUserId: strOrNull(x.lastUserId),
    cursors: {
      categories: strOrNull(cur.categories),
      tasks: strOrNull(cur.tasks),
      sessions: strOrNull(cur.sessions),
      settings: strOrNull(cur.settings),
    },
    dirty: {
      categories: idList(dirty.categories),
      tasks: idList(dirty.tasks),
      sessions: idList(dirty.sessions),
      settings: dirty.settings === true,
    },
    lastSyncedAt: isMs(x.lastSyncedAt) ? x.lastSyncedAt : null,
    rejected: isInt(x.rejected) && x.rejected > 0 ? x.rejected : 0,
  };
}

function validateMeta(x: unknown, now: number): Meta {
  const d = createDefaultMeta(now);
  if (!isRecord(x)) return d;
  const numOrNull = (v: unknown) => (isMs(v) ? v : null);
  const intList = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => isInt(n) && n >= 0) : []);
  const bags = isRecord(x.bags) ? x.bags : {};
  return {
    deviceId: isUuid(x.deviceId) ? x.deviceId : d.deviceId,
    createdAt: isMs(x.createdAt) ? x.createdAt : now,
    currentTaskId: isUuid(x.currentTaskId) ? x.currentTaskId : null,
    lastCategoryId: isUuid(x.lastCategoryId) ? x.lastCategoryId : null,
    milestonesShown: Array.isArray(x.milestonesShown)
      ? x.milestonesShown.filter((s): s is string => typeof s === 'string')
      : [],
    lastExportAt: numOrNull(x.lastExportAt),
    exportReminderSnoozedUntil: numOrNull(x.exportReminderSnoozedUntil),
    notificationPromptedAt: numOrNull(x.notificationPromptedAt),
    persistRequestedAt: numOrNull(x.persistRequestedAt),
    bags: { messages: intList(bags.messages), prompts: intList(bags.prompts) },
    sync: validateSyncMeta(x.sync),
  };
}

function dedupe<T extends EntityMeta>(list: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of list) map.set(item.id, applyRemoteRow(map.get(item.id), item));
  return [...map.values()];
}

export interface NormalizeResult {
  data: AppData;
  /** records dropped for failing validation */
  dropped: number;
  /** sessions dated more than FUTURE_TOLERANCE_MS ahead of `now` (kept, hidden until their day) */
  futureSessions: number;
  /** live tasks whose categoryId matches no category (kept, shown under the first category) */
  orphanTasks: number;
}

/**
 * Turns any parsed document into a valid AppData: drops bad records individually (counted),
 * fills missing parts from defaults, and guarantees at least one category. Never throws.
 * Missing or non-array collections are treated as empty; callers that must reject them
 * (import) check shape first.
 */
export function normalizeDocument(doc: unknown, now: number, _opts?: { strict?: boolean }): NormalizeResult {
  const src: Rec = isRecord(doc) ? doc : {};
  let dropped = 0;
  const collect = <T>(raw: unknown, fn: (x: unknown, i: number) => T | null): T[] => {
    if (!Array.isArray(raw)) return [];
    const out: T[] = [];
    raw.forEach((x, i) => {
      const v = fn(x, i);
      if (v === null) dropped += 1;
      else out.push(v);
    });
    return out;
  };

  let categories = dedupe(collect(src.categories, validateCategory));
  if (categories.every((c) => c.deletedAt !== null)) {
    const have = new Set(categories.map((c) => c.id));
    categories = [...categories, ...createDefaultCategories().filter((c) => !have.has(c.id))];
  }
  categories.sort((a, b) => a.order - b.order);

  const tasks = dedupe(collect(src.tasks, validateTask)).sort((a, b) => a.order - b.order);
  const catIds = new Set(categories.map((c) => c.id));
  const orphanTasks = tasks.filter((t) => t.deletedAt === null && !catIds.has(t.categoryId)).length;

  const sessions = dedupe(collect(src.sessions, (x) => validateSession(x))).sort(
    (a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1),
  );
  const futureSessions = sessions.filter((s) => s.startedAt > now + FUTURE_TOLERANCE_MS).length;

  const settings = validateSettings(src.settings);
  const timer = validateTimer(src.timer, timerConfigFromSettings(settings), now);
  const meta = validateMeta(src.meta, now);
  const liveTaskIds = new Set(tasks.filter((t) => t.deletedAt === null).map((t) => t.id));
  if (meta.currentTaskId !== null && !liveTaskIds.has(meta.currentTaskId)) meta.currentTaskId = null;
  if (meta.lastCategoryId !== null && !catIds.has(meta.lastCategoryId)) meta.lastCategoryId = null;

  return {
    data: { app: APP_ID, schemaVersion: SCHEMA_VERSION, settings, categories, tasks, sessions, timer, meta },
    dropped,
    futureSessions,
    orphanTasks,
  };
}
