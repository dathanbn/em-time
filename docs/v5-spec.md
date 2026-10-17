# v5: clear liquid glass, tools placement, phone greeting, stopwatch

Approved by Dathan 2026-10-17 (mockup "Em Time liquid glass", option A "Clear glass"). His words: the white made the aesthetic look too clunky.

## 1. Clear liquid glass

Apply option A to: the mode selector (`.modes`, both widths), the desktop nav tabs (`.nav__tabs` at >= 900px only; the phone bottom tab bar keeps its current solid look), and the Sounds chip / stopwatch pill wherever they sit on the sky (phone). Implement it properly as tokens in `styles/tokens.css` (light in `:root`, dark in `:root[data-theme='dark']`) plus the real rules in components.css/screens.css. No `!important`, no injected override file. Keep the existing forced-colors and no-backdrop-filter fallbacks working (the `@supports not (backdrop-filter...)` block in tokens.css must give these elements a readable opaque fallback).

Reference values (tested by injection, screenshots in the mockup):

```css
:root {
  --lg-fill: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 100%);
  --lg-rim: rgba(255,255,255,0.45);
  --lg-blur: blur(14px) saturate(115%);
  --lg-depth: inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(255,255,255,0.22),
    inset 0 0 14px rgba(255,255,255,0.18), 0 6px 22px rgba(16,38,63,0.10);
  --lg-bead: linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.18) 100%);
  --lg-bead-depth: inset 0 1px 0 rgba(255,255,255,1), inset 0 -2px 6px rgba(255,255,255,0.35),
    0 2px 10px rgba(16,38,63,0.12);
  --lg-hover: rgba(255,255,255,0.22);
  --lg-ink: var(--sky-ink);
}
:root[data-theme='dark'] {
  --lg-fill: linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.04) 100%);
  --lg-rim: rgba(255,255,255,0.20);
  --lg-blur: blur(12px) saturate(160%);
  --lg-depth: inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 14px rgba(255,255,255,0.05), 0 6px 22px rgba(0,0,0,0.25);
  --lg-bead: linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.09) 100%);
  --lg-bead-depth: inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 6px rgba(255,255,255,0.06), 0 2px 10px rgba(0,0,0,0.30);
  --lg-hover: rgba(255,255,255,0.08);
  --lg-ink: #eef5ff;
}
/* containers */ background: var(--lg-fill); border: 1px solid var(--lg-rim); backdrop-filter: var(--lg-blur); box-shadow: var(--lg-depth);
/* every option label */ color: var(--lg-ink)   (no grey inactive labels; also not the dim nav state's grey)
/* selected option (aria-checked / aria-current=page) */ background: var(--lg-bead); box-shadow: var(--lg-bead-depth); color: var(--lg-ink)
/* hover on unselected */ background: var(--lg-hover)
```

Keep focus-visible rings clearly visible on glass (existing halo pattern). Contrast: every label must stay >= 4.5:1 against the sky behind at every time of day; the repo already has sky contrast tests (`tests/unit/sky-contrast.test.ts`, `platform/sky.ts` `contrastRatio`), extend them to `--lg-ink` over the sky stops if feasible (the glass adds at most a little white, so test ink against the raw sky colors and against sky blended with 22% white).

## 2. Move Sounds

- Desktop (>= 900px): remove the Sounds chip from the Timer header. Add a third card in the right side panel (`aside.timerpage__side`), below "Up next", titled "Focus tools". It holds the Sounds control (same `noise-chip` button and picker behavior, label + state, `data-testid="noise-chip"`) and the stopwatch (section 4).
- Phone (< 900px): the Sounds chip moves directly under the play controls (reset / play / skip), centered, in one row with the stopwatch pill (section 4). It must not overlap the controls, the message line, the break-idea card or the tab bar at 390x844 and 360x740 (use the existing overlap helpers in tests/e2e/helpers.ts). The thead no longer contains the chip, so revert the extra grid row added for it.
- Only one `noise-chip` exists in the DOM at a time (pick by width like other narrow/wide components).

## 3. Phone greeting

On phone, the greeting sits too close to the top. Move it down so it is vertically centered on the header mascot (the Companion cloud at the right of the header): same row, `align-items: center`. Keep the header compact (do not push the mode pill and ring down more than needed). Desktop unchanged.

## 4. Stopwatch (new, barebones)

Purpose: time individual subtasks within a focus period. Independent of the Pomodoro timer (never starts, stops or logs anything there).

- Controls: Start/Stop toggle and Reset. Nothing else (no laps, no history, no settings).
- Display: `m:ss` under one hour, `h:mm:ss` from one hour. Tabular figures.
- Accuracy: timestamp based (`Date.now()`), so it stays correct with the tab hidden or the phone locked. Repaint at most every 250 ms, only while running and the page is visible (rAF or interval), updating the DOM by ref like the timer digits, not through a signal every tick.
- Persistence: device-only, in its own localStorage key `em-time:stopwatch` as `{ startedAt: number | null, accumulatedMs: number }`, every access in try/catch; a reload keeps a running stopwatch running. Not in core AppData, not exported, not synced. "Erase all data" in Settings should also clear it (where `clearUiMemory` is called).
- Reset: zeroes and stops. Disabled (aria-disabled + visual) when already at 0 and stopped.
- Desktop: inside the "Focus tools" card: label "Stopwatch", digits, a Start/Stop button and a Reset button (real `<button>`s, text labels "Start" / "Stop" / "Reset").
- Phone: a compact clear-glass pill in the row under the controls: stopwatch glyph + digits + a 44x44 icon button (play/pause glyph) + a 44x44 reset icon button. Icon buttons get `aria-label` "Start stopwatch" / "Stop stopwatch" / "Reset stopwatch".
- Test ids: `stopwatch`, `stopwatch-time`, `stopwatch-toggle`, `stopwatch-reset`; `data-state="idle|running|stopped"` on `stopwatch`.
- Accessibility: digits `role="timer"` with `aria-live="off"`; announce "Stopwatch started/stopped/reset" through the existing `platform/announce.ts` polite region.

## 5. Budget

Main JS is at 59.9 / 60 KB gzipped. Dathan is fine with growth: raise the budget in `scripts/check-size.mjs` to 62 KB and say so in HANDOFF. Stay under 62 KB. CSS budget 16 KB stays.

## 6. QA

- Update existing e2e tests that assumed the chip in the header (noise.spec, mascot.spec MASCOT-4 header child count, layout specs). Add `tests/e2e/stopwatch.spec.ts` (desktop + mobile): start, time advances (use Playwright clock), stop holds, reset zeroes and disables, persists across reload while running, keeps correct elapsed time after the clock jumps (hidden tab), not affected by Pomodoro Play/Pause/Skip, axe clean.
- Glass tests: computed styles of `.modes` and desktop `.nav__tabs` use the glass tokens; phone tab bar unchanged; selected option has no solid accent fill.
- Layout: greeting vertically centered with the header mascot on phone (centers within 4 px); no overlaps at 390x844 and 360x740.
- Full suite green: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `VITE_E2E=1 npm run build` (size check), `npx playwright test`.
- Screenshots `tests/screenshots/v5-*.png`: Timer desktop 1280x800 and phone 390x844, at midday, dusk and night, stopwatch running.
