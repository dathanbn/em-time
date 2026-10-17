// QA's own in-memory Supabase: tables keyed by (user_id, id), the last-write-wins trigger of
// contract section 10, row level security by user, and failure injection. Independent of the
// logic agent's fakeSupabase.
import type {
  createMemoryAdapter,
  AuthErrorLike,
  PostgrestErrorLike,
  SessionLike,
  SupabaseFactory,
  SupabaseLike,
  SyncDeps,
  SyncTable,
} from '@core';
import { createSyncEngine, type SyncEngine } from '../../frontend/src/core/sync/engine';
import { FakeClock, makeCore } from './harness';

type Row = Record<string, any>;

export class FakeServer {
  tables: Record<SyncTable, Map<string, Row>> = {
    categories: new Map(),
    tasks: new Map(),
    sessions: new Map(),
    settings: new Map(),
  };
  serverNow = Date.UTC(2026, 9, 14, 17, 0, 0);
  calls: Array<{ op: 'upsert' | 'select'; table: SyncTable; n: number }> = [];
  failNext: null | { kind: 'http'; status: number } | { kind: 'auth' } | { kind: 'network' } = null;
  failAll = false;
  hold: null | Promise<void> = null;
  users = new Map<string, string>(); // email -> uid
  validCode = '123456';
  /** Devices' clocks: the server's wall clock never lags the fastest honest device. */
  clocks: FakeClock[] = [];

  uidFor(email: string): string {
    let u = this.users.get(email);
    if (!u) {
      const n = this.users.size + 1;
      u = `9f1c2b3a-4d5e-4f60-8a7b-${n.toString(16).padStart(12, '0')}`;
      this.users.set(email, u);
    }
    return u;
  }

  rows(table: SyncTable, uid?: string): Row[] {
    return [...this.tables[table].values()].filter((r) => !uid || r.user_id === uid);
  }

  private maybeFail(): PostgrestErrorLike | null | 'throw' {
    if (this.failNext || this.failAll) {
      const f = this.failNext ?? { kind: 'http' as const, status: 500 };
      if (!this.failAll) this.failNext = null;
      if (f.kind === 'network') return 'throw';
      if (f.kind === 'auth') return { message: 'JWT expired', code: 'PGRST301' };
      return { message: `HTTP ${f.status}`, code: String(f.status) } as PostgrestErrorLike;
    }
    return null;
  }

  /** Same decision table as em_lww_guard. Returns true when the write was applied. */
  private apply(table: SyncTable, key: string, next: Row): boolean {
    const store = this.tables[table];
    const old = store.get(key);
    this.serverNow = Math.max(this.serverNow, ...this.clocks.map((c) => c.t));
    if (next.updated_at > this.serverNow + 600_000) next = { ...next, updated_at: this.serverNow };
    if (old) {
      if (table === 'settings') {
        if (next.updated_at <= old.updated_at) return false;
      } else {
        if (next.updated_at < old.updated_at) return false;
        if (next.updated_at === old.updated_at && !(next.deleted_at != null && old.deleted_at == null)) return false;
      }
    }
    this.serverNow += 5;
    store.set(key, { ...next, server_updated_at: new Date(this.serverNow).toISOString() });
    return true;
  }

  client(deps: { signedInUid: () => string | null; session: () => SessionLike | null; fire: (ev: string, s: SessionLike | null) => void; setSession: (s: SessionLike | null) => void }): SupabaseLike {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const srv = this;
    return {
      auth: {
        async signInWithOtp({ email }) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: { message: 'invalid', status: 400 } as AuthErrorLike };
          return { error: null };
        },
        async verifyOtp({ email, token }) {
          if (token !== srv.validCode) return { data: { session: null }, error: { message: 'Token has expired or is invalid', status: 403 } as AuthErrorLike };
          const s: SessionLike = { access_token: 'tok', user: { id: srv.uidFor(email), email } };
          deps.setSession(s);
          queueMicrotask(() => deps.fire('SIGNED_IN', s));
          return { data: { session: s }, error: null };
        },
        async getSession() {
          return { data: { session: deps.session() } };
        },
        onAuthStateChange(cb) {
          void cb;
          return { data: { subscription: { unsubscribe() {} } } };
        },
        async signOut() {
          deps.setSession(null);
          return { error: null };
        },
      },
      from(table: SyncTable) {
        return {
          async upsert(rows: object[]) {
            srv.calls.push({ op: 'upsert', table, n: rows.length });
            if (srv.hold) await srv.hold;
            const f = srv.maybeFail();
            if (f === 'throw') throw new TypeError('Failed to fetch');
            if (f) return { error: f };
            const uid = deps.signedInUid();
            // RLS: only rows owned by the caller
            for (const r of rows as Row[]) {
              if (r.user_id !== uid) return { error: { message: 'row-level security', code: '42501' } };
              if (typeof r.name === 'string' && r.name.includes('REJECT')) return { error: { message: 'check violation', code: '23514' } };
              if (table === 'sessions' && r.focused_ms > r.planned_ms) return { error: { message: 'check violation', code: '23514' } };
            }
            for (const r of rows as Row[]) srv.apply(table, table === 'settings' ? r.user_id : `${r.user_id}/${r.id}`, r);
            return { error: null };
          },
          select() {
            return {
              eq(_c: 'user_id', uid: string) {
                return {
                  gt(_c2: 'server_updated_at', since: string) {
                    return {
                      order() {
                        return {
                          async range(from: number, to: number) {
                            srv.calls.push({ op: 'select', table, n: 0 });
                            if (srv.hold) await srv.hold;
                            const f = srv.maybeFail();
                            if (f === 'throw') throw new TypeError('Failed to fetch');
                            if (f) return { data: null, error: f };
                            if (deps.signedInUid() !== uid) return { data: [], error: null }; // RLS hides others
                            const all = srv
                              .rows(table, uid)
                              .filter((r) => r.server_updated_at > since)
                              .sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1));
                            return { data: all.slice(from, to + 1), error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        } as any;
      },
    };
  }
}

export interface Device {
  name: string;
  clock: FakeClock;
  core: ReturnType<typeof makeCore>['core'];
  events: ReturnType<typeof makeCore>['events'];
  storage: ReturnType<typeof createMemoryAdapter>;
  engine: SyncEngine | null;
  online: boolean;
  visible: Array<() => void>;
  onlineHandlers: Array<() => void>;
  attach(email?: string): Promise<SyncEngine>;
  signIn(email: string): Promise<void>;
}

export const flush = async (n = 12): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

export function makeDevice(server: FakeServer, name: string, startMs: number): Device {
  const clock = new FakeClock(startMs);
  server.clocks.push(clock);
  const { core, events, storage } = makeCore({ clock });
  let session: SessionLike | null = null;
  const dev: Device = {
    name,
    clock,
    core,
    events,
    storage,
    engine: null,
    online: true,
    visible: [],
    onlineHandlers: [],
    async attach() {
      const client = server.client({
        signedInUid: () => session?.user.id ?? null,
        session: () => session,
        fire: () => undefined,
        setSession: (s) => {
          session = s;
        },
      });
      const deps: SyncDeps = {
        now: clock.now,
        setTimeout: clock.deps.setTimeout,
        clearTimeout: clock.deps.clearTimeout,
        isOnline: () => dev.online,
        onOnline: (fn) => {
          dev.onlineHandlers.push(fn);
          return () => undefined;
        },
        onVisible: (fn) => {
          dev.visible.push(fn);
          return () => undefined;
        },
        isVisible: () => true,
      };
      const createClient: SupabaseFactory = () => client;
      dev.engine = createSyncEngine({
        store: core.store,
        env: { url: 'https://example.supabase.co', anonKey: 'anon' },
        createClient,
        deps,
      });
      return dev.engine;
    },
    async signIn(email) {
      if (!dev.engine) await dev.attach();
      const r1 = await dev.engine!.requestCode(email);
      if (!r1.ok) throw new Error('requestCode failed: ' + r1.error);
      const r2 = await dev.engine!.verifyCode(email, server.validCode);
      if (!r2.ok) throw new Error('verifyCode failed: ' + r2.error);
      await flush();
    },
  };
  return dev;
}

/** Completes one 25 minute focus session on the device, then returns the timer to idle focus. */
export function completeSession(dev: Device, taskId: string | null = null): void {
  dev.core.store.setCurrentTask(taskId);
  dev.core.timer.start();
  dev.clock.advance(25 * 60_000 + 10);
  dev.core.timer.setPhase('focus');
  dev.clock.advance(60_000);
}
