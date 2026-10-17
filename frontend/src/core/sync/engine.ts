// The only module that imports @supabase/supabase-js, and only through a dynamic import() inside
// loadSupabaseFactory. It is reached solely via core.loadSync() (a dynamic import itself), so
// neither this file nor supabase-js is in the main chunk. See docs/architecture.md section 9.
import {
  AUTH_STORAGE_KEY,
  SYNC_BACKOFF_MAX_MS,
  SYNC_BACKOFF_MS,
  SYNC_BATCH_SIZE,
  SYNC_DEBOUNCE_MS,
  SYNC_MAX_WAIT_MS,
  SYNC_PAGE_SIZE,
  SYNC_PULL_OVERLAP_MS,
  SYNC_TABLES,
} from '../constants';
import { createDefaultSyncMeta } from '../store/defaults';
import type {
  AuthErrorLike,
  EmStore,
  PostgrestErrorLike,
  SessionLike,
  SupabaseFactory,
  SupabaseLike,
  SyncDeps,
  SyncEnv,
  SyncResult,
} from '../api';
import type { Category, Session, SyncState, SyncStatus, SyncTable, Task } from '../types';
import { fromRow, toRow } from './rows';
import { deriveSyncCredentials, SYNC_CODE_EMAIL_DOMAIN, type SyncCodeError } from './syncCode';

export type SignInWithCodeError = SyncCodeError | 'confirm_email_on' | 'rate_limited' | 'network' | 'unknown';

export type SignInWithCodeResult = { ok: true } | { ok: false; error: SignInWithCodeError; message?: string };

export const CONFIRM_EMAIL_ON_MESSAGE =
  'Confirm email is still on in Supabase. Turn off "Confirm email" under Authentication, Sign In / Providers, Email, then try again.';

export interface SyncEngine {
  state(): SyncState;
  subscribe(fn: (s: SyncState) => void): () => void;
  /** Signs in (or creates the account on first use) with the user's sync code. No email is sent. */
  signInWithCode(code: string): Promise<SignInWithCodeResult>;
  signOut(): Promise<void>; // keeps local data; clears meta.sync.userId, dirty, cursors
  syncNow(): Promise<SyncResult>;
  eraseCloud(): Promise<{ ok: boolean }>; // store.tombstoneAll, push, then store.eraseAll
  dispose(): void;
}

/** Resolves supabase-js's createClient lazily so it stays in a lazy chunk. */
export async function loadSupabaseFactory(): Promise<SupabaseFactory> {
  const { createClient } = await import('@supabase/supabase-js');
  return (url, key, options) => createClient(url, key, options) as unknown as SupabaseLike;
}

/** Real clock, timers and browser events. Browser globals are guarded so Node can import this. */
function createDefaultSyncDeps(): SyncDeps {
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    onOnline(fn) {
      if (!hasWindow) return () => undefined;
      window.addEventListener('online', fn);
      return () => window.removeEventListener('online', fn);
    },
    onVisible(fn) {
      if (typeof document === 'undefined') return () => undefined;
      const h = () => {
        if (document.visibilityState === 'visible') fn();
      };
      document.addEventListener('visibilitychange', h);
      return () => document.removeEventListener('visibilitychange', h);
    },
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  };
}

// ---- error classification ---------------------------------------------------------------------

type ErrLike = { message?: string; code?: string; status?: number; name?: string } | null | undefined;

const errMessage = (e: unknown): string => String((e as ErrLike)?.message ?? '');
const errCode = (e: unknown): string => String((e as ErrLike)?.code ?? '');
const errStatus = (e: unknown): number => Number((e as ErrLike)?.status ?? 0);

/** 401, an expired or invalid JWT, or an RLS denial (which should never happen). */
function isAuthError(e: unknown): boolean {
  const code = errCode(e);
  const status = errStatus(e);
  return (
    status === 401 ||
    status === 403 ||
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    code === '42501' ||
    code === 'invalid_jwt' ||
    code === 'bad_jwt' ||
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    code === 'refresh_token_already_used' ||
    /\bjwt\b/i.test(errMessage(e))
  );
}

/** A constraint or data error on one row (classes 22 and 23): retry row by row, then drop it. */
function isRowError(e: unknown): boolean {
  const code = errCode(e);
  return code.startsWith('23') || code.startsWith('22');
}

function isNetworkError(e: unknown): boolean {
  const name = String((e as ErrLike)?.name ?? '');
  return (
    e instanceof TypeError ||
    /fetch|network/i.test(name) ||
    /failed to fetch|network ?error|load failed|networkerror/i.test(errMessage(e)) ||
    (errStatus(e) === 0 && name === 'AuthRetryableFetchError')
  );
}

class PushError extends Error {
  constructor(public readonly cause2: unknown) {
    super(errMessage(cause2) || 'sync error');
  }
}

const EPOCH_ISO = new Date(0).toISOString();

const emptyCounts = (): Record<SyncTable, number> => ({ categories: 0, tasks: 0, sessions: 0, settings: 0 });

export function createSyncEngine(opts: {
  store: EmStore;
  env: SyncEnv;
  createClient: SupabaseFactory;
  deps?: SyncDeps;
}): SyncEngine {
  const { store } = opts;
  const deps = opts.deps ?? createDefaultSyncDeps();
  const client: SupabaseLike = opts.createClient(opts.env.url, opts.env.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
    },
  });

  let disposed = false;
  let signingOut = false; // set while our own signOut runs, so its SIGNED_OUT event is not an expiry
  let status: SyncStatus = store.get().meta.sync.userId !== null ? 'idle' : 'signed-out';
  let nextRetryAt: number | null = null;
  let failures = 0;
  let retryTimer: unknown = null;
  let debounceTimer: unknown = null;
  let firstWriteAt: number | null = null;
  const subs = new Set<(s: SyncState) => void>();

  // ---- state ---------------------------------------------------------------------------------

  const pendingCount = (): number => {
    const d = store.takeDirty();
    return d.categories.length + d.tasks.length + d.sessions.length + (d.settings ? 1 : 0);
  };

  function state(): SyncState {
    const m = store.get().meta.sync;
    return {
      status,
      email: m.email,
      lastSyncedAt: m.lastSyncedAt,
      pending: pendingCount(),
      rejected: m.rejected,
      nextRetryAt,
    };
  }

  function setStatus(next: SyncStatus): void {
    if (disposed) return;
    status = next;
    const s = state();
    for (const fn of [...subs]) fn(s);
  }

  const signedIn = (): boolean => store.get().meta.sync.userId !== null;
  const canRun = (): boolean => !disposed && signedIn() && status !== 'auth-expired';

  // ---- session handling ----------------------------------------------------------------------

  /**
   * Makes `session` the signed-in account (contract 3.7, sign-in). Idempotent: a second call for
   * the same user changes nothing. A new account (or first sign-in on this device) marks every local
   * row dirty so nothing is ever discarded, and resets cursors when the account is new to this device.
   */
  function adoptSession(session: SessionLike): void {
    const uid = session.user.id;
    const m = store.get().meta.sync;
    // The derived address contains the sync code, so it is never written to AppData (exports, backups).
    const raw = session.user.email ?? m.email;
    const email = raw !== null && raw.endsWith(SYNC_CODE_EMAIL_DOMAIN) ? null : raw;
    if (m.userId === uid) {
      if (email !== m.email) store.setSyncMeta({ email });
      return;
    }
    const patch: Parameters<EmStore['setSyncMeta']>[0] = { userId: uid, email, lastUserId: uid, rejected: 0 };
    if (m.lastUserId !== uid) patch.cursors = createDefaultSyncMeta().cursors;
    store.setSyncMeta(patch);
    store.markAllDirty();
  }

  function clearTimers(): void {
    if (retryTimer !== null) deps.clearTimeout(retryTimer);
    if (debounceTimer !== null) deps.clearTimeout(debounceTimer);
    retryTimer = null;
    debounceTimer = null;
    firstWriteAt = null;
    nextRetryAt = null;
  }

  // ---- push ----------------------------------------------------------------------------------

  type Entity = Category | Task | Session;

  async function upsert(table: SyncTable, rows: object[]): Promise<PostgrestErrorLike | null> {
    const onConflict = table === 'settings' ? 'user_id' : 'user_id,id';
    const { error } = await client.from(table).upsert(rows, { onConflict, ignoreDuplicates: false });
    return error;
  }

  async function push(uid: string, pushed: Record<SyncTable, number>): Promise<number> {
    let rejected = 0;
    for (const table of SYNC_TABLES) {
      if (table === 'settings') {
        if (!store.takeDirty().settings) continue;
        const settings = store.get().settings;
        // Seeded defaults (updatedAt 0) must never reach the server: they would lose to any real row.
        if (settings.updatedAt > 0) {
          const err = await upsert('settings', [toRow('settings', settings, uid)]);
          if (err) {
            if (isRowError(err)) rejected += 1;
            else throw new PushError(err);
          } else pushed.settings += 1;
        }
        store.clearDirty('settings', true, { settings: settings.updatedAt });
        continue;
      }

      const ids = store.takeDirty()[table];
      if (ids.length === 0) continue;
      const data = store.get();
      const list = (
        table === 'categories' ? data.categories : table === 'tasks' ? data.tasks : data.sessions
      ) as Entity[];
      const byId = new Map(list.map((e) => [e.id, e] as const));
      const present = ids.map((id) => byId.get(id)).filter((e): e is Entity => e !== undefined);
      const stale = ids.filter((id) => !byId.has(id));
      if (stale.length > 0) store.clearDirty(table, stale, {}); // dirty id with no row: nothing to send

      for (let i = 0; i < present.length; i += SYNC_BATCH_SIZE) {
        const chunk = present.slice(i, i + SYNC_BATCH_SIZE);
        const snapshot: Record<string, number> = {};
        for (const e of chunk) snapshot[e.id] = e.updatedAt;
        const err = await upsert(
          table,
          chunk.map((e) => toRow(table, e, uid)),
        );
        if (!err) {
          store.clearDirty(
            table,
            chunk.map((e) => e.id),
            snapshot,
          );
          pushed[table] += chunk.length;
          continue;
        }
        if (!isRowError(err)) throw new PushError(err);
        // A constraint failure: find the bad row(s) one by one and drop only those.
        for (const e of chunk) {
          const one = await upsert(table, [toRow(table, e, uid)]);
          if (!one) {
            store.clearDirty(table, [e.id], { [e.id]: e.updatedAt });
            pushed[table] += 1;
          } else if (isRowError(one)) {
            console.warn(`Em Time sync: the server rejected a ${table} row`, e.id, one.message);
            store.clearDirty(table, [e.id], { [e.id]: e.updatedAt });
            rejected += 1;
          } else {
            throw new PushError(one);
          }
        }
      }
    }
    return rejected;
  }

  // ---- pull ----------------------------------------------------------------------------------

  async function pull(uid: string, pulled: Record<SyncTable, number>): Promise<void> {
    for (const table of SYNC_TABLES) {
      const cursor = store.get().meta.sync.cursors[table];
      const cursorMs = cursor === null ? NaN : Date.parse(cursor);
      const since = Number.isFinite(cursorMs)
        ? new Date(Math.max(0, cursorMs - SYNC_PULL_OVERLAP_MS)).toISOString()
        : EPOCH_ISO;
      let maxServer: string | null = null;
      let maxServerMs = -Infinity;
      for (let page = 0; ; page++) {
        const from = page * SYNC_PAGE_SIZE;
        const { data, error } = await client
          .from(table)
          .select('*')
          .eq('user_id', uid)
          .gt('server_updated_at', since)
          .order('server_updated_at', { ascending: true })
          .range(from, from + SYNC_PAGE_SIZE - 1);
        if (error) throw new PushError(error);
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        const entities: unknown[] = [];
        for (const row of rows) {
          const ent = fromRow(table, row);
          if (ent !== null) entities.push(ent);
          const sv = row.server_updated_at;
          const ms = typeof sv === 'string' ? Date.parse(sv) : NaN;
          if (Number.isFinite(ms) && ms > maxServerMs) {
            maxServerMs = ms;
            maxServer = sv as string;
          }
        }
        if (entities.length > 0) pulled[table] += store.applyRemote(table, entities).applied;
        if (rows.length < SYNC_PAGE_SIZE) break;
      }
      if (maxServer !== null) {
        const cur = store.get().meta.sync.cursors;
        store.setSyncMeta({ cursors: { ...cur, [table]: maxServer } });
      }
    }
  }

  // ---- run (single flight) -------------------------------------------------------------------

  function scheduleRetry(): void {
    failures += 1;
    const delay = Math.min(SYNC_BACKOFF_MS * 2 ** (failures - 1), SYNC_BACKOFF_MAX_MS);
    if (retryTimer !== null) deps.clearTimeout(retryTimer);
    nextRetryAt = deps.now() + delay;
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      nextRetryAt = null;
      if (canRun()) void trigger();
    }, delay);
  }

  async function doRun(): Promise<SyncResult> {
    const pushed = emptyCounts();
    const pulled = emptyCounts();
    const result: SyncResult = { ok: false, pushed, pulled, rejected: 0 };
    if (!canRun()) return result;
    if (!deps.isOnline()) {
      setStatus('offline');
      return result;
    }
    setStatus('syncing');
    try {
      // The client refreshes an expiring token here; no session means the sign-in was revoked.
      const {
        data: { session },
      } = await client.auth.getSession();
      if (disposed) return result;
      if (!session) {
        setStatus(deps.isOnline() ? 'auth-expired' : 'offline');
        return result;
      }
      adoptSession(session);
      const uid = session.user.id;
      result.rejected = await push(uid, pushed);
      await pull(uid, pulled);
      if (disposed || !signedIn()) return result; // signed out or erased mid-run
      failures = 0;
      nextRetryAt = null;
      if (retryTimer !== null) {
        deps.clearTimeout(retryTimer);
        retryTimer = null;
      }
      const m = store.get().meta.sync;
      store.setSyncMeta({ lastSyncedAt: deps.now(), rejected: m.rejected + result.rejected });
      result.ok = true;
      setStatus('idle');
    } catch (e) {
      if (disposed) return result;
      const cause = e instanceof PushError ? e.cause2 : e;
      if (isAuthError(cause)) {
        setStatus('auth-expired');
      } else if (isNetworkError(cause) || !deps.isOnline()) {
        setStatus('offline');
        scheduleRetry();
      } else {
        console.warn('Em Time sync failed', cause);
        setStatus('error');
        scheduleRetry();
      }
    }
    return result;
  }

  let current: Promise<SyncResult> | null = null;
  let followUp: Promise<SyncResult> | null = null;

  /** One run at a time; a trigger during a run schedules exactly one follow-up run. */
  function trigger(): Promise<SyncResult> {
    if (current === null) {
      current = doRun().finally(() => {
        current = null;
      });
      return current;
    }
    if (followUp === null) {
      followUp = current.then(() => {
        followUp = null;
        return trigger();
      });
    }
    return followUp;
  }

  function onLocalWrite(table: SyncTable | null): void {
    if (table === null || !canRun()) return;
    const now = deps.now();
    if (firstWriteAt === null) firstWriteAt = now;
    const delay = Math.min(SYNC_DEBOUNCE_MS, Math.max(0, firstWriteAt + SYNC_MAX_WAIT_MS - now));
    if (debounceTimer !== null) deps.clearTimeout(debounceTimer);
    debounceTimer = deps.setTimeout(() => {
      debounceTimer = null;
      firstWriteAt = null;
      if (canRun()) void trigger();
    }, delay);
  }

  // ---- wiring --------------------------------------------------------------------------------

  const offWrite = store.onLocalWrite(onLocalWrite);
  const offOnline = deps.onOnline(() => {
    if (canRun()) void trigger();
  });
  const offVisible = deps.onVisible(() => {
    if (canRun()) void trigger();
  });

  const { data: authSub } = client.auth.onAuthStateChange((event, session) => {
    // Never call back into the client from inside this callback (it holds the auth lock): defer.
    const ours = signingOut;
    deps.setTimeout(() => {
      if (disposed) return;
      if (
        session &&
        (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || (event === 'TOKEN_REFRESHED' && signedIn()))
      ) {
        const wasExpired = status === 'auth-expired';
        if (wasExpired) status = 'idle';
        adoptSession(session);
        void trigger();
      } else if (event === 'SIGNED_OUT' && signedIn() && !ours) {
        setStatus('auth-expired'); // revoked elsewhere; local data and dirty queue are kept
      }
    }, 0);
  });

  // On creation with an existing session (app open): settle the session and run.
  void (async () => {
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (disposed) return;
      if (session) {
        adoptSession(session);
        void trigger();
      } else if (signedIn()) {
        // Stored sign-in with no usable session: expired, unless we are simply offline.
        setStatus(deps.isOnline() ? 'auth-expired' : 'offline');
      } else {
        setStatus('signed-out');
      }
    } catch {
      if (!disposed && signedIn()) setStatus(deps.isOnline() ? 'error' : 'offline');
    }
  })();

  // ---- public API ----------------------------------------------------------------------------

  async function removeSession(): Promise<void> {
    signingOut = true;
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch {
      // Offline or already gone: still clear our own auth key, and nothing else.
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    } finally {
      signingOut = false;
    }
  }

  return {
    state,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },

    async signInWithCode(raw) {
      const derived = await deriveSyncCredentials(raw);
      if (!derived.ok) return { ok: false, error: derived.error };
      const { email, password } = derived.credentials;
      try {
        let session: SessionLike | null = null;
        const first = await client.auth.signInWithPassword({ email, password });
        if (!first.error) {
          session = first.data.session;
        } else if (isEmailNotConfirmed(first.error)) {
          return confirmEmailOn();
        } else if (isInvalidCredentials(first.error)) {
          // First use of this code anywhere: create the account.
          const up = await client.auth.signUp({ email, password });
          if (up.error) return { ok: false, error: mapSignInError(up.error) };
          if (!up.data.session) return confirmEmailOn();
          session = up.data.session;
        } else {
          return { ok: false, error: mapSignInError(first.error) };
        }
        if (!session) return { ok: false, error: 'unknown' };
        if (status === 'auth-expired' || status === 'signed-out') status = 'idle';
        adoptSession(session);
        void trigger();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: isNetworkError(e) ? 'network' : 'unknown' };
      }
    },

    async signOut() {
      clearTimers();
      await removeSession();
      const m = store.get().meta.sync;
      store.setSyncMeta({
        userId: null,
        email: null,
        lastUserId: m.lastUserId ?? m.userId,
        cursors: createDefaultSyncMeta().cursors,
        dirty: createDefaultSyncMeta().dirty,
        rejected: 0,
      });
      failures = 0;
      setStatus('signed-out');
    },

    syncNow() {
      return canRun()
        ? trigger()
        : Promise.resolve({ ok: false, pushed: emptyCounts(), pulled: emptyCounts(), rejected: 0 });
    },

    async eraseCloud() {
      if (!signedIn() || status === 'auth-expired' || !deps.isOnline()) return { ok: false };
      store.tombstoneAll(deps.now());
      const r = await trigger();
      const d = store.takeDirty();
      if (!r.ok || d.categories.length + d.tasks.length + d.sessions.length > 0) return { ok: false };
      clearTimers();
      store.eraseAll(deps.now()); // resets meta.sync (signs out locally) and AppData
      await removeSession();
      failures = 0;
      setStatus('signed-out');
      return { ok: true };
    },

    dispose() {
      disposed = true;
      clearTimers();
      offWrite();
      offOnline();
      offVisible();
      authSub.subscription.unsubscribe();
      subs.clear();
    },
  };
}

function confirmEmailOn(): SignInWithCodeResult {
  return { ok: false, error: 'confirm_email_on', message: CONFIRM_EMAIL_ON_MESSAGE };
}

function isInvalidCredentials(e: AuthErrorLike): boolean {
  return errCode(e) === 'invalid_credentials' || /invalid login credentials/i.test(errMessage(e));
}

function isEmailNotConfirmed(e: AuthErrorLike): boolean {
  return errCode(e) === 'email_not_confirmed' || /email not confirmed/i.test(errMessage(e));
}

function mapSignInError(e: AuthErrorLike): 'rate_limited' | 'network' | 'unknown' {
  const code = errCode(e);
  if (
    errStatus(e) === 429 ||
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    /rate limit/i.test(errMessage(e))
  ) {
    return 'rate_limited';
  }
  if (isNetworkError(e)) return 'network';
  return 'unknown';
}
