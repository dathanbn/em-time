# Em Time QA report

- Date: 2026-10-17 (v3 run; fix round 2026-10-16, first v2 run 2026-10-15)
- Commit: none (the folder is not a git repository)
- Environment: Linux sandbox, Node 22, Chromium via Playwright (default resolution; locally a symlink shim to the installed 1194 browser under `PLAYWRIGHT_BROWSERS_PATH`, see How to run), TZ America/Los_Angeles, Playwright against `npm run preview` of the `VITE_E2E=1` production build
- Projects: `desktop` 1280x800, `mobile` 390x844 (Pixel 7 emulation, touch)
- Sections: **v2 "Sky diary" (this round, first)**, then the v1 history unchanged below the divider

# v2 "Sky diary"

## v3 (sync code sign-in, Doodle Cloud, phone Timer layout)

Run exactly as documented: `npm run lint`, `npm run typecheck`, `npx vitest run`, `VITE_E2E=1 npm run build`, `npx playwright test`; screenshots regenerated (120 in `tests/screenshots/v2/`).

| Check | Result |
|---|---|
| Lint, typecheck | clean |
| Unit | 658 / 658 (27 files); was 625 with 24 failing against the old auth API |
| Build | OK. Initial JS 58.8 KB gzipped (budget 60, 1.2 KB left), CSS 10.7 KB (budget 16) |
| E2E | **828 pass, 0 fail, 40 skipped** (868 runs, 18.7 min). Real project sync NOT RUN (no service key, proxy blocks supabase.co) |

No real failures in this run. The Timer ring-jump defect from the simplification round is fixed (new test below proves it).

### Unit tests

- `tests/unit/syncHarness.ts`: the in-memory server now speaks `signInWithPassword` and `signUp` (accounts, a Confirm email switch, `confirmed` set, a log of auth calls); `Device.signIn(code)` goes through `engine.signInWithCode`. QA-side `normalizeCode`, `syncEmail`, `syncPassword` (node:crypto SHA-256) are independent references. The 24 failing tests in `sync.test.ts` and `migration.v2.test.ts` pass after replacing the example email addresses with sync codes (they were invalid codes now: `@` is not allowed).
- New `tests/unit/syncCode.qa.test.ts` (19): normalization (case, spaces to dashes, empty, 7 vs 8, 64 vs 65, invalid characters, agrees with the reference), derived credentials deterministic and equal to the independent derivation, same for any casing and spacing, different codes differ; sign in an existing account (one request, no sign-up), sign up a new one, `confirm_email_on` when `signUp` returns a user with no session, `confirm_email_on` for an existing unconfirmed account (no second sign-up), validation errors return before any request, the same code on two devices is one account and the data meets; the derived address, the `dathanbn.github.io` domain, the password and the code never appear in AppData or in an export, and `meta.sync.email` and `SyncState.email` are null.

### E2E

| Area | Tests |
|---|---|
| Sync card (`sync.spec`, build with fake Supabase env, mocked network) | one `Sync code` field and "Link this device"; short code gives "Use at least 8 characters." with no request, `aria-invalid`, cleared by typing; `@` and 65 characters rejected inline with no request; new code makes two requests (password grant rejected, then sign-up) with `blue-sky-morning-42@dathanbn.github.io` and a 64-hex password, shows "Linked", status line, Sync now, nothing derived stored, Sign out dialog returns to the form and clears `em-time:auth`; existing account makes one request; Confirm email on shows the hint and stays signed out; network failure keeps the code in the field; labelled, keyboard operable; no email or OTP wording in the card in either state and no `/otp` or `/verify` request |
| Phone Timer (`diary.spec`, "Timer layout v3") | mode pill above the ring and below the greeting, each option at least 44 px; greeting top at least 20 px from the viewport top (390 and 360); no stats text and no visible `today-goal`/`today-ring`, before and after a completion; Play above the fold at 390x844 and clear of the nav; page does not scroll; ring, Play and mode pill within 2 px across idle, running, celebrate, break with the idea card, and break paused |
| Mascot (`mascot.spec`) | empty Tasks and Stats mascots have `data-state="shrug"`, `data-accessory="none"` (also at night), `aria-hidden`; hidden when the mascot setting is off; a whole session only shows states from the Doodle Cloud set and visits wave, idle, focusing, celebrate, break; viewBox 160x140, box ratio 0.875, no `<text>`. `thumbs` is implemented but not wired to the state machine (HANDOFF), so there is nothing to drive in a browser; it is not tested |
| Changed | `first-run` no longer looks for the email field; `sync.real.spec` uses the code flow (still skipped without keys); the signed-in screenshot stores no address; `boot` has a `freeze` option for the time-boxed wave |

### Visual review (looked at: `timer-idle-390-midday`, `timer-celebrate-390-night`, `timer-empty-1280-midday`, `settings-390-midday`, `sync-signed-in-1280-midday`)

Better: the phone Timer reads cleanly (greeting 74 px down, pill above the ring, ring centred, Play above the fold, no stats), the Doodle Cloud has a clear outline and personality in both polarities, the Sync card is a single field with plain copy and the Linked state is calm. Remaining notes, all frontend and cosmetic:

1. Celebrate and break on the phone at night (`timer-celebrate-390-night`): the break idea card runs under the tab bar when the idea wraps to two lines, so its last line is cut ("air." half hidden). The ring no longer moves, but the reserved band is too short for message plus a two-line card.
2. In the same shot the moon sits behind the message pill and the card top; it reads as a smudge there.
3. On the phone the sun glows behind the mode pill at midday; the pill text stays readable but the sun rays collide with its bottom edge.
4. Faint lighter square corners behind the rounded phone tab bar remain (seen since the first review).
5. The Doodle Cloud's small arm and leg strokes at 112 px wide are thin next to the heavy ring; fine, noted for a real device look.
6. Settings on the phone is a very long page, with Sync sitting between Appearance and Your data; the mocked signed-in desktop card shows a trailing "Sync now" and "Sign out" row that is tidy.

### Manual checklist additions (real devices)

1. Link a real phone and a real laptop with one sync code on the live Supabase project (Confirm email must be OFF): enter the same code on both, complete a session on one, press Sync now on the other, see it. Check nothing ever asks for an email or sends one.
2. Type the code with different casing and spacing on the second device and confirm it still links.
3. Enter a code that is too short and one with an `@`: both give an inline message and nothing happens.
4. Phone at night: complete a session with a two-line break idea and look at whether the card is cut off by the tab bar (visual note 1).

## Timer simplification

Frontend change (HANDOFF.md, "Timer simplification"): the phone Timer shows no stats; the greeting chip is gone at both widths; on the phone the Focus / Short / Long control moved to the bottom above the tab bar; desktop keeps the Today and Up next cards. Run as documented (lint, typecheck, `npx vitest run`, `VITE_E2E=1 npm run build`, `npx playwright test`), screenshots regenerated (116 in `tests/screenshots/v2/`).

| Check | Result |
|---|---|
| Lint, typecheck | clean |
| Unit | 625 / 625 |
| Build | OK, JS 56.9 KB, CSS 10.5 KB gzipped |
| E2E | full run: 796 pass, 6 fail, 38 skipped (840). Five of the six were my own `today-goal` count assertions (the desktop card is still in the DOM at phone width but hidden, so they now ask for zero visible ones); fixed and re-run green. With those fixed and one new test added: 801 pass, 2 fail, 39 skipped (842) |

**Remaining failures (2 mobile runs, 1 real defect, owner frontend):** on the phone Timer the ring jumps up 88 px (bubble centre 348 to 260 px, Play 510 to 421 px) when a focus session completes, because the message line and the break idea card are added to the vertically centred column. The sticker burst is placed at the old bubble centre (348 px), so it sits 75 px below the bubble; the STICKER-5 centring test fails on it, and the new diary test "the bubble and Play do not jump when a session completes" fails with the same cause. Fix: reserve space for the message and break card (or anchor the ring from the top), or measure the burst origin after layout settles. Files: `frontend/src/screens/Timer.tsx`, `styles/screens.css` (`.timerpage__mid`), `platform/stickers.ts` (origin). The break card also pushes the mode switch against the tab bar, with no gap, in the break state (`timer-break-390-*`).

### Test changes

| Test | Change |
|---|---|
| diary NAME-6 | the five subline-text tests are replaced by: no `greeting-sub` and no streak or session text beside the greeting at both widths; phone Timer has no stats text, no minutes and no visible `today-goal` or `today-ring`, before and after a completion; desktop keeps the Today card (75 of 120 min) and Up next |
| diary (new) | phone: every mode option is above the tab bar and below the bubble and Play; Play is above the fold and clears the tab bar at 390x844; the page does not scroll; bubble and Play do not shift when a session completes (fails, see defect) |
| first-run TMR-1, timer TMR-3, TMR-6, stats GOAL-1 | phone: no visible Today strip; desktop: card figures as before |
| stats GOAL-3 | skipped on the phone (the phone Today strip is gone) |
| sky SKY-2, diary text-overlap selectors | `greeting-sub` removed from the selectors and the sky test now expects none |

### Spec criteria superseded by the simplification (not defects)

- **NAME-6** (subline `greeting-sub` and its priority rules): superseded, no subline exists. `sky.subline` templates are now unused UI; the unit tests on them still pass and stay as dormant coverage.
- **GOAL-3** (compact goal ring and minutes on the Timer): holds on desktop only; superseded on the phone.
- **TMR-1 / EDGE-8** "zeroed Today": desktop card only.
- v2 UI-3 "Play above the fold at 390x844": still holds and is now asserted with the mode switch below Play.

### Timer screenshots (looked at: `timer-idle-390-midday`, `timer-running-390-night`, `timer-break-390-night`, `timer-idle-1280-midday`)

Phone idle and running are clean: greeting and mascot on top, the ring centred, Play at 1088 of 1688 px (above the fold), the mode switch at the bottom just above the tab bar, no stats. Visual notes (frontend, cosmetic): about 250 px of empty sky between Play and the mode switch while idle (the moon sits in that gap at night); the shift in the break state described above; at 1280 the greeting and the mode switch now sit tight under each other and the small companion mascot floats on the left of the ring over the clouds.

## Fix round re-run

Run exactly as documented: `npm run lint`, `npm run typecheck`, `npx vitest run`, `VITE_E2E=1 npm run build`, `npx playwright test`; screenshots regenerated by that run (116 images).

| Check | Result |
|---|---|
| Lint, typecheck | clean |
| Unit | 625 pass, 0 fail (25 files); was 624 / 1 |
| Build | OK. Initial JS 56.9 KB gzipped (budget 60), CSS 10.6 KB (budget 16) |
| E2E | 813 pass, 3 fail, 34 skipped (850 runs); was 778 / 18 / 34. The full run itself showed 812 / 4 / 34. The fourth failure was `layout.spec` "tasks fits the width" on desktop, flaky under load (see below); fixed and the Layout, Stickers, Tasks and Settings desktop specs re-ran 84 / 0 |
| Real-project sync | NOT RUN (unchanged) |

Verified fixed: DAT-3 and DAT-5 (dialogs portal to the body, 14 runs), SKY-13 and A11Y-2 (button halo, 4 runs), STICKER-4 (makeup 0.5).

### Test updates for documented changes (no assertion loosened for a defect)

| Test | Change |
|---|---|
| `sky.test`, `sky.spec` THEME-3, screenshots | "Always dark" pins 02:30 (phase `latenight`, top `#070D22`), was 23:00 |
| `stickers.test` | makeup weight 0.5 in midday, afternoon, dusk, evening; pools from design.md 4.2 (study +🔬 ⚗️ 🧫 📝, medicine -🧠 🧪 ✏️) |
| `stickers.spec` (new) | each burst sticker starts at the bubble rim (+-2 px) and lands 10 to 80 px outside it (clamped to the viewport); once landed no sticker covers the digits or the task name |
| `diary.spec` SKY-13 | the Add-task case now types a name (the button is disabled when empty) and uses Tab, because script focus does not match `:focus-visible`. This was a test artefact; the Reset, Skip and Play halo defect was real and is fixed |
| `diary.spec` (new) | dialogs opened from a Settings card are outside the card (DAT-3, DAT-5 regression) |
| `settings.spec` DAT-3 v0 | `schemaVersion` 2, stale after the schema bump |
| `layout.spec` offenders check | an element clipped by an ancestor with `overflow: hidden` that itself fits the viewport is no longer listed. Reason: the sun glow sits in `.scene` (overflow hidden by design, scene.css:6) and showed `right=1087` at 1024 wide in one loaded run. Scroll width is still asserted separately and still passes |
| `screenshots.spec` (new) | live captures after about 2 s of real time: Timer at 12:30, 02:30 and 23:00 (`live-timer-*`); a drifting sticker on screen at 12:30 and 23:00 (`live-sticker-*`, waits up to 60 s); Settings Import and Erase dialogs (`settings-import-dialog-*`, `settings-erase-dialog-*`) |

### Remaining failures (3 runs, 2 real defects, both owner: frontend)

| # | Defect | Criteria | File |
|---|---|---|---|
| 1 | (title ids fixed in the final run; the same collision remains for form field ids, see Final) **Stacked dialogs share one title id, so the top dialog gets the wrong accessible name.** Opening Delete category on the phone stacks "Delete Study?" on the Categories sheet; both have `aria-labelledby="P0-0"`, two elements carry `id="P0-0"` ("Categories", "Delete Study?"), and `getByRole('dialog', { name: 'Delete Study?' })` finds nothing (a screen reader announces "Categories"). The delete dialog itself renders correctly (label "Move its tasks to", 4 options). 2 mobile runs fail: TSK-6 rename/recolor/delete and TSK-6 "never offers the category being deleted". Not loosened | TSK-6 | `frontend/src/components/Dialog.tsx` (the per-render counter restarts per mount; use a module-level counter or `useId`) |
| 2 | (fixed in the final run) **Burst stickers overflow the phone viewport at peak spread.** At 390x844, seed 3, 12:30: 4 of 12 stickers have their boxes 6 to 16 px beyond the left or right edge (right -16, -14, -9; left -6). The landing clamp is 24 px from the edge but a sticker is 42 to 51 px wide at peak scale. 1 mobile run fails (STICKER-5 "stays inside the viewport at its peak spread"). Not loosened | STICKER-5 | `frontend/src/platform/stickers.ts` `place()` (clamp by half the sticker size at peak scale, about 28 px, or 30 px) |

### Remaining visual notes (owner: frontend, all cosmetic)

Looked at with Read: `live-timer-*` (390 midday, latenight), `live-sticker-*` (390 midday, night), `timer-celebrate-390-midday`, `timer-celebrate-1280-night`, `settings-erase-dialog-390-night`, `settings-import-dialog-1280-midday`, `stats-fixture-1280-latenight`, `stats-empty-1280-midday`.

Confirmed fixed from the first review: Goal label no longer touches the end marker; the empty-week mascot sits beside its caption; the tab bar no longer shows text between its labels; dialogs sit centred over a blurred page.

1. The phone moon (night, `live-timer-390-*`) rises behind the Stats card: its top is cut by the card edge and it looks like it is peeking out from under it. Apex at horizon-56 puts it just under the card on a 844 px screen.
2. Faint lighter square corners show behind the rounded phone tab bar (bottom left and right, midday). Looks like the backdrop-filter layer is rectangular while the bar is rounded.
3. On the 1280 Stats page at night the moon sits half over the bottom edge of the Current streak card. The "Avg 57m" label on the trend chart overlaps the line near its right end.
4. Burst captures: during the 1.4 s a sticker covers part of the "Short break" tab label at 1280 and the Reset and Skip buttons at 390 (by design, STICKER-5), and two stickers touch the right edge at 390 (defect 2).
5. The "Close" tooltip shows on the dialog Close button as soon as the dialog opens (focus lands on it), which reads as noise in `settings-import-dialog-1280-midday`.
6. The midday sun sits half behind the timer bubble at 390 and its top ring looks cut. Acceptable, noted.
7. In the live night capture the first drifting sticker appears at the far right edge, partly clipped (it is entering). Fine.

### Manual checklist for Dathan after the fix round (real devices)

1. Watch the sky change across a real day: morning, midday, dusk (the 17:00 flip), evening, and after midnight. Cards and chart colours should cross-fade, with no flash.
2. Check the moon on the phone at night: with the Stats card gone from the Timer it sits in the gap above the mode switch; confirm it is not cut off.
3. Complete a real 25 minute session and confirm the burst: stickers start at the bubble, land beside it, and none covers the time after landing; nothing is clipped at the screen edge; the ring must not jump when the message and break idea appear (Timer simplification defect).
4. Confirm the name setting syncs: rename on the laptop while signed in, press Sync now, see the new greeting on the phone (NAME-2).
5. Always dark at midday: the sky should be the deep 02:30 night with the headlamp mascot.
6. Import a backup (Replace and Merge) and Erase on the phone and the laptop; dialogs should be centred and fully tappable.
7. On the phone, open Categories, then Delete on one: confirm VoiceOver reads "Delete Study?" (defect 1).
8. Carry over from the v2 list: iPhone home-screen app at night (status bar follows the sky), Windows 10 emoji (STICKER-8), and the feel check during a focus session.

### Final (2026-10-16, after the dialog id and burst clamp fixes)

Lint, typecheck clean. Unit 625/625. Build OK (JS 57.0 KB, CSS 10.6 KB). E2E full run: 812 pass, 4 fail, 34 skipped; after three test-side fixes and targeted re-runs (mascot x3 repeats all pass, stickers, layout), 814 pass, 2 fail, 34 skipped. Verified fixed: dialog title ids are unique (`dialog-title-N`, "Delete Study?" is found by name), burst stickers stay inside the phone viewport (STICKER-5 passes).

Test changes in this run (documented behaviour, nothing loosened for a defect): the burst-rim test now measures the clamp at the animation end point (1.1x offset, 34 px from the edge, never nearer than 8 px), because the product now clamps there; the first-open wave test freezes the fake clock (`boot` option `freeze`) because the 1.8 s wave could expire while a loaded machine opened the page.

**Remaining failures (2 mobile runs, owner frontend):** the same id-collision class, now in form fields. The Delete category dialog's `<label for="P0-0">Move its tasks to</label><select id="P0-0">` shares `P0-0` with another element in the Categories sheet underneath (2 elements with that id), so the label resolves to the wrong control: `getByLabel('Move its tasks to')` finds nothing, and clicking that label would focus the other field. TSK-6 "rename, recolor, delete" and TSK-6 "never offers the category being deleted" fail on it. Fix: ids from `useId` repeat across the separate dialog roots; use the same global counter that `Dialog.tsx` now uses for titles (the `Field` component's id source). One TSK-6 mobile run also failed once under load on the rename step (value reverted after `fill('')`); it passes in isolation and is not counted as a defect.

## v2 summary (first v2 run; current state is the Fix round re-run block above)

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| Unit (`npx vitest run`) | first v2 run: 624 pass, 1 fail (STICKER-4); fix round: 625 pass |
| Build (`VITE_E2E=1 npm run build`) | OK. Initial JS 56.8 KB gzipped (budget 60), CSS 10.5 KB gzipped (budget 16); SW precache 23 entries, 289.22 KiB |
| E2E (`npx playwright test`) | 778 pass, 18 fail, 34 skipped (830 runs, 15.3 min, 3 workers). v1 final was 421 / 0 / 17 of 438 |
| Real-project sync | NOT RUN (no service-role key; supabase.co unreachable) |
| Screenshots | 98 new in `tests/screenshots/v2/`, all looked at (contact sheets of the 49 phone and 49 desktop images, then single images where something looked off); the 56 v1 images moved to `tests/screenshots/v1/` |

E2E rows below are `pass/fail/skipped` across both projects. Skips are projects that do not apply (desktop-only tests on mobile, phone-only tests on desktop, the real-project sync).

v2 criteria: 42 new IDs, 40 PASS (STICKER-8 also has a manual Windows check pending), 2 FAIL (SKY-13, STICKER-4). Changed v1 criteria: A11Y-2 FAIL (same defect as SKY-13); the rest PASS. v1 re-verification: DAT-3 and DAT-5 now FAIL (new regression, defect 1); the other v1 criteria still PASS and SYNC-12 stays NOT RUN, so v1 stands at 107 PASS, 2 FAIL, 1 NOT RUN of 110.

## Real failures (first v2 run, historical; all but two fixed, see Fix round re-run)

| # | Defect | Criteria | Owner | File |
|---|---|---|---|---|
| 1 | **Dialogs opened from a Settings card are trapped in the card.** The card has `backdrop-filter: blur(18px)`, which makes it the containing block of the `position: fixed` scrim, so the Import summary, the Replace confirm and the Erase dialog are clipped to the "Your data" card and the next card ("About") paints over the Replace / Merge / Cancel buttons. Playwright reports `<div class="card__head"> from <section class="card"> subtree intercepts pointer events`; I confirmed it in a screenshot. A user cannot import a backup or erase data. Same bug on phone. 14 e2e runs fail (7 tests x 2 projects) | DAT-3, DAT-5 (v1 regressions) | frontend | `frontend/src/screens/Settings.tsx` (render the dialogs outside the card, or portal them to `document.body`), `styles/components.css` (`.card` backdrop-filter) |
| 2 | Focus halo is lost on buttons: `.btn--primary`, `.btn--secondary` and `.playbtn` define their own `box-shadow`, which wins over the `:focus-visible` halo in base.css. The ring outline is still drawn, only the second tone is missing (Play shows the glass ring instead). 4 e2e runs fail | SKY-13, A11Y-2 | frontend | `styles/components.css` (.btn--primary, .btn--secondary), `styles/screens.css` (.playbtn), `styles/base.css:84` |
| 3 | Makeup stickers exceed the 8% cap: weight fraction 8.3% (midday, dusk, evening) and 9.1% (afternoon). The table equals design.md 4.2 and contract V2.5, so either the data or the criterion needs to move. 1 unit test fails | STICKER-4 | Weights: night share within 3 points; makeup at most 8% at every phase; dawn never at 12:30 | unit | PASS (fix round; was FAIL) | - | Makeup weight is now 0.5 in midday, afternoon, dusk and evening (4.4 to 4.8%). `stickers.test` pins the new table and the new design.md 4.2 pools (study gained 🔬 ⚗️ 🧫 📝, medicine lost 🧠 🧪 ✏️) |  |

Not defects, noted: Escape pressed in the same frame as the task sheet mounts is ignored (the sheet takes focus in an effect), which a person cannot do; the TSK-4 test now waits for focus to enter the dialog and passed in the final full run (it had failed once on each project under load before). One TSK-6 rename test raced the committed rename; fixed in the test.

## Tests of mine that went stale or racy, and what I changed (no assertion loosened for a defect)

| Test | Why | Change |
|---|---|---|
| first-run THEME-1 | Chromium serialises the custom property `rgba(255,255,255,0.9)` as `#ffffffe6` | compare the parsed colour (RGB and alpha 0.9), not the text |
| `unit/colorMath.ts` `parseColor` | the same serialisation lost the alpha byte, so layout.spec A11Y-1 had been compositing glass and cards as opaque | now parses `#rgb`, `#rrggbb`, `#rrggbbaa`; A11Y-1 still passes with the exact alpha |
| first-run token check | `--em-nav-h` is 72 px on desktop and 64 px on the phone tab bar (components.css:829) | per-project expectation |
| settings THEME-1 | nothing is written to storage until a choice is made on a first run | read the default as `sky` when no document exists yet |
| settings week start | the "Oct 11 to Oct 17" subtitle moved inside the card (D-56) | look it up inside the week card |
| TSK-4, TSK-6 | races described above | wait for focus in the dialog; wait for the committed rename |
| screenshots.spec | rewritten for v2 (keyframe naming, shifted `Date` instead of `page.clock.install`, which hangs screenshots with the new animations; height-stable full-page capture) | see Screenshots |
| pwa.spec | PWA-1 v2 values were untested | new test: manifest colours, description, icon sampled |

## Per-ID results, new v2 criteria

| ID | Criterion | Method | Result | E2E p/f/s | Evidence | Owner and file (FAIL only) |
|---|---|---|---|---|---|---|
| SKY-1 | Scene on every route: fixed, full viewport, aria-hidden, no pointer events, no focusable children | e2e | PASS | 10/0/0 | sky.spec SKY-1 (4 routes x 2 widths) |  |
| SKY-2 | Keyframe times set the design.md hex values and `data-sky-phase` | unit+e2e | PASS | 16/0/0 | sky.test (exact stops at each keyframe minute); sky.spec SKY-2 (8 times x 2 widths, with greeting window) |  |
| SKY-3 | 02:00: latenight, dark, moon, no sun, stars >= 0.9, night greeting without banned words | unit+e2e | PASS | 4/0/0 | sky.test; sky.spec SKY-3 |  |
| SKY-4 | 12:30: midday, light, sun centre 45 to 55% of width, no stars, no moon | unit+e2e | PASS | 4/0/0 | sky.test; sky.spec SKY-4 |  |
| SKY-5 | OKLab blend: 10:30 is the midpoint within 1 per channel; 10:10 differs from 10:00 | unit+e2e | PASS | 2/0/0 | sky.test (independent OKLab in colorMath.ts); sky.spec SKY-5; continuity: no channel jumps over 3 between adjacent minutes |  |
| SKY-6 | Cadence: one rewrite per minute, once at once on becoming visible | e2e | PASS | 2/0/0 | sky.spec SKY-6 (counts style writes across fast-forwarded minutes) |  |
| SKY-7 | Arcs: sun 05:30-19:30, moon 19:00-06:30, 06:00 sun near the back hill, bodies out of the header band | unit+e2e | PASS | 20/0/0 | sky.test (every minute at 1280x900, 1024x768, 390x844); sky.spec SKY-7 |  |
| SKY-8 | 3 clouds; 28 stars at 1280, 16 at 390; hills | e2e | PASS | 2/0/0 | sky.spec SKY-8 |  |
| SKY-9 | Polarity flips at 05:15 and 17:00 (05:14, 05:15, 16:59, 17:00), live without reload | unit+e2e | PASS | 10/0/0 | sky.test; sky.spec SKY-9 |  |
| SKY-10 | Contrast sweep over all 1,440 minutes and both fixed modes | unit | PASS | - | sky-contrast.test: independent blend and compositing, tokens read from tokens.css; worst-minute table below matches design.md section 12 within 0.15 |  |
| SKY-11 | axe: zero serious or critical on every screen at all 8 keyframes plus 05:15, 16:59, 17:00, 17:19 | e2e | PASS | 32/0/0 | diary.spec SKY-11: 13 times (adds 17:05) x 4 screens x 2 widths, structure rules and contrast rule; flat-paint re-runs over each of the five sky colours at 12:30, 17:05, 23:00. axe cannot read gradients, so contrast over the gradient is covered by SKY-10 |  |
| SKY-12 | Only large text sits directly on the sky | e2e | PASS | 26/0/0 | diary.spec SKY-12: walks every visible text node, flags those whose nearest non-transparent background is the scene; 02:30, 12:30, 18:30 on all screens, empty states, running timer |  |
| SKY-13 | Focus is visible at every keyframe: outline in --em-focus-ring plus --em-focus-halo shadow | e2e | PASS (fix round; was FAIL) | 24/0/0 | Outline, link, input, segmented option and now Reset, Skip, Play and Add task keep the halo at all 8 keyframes. The Add-task case types a name first (the button is disabled when empty) and reaches it with Tab, so `:focus-visible` matches. |  |
| SKY-14 | theme-color meta equals --sky-top and updates | e2e | PASS | 4/0/0 | sky.spec SKY-14 (also at each keyframe) |  |
| SKY-15 | No canvas; hidden page pauses scene, mascot and sticker animations; budgets | e2e | PASS | 4/0/0 | sky.spec SKY-15; build budget below (JS 56.8 of 60 KB, CSS 10.5 of 16 KB gzipped) |  |
| SKY-16 | Reduced motion: nothing animates in scene, mascot or stickers; no drifting stickers | e2e | PASS | 4/0/0 | sky.spec SKY-16 (all screens, plus the static 3-sticker flash after a session) |  |
| MASCOT-1 | Mascot present on Timer, aria-hidden, no pointer events, overlaps no control on any screen at both widths | e2e | PASS | 24/0/0 | mascot.spec MASCOT-1: box and painted extent (headlamp beam, wave arm) vs every interactive element; 360, 414, 900, 899, 1024, 1440 as well |  |
| MASCOT-2 | States idle, focusing, break, celebrate (1.6 s), wave (1.8 s) | e2e | PASS | 22/0/0 | mascot.spec MASCOT-2 (finish, skip, first open of a study day, new day, 02:00 belongs to the previous day, streak-7, count milestone) |  |
| MASCOT-3 | Headlamp whenever dark; wide eyes in idle and focusing; no closed-eye or Zzz asset | e2e | PASS | 12/0/0 | mascot.spec MASCOT-3 (02:30, Always dark, live flip at 17:00) |  |
| MASCOT-4 | Cloud friend off: no mascot anywhere, greeting uses the full width | e2e | PASS | 7/0/1 | mascot.spec MASCOT-4 (all screens, reload, long-name wrap at 390) |  |
| MASCOT-5 | Reduced motion: state still changes, nothing animates | e2e | PASS | 2/0/0 | mascot.spec MASCOT-5 |  |
| MASCOT-6 | The mascot carries no information (accessibility tree identical on and off) | e2e | PASS | 8/0/0 | mascot.spec MASCOT-6 (4 routes x 2 widths) |  |
| STICKER-1 | stickers.json validates; single graphemes; defaults equal design.md 4.2 | unit | PASS | - | stickers.test (Intl.Segmenter, schema mutations, table equality) |  |
| STICKER-2 | Drift cadence, caps (3 / 2 / 1 while focusing), removal when finished | e2e | PASS | 6/0/0 | stickers.spec STICKER-2 (seeded, fake clock) |  |
| STICKER-3 | No repeats over 500 seeded picks and none equal to one on screen | unit | PASS | - | stickers.test |  |
| STICKER-4 | Weights: night share within 3 points; makeup at most 8% at every phase; dawn never at 12:30 | unit | FAIL | - | Night share and dawn rule pass. Makeup weight fraction is 8.3% at midday, dusk and evening and 9.1% in the afternoon (measured over 10,000 seeded picks: 8.2, 8.0, 8.0 and 8.9%). The shipped table equals design.md 4.2 and contract V2.5, so the documents and the criterion disagree. Not loosened | frontend: `frontend/src/data/stickers.json` (makeup 1 -> 0.5 in midday, afternoon, dusk, evening gives 4.4 to 4.8%), or the spec owner raises the limit to 10%. `tests/unit/stickers.test.ts` pins the table to design.md and will need the same update |
| STICKER-5 | Completion burst: 12 (9 phone), 18 / 14 with a milestone, within 100 ms, gone within 1.6 s; none after Skip, break end, late catch-up, pulled session | e2e | PASS | 16/0/0 | stickers.spec STICKER-5 (centred on the bubble, inside the viewport at peak spread) |  |
| STICKER-6 | Stickers off: no drift, no burst, v1 confetti on a milestone | e2e | PASS | 6/0/0 | stickers.spec STICKER-6 |  |
| STICKER-7 | Hidden page: no spawn, no burst on return | e2e | PASS | 2/0/0 | stickers.spec STICKER-7 |  |
| STICKER-8 | Undrawable emoji dropped at startup | unit+e2e | PASS (browser part); NOT RUN (Windows 10) | 2/0/0 | stickers.test; stickers.spec STICKER-8 (every sticker that appears is one grapheme from the pools, no replacement character). The Windows 10 check is in the manual list |  |
| NAME-1 | Default name "Em"; 14:00 greeting is an afternoon line ending ", Em" | unit+e2e | PASS | 4/0/0 | greeting.test; diary.spec NAME-1 (v1 document and first run) |  |
| NAME-2 | Rename updates the greeting live, survives reload, syncs | unit+e2e | PASS (two-device sync by unit only) | 3/0/1 | diary.spec NAME-2; sync.test SYNC-13 / migration.v2.test (pushed in settings.data). Two real devices: manual list |  |
| NAME-3 | Trimmed, at most 24, blank allowed without trailing comma | unit+e2e | PASS | 16/0/0 | migration.v2.test (ValidationError too-long); diary.spec NAME-3 (maxlength, typing past it, trim, blank at all five windows) |  |
| NAME-4 | Name rendered as text | e2e | PASS | 4/0/0 | diary.spec NAME-4 ("<b>x</b>" literal; an img onerror payload never fires) |  |
| NAME-5 | Greeting windows, stable variant, night lines contain "night", banned words absent | unit+e2e | PASS | 24/0/0 | greeting.test (every line and subline template, every window boundary); diary.spec NAME-5 (11 boundary times in the browser) |  |
| NAME-6 | Subline priority and exact strings | unit+e2e | PASS | 18/0/0 | greeting.test; diary.spec NAME-6 (all five rules, singular, live update after a session) |  |
| THEME-1 | Three theme choices, default Follow the sky, persists per device | e2e | PASS | 4/0/0 | settings.spec, first-run.spec THEME-1 (the OS dark preference never switches it) |  |
| THEME-2 | Always light at 02:00: midday sky, sun at apex, night greeting | e2e | PASS | 6/0/0 | sky.spec THEME-2; sky.test (skyFor pins) |  |
| THEME-3 | Always dark at 12:30: pins 02:30 (fix round: was 23:00), `latenight` sky, moon and stars, headlamp, afternoon greeting | e2e | PASS | 6/0/0 | sky.spec THEME-3 |  |
| THEME-4 | v1 light -> sky, dark stays, unknown -> sky, new keys get defaults, nothing else changes | unit | PASS | - | migration.v2.test (v1 and v0 fixtures, import, export round trip) |  |
| THEME-5 | Sync: displayName pushed; theme, mascot, stickers never | unit | PASS | - | sync.test SYNC-13 and migration.v2.test with the fake Supabase |  |
| THEME-6 | Cloud friend and Sky stickers switches: default on, persist, immediate | e2e | PASS | 2/0/0 | diary.spec THEME-6; mascot.spec MASCOT-4; stickers.spec STICKER-6 |  |

## Changed v1 criteria (spec section v2.6)

| ID | Now reads | Result | Evidence |
|---|---|---|---|
| UI-1 | replaced by THEME-1 to THEME-3 | PASS | old dark toggle is gone (settings.spec THEME-1 asserts a radio group of three, no switch) |
| UI-2 | replaced by SKY-2 to SKY-9 | PASS | see above |
| UI-3 | layouts, plus Play above the fold at 390x844 | PASS | layout.spec UI-3 (5 sizes x 4 screens); diary.spec UI-3: 5 states at 390x844 including a 24-character name and Always dark; Play also clears the floating nav |
| A11Y-1 | AA at every minute in every theme mode; only large text on the sky | PASS | SKY-10 sweep, SKY-11 axe, SKY-12 text walk; layout.spec A11Y-1 re-computes the pairs from the live tokens (colorMath.parseColor now keeps the alpha byte of Chromium's #rrggbbaa serialisation, so glass and card compositing in this test is now exact) |
| A11Y-2 | two-tone focus ring | PASS (fix round; was FAIL) | button halo fixed; keyboard.spec A11Y-2 and diary.spec SKY-13 pass |
| A11Y-5 | 44 px targets | PASS | layout.spec plus diary.spec: every interactive element on all four screens at 02:30 (Always dark, 24-character name) and 12:30, with a burst and the break card on screen; decoration has no focusable or role-bearing element |
| TMR-16 | breathing glow is a halo on the ring bubble; reduced motion unchanged | PASS | timer.spec TMR-16 (animation `breathe` on `timer-bubble`, off for focus only, none under reduced motion) |
| MIL-2 | milestone is the larger burst plus mascot; confetti when stickers off; reduced motion message only | PASS | timer.spec MIL-1..4; stickers.spec STICKER-5 (18 / 14) and STICKER-6; sky.spec SKY-16 |
| MIL-3 | starting a focus phase clears any burst | PASS | stickers.spec MIL-3 |
| SYNC-13 | displayName synced; mascot, stickers, theme device-only | PASS | sync.test SYNC-13 (the 6 unit tests that assumed v1 defaults in import, storage, store and sync now assert the v2 defaults and pass) |
| EDGE-8 | copy unchanged; Tasks empty and Stats first run show the decorative mascot | PASS | first-run.spec EDGE-8; mascot.spec MASCOT-1 (empty states) |
| PWA-1 | icon is the cloud friend; theme_color #4FA8EE, background_color #8CC8F5, description "Your little sky for focus." | PASS | pwa.spec PWA-1 (v2), new this round: manifest values asserted and the maskable icon sampled (light-blue field, white cloud); icon also viewed |
| DAT-3 (v1) | import: summary, Replace, Merge, Cancel, invalid files | PASS (fix round; was FAIL) | Dialogs now portal to `document.body` (new regression test in diary.spec: scrim sits outside `.card, .page, main` and covers the viewport). The v0 backup test now expects `schemaVersion` 2 (stale: the schema moved to v2; it had been unreachable behind the dialog bug) |
| DAT-5 (v1) | erase all data | PASS (fix round; was FAIL) | Erase dialog (and the signed-in variant) usable again |

## Contrast sweep: worst minute per pair (SKY-10)

1,440 minutes, Follow the sky plus both fixed modes, composited over the blended top, mid, horizon and both hill colours. Zero minutes below any threshold.

| Pair | Threshold | Worst | At |
|---|---|---|---|
| card ink | 4.5 | 11.28 | 17:00 |
| card ink-2 | 4.5 | 6.55 | 17:00 |
| card ink-3 | 4.5 | 4.78 | 17:00 |
| card accent-text | 4.5 | 5.66 | 16:59 |
| card danger | 4.5 | 5.84 | 16:59 |
| glass ink | 4.5 | 8.59 | 17:00 |
| glass ink-2 | 4.5 | 4.99 | 17:00 |
| glass accent-text | 4.5 | 4.52 | 16:59 |
| solid card ink | 4.5 | 13.33 | 17:00 |
| solid card ink-2 | 4.5 | 7.32 | 16:59 |
| solid card ink-3 | 4.5 | 5.24 | 16:59 |
| on-accent on accent | 4.5 | 8.65 | 05:15 |
| sky ink on top | 3 | 3.10 | 17:18 |
| sky ink on mid | 3 | 3.10 | 17:19 |
| focus (better of ring and halo) on sky | 3 | 3.24 | 16:28 |
| focus ring on cards | 3 | 8.20 | 17:00 |
| heat-3 on solid card | 3 | 4.26 | 16:59 |
| heat-1 on solid card | 2 | 2.04 | 16:59 |

Matches design.md section 12 (sky ink 3.10 at 17:19; glass accent-text 4.52 at 16:59; glass ink-2 4.99 at 17:00; card ink-3 4.78 at 17:00; focus 3.24 at 16:28; heat-1 2.04 at 16:59). The tightest are the large-text sky ink (3.10 against a 3.0 floor) and heat-1 (2.04 against 2.0); there is no margin left there, so any change to the dusk keyframes needs the sweep re-run.

SKY-11 "incomplete" contrast nodes: axe cannot resolve a gradient, so text over the sky is reported incomplete rather than failed. Those nodes are the greeting, page titles and brand (the only text on the open sky, SKY-12); they are covered by the sweep above (sky ink at 3:1 on top and mid) and by the flat-colour axe re-runs.

## Visual review (v2 screenshots, all owner: frontend, cosmetic unless stated)

Overall the look matches the brief: the sky, hills, glass bubble, mascot and stickers read as one friendly scene; the night mode is alert rather than sleepy ("Night shift focus, Em", headlamp); Play is above the fold at 390x844 in every state; text on the sky is only the large headings; the bursts are cheerful and clear in about 1.4 s. Issues, most important first:

1. **Floating tab bar lets scrolled content show through at 390** (milestone, break and picker shots): "25 of 120 min / 1 session today" is cut by the bar and its text bleeds between the tab labels. Needs a denser glass or a fade/padding under the bar. (Visible in `timer-break-390-*`, `milestone-390-*`.)
2. Sun and moon glow peek out between and behind cards as stray smudges: a yellow blob wedged between the mode switcher and the bubble at 12:30 on the 390 Timer (`timer-idle-390-midday`), ray stubs between cards on Settings and Tasks at 1280 (midday), a half moon between the Today tile and the streak tiles on Stats at night. Not wrong, but they look like rendering leftovers. Consider keeping the bodies clear of the content column or fading them where cards overlap.
3. Trend chart: the "Goal" label collides with today's end marker (open circle) at 02:30 and 23:00 on Stats (`stats-fixture-1280-latenight`, 390 night). Owner frontend, `charts/TrendChart.tsx`.
4. At 1280 the left clouds sit under the subline chip and the left end of the mode switcher at midday; the chip text stays readable but the white cloud behind its edge makes the chip look chipped (`timer-idle-1280-midday`).
5. Stats first-run at 1280: the small mascot floats mid-card between the empty chart and the "By task" column, not beside any caption (`stats-empty-1280-*`).
6. The burst stickers cover the digits for about 1.4 s by design (STICKER-5). Fine, but the 390 milestone burst (14 stickers on a 296 px bubble) is dense enough to hide the time and the task name while it lasts.
7. The "Pause (Space)" tooltip stays on screen after a mouse click on Play in the desktop shots and sits under the burst; harmless, noted because it appears in every running capture.
8. Light mode: the selected mode-switcher pill ("Focus") has a heavy dark outline while the dark polarity has none (inconsistent selected treatment).
9. Carried over from v1: Tasks at 1280 leaves the lower half empty (now filled by hills, which helps).

Behaviour seen in the shots that is correct but looks odd: at 02:30 the Timer shows "1 session today, 5-day streak" because the study day rolls over at 06:00 (design D-15), while the same fixture shows 3 sessions at 12:30.

Capture note: `timer-celebrate-390-night` was taken after the 1.4 s burst had finished (live capture 300 ms after completion races under load); the burst is visible in the other three celebrate shots and in the milestone shots.

## Screenshots (`tests/screenshots/v2/{screen}-{state}-{width}-{keyframe}.png`, width 1280 or 390)

Keyframe ids: `dawn` 06:00, `midday` 12:30, `dusk` 18:30, `night` 23:00, `latenight` 02:30 (02:00 for the Always-light case), `dusk-edge` 17:05. The page clock is a shifted `Date` set before load, stickers are seeded (`?e2e&seed=1`), animations are disabled except for the live burst, wave and celebrate captures. Old state names are kept where the state still exists; the v1 theme suffix (`-light`, `-dark`) is replaced by the keyframe. The 56 v1 images are in `tests/screenshots/v1/`.

| Screen and state | Keyframes | Names |
|---|---|---|
| Timer, running with a task, 3 sessions today, 6-day streak | dawn, midday, dusk, night | `timer-running-*` |
| Stats after that run (nav dimmed state) and seeded `backup-valid.json` | dawn, midday, dusk, night (+ latenight for the fixture) | `stats-*`, `stats-fixture-*` |
| Timer idle, break with prompt, celebrate (live), wave (live) | midday, night (+ latenight, dusk-edge for idle) | `timer-idle-*`, `timer-break-*`, `timer-celebrate-*`, `timer-wave-*` |
| Tasks, Settings (full page) | midday, night, latenight | `tasks-*`, `settings-*` |
| Empty states: Timer, Tasks, Stats | midday, night | `timer-empty-*`, `tasks-empty-*`, `stats-empty-*` |
| Task picker, discard dialog | midday, night | `picker-*`, `dialog-discard-*` |
| Milestone: sticker burst, and the v1 confetti with stickers off | midday, night | `milestone-*`, `milestone-confetti-*` |
| Theme modes: Always light at 02:00, Always dark at 12:30 (Settings and Timer) | latenight, midday | `settings-always-light-*`, `timer-always-light-*`, `settings-always-dark-*`, `timer-always-dark-*` |
| Mascot and stickers off | midday | `timer-decoration-off-*` |
| Signed-in Sync card (4174 build, mocked Supabase) | midday | `sync-signed-in-*` |

## Bundle sizes (`VITE_E2E=1 npm run build`)

| Chunk | Raw | Gzipped |
|---|---|---|
| Initial JS (`index-*.js`) | 166.9 KB | 56.8 KB by `check-size.mjs` (budget 60 KB; 57.97 KB by plain gzip of the file) |
| CSS (`index-*.css`) | 48.1 KB | 10.5 KB by `check-size.mjs` (budget 16 KB) |
| Sync chunk: supabase-js (`sync-dist-*.js`, lazy) | 209.0 KB | 53.4 KB |
| Sync engine (`sync-engine-*.js`, lazy) | 8.7 KB | 3.6 KB |
| workbox-window (lazy) | 5.5 KB | 2.1 KB |
| Nunito variable font (woff2) | 38.2 KB | n/a |
| Service worker precache | 23 entries, 289.22 KiB | lazy sync chunks not precached |

v1 was 47.4 KB JS and 7.75 KB CSS gzipped: v2 adds 9.4 KB of JS and about 2.8 KB of CSS and leaves 3.2 KB of JS headroom.

## Manual checklist additions for Dathan (v2)

1. iPhone home-screen app at night: the sky shows under the status bar (theme-color follows the sky), the headlamp mascot, a night greeting.
2. Leave the app open across 17:00 and across 05:15 and watch the cards and chart colours flip smoothly (600 ms cross-fade), with no flash.
3. Windows 10 laptop: emoji rendering. 🫧 and ❤️‍🩹 are dropped on an old font set and nothing may show as an empty box (STICKER-8).
4. Feel check at morning, afternoon and night: friendly and alive without distracting during a focus session.
5. Rename to "Emily" on the laptop while signed in and see it on the phone after Sync now (NAME-2, two real devices).
6. After defect 1 is fixed: export, import (Replace and Merge) and Erase on the phone and the laptop.

## v2 test inventory

Unit: `sky.test` (30), `sky-contrast.test` (36), `greeting.test` (26), `migration.v2.test` (31), `stickers.test` (49) plus the corrected v1 files (`import`, `storage`, `store`, `sync`). E2E new: `sky.spec`, `mascot.spec`, `stickers.spec`, `diary.spec` (SKY-11/12/13, NAME, THEME-6, UI-3, decoration vs numerals and chart labels, 44 px, decoration not focusable). Helpers: `colorMath.ts` (independent WCAG, compositing and OKLab), `helpers.ts` (`atTime`, `v2doc`, `emptyDoc`, `docWithSessions`, `controlsOverlapping`).

---

# v1 history (kept unchanged below)


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
