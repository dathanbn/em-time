// docs/contract.md section 2 as amended by "v2 changes" V2.1 (ThemeId, displayName, mascot, stickers).
// Do not edit without a HANDOFF.md note.
export type ISODay = string;                 // 'YYYY-MM-DD'
export type Phase = 'focus' | 'short' | 'long';
export type TimerStatus = 'idle' | 'running' | 'paused';
export type CategoryColorSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type PresetId = '25/5' | '50/10' | '90/20' | 'custom';
export type ChimeId = 'glass' | 'bowl' | 'bell' | 'wood' | 'none';
export type ThemeId = 'sky' | 'light' | 'dark';   // v2: 'sky' added and is the default
export type NoiseId =                              // v4: focus sounds (3 synthesized, 6 recorded)
  | 'white' | 'pink' | 'brown' | 'rain' | 'waves' | 'stream' | 'cafe' | 'fireplace' | 'night';
export type TrendRange = 30 | 90 | 365;
export type HeatLevel = 0 | 1 | 2 | 3 | 4;
export type StorageStatus = 'ok' | 'quota' | 'unavailable' | 'read-only-newer';
export type SyncTable = 'categories' | 'tasks' | 'sessions' | 'settings';

export interface EntityMeta {
  id: string;                 // UUID. Random (uuid()) except default categories and sessions.
  createdAt: number;
  updatedAt: number;          // last local change; 0 for seeded defaults; drives last-write-wins
  deletedAt: number | null;   // soft delete (tombstone), hidden everywhere in UI and stats
}

export interface Category extends EntityMeta {
  name: string;               // 1..30 chars, trimmed
  color: CategoryColorSlot;
  order: number;              // ascending display order
}

export interface Task extends EntityMeta {
  name: string;               // 1..80 chars, trimmed
  categoryId: string;
  done: boolean;
  doneAt: number | null;
  order: number;              // ascending; new tasks get min(order) - 1
}

export interface Session extends EntityMeta {
  // id = sessionId(meta.deviceId, startedAt)  (idempotent across tabs; unique across devices)
  startedAt: number;          // first start of the phase run
  endedAt: number;            // = the phase's endsAt
  day: ISODay;                // dayKey(startedAt) at log time
  tzOffsetMin: number;        // -new Date(startedAt).getTimezoneOffset()
  plannedMs: number;
  focusedMs: number;          // always === plannedMs in v1 (only completed sessions are logged)
  taskId: string | null;      // task current at completion
  taskName: string | null;    // snapshot of task name at log time
  categoryId: string | null;  // snapshot of task's category at log time
}

export interface Settings {
  // synced keys (SYNCED_SETTINGS_KEYS)
  preset: PresetId;
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
  autoStart: boolean;         // default true
  dailyGoalMin: number;
  weekStartsOn: 0 | 1;        // 0 Sunday, 1 Monday
  breakPrompts: boolean;
  encouragement: boolean;
  displayName: string;        // v2, synced. Trimmed, 0..24 chars, '' = no name. Default 'Em'.
  updatedAt: number;          // last change to a SYNCED key only; 0 when untouched defaults
  // device-only keys
  theme: ThemeId;             // default 'sky'
  chime: ChimeId;
  volume: number;             // 0..1
  notifications: boolean;     // user intent; actual permission read at runtime
  keepAwake: boolean;
  mascot: boolean;            // v2, device-only. Default true.
  stickers: boolean;          // v2, device-only. Default true.
  noiseOn: boolean;           // v4, device-only. Focus sounds on. Default false.
  noise: NoiseId;             // v4, device-only. Default 'rain'.
  noiseVolume: number;        // v4, device-only. 0..1, default 0.5 (separate from chime volume).
}

export interface TimerState {
  phase: Phase;
  status: TimerStatus;
  plannedMs: number;
  remainingMs: number;        // authoritative when idle or paused
  endsAt: number | null;      // authoritative when running
  phaseStartedAt: number | null;
  cycle: number;              // completed focus sessions since last long break
  updatedAt: number;
}

export interface SyncMeta {
  userId: string | null;      // non-null while signed in (dirty tracking active)
  email: string | null;
  lastUserId: string | null;  // last account ever signed in on this device (EDGE-12)
  cursors: Record<SyncTable, string | null>; // max server_updated_at seen (ISO string)
  dirty: { categories: string[]; tasks: string[]; sessions: string[]; settings: boolean };
  lastSyncedAt: number | null;
  rejected: number;           // rows the server refused since last success
}

export interface Meta {
  deviceId: string;           // uuid(), created once, survives Erase
  createdAt: number;
  currentTaskId: string | null;
  lastCategoryId: string | null;
  milestonesShown: string[];  // MilestoneId values plus 'streak-7@<startDay>' keys
  lastExportAt: number | null;
  exportReminderSnoozedUntil: number | null;
  notificationPromptedAt: number | null;
  persistRequestedAt: number | null;
  bags: { messages: number[]; prompts: number[] };
  sync: SyncMeta;
}

export interface AppData {
  app: 'em-time';
  schemaVersion: number;      // SCHEMA_VERSION
  exportedAt?: number;        // only in export files
  settings: Settings;
  categories: Category[];
  tasks: Task[];
  sessions: Session[];        // sorted by startedAt ascending
  timer: TimerState;
  meta: Meta;                 // export strips meta.sync (cursors, dirty, user) to its default
}

export interface DailyStat {
  day: ISODay;
  focusMs: number;
  sessions: number;
}

export interface TodaySummary {
  day: ISODay;
  focusMs: number;
  sessions: number;
  goalMs: number;
  progress: number;           // focusMs / goalMs, NOT clamped (UI clamps the ring)
  goalMet: boolean;
}

export interface StreakInfo {
  current: number;
  best: number;
  todayCounts: boolean;
  currentStartDay: ISODay | null;
  lastCountingDay: ISODay | null;
}

export interface TaskTotal {
  taskId: string | null;      // null = "No task"; '__other__' = folded rows
  name: string;               // live task name, else snapshot, else 'No task' / 'Other tasks'
  categoryId: string | null;
  color: CategoryColorSlot | null; // null = neutral swatch (no task, deleted, other)
  deleted: boolean;
  focusMs: number;
  sessions: number;
}

export interface WeekSummary {
  start: ISODay;
  end: ISODay;
  offset: number;             // 0 = current week, -1 = previous ...
  days: DailyStat[];          // exactly 7, in display order
  todayIndex: number | null;
  totalMs: number;
  sessions: number;
  perTask: TaskTotal[];       // sorted desc by focusMs, max 7 + optional '__other__'
  hasPrev: boolean;
  hasNext: boolean;
}

export interface HeatmapCell {
  day: ISODay;
  col: number;                // 0..8, 8 = current week
  row: number;                // 0..6, 0 = weekStartsOn
  focusMs: number;
  level: HeatLevel;
  isToday: boolean;
  label: string;              // 'Tue, Oct 14 · 1h 25m'
}                             // future days are omitted

export interface TrendPoint {
  day: ISODay;
  valueMin: number | null;    // null before the first-ever session day
  avgMin: number | null;      // 7-day trailing mean, null per TR-2 and for today
  isToday: boolean;
}

export type MilestoneId = 'sessions-10' | 'sessions-50' | 'sessions-100' | 'sessions-250' | 'streak-7' | 'streak-30';
export interface Milestone { id: MilestoneId; key: string; text: string; }

export interface Copy {
  encouragement: string[];
  breakPrompts: string[];
  milestones: Record<MilestoneId, string>;
  aboutLine: string;
}

export interface PhaseCompleteEvent {  // emitted only when a phase reaches 00:00
  phase: Phase;
  late: boolean;
  session: Session | null;    // logged session (focus), or null (break, duplicate)
  nextPhase: Phase;
  autoStarted: boolean;
  message: string | null;
  milestone: Milestone | null;
  breakPrompt: string | null;
}

export type SyncStatus =
  | 'disabled'      // env missing
  | 'signed-out'
  | 'code-sent'     // waiting for link or code
  | 'idle'          // signed in, nothing pending
  | 'syncing'
  | 'offline'
  | 'error'         // retrying with backoff
  | 'auth-expired';

export interface SyncState {
  status: SyncStatus;
  email: string | null;
  lastSyncedAt: number | null;
  pending: number;            // dirty row count
  rejected: number;
  nextRetryAt: number | null;
}
