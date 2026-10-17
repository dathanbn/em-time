# HANDOFF

Anyone may append. Newest at the bottom.

## 2026-10-14, logic agent: Step 0 done (Gate A)

### What exists

- Root scaffold: `package.json` (+ `package-lock.json`, `npm install` done), `tsconfig.json`, `eslint.config.js` (flat config), `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`.
- Vite shell under `frontend/`: `index.html`, `vite.config.ts`, `pwa-assets.config.ts`, `public/{icon.svg,favicon.svg,robots.txt}`, `src/main.tsx` (placeholder `<h1>Em Time</h1>`; frontend replaces it). `npm run icons` generates the PNGs into `frontend/public/` (gitignored).
- `frontend/src/core/`: `types.ts`, `constants.ts` (verbatim, checked byte-for-byte against contract.md; excluded from Prettier so they stay verbatim), `api.ts` (section 3 interfaces), `index.ts` barrel, and working implementations of time, timer (reducer + engine), stats, copy picker, defaults, storage (adapters, load/save, migrate, validate, export/import/merge, LWW), store, `core.ts` (`createEmCore`) and `stub.ts` (`createStubCore`) with `fixtures/stub-data.json` (regenerate with `node frontend/src/core/fixtures/generate-stub-data.mjs`).
- Not implemented yet (throw "not implemented"): `sync/rows.ts` (`toRow`, `fromRow`), `sync/engine.ts` (`createSyncEngine`, `loadSupabaseFactory`). Sync is therefore always off for now; the stub passes `syncEnv: {}`.
- `frontend/supabase/migrations/20261015000000_em_time_sync.sql` (byte-identical to contract.md section 10) and `frontend/supabase/README.md`.
- Tests: `frontend/src/core/stub.test.ts` (every selector returns data, fixture shape, stub timer) and `core.smoke.test.ts`. `TZ=America/Los_Angeles npx vitest run` passes (also under UTC, Pacific/Auckland, Asia/Kolkata).

### For the frontend agent: building against the stub

```ts
import { createStubCore } from './core';            // or '@core' (tsconfig paths + Vite alias)
import messages from './data/messages.json';        // your Copy
const core = createStubCore({ copy: messages });     // full EmCore, fixture data, memory storage
// first-run / empty states (EDGE-8):
const empty = createStubCore({ copy: messages, empty: true });
```

- `createStubCore` is the REAL core (`createEmCore`) on a memory adapter seeded with the fixture, so timer, every store action, validation errors, selectors and `onPhaseComplete` behave for real. Reloading the page resets it (memory only). To finish a phase quickly: `core.store.updateSettings({ focusMin: 1 })` (flips preset to custom).
- Fixture "today" is the study day of the moment the stub is created. About 70 days, 137 sessions, 6 tasks (one done, one deleted), 5 categories, a 9-day current streak (10 if today already has a session; early morning before about 06:30 today is empty and the streak reads 8), one empty week at `week(-3)` (assumes Monday start), a 23:45 crossover on day -2, a 05:30 start on the previous study day, a 01:30, a 06:00 and a 05:59 boundary case.
- Switching to the real thing at Gate B: replace `createStubCore({ copy })` with `createEmCore({ copy })`. Same return type. `createEmCore` already works for all local features but is only smoke-tested until my Step 1 suites and QA's unit suite pass; do not ship against it before Gate B.
- Keep the stub out of the production bundle: import it dynamically behind `import.meta.env.DEV && ?stub`, or simply do not import it in production paths (it tree-shakes if unused).
- Import Vite aliases: `@core` is in `tsconfig.json` paths and `frontend/vite.config.ts`. QA: add the same alias to `vitest.config.ts` if you want to use it, or import by relative path.
- `.env.local` lives at the REPO ROOT (`envDir` is set to the repo root in vite.config.ts), not in `frontend/`.

### Additions to the contract (additive, nothing removed)

1. `core.pickBreakPrompt(): string | null`. The contract only delivers a break prompt through `PhaseCompleteEvent`, but a break also starts through Skip or the mode switcher, where there is no event and BRK-1 still needs a prompt. Draws from the persisted bag; null when "Break suggestions" is off.
2. `core.boot: { status, backupKey, dropped }`. The corrupt-data banner (contract section 6) needs to know startup status and the backup key; `StorageStatus` has no `recovered-corrupt`. Read the raw string with the adapter under `backupKey` to offer the download.
3. `createStubCore` accepts `empty?: boolean`.
4. `export type * from './api'` in the barrel: the section 3 interfaces (`EmCore`, `EmStore`, `TimerEngine`, `TimerConfig`, `TimerAction`, `PhaseEnd`, `StorageAdapter`, `ImportResult`, `SyncEnv`, `SupabaseLike`, ...) have no home in section 2 `types.ts`, and section 1 does not say where they are exported. `SyncEngine` stays exported from `./sync/engine` as the contract says.
5. Also exported: `ValidationError`, `MigrationError`, `timerConfigFromSettings`.

### Contract gaps and ambiguities, and what I chose (QA: please align tests)

- `diffDays(a, b)`: direction unspecified. Chosen: days from `a` to `b` (b minus a), so `addDays(a, diffDays(a, b)) === b` and `diffDays('2026-10-01','2026-10-14') === 13`.
- `StreakInfo.lastCountingDay`: unspecified. Chosen: the most recent study day (not after today) with a session, whether or not it is part of the current run; null if none.
- `TaskTotal.name` for a deleted task is the live name, else the session snapshot (else "Deleted task"); it never contains " (deleted)". The UI appends " (deleted)" when `deleted` is true (design.md 8.2).
- Week fold: the "No task" row takes part in the top-7 sort like any other row. 8 or more rows give 7 plus one `__other__` row ("Other tasks").
- `PhaseCompleteEvent` with a milestone: `message` is set to the milestone text (MIL-4 replaces the encouragement), and `milestone` is also set (for confetti). It is not null.
- Break prompt in `PhaseCompleteEvent` is drawn when a NEW focus session is logged and "Break suggestions" is on; null for break completions and duplicate completions.
- Timer cycle: on the 4th focus completion the state becomes `{ phase: 'long', cycle: 0 }` (contract 3.2). For cycle dots, show all `longEvery` dots filled while `phase === 'long'`.
- The reducer never auto-ends a running phase on non-`sync` actions; the engine closes out an already-over phase first, then applies the user action.
- Engine emits `change` before `phaseEnd`. `adopt()` emits `change` then runs a `sync`.
- Store: `exportNow` does not mutate (call `markExported(at)` yourself after the download). `updateSettings` throws `ValidationError(field, 'limit')` for out-of-range values (UI should clamp on blur, TMR-10); passing minute keys without `preset` flips `preset` to `custom`; passing a non-custom `preset` overrides minute keys with `PRESETS`.
- Types without a definition in contract.md: `AuthErrorLike`, `PostgrestErrorLike`, `SessionLike` (minimal shapes in `api.ts`); signatures of `createDefaultData(now, deviceId?)`, `createDefaultSettings()`, `createDefaultCategories()`.
- Validation requires UUID-shaped ids (Postgres `uuid` columns reject anything else). QA fixtures must use UUIDs for categories, tasks and sessions (and `meta.deviceId`), otherwise records are dropped on load/import.
- A `MIGRATIONS` step that is missing for a stored version is treated as identity (schemaVersion is stamped). Tests register synthetic steps on `MIGRATIONS` to prove the hook runs.
- `.env.example`: contract.md section 9 and tasks.md say empty values, architecture.md section 8 says the frontend creates `frontend/.env.example`, and the Step 0 order from the architect gave real public values at the repo root. I followed the order: root `.env.example` holds the real public URL and publishable key. (Nothing reads `.env.example`; a developer copies it to `.env.local`. A fresh checkout with no `.env.local` is local-only.)

### Tooling notes

- TypeScript is pinned to 6.0.x (`typescript@6.0.3`): `typescript-eslint@8.71` declares `typescript <6.1.0`, and the npm `latest` of TypeScript is 7.0.2. Upgrade only together with typescript-eslint.
- Preact is 11.x (current stable); `@preact/preset-vite@2.10` works with it (build and dev verified).
- `build` follows architecture.md exactly (`npm run icons && tsc --noEmit && vite build ...`); I did not add a `prebuild` hook so icons are not generated twice.
- Local `git` is not initialised in this folder (not asked to).

### Next (my Step 1)

Per-module test suites for the real core (calendar DST, reducer, engine drift, storage, store, stats), then sync (`rows.ts`, `engine.ts` with a fake `SupabaseLike`), verify the no-env build has no supabase-js in the main chunk. I will post "Core ready, swap stub" here at Gate B.

## 2026-10-15, frontend agent: UI complete against the stub, switched to createEmCore

- Built: shell + hash router, four screens, charts (`charts/`), platform modules, PWA (`sw-notify.js` is imported by the generated SW for notification clicks), `.github/workflows/deploy.yml` (architecture.md section 6 verbatim), `scripts/check-size.mjs` (runs as `postbuild`, fails above 60 KB gzipped initial JS).
- `main.tsx` uses `createEmCore({ copy })`; `?stub` (and `?stub=empty`) selects the stub in dev only via dynamic import. `window.__emCore` is exposed when MODE is not production or the URL has `?e2e`.
- Core additions used: `core.pickBreakPrompt()` (Skip and mode switch into a break, and a break already showing after reload) and `core.boot` (corrupt-data banner; the backup string is read straight from localStorage).
- Sync card: wired to `core.loadSync()` and the SyncEngine API only; hidden when `isSyncConfigured(readSyncEnv())` is false. `core/sync/engine.ts` was still the Step 0 stub when I finished, so the card was exercised against a fake engine (sign-in, code, errors, signed-in states, auth-expired), not the real one. EDGE-12 text ("This device's data will be added to the account you sign in to.") shows in the code step whenever `meta.sync.lastUserId` is set, because the UI cannot know the new account before verifying.
- After Erase and Import the UI calls `core.timer.adopt(store.get().timer)` so the engine follows the replaced timer state. If core should do that inside `eraseAll`/`importData`, say so and I will drop it.
- Test hooks: all `data-testid` values from contract.md section 9 are present, plus `week-table`, `task-table`, `heatmap-table`, `trend-table`, `import-error`, `import-dialog`.

## 2026-10-15, logic agent: Sync implemented (Step 1, sync part)

Sync is real now: `core/sync/{env,rows,engine}.ts`, plus `sync/fakeSupabase.ts` (test double that applies the SQL's RLS, LWW trigger and CHECK rules). `supabase-js` is reached only through `import('@supabase/supabase-js')` inside `loadSupabaseFactory`, so the build has three lazy chunks: engine 4.1 KB gz, supabase-js 53.4 KB gz, plus workbox-window. Initial JS 47.3 KB gz (budget 60). The no-env build has no Supabase URL in the main chunk. Tests: 74 passing in 5 files (27 engine, 8 rows, env/no-import tests, plus the earlier suites).

Deviations and additions (all additive or stricter, nothing removed):

- `hasStoredAuth()` is a superset: also true when the URL has `?code=` and the PKCE verifier (`em-time:auth-code-verifier`) exists. Without this, the first magic-link return on a device (no session stored yet) would never load the engine and the code would never be exchanged.
- `SupabaseLike.auth.signOut(opts?: { scope: 'local' })`: the engine passes `{ scope: 'local' }` so signing out here does not sign out the user's other devices (supabase-js defaults to global). Zero-argument mocks remain assignable. If signOut fails offline, the engine removes the `em-time:auth` key itself, and only that key.
- Row-level rejection covers Postgres classes 22 and 23 (the contract says 23): an invalid-text or out-of-range value would otherwise retry forever.
- Seeded settings (`updatedAt === 0`) are never pushed (dirty flag is cleared). Settings rows on the server therefore only exist after a real edit.
- `meta.sync.rejected` accumulates across runs and resets on sign-out or erase.
- Every run starts with `auth.getSession()` (this refreshes the token); no session while online gives `auth-expired`, while offline gives `offline`. Auth-state events are handled in a deferred callback (supabase-js deadlocks if the client is called inside it).
- `eraseCloud()` returns `{ ok: false }` without touching anything when offline or auth-expired. If the push of tombstones fails after `tombstoneAll`, local rows stay tombstoned and still queued, so the next sync finishes the job. On success it calls `store.eraseAll` then signs the client out (local scope).
- `store.applyRemote('tasks', ...)` clears `meta.currentTaskId` when the current task arrives deleted.
- A transport `TypeError` ("Failed to fetch") sets status `offline` and also schedules a backoff retry (so a flaky network without an `online` event still recovers).
- Not verified against the live project: the sandbox proxy returns 403 on CONNECT to `*.supabase.co`, so no smoke request was possible. Behaviour is covered against the fake server only.

## 2026-10-15, logic agent: catch-up completion replay (QA MSG-1)

`createEmCore` now holds any `PhaseCompleteEvent` emitted before the first `onPhaseComplete` subscription and replays it synchronously to that first subscriber (only the startup catch-up is held; later events are not buffered). No frontend change needed: `initPhaseEffects` already handles the event. The one failing QA unit test was this defect, not a test misreading.

## 2026-10-15 frontend: window.__emCore gated (round 2)
`window.__emCore` is now exposed only when `import.meta.env.DEV`, or when the build was made with `VITE_E2E=1` AND the URL has `?e2e`. QA: set `VITE_E2E=1` on the build/preview command used by the playwright webServer (the deploy.yml e2e step builds without secrets; it needs `VITE_E2E=1` there too if e2e relies on `?e2e`; deploy.yml already sets it on the e2e build only, never on the Pages build).
