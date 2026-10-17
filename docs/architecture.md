# Em Time: Architecture

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Build | Vite + TypeScript (strict) | Fast dev server, first-class TS, simple static output for Pages. |
| UI | Preact + `@preact/signals` | About 8 KB gzipped. Four screens, dialogs and forms are tedious in vanilla DOM; JSX keeps the frontend agent productive. Signals give fine-grained updates so one completed session does not re-render the app. React would triple the bundle for nothing. |
| State | Core store (framework-free, `subscribe`) bridged to signals in `frontend/src/app/coreBridge.ts` | Keeps `core/` testable in plain Node and swappable to another UI. |
| Charts | Hand-drawn SVG components, no library | Four small charts with exact dataviz specs; a library would add 50+ KB and fight the specs. |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`, `registerType: 'prompt'`) + `@vite-pwa/assets-generator` | Manifest, precache and update prompt with little code; icons rasterized from one SVG at build. |
| Font | `@fontsource-variable/inter` | Self-hosted, cached offline, no third-party request. |
| Storage | localStorage, one JSON document | Synchronous, so no loading state and "write before confirm" is trivial. Data is small (about 200 bytes per session; 5 MB covers 20,000+ sessions). The adapter interface allows an IndexedDB swap later. localStorage is always the source of truth for the UI. |
| Sync | Supabase (Postgres + Auth) via `@supabase/supabase-js` v2, lazy-loaded | Optional. Push/pull of rows with RLS and last-write-wins triggers (section 9). Lazy loading keeps the signed-out and unconfigured app inside the bundle budget. |
| Auth | Supabase email OTP: magic link (PKCE) or 6-digit code | No passwords. PKCE keeps the callback in `?code=`, clear of hash routes. The code path is required for iOS home-screen apps (storage isolated from Safari). |
| Sound | Web Audio synthesis | No audio files, works offline, volume control is a gain node. |
| Unit tests | Vitest (Node environment) | Same config language as Vite; fake timers for the engine. |
| E2E | Playwright (Chromium desktop + 390x844 mobile emulation, WebKit mobile as a non-blocking extra) | Screenshots, offline and installability checks via CDP. |
| Lint/format | ESLint (typescript-eslint) + Prettier | Standard, low friction. |
| Node | 22 LTS | Matches CI. |

Pin exact versions in `package-lock.json`; use the current stable release of each package at scaffold time.

Size budget: initial JS under 60 KB gzipped, CSS under 12 KB, font about 50 KB (woff2, latin subset only). The sync chunk (`core/sync/engine.ts` plus supabase-js, roughly 50 KB gzipped) is a separate dynamic-import chunk, precached by the service worker but never parsed unless sync is used.

## 2. Repository layout and ownership

```
em-time/
  .github/workflows/deploy.yml        frontend agent
  package.json, package-lock.json     frontend agent (created by logic agent in step 0, see 6)
  tsconfig.json, .eslintrc.cjs, .prettierrc   frontend agent (created in step 0)
  .env.example                        logic agent (VITE_SUPABASE_URL=, VITE_SUPABASE_ANON_KEY=)
  vitest.config.ts                    QA agent
  playwright.config.ts                QA agent
  frontend/                           frontend agent, except src/core/
    index.html
    vite.config.ts
    pwa-assets.config.ts
    supabase/                         LOGIC AGENT ONLY
      migrations/20261015000000_em_time_sync.sql   contract.md section 10, verbatim
      README.md                       one-time setup steps from section 8
    public/
      icon.svg, favicon.svg, robots.txt
    src/
      main.tsx
      app/          App.tsx, router.ts (hash routes), coreBridge.ts (core -> signals)
      core/         LOGIC AGENT ONLY
        index.ts            public barrel: everything in contract.md section 3
        types.ts            contract.md section 2, verbatim
        constants.ts        contract.md section 7, verbatim
        time/               dayKey.ts, calendar.ts (ISODay math), format.ts
        timer/              reducer.ts (pure), engine.ts (scheduling, events)
        stats/              daily.ts, streaks.ts, trend.ts, heatmap.ts, week.ts, today.ts, milestones.ts
        store/              store.ts, defaults.ts
        storage/            adapter.ts, persist.ts, migrate.ts, validate.ts, exportImport.ts, merge.ts
        copy/               picker.ts (shuffle bags, {sessions} token)
        sync/               env.ts (config detection, main chunk), rows.ts (toRow/fromRow, main chunk),
                            engine.ts (createSyncEngine, the only supabase-js import, lazy chunk)
        core.ts             createEmCore (wires timer + store + copy)
        stub.ts             createStubCore (same API, fixture data, memory storage)
        fixtures/stub-data.json
        **/*.test.ts        logic agent's own unit tests
      data/
        messages.json       encouragement, break prompts, milestones, aboutLine (spec appendices)
      screens/      Timer/, Tasks/, Stats/, Settings/
      components/   Ring, Button, IconButton, Segmented, Switch, Stepper, Select, Sheet, Dialog, Banner, Tooltip, Icon, Toast
      charts/       WeekColumns, TaskBars, Heatmap, TrendChart, GoalRing, StatTile, ChartTable, geometry.ts, useSize.ts
      platform/     audio.ts, notify.ts, wakeLock.ts, title.ts, gradient.ts, shortcuts.ts, pwa.ts, announce.ts
      styles/       tokens.css, base.css, components.css
  tests/                              QA agent
    unit/           independent tests of core and charts/geometry.ts
    e2e/            Playwright specs
    fixtures/       backup files (valid, invalid, future-dated, v0)
    screenshots/    saved by e2e runs
    qa-report.md
  dist/                               build output (gitignored)
```

Rules: no agent edits another agent's folder. Cross-folder requests go in a short `HANDOFF.md` note at the repo root (anyone may append, newest at the bottom). `frontend/` code imports core only through `src/core/index.ts`.

## 3. Runtime design

```
             +-------------------- core (framework-free) --------------------+
 UI events ->| createEmCore                                                  |
             |   timer: TimerEngine (reducer + scheduler)  --phaseComplete--> | -> UI side effects
             |   store: EmStore (AppData, actions, subscribe)                 |    (chime, notify,
             |   copy:  shuffle bags (messages, prompts)                      |     confetti, title)
             |   stats: pure functions over AppData                           |
             |   storage: adapter (localStorage | memory)                     |
             |   sync (lazy): SyncEngine  <--push/pull-->  Supabase           |
             |     reads dirty ids, writes via store.applyRemote             |
             +---------------------------------------------------------------+
                         ^ subscribe                     | selectors
                   coreBridge.ts -> Preact signals -> screens/charts
```

- Write path: UI action -> store mutates -> localStorage write (sync, before UI confirms) -> dirty id recorded -> `onLocalWrite` -> SyncEngine debounced push. The network is never on the write path.
- Read path: UI reads only `AppData` in memory. Pulled rows enter through `store.applyRemote`, which persists and notifies like any other change.

- The timer engine is a pure reducer `(state, action, now) -> { state, effects }` plus a thin scheduler that owns one `setTimeout` and listens to visibility events (contract.md 3.2). Tests drive the reducer with explicit `now` values, and the engine with injected `now`/`setTimeout`.
- On `phaseComplete`, core logs the session (idempotent id), advances the cycle, picks the encouragement or milestone, picks a break prompt, persists, then emits one event the UI uses for chime, notification, confetti and messages. The UI never computes stats or writes storage directly.
- The ring and digits read `timer.remainingMs()` inside a `requestAnimationFrame` loop that runs only while visible and running; they update DOM by ref, not through signals.
- Platform modules (`frontend/src/platform/`) are the only places that touch `Notification`, `AudioContext`, `navigator.wakeLock`, `document.title`, service worker APIs and the keyboard.

## 4. Storage design

- Key `em-time:data` holds one `AppData` JSON document (contract.md 2, example in 5). Separate keys only for corrupt backups (`em-time:corrupt:<epoch>`).
- `schemaVersion: 1`. Load pipeline: `read -> JSON.parse -> migrate -> validate/normalize -> AppData`. `migrate` runs `MIGRATIONS[v]` for each `v` from the stored version up to `SCHEMA_VERSION`; v1 ships with `MIGRATIONS = {}` and a test fixture proving the hook runs (a synthetic v0 shape that maps to v1). Stored versions newer than the app are not migrated: the app runs read-only from memory with a banner "This data is from a newer version of Em Time. Refresh to update." and does not overwrite it.
- Validation drops individual bad records (counted as warnings) instead of rejecting the whole document. Only a non-object root, wrong `app` marker or unparsable JSON counts as corrupt.
- Writes: every store action calls `persist()` synchronously after mutating; `pagehide` flushes again. Write failures set `storageStatus` to `quota` or `unavailable`; the UI shows the banner and keeps working in memory.
- Multi-tab: a `storage` event on `em-time:data` reloads `AppData` and hands the stored `timer` to `engine.adopt()`. Session ids are `sessionId(deviceId, phaseStartedAt)`, so duplicate completions collapse locally and remotely.
- Every entity has a client UUID, `createdAt`, `updatedAt` and soft-delete `deletedAt`; sessions are append-only. `applyRemoteRow()` is the single last-write-wins rule, shared by Import Merge, sync pull, and mirrored by the Postgres trigger. Supabase auth tokens live under their own key (`em-time:auth`), never inside `AppData`, so exports never contain credentials.

## 5. Build, base path, PWA

- `frontend/vite.config.ts`: `root` = `frontend/`, `base` = `process.env.BASE_PATH ?? '/em-time/'`, `build.outDir` = `../dist`, `emptyOutDir: true`.
- Env: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.local` locally and repository secrets in CI. Missing or empty values build a local-only app (spec SYNC-1); nothing fails at build time.
- Nothing hard-codes `/`. Assets are imported or referenced relatively; runtime URLs use `import.meta.env.BASE_URL`. Routing is hash-based, so deep links never 404 on Pages.
- `vite-plugin-pwa`: `registerType: 'prompt'`, `injectRegister: false` (registered in `platform/pwa.ts` via `virtual:pwa-register`), manifest per design.md section 11, Workbox `globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']`, `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`.
- `npm run icons` runs `pwa-assets-generator` with `pwa-assets.config.ts` (preset minimal-2023, background `#F4F9FE`); `prebuild` calls it, output to `frontend/public/` (generated files are gitignored).

### Scripts (root `package.json`)

| Script | Command |
|---|---|
| `dev` | `vite --config frontend/vite.config.ts` |
| `build` | `npm run icons && tsc --noEmit && vite build --config frontend/vite.config.ts` |
| `preview` | `vite preview --config frontend/vite.config.ts --port 4173` |
| `icons` | `pwa-assets-generator --config frontend/pwa-assets.config.ts` |
| `typecheck` | `tsc --noEmit` |
| `lint` | `eslint .` |
| `test:unit` | `vitest run` |
| `test:e2e` | `playwright test` |
| `test` | `npm run test:unit && npm run test:e2e` |

## 6. GitHub Actions (`.github/workflows/deploy.yml`)

Repository setting: Pages source = GitHub Actions. Use the current major versions of the official actions.

```yaml
name: Build and deploy
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      BASE_PATH: /${{ github.event.repository.name }}/
      VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
      VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: screenshots
          path: tests/screenshots
      - uses: actions/upload-pages-artifact@v3
        if: github.event_name != 'pull_request'
        with:
          path: dist
  deploy:
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

A failing unit or e2e test blocks deploy. WebKit runs locally only (not in CI) to keep CI under about 4 minutes. Unset secrets resolve to empty strings, which produce a local-only build. The real-project sync e2e test is skipped in CI unless Dathan also adds a `SUPABASE_SERVICE_ROLE_KEY` secret and passes it to the `npm run test:e2e` step only (never to `npm run build`); recommended: point it at a separate test project, not the production one.

## 7. Agent work split and order

Recommended models: logic, frontend and QA agents run on Sonnet; an Opus reviewer checks each gate below against `spec.md` and `contract.md` before the next phase starts.

| Agent | Owns | Never touches |
|---|---|---|
| Logic | `frontend/src/core/` (code including `sync/`, own tests, fixtures, stub), `frontend/supabase/` (migration, setup README), `.env.example` | UI, styles, `tests/` |
| Frontend | everything else under `frontend/` (including the Settings Sync card UI), root config except QA's two files and `.env.example`, `.github/` | `frontend/src/core/`, `frontend/supabase/`, `tests/` |
| QA | `tests/`, `vitest.config.ts`, `playwright.config.ts` | product code (reports bugs instead) |

Order:
1. **Step 0, logic (blocking, small):** create root scaffold (package.json with all dependencies and scripts from section 5, tsconfig, eslint, prettier, empty `frontend/` Vite shell), then `core/types.ts`, `core/constants.ts`, `core/index.ts` with every exported signature, and `createStubCore()` backed by `fixtures/stub-data.json` (about 70 days of realistic sessions over 6 tasks and 5 categories, including a midnight crossover, a 05:30 start that belongs to the previous day, a 9-day streak, an empty week). **Gate A:** typecheck passes, stub returns data for every selector.
2. **Step 1, in parallel:**
   - Logic implements the real core behind the same API, with its own tests; local core first, then `sync/` (rows, env, engine against a mocked `SupabaseLike`) and the SQL migration.
   - Frontend builds all screens, charts and platform modules against `createStubCore()`.
   - QA writes unit tests against the contract and e2e specs against the spec's ACs (they may fail until code lands), plus fixtures.
3. **Gate B:** logic core passes its own tests and QA's unit suite. Frontend switches `main.tsx` to `createEmCore()` (stub remains available in dev only via `?stub`).
4. **Step 2:** QA runs everything, saves screenshots, writes `tests/qa-report.md` with owner per failure. Owners fix; QA re-runs.
5. **Gate C (Opus review):** all ACs pass or have an accepted waiver, Lighthouse-equivalent checks pass, bundle within budget, a local-only build (no env) passes the full suite. Then merge to `main` and deploy.

Sync does not block the local app: if sync slips, Gate C can pass with SYNC criteria waived and the build shipped local-only (simply leave the secrets unset).

## 8. Supabase setup (Dathan, one time, outside the build)

The app never assumes this exists. Steps, also written to `frontend/supabase/README.md`:

**Status (2026-10-14): steps 1 and 2 are DONE via the Supabase connector.** Project `em-time` (ref `svbpsgllxlcjgkrlagrp`, region us-west-1, org "Pumo's Castle") exists and the migration has been applied as three migrations (`em_time_sync_tables`, `em_time_sync_lww_rls`, `em_time_sync_grants`); RLS, triggers and grants were verified. Values for the build (public by design, safe to commit in `.env.example`):

```
VITE_SUPABASE_URL=https://svbpsgllxlcjgkrlagrp.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_EPA5ZWLe-Im30BnKl_E2kA_MNrUM8qr
```

The frontend agent must create `frontend/.env.example` with these values and the logic agent must still ship the migration file under `frontend/supabase/migrations/` so the schema is reproducible. Steps 3 to 7 need the Supabase dashboard and GitHub settings; Dathan does them.

1. ~~Create a Supabase project~~ Done.
2. ~~Run the migration~~ Done.
3. Authentication, Providers: Email enabled; "Confirm email" on; password sign-in not used.
4. Authentication, URL configuration: Site URL `https://dathanbn.github.io/em-time/`; Redirect URLs add `https://dathanbn.github.io/em-time/` and `http://localhost:5173/em-time/`, `http://localhost:4173/em-time/`.
5. Authentication, Email templates, Magic Link: keep the link and add the code line, e.g. "Or type this code in Em Time: {{ .Token }}". Required for the iPhone home-screen app.
6. Optional: custom SMTP. The built-in sender is rate limited (a few emails per hour), fine for one user.
7. GitHub repository, Settings, Secrets and variables, Actions: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon or publishable key; never the service role key). Re-run the workflow.
8. Locally: copy `.env.example` to `.env.local` and fill the same two values.

## 9. Sync design

- **Local-first.** localStorage is the source of truth for the UI. Sync is a background reconciler: it reads dirty ids from `meta.sync.dirty`, upserts them, pulls rows changed since a per-table cursor, and applies them with `store.applyRemote`. Contract.md 3.7 is normative.
- **Loading.** `core/sync/env.ts` (main chunk) decides `isSyncConfigured()`. If not configured: no Sync card, no chunk download, no requests. If configured, `core.loadSync()` dynamic-imports `core/sync/engine.ts` (and supabase-js) when the Sync card's sign-in is opened or when `hasStoredAuth()` finds a session at startup.
- **Identity.** Rows are keyed by `(user_id, id)`. All ids are client-generated: random UUIDs for tasks and custom categories, fixed UUIDs for the five default categories, deterministic UUID-shaped session ids from device id plus start time. Offline writes therefore merge without coordination.
- **Conflicts.** Last-write-wins by client `updatedAt` (epoch ms), tombstone wins ties, enforced twice: in `applyRemoteRow` on the client and in the `em_lww_guard` trigger on the server, so an older device can never overwrite a newer row even if it pushes later. The trigger also clamps timestamps more than 10 minutes in the future.
- **Cursors.** `server_updated_at` is set by the trigger with `clock_timestamp()`; pulls re-read a 60 s overlap so a row committed slightly out of order is not missed. Re-applying a row already held is a no-op.
- **First sign-in / two devices.** Sign-in marks every local row dirty and resets cursors when the account is new to this device, then pushes all and pulls all. Union by id; nothing is discarded (spec EDGE-11).
- **What syncs.** Categories, tasks, sessions, and the synced subset of settings (one `jsonb` row). Timer state, current task, theme, sound, notifications, keep-awake, milestone history and message bags are device-only.
- **Security.** RLS restricts every table to `auth.uid() = user_id`; anon has no grants; no DELETE grant or policy exists. The anon key in the client is public by design.
- **Volume.** About 3,000 sessions per year; first sync of a year of history is 6 upsert requests and 3 pull pages per device.
