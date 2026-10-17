// QA tests for the v3 sync code sign-in (replaces magic link and OTP). The reference values come from
// harness-side code (node:crypto, plain string rules), not from the product's own derivation.
import { describe, expect, it } from 'vitest';
import { deriveSyncCredentials, normalizeSyncCode, SYNC_CODE_MAX, SYNC_CODE_MIN } from '@core';
import { at } from './helpers';
import { FakeServer, flush, makeDevice, normalizeCode, syncEmail, syncPassword } from './syncHarness';

const T0 = at(2026, 10, 14, 10, 0);
const setup = () => {
  const server = new FakeServer();
  const a = makeDevice(server, 'A', T0);
  const b = makeDevice(server, 'B', T0 + 3_600_000);
  return { server, a, b };
};

describe('normalizeSyncCode', () => {
  it('trims, lowercases and turns whitespace runs into one dash', () => {
    expect(normalizeSyncCode('  Blue Sky   Morning  ')).toEqual({ ok: true, code: 'blue-sky-morning' });
    expect(normalizeSyncCode('BLUE\tSKY\nMORNING')).toEqual({ ok: true, code: 'blue-sky-morning' });
  });
  it('accepts a-z 0-9 dash underscore and dot', () => {
    expect(normalizeSyncCode('em_time.2026-a')).toEqual({ ok: true, code: 'em_time.2026-a' });
  });
  it('empty and whitespace-only is code_empty', () => {
    expect(normalizeSyncCode('')).toEqual({ ok: false, error: 'code_empty' });
    expect(normalizeSyncCode('    ')).toEqual({ ok: false, error: 'code_empty' });
  });
  it(`under ${SYNC_CODE_MIN} characters after normalizing is code_too_short (7 fails, 8 passes)`, () => {
    expect(normalizeSyncCode('abcdefg')).toEqual({ ok: false, error: 'code_too_short' });
    expect(normalizeSyncCode('abcdefgh')).toEqual({ ok: true, code: 'abcdefgh' });
    expect(normalizeSyncCode('  ab cd  ')).toEqual({ ok: false, error: 'code_too_short' }); // "ab-cd" is 5
  });
  it(`over ${SYNC_CODE_MAX} characters is code_too_long (64 passes, 65 fails)`, () => {
    expect(normalizeSyncCode('a'.repeat(SYNC_CODE_MAX))).toMatchObject({ ok: true });
    expect(normalizeSyncCode('a'.repeat(SYNC_CODE_MAX + 1))).toEqual({ ok: false, error: 'code_too_long' });
  });
  it('anything outside the allowed set is code_invalid_chars (at, slash, plus, accents, emoji, quotes)', () => {
    for (const bad of ['her@example.com', 'blue/sky/morning', 'blue+sky+morning', 'café-café-café', 'sky-sky-sky-🌤', "o'brien-code-1", 'semi;colon-code']) {
      expect(normalizeSyncCode(bad), bad).toEqual({ ok: false, error: 'code_invalid_chars' });
    }
  });
  it('matches the independent reference normalizer on a spread of valid inputs', () => {
    for (const raw of ['Blue Sky Morning', ' MIXED case Code 99 ', 'a.b.c.d.e.f.g.h', 'under_score_ok']) {
      const r = normalizeSyncCode(raw);
      expect(r).toEqual({ ok: true, code: normalizeCode(raw) });
    }
  });
});

describe('deriveSyncCredentials', () => {
  it('is deterministic and equals the independent derivation (email slug, SHA-256 password)', async () => {
    for (const raw of ['blue sky morning', 'em_time.2026-a', 'Plain-Code-1234']) {
      const one = await deriveSyncCredentials(raw);
      const two = await deriveSyncCredentials(raw);
      expect(one).toEqual(two);
      expect(one).toEqual({ ok: true, credentials: { email: syncEmail(raw), password: syncPassword(raw) } });
    }
  });
  it('is the same for any casing and spacing that normalizes alike, and different for different codes', async () => {
    const a = await deriveSyncCredentials('Blue Sky Morning');
    const b = await deriveSyncCredentials('  blue   sky morning ');
    const c = await deriveSyncCredentials('blue-sky-evening');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it('the email is on the dathanbn.github.io domain, dots become dashes, and the password is 64 hex characters', async () => {
    const r = await deriveSyncCredentials('a.b.c.d.e.f.g.h');
    if (!r.ok) throw new Error('expected ok');
    expect(r.credentials.email).toBe('a-b-c-d-e-f-g-h@dathanbn.github.io');
    expect(r.credentials.password).toMatch(/^[0-9a-f]{64}$/);
  });
  it('returns the validation error and derives nothing for a bad code', async () => {
    expect(await deriveSyncCredentials('short')).toEqual({ ok: false, error: 'code_too_short' });
    expect(await deriveSyncCredentials('bad@chars-here')).toEqual({ ok: false, error: 'code_invalid_chars' });
  });
});

describe('signInWithCode', () => {
  it('signs in an existing account with signInWithPassword only (no sign-up)', async () => {
    const { server, a } = setup();
    server.accounts.set(syncEmail('blue sky morning'), syncPassword('blue sky morning'));
    server.confirmed.add(syncEmail('blue sky morning'));
    await a.attach();
    const r = await a.engine!.signInWithCode('Blue Sky Morning');
    expect(r).toEqual({ ok: true });
    expect(server.authCalls.map((c) => c.op)).toEqual(['signInWithPassword']);
    expect(a.core.store.get().meta.sync.userId).not.toBeNull();
  });

  it('creates the account on first use: signInWithPassword fails, signUp succeeds and a session exists', async () => {
    const { server, a } = setup();
    await a.attach();
    const r = await a.engine!.signInWithCode('brand new code');
    expect(r).toEqual({ ok: true });
    expect(server.authCalls.map((c) => c.op)).toEqual(['signInWithPassword', 'signUp']);
    expect(server.authCalls[1]).toMatchObject({ email: syncEmail('brand new code'), password: syncPassword('brand new code') });
    expect(a.core.store.get().meta.sync.userId).not.toBeNull();
  });

  it('reports confirm_email_on when signUp returns a user but no session (Confirm email setting on)', async () => {
    const { server, a } = setup();
    server.confirmEmail = true;
    await a.attach();
    const r = await a.engine!.signInWithCode('brand new code');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('confirm_email_on');
      expect(r.message).toMatch(/confirm/i);
    }
    expect(a.core.store.get().meta.sync.userId).toBeNull();
  });

  it('an existing but unconfirmed account also gives confirm_email_on (and does not sign up again)', async () => {
    const { server, a } = setup();
    server.confirmEmail = true;
    server.accounts.set(syncEmail('already made'), syncPassword('already made'));
    await a.attach();
    const r = await a.engine!.signInWithCode('already made');
    expect(r).toMatchObject({ ok: false, error: 'confirm_email_on' });
    expect(server.authCalls.map((c) => c.op)).toEqual(['signInWithPassword']);
  });

  it('validation errors return before any request', async () => {
    const { server, a } = setup();
    await a.attach();
    expect(await a.engine!.signInWithCode('short')).toEqual({ ok: false, error: 'code_too_short' });
    expect(await a.engine!.signInWithCode('')).toEqual({ ok: false, error: 'code_empty' });
    expect(await a.engine!.signInWithCode('a'.repeat(65))).toEqual({ ok: false, error: 'code_too_long' });
    expect(await a.engine!.signInWithCode('her@example.com')).toEqual({ ok: false, error: 'code_invalid_chars' });
    expect(server.authCalls).toHaveLength(0);
  });

  it('the same code on two devices is one account and the data meets', async () => {
    const { server, a, b } = setup();
    a.core.store.addTask({ name: 'from A' });
    await a.signIn('shared code 1234');
    await a.engine!.syncNow();
    await b.signIn('Shared  Code 1234');
    await b.engine!.syncNow();
    await flush();
    expect(server.users.size).toBe(1);
    expect(b.core.store.get().tasks.some((t) => t.name === 'from A')).toBe(true);
  });
});

describe('the derived email and password never reach AppData or an export', () => {
  it('after sign-in, sync and export: meta.sync.email is null and neither the address, the slug nor the password appears anywhere', async () => {
    const { a } = setup();
    const code = 'secret words 4242';
    a.core.store.addTask({ name: 'a task' });
    await a.signIn(code);
    await a.engine!.syncNow();
    const data = a.core.store.get();
    expect(data.meta.sync.email ?? null).toBeNull();
    const exported = a.core.store.exportNow(a.clock.now()).json;
    const stored = JSON.stringify(data);
    for (const [label, blob] of [['AppData', stored], ['export', exported]] as const) {
      expect(blob, `${label}: address`).not.toContain(syncEmail(code));
      expect(blob, `${label}: domain`).not.toContain('dathanbn.github.io');
      expect(blob, `${label}: password`).not.toContain(syncPassword(code));
      expect(blob, `${label}: code`).not.toContain(normalizeCode(code));
    }
  });

  it('SyncState.email is null for a code account', async () => {
    const { a } = setup();
    await a.signIn('another long code');
    expect(a.engine!.state().email ?? null).toBeNull();
  });
});
