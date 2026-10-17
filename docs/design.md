# Em Time: Design Brief

Owner: frontend agent. Token names are fixed in `contract.md` section 8; this file gives values and rules. Every contrast figure below was computed (WCAG ratio), and the chart palettes were run through the dataviz skill's validator (`validate_palette.js`): category palette passes all gates in both modes, heatmap ramps pass the ordinal checks in both modes.

## 1. Feel

"Airy sky": near-white planes, one pale blue accent, soft shadows, lots of air. Nothing loud; the timer digits are the biggest thing on screen. Dark mode is "dark ice": deep navy surfaces, ice-blue accents. Theme is set by `data-theme="light|dark"` on `<html>`, chosen in Settings only (no `prefers-color-scheme` switching).

## 2. Color tokens

### 2.1 Light (default)

| Token | Hex | Use | Contrast note |
|---|---|---|---|
| `--em-bg` | `#F4F9FE` | page base (under gradient) | |
| `--em-surface` | `#FFFFFF` | cards, sheets, nav bar | |
| `--em-surface-sunk` | `#EEF3F8` | inputs, segmented track, table stripes | |
| `--em-border` | `rgba(19,32,47,0.08)` | hairline borders | |
| `--em-ink` | `#13202F` | primary text, timer digits | 16.5:1 on white |
| `--em-ink-2` | `#475569` | secondary text | 7.6:1 on white |
| `--em-ink-3` | `#5B6B82` | muted labels, axis text | 5.4:1 white, 4.7:1 on darkest gradient stop |
| `--em-accent` | `#8CC4F0` | primary button fill, selected pills, decoration | 1.9:1 on white: **never text** |
| `--em-accent-soft` | `#DCEEFC` | current-task highlight, goal ring track, hover wash | |
| `--em-accent-text` | `#1F6FB2` | the only blue allowed as text: links, active nav label, selected chip text | 5.3:1 white, 4.6:1 night stop |
| `--em-on-accent` | `#0F2236` | icon/text on `--em-accent` fills | 8.7:1 on accent |
| `--em-focus-ring` | `#1F6FB2` | 2px focus outline | 5.3:1 on white |
| `--em-ring-track` | `#E4EEF8` | timer ring track | |
| `--em-ring-fill` | `#7DB8EC` | timer ring progress | decorative, digits carry the value |
| `--em-ring-glow` | `rgba(125,184,236,0.35)` | breathing glow color | |
| `--em-danger` | `#B42318` | destructive text and buttons | 6.6:1 on white |
| `--em-danger-soft` | `#FDECEA` | error banner background | danger text 5.8:1 on it |
| `--em-grid` | `#E6EDF5` | chart gridlines (1px, solid) | |
| `--em-axis` | `#C9D5E3` | chart baseline | |
| `--em-scrim` | `rgba(19,32,47,0.32)` | dialog backdrop | |

### 2.2 Dark ice

| Token | Hex | Contrast note |
|---|---|---|
| `--em-bg` | `#0B1220` | |
| `--em-surface` | `#121B2B` | |
| `--em-surface-sunk` | `#0E1625` | |
| `--em-border` | `rgba(156,211,245,0.10)` | |
| `--em-ink` | `#E6EEF7` | 14.7:1 on surface |
| `--em-ink-2` | `#A9B8CC` | 8.6:1 |
| `--em-ink-3` | `#8394AB` | 5.0:1 on the lightest dark stop |
| `--em-accent` | `#9CD3F5` | 10.7:1 on surface (ice blue is legible as text in dark) |
| `--em-accent-soft` | `#1D3550` | |
| `--em-accent-text` | `#9CD3F5` | 7.8:1 on accent-soft |
| `--em-on-accent` | `#0B1220` | 11.6:1 on accent |
| `--em-focus-ring` | `#9CD3F5` | |
| `--em-ring-track` | `#1C2A40` | |
| `--em-ring-fill` | `#9CD3F5` | |
| `--em-ring-glow` | `rgba(156,211,245,0.30)` | |
| `--em-danger` | `#F4A6A0` | 8.9:1 on surface |
| `--em-danger-soft` | `#3A1E24` | |
| `--em-grid` | `#1E2A3D` | |
| `--em-axis` | `#2E3D55` | |
| `--em-scrim` | `rgba(0,0,0,0.55)` | |

### 2.3 Heatmap shades (sequential, one hue, validated)

| Level | Meaning (goal G) | Light | Dark |
|---|---|---|---|
| `--em-heat-0` | 0 min | `#EDF2F7` | `#1C2840` |
| `--em-heat-1` | under 25% of G | `#86B6EF` | `#2B5C8F` |
| `--em-heat-2` | 25% to under 50% | `#5598E7` | `#3F7FC2` |
| `--em-heat-3` | 50% to under 100% | `#2A78D6` | `#6AAEEA` |
| `--em-heat-4` | goal met | `#1C5CAB` | `#A8DAF8` |

Light: more is darker. Dark: more is brighter (anchor flips). Levels 1 to 4 pass the ordinal checks (monotone lightness, adjacent delta L >= 0.06, lightest step >= 2:1 on surface: 2.11:1 light, 2.49:1 dark). Level 1 against level 0 is 1.9:1 light and 2.1:1 dark, so "a little" never reads as "none". The softest blues in the brand were tested and rejected: `#CDE2FB` measured 1.3:1 on white.

### 2.4 Category palette (identity, 8 fixed slots, validated)

| Slot | Hue | Light | Dark |
|---|---|---|---|
| `--em-cat-1` | blue | `#2A78D6` | `#3987E5` |
| `--em-cat-2` | orange | `#EB6834` | `#D95926` |
| `--em-cat-3` | aqua | `#1BAF7A` | `#199E70` |
| `--em-cat-4` | yellow | `#EDA100` | `#C98500` |
| `--em-cat-5` | magenta | `#E87BA4` | `#D55181` |
| `--em-cat-6` | green | `#008300` | `#008300` |
| `--em-cat-7` | violet | `#6250D6` | `#9085E9` |
| `--em-cat-8` | red | `#E34948` | `#E66767` |

Validator: light worst adjacent CVD delta E 9.1, normal-vision 19.6; dark 8.4 and 19.3; all pass. Aqua, yellow, magenta are under 3:1 on white, so the relief rule applies: a category swatch is never shown without its name next to it (chips, legend, task rows, per-task bars, tooltips). Category color is used only for 8 to 10 px dots, 3 px chip edges and thin bars, never for text, backgrounds or buttons. Light blue stays the only UI accent.

### 2.5 Time-of-day gradient

Applied to `<body>` as `linear-gradient(180deg, var(--em-bg-grad-top), var(--em-bg-grad-bottom))`, fixed attachment, over `--em-bg`. JS sets the two variables once per minute. Between stops, colors are linearly interpolated in OKLab over the 60 minutes before each boundary (e.g. 08:00 to 09:00 blends dawn into day).

| Period | Local time | Light top / bottom | Dark top / bottom |
|---|---|---|---|
| Dawn | 05:00 to 08:59 | `#EEF5FC` / `#FBF8F6` | `#121B2E` / `#16182A` |
| Day | 09:00 to 16:59 | `#F4F9FE` / `#FFFFFF` | `#0F1A2C` / `#0B1220` |
| Dusk | 17:00 to 19:59 | `#EEF3F9` / `#F6F4F9` | `#141629` / `#1A1A2C` |
| Night | 20:00 to 04:59 | `#E8EFF9` / `#F2F6FB` | `#070D18` / `#0B1220` |

All text tokens pass 4.5:1 on every stop (lowest: `--em-accent-text` 4.57:1 on light night top). Do not darken any light stop below `#E8EFF9`.

## 3. Typography

- Family: Inter Variable, self-hosted via `@fontsource-variable/inter`, fallback `system-ui, -apple-system, "Segoe UI", sans-serif`. Token `--em-font-sans`.
- Weights: 300 (timer digits only), 400 body, 500 labels/buttons, 600 headings and stat values.

| Token | Size / line-height | Use |
|---|---|---|
| `--em-fs-xs` | 12 / 16 | axis ticks, captions, legend |
| `--em-fs-sm` | 14 / 20 | secondary text, table cells, tooltips |
| `--em-fs-md` | 16 / 24 | body, inputs, buttons |
| `--em-fs-lg` | 20 / 28 | section headings, task name under timer |
| `--em-fs-xl` | 24 / 32 | page titles |
| `--em-fs-stat` | 32 / 40 | stat tile values (streak, week total) |
| `--em-fs-timer` | `clamp(64px, 16vw, 112px)` / 1 | timer digits |

- Timer digits: weight 300, `font-variant-numeric: tabular-nums`, letter-spacing `-0.02em`. Tabular is a deliberate exception to the dataviz rule (proportional for big numbers): these digits change every second and must not jitter.
- Stat values and goal ring center: proportional figures, weight 600. Axis ticks and table number columns: `tabular-nums`.
- Sentence case everywhere. No all-caps labels, no trailing colons.

## 4. Spacing, radii, shadows

- Spacing scale (4 px base): `--em-space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 24, `-6` 32, `-7` 48, `-8` 64, `-9` 96.
- Page gutters: desktop 32, phone 16. Card padding: desktop 24, phone 16. Gap between cards: 24 desktop, 16 phone.
- Radii: `--em-radius-sm` 8 (inputs, chips), `--em-radius-md` 12 (buttons, tooltips), `--em-radius-lg` 20 (cards, sheets), `--em-radius-pill` 999.
- Shadows, light: `--em-shadow-sm` `0 1px 2px rgba(19,32,47,0.04), 0 1px 1px rgba(19,32,47,0.03)`; `--em-shadow-md` `0 4px 16px rgba(31,111,178,0.06), 0 1px 3px rgba(19,32,47,0.05)`; `--em-shadow-lg` `0 12px 40px rgba(31,111,178,0.08), 0 2px 6px rgba(19,32,47,0.05)`.
- Shadows, dark: `--em-shadow-sm` `0 1px 2px rgba(0,0,0,0.30)`; `--em-shadow-md` `0 6px 20px rgba(0,0,0,0.35)`; `--em-shadow-lg` `0 16px 48px rgba(0,0,0,0.45)`. Cards in dark also carry `1px solid var(--em-border)`.
- Cards use `--em-shadow-md`; dialogs and popovers `--em-shadow-lg`; nav bar `--em-shadow-sm`.

## 5. Motion

- Durations: `--em-dur-fast` 120ms (hover, press), `--em-dur-base` 200ms (view fades, toggles), `--em-dur-slow` 320ms (sheets, dialogs), `--em-dur-refill` 600ms (ring refill on reset/phase change), `--em-dur-breath` 4000ms (glow cycle).
- Easing: `--em-ease-standard` `cubic-bezier(0.2, 0, 0, 1)`; `--em-ease-in` `cubic-bezier(0.4, 0, 1, 1)` (exits); `--em-ease-breath` `cubic-bezier(0.45, 0, 0.55, 1)`.
- Ring progress is set every animation frame from engine time with no CSS transition (accuracy over smoothing). Refill on reset or phase change animates over 600ms.
- Breathing glow: only during a running focus phase; ring `filter: drop-shadow(0 0 Npx var(--em-ring-glow))` with N cycling 4 to 12 px and opacity 0.4 to 1. Paused: glow holds at minimum.
- Views cross-fade 200ms; no slides. Buttons scale to 0.97 on press.
- Confetti (milestones only): 36 particles max, sizes 4 to 7 px, colors `--em-heat-1..3` and `--em-accent`, fall from ring area, 1.2s, then removed from DOM.
- `prefers-reduced-motion: reduce`: no breathing, no refill animation, no confetti, no press scale; fades capped at 120ms. Gradient updates are instant either way (they change once per minute).

## 6. Navigation

- Hash routes: `#/timer` (default), `#/tasks`, `#/stats`, `#/settings`.
- Desktop (>= 900 px): top bar, 64 px tall, `--em-surface` at 80% opacity with backdrop blur 12 px. Left: ring glyph (20 px) and "Em Time" (fs-md, 600). Right: four text tabs with 16 px icons (Timer, Tasks, Stats, Settings). Active tab: `--em-accent-text` label and a 2 px `--em-accent` underline.
- Phone (< 900 px): fixed bottom tab bar, 64 px plus `env(safe-area-inset-bottom)`, four icon+label items (labels fs-xs), each at least 44x44. No top bar on phone; each page has its own title row.
- While a focus phase is running the nav dims to 50% opacity (full on hover/focus) to keep attention on the timer.
- Icons: inline SVG, 1.75 px stroke, round caps (Lucide-style shapes drawn in-repo; no icon font).

## 7. Screens

### 7.1 Timer (home)

Desktop (>= 900): two columns inside a 1120 px max container. Left (flex 1), vertically centered in the viewport below the top bar:
1. Mode switcher: segmented control, pills "Focus", "Short break", "Long break"; selected pill `--em-accent` fill with `--em-on-accent` text.
2. Ring: 360 px square SVG, stroke 6 px, round caps, starts at 12 o'clock, drains clockwise (remaining arc shrinks). Track `--em-ring-track`, fill `--em-ring-fill`.
3. Inside ring: digits (fs-timer), below them the current task name (fs-lg, `--em-ink-2`, one line, ellipsis, max 240 px) as a button with a small chevron; "Pick a task" ghost text when none. Below that, cycle dots (6 px, `longEvery` dots, filled `--em-ring-fill`, empty `--em-ring-track`).
4. Controls row 32 px below ring: Reset (48 px round ghost icon button), Play/Pause (72 px round, `--em-accent` fill, `--em-on-accent` icon, `--em-shadow-md`), Skip (48 px ghost). Tooltips show shortcut keys.
5. Message line under controls (fs-md, `--em-ink-2`, centered, max 480 px): encouragement or milestone text after a focus ends.
6. Break prompt card (breaks only): white card, radius lg, 16 px padding, small "Break idea" label (fs-xs, ink-3) and prompt text (fs-md).

Right column (360 px): "Today" card with a compact goal ring (72 px, stroke 8) beside "84 of 120 min" and "3 sessions", then an "Up next" list of up to 6 open tasks (radio-style select to make current, current row on `--em-accent-soft`), and an "All tasks" link.

Phone (< 900): single column, centered: mode switcher (full width, 3 equal pills), ring `min(78vw, 320px)` with 5 px stroke, digits and task name inside, controls row (Play 64 px), message line, break card. A compact "Today" strip (goal ring 40 px, minutes, sessions) sits above the bottom nav. No task list on this screen; the task name button opens a bottom sheet picker.

### 7.2 Tasks

Desktop: two columns. Left (2/3): page title, add-task row (text input, category select, "Add" button), open task list, collapsible "Done (n)" list with "Clear done". Right (1/3): "Categories" card listing categories (swatch button, editable name, delete icon) and "Add category".
Task row (56 px min): checkbox, category dot (10 px), name (wraps to 2 lines), this week's minutes (fs-sm ink-3, tabular), "Set as current" icon button (target glyph; filled when current), overflow menu (Rename, Change category, Delete). Current row: `--em-accent-soft` background and a "Current" chip (`--em-accent-text`).
Phone: single column; add-task row stacks (input full width, category select and Add on one row); categories behind a "Manage categories" button opening a bottom sheet. Swipe gestures are not used; all actions are in the overflow menu.
Swatch picker: popover with 8 circles (28 px, 44 px hit area), each labeled for screen readers ("Blue", "Orange"...), selected shows a check in `--em-surface`.

### 7.3 Stats

Desktop (max 1080 px, 12-column grid, gap 24):
1. Row of three tiles: Today (goal ring 120 px), Current streak, Best streak. Tiles are white cards, 24 px padding.
2. "This week" section (full width): header row with title, date range, prev/next arrows, "This week" button. Card: week columns (left 7 cols of grid) and per-task totals (right 5 cols), week total stat above the columns.
3. "Last 2 months" section: heatmap card (6 cols) beside a small text summary card (6 cols: active days in range, total time, best day, as three label/value rows).
4. "Trend" section (full width): header row with title and the 30 / 90 / 365 segmented toggle (left-aligned, above the card), then the trend card, 240 px plot height plus 28 px x-axis band.
Each section's controls sit in its own header row above its card, never inside the chart card, and scope only that section (dataviz filter rule, applied per section).
Phone: single column in this order: tiles (goal ring tile full width; streak tiles side by side), This week (columns, then per-task list below), Last 2 months, Trend (plot height 180 px).
Export reminder banner (DAT-4) sits at the top of Stats when due.

### 7.4 Settings

Single column of cards, max 640 px, centered on desktop, full width on phone. Sections in order:
1. Timer: preset segmented (25/5, 50/10, 90/20, Custom); custom steppers (focus, short, long, long break every) shown only for Custom; auto-start switch.
2. Daily goal: stepper (15 min steps), shows "2h".
3. Sound: chime radio list, each row with a Preview button; volume slider with value label.
4. Notifications: switch plus permission state line; iOS note (NTF-4); "Keep screen on while running" switch.
5. Break and messages: "Break suggestions" switch, "Encouraging messages" switch.
6. Appearance: Light / Dark segmented; "Week starts on" select (Monday, Sunday). Small note under it (fs-xs ink-3): "Days roll over at 6 AM, so late nights count for the evening."
7. Sync (only when sync is configured; hidden entirely otherwise). See 7.5.
8. Your data: "Last backup: ..." line, Export button (primary), Import button, "Install tip" line on iOS, "Erase all data" (danger text button, typed confirm dialog; when signed in, two radio options "This device only" and "This device and the cloud").
9. About: version, keyboard shortcuts list, a one-line dedication from `messages.json` key `aboutLine` (default "Made with care, for you."; Dathan edits it).

### 7.5 Sync card (Settings)

Quiet by design: no badges, no nav indicator, no banners. All sync copy lives in this card.
- Signed out: title "Sync", line "Sign in to sync across devices." (ink-2), email input (`autocomplete="email"`, `inputmode="email"`) and secondary button "Send sign-in link". Small print (fs-xs ink-3): "Optional. Em Time works fully without an account."
- Code sent: "Check your email. Open the link on this device, or type the 6-digit code here." Code input (`autocomplete="one-time-code"`, `inputmode="numeric"`, 6 digits, auto-submits on 6th digit), "Verify" button, "Use a different email" text link, "Send again" text link (disabled 60 s with countdown).
- Signed in: "Signed in as em@example.com" (ink), status row: 16 px icon plus text (ink-2), one of "Synced · 2 min ago" (check icon), "Syncing" (rotating arc icon, static under reduced motion), "Offline, will sync when back online" (cloud-off icon), "Couldn't sync. Retrying." (alert icon), "Sync paused: sign in again" (alert icon, shows the email form again prefilled). When `rejected > 0`, an extra fs-xs line "1 change couldn't sync". Buttons: "Sync now" (secondary), "Sign out" (text button). Sign-out confirm: "Sign out? Your data stays on this device."
- Status icons use ink colors only, never status colors alone; the text always carries the meaning.
- Errors appear inline under the relevant input (copy in contract.md section 6).

## 8. Charts (dataviz rules applied)

General: SVG, `viewBox` with width measured from the container (ResizeObserver), height fixed per chart including the axis band (no nested scroll). Gridlines 1 px solid `--em-grid`; baseline 1 px `--em-axis`; axis text fs-xs `--em-ink-3` tabular. All text uses ink tokens, never series colors. One shared tooltip component: `--em-surface`, radius md, `--em-shadow-lg`, 8x12 padding, value first (fs-sm 600 `--em-ink`), label second (fs-xs `--em-ink-3`); positioned to stay inside the viewport; also shown on keyboard focus. Insert labels with `textContent`. Every chart card has a "Show as table" text button (bottom right) that swaps the SVG for a `<table>` with identical values. Duration formatting everywhere: `formatDuration` (contract.md): `0m`, `45m`, `1h`, `1h 25m`.

### 8.1 Week columns (form: column chart, single series)

- 7 columns, one per day, label under each (Mon, Tue... fs-xs ink-3; today's label ink and 600).
- Column width `min(24px, band * 0.5)`, 4 px rounded top, square at baseline. All days use `--em-heat-3` (light 4.4:1 on white, dark 7.3:1); today uses `--em-heat-4` (emphasis form: today stands out, the rest is context). The day label carries the same emphasis, so it is not color alone. Zero days draw nothing above the baseline.
- Y scale 0 to nice max (step 30 min below 3h, 60 min above), 3 gridlines, tick labels formatted as durations. Plot height 160 desktop, 140 phone, plus 24 px x-axis band.
- Direct labels only on the tallest column and on today (value above the cap, fs-xs ink-2). Others via tooltip ("Tue, Oct 14 · 1h 25m · 3 sessions") and table.
- Hit target: full column band height and width. Hover lifts the column (opacity 0.85 on others).
- No legend (one series; the section title names it).
- Empty week: baseline and labels visible, centered caption "No focus time this week yet." (fs-sm ink-3).

### 8.2 Per-task totals (form: horizontal bars, identity by category)

- One row per task: name (fs-sm ink, ellipsis), duration at the bar end (fs-sm ink-2, tabular), bar 8 px tall, 4 px rounded end, square at the left baseline, color = category slot. Rows 32 px apart. Bars share one scale (max task = 100% of available width minus label column).
- Legend: when 2+ categories appear, a row of swatch + name pairs above the list (rect swatches 10 px). With 1 category, no legend.
- Fold rule: top 7 tasks, then "Other tasks" in `--em-ink-3` color bar. "No task" row uses `--em-axis` color. Deleted tasks: name + " (deleted)", neutral bar.
- Empty: list hidden, caption "Tasks you focus on this week will appear here."

### 8.3 Heatmap (form: calendar heatmap, sequential)

- Grid: 9 columns x 7 rows, row order follows `weekStartsOn`. Cells square, size `clamp(18px, (width - 32) / 9 - 4, 32px)`, 4 px gap (the surface gap), radius 4.
- Row labels at left for rows 1, 3, 5 (Mon, Wed, Fri when Monday-start), fs-xs ink-3. Month labels above the first column in which a month begins ("Sep", "Oct").
- Today's cell: 2 px `--em-ink-2` inset outline (shape cue, not color).
- Days are study days (06:00 to 06:00), so a 1 AM session colors the previous date's cell.
- Tooltip on hover, tap, or focus: value first ("1h 25m"), then date ("Tue, Oct 14"). Tapping elsewhere closes it on phone.
- Keyboard: grid container `role="grid"`, one tab stop, arrows move a roving focus, Home/End jump to first/last day.
- Scale legend under the grid, right-aligned: "Less" five 12 px squares "More", caption "Darkest: daily goal met" (fs-xs ink-3).
- Empty (no sessions ever): all cells level 0, caption "Your first session will show up here." centered under the grid.

### 8.4 Trend line (form: line over faint dots, single series)

- X: days in range (30/90/365), oldest left, today right. Ticks: 30d weekly at week starts ("Oct 6"); 90d at month starts plus mid-month; 365d at month starts ("Nov"), with the year on January ("Jan 2027"). Y: 0 to nice max of max(daily values, goal) with headroom 10%, 3 to 4 gridlines, duration labels.
- Dots: raw daily minutes, r 2 (30d), 1.75 (90d), 1.25 (365d), `--em-heat-1` fill at opacity 0.6, no ring. These are context texture, so they are below the 8 px marker rule on purpose; the line is the mark. Days before the first session draw no dot. Today: hollow dot r 4, 2 px `--em-heat-3` stroke, `--em-surface` fill, direct label "Today so far" only when hovered.
- Line: 7-day trailing average (spec TR-2), 2 px, `--em-heat-3` (light `#2A78D6`, 4.4:1 on white; dark `#6AAEEA`, 7.3:1 on surface), round join and cap. Under it an area wash of the same color at 10% opacity down to the baseline.
- Curve: monotone cubic interpolation (Fritsch-Carlson, equivalent to d3 `curveMonotoneX`), built as one SVG `path` of `C` segments from the non-null average points. Null gaps break the path into separate subpaths (`M` restarts). Monotone is required: it never overshoots below zero or above neighbor values, which Catmull-Rom does.
- End label: the latest average value at the line's right end ("Avg 58m", fs-xs ink-2), the only direct label.
- Goal line: 1 px solid `--em-ink-3` at 40% opacity across the plot, label "Goal" at the right end above it (fs-xs ink-3). Solid, not dashed.
- Interaction: vertical 1 px `--em-axis` crosshair snapping to the nearest day; a 4 px dot at the average point (2 px surface ring); tooltip "1h 10m" (day total), "7-day avg 58m", "Tue, Oct 14". The hit layer is the whole plot rect. Keyboard: chart is focusable, Left/Right move one day, Home/End.
- No legend (one series; section title "Trend" and subtitle "Daily focus, 7-day average" name it).
- Range toggle change: hold the previous render at 50% opacity until the new path is computed (synchronous in practice, so this is a no-flash guarantee, not a loader).
- Empty (fewer than 1 session in range): axes and goal line visible, caption "Your first session will show up here." centered. Fewer than 3 days of data: dots only, caption "The average line appears after 3 days."

### 8.5 Goal ring (form: meter)

- SVG ring, sizes 120 px (Stats), 72 px (desktop Today card), 40 px (phone strip). Stroke 10 / 8 / 5 px. Track `--em-accent-soft` (lighter step of the same hue: meter rule), fill `--em-ring-fill`, round caps, starts at 12 o'clock, fills clockwise.
- Center (120 and 72 sizes): minutes value (proportional, 600, fs-stat at 120, fs-lg at 72) and "of 120 min" (fs-xs ink-3). At 40 px no center text; the value sits to the right.
- Met: full ring, 14 px check icon in `--em-accent-text` replaces "of 120 min" with "Goal met".
- `role="img"`, `aria-label="84 of 120 minutes today, 70 percent of goal"`.

### 8.6 Streak tiles (form: stat tile)

- Label (fs-sm ink-2): "Current streak", "Best streak". Value (fs-stat 600, proportional): "5 days" ("1 day", "0 days"). Optional note (fs-xs ink-3): "Today's not counted yet". No sparkline, no color.

## 9. Accessibility baseline

- Light blue usage: `--em-accent` and `--em-ring-fill` are fills and decoration only in light mode (under 2:1 on white). Blue text is always `--em-accent-text`. Selected pills put `--em-on-accent` text on `--em-accent`. In dark mode `--em-accent` passes as text, but use `--em-accent-text` anyway so the rule is the same in both themes.
- Timer ring is `aria-hidden`; the digits element has `role="timer"` with `aria-live="off"` and an `aria-label` updated once per minute ("24 minutes left, focus"). A separate visually hidden `aria-live="polite"` region announces: "Focus started", "Paused", "Resumed", "Focus done. Short break", and remaining time at 20, 15, 10, 5 and 1 minutes left. Never more than one time announcement per 60 s.
- Focus ring: `outline: 2px solid var(--em-focus-ring); outline-offset: 2px` on `:focus-visible`, never removed. On `--em-accent` fills the offset keeps the ring on the background.
- Keyboard: all actions reachable with Tab; dialogs trap focus and return it on close; Escape closes popovers, sheets, dialogs; segmented controls are radio groups with arrow keys; switches use `role="switch"`.
- Touch targets 44x44 minimum on phone. Hit areas for chart marks at least 24 px.
- Forms have visible labels. Errors are text, not color alone, and linked via `aria-describedby`.
- `forced-colors: active`: ring, bars and cells use `CanvasText`/`Highlight`; heatmap levels add a level number to the tooltip and table (already there).
- Chart tables (A11Y-4) are real `<table>` elements with `<caption>` and `<th scope>`.

## 10. Empty, loading, error states

- Loading: none visible. localStorage reads are synchronous, so the app renders complete on first paint. The HTML shell has `--em-bg` and the ring glyph centered (inline CSS) for the moment before JS runs.
- Empty: spec EDGE-8 copy. Empty states keep the real layout and frames; no illustrations, no sample data.
- Errors (banner component: full-width card at top of the current page, `--em-danger-soft` bg, `--em-danger` icon, `--em-ink` text, action button):
  - Storage unavailable/full: "Em Time can't save on this device right now. Export to keep a copy." [Export]
  - Corrupt data recovered: "Saved data couldn't be read, so Em Time started fresh. Your old data is kept as a file you can download." [Download] [Dismiss]
  - Import errors: inline under the Import button, not a banner (copy in contract.md section 6).
  - Notifications blocked: info line in Settings only, not an error banner.
  - Sync problems: never a banner; shown only in the Sync card (7.5). Pulled data simply appears; no toast.
- Update ready (PWA-3): small pill at bottom center above nav, `--em-surface`, "Update ready" + "Refresh" link in `--em-accent-text`.

## 11. PWA

- Manifest (generated by vite-plugin-pwa): `name` "Em Time", `short_name` "Em Time", `description` "A calm focus timer.", `start_url` "./#/timer", `scope` "./", `display` "standalone", `orientation` "any", `background_color` `#F4F9FE`, `theme_color` `#F4F9FE`, icons listed below with `purpose` "any" and a separate "maskable" entry.
- `<meta name="theme-color">` is updated at runtime to `#F4F9FE` (light) or `#0B1220` (dark).
- Icon: `frontend/public/icon.svg`, 512 viewBox. Background `#F4F9FE` full bleed. Track circle r 150, stroke 36, `#DCEEFC`. Progress arc on top, same radius and stroke, `#7DB8EC`, round caps, covering 300 degrees starting at 12 o'clock clockwise (open gap at upper left). Nothing else. All content within the central 80% (maskable safe zone).
- Raster sizes generated at build by `@vite-pwa/assets-generator` from `icon.svg`: `favicon.ico` (48), `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png` (opaque background). `favicon.svg` is the same SVG.
- iOS tags in `index.html`: `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="default">`, `<meta name="apple-mobile-web-app-title" content="Em Time">`, `<link rel="apple-touch-icon" href="apple-touch-icon-180x180.png">`, viewport `width=device-width, initial-scale=1, viewport-fit=cover`. Layout pads with `env(safe-area-inset-*)`.
- Title tag "Em Time". All hrefs relative or from `import.meta.env.BASE_URL`.
