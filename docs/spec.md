# Em Time: Product Spec (v1)

## 1. Goal and user

Em Time is a calm, light blue Pomodoro-style focus timer that Dathan is building as a gift for his girlfriend, a student who uses it for school and studying. It runs in the browser as an installable PWA, desktop first but fully usable on a phone. There is one user. The app is local-first: everything works signed out, every write lands in localStorage first, and the UI never waits on the network. Optionally she can sign in with a magic-link email to sync her history between devices through Supabase. JSON export and import remain for backups. The app should feel quiet and kind: it times focus and breaks accurately, logs focus time against simple color-coded tasks, and shows progress (week bars, a two-month heatmap, a trend line, streaks, a daily goal ring) without nagging.

The Supabase project is created separately by Dathan (architecture.md section 8). The build must not assume it exists: with `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` missing, the app builds and runs local-only with no sync UI.

Related docs: `design.md` (visual and UX brief), `architecture.md` (stack, storage, sync, CI, agent split), `contract.md` (types, APIs, SQL, tokens), `tasks.md` (per-agent work orders).

## 2. Glossary

- **Phase**: one of `focus`, `short` (short break), `long` (long break).
- **Session**: one logged focus phase. Only focus phases that run to 00:00 are logged. Breaks are never logged.
- **Study day**: the calendar day a session belongs to: the local date of its start time minus 6 hours. A study day runs from 06:00 to 06:00 the next morning.
- **Focus minutes**: sum of logged sessions' `focusedMs`, in minutes. Paused time never counts.
- **Cycle**: completed focus sessions since the last long break (0 to `longEvery - 1`).
- **Synced / local-only**: signed in to Supabase with sync configured, or not.

## 3. Features and acceptance criteria

Every criterion has an ID. QA reports pass/fail per ID in `tests/qa-report.md`.

### 3.1 Timer (TMR)

- **TMR-1** With defaults (25/5/15, long break every 4, auto-start on), the home screen shows `25:00`, phase "Focus", status idle, a full ring.
- **TMR-2** Pressing Play starts the countdown. The display reaches `24:59` within 1.1 s and never drifts more than 1 s from wall-clock time over a full phase, including with the tab backgrounded, the window minimized, or the phone locked and later unlocked (time computed from timestamps, see EDGE-1).
- **TMR-3** Starting a 25-minute focus session and letting it finish adds exactly one session of 25 minutes to today's total, to today's session count, and to the current task's totals (or to "No task" if none is current).
- **TMR-4** Pause freezes the display and ring. Resume continues from the frozen value. Time spent paused is not counted.
- **TMR-5** Reset during a running or paused phase returns that phase to its full duration, idle. Nothing is logged. Reset while already idle at full duration in the focus phase also sets the cycle to 0.
- **TMR-6** Skip during focus, at any elapsed time, logs nothing and moves to a short break, idle. Skip never increments the cycle and never auto-starts the next phase.
- **TMR-7** Skip during a break moves to focus, idle. Nothing is logged.
- **TMR-8** After the 4th completed focus session in a cycle the next phase is a long break; otherwise a short break. After a long break the cycle is 0. The timer screen shows cycle progress as `longEvery` small dots.
- **TMR-9** With auto-start on (the default), finishing a phase starts the next phase immediately. With auto-start off, the next phase waits idle at full duration.
- **TMR-10** Presets 25/5, 50/10, 90/20 set focus/short/long to 25/5/15, 50/10/30, 90/20/30. Custom allows focus 1 to 180, short 1 to 60, long 1 to 90 minutes, long break every 2 to 8 sessions. Values outside range are clamped on blur.
- **TMR-11** Changing durations while a phase is running or paused does not change that phase. An idle phase at full duration updates immediately.
- **TMR-12** Clicking a phase in the mode switcher while idle switches to that phase at full duration. While running or paused with at least 60 s elapsed in focus, a confirm dialog ("Discard this session?") appears first. Discarding logs nothing.
- **TMR-13** Keyboard: `Space` play/pause, `S` skip, `R` reset, `1`/`2`/`3` select focus/short/long (same rules as TMR-12), `?` opens the shortcuts sheet. Shortcuts are ignored while typing in an input, textarea, select or contenteditable, and when Ctrl, Meta or Alt is held. `Space` on any other focused button or link keeps native behavior, except the three timer controls, where `Space` always means play/pause.
- **TMR-14** Tab title while running: `24:13 · Focus · Em Time` (phase names: Focus, Short break, Long break). Paused: `Paused 24:13 · Em Time`. Idle: `Em Time`. Updates once per second while visible and at least once per minute while hidden.
- **TMR-15** The timer state survives a reload, a closed tab, or a browser restart on the same device, applying EDGE-1 catch-up rules. Timer state is per device and never synced.
- **TMR-16** While running, the ring shows a subtle breathing glow (focus only). With `prefers-reduced-motion: reduce` there is no breathing and no ring refill animation.
- **TMR-17** While a phase runs on a device that supports the Screen Wake Lock API, the screen stays awake if "Keep screen on while running" is enabled (default on). The lock is released on pause, reset, phase end, or when the setting is turned off.

### 3.2 Tasks and categories (TSK)

- **TSK-1** First run seeds five categories: Study, Reading, Problem sets, Writing, Review, with color slots 1 to 5 and fixed ids (contract.md section 7) so devices never duplicate them. No tasks exist.
- **TSK-2** A task can be added with a name (1 to 80 characters, trimmed, required) and a category (defaults to the last category used, else the first). It appears at the top of the open list.
- **TSK-3** Tasks can be renamed, moved to another category, checked off (moves to a collapsible "Done" list), unchecked, and deleted (confirm). Deleting a task keeps its logged sessions; stats show them under the task's last name with "(deleted)".
- **TSK-4** Zero or one task is current (per device). "Set as current" on any task makes it current. The current task's name shows under the timer digits. Clicking it opens a task picker (open tasks, plus "No task" and "Add task").
- **TSK-5** A session is credited to the task that is current at the moment the session completes. Changing the current task mid-session moves the credit. Checking off the current task does not clear it.
- **TSK-6** Categories can be renamed (1 to 30 characters), recolored from the 8 palette swatches, added (max 8; two categories may share a color), and deleted. Deleting a category asks which category receives its tasks (default: first remaining). The last category cannot be deleted.
- **TSK-7** Each task row shows this week's focus minutes for that task.
- **TSK-8** "Clear done" removes all done tasks from the Done list after a confirm. Their sessions remain in stats (TSK-3 rule).

### 3.3 Week tracker (WK)

- **WK-1** Stats shows the current week (default Monday to Sunday, setting "Week starts on") as 7 columns of focus minutes per day, with day labels and the date range in the header (e.g. "Oct 13 to Oct 19").
- **WK-2** Below the columns, per-task totals for that week sorted by minutes descending, each with task name, category swatch and duration. More than 7 tasks: the rest fold into "Other tasks". Sessions with no task appear as "No task".
- **WK-3** The week total is shown as a stat (e.g. "9h 40m").
- **WK-4** Previous/next arrows navigate weeks. Next is disabled on the current week. Previous is disabled on the week containing the first-ever session (or the current week if there is no data). A "This week" button appears when not on the current week.
- **WK-5** Completing a session, or pulling new sessions from sync, updates the week view without a reload.

### 3.4 Heatmap (HM)

- **HM-1** Shows 9 week-columns by 7 day-rows ending with the current week; days after today are not drawn.
- **HM-2** Each cell's shade is level 0 to 4 by that study day's focus minutes relative to the daily goal: 0 min level 0; under 25% of goal level 1; 25% to under 50% level 2; 50% to under 100% level 3; at or above goal level 4. With the 120-minute default: 1 to 29, 30 to 59, 60 to 119, 120+.
- **HM-3** Hover (desktop) or tap (phone) on a cell shows the date and total, e.g. "Tue, Oct 14 · 1h 25m". Keyboard: the grid is one tab stop; arrow keys move between cells and show the same tooltip.
- **HM-4** A "Less / More" scale legend shows the five shades with the caption "Darkest: daily goal met".

### 3.5 Trend line (TR)

- **TR-1** Plots daily focus minutes as faint dots and one smooth line of the 7-day trailing mean, for the last 30 (default), 90 or 365 days, selected with a segmented toggle.
- **TR-2** Moving average: for each day D, the mean of daily focus minutes over D and the 6 preceding days, zero-minute days included. Days before the first-ever session have no value. The average is undefined until 3 days of data exist (counted from the first-session day); between 3 and 6 days it averages the available days. Values before the visible range are used so the line is not truncated at the left edge.
- **TR-3** Today is drawn as a hollow dot ("Today so far") and is excluded from the line, so the line does not dip every morning.
- **TR-4** A crosshair snaps to the nearest day and shows date, that day's total, and the 7-day average. Arrow keys move the crosshair when the chart has focus.
- **TR-5** A horizontal hairline marks the daily goal, labeled "Goal".

### 3.6 Streak and daily goal (STK, GOAL)

- **STK-1** A study day counts toward a streak if it has at least one logged focus session.
- **STK-2** Current streak: consecutive counting days ending today if today counts, else ending yesterday. If neither counts, 0. When today has not counted yet but yesterday did, the tile shows the streak with the note "Today's not counted yet".
- **STK-3** Best streak: the longest run of counting days ever, including the current one.
- **GOAL-1** A ring shows today's focus minutes against the daily goal (default 120, settings range 15 to 720 in steps of 15), with "84 of 120 min" in the center.
- **GOAL-2** At or over goal the ring is full, a small check appears and the label reads "Goal met". No second lap.
- **GOAL-3** A compact goal ring and today's minutes also appear on the timer screen.

### 3.7 Sound and notifications (SND, NTF)

- **SND-1** Chime options: Glass, Bowl, Bell, Wood, None. Each has a Preview button. Default: Glass.
- **SND-2** Volume slider 0 to 100 (default 60). Preview uses the current volume.
- **SND-3** A chime plays when any phase ends (including while the tab is backgrounded on desktop). Audio is unlocked on the first Play press.
- **NTF-1** Notification permission is requested on the first Play press ever, never on load. Asked once per device; the result is stored.
- **NTF-2** When a phase ends and the page is hidden, a system notification shows: focus end "Focus done" / "Time for a short break." (or "a long break."), break end "Break's over" / "Ready when you are." Clicking it focuses the app. No notification while the page is visible.
- **NTF-3** Settings shows the notification toggle and its permission state ("On", "Off", "Blocked in browser settings").
- **NTF-4** Known limit, shown in Settings on iOS: notifications and chimes only fire while the app is open, because iOS suspends web apps when locked. The timer still shows the correct state on return.

### 3.8 Milestones (MIL)

- **MIL-1** Milestones at 10, 50, 100, 250 sessions (each once ever) and at 7 and 30 day current streaks (each once per streak run). Milestones fire only when a threshold is crossed by a session completed on this device, so pulling synced history never replays old milestones.
- **MIL-2** A milestone shows a short message (Appendix C) and quiet confetti (at most 36 particles, about 1.2 s, light blue shades) when a focus session completes. Reduced motion: message only.
- **MIL-3** Never shown while a focus phase is running. Milestones are only checked when a focus session ends, so they appear as a break begins; the message and confetti are cleared the moment a focus phase starts.
- **MIL-4** A milestone message replaces the encouraging message for that session end.

### 3.9 Break prompts and encouragement (BRK, MSG)

- **BRK-1** On the break screen (short or long), one prompt from Appendix B shows as a small card. Toggle "Break suggestions" (default on) hides it.
- **BRK-2** Prompts rotate through a shuffled bag: no repeat until all have been shown.
- **MSG-1** After a focus session completes, one encouraging line from Appendix A shows under the ring and stays for the break. Never during a running focus phase, never after Skip. Toggle "Encouraging messages" (default on).
- **MSG-2** Lines live in `frontend/src/data/messages.json` and are used verbatim. Lines containing `{sessions}` are only eligible when today has at least 2 sessions; the token becomes the count as a word for 2 to 12 (capitalized at the start of a line, "Three sessions in.", lowercase elsewhere, "That's three today."), digits above 12.
- **MSG-3** Shuffled bag, no repeat until the eligible list is exhausted. Bag state is persisted per device.

### 3.10 Data (DAT)

- **DAT-1** Every state change (timer action, task/category edit, settings change, session logged) is written to localStorage synchronously before the UI confirms it. Ticking does not write. When signed in, the change is also queued for sync; the UI never waits for it.
- **DAT-2** Export downloads `em-time-backup-YYYY-MM-DD.json` containing all data (contract.md section 5). Settings shows "Last backup: Oct 14" or "Never".
- **DAT-3** Import accepts a file from DAT-2. It shows a summary (sessions, tasks, date range) and two choices: "Replace everything" (confirm) or "Merge" (adds sessions and tasks by id, keeps local settings). Invalid files show an inline error and change nothing. When signed in, imported rows are queued for sync.
- **DAT-4** Export reminder: a quiet banner on Stats and Settings (never on the timer screen) when there are at least 10 sessions and no export ever, or 14+ days since the last export with sessions added since. "Later" snoozes it 7 days. While signed in and synced within the last 7 days, the reminder is not shown.
- **DAT-5** "Erase all data" requires typing `erase` and resets to first-run state. When signed in, the dialog offers "This device only" (local reset, cloud untouched; signs out) or "This device and the cloud" (soft-deletes every synced row, then local reset).
- **DAT-6** Two open tabs never double-log a session (EDGE-7).
- **DAT-7** After the first completed session the app calls `navigator.storage.persist()` once.

### 3.11 Appearance and PWA (UI, PWA)

- **UI-1** Light theme by default. Settings has a Light/Dark toggle; choice persists per device. No automatic switching from the OS setting.
- **UI-2** The page background gradient changes with local time: dawn 05:00 to 08:59, day 09:00 to 16:59, dusk 17:00 to 19:59, night 20:00 to 04:59, interpolated over the last 60 minutes before each boundary, recomputed once per minute. Both themes.
- **UI-3** Layouts work at 1440x900, 1024x768 and 390x844 with no horizontal scroll and all controls reachable.
- **PWA-1** Installable in Chrome/Edge desktop and Android (no installability errors), and addable to the iOS home screen with icon and title "Em Time", standalone display.
- **PWA-2** After first load, the app works fully offline (timer, tasks, stats, settings, export). Sync resumes when back online.
- **PWA-3** A new deployed version shows "Update ready. Refresh" only when the timer is not running; it never reloads by itself.
- **PWA-4** All asset URLs work under `https://dathanbn.github.io/em-time/`.

### 3.12 Accessibility (A11Y)

- **A11Y-1** All text meets WCAG 2.1 AA contrast in both themes and on every background gradient stop. Light blue decoration colors are never used for text (design.md section 9).
- **A11Y-2** Every control is reachable and operable by keyboard with a visible focus ring.
- **A11Y-3** Screen readers hear phase changes and start/pause immediately, and remaining time at most once per minute (at 20, 15, 10, 5 and 1 minutes left), via a polite live region.
- **A11Y-4** Every chart has a "Show as table" alternative with the same values.
- **A11Y-5** Touch targets are at least 44x44 px on phone layout.

### 3.13 Sync (SYNC)

- **SYNC-1** With `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` missing or empty, the build succeeds, no sync UI appears, no request goes to any Supabase host, and every other criterion still passes.
- **SYNC-2** With sync configured and signed out, the app works fully. Settings shows a quiet "Sync" card with "Sign in to sync across devices". `supabase-js` is not downloaded until the user opens sign-in or a stored auth session exists.
- **SYNC-3** Sign-in: entering an email sends a magic link (Supabase OTP). The screen then says "Check your email. Open the link on this device, or type the 6-digit code here." Either the link (same browser) or the code signs in. Invalid email shows an inline error; rate limits show "Too many tries. Wait a minute and try again."
- **SYNC-4** No user-visible action waits on the network. With the network off, completing a session, editing tasks and changing settings behave exactly as when signed out; changes sync later.
- **SYNC-5** After a local write while signed in and online, the change reaches Supabase within 10 s (2 s debounce, 10 s max wait).
- **SYNC-6** Sync (push then pull) runs on sign-in, on app open, when the page becomes visible, on the browser `online` event, and from "Sync now" in Settings.
- **SYNC-7** First sign-in with existing local data: all local rows are pushed and all remote rows pulled; the result on every device is the union by id. Nothing is discarded. A session never appears twice. Rows with the same id resolve by last-write-wins (SYNC-8).
- **SYNC-8** Conflicts: for the same row edited on two devices, the version with the later `updatedAt` wins on both devices after they sync. On an exact tie, a deleted version wins.
- **SYNC-9** Deletes are soft (`deletedAt`) and propagate; a task deleted on one device disappears on the other after its next sync. Nothing is ever hard-deleted by the app.
- **SYNC-10** Row level security: a signed-in user can read and write only rows with their own `user_id`. Anonymous (not signed in) requests read and write nothing.
- **SYNC-11** Sign out stops syncing and keeps all local data on the device.
- **SYNC-12** Settings shows sync state: "Synced · 2 min ago", "Syncing", "Offline, will sync when back online", "Sync paused: sign in again" (expired auth) or "Couldn't sync. Retrying." plus "Sync now" and "Sign out". No sync messages appear outside Settings.
- **SYNC-13** Synced settings: preset, durations, long break interval, auto-start, daily goal, week start, break suggestions, encouraging messages. Device-only: theme, chime, volume, notifications, keep screen on, current task, timer state, milestone history, message bags.
- **SYNC-14** Default categories never duplicate across devices (fixed ids) and seeded defaults never overwrite customized ones (seeded rows carry `updatedAt = 0`).
- **SYNC-15** Pulling new rows updates every open screen without reload; pulled sessions do not trigger chimes, messages or milestones.

## 4. Edge cases

- **EDGE-1 Timer accuracy.** The engine never counts intervals. Running state stores `endsAt` (epoch ms). Remaining time is always `endsAt - now()`. The UI repaints with `requestAnimationFrame` while visible; phase end is scheduled with one `setTimeout(endsAt - now)` (a single, non-chained timer avoids Chrome's intensive throttling) and re-checked on `visibilitychange`, `focus`, `pageshow` and app start. If the app finds the phase already ended: the phase completes at `endsAt` (the session's `endedAt` is `endsAt`, not now). If it ended more than 60 s ago ("late"), the next phase is prepared idle even though auto-start is on, no chime plays and no notification is shown. If it ended within 60 s and auto-start is on, the next phase starts as of `endsAt`. Catch-up completes at most one phase, so a laptop asleep overnight never logs phantom sessions.
- **EDGE-2 No partial sessions.** Reset, Skip and mode-switch discard never log anything, regardless of elapsed time. Only focus phases that reach 00:00 are logged, always with `focusedMs = plannedMs`.
- **EDGE-3 Day rollover at 06:00.** A session's study day is the local date of its start time minus 6 hours. A 23:45 to 00:10 session, a 01:30 session and a 05:59 session all count for the evening's date; a 06:00 session starts the new day. "Today" on every screen does not roll over until 06:00. Sessions are never split across days.
- **EDGE-4 Time zone and DST.** Each session stores `day` (computed at log time in the then-local zone) and `tzOffsetMin`. Stats use stored `day`, so travel and syncing between devices in different zones never reshuffle history. "Today" is computed from current local time. The 6-hour shift is applied on the local wall clock (start hour below 6 means previous date), so DST nights behave the same as other nights. Day arithmetic uses calendar dates, not 24-hour offsets.
- **EDGE-5 Clock problems.** Sessions with `startedAt` more than 10 minutes in the future are kept but excluded from stats until their day arrives; import warns about them. A session whose `endedAt` is before `startedAt` is dropped on load, import and pull with a warning count. The server clamps any `updated_at` more than 10 minutes ahead of server time to server time, so one device with a fast clock cannot win every future conflict.
- **EDGE-6 Data loss safety.** Synchronous write on every change (DAT-1), flush on `pagehide`. Corrupt stored JSON is copied to a backup key and the app starts fresh with a banner offering a download of the damaged data (if signed in, the next pull restores synced rows). If storage is unavailable or full, a persistent banner says data is not being saved and offers Export. Export reminder (DAT-4). On iPhone, Settings recommends adding to the home screen, because Safari can clear website data after 7 days without use.
- **EDGE-7 Multiple tabs.** Session ids are derived from the device id and the phase start timestamp, so two tabs completing the same phase write one session locally and one row remotely. Tabs listen for the `storage` event and reload data and timer state when another tab writes. Sync is idempotent (upserts by id, last-write-wins), so two tabs syncing at the same time is harmless.
- **EDGE-8 Empty states.** Before any data: timer shows "No task" with a "Pick a task" ghost button; Tasks shows "Nothing here yet. Add what you're working on."; Stats shows every section's frame with zero values: goal ring "0 of 120 min", streak "0 days", week columns at baseline with "No focus time this week yet.", heatmap of empty cells with "Your first session will show up here.", trend axis frame with the same line. No fake or sample data.
- **EDGE-9 Deleted references.** Sessions referencing deleted tasks or categories keep their snapshot name (`taskName`) and render as "(deleted)" with a neutral swatch.
- **EDGE-10 Very long names.** Task names truncate with ellipsis in one line everywhere except the Tasks list (wraps to 2 lines). The full name is in `title` and in the table view.
- **EDGE-11 Two devices, both with unsynced history, first sign-in.** Device A signs in: pushes everything, pulls nothing new. Device B signs in: pushes everything, then pulls A's rows. Device A's next sync pulls B's rows. Result on both: union of sessions (ids never collide across devices), union of tasks and categories by id, default categories shared by fixed id, settings resolved by later `updatedAt` (seeded defaults have 0 and always lose). Same-looking tasks with different ids are both kept; the app never merges by name.
- **EDGE-12 Signing in to a different account than last time on this device.** Local data is merged into the new account (never discarded); the confirm step says "This device's data will be added to this account."
- **EDGE-13 Auth expiry or revoked session.** Sync pauses, Settings shows "Sync paused: sign in again", local use is unaffected, unsynced changes stay queued and push after the next sign-in.
- **EDGE-14 Sync failures.** Network or server errors retry with backoff (5 s, doubling, max 5 min). Rows the server rejects as invalid are logged to the console, dropped from the queue and counted in the Settings status ("1 change couldn't sync"). A sync never blocks or rolls back a local write.
- **EDGE-15 Settings edited on two devices.** Synced settings resolve as one object by later `updatedAt`; device-only settings never leave the device.

## 5. Out of scope for v1

Website blocking, social features, Spotify or any music integration, any AI, paid tiers, flow/count-up mode, ambient sounds, ticking sounds, pomodoro estimates and planned-vs-actual, first-open note, partial sessions, editing or deleting individual logged sessions, push notifications via a server, password or social login, realtime live updates between open devices (sync is trigger based), sharing data with other users, automatic dark mode, multiple languages.

Later candidates (not v1): ambient sounds, ticking, session edit/delete, realtime sync, a small personal first-open note.

## 6. Decisions

### 6a. Dathan's decisions (changed after review)

These replace earlier architect choices and are no longer open:

- **R-1 Supabase sync is in v1,** local-first, optional magic-link sign-in, supabase-js, RLS, client UUIDs, `updated_at`/`deleted_at` last-write-wins, triggers on sign-in, open/visibility, debounced after writes, reconnect.
- **R-2 Skip logs nothing.** No partial sessions anywhere. Only completed focus sessions count. (Replaces old D-4.)
- **R-3 Auto-start next phase is on by default.** (Replaces old D-16 default.)
- **R-4 Day rollover at 06:00:** a session's day is its start time minus 6 hours. (Replaces old D-6.)

### 6b. Decisions made for Dathan

**FLAGGED: these were not in Dathan's brief. Each is a choice the architect made and can be reversed.**

- **D-1 Streak rule:** a day counts if it has at least one logged focus session.
- **D-2 Moving average:** 7-day trailing mean, zero days included, needs 3 days of history, uses pre-range data at the left edge, excludes today (drawn as a hollow dot). Trailing because a centered average has no value for the last 3 days, exactly the part she will look at.
- **D-3 Smoothing curve:** monotone cubic (Fritsch-Carlson), not Catmull-Rom, because Catmull-Rom overshoots and can draw the line below zero or above real peaks.
- **D-5 Skip never auto-starts** the next phase, even with auto-start on.
- **D-6 Day start is fixed at 06:00 with no setting** (consequence of R-4; the earlier "Day starts at" setting is removed).
- **D-7 Sessions are attributed to their start day** and never split.
- **D-8 Credit goes to the task current when the session completes.**
- **D-9 Heatmap levels are relative to the daily goal** (0, under 25%, under 50%, under 100%, goal met). Changing the goal recolors history.
- **D-10 Heatmap is exactly 9 columns** (63 days) ending this week; future days not drawn. Five shades = level 0 (empty) plus 4 blues.
- **D-11 Heatmap shades are not all "light" blue.** To stay distinguishable (validated), levels run from pale to mid-deep blue.
- **D-12 Category colors** come from a fixed 8-swatch validated palette stored as slot numbers. No free color picker. Category color appears only as small dots and thin bars, so light blue remains the only UI accent.
- **D-13 Default category colors:** Study blue, Reading orange, Problem sets aqua, Writing yellow, Review magenta. Max 8 categories.
- **D-14 Week starts Monday** by default (setting: Monday or Sunday).
- **D-15 Preset long breaks:** 25/5/15, 50/10/30, 90/20/30, long break every 4 for all presets.
- **D-16 Auto-start is one toggle for both directions** (default on per R-3).
- **D-17 Double reset** (reset while idle at full focus) zeroes the cycle.
- **D-18 Mode switch mid-session** asks to discard if at least 60 s of focus elapsed.
- **D-19 Late catch-up:** a phase that ended more than 60 s before the app noticed completes silently and never chains, even with auto-start on.
- **D-20 Chimes are synthesized with Web Audio** (Glass, Bowl, Bell, Wood, None). Default Glass, volume 60.
- **D-21 Notifications only when the page is hidden;** visible page gets the chime only.
- **D-22 Keep screen awake while running** (Wake Lock), default on. Main mitigation for iPhone, where notifications cannot fire while locked.
- **D-23 Encouraging messages toggle** (default on) plus a `{sessions}` token used by 4 of the 40 lines.
- **D-24 Milestone messages** are written in Appendix C and live in the same data file.
- **D-25 Import offers Replace or Merge;** Merge keeps local settings.
- **D-26 Export reminder** after 10 sessions with no export, then every 14 days with new data, snooze 7 days, hidden while sync is healthy, never on the timer screen.
- **D-27 Local store is localStorage,** one JSON document under one key.
- **D-28 Hash routing** (`#/timer` etc.) so GitHub Pages needs no 404 fallback. Auth uses the PKCE flow so the magic-link callback arrives as `?code=` and does not collide with hash routes.
- **D-29 Update prompt, not auto-update,** and never while the timer runs.
- **D-30 Shortcuts beyond the minimum:** `1`/`2`/`3` and `?`.
- **D-31 Tab title format** `24:13 · Focus · Em Time`.
- **D-32 Inter Variable, self-hosted.**
- **D-33 Timer digits weight 300** with tabular numerals.
- **D-34 Erase all data** requires typing `erase`; signed in, it offers device-only or device-and-cloud.
- **D-35 No session editing in v1.**
- **D-36 Lighthouse 12+ has no PWA category,** so installability is checked through Chrome's DevTools protocol instead.

Sync decisions (new):

- **D-37 Composite primary key `(user_id, id)`** on every table, so fixed default-category ids can exist for every user.
- **D-38 Fixed UUIDs for the five default categories,** identical on every device.
- **D-39 Session ids are UUID-shaped and deterministic:** the device id with its last 12 hex digits replaced by the start timestamp in hex. Same phase in two tabs gives one id; two devices can never collide.
- **D-40 Seeded defaults (categories, settings) carry `updatedAt = 0`** so any real edit on any device wins.
- **D-41 Last-write-wins uses the client's `updatedAt` (epoch ms),** enforced in Postgres by a trigger that ignores older writes, lets a tombstone win ties, and clamps timestamps more than 10 minutes in the future.
- **D-42 Pull cursor is a server-set `server_updated_at`** per table, re-reading a 60 s overlap window to cover commit-order races.
- **D-43 Settings sync as one JSON object** (`settings.data jsonb`), only the synced keys in SYNC-13. Theme, sound, notifications, keep-awake, current task, timer, milestones and bags stay on the device.
- **D-44 Magic link plus 6-digit code.** iOS home-screen apps have storage separate from Safari, so a link opened from Mail cannot sign in the installed app; typing the code can. Dathan must add `{{ .Token }}` to the Supabase magic-link email template.
- **D-45 supabase-js is lazy-loaded** only when sync is configured and the user opens sign-in or already has a session, keeping the initial bundle under budget.
- **D-46 No realtime subscriptions;** trigger-based sync only. Push debounce 2 s, max wait 10 s; retry backoff 5 s doubling to 5 min.
- **D-47 Sign out keeps local data.**
- **D-48 A different account on the same device merges local data in** (EDGE-12).
- **D-49 No hard deletes:** no DELETE policy in RLS; deletion is always a tombstone.
- **D-50 Export reminder is suppressed while sync is healthy** (synced within 7 days).
- **D-51 Session drops `completed`;** `focusedMs` is kept and always equals `plannedMs`, so a future partial rule needs no schema change.
- **D-52 Real-project sync e2e test** needs a service role key in the test environment only, to fetch the sign-in code through the Supabase admin API. It is never part of the app build.

## 7. What success looks like

- She installs it on her laptop and phone in under a minute each and keeps using it after four weeks.
- No focus time is ever lost or double counted; the timer is within 1 s of the wall clock at every phase end.
- Signing in on a second device brings over all history within 30 s, and both devices agree after editing on each.
- With no Supabase configured, nothing is missing except the Sync card.
- Every acceptance criterion in section 3 passes in `tests/qa-report.md`.
- First load under 2 s on a mid-range phone over 4G; initial JS under 60 KB gzipped (sync chunk loaded separately); works offline.
- It looks like one calm, consistent thing in both themes at desktop and 390 px widths.

## Appendix A: Encouraging messages (use verbatim)

Lines 1 to 4 contain `{sessions}` (MSG-2).

1. {sessions} sessions in. Nicely done.
2. That's {sessions} today. Steady work.
3. {sessions} sessions down. You're building something.
4. {sessions} today. The pages add up.
5. One more session in the books.
6. That counted. Take your break.
7. Good focus. Let your eyes rest a minute.
8. Quietly getting it done.
9. You showed up. That's the hard part.
10. Small blocks, real progress.
11. Nice work. Breathe out.
12. That's a solid stretch of focus.
13. Your future self says thanks.
14. Done. Stand up, roll your shoulders.
15. Progress doesn't have to be loud.
16. Another block of real work.
17. You stayed with it. Well done.
18. Steady beats rushed.
19. That's time well spent.
20. Good session. Water's a good idea.
21. One step closer to finished.
22. Calm, focused, done.
23. You did what you sat down to do.
24. This is how big things get small.
25. Nicely done. The break is yours.
26. A little further than before.
27. Keep it gentle. Keep it going.
28. Well earned.
29. You're doing better than you think.
30. That's momentum.
31. Focus looks good on you.
32. Rest now. The work will keep.
33. Proud of that one.
34. Clear head, good work.
35. Every session counts, including this one.
36. That's one less thing hanging over you.
37. Slow and steady is still moving.
38. Good. Now go look out a window.
39. That was you, fully here.
40. Back at it when you're ready.

## Appendix B: Break prompts (use verbatim)

1. Look at something 20 feet away for 20 seconds.
2. Drink a glass of water.
3. Stand up and stretch your arms overhead.
4. Roll your shoulders back five times.
5. Take three slow breaths, longer out than in.
6. Walk to another room and back.
7. Unclench your jaw and drop your shoulders.
8. Refill your water or tea.
9. Open a window or step outside for some air.
10. Stretch your wrists and fingers.
11. Tidy one small thing on your desk.
12. Close your eyes for thirty seconds.

## Appendix C: Milestone messages (use verbatim)

- `sessions-10`: Ten sessions. A real habit is starting.
- `sessions-50`: Fifty sessions. That's a lot of focused hours.
- `sessions-100`: One hundred sessions. Remarkable consistency.
- `sessions-250`: Two hundred fifty sessions. Look how far you've come.
- `streak-7`: Seven days in a row. A full week of showing up.
- `streak-30`: Thirty days straight. That's a real rhythm.

---

## v2 Sky diary

Dathan reviewed v1 and found it too clean and minimal for a gift. v2 keeps every v1 behavior (timer engine, tasks, stats math, sync, export and import, shortcuts, PWA, reduced motion, 44 px targets, AA contrast) and replaces the look with "Sky diary": the whole screen is a sky that follows the real clock, a cloud friend mascot reacts to her sessions, personalized emoji stickers drift by and burst on completion, and greetings use her name. Visual spec: `design.md` (v2; v1 kept as `design-v1.md`). Interfaces: `contract.md` "v2 changes". Work orders: `tasks.md` v2 sections.

Testing convention for this section: "clock at HH:MM" means Playwright `page.clock.install({ time })` (or an injected `now` in unit tests) set to that local time today in `TZ=America/Los_Angeles`, theme "Follow the sky" unless stated. Keyframe ids and times: `latenight` 02:30, `dawn` 06:00, `morning` 08:30, `midday` 12:30, `afternoon` 16:00, `dusk` 18:30, `evening` 20:30, `night` 23:00.

### v2.1 Sky (SKY)

- **SKY-1** Every route renders the scene `[data-testid="sky"]`: fixed, covering the viewport, behind all content, `aria-hidden="true"`, `pointer-events: none`, no focusable descendants.
- **SKY-2** With the clock at each keyframe time, the computed `--sky-top`, `--sky-mid` and `--sky-horizon` on `<html>` equal the design.md 2.1 hex values (case-insensitive) and `html[data-sky-phase]` equals the keyframe id.
- **SKY-3** With the clock at 02:00: `data-sky-phase="latenight"`, `data-theme="dark"`, the moon is visible, the sun is not rendered, `--sky-star-opacity` is at least 0.9, and the greeting contains "night" (case-insensitive) and none of the banned words (NAME-5).
- **SKY-4** With the clock at 12:30: `data-sky-phase="midday"`, `data-theme="light"`, the sun is visible and its center x is between 45% and 55% of the viewport width, `--sky-star-opacity` is 0, the moon is not rendered.
- **SKY-5** Blending: at 10:30 (halfway between `morning` and `midday`), `--sky-top` equals the OKLab midpoint of `#6EB8F2` and `#4FA8EE` within 1 per RGB channel. The value at 10:10 differs from 10:00.
- **SKY-6** Cadence: with the clock running, the sky custom properties are rewritten once per minute (at most 2 writes in any 60 s window without a resize or visibility change), and once immediately when the page becomes visible.
- **SKY-7** Arcs: the sun is rendered only from 05:30 to 19:30 and the moon only from 19:00 to 06:30. At 06:00 the sun's center is within 15% of the viewport height from the top of the back hill. Neither body's bounding box enters the header band (viewport y 0 to 232 px at 1280, 0 to 132 px at 390) at any keyframe.
- **SKY-8** Scene elements: exactly 3 cloud elements; star count 28 at 1280 and 16 at 390; hills present.
- **SKY-9** Polarity: `data-theme="light"` from 05:15 through 16:59 and `"dark"` from 17:00 through 05:14 (checked at 05:14, 05:15, 16:59, 17:00).
- **SKY-10** Contrast, proven by a unit sweep: for each of the 1,440 minutes and for both fixed modes, every text and indicator pair in design.md section 12 passes (normal text 4.5:1, large on-sky text 3:1, focus indicator 3:1, heat-3 on chart cards 3:1, heat-1 on chart cards 2:1) when composited over the blended sky top, mid, horizon and both hill colors.
- **SKY-11** Contrast, in the browser: axe reports zero serious or critical violations on every screen at both widths with the clock at all 8 keyframe times plus 05:15, 16:59, 17:00 and 17:19.
- **SKY-12** Only large text sits on the sky: every visible text node whose nearest non-transparent background is the scene has a computed font size of at least 24 px, or at least 18.66 px at weight 700 or more.
- **SKY-13** Focus is visible at every keyframe: a focused button, link, input and segmented option each show the two-tone indicator (`outline` in `--em-focus-ring` plus the `--em-focus-halo` shadow).
- **SKY-14** `<meta name="theme-color">` equals the current `--sky-top` and updates with it.
- **SKY-15** Performance: no `<canvas>` element is attached to the document; with the page hidden, every running animation inside the scene, mascot and sticker layers reports `playState === 'paused'` and no sticker is added; on return they resume. Initial JS stays under 60 KB gzipped and CSS under 16 KB gzipped.
- **SKY-16** Reduced motion: with `prefers-reduced-motion: reduce`, no animation runs in the scene, mascot or sticker layers (`getAnimations()` empty or all finished), and no drifting sticker is ever added.

### v2.2 Cloud friend (MASCOT)

- **MASCOT-1** The mascot `[data-testid="mascot"]` is present on Timer at 390 and 1280 by default, is `aria-hidden`, has `pointer-events: none`, and its bounding box intersects no button, link, input or select on any screen at either width.
- **MASCOT-2** `data-state` is `idle` with the focus phase idle, `focusing` while a focus phase runs, `break` during short and long breaks, `celebrate` within 100 ms after a focus session completes (for 1.6 s, then `break`), and `wave` for 1.8 s after a streak milestone (streak-7, streak-30) and on the first app open of each study day.
- **MASCOT-3** Night alert: whenever `data-theme="dark"`, `data-accessory="headlamp"`; in `idle` and `focusing` the eye shapes are the wide-open variant. The mascot SVG contains no closed-eye state other than the blink, and no "Zzz" or sleep asset.
- **MASCOT-4** With "Cloud friend" off: no mascot element on any screen, and the Timer header at 390 lets the greeting use the full width (no empty slot).
- **MASCOT-5** With reduced motion, `data-state` still changes as in MASCOT-2 but no animation runs on the mascot.
- **MASCOT-6** The mascot carries no information: the accessibility tree of each screen is identical with the mascot on and off.

### v2.3 Stickers (STICKER)

- **STICKER-1** `frontend/src/data/stickers.json` validates against the contract schema; each emoji is a single grapheme (`Intl.Segmenter`); default pools and weights equal design.md 4.2.
- **STICKER-2** Drift cadence (fake clock, seeded random): the first sticker appears 20 to 40 s after load, then one every 45 to 90 s; never more than 3 on screen at 1280 or 2 at 390; while a focus phase runs, at most 1 on screen and spawns 120 to 240 s apart. Each drifting sticker is removed from the DOM when it finishes crossing.
- **STICKER-3** No repeats: across 500 seeded picks, no pick equals the previous pick, and no pick equals a sticker currently on screen.
- **STICKER-4** Weights: over 10,000 seeded picks at 23:00, the night pool's share is within 3 percentage points of its weight fraction; the makeup pool's share is at most 8% at every phase; the dawn pool is never picked at 12:30.
- **STICKER-5** Burst: when a focus session completes with the page visible, 12 sticker elements (9 at 390; 18 and 14 when a milestone fires too) appear in `[data-testid="sticker-burst"]` within 100 ms, centered on the ring bubble, and all are removed within 1.6 s. No burst after Skip, a break ending, a late catch-up completion, or a pulled sync session.
- **STICKER-6** With "Sky stickers" off: no drifting stickers and no burst; a milestone shows the v1 confetti (MIL-2) instead.
- **STICKER-7** While the page is hidden no sticker spawns, and no burst plays on return.
- **STICKER-8** Emoji the device cannot render are dropped at startup and never shown as a box (manual check on Windows 10 for 🫧 and ❤️‍🩹).

### v2.4 Display name and greeting (NAME)

- **NAME-1** Default `displayName` is "Em". With the clock at 14:00, the greeting `[data-testid="greeting"]` is one of the afternoon lines and ends with ", Em".
- **NAME-2** Changing "Your name" in Settings to "Emily" updates the greeting without reload, persists after reload, and (signed in) syncs to another device.
- **NAME-3** The name is trimmed and at most 24 characters (input `maxlength` 24; `updateSettings` throws `ValidationError('displayName', 'too-long')` beyond that). A blank name gives the greeting without a name and without a trailing comma ("Good afternoon").
- **NAME-4** The name is rendered as text: "<b>x</b>" displays literally.
- **NAME-5** Greeting rules (unit test over every line and every subline template): the window follows the real clock (dawn 04:30 to 06:59, morning 07:00 to 11:59, afternoon 12:00 to 16:59, evening 17:00 to 20:59, night 21:00 to 04:29); the variant is stable within a study day and window; every night line contains "night"; no greeting or subline contains late, sleep, sleepy, tired, bed, bedtime or exhausted (whole words, case-insensitive).
- **NAME-6** Subline `[data-testid="greeting-sub"]` follows design.md section 9 in priority order, e.g. with 3 sessions today and a 6-day streak it reads "3 sessions today · 6-day streak"; with 0 sessions and a 1-day streak "Keep your streak going"; with a 9-day streak and sessions today "9-day streak, look at you".

### v2.5 Theme setting (THEME)

- **THEME-1** Settings "Theme" offers "Follow the sky" (default), "Always light", "Always dark" (`data-testid` `settings-theme-sky`, `settings-theme-light`, `settings-theme-dark`; the group keeps `settings-theme`). The choice persists per device.
- **THEME-2** "Always light" with the clock at 02:00: `data-sky-phase="midday"`, `data-theme="light"`, the sun at its apex, while the greeting still uses a night line.
- **THEME-3** "Always dark" with the clock at 12:30: `data-sky-phase="night"`, `data-theme="dark"`, moon and stars visible, mascot `data-accessory="headlamp"`, while the greeting uses an afternoon line.
- **THEME-4** Migration: a v1 document or v1 export with `theme: 'light'` loads with `theme: 'sky'`; `'dark'` stays `'dark'`; a missing or unknown value becomes `'sky'`. Missing `displayName`, `mascot`, `stickers` get "Em", true, true. Nothing else changes.
- **THEME-5** Sync: `displayName` is in the pushed `settings.data`; `theme`, `mascot` and `stickers` never are.
- **THEME-6** "Cloud friend" and "Sky stickers" switches exist (`settings-mascot`, `settings-stickers`), default on, persist per device, and take effect without reload.

### v2.6 Changed v1 criteria

- **UI-1** replaced by THEME-1 to THEME-3 (Light/Dark toggle removed; light is no longer the default, the sky is).
- **UI-2** replaced by SKY-2 to SKY-9 (the four-period gradient is gone).
- **UI-3** unchanged, plus: the Play button is visible without scrolling at 390x844.
- **A11Y-1** now reads: all text meets WCAG 2.1 AA at every minute of the day in every theme mode (SKY-10, SKY-11); only large text sits directly on the sky (SKY-12).
- **A11Y-2** focus indicator is the two-tone ring (SKY-13).
- **TMR-16** the breathing glow is a halo around the glass ring bubble; reduced-motion rule unchanged.
- **MIL-2** with stickers on, the milestone celebration is the larger sticker burst (STICKER-5) plus the mascot (`celebrate`, then `wave` for streak milestones); with stickers off, v1 confetti. Reduced motion: message only, as v1, plus the static 3-sticker flash.
- **MIL-3** also clears any sticker burst the moment a focus phase starts.
- **SYNC-13** synced settings add `displayName`; device-only add `mascot`, `stickers` (theme stays device-only).
- **EDGE-8** copy unchanged; Tasks empty and Stats first run also show the decorative mascot.
- **PWA-1** icon is the cloud friend on light blue; manifest `theme_color` `#4FA8EE`, `background_color` `#8CC8F5`, description "Your little sky for focus."
- Section 5 "automatic dark mode" is now in scope as the sky; following the OS color scheme is still out of scope.

### v2.7 Decisions made for Dathan

**FLAGGED: none of these were in Dathan's brief. Each can be reversed.**

- **D-53 Keyframe times** are fixed clock times (02:30, 06:00, 08:30, 12:30, 16:00, 18:30, 20:30, 23:00) and the sun is up 05:30 to 19:30, moon 19:00 to 06:30, all year. No location and no seasonal sunrise: it never asks for location and always looks the same at the same hour.
- **D-54 Cards and charts snap** between a light and a dark set at 05:15 and 17:00 (600 ms cross-fade) while the sky itself blends continuously. Blending the cards too would push chart colors off their validated values and break contrast in twilight.
- **D-55 Dusk is dark.** From 17:00 the UI is in its dark set; the sky still glows pink and orange at the horizon until about 19:00.
- **D-56 Text on the open sky is limited to large headings at the top of the screen** (greeting, page titles, brand), with the ink flipping between navy and white per minute. Everything else sits on glass or cards: Stats section titles become glass labels and their subtitles move inside the cards.
- **D-57 Fixed modes:** "Always light" shows the 12:30 sky and "Always dark" the 23:00 sky. Greetings and sticker choices still follow the real clock.
- **D-58 v1 "light" becomes "Follow the sky"** on upgrade (schema version 2), because light was v1's default rather than a choice. "dark" is kept.
- **D-59 Name syncs, visuals do not:** `displayName` syncs across devices; theme, cloud friend and stickers are per device (e.g. a calmer phone at work).
- **D-60 Blank name allowed** (greeting without a name); maximum 24 characters.
- **D-61 The cloud friend also waves hello** on the first open of each study day, not only on streak milestones.
- **D-62 Night accessory:** always a headlamp at night; the star companion joins only on breaks and celebrations, to keep focus time calm.
- **D-63 Sticker cadence:** first after 20 to 40 s, then every 45 to 90 s, max 3 (2 on phone); during focus every 2 to 4 minutes and max 1.
- **D-64 Burst on every completed focus session,** not only milestones (bigger on milestones). It replaces confetti while stickers are on.
- **D-65 The moon shows the real lunar phase.**
- **D-66 Nunito Variable replaces Inter;** timer digits at weight 800 (Nunito figures are equal width, so no jitter).
- **D-67 iOS status bar is `black-translucent`** so the sky runs under the clock and battery icons. Trade-off: the white status icons are low contrast on the pale dawn sky.
- **D-68 Unsupported emoji are dropped** on each device by a startup check (Windows 10 cannot draw 🫧 or ❤️‍🩹).
- **D-69 Empty-state copy unchanged;** the mascot is added as decoration.
- **D-70 CSS budget raised** from 12 KB to 16 KB gzipped for the scene, mascot and glass styles.
- **D-71 Greeting lines and the subline rules** in design.md section 9 and Appendix D were written by the architect, including "Night shift focus" and "look at you".
- **D-72 Selected states get an inset blue edge** (light blue fills alone are too faint on glass to meet the 3:1 non-text rule).
- **D-73 Phone mascot sits in the header** beside the greeting rather than near the controls, so it can never cover Play.
- **D-74 Sticker weights** in design.md 4.2 (night pool heaviest from 20:30 to 02:30, girly pop heaviest in the afternoon, makeup about 3 to 7%).

## Appendix D: Sky greetings (use verbatim, `messages.json` key `sky.greetings`)

`{name}` is the display name; with a blank name, drop `", {name}"`.

- dawn (04:30 to 06:59): "Good morning, {name}" · "Sunrise session, {name}" · "Early bird, {name}"
- morning (07:00 to 11:59): "Good morning, {name}" · "Morning, {name}" · "Hello sunshine, {name}"
- afternoon (12:00 to 16:59): "Good afternoon, {name}" · "Afternoon, {name}" · "Hi there, {name}"
- evening (17:00 to 20:59): "Good evening, {name}" · "Evening, {name}" · "Golden hour, {name}"
- night (21:00 to 04:29): "Night owl session, {name}" · "Night shift focus, {name}" · "Starry night session, {name}"

Subline templates (`sky.subline`): "{n}-day streak, look at you" · "{k} sessions today · {n}-day streak" · "{k} session today · {n}-day streak" · "{k} sessions today" · "{k} session today" · "Keep your {n}-day streak going" · "Keep your streak going" · "Ready when you are".
