// Interfaces from docs/contract.md section 3 (core APIs). Section 2 types live in ./types.ts.
// These are type-only declarations; the barrel (./index.ts) re-exports them.
import type {
  AppData,
  Category,
  CategoryColorSlot,
  Copy,
  HeatmapCell,
  ISODay,
  Phase,
  PhaseCompleteEvent,
  Settings,
  StorageStatus,
  StreakInfo,
  SyncMeta,
  SyncTable,
  Task,
  TimerState,
  TodaySummary,
  TrendPoint,
  TrendRange,
  WeekSummary,
} from './types';
import type { SyncEngine } from './sync/engine';

// ---- 3.2 Timer engine --------------------------------------------------------

export interface TimerConfig {
  focusMs: number;
  shortMs: number;
  longMs: number;
  longEvery: number;
  autoStart: boolean;
}

export type TimerAction =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'toggle' }
  | { type: 'skip' }
  | { type: 'reset' }
  | { type: 'setPhase'; phase: Phase }
  | { type: 'sync' }
  | { type: 'config'; cfg: TimerConfig };

export interface PhaseEnd {
  phase: Phase;
  late: boolean;
  phaseStartedAt: number;
  endedAt: number;
  plannedMs: number;
}

export interface TimerDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  onVisibility?(fn: () => void): () => void;
}

export interface TimerEvents {
  change: TimerState;
  phaseEnd: PhaseEnd & { nextPhase: Phase; autoStarted: boolean };
}

export interface TimerEngine {
  getState(): TimerState;
  remainingMs(at?: number): number;
  progress(at?: number): number; // remaining fraction 1 -> 0
  start(): void;
  pause(): void;
  resume(): void;
  toggle(): void;
  skip(): void;
  reset(): void;
  setPhase(p: Phase): void;
  sync(): void;
  configChanged(): void;
  adopt(state: TimerState): void;
  on<K extends keyof TimerEvents>(k: K, fn: (e: TimerEvents[K]) => void): () => void;
  dispose(): void;
}

// ---- 3.3 Store and core ------------------------------------------------------

export interface EmStore {
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
  updateSettings(patch: Partial<Settings>): Settings; // bumps updatedAt only if a synced key changed
  markExported(at: number): void;
  snoozeExportReminder(until: number): void;
  markNotificationPrompted(at: number): void;
  markPersistRequested(at: number): void;
  exportNow(now: number): { filename: string; json: string };
  importData(data: AppData, mode: 'replace' | 'merge'): void;
  eraseAll(now: number): void; // local reset, keeps deviceId
  // sync hooks (used by SyncEngine only)
  applyRemote(table: SyncTable, rows: unknown[]): { applied: number; dropped: number };
  takeDirty(): SyncMeta['dirty']; // snapshot, does not clear
  clearDirty(table: SyncTable, ids: string[] | true, snapshotUpdatedAt: Record<string, number>): void;
  markAllDirty(): void;
  tombstoneAll(now: number): void; // for "This device and the cloud"
  setSyncMeta(patch: Partial<SyncMeta>): void;
  onLocalWrite(fn: (table: SyncTable | null) => void): () => void; // null = non-synced change
}

export interface EmCore {
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
    exportReminderDue(now?: number): boolean; // false if synced within 7 days
  };
  loadSync(): Promise<SyncEngine | null>; // null when not configured; memoized
  dispose(): void;
  /**
   * ADDITION (not in contract.md, see HANDOFF.md): draws the next break suggestion from the
   * persisted shuffle bag, or null when "Break suggestions" is off. Lets the UI show a prompt
   * when a break starts through Skip or the mode switcher, where no PhaseCompleteEvent exists.
   */
  pickBreakPrompt(): string | null;
  /**
   * ADDITION (not in contract.md, see HANDOFF.md): how storage loaded at startup. The UI needs
   * `recovered-corrupt` plus `backupKey` for the corrupt-data banner (read the raw string with
   * the storage adapter under that key to offer the download).
   */
  boot: { status: LoadResult['status']; backupKey: string | null; dropped: number };
}

export interface EmCoreOptions {
  storage?: StorageAdapter;
  copy: Copy;
  deps?: TimerDeps;
  random?: () => number;
  now?: () => number;
  syncEnv?: Partial<SyncEnv>; // default readSyncEnv()
  loadSupabase?: () => Promise<SupabaseFactory>; // test injection
}

export interface StubCoreOptions {
  copy: Copy;
  now?: () => number;
  /** ADDITION: true gives a first-run core (no sessions, no tasks) for empty-state work. */
  empty?: boolean;
}

// ---- 3.5 Storage -------------------------------------------------------------

export interface StorageAdapter {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export type LoadResult =
  | { status: 'new'; data: AppData }
  | { status: 'ok' | 'migrated'; data: AppData; dropped: number }
  | { status: 'recovered-corrupt'; data: AppData; backupKey: string }
  | { status: 'unavailable'; data: AppData }
  | { status: 'read-only-newer'; data: AppData };

export type SaveResult = { ok: true } | { ok: false; error: 'quota' | 'unavailable' | 'read-only-newer' };

export type ImportWarning =
  | { code: 'future-sessions'; count: number }
  | { code: 'dropped-records'; count: number }
  | { code: 'orphan-task-refs'; count: number }
  | { code: 'migrated'; from: number };
export type ImportError =
  'not-json' | 'not-em-time' | 'newer-version' | 'invalid-shape' | 'too-large' | 'empty';
export type ImportResult =
  | {
      ok: true;
      data: AppData;
      warnings: ImportWarning[];
      summary: {
        sessions: number;
        tasks: number;
        categories: number;
        firstDay: ISODay | null;
        lastDay: ISODay | null;
      };
    }
  | { ok: false; error: ImportError };

// ---- 3.7 Sync ----------------------------------------------------------------

export interface SyncEnv {
  url: string;
  anonKey: string;
}

// The contract names these three but does not define them (see HANDOFF.md): minimal shapes.
export interface AuthErrorLike {
  message: string;
  status?: number;
  code?: string;
  name?: string;
}
export interface PostgrestErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}
export interface SessionLike {
  access_token: string;
  user: { id: string; email?: string | null };
}

export type SupabaseFactory = (url: string, key: string, options: object) => SupabaseLike;

export interface SupabaseLike {
  auth: {
    signInWithOtp(a: {
      email: string;
      options: { emailRedirectTo: string; shouldCreateUser: true };
    }): Promise<{ error: AuthErrorLike | null }>;
    verifyOtp(a: {
      email: string;
      token: string;
      type: 'email';
    }): Promise<{ data: { session: SessionLike | null }; error: AuthErrorLike | null }>;
    getSession(): Promise<{ data: { session: SessionLike | null } }>;
    onAuthStateChange(cb: (event: string, session: SessionLike | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
    /** `scope: 'local'` (an addition to the contract's no-argument form) keeps other devices signed in. */
    signOut(opts?: { scope: 'local' }): Promise<{ error: AuthErrorLike | null }>;
  };
  from(table: SyncTable): {
    upsert(
      rows: object[],
      opts: { onConflict: string; ignoreDuplicates: false },
    ): Promise<{ error: PostgrestErrorLike | null }>;
    select(cols: '*'): {
      eq(
        col: 'user_id',
        v: string,
      ): {
        gt(
          col: 'server_updated_at',
          v: string,
        ): {
          order(
            col: 'server_updated_at',
            o: { ascending: true },
          ): {
            range(
              from: number,
              to: number,
            ): Promise<{ data: object[] | null; error: PostgrestErrorLike | null }>;
          };
        };
      };
    };
  };
}

export interface SyncDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  isOnline(): boolean;
  onOnline(fn: () => void): () => void;
  onVisible(fn: () => void): () => void;
  isVisible(): boolean;
}

export interface SyncResult {
  ok: boolean;
  pushed: Record<SyncTable, number>;
  pulled: Record<SyncTable, number>;
  rejected: number;
}
