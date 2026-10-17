# Em Time: Agent Work Orders

Read first, all agents: `spec.md` (what and acceptance criteria), `contract.md` (binding interfaces), `architecture.md` (layout, order, gates). Frontend also reads `design.md` in full. No em-dashes in any user-facing copy. No emojis. Copy from spec appendices is used verbatim. Never edit another agent's folder; write requests to `HANDOFF.md` at the repo root.

Order recap: Logic step 0 (Gate A) -> Logic, Frontend, QA in parallel -> Gate B (real core swapped in) -> QA full run and fix loop -> Gate C (Opus review) -> deploy.

---

## 1. Logic agent

**Goal:** a framework-free, fully tested `core/` that owns all time math, timer behavior, data, stats and persistence, so the UI only renders and triggers side effects.

**Owns:** `frontend/src/core/` only. Creates the root scaffold in step 0, then hands root files to the frontend agent.

**Build in this order:**
1. **Step 0 (blocking, do first and fast):**
   - Root scaffold: `package.json` (all dependencies and scripts in architecture.md section 5), `tsconfig.json` (strict, `jsx: react-jsx`, `jsxImportSource: preact`), ESLint, Prettier, `.gitignore` (`dist`, `node_modules`, generated icons; `tests/screenshots/` stays tracked), minimal `frontend/index.html` and `frontend/vite.config.ts` per architecture.md section 5 so `npm run dev` serves a blank page.
   - `core/types.ts` and `core/constants.ts` copied verbatim from contract.md sections 2 and 7.
   - `core/index.ts` exporting every symbol in contract.md section 1 (real or `throw new Error('not implemented')`).
   - `core/fixtures/stub-data.json`: a valid `AppData` with about 70 days ending on the day the stub is created (dates computed relative to `now` by `stub.ts`, so the fixture stores day offsets, not absolute dates): 5 default categories, 6 tasks (one done, one deleted), 1 to 7 sessions on most days, several empty days, one full empty week, a 9-day current streak, one 23:45 start crossing midnight, one 05:30 start (belongs to the previous day). Session ids via `sessionId()`, default categories with their fixed ids.
   - `.env.example` with empty `VITE_SUPABASE_URL=` and `VITE_SUPABASE_ANON_KEY=`.
   - `core/stub.ts`: `createStubCore()` with the full `EmCore` API on a memory adapter. Timer works for real; stats come from fixture data.
   - **Gate A:** `npm run typecheck` passes; every `select.*` returns data from the stub.
2. `time/`: `dayKey`, calendar math via `Date.UTC`, formatters. Test DST days (2026-03-08, 2026-11-01 in America/Los_Angeles) and the 06:00 rollover (05:59 vs 06:00).
3. `timer/reducer.ts` then `timer/engine.ts` per contract.md 3.2 rules. Injected `now` and `setTimeout`. One scheduled timeout at a time.
4. `storage/`: adapters, `loadData` / `saveData`, `migrate` with a v0 fixture proving the hook, `validate` (per-record drop), `exportData`, `parseImport`, `mergeData`.
5. `store/`: defaults (seed categories TSK-1) and all `EmStore` actions with validation and synchronous persist.
6. `stats/`: `statsSessions`, `dailyStats`, `todaySummary`, `streakInfo`, `trendSeries`, `heatLevel`, `heatmapCells`, `weekSummary`, `milestonesReached`.
7. `copy/picker.ts`: shuffle bags, `{sessions}` eligibility and rendering.
8. `core.ts`: `createEmCore` wiring timer end -> session log (idempotent id) -> milestones -> message and prompt -> persist -> `onPhaseComplete`. Storage-event multi-tab reload with `timer.adopt`. Store dirty tracking and `onLocalWrite`.
9. Colocated tests (`*.test.ts`) for every module, coverage of `core/` at least 90% lines.
10. **Gate B:** QA's `tests/unit` suite (local parts) passes against the real core. Post a `HANDOFF.md` note: "Core ready, swap stub".
11. **Sync** (`core/sync/`), after Gate B so the local app is never blocked:
    - `env.ts` (`readSyncEnv`, `isSyncConfigured`, `hasStoredAuth`) and `rows.ts` (`toRow`, `fromRow`, validation shared with import) in the main chunk.
    - `engine.ts`: `createSyncEngine` per contract.md 3.7 (triggers, debounce, single-flight, push chunks, row-by-row retry on constraint errors, paged pull with overlap, LWW apply, backoff, auth-expired, sign-in full push, sign-out, `eraseCloud`). The only file importing `@supabase/supabase-js`; reachable only via `core.loadSync()` dynamic import. Accept an injected `createClient` so tests pass a mock `SupabaseLike`.
    - `frontend/supabase/migrations/20261015000000_em_time_sync.sql` copied verbatim from contract.md section 10, and `frontend/supabase/README.md` with architecture.md section 8 steps.
    - Own tests with an in-memory fake Supabase that implements the LWW trigger rule, covering two simulated devices.
    - Verify the build without env vars contains no request to a Supabase host and no supabase-js code in the main chunk. Post `HANDOFF.md`: "Sync ready".

**Responsible acceptance criteria (logic side):** TMR-1, TMR-3 to TMR-11 (state and logging), TMR-12 (discard rule), TMR-15, TSK-1 to TSK-8 (store rules), WK-1 to WK-4 (data), HM-1, HM-2, TR-2, TR-3 (data), STK-1 to STK-3, GOAL-1, GOAL-2 (data), MIL-1, MIL-3, MIL-4, BRK-2, MSG-2, MSG-3, DAT-1, DAT-3 (parse/merge), DAT-4 (due rule), DAT-5, DAT-6, EDGE-1 to EDGE-7, EDGE-9, SYNC-1 (no requests), SYNC-4 to SYNC-11, SYNC-13 to SYNC-15, EDGE-11 to EDGE-15.

**Done means:** all contract signatures implemented exactly; own tests and QA unit tests green; no DOM, Preact or browser globals in `core/` except inside `createLocalStorageAdapter`, the default `TimerDeps` and `SyncDeps` (guarded); supabase-js only in the lazy chunk; migration file byte-identical to contract.md section 10; typecheck and lint clean.

---

## 2. Frontend agent

**Goal:** the complete app UI, charts, platform integrations and PWA, matching `design.md`, consuming only `core/index.ts`.

**Owns:** everything under `frontend/` except `frontend/src/core/`; root config files after step 0 (except `vitest.config.ts`, `playwright.config.ts`); `.github/workflows/deploy.yml`.

**Build in this order (start after Gate A, against `createStubCore()`):**
1. `styles/tokens.css` with every name in contract.md section 8 and values from design.md section 2 to 5; `base.css` (reset, body gradient, focus ring, reduced motion); Inter via `@fontsource-variable/inter` (latin subset).
2. `data/messages.json` with spec appendices A, B, C verbatim plus `aboutLine`.
3. App shell: hash router, desktop top bar and phone bottom tabs (design.md section 6), theme application (`data-theme`, runtime `theme-color`), `platform/gradient.ts` (once per minute, OKLab blend), `coreBridge.ts`.
4. Primitives: Button, IconButton, Segmented (radio group), Switch, Stepper, Select, Dialog (focus trap), Sheet, Banner, Tooltip, Toast, Icon set (inline SVG).
5. Timer screen: Ring (SVG, rAF by ref), digits (`formatClock`, tabular), task picker, cycle dots, controls, message line, break card, Today card or strip, discard confirm (TMR-12), confetti (MIL-2), clearing milestone UI when focus starts (MIL-3).
6. Platform: `title.ts` (TMR-14), `shortcuts.ts` (TMR-13 exact rules), `audio.ts` (4 synthesized chimes plus none, unlock on first Play, gain = volume), `notify.ts` (permission on first Play, `registration.showNotification` only when hidden, click focuses client), `wakeLock.ts` (TMR-17, re-acquire on visibility), `announce.ts` (A11Y-3 throttle), `pwa.ts` (register, update pill only when timer not running), `navigator.storage.persist()` once after first completed session (DAT-7).
7. Tasks screen and categories (sheet on phone, swatch picker).
8. Charts in `charts/`: `geometry.ts` (contract.md section 4), GoalRing, StatTile, WeekColumns, TaskBars, Heatmap, TrendChart, ChartTable. Follow design.md section 8 exactly: thin marks, 4 px rounded data ends, solid hairline grid, selective labels, tooltips on hover and focus with `textContent`, table view for each chart, empty states.
9. Stats screen layout and section header controls (week nav, trend range).
10. Settings screen: all sections in design.md 7.4, Sync card per design.md 7.5 (rendered only when `isSyncConfigured()`; calls `core.loadSync()` when the email field is focused or a stored session exists; never awaits sync for any other UI), import flow (summary, Replace/Merge, inline errors from contract.md section 6), export (Blob download), erase with typed confirm, iOS notes.
11. Banners: storage errors, corrupt recovery (download backup key content), newer-version, export reminder (Stats and Settings only).
12. PWA: `vite-plugin-pwa` config, `pwa-assets.config.ts`, `public/icon.svg` per design.md section 11, iOS meta tags, relative URLs only.
13. `.github/workflows/deploy.yml` from architecture.md section 6, including the two `VITE_SUPABASE_*` secrets on the build job. Vite config: `build.rollupOptions` must keep the sync engine in its own chunk; add a size check script that fails if the main chunk exceeds 60 KB gzipped.
14. **After Gate B:** switch `main.tsx` to `createEmCore()`; keep the stub only in dev behind `?stub`. Expose `window.__emCore` per contract.md section 9. Add every `data-testid` in contract.md section 9.

**Responsible acceptance criteria (UI side):** TMR-1, TMR-2 (display and scheduling hookup), TMR-12 (dialog), TMR-13, TMR-14, TMR-16, TMR-17, TSK-2 to TSK-7 (UI), WK-1 to WK-5, HM-1 to HM-4, TR-1, TR-3 to TR-5, STK-2 (note), GOAL-1 to GOAL-3, SND-1 to SND-3, NTF-1 to NTF-4, MIL-2, MIL-3 (display), BRK-1, MSG-1, DAT-2 to DAT-5 (UI), DAT-7, UI-1 to UI-3, PWA-1 to PWA-4, A11Y-1 to A11Y-5, EDGE-6 (banners), EDGE-8, EDGE-10, SYNC-1 (no UI), SYNC-2, SYNC-3, SYNC-12, DAT-5 (two erase options).

**Done means:** every screen matches design.md at 1440x900, 1024x768 and 390x844 in both themes; no hard-coded colors outside `tokens.css`; no root-absolute URLs; build passes with JS under 60 KB gzipped; works offline after first load; QA e2e green; typecheck and lint clean.

---

## 3. QA agent

**Goal:** independent proof that every acceptance criterion holds, with evidence, and a clear report of what fails and who owns it.

**Owns:** `tests/`, `vitest.config.ts`, `playwright.config.ts`.

**Build in this order (start in parallel after Gate A; tests may be red until code lands):**
1. **Config:** `vitest.config.ts` (Node env, includes `frontend/src/**/*.test.ts` and `tests/unit/**/*.test.ts`, `TZ=America/Los_Angeles` set in `test.env` and also a second run with `TZ=UTC` via a script flag). `playwright.config.ts`: `webServer` = `npm run build && npm run preview`, `baseURL` `http://localhost:4173/em-time/`, projects `desktop-chromium` (1440x900), `mobile-chromium` (390x844, `isMobile`, `hasTouch`, deviceScaleFactor 3), `mobile-webkit` (390x844, local only, non-blocking).
2. **Fixtures (`tests/fixtures/`):** `backup-valid.json` (about 120 days), `backup-future.json` (3 future sessions), `backup-v0.json` (migration hook), `backup-not-json.txt`, `backup-wrong-app.json`, `backup-newer.json` (`schemaVersion: 99`), `backup-damaged.json` (sessions not an array), `backup-bad-records.json` (2 invalid sessions, 1 orphan task). Seeded-state helper that writes a fixture to `localStorage['em-time:data']` before page load.
3. **Unit tests (`tests/unit/`), written from contract.md, not from the implementation:**
   - Calendar: `dayKey` at 05:59 (previous date) and 06:00 (same date); 23:59 and 00:01 both previous-evening date rules; 05:30 on both 2026 DST change mornings belongs to the previous date; `addDays` across both DST changes; `weekStart` for Monday and Sunday starts.
   - Streaks: midnight crossover (session 23:45 to 00:10 counts for the start day); sessions at 01:30 and 05:59 count for the previous date, 06:00 for the new one; today empty but yesterday counts (current kept, `todayCounts` false); gap of one day resets; best includes current run; future sessions ignored; DST day inside a streak.
   - Moving average: first-session day has `avgMin` null until 3 days; days 3 to 6 average available days; zero days included; values before range used at the left edge (compare 30-day series with the last 30 of a 90-day series); today's `avgMin` null and `isToday` true; days before first session have `valueMin` null.
   - Week boundaries: Sunday vs Monday start; week containing DST; session at 05:30 Monday lands on Sunday (previous week with Monday start); `offset -1`; `hasPrev` false at first-session week; per-task sort, fold to "Other tasks" at 8+ tasks, "No task" row, deleted task "(deleted)".
   - Heatmap: 9 columns, future days omitted, levels at exact thresholds for goal 120 (0, 1, 29, 30, 59, 60, 119, 120 minutes) and for goal 60.
   - Timer drift with mocked clock: drive the engine with an injected `now` and fake `setTimeout`; delays of up to 59 s on timer callbacks (throttling) still produce `endedAt === endsAt` and `focusedMs === plannedMs`; jump `now` forward 6 hours while running: exactly one session, `late: true`, next phase idle even though auto-start is on; pause 10 minutes mid-phase: the session still ends 10 minutes later with `focusedMs === plannedMs`; `remainingMs` sampled every simulated frame never differs from `endsAt - now` by more than 0 ms and never goes negative; `formatClock` shows `25:00` at 0 to 999 ms elapsed and `0:00` only at end.
   - Timer rules: defaults have `autoStart: true`; TMR-5 double reset zeroes cycle; TMR-6 skip at 1 s, 60 s and 24:59 logs nothing and does not auto-start; TMR-8 4th completion leads to long; TMR-9 auto-start chain (on) and idle wait (off); TMR-11 config change while running.
   - Idempotency: completing the same phase twice (two engines adopting the same state) yields one session; `sessionId` matches `deviceId.slice(0, 24) + startedAt hex` and differs for two device ids.
   - **Sync (mock supabase-js):** inject a fake `createClient` returning a `SupabaseLike` backed by in-memory tables that apply the same LWW rule as the SQL trigger. Cover: SYNC-1 `isSyncConfigured` false for missing, empty, or non-https values and `loadSync()` returns null without importing the engine; SYNC-4 store writes return before any mock promise resolves (mock latency 5 s); SYNC-5 debounce 2 s and max wait 10 s with fake timers; SYNC-6 each trigger fires one run, overlapping triggers coalesce to one follow-up; SYNC-7 and EDGE-11 two simulated devices with disjoint offline histories sign in in turn, then both sync: identical union, no duplicate sessions, default categories single; SYNC-8 same task edited on both, later `updatedAt` wins on both, tie with tombstone deletes; SYNC-9 delete propagates; SYNC-13 device-only settings never appear in pushed `settings.data`, and seeded settings (`updatedAt 0`) never overwrite remote; SYNC-14 fixed category ids; SYNC-15 pulled sessions emit no `onPhaseComplete`; EDGE-12 different user merges; EDGE-13 401 -> `auth-expired`, dirty kept; EDGE-14 5xx backoff 5 s, 10 s, 20 s capped at 5 min, constraint error drops one row and counts `rejected`; pull overlap re-reads without duplicating; `toRow`/`fromRow` round trip for every table.
   - **SQL (static):** the migration file equals contract.md section 10 byte for byte; every table has RLS enabled and select/insert/update policies, none for delete.
   - Storage: corrupt JSON -> backup key written and fresh data; newer version -> read-only, no write; quota error -> status `quota`; every import fixture -> expected `ImportResult`; merge last-write-wins and tombstones.
   - Copy picker: no repeat until bag exhausted; `{sessions}` lines ineligible below 2; `numberWord` boundaries.
   - Geometry: `monotonePath` never produces a y outside the min/max of its two neighbors for any segment (sample 50 points per segment), handles 0, 1, 2 points; `linePaths` splits on nulls.
4. **Playwright smoke tests (`tests/e2e/`), both `desktop-chromium` and `mobile-chromium`:**
   - First run empty states (EDGE-8) on every screen.
   - Timer: use `page.clock.install()`; start focus, `page.clock.fastForward('25:00')`, assert today total 25m, task total, message line shown, break prompt shown, tab title format during run (TMR-14). Hide the page (emulate `visibilityState` hidden and dispatch `visibilitychange`), fast-forward, show again: correct state.
   - Keyboard (desktop): Space, S, R, 1/2/3, `?`; Space while typing in task input does not toggle.
   - Tasks: add, set current, rename, recolor category, check off, delete with sessions retained in stats.
   - Stats with seeded `backup-valid.json`: week nav, heatmap tooltip on hover (desktop) and tap (mobile), trend range toggle, table views.
   - Settings: theme toggle persists after reload, preset change, export downloads a file that `parseImport` accepts, import each bad fixture shows the right inline copy and changes nothing.
   - Reload mid-session resumes (TMR-15). Two pages in one context complete one phase: one session (DAT-6).
   - Offline: after first load, `context.setOffline(true)`, reload, app works (PWA-2).
   - Local-only build (default in CI without secrets): no Sync card, and `page.on('request')` sees no request to any `supabase.co` host or to the sync chunk across a full session (SYNC-1).
   - **Real-project sync test (`tests/e2e/sync.real.spec.ts`):** `test.skip` unless `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are all set. Uses the admin API (`auth.admin.generateLink({ type: 'magiclink', email })`) to get the 6-digit `email_otp` for a throwaway `em-time-e2e+<timestamp>@example.com` user. Two browser contexts act as two devices: each completes a session offline (fast-forwarded clock), signs in via the code field, syncs; both end with 2 sessions and identical task lists (SYNC-3, SYNC-7). A third anon request through supabase-js with the anon key and no session reads zero rows, and a second test user reads none of the first user's rows (SYNC-10). Deletes the test users at the end. Recommend a separate test project.
   - Layout: no horizontal scroll at 390 px (`scrollWidth <= clientWidth`), touch targets at least 44 px on mobile (A11Y-5).
   - Accessibility: run `@axe-core/playwright` on every screen in both themes, zero serious or critical violations.
   - **Screenshots** saved to `tests/screenshots/` as `{project}-{theme}-{screen}-{state}.png` for screens timer (idle, running, break with prompt), tasks, stats (empty and seeded), settings, in light and dark.
5. **Installability check (replaces Lighthouse PWA):** Lighthouse 12 and later removed the PWA category, so in `desktop-chromium` open a CDP session and assert `Page.getInstallabilityErrors` returns an empty list; fetch the manifest and assert `name`, `short_name`, `start_url`, `scope`, `display: standalone`, `theme_color`, icons 192 and 512 plus a maskable icon; assert a service worker controls the page after reload; assert `apple-touch-icon` and iOS meta tags exist. Optionally also run pinned `lighthouse@11` with `--only-categories=pwa` and record its result. Run current Lighthouse (mobile preset) for performance, accessibility and best practices and record scores (target 90+, informational).
6. **Manual checklist** (in the report, for Dathan to tick on real devices): iPhone Safari add to home screen, icon and title correct, standalone; lock phone mid-session and unlock: correct time; wake lock keeps screen on; desktop notification appears with tab in background; chime audible at volume 60; sign in on the iPhone home-screen app with the 6-digit code and on the laptop with the link, then confirm both show the same week.
7. **`tests/qa-report.md`:** date, commit, environment; a table with one row per acceptance criterion ID from spec.md section 3 and each EDGE item: `ID | criterion (short) | method (unit / e2e / CDP / manual) | result (PASS / FAIL / MANUAL / SKIPPED) | evidence (test name or screenshot path) | owner if FAIL`. SYNC rows covered only by the real-project test are marked SKIPPED (with reason) when its env vars were absent, never PASS. Then a summary (counts), failures with repro steps, Lighthouse scores, bundle size (main chunk and sync chunk separately), and the manual checklist.

**Responsible acceptance criteria:** verifies all of them. Every ID in spec.md section 3 and section 4 appears in the report.

**Done means:** suites run with one command (`npm test`) locally and in CI; every criterion has a PASS, a FAIL with owner and repro, or MANUAL with a checklist item; screenshots exist for every listed screen, state, theme and viewport; the report contains no unverified PASS.
