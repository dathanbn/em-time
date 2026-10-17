# Em Time v6: Friends (spec)

Approved by Dathan 2026-10-17. Builder: implement exactly this; record any deviation in HANDOFF.md.

## 0. What it is

A signed-in user can share a **read-only friend code** and add up to **5 friends' codes**. Stats gets a
small **Friends** tile (same size as the Today tile) with a line chart of focus minutes per day for the
last 7 study days: one line for **You** plus one per friend, each friend in a fixed color.

Not the sync code. The sync code is the account password; it must never be shown, sent or accepted here.

## 1. Data model (Supabase)

New migration `frontend/supabase/migrations/20261017000000_em_time_friends.sql`. Additive only; the
v1 sync migration is untouched. Style it like the v1 file (sections, comments, `set search_path = ''`,
schema-qualified names).

```sql
-- friend_shares: one row per user who shares. code is 8 chars of Crockford base32
create table if not exists public.friend_shares (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code       text not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  created_at timestamptz not null default now()
);
-- friend_links: the caller's list of friends' codes (max 5, enforced in em_friend_add)
create table if not exists public.friend_links (
  user_id    uuid not null references auth.users (id) on delete cascade,
  code       text not null check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  nickname   text check (nickname is null or char_length(nickname) between 1 and 24),
  color      smallint not null check (color between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, code),
  unique (user_id, color)
);
```

Both tables: RLS enabled, **no policies**, `revoke all ... from anon, authenticated`. All access goes
through these functions: `language plpgsql security definer set search_path = ''`, each starting with
`if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;`
Then `revoke all on function ... from public, anon; grant execute ... to authenticated;`.

| Function | Returns | Behaviour |
|---|---|---|
| `em_share_get()` | `text` | caller's code or null |
| `em_share_enable()` | `text` | create a code if none (retry on unique violation), return it |
| `em_share_rotate()` | `text` | replace the code with a fresh one (create if none), return it |
| `em_share_disable()` | `void` | delete the caller's row |
| `em_friend_add(p_code text, p_nickname text)` | `text` | `'ok'`, `'invalid'`, `'not_found'`, `'own_code'`, `'duplicate'`, `'limit'`. Normalize code server side too (upper, drop everything not alnum, O→0, I/L→1). Nickname: trim, empty → null, cut to 24 code points. Color = lowest free 1..5. |
| `em_friend_rename(p_code text, p_nickname text)` | `void` | same nickname rules |
| `em_friend_remove(p_code text)` | `void` | delete the link |
| `em_friends_week(p_from date, p_to date)` | `jsonb` | raise `22023` if `p_to < p_from` or `p_to - p_from > 13`. Array ordered by `created_at` of `{ "code", "nickname", "displayName", "color", "active", "days": { "YYYY-MM-DD": focusedMs } }`. `active` = a share with that code exists. `displayName` = that user's `settings.data->>'displayName'` (null if inactive or no settings row). `days` sums `sessions.focused_ms` where `deleted_at is null` and `day between p_from and p_to`, grouped by `day`; days with no sessions are omitted. Inactive friends get `{}`. |

Code generation (no pgcrypto, no `random()`): take bytes 0–5 and 9–10 of
`uuid_send(gen_random_uuid())`, each `% 32` into `'0123456789ABCDEFGHJKMNPQRSTVWXYZ'`. (Bytes 6 and 8
carry version/variant bits; skip them.) Display format is `XXXX-XXXX`; stored without the dash.

The day used is each friend's own study day (`sessions.day`), which is what their app shows them.
Friends see only: display name, minutes per study day. Never task names, categories or times of day.

## 2. Core (`frontend/src/core/`)

`core/sync/friendCode.ts` (pure, main-chunk safe, exported from `@core`):
- `FRIENDS_MAX = 5`, `FRIEND_CODE_LEN = 8`
- `normalizeFriendCode(raw): { ok: true; code: string } | { ok: false }` same rules as the SQL.
- `formatFriendCode(code): string` → `XXXX-XXXX`.

`SupabaseLike` gains `rpc(fn: string, args?: object): Promise<{ data: unknown; error: PostgrestErrorLike | null }>`.

`SyncEngine` gains `friends: FriendsApi` (types in `api.ts` or next to the engine, exported):

```ts
export type FriendsError = 'signed_out' | 'offline' | 'auth-expired' | 'unknown';
export type FriendAddError = 'invalid' | 'not_found' | 'own_code' | 'duplicate' | 'limit' | FriendsError;
export interface FriendWeek { code: string; nickname: string | null; displayName: string | null;
  color: 1 | 2 | 3 | 4 | 5; active: boolean; days: Record<ISODay, number> }
export type FriendsResult<T> = { ok: true; value: T } | { ok: false; error: FriendsError };
export interface FriendsApi {
  getShare(): Promise<FriendsResult<string | null>>;
  enableShare(): Promise<FriendsResult<string>>;
  rotateShare(): Promise<FriendsResult<string>>;
  disableShare(): Promise<FriendsResult<null>>;
  add(code: string, nickname?: string): Promise<{ ok: true } | { ok: false; error: FriendAddError }>;
  rename(code: string, nickname: string): Promise<FriendsResult<null>>;
  remove(code: string): Promise<FriendsResult<null>>;
  week(from: ISODay, to: ISODay): Promise<FriendsResult<FriendWeek[]>>;
}
```
`add` validates with `normalizeFriendCode` before any request. Errors are classified with the
engine's existing helpers (network → `offline`, auth → `auth-expired`). Never throw into the UI.
Validate the jsonb from `em_friends_week` defensively (drop malformed entries, clamp ms ≥ 0).

`fakeSupabase.ts`: implement `rpc` for all eight functions in memory (same rules, including limit,
duplicate, own code, colors, inactive after rotate/disable, deleted sessions excluded, window).

No AppData/schema change. Friends are online state, not local-first records.

## 3. Frontend

### 3.1 `app/friends.ts` (main chunk, small)
Signal `friends` = `{ status: 'off' | 'signed-out' | 'loading' | 'ready' | 'error' | 'offline'; share: string | null;
list: FriendWeek[]; fetchedAt: number | null }`.
- `'off'` when sync is not configured (`isSyncConfigured(readSyncEnv())` false): nothing friends-related renders anywhere.
- Cache the last good `{ share, list, from, to, fetchedAt }` in localStorage `em-time:friends-cache`
  (device only, try/catch, validated on read, ignored if from a different user id). Show it instantly, then refresh.
- `refreshFriends({ force? })`: needs the engine via `core.loadSync()` and a signed-in sync state; window
  is `from = addDays(todayKey(now, dayStart), -6)`, `to = today` (use the core time helpers the rest of
  the app uses for study days). Throttle to once per 60 s unless forced. Called when Stats mounts,
  when the Settings Friends card mounts, after any friends mutation, and on `visibilitychange` to visible while Stats is open.
- Clear the cache on sign-out and in Erase all data (next to `clearStopwatch()`/`clearUiMemory()`).
- Dev only: with `?stub`, serve a fixture (share `K7QP2MXD`, 3 friends: "Cathy" color 1, "Jordan" color 2,
  one inactive "Sam" color 3, realistic minutes 0–180 per day) so the UI can be screenshotted without a
  server. Keep it out of the production bundle (dynamic import behind `import.meta.env.DEV`).

### 3.2 Stats tile (`charts/FriendsChart.tsx` + tile in `screens/Stats.tsx`)
- Tile order: Today, **Friends**, Current streak, Best streak. `data-testid="friends-tile"`, label "Friends".
- Layout: phone (< 900 px): Today full width, Friends full width, then the two streak tiles side by side.
  Desktop (≥ 900 px): `1.2fr 1.2fr 1fr` columns; Today and Friends span two rows; the two streak tiles
  stack in column 3. Friends tile height equals Today's.
- Chart (SVG, sized with the existing `useSize`): 7 points; x labels `6 5 4 3 2 1 Today` (as in Dathan's
  sketch; the axis is "days ago", put that in the accessible name, no visible axis title in the tile);
  y from 0 to a nice max (30 min steps under 2 h, then hours), 2–3 recessive gridlines labelled `0`,
  `1h`, `2h` style (`formatDuration`-like short form). 2 px lines, round joins, ≥ 6 px point markers with
  a 2 px surface ring, today's point slightly larger.
- Series: **You** = `var(--em-ink-2)`, drawn first (underneath), dashed `4 3` so it never relies on color.
  Friends = `var(--em-cat-<color>)` (the existing validated categorical tokens, light and dark already
  defined). Color follows the friend (server `color`), never list position.
- Legend under the chart: dot + name for every series ("You", then friends in list order). Name =
  nickname, else displayName, else `Friend N`. Inactive friends: legend entry with "(code off)" in muted
  ink, no line. Text uses ink tokens, never the series color.
- Hover/tap: crosshair on the nearest day plus the existing `Tooltip` listing every series' minutes that
  day (sorted high to low). Keyboard: the plot is focusable, Left/Right move the day.
- Accessible: `role="img"` with an `aria-label` summary ("Focus minutes, last 7 days: You 2 h 10 min
  total, Cathy 3 h 5 min total, ..."), plus a visually hidden `<table>` (day × series minutes) in the tile.
- States inside the same tile size:
  - signed out: short text "Link this device in Settings to compare focus time with friends." + a
    secondary button "Open Settings" → `#/settings` (`data-testid="friends-tile-link"`).
  - signed in, 0 friends: chart with only You + text "Add a friend's code in Settings." (same button).
  - loading with no cache: the chart frame with a quiet "Loading…" line.
  - offline/error with cache: chart + `tile__note` "Updated 2 h ago" style. Offline without cache: "Friends
    will load when you're back online."
- Own minutes come from existing selectors (e.g. `core.select.trend(30)` last 7 points' `valueMin`, or the
  heatmap cells) — no new core math. Running sessions are not counted (same as Today).

### 3.3 Settings `FriendsCard` (lazy chunk, like `NoisePanel`)
Rendered right after `SyncCard`, only when sync is configured. Title "Friends". `data-testid="settings-friends"`.
- Not signed in: one line "Link this device with a sync code above to share with friends." Nothing else.
- **Your friend code** (subhead): sharing off → explanation "Friends with your code see your name
  ({displayName}) and how many minutes you focus each day. Nothing else." + button "Get my friend code"
  (`friends-share-enable`). Sharing on → the code large, monospace-ish tabular, `XXXX-XXXX`
  (`friends-share-code`), buttons "Copy" (`friends-share-copy`, clipboard + `announce('Code copied')`),
  "Share" (only when `navigator.share` exists), "New code" (`friends-share-rotate`, confirm Dialog: "Friends
  using your current code will stop seeing your minutes until you send them the new one."), "Stop sharing"
  (`friends-share-disable`, confirm Dialog). Make clear in one line this is not the sync code: "This is
  not your sync code. It can't open or change your data."
- **Friends (n of 5)** (subhead): list rows `friends-row` with color dot, name, formatted code in muted
  ink, "Code off" badge when inactive, rename (inline edit or small dialog) and remove (icon button,
  confirm). Add form (`friends-add-code`, `friends-add-name` optional "Name (optional)", `friends-add`):
  hidden when 5; errors in `friends-add-error`:
  invalid "Friend codes are 8 letters and numbers, like K7QP-2MXD.", not_found "No one is sharing with
  that code. Check it with your friend.", own_code "That's your own code.", duplicate "That friend is
  already on your list.", limit "You can add up to 5 friends.", offline "Can't reach the server. Try
  again when you're online.", auth-expired "Link this device again to manage friends.", unknown "Something
  went wrong. Try again."
- Every control ≥ 44×44 on phone, focus rings like the rest, axe clean in light, dark and sky.

### 3.4 Budgets
Main JS budget is 62 KB gz with ~850 B left. Put FriendsCard and the dev fixture in lazy chunks. If the
Stats tile still pushes the main chunk over, lazy-load `FriendsChart` too (tile renders its frame first).
Raising `BUDGET` is allowed up to 64 KB only with a note in HANDOFF. CSS stays under 16 KB.

## 4. Tests
- Unit: `friendCode` (normalize/format, Crockford mapping), engine `friends.*` against the fake (each
  error, colors, inactive, window, malformed jsonb), `app/friends` cache (validation, user mismatch,
  throttle), chart geometry helpers (nice max, x positions), SQL text test like `tests/unit/sql.test.ts`
  (RLS on, no policies, security definer + search_path on every function, grants only to authenticated).
- If PostgreSQL can be installed in the sandbox (`apt-get install -y postgresql`), run both migrations
  against a stub `auth` schema (`auth.users`, `auth.uid()` reading a GUC) and exercise every function,
  including two users seeing each other and RLS/grants denying direct table access. Report results.
- E2E (`tests/e2e/friends.spec.ts`), on the :4174 fake-env build with `page.route` mocking
  `/rest/v1/rpc/*` and auth like `sync.spec.ts`: tile hidden on :4173; tile states; chart has one path
  per active series; legend names; tooltip; table; Settings add/remove/limit/errors/rotate/disable;
  phone and desktop geometry (tile heights equal Today's, no overflow at 360×740 and 390×844); axe.
- Screenshots `tests/screenshots/v6-stats-{1280,390}-{midday,night}.png` and
  `v6-settings-friends-{1280,390}.png` with 3 friends (one inactive).
- Full `npm run typecheck`, `npm run lint`, `npx vitest run`, `VITE_E2E=1 npm run build` must pass.

## 5. Out of scope
Friend requests/approval, mutual-only sharing, push notifications, history beyond 7 days.
