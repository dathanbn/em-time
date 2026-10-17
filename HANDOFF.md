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

## 2026-10-15, logic agent: Core v2 ready (Sky diary settings)

Done inside `frontend/src/core/` only: `ThemeId = 'sky' | 'light' | 'dark'` (default `sky`), `displayName` (synced, default `Em`, 0..24 code points), `mascot` and `stickers` (device-only, default true); `SCHEMA_VERSION = 2` with `MIGRATIONS[1]` (light to sky, dark kept, new keys added, `settings.updatedAt` untouched); `validateSettings`, `store.updateSettings` (`ValidationError('displayName', 'too-long')`, theme `required`, booleans), `toRow`/`fromRow`/`applyRemote` for `displayName`. New tests: `core/settings.v2.test.ts` (30 cases).

Deviations and notes:

- `types.ts` and `constants.ts` follow contract V2 and are therefore no longer byte-identical to contract sections 2 and 7 (they stay in `.prettierignore`).
- Pulled `displayName` rule (V2.4 says "passes the V2.3 rules"): I read this as strict. After sanitizing (trim, control chars removed) a pulled name is applied only if it is a string of at most 24 code points; a longer string is ignored (local name kept), NOT cut. Local load/import still cuts to 24. The other keys of the same row still apply.
- `''` is a valid `displayName` locally and from a pulled row.
- `displayName` is checked for being a string in `updateSettings` (non-string throws `ValidationError('displayName', 'required')`).
- **Frontend must fix (not mine):** `typecheck` fails in `frontend/src/app/App.tsx:73` and `frontend/src/main.tsx:40` because they pass `ThemeId` to a `'light' | 'dark'` parameter.
- **QA must update (not mine), 6 unit tests assume v1:** `tests/unit/import.test.ts` (backup-valid expects no `migrated` warning, backup-v0 expects schemaVersion 1), `tests/unit/storage.test.ts` (first-run default theme `light`; backup-bad-records expects status `ok` but a v1 fixture now loads as `migrated`), `tests/unit/store.test.ts` (default theme `light`), `tests/unit/sync.test.ts` SYNC-13 (device-only theme expected `light`, now `sky`). The v1 fixtures can stay as migration cases.
- My own `core/sync/sync.test.ts` expected push payload now includes `displayName: 'Em'`.

## 2026-10-15, frontend agent: Sky diary (v2) UI built

Built: `platform/sky.ts` (gradient.ts deleted), `platform/stickers.ts`, `app/greeting.ts`, `components/{Scene,Mascot,Companion,EmptyMascot}.tsx`, `styles/scene.css`, restyled tokens/base/components/screens, Settings (You card, 3-way Theme, Cloud friend, Sky stickers), Nunito (Inter removed), new icon + rasters, `check-size.mjs` now also gates CSS at 16 KB. Core lacked nothing.

Notes for QA:
- Extra CSS vars beyond contract V2.8: `--sky-sun-display`, `--sky-moon-display` (display none outside the arc windows), `--sky-star-vis`, `--sky-ink-shadow`. `sky.ts` also exports `nearestPhase`, `refreshSky`, `currentSky`, `backHillHeight`; `startSky(getMode, onApply?)`.
- Empty-state mascots and the nav glyph use `data-testid` `mascot-empty` and `mascot-glyph`, so `mascot` is unique per page. Burst stickers carry `data-testid="sticker"` inside `[data-testid="sticker-burst"]`; drifting ones live in `[data-testid="sticker-layer"]`.
- Timer bubble is `[data-testid="timer-bubble"]`; the desktop nav is not sticky (brand sits on the sky, so it scrolls away).
- Phone Theme control is a radio list (labels carry `settings-theme-*` testids), segmented at 900+.
- Stats/Settings: the export reminder now sits below the page title so the title stays in the header band.
- Timer digits cap at 25% of the bubble width (design table says up to 124px; 124px does not fit the ring).

## Frontend fix round (v2)
Done: 1 dialogs portal to body (manual render, focus trap + Escape kept), 2 phone moon apex = horizon-56 (skims the strip above the hills, clear of the bubble), "Always dark" pins 02:30 (was 23:00), glow opacity 0.55, 3 focus halo kept on btn--primary/secondary/danger, iconbtn--ghost, selected seg, playbtn, 4 burst starts at the rim and lands rim+10..80px (clamped to viewport), 5 makeup 0.5 in midday/afternoon/dusk/evening (design.md 4.2 table updated), 6 phone nav glass 0.92 (--em-nav-glass), pill/label spacing, 8 Goal label moves under the line or hides near today's marker, 9 Stats empty mascot beside the week-chart caption, 10 phone stars: stroke on dots, sparkles x2.4.
Skipped: 7 (ease-out blend breaks the QA sky sweeps and 16:47 contrast). 11 done later with coordinator approval: pools deduped (medicine loses 🧠 🧪 ✏️, night keeps 🚑), study gains 🔬 ⚗️ 🧫 📝; design.md 4.2 pools line updated. QA: stickers.test pool expectations need the same change.
QA tests to update: sky.test "dark pins 23:00" is now 02:30; stickers.test DESIGN_WEIGHTS makeup 0.5 for midday/afternoon/dusk/evening.

## Timer simplification (frontend)
Phone Timer: no stats at all; greeting + mascot on top, ring/task/dots/controls centred, mode switch (Focus / Short break / Long break) at the bottom above the tab bar (after the controls in DOM order). Desktop: only the streak chip is gone; Today and Up next cards stay.
Removed test ids: `greeting-sub` (both widths). `today-goal` and `today-ring` now exist only in the desktop side card (the phone strip instance is gone, so they are absent at < 900px). Removed classes: `.todaystrip*`, `.timerpage__strip`, `.chip--sub`. New wrapper `.timerpage__mid` (display: contents on desktop). `mode-*`, `timer-*`, `message-line`, `break-prompt`, `greeting` unchanged. No live-region text referenced stats.

## 2026-10-16, logic agent: v3 sync code sign-in (replaces magic link and OTP)

New API surface for the frontend (all exported from `@core` unless noted):

- `normalizeSyncCode(raw: string): { ok: true; code: string } | { ok: false; error: SyncCodeError }`. Trim, lowercase, whitespace runs to `-`; allowed `a-z 0-9 - _ .`; at least 8 characters.
- `SyncCodeError = 'code_empty' | 'code_too_short' | 'code_too_long' | 'code_invalid_chars'`. `code_too_long` (over 64 characters, the email local-part limit) and `code_invalid_chars` are additions; the coordinator spec only named `code_too_short` and empty.
- `deriveSyncCredentials(raw): Promise<{ ok: true; credentials: { email; password } } | { ok: false; error: SyncCodeError }>`. Email `${slug}@dathanbn.github.io` (`.` becomes `-`), password hex SHA-256 of `em-time:v1:` + code. Web Crypto first, pure-JS fallback.
- `SYNC_CODE_MIN = 8`, `SYNC_CODE_MAX = 64`.
- `SyncEngine.signInWithCode(code: string): Promise<SignInWithCodeResult>` where `SignInWithCodeResult = { ok: true } | { ok: false; error: SignInWithCodeError; message?: string }` and `SignInWithCodeError = SyncCodeError | 'confirm_email_on' | 'rate_limited' | 'network' | 'unknown'`. `confirm_email_on` carries `message` (also exported as `CONFIRM_EMAIL_ON_MESSAGE` from `core/sync/engine`). Validation errors return before any request.
- Removed: `SyncEngine.requestCode`, `SyncEngine.verifyCode`, `?code=` / PKCE return handling (client now `detectSessionInUrl: false`, no `flowType`), and the `-code-verifier` branch of `hasStoredAuth()` (now only: a stored session exists). `SupabaseLike.auth` lost `signInWithOtp`/`verifyOtp` and gained `signInWithPassword` and `signUp`.
- Unchanged: first-sign-in merge (mark all dirty, reset cursors, push, pull), `signOut()` at local scope, every other sync behavior.

Notes and deviations:

- `meta.sync.email` is now always `null` for code accounts (the address contains the code, so it must not be written to AppData or backups). `SyncState.email` is therefore `null`; UI should show "Signed in with a sync code", not an address. `SyncStatus` `'code-sent'` is still in the type but the engine never emits it; the UI step flow is now: one code field, one button.
- An existing account whose Confirm email setting is on also yields `confirm_email_on` (Supabase says "Email not confirmed").
- `fakeSupabase.ts`: `validCode` removed; `FakeServer` gained `passwords`, `confirmEmail`, `confirmed`. Op kinds `signInWithPassword` / `signUp`.
- Needs other agents: frontend, `screens/SyncCard.tsx` still calls `requestCode`/`verifyCode` (typecheck fails there only). QA, `tests/unit/syncHarness.ts` still mocks `signInWithOtp`/`verifyOtp` and calls `requestCode`/`verifyCode`; 24 QA unit tests in `tests/unit/sync.test.ts` and `migration.v2.test.ts` fail until the harness uses `signInWithCode` (a mock needs `signInWithPassword` and `signUp`).
- Supabase dashboard: Authentication, Sign In / Providers, Email: Enable Sign in / up ON, Confirm email OFF (see `frontend/supabase/README.md`). Not verified against the live project (proxy blocks it).
- Tests: `core/sync/syncCode.test.ts` (normalization, deterministic and case-insensitive derivation, SHA fallback equals Web Crypto, sign-in, sign-up, `confirm_email_on`, too-short, same code on two devices, signOut scope); `sync.test.ts` and `env.test.ts` updated.

## 2026-10-16 frontend: Doodle Cloud, phone Timer layout, sync code card
- Mascot: `components/Mascot.tsx` is now Doodle Cloud (viewBox 160x140, width = old size, so height is 0.875 x width; was 0.75). States: idle (little wave), focusing (book), break (coffee), celebrate (arms up + confetti), wave (hugging a heart), plus new `shrug` (empty states, "???", `mascot-empty` uses it) and `thumbs` (goal met; implemented, not wired to the state machine). Night: `data-accessory="headlamp"`, `.m-eyes--wide`, star companion on break/celebrate. Same test ids, `data-state` and `data-accessory` names, `.m-eyes--*`/`.m-lamp` classes, no `<text>`. Outline tokens: `--mascot-line` near-black by day, ice blue (#9fd8ff) in dark. Icons regenerated (`npm run icons`); `icon.svg` and `favicon.svg` are the idle doodle on the sky.
- Phone Timer: greeting row (extra 6px top padding), frosted mode pill (`.modes`, 340px max, options 44px) under it, ring/task/dots/controls, message and break card hang in a reserved band above the tab bar. Desktop keeps its structure and gets the same pill style.
- SyncCard: one "Sync code" field + "Link this device" (`sync-code-input`, `sync-send`); signed in shows "Linked", status line, Sync now, Sign out (`sync-status`, `sync-now`, `sync-signout`). Removed test ids: `sync-email-input`, `sync-verify`. Validation runs locally with `normalizeSyncCode`; `confirm_email_on` shows the Supabase hint. QA: `tests/unit/syncHarness.ts` still fails typecheck (`signInWithOtp`, `requestCode`, `verifyCode`), so `npm run build` (which runs `tsc`) fails until it is updated; `vite build` alone passes (JS 58.7 KB / 60).
- Follow-up: `thumbs` is wired (`app/mascotState.ts`: `noteGoalProgress` after each focus session, `thumbing` for 3 s, queued while a focus session runs or celebrate plays; only the Timer mascot, never the idle-only page mascots). Phone break idea is clamped to one line (ellipsis, full text in `title`); reserved band padding is 140px.

## 2026-10-17, builder: Focus sounds (v4)

Built to `docs/noise-spec.md` (unchanged). 9 sounds (white, pink, brown synthesized; rain, waves, stream, cafe, fireplace, night recorded), device-only settings, lazy engine, Timer chip and picker sheet, Settings card, `N` shortcut, service worker cache for the recordings. No schema bump.

**Settings (core, device-only like `mascot`/`stickers`).** `noiseOn: boolean` (false), `noise: NoiseId` ('rain'), `noiseVolume: number` 0..1 (0.5). New exports: `NoiseId` (types.ts), `NOISE_IDS`, `DEFAULT_NOISE`, `DEFAULT_NOISE_VOLUME`, `LIMITS.noiseVolume` (constants.ts). `validateSettings` fills missing keys, replaces an unknown id, clamps the volume. `updateSettings` throws `ValidationError('noise', 'required')`, `('noiseVolume', 'limit')`, `('noiseOn', 'required')`. Not in `SYNCED_SETTINGS_KEYS`, so `toRow`/`fromRow`/`applyRemote` already ignore them (tested: a pulled row carrying them changes nothing); an edit does not bump `settings.updatedAt`, mark settings dirty or notify `onLocalWrite('settings')`. Export and import carry them like the other device-only keys. `types.ts` and `constants.ts` gain the keys (they stay in `.prettierignore`).

**Frontend API.**
- `platform/audio.ts`: `getAudioCtx()` (the old private `getCtx`, shared by chimes and sounds; `playChime` untouched).
- `platform/noiseSynth.ts` (pure, no Web Audio): `synthChannel(color, length, fadeLen, rand?)`, `rms`, `SYNTH_RMS`, `SYNTH_SECONDS`, `SYNTH_FADE_SECONDS`.
- `platform/noise.ts` (lazy chunk): `setNoiseDesired({ play, id, volume })` (idempotent), `previewNoise(id, volume)`, `retryNoise()`, `subscribeNoiseState(cb)`, `getNoiseState()`, `makeSynthBuffer(ctx, color)`, `noiseGain(v)` (v squared x 1.2). State is `{ status: 'idle' | 'loading' | 'playing' | 'error', id, error?: 'network' | 'decode' | 'unsupported' }`. `playing` means audible: it needs the context to be `running`.
- `app/noise.ts` (main chunk, tiny): `initNoise()` (called in `main.tsx` after `initPhaseEffects`; one `effect` that calls `setNoiseDesired` with `play = noiseOn && phase === 'focus' && status === 'running'`, and imports the engine only when `play` is true or the engine is already loaded), `loadNoise()`, `loadNoiseUi()`, signals `noiseState` and `noiseUi`.
- `app/noiseInfo.ts`: `noiseInfo(id)` returns `[label, emoji]` (parallel to `NOISE_IDS`, so ids live in core only).
- `components/NoisePanel.tsx` (lazy chunk): `NoisePicker({ onClose })` and `NoiseSettings()`. Both use `Dialog`/`Switch`/`Card`; tiles are a roving-tabindex radiogroup (arrows move and select, Home/End).
- `app/actions.ts`: `toggleNoise()` (unlocks audio, flips `noiseOn`, announces). `platform/shortcuts.ts`: `ShortcutHandlers.noise()`, key `n`/`N`. `SHORTCUTS` (Settings and the `?` sheet) gained `['N', 'Turn focus sounds on or off']`, placed after R.
- `components/Icon.tsx`: new `volume-off` icon.

**Engine behaviour.** Graph source(loop) -> mix -> master -> destination. Gain `noiseVolume^2 x 1.2`; volume changes ramp 80 ms; fade in 1.5 s, out 1.0 s, crossfade 0.6 s; every ramp starts with `cancelScheduledValues` + a hold of the current value; sources are stopped and disconnected 100 ms after the fade-out, `navigator.audioSession.type` is 'playback' while audible and 'auto' after. A quick off/on reuses the source and cancels the teardown. Synth: 10 s stereo, independent L/R, last 0.5 s equal-power crossfaded into the start, DC removed, normalized to RMS 0.022/0.037/0.043 (measured -27/-26/-26 LUFS with ffmpeg ebur128; reviewer recalibrated from the spec guess 0.035/0.05/0.07, which measured -23/-23.4/-21.7 LUFS). Recorded: fetch + decode (promise form with callback fallback), buffers cached, concurrent loads shared, `loopEnd = min(loop seconds, buffer.duration)`. Errors never throw into the UI. A context that is suspended after a reload mid-focus resumes on the first `pointerdown`/`keydown` (capture) and the chip stays `idle` until it runs. A failed load retries on `online`, on `retryNoise()` (the picker calls it when you pick the same tile again), and whenever the controller turns `play` off and on. Preview is ignored while a focus session owns the sound; a slider move in the picker or Settings previews the selected sound.

**UI.** Chip `data-testid="noise-chip"` in `.thead` (`data-state` off|idle|loading|playing|error; aria-label "Focus sounds: Rain, on" / "Focus sounds: off"; `aria-haspopup="dialog"`; 3-bar CSS equalizer only while playing, still under reduced motion). Phone: the header is a 2-column grid, greeting and cloud on row one, chip right-aligned on row two. Desktop: `.thead` is a row (greeting left, chip right). Picker `noise-picker` with `noise-toggle`, `noise-option-<id>`, `noise-error`, `noise-volume`. Settings: a separate "Focus sounds" card right after the Sound card (the Sound card would have become too long): `settings-noise` (card), `settings-noise-toggle`, `settings-noise-<id>` (on the radio input), `settings-noise-volume`, `noise-credits`. Picking a sound anywhere (tile or Settings radio) turns sounds on; the Settings Preview buttons play without selecting. The Settings slider's accessible name is "Focus sounds volume" (visible label "Volume") so the page keeps one slider named exactly "Volume".

**Service worker.** `vite.config.ts` `runtimeCaching`: path contains `/sounds/` and ends `.m4a` -> CacheFirst, `em-time-sounds`, statuses [0, 200], max 12 entries. The `.m4a` files are not in the precache (glob does not include them). The two new lazy chunks (`noise-*.js`, `NoisePanel-*.js`) are precached like any other chunk. `frontend/public/sounds/CREDITS.md` written.

**Test hook.** `window.__emNoise` (same gating as `__emCore`: DEV, or a `VITE_E2E=1` build with `?e2e`; it lives in the lazy chunk, so it costs the main bundle nothing and exists only after the engine loaded): `state()`, `level()` (RMS of the master output through an AnalyserNode; the analyser downmixes to mono, so independent-channel synth noise reads about 3 dB under its per-channel RMS), `masterGain()`, `renderRms(color)` (OfflineAudioContext), `decode(id)`.

**Files.** New: `platform/noise.ts`, `platform/noiseSynth.ts`, `platform/noise.test.ts`, `app/noise.ts`, `app/noiseInfo.ts`, `components/NoisePanel.tsx`, `core/settings.v4.test.ts`, `tests/e2e/noise.spec.ts`, `tests/screenshots/noise-*.png`, `frontend/public/sounds/CREDITS.md`. Changed: `core/{types,constants}.ts`, `core/store/{defaults,store}.ts`, `core/storage/validate.ts`, `platform/{audio,shortcuts}.ts`, `app/actions.ts`, `main.tsx`, `screens/{Timer,Settings}.tsx`, `components/Icon.tsx`, `styles/screens.css`, `frontend/vite.config.ts`.

**Tests.** Unit 658 -> 700 (23 in `core/settings.v4.test.ts`; 19 in `platform/noise.test.ts`: synth RMS within 1.5 dB, DC, color, L/R independence, loop continuity, equal power; engine state machine on a fake context: ramps, idempotency, crossfade, teardown, quick toggle, load/dedupe/cache, errors and retry, preview rules). New `tests/e2e/noise.spec.ts` (27 tests per project; N is desktop only): chip and picker, persistence, keyboard, N, axe (light/dark, contrast included, picker and Settings card), playback proven with the analyser (signal while playing, ~0 after Pause, Skip, Reset, break and phase end, live sound and volume change, reload mid-focus waits for a tap), error and recovery, preview, Settings mirror, file serving, decode, offline cache through the real service worker, synth loudness through an OfflineAudioContext.

Existing tests changed (minimal):
- `settings.spec.ts` SND-1/SND-2: `getByRole('slider', { name: 'Volume' })` is a substring match and now sees two sliders, so both uses are `exact: true`.
- `settings.spec.ts` "about": the shortcut list has 8 rows, `Space, S, R, N, 1, 2, 3, ?` (was 7).
- `mascot.spec.ts` MASCOT-4: the Timer `<header>` has a third child, the chip (3 with the cloud, 2 without; was 2 and 1). The assertion about the greeting getting the full width is unchanged and passes.

**Deviations from the spec.**
1. Credits in Settings are plain text (the freesound ids appear as `freesound.org/s/...`), not links: the A11Y-5 phone test requires every `a[href]` to be 44x44, and inline links in small print cannot be. `CREDITS.md` has the full URLs.
2. The Sound-card option was not used; Focus sounds is its own card after Sound (spec allows it).
3. Phone chip is on its own right-aligned row under the greeting/cloud row, because 358 px cannot hold greeting, cloud and chip on one row without wrapping the greeting.
4. The `getAudioCtx` listener for `statechange` and the "suspended until a gesture" handling live in the lazy engine (the spec put the gesture listener in the controller); this keeps the main chunk smaller and behaves the same.
5. The Playwright Chromium builds in this sandbox (headless shell and full) cannot decode AAC (`decodeAudioData` rejects `cafe.m4a`, `canPlayType` is empty). The e2e spec detects that and answers the `.m4a` request with a generated WAV so fetch, decode, loop, cache and chip states still run; with a browser that has AAC it uses the real files and also asserts each file's real decoded length. I separately verified the real content: the six files were transcoded with ffmpeg and served at the `.m4a` URLs, and all six played through the engine with decoded durations of 40.008, 40.008, 40.008, 14.512, 23.011 and 45.000 s (>= their loop lengths, so `loopEnd` is the loop length). Real AAC decoding itself was not run in a browser here; Chrome, Edge, Safari and Firefox decode AAC/MP4 natively.

**Notes.** The recordings measure -26 LUFS as stated; their plain RMS is -28 to -32 dBFS, while the synth targets in the spec are -29 (white), -26 (pink) and -23 dBFS (brown), so brown sits several dB above the recordings in RMS terms (bass counts less in LUFS). Left as specified. `docs/architecture.md` still says Sound is "Web Audio synthesis, no audio files": chimes are, focus sounds now also load recordings. Preview/selection plays real audio even in the e2e runs (Chromium renders to a null sink).

**Bundle (gzip, `VITE_E2E=1 npm run build`).** Main JS 60,411 -> 61,312 bytes (+901 B, +0.88 KB; budget 61,440, 128 B left). New lazy chunks: `noise-*.js` 2,495 B, `NoisePanel-*.js` 1,660 B. CSS 10,977 -> 11,421 B (+444 B; budget 16 KB). Budget numbers unchanged.
