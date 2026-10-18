// Test double for supabase-js, typed as the SupabaseLike subset of contract.md 3.7. It keeps
// tables in memory and applies the same row rules as the SQL migrations (RLS by user, the
// em_lww_guard last-write-wins trigger, a few CHECK constraints, and the v6 friends functions
// behind `rpc`). Used only by tests.
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
  /** v6 friends: user id -> their share (null when not sharing) */
  shares: Map<string, { code: string; createdAt: number }>;
  /** v6 friends: user id -> their friend list, oldest first */
  links: Map<string, Array<{ code: string; nickname: string | null; color: number; createdAt: number }>>;
  /** v6 friends: draws a fresh friend code; the default counts up (FAKE0001, FAKE0002 ...) */
  newCode: () => string;
  /** return an error to fail the next matching call */
  failWhen: ((op: Op) => PostgrestErrorLike | AuthErrorLike | Error | null) | null;
  log: Op[];
  /** deferred gate: when set, every call waits for it */
  gate: Promise<void> | null;
}

export interface Op {
  kind: 'upsert' | 'select' | 'getSession' | 'signInWithPassword' | 'signUp' | 'signOut' | 'rpc';
  table?: SyncTable;
  fn?: string;
  args?: Record<string, unknown>;
  rows?: Array<Record<string, unknown>>;
  since?: string;
  email?: string;
}

export function createFakeServer(startMs = Date.UTC(2026, 9, 14, 12, 0, 0)): FakeServer {
  let codeCounter = 0;
  return {
    tables: { categories: new Map(), tasks: new Map(), sessions: new Map(), settings: new Map() },
    serverNow: startMs,
    users: new Map(),
    passwords: new Map(),
    confirmEmail: false,
    confirmed: new Set(),
    shares: new Map(),
    links: new Map(),
    newCode: () => `FAKE${String(++codeCounter).padStart(4, '0')}`,
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

// ---- friends (v6): the em_* functions of 20261017000000_em_time_friends.sql -----------------------

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const normCode = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
const cleanNickname = (raw: unknown): string | null => {
  const t = String(raw ?? '').replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
  return t === '' ? null : Array.from(t).slice(0, 24).join('');
};
const rpcErr = (message: string, code: string) => ({ data: null, error: { message, code } });
const rpcOk = (data: unknown) => ({ data, error: null });

export function friendsRpc(
  server: FakeServer,
  uid: string,
  fn: string,
  args: Record<string, unknown>,
): { data: unknown; error: PostgrestErrorLike | null } {
  const mine = () => {
    let l = server.links.get(uid);
    if (!l) server.links.set(uid, (l = []));
    return l;
  };
  const freshCode = (): string => {
    for (;;) {
      const c = server.newCode();
      if (![...server.shares.values()].some((s) => s.code === c)) return c;
    }
  };
  switch (fn) {
    case 'em_share_get':
      return rpcOk(server.shares.get(uid)?.code ?? null);
    case 'em_share_enable': {
      const have = server.shares.get(uid);
      if (have) return rpcOk(have.code);
      const code = freshCode();
      server.shares.set(uid, { code, createdAt: server.serverNow });
      return rpcOk(code);
    }
    case 'em_share_rotate': {
      const code = freshCode();
      server.shares.set(uid, { code, createdAt: server.serverNow });
      return rpcOk(code);
    }
    case 'em_share_disable':
      server.shares.delete(uid);
      return rpcOk(null);
    case 'em_friend_add': {
      const code = normCode(args.p_code);
      if (!CODE_RE.test(code)) return rpcOk('invalid');
      if (server.shares.get(uid)?.code === code) return rpcOk('own_code');
      const list = mine();
      if (list.some((l) => l.code === code)) return rpcOk('duplicate');
      if (![...server.shares.values()].some((s) => s.code === code)) return rpcOk('not_found');
      const color = [1, 2, 3, 4, 5].find((c) => !list.some((l) => l.color === c));
      if (color === undefined) return rpcOk('limit');
      list.push({ code, nickname: cleanNickname(args.p_nickname), color, createdAt: server.serverNow });
      return rpcOk('ok');
    }
    case 'em_friend_rename': {
      const code = normCode(args.p_code);
      const l = mine().find((x) => x.code === code);
      if (l) l.nickname = cleanNickname(args.p_nickname);
      return rpcOk(null);
    }
    case 'em_friend_remove': {
      const code = normCode(args.p_code);
      server.links.set(
        uid,
        mine().filter((x) => x.code !== code),
      );
      return rpcOk(null);
    }
    case 'em_friends_week': {
      const from = args.p_from;
      const to = args.p_to;
      const ms = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN);
      if (!(ms(to) >= ms(from)) || (ms(to) - ms(from)) / 86_400_000 > 13) return rpcErr('bad date window', '22023');
      const out = mine().map((l) => {
        const owner = [...server.shares.entries()].find(([, s]) => s.code === l.code)?.[0] ?? null;
        const days: Record<string, number> = {};
        if (owner !== null) {
          for (const r of server.tables.sessions.values()) {
            if (r.user_id !== owner || r.deleted_at != null) continue;
            const day = r.day as string;
            if (day < (from as string) || day > (to as string)) continue;
            days[day] = (days[day] ?? 0) + (r.focused_ms as number);
          }
        }
        const settings = owner === null ? undefined : server.tables.settings.get(owner);
        const name = (settings?.data as { displayName?: unknown } | undefined)?.displayName;
        return {
          code: l.code,
          nickname: l.nickname,
          displayName: owner !== null && name !== undefined && name !== null ? String(name) : null,
          color: l.color,
          active: owner !== null,
          days,
        };
      });
      return rpcOk(out);
    }
    default:
      return rpcErr(`Could not find the function public.${fn}`, 'PGRST202');
  }
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
    async rpc(fn, args) {
      const op: Op = { kind: 'rpc', fn, args: args as Record<string, unknown> | undefined };
      await wait(op);
      const f = failure(op);
      if (f instanceof Error) throw f;
      if (f) return { data: null, error: f as PostgrestErrorLike };
      if (!session) return rpcErr('not signed in', '42501');
      return friendsRpc(server, session.user.id, fn, (args ?? {}) as Record<string, unknown>);
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
