# Em Time: Interface Contract

This is the binding interface between the logic, frontend and QA agents. `frontend/src/core/types.ts` and `constants.ts` copy sections 2 and 7 verbatim; `frontend/supabase/migrations/20261015000000_em_time_sync.sql` copies section 10 verbatim. Changes require a note in `HANDOFF.md` and the Opus reviewer's OK.

Conventions: timestamps are epoch milliseconds (`number`, `bigint` in Postgres). Durations are milliseconds unless the name ends in `Min`. `ISODay` is a study-day key `YYYY-MM-DD` (spec EDGE-3). All functions in `core/` are pure unless marked otherwise. Minutes for display are always produced by `formatDuration`. Local writes never await the network.

## 1. Module map (`frontend/src/core/index.ts` exports)

```ts
export * from './types';
export * from './constants';
export { createEmCore } from './core';
export { createStubCore } from './stub';
export { createTimerEngine, timerReducer, initialTimerState } from './timer/engine';
export { dayKey, todayKey, addDays, diffDays, weekStart, isoWeekdayIndex, parseDay } from './time/calendar';
export { formatDuration, formatDayLabel, formatShortDate, formatRange, formatClock, numberWord } from './time/format';
export { dailyStats, todaySummary, streakInfo, trendSeries, heatmapCells, heatLevel, weekSummary, firstSessionDay, statsSessions } from './stats';
export { milestonesReached } from './stats/milestones';
export { createLocalStorageAdapter, createMemoryAdapter, loadData, saveData } from './storage/persist';
export { migrate, MIGRATIONS } from './storage/migrate';
export { exportData, parseImport, mergeData, applyRemoteRow } from './storage/exportImport';
export { createBag, nextFromBag, renderMessage } from './copy/picker';
export { createDefaultData, createDefaultSettings, createDefaultCategories, sessionId, uuid } from './store/defaults';
export { isSyncConfigured, readSyncEnv, hasStoredAuth } from './sync/env';
export type { SyncEngine } from './sync/engine';       // implementation lazy-loaded: import('./sync/engine')
export { toRow, fromRow } from './sync/rows';
```

`core/sync/engine.ts` is the only module that imports `@supabase/supabase-js`, and it is loaded with a dynamic `import()` (architecture.md section 9). Nothing in the main chunk imports it statically.

## 2. Types

```ts
export type ISODay = string;                 // 'YYYY-MM-DD'
export type Phase = 'focus' | 'short' | 'long';
export type TimerStatus = 'idle' | 'running' | 'paused';
export type CategoryColorSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type PresetId = '25/5' | '50/10' | '90/20' | 'custom';
export type ChimeId = 'glass' | 'bowl' | 'bell' | 'wood' | 'none';
export type ThemeId = 'light' | 'dark';
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
  updatedAt: number;          // last change to a SYNCED key only; 0 when untouched defaults
  // device-only keys
  theme: ThemeId;
  chime: ChimeId;
  volume: number;             // 0..1
  notifications: boolean;     // user intent; actual permission read at runtime
  keepAwake: boolean;
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
```

## 3. Core APIs

### 3.1 Calendar and format (pure)

```ts
dayKey(ts: number, dayStartHour: number = DAY_START_HOUR): ISODay
  // local wall clock: if local hour < dayStartHour, the previous calendar date; else the date
todayKey(now: number): ISODay
parseDay(day: ISODay): { y: number; m: number; d: number }
addDays(day: ISODay, n: number): ISODay               // Date.UTC math, DST-proof
diffDays(a: ISODay, b: ISODay): number
isoWeekdayIndex(day: ISODay): number                  // 0 Sunday .. 6 Saturday
weekStart(day: ISODay, weekStartsOn: 0 | 1): ISODay
formatDuration(ms: number): string                    // '0m', '45m', '1h', '1h 25m' (rounded minutes)
formatClock(ms: number): string                       // ceil seconds: '25:00', '0:59', '1:30:00'
formatDayLabel(day: ISODay): string                   // 'Tue, Oct 14'
formatShortDate(day: ISODay): string                  // 'Oct 14'
formatRange(start: ISODay, end: ISODay): string       // 'Oct 13 to Oct 19'
numberWord(n: number): string                         // 2..12 -> 'two'..'twelve', else String(n)
```

### 3.2 Timer engine

```ts
initialTimerState(cfg: TimerConfig, now: number): TimerState

interface TimerConfig { focusMs: number; shortMs: number; longMs: number; longEvery: number; autoStart: boolean; }

type TimerAction =
  | { type: 'start' } | { type: 'pause' } | { type: 'resume' } | { type: 'toggle' }
  | { type: 'skip' } | { type: 'reset' } | { type: 'setPhase'; phase: Phase }
  | { type: 'sync' } | { type: 'config'; cfg: TimerConfig };

interface PhaseEnd { phase: Phase; late: boolean; phaseStartedAt: number; endedAt: number; plannedMs: number; }

timerReducer(state: TimerState, action: TimerAction, now: number, cfg: TimerConfig):
  { state: TimerState; ended: PhaseEnd | null; autoStarted: boolean }

interface TimerDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  onVisibility?(fn: () => void): () => void;
}

interface TimerEvents {
  change: TimerState;
  phaseEnd: PhaseEnd & { nextPhase: Phase; autoStarted: boolean };
}

createTimerEngine(opts: { initial: TimerState; config: () => TimerConfig; deps?: TimerDeps }): TimerEngine

interface TimerEngine {
  getState(): TimerState;
  remainingMs(at?: number): number;
  progress(at?: number): number;      // remaining fraction 1 -> 0
  start(): void; pause(): void; resume(): void; toggle(): void;
  skip(): void; reset(): void; setPhase(p: Phase): void;
  sync(): void;
  configChanged(): void;
  adopt(state: TimerState): void;
  on<K extends keyof TimerEvents>(k: K, fn: (e: TimerEvents[K]) => void): () => void;
  dispose(): void;
}
```

Reducer rules (normative):
- `start` from idle: `phaseStartedAt = now`, `endsAt = now + remainingMs`, running.
- `pause`: `remainingMs = max(0, endsAt - now)`, `endsAt = null`. `resume`: `endsAt = now + remainingMs`.
- `sync` while running with `now >= endsAt`: `ended = { endedAt: endsAt, late: now - endsAt > LATE_GRACE_MS }`. Next phase per cycle rule. If `cfg.autoStart && !late`, next phase runs from the old `endsAt`. Otherwise next phase idle at full. At most one end per `sync`.
- `skip`: never returns `ended`. Focus (any status) -> `short` idle, cycle unchanged. Break -> `focus` idle. Never auto-starts.
- `reset`: running/paused -> same phase idle full. Idle-full focus -> `cycle = 0`. Never returns `ended`.
- `setPhase`: target phase idle full; discards current; never returns `ended`.
- Cycle: completed focus -> `cycle + 1`; if `>= longEvery`, next `long` and `cycle = 0`, else `short`.
- Engine keeps exactly one `setTimeout(sync, endsAt - now + 5)` while running.

### 3.3 Store and core

```ts
interface EmStore {
  get(): AppData;
  status(): StorageStatus;
  subscribe(fn: (data: AppData) => void): () => void;
  addTask(input: { name: string; categoryId?: string }): Task;
  updateTask(id: string, patch: Partial<Pick<Task, 'name' | 'categoryId' | 'order'>>): Task;
  setTaskDone(id: string, done: boolean): Task;
  deleteTask(id: string): void;
  clearDone(): number;
  setCurrentTask(id: string | null): void;
  addCategory(input: { name: string; color: CategoryColorSlot }): Category;
  updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'color' | 'order'>>): Category;
  deleteCategory(id: string, moveTasksTo: string): void;
  updateSettings(patch: Partial<Settings>): Settings;   // bumps updatedAt only if a synced key changed
  markExported(at: number): void;
  snoozeExportReminder(until: number): void;
  markNotificationPrompted(at: number): void;
  markPersistRequested(at: number): void;
  exportNow(now: number): { filename: string; json: string };
  importData(data: AppData, mode: 'replace' | 'merge'): void;
  eraseAll(now: number): void;                          // local reset, keeps deviceId
  // sync hooks (used by SyncEngine only)
  applyRemote(table: SyncTable, rows: unknown[]): { applied: number; dropped: number };
  takeDirty(): SyncMeta['dirty'];                       // snapshot, does not clear
  clearDirty(table: SyncTable, ids: string[] | true, snapshotUpdatedAt: Record<string, number>): void;
  markAllDirty(): void;
  tombstoneAll(now: number): void;                      // for "This device and the cloud"
  setSyncMeta(patch: Partial<SyncMeta>): void;
  onLocalWrite(fn: (table: SyncTable | null) => void): () => void; // null = non-synced change
}
```

Every mutating action: validate, mutate, set `updatedAt = max(now, previous updatedAt + 1)`, add the id to `meta.sync.dirty` when `meta.sync.userId !== null`, persist synchronously, notify subscribers, then call `onLocalWrite` listeners. `applyRemote` validates each row with the same rules as import, applies last-write-wins (section 3.7), never marks dirty, and does not fire `onLocalWrite`.

```ts
interface EmCore {
  store: EmStore;
  timer: TimerEngine;
  copy: Copy;
  onPhaseComplete(fn: (e: PhaseCompleteEvent) => void): () => void;
  select: {
    today(now?: number): TodaySummary;
    streak(now?: number): StreakInfo;
    week(offset: number, now?: number): WeekSummary;
    heatmap(now?: number): HeatmapCell[];
    trend(range: TrendRange, now?: number): TrendPoint[];
    taskWeekMs(taskId: string, now?: number): number;
    exportReminderDue(now?: number): boolean;           // false if synced within 7 days
  };
  loadSync(): Promise<SyncEngine | null>;              // null when not configured; memoized
  dispose(): void;
}

createEmCore(opts: {
  storage?: StorageAdapter;
  copy: Copy;
  deps?: TimerDeps;
  random?: () => number;
  now?: () => number;
  syncEnv?: Partial<SyncEnv>;      // default readSyncEnv()
  loadSupabase?: () => Promise<SupabaseFactory>; // test injection
}): EmCore

createStubCore(opts: { copy: Copy; now?: () => number }): EmCore  // fixture data, memory adapter, sync disabled
```

On a focus completion core builds a `Session` with `id = sessionId(deviceId, phaseStartedAt)`, upserts it (duplicate id = no-op, `session: null`), checks milestones (only when the session is new and logged on this device), picks message and prompt, persists, emits. On load, if `hasStoredAuth()` is true, core calls `loadSync()` immediately.

### 3.4 Stats (pure)

```ts
statsSessions(sessions: Session[], today: ISODay): Session[]   // drops deletedAt, future days, invalid
firstSessionDay(sessions: Session[]): ISODay | null
dailyStats(sessions: Session[], from: ISODay, to: ISODay): DailyStat[]
todaySummary(sessions: Session[], today: ISODay, goalMin: number): TodaySummary
streakInfo(sessions: Session[], today: ISODay): StreakInfo
trendSeries(sessions: Session[], today: ISODay, range: TrendRange): TrendPoint[]
heatmapCells(sessions: Session[], today: ISODay, weekStartsOn: 0 | 1, goalMin: number): HeatmapCell[]
heatLevel(focusMs: number, goalMin: number): HeatLevel
weekSummary(sessions: Session[], tasks: Task[], categories: Category[], today: ISODay,
            weekStartsOn: 0 | 1, offset: number): WeekSummary
milestonesReached(prev: { total: number; streak: StreakInfo }, next: { total: number; streak: StreakInfo },
                  shown: string[], copy: Copy): Milestone[]   // only thresholds crossed between prev and next
```

### 3.5 Storage, export, import

```ts
interface StorageAdapter {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}
createLocalStorageAdapter(): StorageAdapter
createMemoryAdapter(seed?: Record<string, string>): StorageAdapter

type LoadResult =
  | { status: 'new'; data: AppData }
  | { status: 'ok' | 'migrated'; data: AppData; dropped: number }
  | { status: 'recovered-corrupt'; data: AppData; backupKey: string }
  | { status: 'unavailable'; data: AppData }
  | { status: 'read-only-newer'; data: AppData };
loadData(adapter: StorageAdapter, now: number): LoadResult
saveData(adapter: StorageAdapter, data: AppData): { ok: true } | { ok: false; error: 'quota' | 'unavailable' | 'read-only-newer' }

migrate(raw: unknown): AppData                    // throws MigrationError('newer-version' | 'invalid')
MIGRATIONS: Record<number, (doc: any) => any>

exportData(data: AppData, now: number): { filename: string; json: string }

type ImportWarning =
  | { code: 'future-sessions'; count: number }
  | { code: 'dropped-records'; count: number }
  | { code: 'orphan-task-refs'; count: number }
  | { code: 'migrated'; from: number };
type ImportError = 'not-json' | 'not-em-time' | 'newer-version' | 'invalid-shape' | 'too-large' | 'empty';
type ImportResult =
  | { ok: true; data: AppData; warnings: ImportWarning[];
      summary: { sessions: number; tasks: number; categories: number; firstDay: ISODay | null; lastDay: ISODay | null } }
  | { ok: false; error: ImportError };
parseImport(text: string, now: number): ImportResult

mergeData(local: AppData, incoming: AppData): AppData   // union by id, per-entity LWW (3.7); local settings, timer, meta kept
applyRemoteRow<T extends EntityMeta>(local: T | undefined, remote: T): T // LWW rule of 3.7, pure
```

### 3.6 Copy picker (pure)

```ts
createBag(length: number, random: () => number): number[]
nextFromBag(bag: number[], eligible: (i: number) => boolean, length: number, random: () => number):
  { index: number; bag: number[] }
renderMessage(line: string, sessionsToday: number): string | null   // null if token and count < 2
```

### 3.7 Sync

```ts
interface SyncEnv { url: string; anonKey: string; }
readSyncEnv(): Partial<SyncEnv>                  // import.meta.env.VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
isSyncConfigured(env: Partial<SyncEnv>): env is SyncEnv   // both non-empty strings, url starts with https:// (or http://localhost)
hasStoredAuth(): boolean                         // localStorage has AUTH_STORAGE_KEY

sessionId(deviceId: string, startedAt: number): string
  // deviceId.slice(0, 24) + startedAt.toString(16).padStart(12, '0')
uuid(): string                                   // crypto.randomUUID, fallback getRandomValues v4

toRow(table: SyncTable, entity: Category | Task | Session | Settings, userId: string): Record<string, unknown>
fromRow(table: SyncTable, row: Record<string, unknown>): Category | Task | Session | Partial<Settings> | null // null = invalid

type SupabaseFactory = (url: string, key: string, options: object) => SupabaseLike;
interface SupabaseLike {             // the subset of supabase-js v2 used; unit tests mock exactly this
  auth: {
    signInWithOtp(a: { email: string; options: { emailRedirectTo: string; shouldCreateUser: true } }): Promise<{ error: AuthErrorLike | null }>;
    verifyOtp(a: { email: string; token: string; type: 'email' }): Promise<{ data: { session: SessionLike | null }; error: AuthErrorLike | null }>;
    getSession(): Promise<{ data: { session: SessionLike | null } }>;
    onAuthStateChange(cb: (event: string, session: SessionLike | null) => void): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<{ error: AuthErrorLike | null }>;
  };
  from(table: SyncTable): {
    upsert(rows: object[], opts: { onConflict: string; ignoreDuplicates: false }): Promise<{ error: PostgrestErrorLike | null }>;
    select(cols: '*'): {
      eq(col: 'user_id', v: string): {
        gt(col: 'server_updated_at', v: string): {
          order(col: 'server_updated_at', o: { ascending: true }): {
            range(from: number, to: number): Promise<{ data: object[] | null; error: PostgrestErrorLike | null }>;
          };
        };
      };
    };
  };
}

interface SyncDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  isOnline(): boolean;
  onOnline(fn: () => void): () => void;
  onVisible(fn: () => void): () => void;
  isVisible(): boolean;
}

createSyncEngine(opts: { store: EmStore; env: SyncEnv; createClient: SupabaseFactory; deps?: SyncDeps }): SyncEngine

interface SyncEngine {
  state(): SyncState;
  subscribe(fn: (s: SyncState) => void): () => void;
  requestCode(email: string): Promise<{ ok: true } | { ok: false; error: 'invalid-email' | 'rate-limited' | 'network' | 'unknown' }>;
  verifyCode(email: string, code: string): Promise<{ ok: true } | { ok: false; error: 'invalid-code' | 'expired' | 'network' | 'unknown' }>;
  signOut(): Promise<void>;                    // keeps local data; clears meta.sync.userId, dirty, cursors
  syncNow(): Promise<SyncResult>;
  eraseCloud(): Promise<{ ok: boolean }>;      // store.tombstoneAll, push, then store.eraseAll
  dispose(): void;
}
interface SyncResult { ok: boolean; pushed: Record<SyncTable, number>; pulled: Record<SyncTable, number>; rejected: number; }
```

Client options: `createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY } })`. `emailRedirectTo` = `location.origin + import.meta.env.BASE_URL`. After the client exchanges `?code=` on load, the engine removes the query string with `history.replaceState`, keeping the hash route.

Normative sync behavior:
1. **Triggers:** auth `SIGNED_IN` event, engine creation with an existing session (app open), `onVisible`, `onOnline`, `syncNow()`, and `store.onLocalWrite` for synced tables (debounce `SYNC_DEBOUNCE_MS`, max wait `SYNC_MAX_WAIT_MS`). Skipped while offline (status `offline`). Only one run at a time; a trigger during a run schedules exactly one follow-up run.
2. **Sign-in:** set `meta.sync.userId` and `email`; if `lastUserId` differs or is null, reset all cursors; always `store.markAllDirty()` (full push, merge never discards); set `lastUserId`; run.
3. **Run = push, then pull.**
   - Push, in order `categories`, `tasks`, `sessions`, `settings`: snapshot dirty ids and their `updatedAt`; map with `toRow`; `upsert` in chunks of `SYNC_BATCH_SIZE` with `onConflict: 'user_id,id'` (`'user_id'` for settings). On success, `clearDirty` for ids whose local `updatedAt` still equals the snapshot. A chunk failing with a Postgres check or constraint error (code class `23`) is retried row by row; rows that still fail are dropped from dirty and counted in `rejected`. Network or 5xx: stop, keep dirty, backoff.
   - Pull, same table order: `select('*').eq('user_id', uid).gt('server_updated_at', cursor - SYNC_PULL_OVERLAP_MS)` ordered ascending, pages of `SYNC_PAGE_SIZE` via `range`, until a short page. Each row: `fromRow` then `store.applyRemote`. Cursor = max `server_updated_at` seen. First pull uses the epoch as cursor.
4. **Last-write-wins (`applyRemoteRow`, also in the SQL trigger):** keep the version with greater `updatedAt`; on equal `updatedAt`, the one with non-null `deletedAt` wins; if still equal, keep local. Settings: compare `settings.updatedAt`; remote wins only if greater; only synced keys are applied.
5. **Backoff:** `SYNC_BACKOFF_MS` start, doubling, cap `SYNC_BACKOFF_MAX_MS`, reset on success. Status `error` with `nextRetryAt`.
6. **Auth expiry:** refresh failure or 401 -> status `auth-expired`, keep `userId` and dirty, stop runs until a new sign-in for the same user.
7. **Side effects:** pulled sessions never emit `onPhaseComplete`, never trigger milestones, chimes or messages.

Row mapping (`toRow` / `fromRow`), camelCase to snake_case:

| Table | Columns from entity |
|---|---|
| categories | `id`, `name`, `color`, `order -> sort_order`, `created_at`, `updated_at`, `deleted_at` |
| tasks | `id`, `name`, `category_id`, `done`, `done_at`, `order -> sort_order`, `created_at`, `updated_at`, `deleted_at` |
| sessions | `id`, `started_at`, `ended_at`, `day`, `tz_offset_min`, `planned_ms`, `focused_ms`, `task_id`, `task_name`, `category_id`, `created_at`, `updated_at`, `deleted_at` |
| settings | `data` (object of `SYNCED_SETTINGS_KEYS` only), `updated_at` |

Every row also carries `user_id`. `server_updated_at` is never sent; it is read on pull for the cursor only.

## 4. Chart geometry (frontend `charts/geometry.ts`, tested by QA)

```ts
monotonePath(points: { x: number; y: number }[]): string
linePaths(points: ({ x: number; y: number } | null)[]): string[]
niceMaxMinutes(maxMin: number): { max: number; step: number }   // step 30 below 180, 60 at or above
durationTicks(max: number, step: number): number[]
```

## 5. Example stored document (`em-time:data`)

Export files are the same shape plus `exportedAt`, with `meta.sync` reset to its default.

```json
{
  "app": "em-time",
  "schemaVersion": 1,
  "settings": {
    "preset": "25/5", "focusMin": 25, "shortMin": 5, "longMin": 15, "longEvery": 4,
    "autoStart": true, "dailyGoalMin": 120, "weekStartsOn": 1, "breakPrompts": true,
    "encouragement": true, "updatedAt": 0,
    "theme": "light", "chime": "glass", "volume": 0.6, "notifications": true, "keepAwake": true
  },
  "categories": [
    { "id": "5e5e0000-0000-4000-8000-000000000001", "name": "Study", "color": 1, "order": 0,
      "createdAt": 0, "updatedAt": 0, "deletedAt": null },
    { "id": "5e5e0000-0000-4000-8000-000000000002", "name": "Reading", "color": 2, "order": 1,
      "createdAt": 0, "updatedAt": 0, "deletedAt": null }
  ],
  "tasks": [
    { "id": "4b0e2f8a-77c2-4a8e-8b7d-2a3c1e9f0b11", "name": "Orgo chapter 7 problems",
      "categoryId": "5e5e0000-0000-4000-8000-000000000001", "done": false, "doneAt": null, "order": 0,
      "createdAt": 1791950000000, "updatedAt": 1791950000000, "deletedAt": null }
  ],
  "sessions": [
    { "id": "d2a9b6c4-0f3e-4d8a-9e21-01a13afb2520", "startedAt": 1791990900000, "endedAt": 1791992400000,
      "day": "2026-10-14", "tzOffsetMin": -420, "plannedMs": 1500000, "focusedMs": 1500000,
      "taskId": "4b0e2f8a-77c2-4a8e-8b7d-2a3c1e9f0b11", "taskName": "Orgo chapter 7 problems",
      "categoryId": "5e5e0000-0000-4000-8000-000000000001",
      "createdAt": 1791992400000, "updatedAt": 1791992400000, "deletedAt": null }
  ],
  "timer": {
    "phase": "short", "status": "running", "plannedMs": 300000, "remainingMs": 300000,
    "endsAt": 1791992700000, "phaseStartedAt": 1791992400000, "cycle": 1, "updatedAt": 1791992400000
  },
  "meta": {
    "deviceId": "d2a9b6c4-0f3e-4d8a-9e21-5c7b8a6d4e33", "createdAt": 1791900000000,
    "currentTaskId": "4b0e2f8a-77c2-4a8e-8b7d-2a3c1e9f0b11",
    "lastCategoryId": "5e5e0000-0000-4000-8000-000000000001",
    "milestonesShown": [], "lastExportAt": null, "exportReminderSnoozedUntil": null,
    "notificationPromptedAt": 1791990900000, "persistRequestedAt": 1791992400000,
    "bags": { "messages": [12, 3, 27], "prompts": [5, 0, 9] },
    "sync": {
      "userId": "9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b", "email": "em@example.com",
      "lastUserId": "9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b",
      "cursors": { "categories": "2026-10-14T15:00:02.118Z", "tasks": "2026-10-14T15:00:02.240Z",
                   "sessions": "2026-10-14T15:00:02.391Z", "settings": null },
      "dirty": { "categories": [], "tasks": [], "sessions": ["d2a9b6c4-0f3e-4d8a-9e21-01a13afb2520"], "settings": false },
      "lastSyncedAt": 1791990002500, "rejected": 0
    }
  }
}
```

The session ran 08:15 to 08:40 PDT on Wed Oct 14 2026 (after 06:00, so `day` is the same date) with auto-start on, so the short break is running. Its id is `sessionId(deviceId, startedAt)`; QA asserts this. It is still dirty because it completed after the last sync.

## 6. Error cases

| Case | Detection | Behavior | User copy |
|---|---|---|---|
| Corrupt storage | parse fails, root not object, `app !== 'em-time'` | Raw string to `em-time:corrupt:<now>`, fresh data, status `recovered-corrupt` | Banner: "Saved data couldn't be read, so Em Time started fresh. Your old data is kept as a file you can download." |
| Bad records inside valid doc | per-record validation | Drop, count | Console only on load |
| Storage unavailable | adapter throws | In-memory mode | Banner: "Em Time can't save on this device right now. Export to keep a copy." |
| Quota exceeded | `QuotaError` | Keep in memory, retry on next write | Same banner |
| Stored version newer | `schemaVersion > SCHEMA_VERSION` | Read-only, never write, sync disabled | Banner: "This data is from a newer version of Em Time. Refresh to update." |
| Import: not JSON / wrong app | parse fails / marker | No change | "That file isn't a backup from Em Time." |
| Import: newer version | version check | No change | "This backup is from a newer version. Refresh Em Time, then try again." |
| Import: invalid shape | required arrays missing | No change | "This backup looks damaged and can't be imported." |
| Import: too large | > 10 MB | No change | "That file is too large to be an Em Time backup." |
| Import: empty | 0 bytes | No change | "That file is empty." |
| Future-dated sessions (import or pull) | `startedAt > now + FUTURE_TOLERANCE_MS` | Kept, hidden from stats until their day | Import warning: "3 sessions are dated in the future and will appear on their dates." |
| Invalid session (`endedAt < startedAt`, `focusedMs` outside 0..`plannedMs`) | validation | Dropped (load, import, pull) | Warning count |
| Task with unknown `categoryId` | validation | Displayed under the first category; not rewritten (avoids sync churn) | None |
| Session with unknown `taskId` | allowed | Snapshot name "(deleted)" | None |
| Sync env missing | `isSyncConfigured` false | Sync disabled, no Supabase requests, Sync card hidden | None |
| Sign-in: invalid email | client regex + server 400 | Stay on form | "Enter a valid email address." |
| Sign-in: rate limited | 429 / `over_email_send_rate_limit` | Stay on form | "Too many tries. Wait a minute and try again." |
| Code wrong or expired | `verifyOtp` error | Stay on code form | "That code didn't work. Check the latest email or send a new one." |
| Offline during sync | `isOnline` false or fetch TypeError | Status `offline`, retry on `online` | "Offline, will sync when back online" |
| Server or network error | 5xx / timeout | Backoff, keep dirty | "Couldn't sync. Retrying." |
| Row rejected by DB constraint | Postgres `23xxx` | Drop from dirty, `rejected++` | "1 change couldn't sync" |
| Auth expired / revoked | refresh fails, 401 | Status `auth-expired`, keep dirty | "Sync paused: sign in again" |
| RLS denial (should never happen) | 403 / `42501` | Treat as auth-expired | Same |
| `crypto.randomUUID` missing | feature check | `getRandomValues` v4 fallback | None |

Store actions throw `ValidationError { field: string; reason: 'required' | 'too-long' | 'limit' | 'last-category' }`; nothing is persisted on error.

## 7. Shared constants (`core/constants.ts`)

```ts
export const APP_ID = 'em-time';
export const SCHEMA_VERSION = 1;
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
} as const;
export const DAILY_GOAL_STEP_MIN = 15;
export const DEFAULT_DAILY_GOAL_MIN = 120;
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
```

## 8. CSS custom properties (`frontend/src/styles/tokens.css`)

Values in design.md. Light values on `:root`, dark values on `:root[data-theme="dark"]`. QA asserts these names exist via `getComputedStyle`.

| Group | Names |
|---|---|
| Surfaces | `--em-bg`, `--em-bg-grad-top`, `--em-bg-grad-bottom`, `--em-surface`, `--em-surface-sunk`, `--em-border`, `--em-scrim` |
| Ink | `--em-ink`, `--em-ink-2`, `--em-ink-3` |
| Accent | `--em-accent`, `--em-accent-soft`, `--em-accent-text`, `--em-on-accent`, `--em-focus-ring` |
| Timer ring | `--em-ring-track`, `--em-ring-fill`, `--em-ring-glow` |
| Feedback | `--em-danger`, `--em-danger-soft` |
| Chart chrome | `--em-grid`, `--em-axis` |
| Heatmap | `--em-heat-0` ... `--em-heat-4` |
| Categories | `--em-cat-1` ... `--em-cat-8` |
| Type | `--em-font-sans`, `--em-fs-xs`, `--em-fs-sm`, `--em-fs-md`, `--em-fs-lg`, `--em-fs-xl`, `--em-fs-stat`, `--em-fs-timer`, `--em-fw-light`, `--em-fw-regular`, `--em-fw-medium`, `--em-fw-semibold` |
| Space | `--em-space-1` ... `--em-space-9` |
| Radius | `--em-radius-sm`, `--em-radius-md`, `--em-radius-lg`, `--em-radius-pill` |
| Shadow | `--em-shadow-sm`, `--em-shadow-md`, `--em-shadow-lg` |
| Motion | `--em-dur-fast`, `--em-dur-base`, `--em-dur-slow`, `--em-dur-refill`, `--em-dur-breath`, `--em-ease-standard`, `--em-ease-in`, `--em-ease-breath` |
| Layout | `--em-nav-h` (64px), `--em-content-max` (1120px), `--em-gutter` (32px desktop, 16px phone) |

## 9. DOM hooks and environment

`data-testid` values: `timer-digits`, `timer-ring`, `timer-play`, `timer-reset`, `timer-skip`, `mode-focus`, `mode-short`, `mode-long`, `current-task`, `cycle-dots`, `message-line`, `break-prompt`, `today-goal`, `nav-timer`, `nav-tasks`, `nav-stats`, `nav-settings`, `task-add-input`, `task-add-button`, `task-row`, `category-row`, `week-columns`, `week-prev`, `week-next`, `week-total`, `task-totals`, `heatmap`, `heatmap-cell` (with `data-day`, `data-level`), `trend-chart`, `trend-range-30|90|365`, `streak-current`, `streak-best`, `goal-ring`, `settings-theme`, `export-button`, `import-input`, `banner`, `live-region`, `sync-card`, `sync-email-input`, `sync-send`, `sync-code-input`, `sync-verify`, `sync-status`, `sync-now`, `sync-signout`.

`window.__emCore` is exposed when `import.meta.env.MODE !== 'production'` or the URL has `?e2e`; never relied on by the UI.

Environment variables (Vite, read only in `core/sync/env.ts`):

| Name | Required | Where |
|---|---|---|
| `VITE_SUPABASE_URL` | no (sync off when empty) | `.env.local` locally; GitHub repository secret for the Pages build |
| `VITE_SUPABASE_ANON_KEY` | no (sync off when empty) | same; the public anon or publishable key, never the service role key |
| `SUPABASE_SERVICE_ROLE_KEY` | tests only | local shell or the e2e step's env; never exposed to the build |

`.env.example` (committed) lists the two `VITE_` names with empty values; `.env`, `.env.local` are gitignored.

## 10. SQL migration (verbatim)

File: `frontend/supabase/migrations/20261015000000_em_time_sync.sql`. Dathan runs it once in the Supabase SQL editor or with `supabase db push`.

```sql
-- Em Time sync schema, v1
-- Local-first: clients generate UUIDs and epoch-ms timestamps; the server enforces
-- ownership (RLS) and last-write-wins (triggers). No hard deletes.

-- 1. Tables -----------------------------------------------------------------

create table if not exists public.categories (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                uuid        not null,
  name              text        not null check (char_length(name) between 1 and 30),
  color             smallint    not null check (color between 1 and 8),
  sort_order        integer     not null default 0,
  created_at        bigint      not null,
  updated_at        bigint      not null,
  deleted_at        bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table if not exists public.tasks (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                uuid        not null,
  name              text        not null check (char_length(name) between 1 and 80),
  category_id       uuid        not null,
  done              boolean     not null default false,
  done_at           bigint,
  sort_order        integer     not null default 0,
  created_at        bigint      not null,
  updated_at        bigint      not null,
  deleted_at        bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table if not exists public.sessions (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                uuid        not null,
  started_at        bigint      not null,
  ended_at          bigint      not null,
  day               date        not null,
  tz_offset_min     smallint    not null check (tz_offset_min between -840 and 840),
  planned_ms        integer     not null check (planned_ms > 0),
  focused_ms        integer     not null check (focused_ms >= 0 and focused_ms <= planned_ms),
  task_id           uuid,
  task_name         text        check (task_name is null or char_length(task_name) <= 80),
  category_id       uuid,
  created_at        bigint      not null,
  updated_at        bigint      not null,
  deleted_at        bigint,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  check (ended_at >= started_at)
);

create table if not exists public.settings (
  user_id           uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  data              jsonb       not null check (jsonb_typeof(data) = 'object'),
  updated_at        bigint      not null,
  server_updated_at timestamptz not null default clock_timestamp()
);

create index if not exists categories_pull_idx on public.categories (user_id, server_updated_at);
create index if not exists tasks_pull_idx      on public.tasks      (user_id, server_updated_at);
create index if not exists sessions_pull_idx   on public.sessions   (user_id, server_updated_at);

-- 2. Last-write-wins guards -------------------------------------------------

create or replace function public.em_lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  -- a device with a fast clock cannot claim the future
  if new.updated_at > server_ms + 600000 then
    new.updated_at := server_ms;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'user_id is immutable';
    end if;
    -- older write loses: keep the stored row unchanged
    if new.updated_at < old.updated_at then
      return null;
    end if;
    -- tie: only a new tombstone over a live row is applied; otherwise no-op
    if new.updated_at = old.updated_at
       and not (new.deleted_at is not null and old.deleted_at is null) then
      return null;
    end if;
  end if;

  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.em_lww_guard_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if new.updated_at > server_ms + 600000 then
    new.updated_at := server_ms;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'user_id is immutable';
    end if;
    if new.updated_at <= old.updated_at then
      return null;
    end if;
  end if;

  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists categories_lww on public.categories;
create trigger categories_lww before insert or update on public.categories
  for each row execute function public.em_lww_guard();

drop trigger if exists tasks_lww on public.tasks;
create trigger tasks_lww before insert or update on public.tasks
  for each row execute function public.em_lww_guard();

drop trigger if exists sessions_lww on public.sessions;
create trigger sessions_lww before insert or update on public.sessions
  for each row execute function public.em_lww_guard();

drop trigger if exists settings_lww on public.settings;
create trigger settings_lww before insert or update on public.settings
  for each row execute function public.em_lww_guard_settings();

-- 3. Row level security: own rows only, no deletes --------------------------

alter table public.categories enable row level security;
alter table public.tasks      enable row level security;
alter table public.sessions   enable row level security;
alter table public.settings   enable row level security;

create policy categories_select_own on public.categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy categories_insert_own on public.categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy categories_update_own on public.categories for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy tasks_select_own on public.tasks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy tasks_insert_own on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy tasks_update_own on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy sessions_select_own on public.sessions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy sessions_insert_own on public.sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy sessions_update_own on public.sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy settings_select_own on public.settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy settings_insert_own on public.settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy settings_update_own on public.settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 4. Grants: anon gets nothing; authenticated cannot delete ------------------

revoke all on public.categories, public.tasks, public.sessions, public.settings from anon;
revoke delete, truncate on public.categories, public.tasks, public.sessions, public.settings from authenticated;
grant select, insert, update on public.categories, public.tasks, public.sessions, public.settings to authenticated;
```

---

## v2 changes (Sky diary)

Additive unless marked "changed". Everything above stays binding. Core stays framework-free: the sky, mascot, stickers and greeting are frontend modules; core only gains settings fields, defaults, validation, migration and the synced-key change. No new core selector is needed (the greeting uses `select.today()` and `select.streak()`; sticker and sky phases come from the clock in the frontend).

### V2.1 Types (`core/types.ts`, changed)

```ts
export type ThemeId = 'sky' | 'light' | 'dark';   // changed: 'sky' added and is the default

export interface Settings {
  // synced keys (SYNCED_SETTINGS_KEYS)
  preset: PresetId;
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
  autoStart: boolean;
  dailyGoalMin: number;
  weekStartsOn: 0 | 1;
  breakPrompts: boolean;
  encouragement: boolean;
  displayName: string;        // NEW, synced. Trimmed, 0..24 chars, '' = no name. Default 'Em'.
  updatedAt: number;
  // device-only keys
  theme: ThemeId;             // default 'sky'
  chime: ChimeId;
  volume: number;
  notifications: boolean;
  keepAwake: boolean;
  mascot: boolean;            // NEW, device-only. Default true.
  stickers: boolean;          // NEW, device-only. Default true.
}
```

Migration-safe defaults are mandatory: every path that produces a `Settings` (`createDefaultSettings`, `validateSettings` on load, import, `mergeData`, sync `fromRow` merge) must fill a missing or invalid `displayName`, `mascot`, `stickers` or `theme` with its default and must never drop the document or the record because of them. `Copy` is unchanged; the frontend reads the new `sky` copy straight from `messages.json`.

### V2.2 Constants (`core/constants.ts`, changed)

```ts
export const SCHEMA_VERSION = 2;                       // changed from 1
export const DEFAULT_THEME = 'sky';                    // new
export const DEFAULT_DISPLAY_NAME = 'Em';              // new
export const DEFAULT_MASCOT = true;                    // new
export const DEFAULT_STICKERS = true;                  // new
// LIMITS gains:  displayName: [0, 24]
// SYNCED_SETTINGS_KEYS gains 'displayName' (appended last)
// DAY_PERIODS and GRADIENT_BLEND_MIN: deprecated, kept exported and unchanged, no longer used by the UI
```

### V2.3 Migration, validation, store

- `MIGRATIONS[1]` (v1 to v2): if `settings.theme === 'light'` set it to `'sky'`; leave `'dark'`; add `displayName: 'Em'`, `mascot: true`, `stickers: true` when absent. Does not touch `settings.updatedAt` (device-only and seeded values must not win sync). Applies to stored data and to imported v1 backup files alike.
- `validateSettings`: `theme` is kept if it is one of `'sky' | 'light' | 'dark'`, else `'sky'`; `displayName` must be a string, is trimmed, control characters (U+0000 to U+001F, U+007F) removed, and if longer than 24 code points after trimming it is cut to 24; non-string becomes `'Em'`; `mascot` and `stickers` are booleans, else `true`.
- `store.updateSettings`: `displayName` is trimmed; more than 24 code points throws `ValidationError('displayName', 'too-long')`; `''` is valid. A `displayName` change counts as a synced change (bumps `settings.updatedAt`, marks settings dirty). `theme` accepts the three values, else `ValidationError('theme', 'required')`. `mascot` and `stickers` must be booleans.
- Export files carry `schemaVersion: 2`. A v1 app opening v2 data goes read-only (`read-only-newer`), which is expected.

### V2.4 Sync

- `toRow('settings')` now includes `displayName` in `data`. No SQL change (`settings.data` is `jsonb`).
- `fromRow('settings')` and `applyRemote`: a pulled `displayName` is applied only if it is a string that passes the V2.3 rules; otherwise the key is ignored (local value kept). A row from a v1 device (no `displayName`) keeps the local value, as with any missing key today.
- `theme`, `mascot`, `stickers` must never appear in pushed `settings.data` (QA asserts).

### V2.5 `frontend/src/data/stickers.json`

```json
{
  "version": 1,
  "pools": {
    "medicine": ["🚑", "🩺", "🧬", "🩹", "🏥", "🧠", "💊", "🧪", "📚", "✏️", "🦴", "❤️‍🩹"],
    "girly":    ["🎀", "🌸", "💖", "✨", "💫", "🫧", "🦋", "🍓", "🧸", "🌈"],
    "makeup":   ["💄", "💅"],
    "night":    ["🌙", "⭐", "🦉", "🚑", "🔦"],
    "dawn":     ["☕", "🌅", "🐦"],
    "study":    ["📖", "🧠", "🧪", "✏️"]
  },
  "weights": {
    "latenight": { "medicine": 4, "girly": 2, "makeup": 0.5, "night": 5, "dawn": 0, "study": 2 },
    "dawn":      { "medicine": 2, "girly": 3, "makeup": 0.5, "night": 1, "dawn": 5, "study": 2 },
    "morning":   { "medicine": 3, "girly": 3, "makeup": 0.5, "night": 0, "dawn": 2, "study": 4 },
    "midday":    { "medicine": 3, "girly": 4, "makeup": 1,   "night": 0, "dawn": 0, "study": 4 },
    "afternoon": { "medicine": 3, "girly": 4, "makeup": 1,   "night": 0, "dawn": 0, "study": 3 },
    "dusk":      { "medicine": 3, "girly": 4, "makeup": 1,   "night": 2, "dawn": 0, "study": 2 },
    "evening":   { "medicine": 3, "girly": 3, "makeup": 1,   "night": 3, "dawn": 0, "study": 2 },
    "night":     { "medicine": 4, "girly": 2, "makeup": 0.5, "night": 5, "dawn": 0, "study": 2 }
  }
}
```

Schema rules: `version` is 1. `pools` maps a pool id (`[a-z][a-z0-9-]*`) to an array of strings, each exactly one grapheme; a pool may be empty. `weights` has exactly the 8 `SkyPhaseId` keys; each maps pool ids to numbers of at least 0. A pool missing from a phase's weights has weight 0 there; a weight naming an unknown pool is ignored. If every eligible pool is empty or zero for a phase, no sticker spawns in that phase (no error). Dathan may add pools and emoji freely. Frontend type:

```ts
export interface StickerData {
  version: 1;
  pools: Record<string, string[]>;
  weights: Record<SkyPhaseId, Record<string, number>>;
}
```

### V2.6 `messages.json` addition (frontend only)

```ts
sky: {
  greetings: Record<'dawn' | 'morning' | 'afternoon' | 'evening' | 'night', string[]>; // 3 each, spec Appendix D
  subline: {
    streakStar: string;        // "{n}-day streak, look at you"
    todayAndStreak: string;    // "{k} sessions today · {n}-day streak"
    todayAndStreakOne: string; // "{k} session today · {n}-day streak"
    today: string;             // "{k} sessions today"
    todayOne: string;          // "{k} session today"
    keepStreak: string;        // "Keep your {n}-day streak going"
    keepStreakOne: string;     // "Keep your streak going"
    ready: string;             // "Ready when you are"
  };
}
```

### V2.7 Frontend modules (not core; pure parts are Node-testable)

`frontend/src/platform/sky.ts` replaces `platform/gradient.ts` (delete it; keep its OKLab helpers here).

```ts
export type SkyPhaseId = 'latenight' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk' | 'evening' | 'night';
export type Polarity = 'light' | 'dark';

export interface SkyKeyframe {
  id: SkyPhaseId; atMin: number;                // minutes since local midnight
  top: string; mid: string; horizon: string; hillBack: string; hillFront: string;
  sunInner: string; sunOuter: string; sunGlow: string; moonGlow: string;   // glow as rgba()
  cloudFill: string; cloudOpacity: number; starOpacity: number;
}
export const SKY_KEYFRAMES: readonly SkyKeyframe[];       // design.md 2.1, exact values
export const POLARITY_FLIP_MIN: { toLight: 315; toDark: 1020 };   // 05:15, 17:00
export const SKY_INK: { dark: '#10263F'; light: '#FFFFFF' };

export interface BodyState { visible: boolean; p: number; opacity: number }
export interface SkyState {
  minutes: number;                // the (possibly pinned) clock used
  phase: SkyPhaseId;              // nearest keyframe by circular minute distance (ties go to the later)
  polarity: Polarity;
  top: string; mid: string; horizon: string; hillBack: string; hillFront: string;
  sunInner: string; sunOuter: string; sunGlow: string; moonGlow: string;
  cloudFill: string; cloudOpacity: number; starOpacity: number;
  ink: string;                    // SKY_INK value with the higher min contrast vs top and mid
  sun: BodyState; moon: BodyState & { illumination: number; waxing: boolean };
}

export function skyAt(minutes: number, date?: Date): SkyState;           // pure; date only for moon phase
export function skyFor(mode: ThemeId, now: Date): SkyState;              // 'light' pins 750 (12:30), 'dark' pins 1380 (23:00)
export function polarityAt(minutes: number): Polarity;                   // pure
export function arcPosition(p: number, vw: number, vh: number, kind: 'sun' | 'moon'): { x: number; y: number; size: number };
export function moonPhase(now: Date): { illumination: number; waxing: boolean };
export function contrastRatio(fg: string, bg: string): number;           // WCAG, exported for tests
export function composite(rgba: string, under: string): string;         // alpha over opaque hex
export function applySky(state: SkyState, root?: HTMLElement): void;    // writes V2.8 properties and html attributes, theme-color meta
export function startSky(getMode: () => ThemeId): () => void;           // minute-aligned tick, visibility and resize; returns stop
```

`frontend/src/app/greeting.ts` (pure):

```ts
export type GreetingWindow = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
export function greetingWindow(minutes: number): GreetingWindow;
export function greetingFor(input: {
  now: Date; studyDay: ISODay; name: string; todaySessions: number; streak: StreakInfo;
  copy: Messages['sky'];
}): { title: string; sub: string };
```

`frontend/src/platform/stickers.ts`:

```ts
export function validateStickerData(x: unknown): StickerData;           // throws on schema violation (QA uses it on the shipped file)
export function createStickerPicker(data: StickerData, rng: () => number): {
  pick(phase: SkyPhaseId, exclude?: readonly string[]): string | null;  // no back-to-back repeats, avoids `exclude`
  supported(filter: (emoji: string) => boolean): void;                  // drop emoji the device cannot draw
};
export function startStickers(opts: { layer: HTMLElement; picker: ReturnType<typeof createStickerPicker>;
  isFocusRunning: () => boolean; isNarrow: () => boolean; rng: () => number }): () => void;
export function burst(opts: { origin: DOMRect; count: number; picker: ReturnType<typeof createStickerPicker>; phase: SkyPhaseId }): void;
```

Timing constants live in `stickers.ts`: `FIRST_SPAWN_S = [20, 40]`, `SPAWN_S = [45, 90]`, `FOCUS_SPAWN_S = [120, 240]`, `MAX_ON_SCREEN = { wide: 3, narrow: 2, focus: 1 }`, `DRIFT_S = [30, 42]`, `BURST = { wide: 12, narrow: 9, milestoneWide: 18, milestoneNarrow: 14, ms: 1400 }`.

Randomness: one injectable `rng`. Builds with `VITE_E2E=1` and a URL with `?e2e&seed=<int>` use mulberry32 seeded with that integer; otherwise `Math.random`.

Device-only UI memory: localStorage key `em-time:ui`, JSON `{ lastWaveDay: ISODay | null }`, read and written with try/catch, never exported, synced or required. Erase all data removes it.

### V2.8 CSS custom properties (additions and changed values)

Set by `applySky` on `<html>` once per minute (scene):

| Group | Names |
|---|---|
| Sky | `--sky-top`, `--sky-mid`, `--sky-horizon`, `--sky-hill-back`, `--sky-hill-front`, `--sky-ink` |
| Bodies | `--sky-sun-inner`, `--sky-sun-outer`, `--sky-sun-glow`, `--sky-moon-glow`, `--sky-sun-x`, `--sky-sun-y`, `--sky-sun-size`, `--sky-sun-opacity`, `--sky-moon-x`, `--sky-moon-y`, `--sky-moon-size`, `--sky-moon-opacity` |
| Weather | `--sky-cloud-fill`, `--sky-cloud-opacity`, `--sky-star-opacity` |

Static in `tokens.css`, per polarity (`:root` light, `:root[data-theme="dark"]` dark):

| Group | Names |
|---|---|
| Glass (new) | `--em-glass`, `--em-glass-border`, `--em-surface-solid`, `--em-blur`, `--em-focus-halo` |
| Mascot (new) | `--mascot-fill`, `--mascot-line`, `--mascot-shade`, `--mascot-ink`, `--mascot-blush` |
| Type (new) | `--em-fs-greet`, `--em-fs-section`, `--em-fw-heavy` |
| Sticker (new) | `--sticker-size` (30px, 26px below 900 px) |
| Changed values | `--em-bg` = `var(--sky-mid)`; `--em-bg-grad-top` = `var(--sky-top)`; `--em-bg-grad-bottom` = `var(--sky-horizon)`; `--em-surface`, `--em-surface-sunk`, `--em-danger-soft`, `--em-scrim` become rgba; `--em-accent-text` light `#1A62A0`; `--em-focus-ring` light `#0F416F`; `--em-ink-3` dark `#8C9DB4`; `--em-ring-track`, `--em-ring-fill`, `--em-ring-glow`; `--em-font-sans` Nunito; type scale, weights, radii, shadows per design.md 2.6, 5, 6 |

`<html>` attributes: `data-theme` (`light` or `dark`, now the polarity), `data-sky-phase` (`SkyPhaseId`), `data-theme-mode` (`sky`, `light`, `dark`), `data-hidden` (present while the page is hidden).

### V2.9 DOM hooks (additions)

`data-testid`: `sky`, `sky-sun`, `sky-moon`, `sky-stars`, `sky-cloud` (3 elements), `sky-hills`, `sticker-layer`, `sticker` (with `data-emoji`), `sticker-burst`, `mascot` (with `data-state`: `idle | focusing | break | celebrate | wave`, and `data-accessory`: `none | headlamp`), `greeting`, `greeting-sub`, `settings-theme-sky`, `settings-theme-light`, `settings-theme-dark`, `settings-display-name`, `settings-mascot`, `settings-stickers`. `settings-theme` stays on the group.
