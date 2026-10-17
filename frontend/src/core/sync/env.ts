import { AUTH_STORAGE_KEY } from '../constants';
import type { SyncEnv } from '../api';

/** The only place VITE_SUPABASE_* is read. Missing values yield an unconfigured (local-only) app. */
export function readSyncEnv(): Partial<SyncEnv> {
  const url: unknown = import.meta.env?.VITE_SUPABASE_URL;
  const anonKey: unknown = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  return {
    ...(typeof url === 'string' && url.length > 0 ? { url } : {}),
    ...(typeof anonKey === 'string' && anonKey.length > 0 ? { anonKey } : {}),
  };
}

/** Both values non-empty strings and the URL is https:// (or http://localhost for local dev). */
export function isSyncConfigured(env: Partial<SyncEnv>): env is SyncEnv {
  const { url, anonKey } = env;
  if (typeof url !== 'string' || typeof anonKey !== 'string') return false;
  if (url.trim().length === 0 || anonKey.trim().length === 0) return false;
  return url.startsWith('https://') || url.startsWith('http://localhost');
}

/**
 * True when a Supabase auth session was persisted on this device, or when the page was opened
 * from a magic link (?code=) and the PKCE verifier saved at sign-in is still here: the engine must
 * load to exchange that code, even though no session is stored yet.
 */
export function hasStoredAuth(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(AUTH_STORAGE_KEY) !== null) return true;
    return (
      typeof location !== 'undefined' &&
      /[?&]code=/.test(location.search) &&
      localStorage.getItem(`${AUTH_STORAGE_KEY}-code-verifier`) !== null
    );
  } catch {
    return false;
  }
}
