// Sync code: normalization, credential derivation, and the engine's sign-in paths.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryAdapter } from '../storage/persist';
import { createDefaultData } from '../store/defaults';
import { createStore } from '../store/store';
import type { EmStore } from '../api';
import { createSyncEngine, CONFIRM_EMAIL_ON_MESSAGE, type SyncEngine } from './engine';
import { createFakeServer, fakeFactory } from './fakeSupabase';
import { deriveSyncCredentials, normalizeSyncCode, sha256Bytes, sha256Hex } from './syncCode';

const ENV = { url: 'https://svbpsgllxlcjgkrlagrp.supabase.co', anonKey: 'sb_publishable_test' };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('normalizeSyncCode', () => {
  it('trims, lowercases and turns whitespace runs into a single hyphen', () => {
    expect(normalizeSyncCode('  Blue   Sky\tDiary  ')).toEqual({ ok: true, code: 'blue-sky-diary' });
    expect(normalizeSyncCode('Em_Time.2026')).toEqual({ ok: true, code: 'em_time.2026' });
  });
  it('rejects empty input', () => {
    expect(normalizeSyncCode('')).toEqual({ ok: false, error: 'code_empty' });
    expect(normalizeSyncCode('   \n ')).toEqual({ ok: false, error: 'code_empty' });
  });
  it('rejects fewer than 8 characters after normalizing', () => {
    expect(normalizeSyncCode('abc')).toEqual({ ok: false, error: 'code_too_short' });
    expect(normalizeSyncCode('  ABCDEFG  ')).toEqual({ ok: false, error: 'code_too_short' });
    expect(normalizeSyncCode('abcdefgh')).toEqual({ ok: true, code: 'abcdefgh' });
    expect(normalizeSyncCode('a b c d')).toEqual({ ok: false, error: 'code_too_short' }); // a-b-c-d is 7
    expect(normalizeSyncCode('a b c d e')).toEqual({ ok: true, code: 'a-b-c-d-e' });
  });
  it('rejects characters outside a-z 0-9 - _ . and codes over 64 characters', () => {
    expect(normalizeSyncCode('hello world!!')).toEqual({ ok: false, error: 'code_invalid_chars' });
    expect(normalizeSyncCode('em@example.com')).toEqual({ ok: false, error: 'code_invalid_chars' });
    expect(normalizeSyncCode('x'.repeat(65))).toEqual({ ok: false, error: 'code_too_long' });
    expect(normalizeSyncCode('x'.repeat(64)).ok).toBe(true);
  });
});

describe('deriveSyncCredentials', () => {
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');

  it('builds the email from the slug and the password from SHA-256', async () => {
    const r = await deriveSyncCredentials('Blue.Sky Diary');
    expect(r).toEqual({
      ok: true,
      credentials: {
        email: 'blue-sky-diary@emtime.local',
        password: sha('em-time:v1:blue.sky-diary'),
      },
    });
  });
  it('is deterministic and ignores case and spacing differences', async () => {
    const a = await deriveSyncCredentials('Moon Light 99');
    const b = await deriveSyncCredentials('  moon   light 99 ');
    const c = await deriveSyncCredentials('MOON-LIGHT-99');
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(await deriveSyncCredentials('Moon Light 99')).toEqual(a);
  });
  it('different codes give different accounts', async () => {
    const a = await deriveSyncCredentials('moon-light-99');
    const b = await deriveSyncCredentials('moon-light-98');
    expect(a.ok && b.ok && a.credentials.email !== b.credentials.email).toBe(true);
    expect(a.ok && b.ok && a.credentials.password !== b.credentials.password).toBe(true);
  });
  it('rejects a bad code with the normalizer error', async () => {
    expect(await deriveSyncCredentials('short')).toEqual({ ok: false, error: 'code_too_short' });
  });
  it('the pure-JS fallback matches Web Crypto, including block-boundary lengths', async () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 200]) {
      const text = 'é'.repeat(n % 2) + 'a'.repeat(n);
      const bytes = new TextEncoder().encode(text);
      const hex = Array.from(sha256Bytes(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
      expect(hex).toBe(sha(text));
      expect(await sha256Hex(text)).toBe(sha(text));
    }
  });
});

describe('engine.signInWithCode', () => {
  let engine: SyncEngine | null = null;
  afterEach(() => {
    engine?.dispose();
    engine = null;
  });

  function setup(opts: { confirmEmail?: boolean } = {}) {
    const server = createFakeServer();
    server.confirmEmail = opts.confirmEmail ?? false;
    const store = createStore({
      data: createDefaultData(1_000, 'dev-a'),
      adapter: createMemoryAdapter(),
      now: () => 1_000,
    }) as EmStore;
    const f = fakeFactory(server);
    engine = createSyncEngine({ store, env: ENV, createClient: f.factory });
    return { server, store, engine, client: f.clients[0]! };
  }

  it('rejects a too-short code before any request', async () => {
    const { server, engine: e } = setup();
    await flush();
    server.log.length = 0;
    expect(await e.signInWithCode('abc')).toEqual({ ok: false, error: 'code_too_short' });
    expect(await e.signInWithCode('   ')).toEqual({ ok: false, error: 'code_empty' });
    expect(server.log).toEqual([]);
  });

  it('sign-in path: an existing account signs in with its derived credentials and never signs up', async () => {
    const { server, store, engine: e } = setup();
    const creds = await deriveSyncCredentials('blue-sky-diary');
    if (!creds.ok) throw new Error('unreachable');
    server.passwords.set(creds.credentials.email, creds.credentials.password);
    server.confirmed.add(creds.credentials.email);
    expect(await e.signInWithCode('Blue Sky Diary')).toEqual({ ok: true });
    const kinds = server.log.map((o) => o.kind);
    expect(kinds).toContain('signInWithPassword');
    expect(kinds).not.toContain('signUp');
    expect(store.get().meta.sync.userId).not.toBeNull();
    expect(store.get().meta.sync.email).toBeNull(); // the address contains the code: not kept in AppData
  });

  it('sign-up path: an unknown code creates the account, then merges local data', async () => {
    const { server, store, engine: e } = setup();
    store.addTask({ name: 'Local first' });
    expect(await e.signInWithCode('brand-new-code')).toEqual({ ok: true });
    expect(
      server.log.filter((o) => o.kind === 'signInWithPassword' || o.kind === 'signUp').map((o) => o.kind),
    ).toEqual(['signInWithPassword', 'signUp']);
    expect(server.passwords.has('brand-new-code@emtime.local')).toBe(true);
    await flush();
    await e.syncNow();
    expect([...server.tables.tasks.values()].map((r) => r.name)).toEqual(['Local first']);
    expect(store.get().meta.sync.userId).toBe([...server.users.values()][0]);
    // the code and password never reach AppData
    const json = JSON.stringify(store.get());
    expect(json).not.toContain('brand-new-code');
    expect(json).not.toContain(server.passwords.get('brand-new-code@emtime.local')!);
  });

  it('a second device with the same code (any casing) lands in the same account', async () => {
    const { server, engine: e } = setup();
    expect(await e.signInWithCode('Shared Code 1')).toEqual({ ok: true });
    const uid = [...server.users.values()][0];
    const f2 = fakeFactory(server);
    const store2 = createStore({
      data: createDefaultData(2_000, 'dev-b'),
      adapter: createMemoryAdapter(),
      now: () => 2_000,
    }) as EmStore;
    const e2 = createSyncEngine({ store: store2, env: ENV, createClient: f2.factory });
    expect(await e2.signInWithCode('shared-code-1')).toEqual({ ok: true });
    expect(server.users.size).toBe(1);
    expect(store2.get().meta.sync.userId).toBe(uid);
    e2.dispose();
  });

  it('confirm_email_on path: sign-up returns a user but no session', async () => {
    const { server, store, engine: e } = setup({ confirmEmail: true });
    const r = await e.signInWithCode('needs-confirm-off');
    expect(r).toEqual({ ok: false, error: 'confirm_email_on', message: CONFIRM_EMAIL_ON_MESSAGE });
    expect(CONFIRM_EMAIL_ON_MESSAGE).toMatch(/Confirm email/);
    expect(store.get().meta.sync.userId).toBeNull();
    expect(e.state().status).toBe('signed-out');
    // an account that was created while confirmation was on reports the same thing on the next try
    expect(await e.signInWithCode('needs-confirm-off')).toMatchObject({
      ok: false,
      error: 'confirm_email_on',
    });
    expect(server.users.size).toBe(1);
  });

  it('keeps signOut at local scope', async () => {
    const { store, engine: e, client } = setup();
    await e.signInWithCode('local-scope-out');
    await e.signOut();
    expect(client.signOutCalls).toEqual([{ scope: 'local' }]);
    expect(store.get().meta.sync.userId).toBeNull();
  });
});
