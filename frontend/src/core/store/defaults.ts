import {
  APP_ID,
  DEFAULT_AUTO_START,
  DEFAULT_CATEGORIES,
  DEFAULT_CHIME,
  DEFAULT_DAILY_GOAL_MIN,
  DEFAULT_DISPLAY_NAME,
  DEFAULT_MASCOT,
  DEFAULT_NOISE,
  DEFAULT_NOISE_VOLUME,
  DEFAULT_STICKERS,
  DEFAULT_THEME,
  DEFAULT_LONG_EVERY,
  DEFAULT_PRESET,
  DEFAULT_VOLUME,
  DEFAULT_WEEK_STARTS_ON,
  PRESETS,
  SCHEMA_VERSION,
} from '../constants';
import { initialTimerState } from '../timer/reducer';
import { timerConfigFromSettings } from '../timer/config';
import type { AppData, Category, Meta, Settings, SyncMeta } from '../types';

/** crypto.randomUUID with a getRandomValues v4 fallback (and Math.random as a last resort). */
export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** deviceId.slice(0, 24) + startedAt as 12 hex digits: UUID-shaped, unique per device and start. */
export function sessionId(deviceId: string, startedAt: number): string {
  return deviceId.slice(0, 24) + Math.max(0, Math.floor(startedAt)).toString(16).padStart(12, '0');
}

export function createDefaultSettings(): Settings {
  const p = PRESETS[DEFAULT_PRESET];
  return {
    preset: DEFAULT_PRESET,
    focusMin: p.focusMin,
    shortMin: p.shortMin,
    longMin: p.longMin,
    longEvery: DEFAULT_LONG_EVERY,
    autoStart: DEFAULT_AUTO_START,
    dailyGoalMin: DEFAULT_DAILY_GOAL_MIN,
    weekStartsOn: DEFAULT_WEEK_STARTS_ON,
    breakPrompts: true,
    encouragement: true,
    updatedAt: 0,
    theme: DEFAULT_THEME,
    chime: DEFAULT_CHIME,
    volume: DEFAULT_VOLUME,
    notifications: true,
    keepAwake: true,
    displayName: DEFAULT_DISPLAY_NAME,
    mascot: DEFAULT_MASCOT,
    stickers: DEFAULT_STICKERS,
    noiseOn: false,
    noise: DEFAULT_NOISE,
    noiseVolume: DEFAULT_NOISE_VOLUME,
  };
}

/** Seeded categories: fixed ids, createdAt = updatedAt = 0 so any real edit anywhere wins. */
export function createDefaultCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((c, i) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    order: i,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  }));
}

export function createDefaultSyncMeta(): SyncMeta {
  return {
    userId: null,
    email: null,
    lastUserId: null,
    cursors: { categories: null, tasks: null, sessions: null, settings: null },
    dirty: { categories: [], tasks: [], sessions: [], settings: false },
    lastSyncedAt: null,
    rejected: 0,
  };
}

export function createDefaultMeta(now: number, deviceId: string = uuid()): Meta {
  return {
    deviceId,
    createdAt: now,
    currentTaskId: null,
    lastCategoryId: null,
    milestonesShown: [],
    lastExportAt: null,
    exportReminderSnoozedUntil: null,
    notificationPromptedAt: null,
    persistRequestedAt: null,
    bags: { messages: [], prompts: [] },
    sync: createDefaultSyncMeta(),
  };
}

/** First-run document. Pass `deviceId` to keep an existing device identity (erase, recovery). */
export function createDefaultData(now: number, deviceId?: string): AppData {
  const settings = createDefaultSettings();
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    settings,
    categories: createDefaultCategories(),
    tasks: [],
    sessions: [],
    timer: initialTimerState(timerConfigFromSettings(settings), now),
    meta: createDefaultMeta(now, deviceId),
  };
}
