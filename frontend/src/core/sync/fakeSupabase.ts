// Test double for supabase-js, typed as the SupabaseLike subset of contract.md 3.7. It keeps
// tables in memory and applies the same row rules as the SQL migration (RLS by user, the
// em_lww_guard last-write-wins trigger, a few CHECK constraints). Used only by tests.
import type { AuthErrorLike, PostgrestErrorLike, SessionLike, SupabaseFactory, SupabaseLike } from '../api';
import type { SyncTable } from '../types';

type Row = Record<string, unknown> & { user_id: string; updated_at: number; server_updated_at: string };

export interface FakeServer {
  tables: Record<SyncTable, Map<string, Row>>;
  /** ms since epoch the server pretends it is; advances with every accepted write */
  serverNow: number;
  users: Map<string, string>; // email -> user id
  passwords: Map<string, string>; // email -> password
  /** mirrors the Supabase "Confirm email" switch: sign-up then returns a user and no session */
  confirmEmail: boolean;
  confirmed: Set<string>;
  /** return an error to fail the next matching call */
  failWhen: ((op: Op) => PostgrestErrorLike | AuthErrorLike | Error | null) | null;
  log: Op[];
  /** deferred gate: when set, every call waits for it */
  gate: Promise<void> | null;
}

export interface Op {
  kind: 'upsert' | 'select' | 'getSession' | 'signInWithPassword' | 'signUp' | 'signOut';
  table?: SyncTable;
  rows?: Array<Record<string, unknown>>;
  since?: string;
  email?: string;
}

export function createFakeServer(startMs = Date.UTC(2026, 9, 14, 12, 0, 0)): FakeServer {
  return {
    tables: { categories: new Map(), tasks: new Map(), sessions: new Map(), settings: new Map() },
    serverNow: startMs,
    users: new Map(),
    passwords: new Map(),
    confirmEmail: false,
    confirmed: new Set(),
    failWhen: null,
    log: [],
    gate: null,
  };
}

const rowKey = (table: SyncTable, row: { user_id: string; id?: unknown }): string =>
  table === 'settings' ? row.user_id : `${row.user_id}|${String(row.id)}`;

function violatesCheck(table: SyncTable, r: Record<string, unknown>): boolean {
  const len = (v: unknown) => (typeof v === 'string' ? v.length : -1);
  if (table === 'categories') return !(len(r.name) >= 1 && len(r.name) <= 30) || r.name === 'BAD';
  if (table === 'tasks') return !(len(r.name) >= 1 && len(r.name) <= 80) || r.name === 'BAD';
  if (table === 'sessions') {
    return (
      (r.ended_at as number) < (r.started_at as number) ||
      (r.focused_ms as number) > (r.planned_ms as number) ||
      (r.planned_ms as number) <= 0
    );
  }
  return false;
}

export interface FakeClient {
  client: SupabaseLike;
  /** the session this client currently holds */
  session(): SessionLike | null;
  setSession(userId: string | null, email?: string): void;
  emit(event: string, session: SessionLike | null): void;
  signOutCalls: Array<{ scope?: string } | undefined>;
}

export function createFakeClient(server: FakeServer): FakeClient {
  let session: SessionLike | null = null;
  const listeners = new Set<(event: string, s: SessionLike | null) => void>();
  const signOutCalls: FakeClient['signOutCalls'] = [];

  const emit = (event: string, s: SessionLike | null) => {
    for (const fn of [...listeners]) fn(event, s);
  };
  const setSession = (userId: string | null, email = 'em@example.com') => {
    session = userId === null ? null : { access_token: `tok-${userId}`, user: { id: userId, email } };
  };
  const userFor = (email: string): string => {
    let id = server.users.get(email);
    if (!id) {
      const n = server.users.size + 1;
      id = `9f1c2b3a-4d5e-4f60-8a7b-${String(n).padStart(12, '0')}`;
      server.users.set(email, id);
    }
    return id;
  };
  const wait = async (op: Op) => {
    server.log.push(op);
    if (server.gate) await server.gate;
  };
  const failure = (op: Op) => (server.failWhen ? server.failWhen(op) : null);

  const client: SupabaseLike = {
    auth: {
      async signInWithPassword({ email, password }) {
        const op: Op = { kind: 'signInWithPassword', email };
        await wait(op);
        const f = failure(op);
        if (f instanceof Error) throw f;
        if (f) return { data: { session: null }, error: f as AuthErrorLike };
        if (!server.passwords.has(email) || server.passwords.get(email) !== password) {
          return {
            data: { session: null },
            error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
          };
        }
        if (server.confirmEmail && !server.confirmed.has(email)) {
          return {
            data: { session: null },
            error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 },
          };
        }
        setSession(userFor(email), email);
        emit('SIGNED_IN', session);
        return { data: { session }, error: null };
      },
      async signUp({ email, password }) {
        const op: Op = { kind: 'signUp', email };
        await wait(op);
        const f = failure(op);
        if (f instanceof Error) throw f;
        if (f) return { data: { session: null, user: null }, error: f as AuthErrorLike };
        if (server.passwords.has(email)) {
          return {
            data: { session: null, user: null },
            error: { message: 'User already registered', code: 'user_already_exists', status: 422 },
          };
        }
        server.passwords.set(email, password);
        const id = userFor(email);
        if (server.confirmEmail) return { data: { session: null, user: { id } }, error: null };
        server.confirmed.add(email);
        setSession(id, email);
        emit('SIGNED_IN', session);
        return { data: { session, user: { id } }, error: null };
      },
      async getSession() {
        await wait({ kind: 'getSession' });
        return { data: { session } };
      },
      onAuthStateChange(cb) {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => void listeners.delete(cb) } } };
      },
      async signOut(opts) {
        signOutCalls.push(opts);
        await wait({ kind: 'signOut' });
        session = null;
        emit('SIGNED_OUT', null);
        return { error: null };
      },
    },
    from(table) {
      return {
        async upsert(rows, opts) {
          const op: Op = { kind: 'upsert', table, rows: rows as Array<Record<string, unknown>> };
          await wait(op);
          const f = failure(op);
          if (f instanceof Error) throw f;
          if (f) return { error: f as PostgrestErrorLike };
          if (!session) return { error: { message: 'permission denied', code: '42501' } };
          const expectedConflict = table === 'settings' ? 'user_id' : 'user_id,id';
          if (opts.onConflict !== expectedConflict)
            return { error: { message: 'bad onConflict', code: 'PGRST100' } };
          const incoming = rows as Array<Record<string, unknown> & { user_id: string; updated_at: number }>;
          for (const r of incoming) {
            if (r.user_id !== session.user.id)
              return { error: { message: 'row violates RLS', code: '42501' } };
            if (violatesCheck(table, r))
              return { error: { message: 'check constraint violated', code: '23514' } };
          }
          // the batch is atomic: validated above, applied here
          for (const r of incoming) {
            const key = rowKey(table, r);
            const old = server.tables[table].get(key);
            const row = { ...r } as Row;
            if (row.updated_at > server.serverNow + 600_000) row.updated_at = server.serverNow; // clamp the future
            if (old) {
              if (row.updated_at < old.updated_at) continue;
              if (table === 'settings') {
                if (row.updated_at <= old.updated_at) continue;
              } else if (
                row.updated_at === old.updated_at &&
                !(row.deleted_at != null && old.deleted_at == null)
              ) {
                continue;
              }
            }
            server.serverNow += 1;
            row.server_updated_at = new Date(server.serverNow).toISOString();
            server.tables[table].set(key, row);
          }
          return { error: null };
        },
        select() {
          return {
            eq: (_col, userId) => ({
              gt: (_c, since) => ({
                order: () => ({
                  async range(from, to) {
                    const op: Op = { kind: 'select', table, since };
                    await wait(op);
                    const f = failure(op);
                    if (f instanceof Error) throw f;
                    if (f) return { data: null, error: f as PostgrestErrorLike };
                    if (!session) return { data: [], error: null }; // RLS: anon sees nothing
                    const sinceMs = Date.parse(since);
                    const rows = [...server.tables[table].values()]
                      .filter((r) => r.user_id === userId && r.user_id === session!.user.id)
                      .filter((r) => Date.parse(r.server_updated_at) > sinceMs)
                      .sort((a, b) => Date.parse(a.server_updated_at) - Date.parse(b.server_updated_at));
                    return { data: rows.slice(from, to + 1), error: null };
                  },
                }),
              }),
            }),
          };
        },
      };
    },
  };
  return { client, session: () => session, setSession, emit, signOutCalls };
}

/** A factory that hands out one FakeClient per createClient call, remembering the options. */
export function fakeFactory(server: FakeServer): {
  factory: SupabaseFactory;
  clients: FakeClient[];
  calls: Array<{ url: string; key: string; options: object }>;
} {
  const clients: FakeClient[] = [];
  const calls: Array<{ url: string; key: string; options: object }> = [];
  return {
    clients,
    calls,
    factory: (url, key, options) => {
      calls.push({ url, key, options });
      const c = createFakeClient(server);
      clients.push(c);
      return c.client;
    },
  };
}
