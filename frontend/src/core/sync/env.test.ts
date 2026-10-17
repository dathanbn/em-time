import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEY } from '../constants';
import { createEmCore } from '../core';
import { createMemoryAdapter } from '../storage/persist';
import { TEST_COPY } from '../fixtures/test-copy';
import { hasStoredAuth, isSyncConfigured, readSyncEnv } from './env';

const supabase = vi.hoisted(() => ({ imports: 0 }));
vi.mock('@supabase/supabase-js', () => {
  supabase.imports += 1;
  return { createClient: () => ({}) };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isSyncConfigured', () => {
  it('needs both values, non-empty, and an https url', () => {
    expect(isSyncConfigured({})).toBe(false);
    expect(isSyncConfigured({ url: 'https://a.supabase.co' })).toBe(false);
    expect(isSyncConfigured({ anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: '', anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: 'https://a.supabase.co', anonKey: '' })).toBe(false);
    expect(isSyncConfigured({ url: 'https://a.supabase.co', anonKey: '   ' })).toBe(false);
    expect(isSyncConfigured({ url: 'http://example.com', anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: 'ftp://a', anonKey: 'k' })).toBe(false);
    expect(isSyncConfigured({ url: 'https://a.supabase.co', anonKey: 'k' })).toBe(true);
    expect(isSyncConfigured({ url: 'http://localhost:54321', anonKey: 'k' })).toBe(true);
  });
});

describe('readSyncEnv', () => {
  it('reads the two VITE_ variables and omits empty ones', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    expect(readSyncEnv()).toEqual({});
    expect(isSyncConfigured(readSyncEnv())).toBe(false);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_x');
    expect(readSyncEnv()).toEqual({ url: 'https://x.supabase.co', anonKey: 'sb_publishable_x' });
    expect(isSyncConfigured(readSyncEnv())).toBe(true);
  });
});

describe('hasStoredAuth', () => {
  const fakeStorage = (items: Record<string, string>) => ({ getItem: (k: string) => items[k] ?? null });

  it('is true when the auth session key exists', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [AUTH_STORAGE_KEY]: '{}' }));
    expect(hasStoredAuth()).toBe(true);
  });
  it('is false without it, and when storage is unavailable', () => {
    vi.stubGlobal('localStorage', fakeStorage({}));
    expect(hasStoredAuth()).toBe(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(hasStoredAuth()).toBe(false);
  });
  it('ignores a ?code= return and a leftover PKCE verifier: only a stored session counts', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [`${AUTH_STORAGE_KEY}-code-verifier`]: 'v' }));
    vi.stubGlobal('location', { search: '?code=abc' });
    expect(hasStoredAuth()).toBe(false);
  });
});

describe('without configuration nothing from supabase-js is ever loaded', () => {
  it('core.loadSync resolves null and never asks for the client library', async () => {
    const loadSupabase = vi.fn(async () => {
      throw new Error('must not be called');
    });
    const core = createEmCore({
      storage: createMemoryAdapter(),
      copy: TEST_COPY,
      syncEnv: {},
      loadSupabase,
    });
    expect(await core.loadSync()).toBeNull();
    expect(await core.loadSync()).toBeNull();
    expect(loadSupabase).not.toHaveBeenCalled();
    expect(supabase.imports).toBe(0);
    core.dispose();
  });

  it('the engine module itself does not import supabase-js until loadSupabaseFactory runs', async () => {
    const { loadSupabaseFactory } = await import('./engine');
    expect(supabase.imports).toBe(0);
    const factory = await loadSupabaseFactory();
    expect(typeof factory).toBe('function');
    expect(supabase.imports).toBe(1);
  });
});
