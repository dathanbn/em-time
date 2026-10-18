// Friends (v6), device side: the one signal the Stats tile and the Settings card read, and the thin
// parts that must live in the main chunk. Everything that talks to the server, the localStorage
// cache and the UI are a lazy chunk (components/FriendsUi.tsx, with app/friendsRun.ts behind it).
// Friends are online state, not a local-first record: nothing here runs a request unless sync is
// configured and signed in.
import { computed, effect, signal } from '@preact/signals';
import { isSyncConfigured, readSyncEnv, type FriendWeek, type FriendsError } from '@core';
import type * as FriendsUi from '../components/FriendsUi';
import { data } from './coreBridge';

export type FriendsStatus = 'off' | 'signed-out' | 'loading' | 'ready' | 'error' | 'offline';
export interface FriendsState {
  status: FriendsStatus;
  /** My own friend code, or null when I am not sharing (or it has not loaded). */
  share: string | null;
  list: FriendWeek[];
  /** When `list` was fetched from the server (Date.now()), or null before the first answer. */
  fetchedAt: number | null;
  /** Why the last refresh failed (status error or offline), else null. */
  error: FriendsError | null;
}

/** device only (localStorage), see app/friendsRun.ts */
export const FRIENDS_CACHE_KEY = 'em-time:friends-cache';

const OFF: FriendsState = { status: 'off', share: null, list: [], fetchedAt: null, error: null };
export const friends = signal<FriendsState>(OFF);

/** Bumps whenever the account changes (so an old answer never lands on a new account); lastOkAt throttles. */
export const friendsRunState = { gen: 0, lastOkAt: 0 };

/** The Stats tile body and the Settings card: one lazy chunk. */
export const friendsUi = signal<typeof FriendsUi | null>(null);
let loading: Promise<typeof FriendsUi> | null = null;
export const loadFriendsUi = (): Promise<typeof FriendsUi> =>
  (loading ??= import('../components/FriendsUi').then((m) => (friendsUi.value = m)));

function clearCache(): void {
  try {
    localStorage.removeItem(FRIENDS_CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Sign-out and Erase all data: forget the cache and go back to the signed-out (or off) state. */
export function clearFriends(): void {
  clearCache();
  friendsRunState.gen += 1;
  friendsRunState.lastOkAt = 0;
  friends.value = isSyncConfigured(readSyncEnv()) ? { ...OFF, status: 'signed-out' } : OFF;
}

/**
 * Call once at boot. Follows the signed-in account: signed out clears everything; a (new) account
 * starts as `loading`, and the lazy side fills it from the cache or the server when a screen asks.
 */
export function initFriends(): void {
  const account = computed(() => data.value.meta.sync.userId);
  effect(() => {
    const id = account.value;
    friendsRunState.gen += 1;
    friendsRunState.lastOkAt = 0;
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('stub')) {
      friends.value = { ...OFF, status: 'loading' }; // dev fixture, served by app/friendsRun.ts
    } else if (!isSyncConfigured(readSyncEnv())) {
      friends.value = OFF;
    } else if (id === null) {
      clearCache();
      friends.value = { ...OFF, status: 'signed-out' };
    } else {
      friends.value = { ...OFF, status: 'loading' };
    }
  });
}

/**
 * Fetches my share code and the week. Once per 60 s unless `force`; one request pair at a time.
 * Never throws; failures set status and error.
 */
export function refreshFriends(opts: { force?: boolean } = {}): Promise<void> {
  const s = friends.value.status;
  if (s === 'off' || s === 'signed-out') return Promise.resolve();
  return loadFriendsUi().then((m) => m.refresh(opts), () => undefined);
}
