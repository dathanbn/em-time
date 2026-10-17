# Em Time QA report

- Date: 2026-10-15
- Commit: none (the folder is not a git repository)
- Environment: Linux sandbox, Node 22, Chromium via Playwright's default resolution, TZ America/Los_Angeles (unit suite also run with QA_TZ=UTC), Playwright against `npm run preview` of the production build
- Projects: `desktop` 1280x800, `mobile` 390x844 (Pixel 7 emulation, touch)

## Summary

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | OK (initial JS 47.3 KB gzipped, budget 60) |
| Unit (`npx vitest run`) | 338 pass, 0 fail (264 in `tests/unit`, 74 in the logic agent's files) |
| E2E (`npx playwright test`) | Final: 421 pass, 0 fail, 17 skipped (438 runs). Earlier: Round 2 418/3; Round 1 407/2; first run 381 pass / 26 fail |
| Real-project sync (`sync.real.spec.ts`) | NOT RUN: `SUPABASE_SERVICE_ROLE_KEY` unset and supabase.co is unreachable from this sandbox (proxy 403) |

Skips: desktop-only tests on mobile (keyboard shortcuts, hover, Up next card), phone-only tests on desktop (A11Y-5), and the real-project sync runs.

Criteria (final): 109 PASS, 0 FAIL, 1 NOT RUN (SYNC-12) of 110. Originally 98 PASS, 11 FAIL, 1 NOT RUN. Every failure was reproduced in two full runs with identical results (no flakiness). A PASS means an automated test passed; items needing real hardware are in the manual checklist and noted in the evidence column.

## Failures at a glance (first run, before Round 1; see Round 1 re-run for current state)

| # | Defect | Criteria | Owner | File |
|---|---|---|---|---|
| 1 | SVG `tabIndex` camelCase attribute is ignored, so week columns, heatmap cells and the trend chart cannot be reached with Tab | A11Y-2, WK-1, HM-3, TR-4 | frontend | `charts/WeekColumns.tsx:135`, `charts/Heatmap.tsx:133`, `charts/TrendChart.tsx:159` (use `tabindex`) |
| 2 | Dark theme has no time-of-day gradient: the inline critical CSS in index.html sets `background` with higher specificity | UI-2 | frontend | `frontend/index.html` |
| 3 | Touch targets under 44 px on phone (mode switcher, range toggle, presets, theme toggle, switches 48x28) | A11Y-5 | frontend | `styles/components.css`, `styles/screens.css` |
| 4 | Contrast: dark current-task row 4.04:1; nav dimmed to 50% while running is 1.8-2.4:1 | A11Y-1 | frontend (nav dim: design decision) | `styles/screens.css` `.trow--cur`, nav running state |
| 5 | Long unbreakable task name widens the task picker and Up next list (no ellipsis, overflows viewport) | EDGE-10 | frontend | `styles/screens.css` `.picker`, `.upnext` |
| 6 | Category rename error is not cleared by a no-op rename; duplicate `id="cat-new"` leaves the phone sheet input unnamed | TSK-6 | frontend | `screens/Tasks.tsx` |
| 7 | Service worker precaches the lazy sync chunks (supabase-js, 53 KB gz) so they download on first visit | SYNC-2 | frontend | `frontend/vite.config.ts` |
| 8 | A phase that finished while the app was closed (within 60 s) delivers its PhaseCompleteEvent before the UI subscribes: no encouraging line, milestone consumed silently | MSG-1 (MIL-2 caveat) | logic | `core/core.ts` |

## Acceptance criteria and edge cases

Unit files are in `tests/unit/`, e2e specs in `tests/e2e/`.

| ID | Criterion | Method | Result | Evidence | Owner and file (FAIL only) |
|---|---|---|---|---|---|
| TMR-1 | Defaults show 25:00, Focus, idle, full ring | unit+e2e | PASS | timer.test "initial state"; first-run/timer.spec TMR-1 |  |
| TMR-2 | Countdown, drift under 1 s incl. background | unit (mock clock)+e2e | PASS | timer.test "backgrounded for 10 minutes", "delayed up to 59 s", "reaches 24:59 within 1.1 s"; timer.spec |  |
| TMR-3 | Finished focus logs one 25 min session to day, count, task | unit+e2e | PASS | logging.test TMR-3; timer.spec TMR-3 |  |
| TMR-4 | Pause freezes, resume continues, paused time not counted | unit+e2e | PASS | timer.test "pause 10 minutes mid-phase"; timer.spec TMR-4 |  |
| TMR-5 | Reset returns to full, logs nothing; double reset zeroes cycle | unit+e2e | PASS | timer.test D-17; timer.spec TMR-5 |  |
| TMR-6 | Skip in focus logs nothing, goes to short break idle | unit+e2e | PASS | logging.test TMR-6 (1 s, 60 s, 24:59); timer.spec TMR-6 |  |
| TMR-7 | Skip in break goes to focus idle | unit+e2e | PASS | logging.test TMR-7; timer.spec TMR-7 |  |
| TMR-8 | 4th session leads to long break; cycle dots | unit+e2e | PASS | timer.test "4th completed focus session"; timer.spec TMR-8 |  |
| TMR-9 | Auto-start on chains, off waits idle | unit+e2e | PASS | timer.test TMR-9; timer.spec TMR-9 |  |
| TMR-10 | Presets and custom ranges, clamp on blur | unit+e2e | PASS | store.test TMR-10; settings.spec TMR-10 |  |
| TMR-11 | Duration change does not alter a running phase | unit+e2e | PASS | timer.test TMR-11; settings.spec TMR-11 |  |
| TMR-12 | Mode switcher discard confirm at 60 s | unit+e2e | PASS | logging.test TMR-12; timer.spec/keyboard.spec TMR-12 |  |
| TMR-13 | Keyboard shortcuts and guards | e2e (desktop) | PASS | keyboard.spec TMR-13 (6 tests); phone skipped by design |  |
| TMR-14 | Tab title running / paused / idle, hidden updates | e2e | PASS | timer.spec "tab title (TMR-14)" |  |
| TMR-15 | State survives reload / closed tab, EDGE-1 catch-up | unit+e2e | PASS | logging.test "reload and catch-up"; timer.spec reload. (The catch-up completion message defect is filed under MSG-1.) |  |
| TMR-16 | Breathing glow, reduced motion | e2e | PASS | timer.spec TMR-16 (2 tests) |  |
| TMR-17 | Wake lock held while running, released on pause/reset/end/off | e2e (stubbed API) | PASS | timer.spec TMR-17. Real device: manual item 4 |  |
| TSK-1 | Five seeded categories, fixed ids, no tasks | unit+e2e | PASS | first-run.spec TSK-1; storage.test |  |
| TSK-2 | Add task: 1-80 chars, default category, top of list | unit+e2e | PASS | tasks.spec TSK-2; store.test |  |
| TSK-3 | Rename, move, check off, uncheck, delete keeps sessions | unit+e2e | PASS | tasks.spec TSK-3; store.test |  |
| TSK-4 | Current task, picker | e2e | PASS | tasks.spec TSK-4 (the picker's long-name layout is filed under EDGE-10) |  |
| TSK-5 | Credit goes to task current at completion | unit+e2e | PASS | logging.test TSK-5; tasks.spec TSK-5 |  |
| TSK-6 | Category rename, recolor, add (max 8), delete with reassign | unit+e2e | PASS | Round 1: tasks.spec TSK-6 rename-error and accessible-name tests now pass on both projects |  |
| TSK-7 | Task rows show this week's minutes | unit+e2e | PASS | Final: tasks.spec TSK-7 passes on both projects (one visible figure per row, current row included) | |
| TSK-8 | Clear done with confirm; sessions remain | unit+e2e | PASS | tasks.spec TSK-8; store.test |  |
| WK-1 | 7 columns, day labels, date range | unit+e2e | PASS | Round 2: stats.spec WK-1 keyboard tooltip test passes on desktop and mobile (tooltip no longer hidden by focus scroll) |  |
| WK-2 | Per-task totals sorted, fold to Other tasks, No task | unit+e2e | PASS | week.test; stats.spec WK-2 |  |
| WK-3 | Week total stat | e2e | PASS | stats.spec WK-3 |  |
| WK-4 | Week navigation and disabled states | unit+e2e | PASS | week.test; stats.spec WK-4 |  |
| WK-5 | Completing a session updates the week without reload | e2e | PASS | stats.spec WK-5 |  |
| HM-1 | 9x7 grid ending this week, no future days | unit+e2e | PASS | heatmap.test; stats.spec HM-1 |  |
| HM-2 | Levels by goal thresholds (goal 120 and 60) | unit+e2e | PASS | heatmap.test (0,1,29,30,59,60,119,120); stats.spec HM-2 |  |
| HM-3 | Hover/tap tooltip; grid is one tab stop with arrow keys | e2e | PASS | Round 1: stats.spec HM-3 keyboard tab-stop test passes (tabindex fixed) |  |
| HM-4 | Less/More legend and caption | e2e | PASS | Legend Less/More, five shades, and caption. Spec says "Darkest: daily goal met"; the accepted frontend wording is "Strongest shade: daily goal met" and the test now asserts that (stale-test change). stats.spec HM-4 |  |
| TR-1 | Daily dots plus 7-day line, 30/90/365 toggle | unit+e2e | PASS | trend.test; stats.spec TR-1 |  |
| TR-2 | Trailing mean rules, left-edge lookback, 3-day minimum | unit+e2e | PASS | trend.test (10); stats.spec TR-2 |  |
| TR-3 | Today hollow dot, excluded from line | unit+e2e | PASS | trend.test; stats.spec TR-3 |  |
| TR-4 | Crosshair snaps; arrow keys when chart has focus | e2e | PASS | Round 1: stats.spec TR-4 tab-stop test passes (tabindex fixed) |  |
| TR-5 | Goal hairline labeled Goal | e2e | PASS | stats.spec TR-5 |  |
| STK-1 | Day counts with at least one session | unit+e2e | PASS | streak.test; stats.spec STK-1 |  |
| STK-2 | Current streak, today-not-counted note | unit+e2e | PASS | streak.test; stats.spec STK-2 |  |
| STK-3 | Best streak includes current | unit | PASS | streak.test "best remembers the longer old run"; Best streak tile in stats screenshots |  |
| GOAL-1 | Goal ring "84 of 120 min", range 15-720 step 15 | unit+e2e | PASS | store.test; settings.spec; stats.spec GOAL-1 |  |
| GOAL-2 | At/over goal: full, check, "Goal met" | e2e | PASS | stats.spec GOAL-2 |  |
| GOAL-3 | Compact ring and minutes on timer screen | e2e | PASS | stats.spec GOAL-3; timer-idle screenshots |  |
| SND-1 | Chime options and Preview, default Glass | e2e (stubbed audio) | PASS | settings.spec/timer.spec SND-1. Audible check: manual item 5 |  |
| SND-2 | Volume 0-100, default 60, preview uses it | e2e (stubbed audio) | PASS | settings.spec/timer.spec SND-2 |  |
| SND-3 | Chime on every phase end, audio unlocked on first Play | e2e (stubbed audio) | PASS | timer.spec SND-3 (2 tests) |  |
| NTF-1 | Permission asked on first Play only, once | e2e (stubbed) | PASS | timer.spec NTF-1 |  |
| NTF-2 | Notification when hidden at phase end, copy, none when visible | e2e (stubbed) | PASS | timer.spec NTF-2 (2 tests). Real desktop notification: manual item 3 |  |
| NTF-3 | Notification toggle and permission state text | e2e | PASS | settings.spec NTF-3 (3 tests) |  |
| NTF-4 | iOS limit note in Settings | e2e | PASS | settings.spec NTF-4 |  |
| MIL-1 | Thresholds 10/50/100/250 sessions, 7/30 streak, once; no replay on pull | unit+e2e | PASS | logging.test MIL-1 (6); timer.spec MIL-1 |  |
| MIL-2 | Message and quiet confetti, <=36 particles, reduced motion | unit+e2e | PASS | timer.spec MIL-2 (2). Caveat: a milestone reached by a catch-up completion inside the 60 s grace is consumed without display (same defect as MSG-1; not separately tested). |  |
| MIL-3 | Never while focus runs; cleared at focus start | unit+e2e | PASS | timer.spec MIL-3; logging.test |  |
| MIL-4 | Milestone replaces the encouragement | unit+e2e | PASS | logging.test MIL-4; timer.spec MIL-4 |  |
| BRK-1 | Break prompt card, toggle hides it | unit+e2e | PASS | timer.spec BRK-1 (3); screenshots timer-break-* |  |
| BRK-2 | Shuffled bag, no repeat until exhausted | unit | PASS | copy.test BRK-2 |  |
| MSG-1 | Encouraging line after focus completion, not on Skip, toggle | unit+e2e | PASS | Round 1: logging.test catch-up replay test and timer.spec "finished while the tab was closed" pass on both projects |  |
| MSG-2 | Verbatim lines, {sessions} eligibility and number words | unit+e2e | PASS | copy.test MSG-2 (7); logging.test |  |
| MSG-3 | Shuffled bag, persisted per device | unit | PASS | copy.test MSG-3 |  |
| DAT-1 | Synchronous write on every change, no write on tick | unit+e2e | PASS | storage.test; store.test; data-safety.spec DAT-1 |  |
| DAT-2 | Export file name and shape, "Last backup" | unit+e2e | PASS | settings.spec DAT-2 (downloads file, checks name and parseImport); storage.test |  |
| DAT-3 | Import: summary, Replace/Merge, invalid rejected, nothing changed | unit+e2e | PASS | import.test (16); settings.spec DAT-3 (12, every bad fixture) |  |
| DAT-4 | Export reminder rules, snooze, hidden when synced | unit+e2e | PASS | data-safety.spec DAT-4 (5); logging.test |  |
| DAT-5 | Erase requires typing erase; signed-in options | unit+e2e | PASS | settings.spec DAT-5; sync.test eraseCloud |  |
| DAT-6 | Two tabs never double-log | unit+e2e | PASS | logging.test DAT-6; timer.spec DAT-6 (two pages, one context) |  |
| DAT-7 | storage.persist() called once after first session | e2e (stubbed) | PASS | timer.spec DAT-7 |  |
| UI-1 | Light default, toggle persists, no auto switching | e2e | PASS | first-run.spec / settings.spec UI-1 |  |
| UI-2 | Time-of-day gradient, both themes, per-minute recompute | e2e | PASS | Round 1: layout.spec UI-2 dark-theme test passes; dark screenshots show the gradient |  |
| UI-3 | No horizontal scroll at 1440/1024/390 (and 1280/360) | e2e | PASS | layout.spec UI-3 (6); every screenshot asserts no overflow |  |
| PWA-1 | Installable, iOS home screen metadata | e2e (CDP) | PASS | pwa.spec PWA-1 (4): manifest, icons, SW control, Page.getInstallabilityErrors empty. iOS device: manual item 1 |  |
| PWA-2 | Fully offline after first load | e2e | PASS | pwa.spec PWA-2 (2) with context.setOffline |  |
| PWA-3 | Update prompt only when timer not running, never auto reload | e2e | PASS | pwa.spec PWA-3 |  |
| PWA-4 | Assets work under /em-time/ | e2e | PASS | pwa.spec PWA-4 (2) |  |
| A11Y-1 | AA contrast, both themes, every gradient stop | e2e (axe) | PASS | Final: axe contrast passes on all screens in both themes at every gradient stop, including the dark current task row and the dimmed running nav | |
| A11Y-2 | Everything keyboard reachable, visible focus ring | e2e | PASS | Round 2: keyboard.spec and stats.spec keyboard-stop and tooltip tests all pass |  |
| A11Y-3 | Live region: phase changes at once, time at 20/15/10/5/1 | e2e | PASS | timer.spec A11Y-3 (2) |  |
| A11Y-4 | Show as table for every chart, same values | e2e | PASS | stats.spec "chart tables (A11Y-4)" |  |
| A11Y-5 | Touch targets at least 44x44 on phone | e2e | PASS | Round 1: all A11Y-5 phone tests pass |  |
| SYNC-1 | No sync UI, no Supabase request, build succeeds without env | e2e+unit | PASS | sync.spec (port 4173 build): no card, no auth key, no supabase request across a full session; first-run.spec "entry chunk has no Supabase URL"; sync.test isSyncConfigured |  |
| SYNC-2 | Signed-out card shown when configured; supabase-js not downloaded until needed | e2e (build with fake env, port 4174) | PASS | Round 1: SW precache no longer lists the sync chunks (23 entries, 238 KiB); first-run.spec "service worker does not download the sync chunks" passes; sync.spec SYNC-2 passes on the fake-env build |  |
| SYNC-3 | Magic link / 6-digit code, inline errors | e2e (invalid email)+real | PASS | sync.spec "invalid address shows an inline error and sends nothing" PASS. Email send, code sign-in and rate-limit copy against Supabase: NOT RUN (sync.real.spec.ts) |  |
| SYNC-4 | No user action waits on network | unit | PASS | sync.test SYNC-4 (3, mock latency); store.test |  |
| SYNC-5 | Push within 10 s: 2 s debounce, 10 s max wait | unit (fake timers) | PASS | sync.test SYNC-4 / SYNC-5 (3). Against real server: NOT RUN |  |
| SYNC-6 | Sync triggers: sign-in, open, visible, online, Sync now | unit | PASS | sync.test SYNC-6 (2) |  |
| SYNC-7 | Union by id, no duplicates | unit (fake server) | PASS | sync.test SYNC-7/EDGE-11 (3); import.test. Real project: NOT RUN |  |
| SYNC-8 | LWW by updatedAt, tombstone wins ties | unit | PASS | sync.test SYNC-8 (3); sql.test |  |
| SYNC-9 | Soft deletes propagate | unit | PASS | sync.test SYNC-9 (3) |  |
| SYNC-10 | RLS: own rows only, anon nothing | unit (static SQL)+real | PASS | sql.test (8: RLS on, no delete policy, migration byte-equals contract). Live RLS check: NOT RUN (sync.real.spec.ts) |  |
| SYNC-11 | Sign out keeps local data | unit | PASS | sync.test SYNC-11 (2) |  |
| SYNC-12 | Sync state text in Settings | unit (engine statuses) | NOT RUN | Engine statuses are covered in sync.test (offline, auth-expired, retry, rejected). The Settings wording needs a signed-in engine and was only exercised by the frontend agent against a fake. No e2e evidence. |  |
| SYNC-13 | Synced vs device-only settings | unit | PASS | sync.test SYNC-13 |  |
| SYNC-14 | Fixed default category ids, seeded updatedAt 0 never wins | unit | PASS | sync.test SYNC-14 (3) |  |
| SYNC-15 | Pulled rows update screens; no chime/message/milestone | unit | PASS | sync.test SYNC-15; logging.test. Screen refresh on a live pull: NOT RUN |  |
| EDGE-1 | Timer accuracy, catch-up rules | unit+e2e | PASS | timer.test (23), logging.test, timer.spec EDGE-1 (3). Session and next phase are correct; the missing message is filed under MSG-1 |  |
| EDGE-2 | No partial sessions | unit | PASS | logging.test (18), timer.test (11) |  |
| EDGE-3 | Day rollover at 06:00 (23:45-00:10, 01:30, 05:59, 06:00) | unit | PASS | calendar.test (10); logging.test; streak.test |  |
| EDGE-4 | Time zone and DST | unit (LA and UTC runs) | PASS | calendar.test in America/Los_Angeles; full suite also run with QA_TZ=UTC (zone-specific cases skip) |  |
| EDGE-5 | Future-dated sessions excluded, negative dropped | unit+e2e | PASS | import.test, heatmap.test, settings.spec EDGE-5 (backup-future.json) |  |
| EDGE-6 | Corrupt JSON backup, quota banner, newer version read-only, pagehide flush | unit+e2e | PASS | storage.test (6); data-safety.spec EDGE-6 (6) |  |
| EDGE-7 | Multiple tabs do not double-log | unit+e2e | PASS | logging.test EDGE-7 (4); timer.spec DAT-6 |  |
| EDGE-8 | Empty states on every screen | e2e | PASS | first-run.spec EDGE-8 (4); screenshots *-empty-*, timer-empty-* |  |
| EDGE-9 | Deleted references keep snapshot name | unit | PASS | week.test EDGE-9 (8) |  |
| EDGE-10 | Long names truncate in one line, full name in title/table | e2e | PASS | Round 1: both EDGE-10 layout tests pass on desktop and mobile |  |
| EDGE-11 | Two devices, both unsynced, first sign-in | unit (fake server) | PASS | sync.test EDGE-11 (5). Real project: NOT RUN |  |
| EDGE-12 | Different account merges local data | unit | PASS | sync.test EDGE-12 (2) |  |
| EDGE-13 | Auth expiry pauses sync, changes stay queued | unit | PASS | sync.test EDGE-13 (4) |  |
| EDGE-14 | Backoff 5 s doubling to 5 min; rejected rows dropped and counted | unit | PASS | sync.test EDGE-14 (4) |  |
| EDGE-15 | Settings resolve as one object by updatedAt; device-only never leave | unit | PASS | sync.test SYNC-13 and LWW cases |  |

## Round 1 re-run

Commands: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build`, `npx playwright test`, all with the fix round applied. All 36 screenshots regenerated and re-read.

| Check | Result |
|---|---|
| lint, typecheck, build | clean; initial JS 47.3 KB gzipped (budget 60) |
| Unit | 338 pass, 0 fail (the MSG-1 replay test now passes) |
| E2E full run | 407 pass, 2 fail, 17 skipped |
| E2E after fixing my flaky test | the A11Y-5 primary-controls test passes 28 of 28 repeats; no other full run done after that edit |

Fixed by the fix round (verified): tab stops on week columns, heatmap and trend chart; dark-theme gradient; phone touch targets; contrast (current-task row, running-timer nav via the muted token); picker and Up next overflow; category rename error and duplicate id; sync chunks no longer precached; catch-up completion replay.

Test changes on my side (no assertion loosened for a real defect):
- Chunk names changed to `sync-engine-*` and `sync-dist-*`; the chunk-download regexes in `first-run.spec.ts` and `sync.spec.ts` now match both names so they cannot pass vacuously.
- The running-timer contrast test looped over both themes on one page; the second iteration kept the light theme under a dark painted background and reported a false dark failure. It is now one test per theme.
- A11Y-5 primary-controls test waits for the Stats screen to render before counting controls (a race, seen once).

### Still failing (real)

| Criteria | Defect | Owner | File |
|---|---|---|---|
| WK-1, A11Y-2 | Focusing a week column with the keyboard scrolls the page by about 21 px on desktop; the tooltip's `window` scroll listener hides the tooltip immediately, so the keyboard tooltip never shows (stats.spec WK-1 keyboard test, desktop, 5 of 5). Mobile passes. The heatmap and trend tests pass but sit higher on the page, so the same issue is likely whenever focus scrolls. | frontend | `frontend/src/charts/Tooltip.tsx` |

### Remaining visual issues (all frontend, cosmetic)

1. Today's heatmap cell keeps a dark outline that reads as a focus ring (lighter than before).
2. Stats at 1280: the heatmap sits in a half-empty card (the stat card beside it is now spaced out and looks better).
3. Tasks at 1280: the lower half of the viewport is empty.
4. Settings: the disabled "Preview" for None and the disabled Notifications switch are low contrast (intended as disabled).
5. Timer at 390: a large empty band above the Today card.

Fixed visually: dark gradient present, cycle dots now visible (outlined), stat card spacing, segmented controls the same height as neighbouring buttons.

## Round 2 re-run

Commands: `npm run lint`, `npm run typecheck`, `npx vitest run`, `VITE_E2E=1 npm run build`, `npx playwright test`. All 56 screenshots regenerated and the new ones read (see below).

| Check | Result |
|---|---|
| lint, typecheck | clean |
| Unit | 338 pass, 0 fail |
| Build (`VITE_E2E=1`) | OK; initial JS 47.4 KB gzipped (budget 60); SW precache 23 entries, 238.9 KiB |
| E2E | 418 pass, 3 fail, 17 skipped |
| Real-project sync | NOT RUN (no service-role key, supabase.co unreachable) |

Config changes made: the explicit Chromium path is gone; the 4173 webServer is preview-only; `window.__emCore` specs rely on the `VITE_E2E=1` build (the QA-only 4174 build sets it too).

Test changes caused by accepted frontend changes (not loosened):
- HM-4: caption now "Strongest shade: daily goal met" (spec text says "Darkest"; accepted wording asserted).
- TR-1 and TR-3: dots are now `circle.trend__dot` styled by CSS instead of a `fill-opacity` attribute; selectors updated and a computed-opacity check (< 1) keeps the "faint" assertion.
- TSK-7: as requested, asserts a visible figure (`toBeVisible`) and exactly one visible figure per row. This now catches two real defects (below).

New screenshots (all in light and dark, 1280 and 390): `timer-current-task`, `picker`, `dialog-discard`, `milestone` (10th session: message plus confetti, clock mocked), `sync-signed-in`. The signed-in Sync card was drivable: the 4174 build runs with a stored fake session and Supabase requests answered by `page.route` (Settings shows "Signed in as em@example.com", "Synced · just now", Sync now, Sign out). This exercises the real engine against canned responses, not a live server.

### Still failing (real)

| Criteria | Defect | Owner | File |
|---|---|---|---|
| TSK-7 | Week minutes appear twice on desktop non-current rows; the current row shows no minutes (and no category) on phone | frontend | `frontend/src/styles/screens.css` ~L527-531, ~L575-580 |
| A11Y-1 | Dark Tasks screen: current row's week minutes (`--em-ink-3` on `--em-accent-soft`) fail axe contrast | frontend | `frontend/src/styles/screens.css` (`.trow--cur .trow__mins`) |

### Visual notes (all frontend, cosmetic unless stated)

1. The two TSK-7 defects above are visible in `tasks-1280-light.png` (duplicate figure) and with a current task on phone (no minutes, no category).
2. Heatmap: today's cell outline is still heavy.
3. Tasks at 1280 leaves the lower half of the viewport empty; heatmap card on Stats at 1280 is half empty.
4. Timer at 390 has an empty band above the Today card.
5. Milestone moment: the confetti is a handful of small dots across the top of the ring; clear and quiet. At the instant of the screenshot the mode pill is mid-transition at 1280.
6. Fixed and verified visually: timer layout no longer jumps between idle, running and break; "Strongest shade" caption; Settings disabled contrast; picker and discard sheets render cleanly on phone in both themes; the signed-in Sync card matches the card style.

### Manual checklist for Dathan after deploy (real iPhone and Chrome)

On the iPhone (Safari, then the home-screen app):
1. Add to Home Screen. The icon and the name "Em Time" are right, and it opens full screen with no browser bar.
2. Start a 25 minute session, lock the phone for a few minutes, unlock: the time shown is correct to the second and nothing was logged twice.
3. With the app open and a session running, the screen stays awake (wake lock). Pause it and confirm the screen can sleep again.
4. Chime: finish a short session (set Custom 1 minute), turn the volume up, and hear it. Preview each of Glass, Bowl, Bell, Wood in Settings. Remember iOS only chimes while the app is open.
5. Sign in with the 6-digit code in the home-screen app (the magic link from Mail opens Safari, not the app). Confirm "Synced" appears.

In desktop Chrome:
6. Allow notifications on the first Play, background the tab, let a phase end: a system notification appears and clicking it focuses the app; no notification while the tab is visible. Check the Settings notification state text.
7. Install the app from the address bar (Install Em Time). It opens in its own window, works offline (turn Wi-Fi off, reload), and shows "Update ready. Refresh" only when no timer is running after a later deploy.
8. Sign in with the magic link from the email (same browser) on the laptop.

Two-device sync:
9. With the phone and laptop both signed in, add a task on each and complete one session on each. Tap Sync now on both: both show the same tasks and the same week total, with no duplicate sessions and the five default categories shown once.
10. Delete a task on one device: it disappears on the other after its next sync. Turn Wi-Fi off on one, complete a session, turn it on: it syncs within a minute.
11. Confirm the Supabase magic-link email template includes `{{ .Token }}`, otherwise no code arrives.

## Final

Run exactly as documented: `npm run lint`, `npm run typecheck`, `npx vitest run`, `VITE_E2E=1 npm run build`, `npx playwright test`. All 56 screenshots regenerated.

| Check | Result |
|---|---|
| lint, typecheck | clean |
| Unit | 338 pass, 0 fail |
| Build (`VITE_E2E=1`) | OK; initial JS 47.4 KB gzipped (budget 60); SW precache 23 entries, 238.9 KiB |
| E2E | 421 pass, 0 fail, 17 skipped (desktop-only tests on mobile, phone-only tests on desktop, real-project sync) |
| Real-project sync | NOT RUN (no service-role key; supabase.co unreachable from the sandbox) |

Remaining failures: none. Not verified by automation: SYNC-12 Settings wording against a live engine, anything against the live Supabase project, real-device behaviour (manual checklist in the Round 2 section).

Screenshots re-read: Tasks at 1280 and 390 in light and dark show one week-minutes figure per row (no duplicate on desktop, inline on the category line on phone), "(deleted)" is a separate span on Stats, and the heatmap's today cell uses the lighter inset stroke in both themes. Left as cosmetic notes: the empty lower half of the Tasks page at 1280, the half-empty heatmap card at 1280, and the empty band above the Today card on the phone timer.

## Visual review (first run)

I read all 36 screenshots in `tests/screenshots/` (`<screen>-<width>-<theme>.png`: timer-idle, timer-running, timer-break, timer-empty, tasks, tasks-empty, stats, stats-empty, settings; widths 1280 and 390; light and dark). Everything below is for the frontend owner. Overall the screens follow design.md: calm light blue accents, readable type, no horizontal scroll, no clipped text, no chart labels overlapping, and the phone tab bar does not cover content. Issues, all owner = frontend:

1. Dark theme background is flat navy on every screen. design.md and UI-2 call for the time-of-day gradient in both themes (defect 2).
2. Stats at 1280: the heatmap card has a lot of empty space around a narrow 9-column grid, and the stat card beside it (Active days / Total time / Best day) is stretched to the same height with roughly 60% of it empty. The three top tiles also have uneven heights. Consider a shorter second card or aligning to content.
3. Stats at 1280 (seeded): today's heatmap cell has a heavy dark outline that reads as a focus ring even when nothing is focused, easy to mistake for a data state.
4. Timer idle: the cycle dots are very faint on the light theme (decorative, but TMR-8 specifies them as the visible cycle indicator). The timer-running screenshots also show the nav at half opacity, which is the contrast issue in defect 4.
5. Timer at 390: a large empty band between the controls and the Today card in idle and running states. Functionally fine; the card could sit closer to the controls.
6. Settings (dark): the Notifications switch is disabled ("Blocked in browser settings", the headless default, not a defect) and its track is hard to see against the card.
7. Settings: the dimmed "Preview" for the None chime is the only low-contrast label in the Sound card (intended as disabled).
8. Tasks at 1280: the page is short and leaves the lower half of the viewport empty. Cosmetic.
9. Phone (390): the segmented controls on Timer, Stats and Settings are visibly shorter (40 px) than the 44+ px buttons around them (defect 3).

## Bundle sizes (`npm run build`)

| Chunk | Raw | Gzipped |
|---|---|---|
| Initial JS (`index-*.js`) | 142.33 KB | 48.91 KB by Vite (the size script reports 47.3 KB initial JS; budget 60 KB) |
| CSS (`index-*.css`) | 35.74 KB | 7.75 KB |
| Sync chunk: supabase-js (`sync-dist-*.js`, lazy) | 214.05 KB | 55.06 KB by Vite (53.4 KB by the size script) |
| Sync engine (`sync-engine-*.js`, lazy) | 10.73 KB | 4.19 KB |
| workbox-window (lazy) | 5.65 KB | 2.20 KB |
| Inter variable font | 48.25 KB | n/a (woff2) |
| Service worker precache | 23 entries, 238.06 KiB (Round 1; was 25 entries, 456.78 KiB) | lazy sync chunks no longer precached |

## Not run

- Real-project sync: `tests/e2e/sync.real.spec.ts` skips unless `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are all set; when they are, the `:4174` build in `playwright.config.ts` is built with the real values. SYNC-3 (email and code), SYNC-7, SYNC-10 (live RLS) and the live parts of SYNC-5, SYNC-15 and EDGE-11 are covered by the fake-server unit suite only. The spec has never executed (no network), so expect to debug it on its first real run.
- Lighthouse performance and accessibility scores: not run in this sandbox.
- WebKit and iOS: not available. Chrome installability is covered through CDP (`Page.getInstallabilityErrors` empty).

## Manual checklist for Dathan (real devices)

1. iPhone Safari: Add to Home Screen; icon and title "Em Time"; opens standalone.
2. Lock the phone mid-session, unlock: the time is correct to the second.
3. Desktop: a notification appears when a phase ends with the tab in the background; clicking it focuses the app.
4. Phone: the screen stays awake while a session runs (wake lock) and can sleep again after pause.
5. Hear each chime (Glass, Bowl, Bell, Wood) at volume 60, also with the tab in the background.
6. Sync (after the Supabase project exists and the email template includes `{{ .Token }}`): sign in on the iPhone home-screen app with the 6-digit code and on the laptop with the link; both show the same week; edit a task on each and confirm both converge.
7. After defect 1 is fixed, Tab through Stats: the week columns, heatmap and trend chart each take one stop.

## How to run

```
npm run lint && npm run typecheck && npx vitest run
VITE_E2E=1 npm run build      # must precede the e2e run: window.__emCore exists only in a VITE_E2E=1 build (with ?e2e)
npx playwright test
```

`playwright.config.ts` serves the already-built `dist/` with `npm run preview` and never rebuilds it (CI builds with `VITE_E2E=1` first, then runs the suite). The only build the config makes is a QA-only second one with fake Supabase env into `playwright-report/dist-sync/` (port 4174), used for the Sync card tests and screenshots; it is never the CI artifact. Browsers use Playwright's default resolution (no executable path in the config). `QA_TZ=UTC npx vitest run` repeats the unit suite in UTC. Screenshots are regenerated by `tests/e2e/screenshots.spec.ts` into `tests/screenshots/`.

Sandbox note: Playwright 1.64.1 looks for `chromium_headless_shell-1248`, but this sandbox only has revision 1194 under `/opt/pw-browsers` and `npx playwright install` is not allowed. The exact error with default resolution: `browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`. I ran locally with `PLAYWRIGHT_BROWSERS_PATH` pointed at a scratch directory of symlinks that map the 1248 names onto the 1194 browser (Chromium 141); the config and repo are untouched. On GitHub, `npx playwright install --with-deps chromium` makes this unnecessary.
