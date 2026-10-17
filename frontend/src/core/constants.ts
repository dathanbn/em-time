// docs/contract.md section 7 as amended by "v2 changes" V2.2. Do not edit without a HANDOFF.md note.
import type { NoiseId } from './types';
export const APP_ID = 'em-time';
export const SCHEMA_VERSION = 2;                       // v2 (was 1)
export const STORAGE_KEY = 'em-time:data';
export const CORRUPT_KEY_PREFIX = 'em-time:corrupt:';
export const AUTH_STORAGE_KEY = 'em-time:auth';
export const MIN = 60_000;

export const PRESETS = {
  '25/5':  { focusMin: 25, shortMin: 5,  longMin: 15 },
  '50/10': { focusMin: 50, shortMin: 10, longMin: 30 },
  '90/20': { focusMin: 90, shortMin: 20, longMin: 30 },
} as const;
export const DEFAULT_PRESET = '25/5';
export const DEFAULT_LONG_EVERY = 4;
export const DEFAULT_AUTO_START = true;
export const LIMITS = {
  focusMin: [1, 180], shortMin: [1, 60], longMin: [1, 90], longEvery: [2, 8],
  dailyGoalMin: [15, 720], volume: [0, 1],
  taskName: [1, 80], categoryName: [1, 30], categories: [1, 8],
  displayName: [0, 24], noiseVolume: [0, 1],
} as const;
export const DAILY_GOAL_STEP_MIN = 15;
export const DEFAULT_DAILY_GOAL_MIN = 120;
export const DEFAULT_THEME = 'sky';                    // v2
export const DEFAULT_DISPLAY_NAME = 'Em';              // v2
export const DEFAULT_MASCOT = true;                    // v2
export const DEFAULT_STICKERS = true;                  // v2
export const NOISE_IDS = [                             // v4, catalog order
  'white', 'pink', 'brown', 'rain', 'waves', 'stream', 'cafe', 'fireplace', 'night',
] as const satisfies readonly NoiseId[];
export const DEFAULT_NOISE = 'rain';                     // v4
export const DEFAULT_NOISE_VOLUME = 0.5;                // v4
export const DAY_START_HOUR = 6;           // study day = local start time minus 6 hours
export const DEFAULT_WEEK_STARTS_ON = 1;
export const DEFAULT_VOLUME = 0.6;
export const DEFAULT_CHIME = 'glass';

export const LATE_GRACE_MS = 60_000;
export const FUTURE_TOLERANCE_MS = 10 * 60_000;
export const DISCARD_CONFIRM_MS = 60_000;

export const SESSION_MILESTONES = [10, 50, 100, 250] as const;
export const STREAK_MILESTONES = [7, 30] as const;

export const HEAT_FRACTIONS = [0.25, 0.5, 1.0] as const;
export const HEATMAP_WEEKS = 9;
export const TREND_RANGES = [30, 90, 365] as const;
export const DEFAULT_TREND_RANGE = 30;
export const MA_WINDOW_DAYS = 7;
export const MA_MIN_DAYS = 3;
export const WEEK_TASK_ROWS = 7;

export const EXPORT_REMINDER = { firstAfterSessions: 10, everyDays: 14, snoozeDays: 7, suppressIfSyncedWithinDays: 7 } as const;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export const DEFAULT_CATEGORIES = [
  { id: '5e5e0000-0000-4000-8000-000000000001', name: 'Study',        color: 1 },
  { id: '5e5e0000-0000-4000-8000-000000000002', name: 'Reading',      color: 2 },
  { id: '5e5e0000-0000-4000-8000-000000000003', name: 'Problem sets', color: 3 },
  { id: '5e5e0000-0000-4000-8000-000000000004', name: 'Writing',      color: 4 },
  { id: '5e5e0000-0000-4000-8000-000000000005', name: 'Review',       color: 5 },
] as const;                                 // seeded with createdAt = updatedAt = 0

export const SYNC_TABLES = ['categories', 'tasks', 'sessions', 'settings'] as const;
export const SYNCED_SETTINGS_KEYS = [
  'preset', 'focusMin', 'shortMin', 'longMin', 'longEvery', 'autoStart',
  'dailyGoalMin', 'weekStartsOn', 'breakPrompts', 'encouragement',
  'displayName',
] as const;
export const SYNC_DEBOUNCE_MS = 2_000;
export const SYNC_MAX_WAIT_MS = 10_000;
export const SYNC_BATCH_SIZE = 500;
export const SYNC_PAGE_SIZE = 1_000;
export const SYNC_PULL_OVERLAP_MS = 60_000;
export const SYNC_BACKOFF_MS = 5_000;
export const SYNC_BACKOFF_MAX_MS = 5 * 60_000;

export const ANNOUNCE_MINUTES_LEFT = [20, 15, 10, 5, 1] as const;
export const DAY_PERIODS = [
  { id: 'dawn', from: 5 }, { id: 'day', from: 9 }, { id: 'dusk', from: 17 }, { id: 'night', from: 20 },
] as const;
export const GRADIENT_BLEND_MIN = 60;
