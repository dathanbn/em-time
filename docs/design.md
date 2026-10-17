# Em Time: Design Brief v2, "Sky diary"

Owner: frontend agent. The v1 brief is kept at `design-v1.md`; anything not restated here (chart forms, interaction rules, sync card copy, error copy, tooltip behavior, keyboard rules) still holds from v1. Token names are fixed in `contract.md` (section 8 plus the v2 section); this file gives values and rules. Every contrast figure was computed with the WCAG formula, including alpha compositing of glass and cards over the sky, and a per-minute sweep over all 1,440 minutes of the day passed with zero failures (script logic is reproduced as a unit test, see `tasks.md` v2 QA).

## 1. Concept and tone

The whole screen is a sky that follows the real clock: a sun or moon travels an arc, clouds drift by day, stars come out at night, two soft hills sit at the bottom. Content floats on frosted glass. A small cloud friend lives in the sky and reacts to what she is doing. Emoji stickers chosen for her (medicine, ambulance, girly pop, study) drift by now and then and burst out when a focus session ends.

Tone: friendly, cute, warm, a little playful, never noisy. Light blue is the hero: it is the daytime sky, the primary buttons, the selected states, the timer ring. Night is not "late": she works ambulance night shifts, so night is a "lights on" mood, alert and cozy. No copy ever implies she should be asleep.

Three visual layers, back to front:
1. **Scene** (fixed, full viewport, `aria-hidden`, `pointer-events: none`): sky gradient, stars, sun or moon, clouds, drifting stickers, hills.
2. **Content**: glass controls and cards, the timer bubble, the mascot in its reserved slot.
3. **Overlay**: sticker burst, dialogs, sheets, tooltips, update pill.

## 2. The sky system

### 2.1 Keyframes

Eight keyframes keyed to local clock time. Sky gradient is `linear-gradient(180deg, top 0%, mid 55%, horizon 100%)` on the scene. Hills are two SVG paths in front of the horizon.

| Id | Time | Polarity | Sky top | Sky mid | Horizon | Hill back | Hill front |
|---|---|---|---|---|---|---|---|
| `latenight` | 02:30 | dark | `#070D22` | `#101C40` | `#22305E` | `#18234A` | `#111A3A` |
| `dawn` | 06:00 | light | `#A9CBF0` | `#F6CFD6` | `#FFDDB5` | `#B9D3EE` | `#9CC0E6` |
| `morning` | 08:30 | light | `#6EB8F2` | `#A9D8FA` | `#E3F3FD` | `#C6E9E4` | `#A8DCD4` |
| `midday` | 12:30 | light | `#4FA8EE` | `#8CC8F5` | `#D6EEFC` | `#BFE6D9` | `#9FD6C6` |
| `afternoon` | 16:00 | light | `#5AA7E6` | `#A3CDEF` | `#FBE3C6` | `#C3E2D2` | `#A6D2BD` |
| `dusk` | 18:30 | dark | `#363F88` | `#7D5596` | `#F09A7E` | `#5A4F8E` | `#463F7A` |
| `evening` | 20:30 | dark | `#1E2A5E` | `#34407E` | `#6B5A94` | `#2A3468` | `#222B58` |
| `night` | 23:00 | dark | `#0B1430` | `#16244D` | `#2B3D73` | `#1A2A55` | `#142147` |

Celestial bodies, clouds and stars per keyframe:

| Id | Sun inner / outer | Sun glow | Moon glow | Cloud fill | Cloud opacity | Star opacity |
|---|---|---|---|---|---|---|
| `latenight` | `#FFD9A0` / `#FF7A59` (hidden) | `rgba(255,140,100,0)` | `rgba(150,170,255,0.35)` | `#4A578A` | 0.18 | 1 |
| `dawn` | `#FFF1C9` / `#FFB46B` | `rgba(255,180,107,0.55)` | `rgba(150,170,255,0.15)` | `#FFF4F0` | 0.90 | 0.15 |
| `morning` | `#FFFBE6` / `#FFD86B` | `rgba(255,236,170,0.60)` | `rgba(150,170,255,0)` | `#FFFFFF` | 1 | 0 |
| `midday` | `#FFFDF0` / `#FFE07A` | `rgba(255,244,190,0.65)` | `rgba(150,170,255,0)` | `#FFFFFF` | 1 | 0 |
| `afternoon` | `#FFF4D6` / `#FFC861` | `rgba(255,214,140,0.60)` | `rgba(150,170,255,0)` | `#FFFDF8` | 0.95 | 0 |
| `dusk` | `#FFD9A0` / `#FF7A59` | `rgba(255,140,100,0.55)` | `rgba(190,180,255,0.30)` | `#F6C3D0` | 0.70 | 0.35 |
| `evening` | `#FFD9A0` / `#FF7A59` (hidden) | `rgba(255,140,100,0)` | `rgba(170,190,255,0.45)` | `#7C88BC` | 0.35 | 0.80 |
| `night` | `#FFD9A0` / `#FF7A59` (hidden) | `rgba(255,140,100,0)` | `rgba(159,180,255,0.40)` | `#56639A` | 0.22 | 1 |

Moon body is constant: lit `#FFFBE8`, shade `#CFD8F0`, two soft craters `#E6E2F2`.

### 2.2 Blending rule

At local time `t`, find the keyframes `A` (at or before `t`) and `B` (next, wrapping past midnight). `k = (t - A) / (B - A)` in minutes. Every color is mixed in OKLab (reuse the v1 `gradient.ts` math) and every number linearly. The sky therefore moves continuously; it is recomputed once a minute, so adjacent minutes differ by a barely visible step and the screen looks noticeably different every 10 to 15 minutes.

Polarity (which card and ink set the UI uses) does **not** blend. It snaps: `light` from 05:15 to 16:59, `dark` from 17:00 to 05:14. On a flip, cards and chart fills cross-fade over 600 ms (`background-color`, `color`, `fill`, `stroke` transitions). The snap times were chosen by the sweep: they keep every text pair at 4.5:1 or better through the twilight blends.

Sky ink (the only color used for text drawn straight on the sky, section 2.5) is picked per minute: whichever of `#10263F` and `#FFFFFF` has the higher minimum contrast against the blended sky top and mid. It flips independently of polarity (around 04:40 and 17:15).

`<html>` attributes set together with the tokens: `data-theme="light|dark"` (polarity, so all v1 dark-mode token blocks keep working), `data-sky-phase="<id of the nearest keyframe>"`, `data-theme-mode="sky|light|dark"` (the setting).

### 2.3 Sun and moon arcs

- Sun is up from 05:30 to 19:30: `p = (t - 05:30) / 840`. Moon is up from 19:00 to 06:30: `p = (t - 19:00) / 690` (wrapping). Both can show during the 19:00 to 19:30 and 06:00 to 06:30 overlaps, which looks natural.
- Position (body center, px): `x = W * (0.06 + 0.88 * p)` (rises on the left, sets on the right); `y = H_hor - sin(pi * p) * (H_hor - Y_apex)`. `H_hor` is the top edge of the back hill plus 35% of the body size, so the body sinks behind the hill at rise and set. `Y_apex` is 296 px at 1280 and 180 px at 390, which keeps the body (not its soft glow) below the header band (2.5) at all times.
- Opacity ramps 0 to 1 over the first 20 minutes and 1 to 0 over the last 20. Outside its window a body is `display: none`.
- Sizes: sun 88 px desktop, 64 px phone; moon 64 px and 48 px. Glow is a radial gradient behind the body, diameter 3.2x the body, from the glow color to transparent at 70%.
- Sun: radial gradient inner to outer (outer at 70%), plus 8 rounded rays (SVG, 3 px wide, length 18% of the body, outer color at 70% opacity) that rotate one turn per 90 s.
- Moon: SVG disc showing the real lunar phase (approximate): `age = ((now - 2000-01-06T18:14Z) / 86,400,000) mod 29.530588853`; lit fraction drawn with a terminator ellipse. Phase changes once a day, so it is cheap.
- All positions are CSS custom properties in px (`--sky-sun-x`, `--sky-sun-y`, `--sky-moon-x`, `--sky-moon-y`), recomputed with the minute tick and on resize (debounced 150 ms).

### 2.4 Clouds, stars, hills

- **Clouds**: exactly 3, inline SVG puff shapes (same construction as the mascot body, no face). Widths 140, 104, 80 px desktop and 96, 72, 56 px phone; tops at 14%, 26%, 38% of viewport height. They drift left to right from `-width` to `100vw` over 160 s, 210 s and 250 s, linear, infinite, with negative delays (-40 s, -120 s, -200 s) so they start mid-screen. Opacity = `--sky-cloud-opacity` times 1, 0.8, 0.6. Fill `--sky-cloud-fill`.
- **Stars**: one inline SVG. 28 stars at 1280, 16 at 390, positions from a seeded PRNG (mulberry32, seed 7) in x 2% to 98%, y 3% to 60%. Three in four are circles (r 1 to 1.8 px), one in four is a 4-point sparkle (6 px). Twinkle: opacity 1 to 0.35 to 1, 3 to 5 s, staggered. Group opacity `--sky-star-opacity`; the SVG gets `visibility: hidden` when that is 0.
- **Hills**: one inline SVG, `viewBox="0 0 1440 200"`, `preserveAspectRatio="none"`, full width, pinned to the viewport bottom. Back hill height `clamp(84px, 18vh, 170px)` with two gentle humps; front hill `clamp(56px, 12vh, 120px)` with one wide hump offset right. Fills `--sky-hill-back`, `--sky-hill-front`. No other scenery.

### 2.5 Where text may sit

- **On the sky directly**: only large text, and only in the header band (viewport y 0 to 232 px at 1280, which is the 72 px nav plus 160 px; y 0 to 132 px plus `env(safe-area-inset-top)` at 390): the greeting, page titles, the brand word in the desktop nav. These are all at least 20 px at weight 800, so the WCAG large-text threshold (3:1) applies. They use `--sky-ink`, verified against the sky top and mid stops, which bound the band. Text in the band only ever scrolls up and out of view, never down toward the horizon. Sun and moon bodies never enter the band (2.3).
- **Everything else** sits on glass (`--em-glass`: controls, chips, nav, timer bubble) or on cards (`--em-surface`, `--em-surface-solid`).

### 2.6 UI token sets per polarity

Glass and card alphas were chosen so text passes over the worst sky color in every minute of each polarity window (composited over top, mid, horizon and both hills). With `backdrop-filter: blur(var(--em-blur)) saturate(140%)`. Where `backdrop-filter` is unsupported (`@supports not`), glass alpha becomes 0.90 and card alphas 0.97.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--em-glass` | `rgba(255,255,255,0.72)` | `rgba(18,27,43,0.78)` | segmented tracks, round buttons, chips, nav, timer bubble, message chip |
| `--em-glass-border` | `rgba(255,255,255,0.85)` | `rgba(156,211,245,0.16)` | 1 px edge on glass |
| `--em-surface` | `rgba(255,255,255,0.90)` | `rgba(18,27,43,0.88)` | content cards |
| `--em-surface-solid` | `rgba(255,255,255,0.97)` | `rgba(18,27,43,0.95)` | chart cards, dialogs, sheets, tooltips, popovers |
| `--em-surface-sunk` | `rgba(238,243,248,0.95)` | `rgba(14,22,37,0.92)` | inputs, tracks inside cards |
| `--em-blur` | `18px` | `18px` | |
| `--em-ink` | `#13202F` | `#E6EEF7` | primary text, timer digits |
| `--em-ink-2` | `#475569` | `#A9B8CC` | secondary text; the muted text allowed on glass |
| `--em-ink-3` | `#5B6B82` | `#8C9DB4` (was `#8394AB`) | captions, axis text; cards only, never on glass |
| `--em-accent` | `#8CC4F0` | `#9CD3F5` | hero light blue: Play, selected pills, switches on, ring fill decoration |
| `--em-accent-soft` | `#DCEEFC` | `#1D3550` | current-task wash, goal ring track |
| `--em-accent-text` | `#1A62A0` (was `#1F6FB2`) | `#9CD3F5` | links, selected labels, the inset edge of selected pills |
| `--em-on-accent` | `#0F2236` | `#0B1220` | text and icons on accent fills |
| `--em-focus-ring` | `#0F416F` (was `#1F6FB2`) | `#9CD3F5` | inner 2 px of the focus indicator |
| `--em-focus-halo` (new) | `#FFFFFF` | `#0B1220` | outer 2 px of the focus indicator |
| `--em-ring-track` | `#DCEEFC` | `#1D3550` | timer ring track |
| `--em-ring-fill` | `#6FB3EC` | `#9CD3F5` | timer ring progress (decorative) |
| `--em-ring-glow` | `rgba(111,179,236,0.45)` | `rgba(156,211,245,0.35)` | breathing glow around the bubble |
| `--em-danger` | `#B42318` | `#F4A6A0` | |
| `--em-danger-soft` | `rgba(253,236,234,0.95)` | `rgba(58,30,36,0.92)` | error banner |
| `--em-scrim` | `rgba(15,30,55,0.36)` | `rgba(0,0,0,0.55)` | dialog backdrop, plus `backdrop-filter: blur(4px)` |
| `--em-grid`, `--em-axis`, `--em-heat-0..4`, `--em-cat-1..8` | v1 light values | v1 dark values | unchanged, see `design-v1.md` 2.3, 2.4 |

`--em-bg` becomes `var(--sky-mid)` (overscroll and the moment before the scene paints). `--em-bg-grad-top` and `--em-bg-grad-bottom` stay as aliases of `--sky-top` and `--sky-horizon` so v1 token checks still pass.

Shadows: light `--em-shadow-sm` `0 2px 6px rgba(31,111,178,0.10)`, `--em-shadow-md` `0 8px 24px rgba(31,111,178,0.14), 0 1px 3px rgba(19,32,47,0.06)`, `--em-shadow-lg` `0 16px 44px rgba(31,111,178,0.18), 0 2px 6px rgba(19,32,47,0.06)`. Dark: `0 2px 6px rgba(0,0,0,0.30)`, `0 8px 28px rgba(0,0,0,0.38)`, `0 18px 52px rgba(0,0,0,0.48)`.

### 2.7 Theme setting

- "Follow the sky" (`theme: 'sky'`, default): everything above.
- "Always light" (`'light'`): the sky is computed as if the clock reads 12:30 (midday keyframe, sun at the apex, polarity light). Clouds still drift.
- "Always dark" (`'dark'`): computed as if the clock reads 23:00 (night keyframe, moon high, stars, polarity dark).
- In both fixed modes, the greeting and sticker weights still follow the real clock (they are about her day), while the mascot accessory follows the sky shown (headlamp whenever polarity is dark).
- No `prefers-color-scheme` switching, as in v1.

## 3. The cloud friend (mascot)

### 3.1 Construction

Inline SVG component `Mascot`, `viewBox="0 0 120 90"`, `overflow: visible` (the headlamp beam and wave arm extend past it), `aria-hidden="true"`, `focusable="false"`, `pointer-events: none`, `data-testid="mascot"`, `data-state`, `data-accessory`.

- **Body**: union of circles (34,52) r 20, (58,38) r 26, (84,48) r 20 and a rounded rect x 14 y 48 w 92 h 30 rx 15. Drawn twice: first with `stroke: var(--mascot-line)` width 5 (outline), then filled `var(--mascot-fill)` with no stroke, so the outline wraps the union cleanly. Underside shade: ellipse (60,74) rx 40 ry 6, `var(--mascot-shade)`, clipped to the body.
- **Eyes**: ellipses at (48,56) and (72,56), rx 3.4 ry 4.4, `var(--mascot-ink)`, each with a white highlight circle r 1.3 offset (+1.2, -1.6).
- **Blush**: ellipses (40,64) and (80,64), rx 5.5 ry 3.2, `var(--mascot-blush)`, opacity 0.55 (0.85 on break and celebrate).
- **Arm** (wave only): circle (104,50) r 9, same outline and fill, rotating around (98,58).
- **Headlamp** (night): strap path `M36 33 Q58 20 84 31`, stroke `#5B6FA8` width 4, round caps; lamp circle (60,24) r 6 fill `#FFE27A` stroke `#C99A2E` 1.5; beam triangle from the lamp to (140,6) and (140,40) filled with a linear gradient `rgba(255,226,122,0.38)` to transparent. The component mirrors horizontally (`scaleX(-1)` on the whole SVG) when the mascot sits on the right, so it always faces the content.
- **Star companion** (night, break and celebrate only): 5-point star, 12 px, `#FFE27A`, orbiting at radius 52 px around (60,50), one turn per 8 s.
- **Sparkles** (celebrate): three 4-point stars, 8 to 10 px, accent color, popping at the upper corners.

Colors: day `--mascot-fill #FFFFFF`, `--mascot-line #A9D2F2`, `--mascot-shade #DCEEFC`, `--mascot-ink #1E3550`, `--mascot-blush #FF9DB5`. Night `#EEF1FF`, `#8E9FD6`, `#C9D2F0`, `#1B2550`, `#FF9DB5`. Swapped by polarity.

### 3.2 Face states

Each state is a group of eye and mouth shapes; `data-state` on the root toggles which group is displayed (CSS only, no JS animation).

| State | When | Eyes | Mouth | Motion |
|---|---|---|---|---|
| `idle` | focus phase idle or paused, other screens | open, blink every 4.5 s (scaleY to 0.1 for 160 ms) | small smile `M55 63 Q60 68 65 63`, stroke 2.4 | float translateY 0 to -6 px, 3.6 s ease-in-out alternate |
| `focusing` | focus phase running | open, slightly narrowed (ry 3.6), looking toward the ring (pupils shift 1 px), blink every 6 s | small determined smile `M56 64 Q60 66 64 64` | float 0 to -4 px over 6 s, plus drift translateX -10 to 10 px over 18 s alternate |
| `break` | short or long break, any status | happy arcs `M44.5 57 Q48 52.5 51.5 57`, `M68.5 57 Q72 52.5 75.5 57` | wide smile `M54 62 Q60 70 66 62` | sway rotate -3 to 3 deg, 5 s alternate |
| `celebrate` | focus session completed, 1.6 s, then `break` | happy arcs | open smile, filled `M53 61 Q60 73 67 61 Z` with tongue ellipse (60,67) rx 3.5 ry 2 `#FF8FA8` | bounce: 0% y 0 scale 1; 15% y -18 scale (0.96, 1.06); 30% y 0 scale (1.08, 0.92); 45% y -12; 60% y 0 scale (1.04, 0.96); 75% y -6; 100% rest. Sparkles pop at 0, 120, 240 ms |
| `wave` | streak milestone (streak-7, streak-30), and first app open of each study day; 1.8 s, then the underlying state | right eye winks (arc) from 200 to 800 ms | wide smile | arm rotates -10 to 30 deg and back, 3 times, 400 ms each |

Night alert: whenever polarity is dark, `data-accessory="headlamp"`, eyes are drawn wide (ry 4.6) with a second highlight dot, and the headlamp lamp pulses opacity 0.7 to 1 over 2.4 s. There is no sleepy, closed-eye or "Zzz" asset anywhere; blink is the only time the eyes close. `data-accessory="none"` by day.

Priority when two apply: `celebrate` > `wave` > `focusing` > `break` > `idle`.

### 3.3 Placement

The mascot has a reserved slot; it never overlaps a control. If "Cloud friend" is off, the slot collapses (no gap).

| Screen | 1280 | 390 |
|---|---|---|
| Timer | 112 px wide, absolutely placed at the lower left of the ring bubble, 84 px outside its left edge, bottom aligned 24 px above the bubble bottom, facing right | 68 px, top right of the header row beside the greeting, facing left |
| Tasks, Stats, Settings | 56 px at the right end of the page title row, `idle` (or `wave`) only | 48 px, same place |
| Tasks empty, Stats first run | additionally a 72 px static `idle` mascot beside the empty caption (section 9) | same, 64 px |

The mascot element on other screens is the same component, so a pending `wave` on first open plays wherever she lands.

### 3.4 Reduced motion

`prefers-reduced-motion: reduce`: no float, drift, sway, bounce, blink, arm, orbit, lamp pulse or sparkle motion. State swaps (eyes and mouth groups) still happen instantly, celebrate holds the open smile for 1.6 s, and the star companion is drawn static at the upper right.

## 4. Stickers

Native emoji drawn as text in absolutely positioned spans in the scene layer, behind cards (so they pass softly behind the frosted glass), `aria-hidden`. Data in `frontend/src/data/stickers.json` (schema in `contract.md` v2), which Dathan can edit.

### 4.1 Drift

- Spawn: first sticker 20 to 40 s after load; then one every 45 to 90 s (uniform random). While a focus phase is running: one every 120 to 240 s, and at most 1 on screen.
- Max on screen: 3 at 1280, 2 at 390. A spawn that would exceed the cap is skipped (timer re-arms).
- Path: enters from the left or right edge (random), at a random y between 12% and 58% of the viewport height, crosses to the far edge over 30 to 42 s, linear. An inner element bobs translateY -10 to 10 px (3.2 s ease-in-out alternate) and rotates -8 to 8 deg (5 s alternate). Removed from the DOM on `animationend`.
- Size: 30 px desktop, 26 px phone, opacity 0.9.
- Each sticker's start, end and duration are inline custom properties; one shared `@keyframes sticker-drift`. JS only adds and removes nodes.

### 4.2 Picking

1. Phase = nearest keyframe id for the **real** clock.
2. Choose a pool by the phase weights (weighted random over pools with weight above 0 and at least one emoji).
3. Choose an emoji uniformly from the pool.
4. Reject and redraw (up to 6 tries) if it equals the previous pick or is currently on screen. No back-to-back repeats ever.

Default weights (relative within a row; `makeup` is the rare pool):

| Phase | medicine | girly | makeup | night | dawn | study |
|---|---|---|---|---|---|---|
| latenight | 4 | 2 | 0.5 | 5 | 0 | 2 |
| dawn | 2 | 3 | 0.5 | 1 | 5 | 2 |
| morning | 3 | 3 | 0.5 | 0 | 2 | 4 |
| midday | 3 | 4 | 0.5 | 0 | 0 | 4 |
| afternoon | 3 | 4 | 0.5 | 0 | 0 | 3 |
| dusk | 3 | 4 | 0.5 | 2 | 0 | 2 |
| evening | 3 | 3 | 0.5 | 3 | 0 | 2 |
| night | 4 | 2 | 0.5 | 5 | 0 | 2 |

Pools: medicine 🚑 🩺 🧬 🩹 🏥 💊 📚 🦴 ❤️‍🩹; girly 🎀 🌸 💖 ✨ 💫 🫧 🦋 🍓 🧸 🌈; makeup 💄 💅; night 🌙 ⭐ 🦉 🚑 🔦; dawn ☕ 🌅 🐦; study 📖 🧠 🧪 ✏️ 🔬 ⚗️ 🧫 📝.

Emoji support: at startup, one offscreen check per emoji (a hidden span compared against a known-missing glyph width, or a single offscreen canvas `measureText`; this is the only canvas use and it never draws to the screen) drops emoji the device cannot render (Windows 10 lacks 🫧 and ❤️‍🩹). Dropped emoji are skipped silently.

### 4.3 Completion burst

When a focus session completes while the page is visible (not on Skip, break ends, late catch-up, or pulled sessions): 12 stickers at 1280, 9 at 390 (18 and 14 when the completion also fires a milestone) burst from the center of the ring bubble in the overlay layer. Each gets angle `i * 360 / N` plus jitter of up to 12 deg, distance 110 to 200 px (80 to 150 at 390), 1400 ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`: scale 0.4 to 1.15 at 35% to 0.9, opacity 0 to 1 by 10%, held to 60%, 0 at 100%, rotation up to 25 deg either way. Picks avoid duplicates within one burst where the pools allow. Nodes are removed after 1500 ms. The burst replaces v1 confetti when stickers are on; with stickers off, milestones keep v1 confetti and normal completions show nothing extra.

Reduced motion: no drift spawns at all; instead of the burst, 3 stickers appear static around the bubble, fade in over 200 ms, stay 2 s, fade out.

## 5. Typography

- Family: Nunito Variable, self-hosted via `@fontsource-variable/nunito`, latin subset only (one 39 KB woff2, `wght` axis 200 to 1000). Remove `@fontsource-variable/inter`. Token `--em-font-sans: 'Nunito Variable', ui-rounded, system-ui, -apple-system, 'Segoe UI', sans-serif`.
- Weights: 500 body (`--em-fw-regular`), 600 secondary emphasis (`--em-fw-medium`), 700 labels and buttons (`--em-fw-semibold`), 800 headings, greeting, stat values, timer (`--em-fw-heavy`, new). `--em-fw-light` stays as an alias of 500 (unused).

| Token | Size / line-height | Use |
|---|---|---|
| `--em-fs-xs` | 13 / 18 | axis ticks, captions, legend, nav labels on phone |
| `--em-fs-sm` | 15 / 22 | secondary text, table cells, tooltips, greeting subline |
| `--em-fs-md` | 17 / 26 | body, inputs, buttons |
| `--em-fs-lg` | 21 / 28 | card headings, task name under the timer |
| `--em-fs-section` (new) | 22 / 28, 800 | Stats section titles (on glass labels) |
| `--em-fs-greet` (new) | 26 / 32 desktop, 24 / 30 phone, 800 | greeting (on sky) |
| `--em-fs-xl` | 30 / 36, 800 | page titles (on sky) |
| `--em-fs-stat` | 34 / 40, 800 | stat values |
| `--em-fs-timer` | `clamp(68px, 19vw, 124px)` / 1, 800 | timer digits |

- Timer numerals: weight 800, letter-spacing -0.01em, color `--em-ink`. Nunito's default figures are equal width (600 units each, verified in the latin woff2) and the font has no `tnum` feature, so digits never jitter; keep `font-variant-numeric: tabular-nums` anyway (harmless, protects fallbacks). Since Nunito has no proportional figures, the v1 "proportional for stat values" rule is dropped.
- Sentence case everywhere, no all caps, no trailing colons (v1).

## 6. Cards, buttons, controls, nav

Radii: `--em-radius-sm` 12 (inputs, chips, checkboxes), `--em-radius-md` 18 (buttons that are not pills, tooltips), `--em-radius-lg` 28 (cards, sheets, dialogs), `--em-radius-pill` 999.

- **Cards**: `--em-surface` (charts and overlays `--em-surface-solid`), backdrop blur, 1 px `--em-glass-border`, radius 28, `--em-shadow-md`, padding 24 desktop and 18 phone, gap between cards 20 desktop and 14 phone.
- **Play button**: circle 76 px desktop, 68 px phone, `--em-accent` fill, inner highlight `inset 0 2px 0 rgba(255,255,255,0.55)`, shadow `0 8px 20px rgba(79,168,238,0.35)` (dark `rgba(156,211,245,0.25)`), icon 28 px `--em-on-accent`.
- **Round ghost buttons** (Reset, Skip, steppers, week arrows): 52 px glass circles, 1 px glass border, icon 22 px `--em-ink`.
- **Pill buttons**: height 44, padding 0 20, weight 700. Primary: accent fill, on-accent text. Secondary: glass, ink. Danger: glass, danger text.
- Press: scale 0.94, release springs back with `cubic-bezier(0.34, 1.56, 0.64, 1)` 240 ms. Hover: translateY(-1px), glass alpha +0.08.
- **Segmented control**: glass track, radius pill, 4 px padding, options 40 px tall (hit area 44 with padding). Selected: accent fill, on-accent text at weight 800, and a 2 px inset ring in `--em-accent-text` (the inset edge carries the selected state at 4.5:1 or better against glass, because the accent fill alone is only about 1.3:1 on light glass).
- **Switch**: 52 by 32 track. Off: `--em-surface-sunk` with a 2 px `--em-ink-3` border. On: accent fill with a 2 px inset `--em-accent-text` ring. White 26 px knob with `--em-shadow-sm`.
- **Checkbox**: 24 px, radius 8; checked is accent fill with an on-accent check.
- **Chips** (greeting subline, "Current", category chips): glass, radius pill, 30 px tall (inside 44 px hit areas when interactive), fs-sm weight 700, ink-2.
- **Focus indicator** (every focusable element): `outline: 2px solid var(--em-focus-ring); outline-offset: 2px; box-shadow: 0 0 0 4px var(--em-focus-halo)`. The two-tone ring is visible against every sky stop and every surface (table in section 12).
- **Desktop nav** (at least 900 px): a 72 px row with no background. Left: 28 px cloud friend glyph and "Em Time" (20 px, 800, `--sky-ink`, on sky). Right: a glass pill group (52 px tall, 4 px padding) holding four tabs, each a 44 px pill with an 18 px icon and label (15 px, 700). Active tab: accent fill, on-accent text, 2 px inset accent-text ring. While a focus phase runs, inactive tab labels use `--em-ink-2` (v1 rule, now verified on glass).
- **Phone nav** (below 900 px): a floating glass bar, 12 px from the sides and `12px + env(safe-area-inset-bottom)` from the bottom, 64 px tall, radius 24, four items each at least 44 by 44. Active item: a 48 by 30 accent pill behind the icon and the label at 800. Page content gets bottom padding `64px + 24px + env(safe-area-inset-bottom)`.
- Icons: the v1 inline SVG set, stroke width raised from 1.75 to 2.25 with round joins for a softer look.

## 7. Screens

The scene is behind every screen. Content max width 1120 px (Settings 640 px). Only the header-band texts sit on the sky; everything else is on glass or cards.

### 7.1 Timer

1280:
- Left column (flex 1): header band with the greeting (`--em-fs-greet`, `--sky-ink`) and under it the subline chip (glass). Then the mode switcher (glass segmented). Then the **ring bubble**: a `min(380px, 46vh)` glass circle (so Play stays above the fold at 1024x768) (the timer face) with a 10 px ring stroke inset 14 px from its edge, track `--em-ring-track`, fill `--em-ring-fill`, round caps, draining clockwise from 12 o'clock as in v1. Inside: digits, the task name button (fs-lg, ink-2), cycle dots (8 px, filled `--em-ring-fill`, empty `--em-ring-track`). The breathing glow (v1 TMR-16) is now a soft `box-shadow` halo around the bubble in `--em-ring-glow`, cycling 12 to 28 px over 4 s during a running focus phase. The mascot sits at the bubble's lower left (3.3). Below: Reset, Play, Skip. Then the message line, now in a glass chip (fs-md, ink, max 480 px) shown only when there is a message. Then the break card (card, "Break idea" label in ink-3 and prompt in ink).
- Right column (360 px): "Today" card and "Up next" card as in v1, restyled.
- Changes from v1: greeting and subline are new; the ring sits on a glass bubble instead of the page; the message line moves onto a chip; mascot added; confetti replaced by the sticker burst.

390:
- Header row: greeting (24 px, up to 2 lines) on the left, mascot 68 px on the right; subline chip under the greeting. Mode switcher full width. Bubble `min(76vw, 296px)`, ring stroke 8 px, digits `clamp(68px, 19vw, 124px)`. Controls (Play 68 px). Message chip. Break card. Today strip (card, goal ring 40 px) above the floating nav. At 390 by 844 the Play button must be visible without scrolling; the page may scroll below it.

### 7.2 Tasks

1280: title row (title on sky, mascot 56 px at the right end). Left two thirds: an add-task card (input, category select, Add) and the open list in one card, the collapsible "Done (n)" list in a second card. Right third: "Categories" card. Rows keep the v1 structure; row height 56; the current row gets `--em-accent-soft` and a glass "Current" chip in accent-text.
390: single column; title row with mascot 48 px; add-task card stacks as in v1; "Manage categories" opens a bottom sheet (`--em-surface-solid`).
Changes from v1: everything sits on cards over the sky; rounder rows and checkboxes; mascot in the title row and the empty state.

### 7.3 Stats

1280: title row with mascot. Row of three tiles (cards): Today (goal ring 120 px), Current streak, Best streak. Then each section: the section title as a glass label (a pill-cornered tab, `--em-glass`, 40 px tall, padding 0 18 px, `--em-fs-section`, `--em-ink`), because sections scroll over the horizon and hills where on-sky ink cannot be guaranteed; controls in the same header row as glass controls (week arrows and "This week" pill; the 30 / 90 / 365 segmented), then the chart card (`--em-surface-solid`). The subtitle that v1 placed under the section title ("Oct 12 to Oct 18", "Daily focus, 7-day average", "Daily focus time against your goal of 2h") moves inside the card as its first line (fs-sm, ink-2), because small text may not sit on the sky. Grid and section order as v1 (week columns 7 cols plus per-task 5 cols, heatmap 6 plus summary 6, trend full width).
390: single column in v1 order. Section title labels on glass, controls on a second header row when they do not fit.
Changes from v1: section titles become glass labels; subtitles move into cards; tiles and cards are glass and rounder; the export banner is a card.

### 7.4 Settings

Single column of cards, max 640 px. Order:
1. **You** (new): "Your name" text input (label visible, placeholder "Em", `maxlength` 24, helper "Used in greetings. Leave it blank for no name.", fs-xs ink-3).
2. Timer, 3. Daily goal, 4. Sound, 5. Notifications, 6. Breaks and messages: as v1.
7. **Appearance**: "Theme" with three options, "Follow the sky" (default), "Always light", "Always dark": a segmented control at 1280 and a radio list of three 48 px rows at 390 (the labels do not fit three pills). Helper under it: "Follow the sky changes colors with the time of day." Then "Cloud friend" switch (helper "A little cloud that keeps you company.") and "Sky stickers" switch (helper "Tiny stickers that float by and celebrate finished sessions."). Then "Week starts on" and the 6 AM note, as v1.
8. Sync, 9. Your data, 10. About: as v1.

### 7.5 Dialogs, sheets, banners, update pill

Dialogs and sheets: `--em-surface-solid`, radius 28, `--em-shadow-lg`, scrim with 4 px blur. Banners: cards (`--em-danger-soft` for errors, `--em-surface` for the export reminder). Update pill: glass, above the phone nav.

## 8. Charts on the sky

- Every chart sits on a `--em-surface-solid` card (97% opaque light, 95% dark). Marks keep the fixed, validated v1 colors: the v1 light set while polarity is light, the v1 dark set while polarity is dark. Only the surroundings move with the time of day. Measured on the composited chart card at the worst sky minute: heat-3 (week columns, trend line) 4.2:1 light and 6.7:1 dark; heat-1 against the card 2.04:1 light and 2.3:1 dark (the v1 gate is 2:1); heat-1 against heat-0 1.87:1 and 2.12:1 (same as v1, unchanged colors).
- On a polarity flip, mark fills and strokes cross-fade 600 ms together with the card.
- Shape changes (rounder, same forms): week columns get a 6 px top radius (capped at half the column width); per-task bars 10 px tall with fully rounded ends; heatmap cells radius 6 with the same 4 px gap; trend line 2.5 px; goal ring stroke ends round as before; legend swatches become 10 px rounded squares (radius 3), still next to their names.
- Axis text: fs-xs, weight 600, `--em-ink-3` (verified on cards, never placed on glass).
- Captions and empty-state lines inside chart cards: unchanged v1 copy, fs-sm ink-2.
- Tooltip: `--em-surface-solid`, radius 18, `--em-shadow-lg`, value first (fs-sm 800 ink), label second (fs-xs ink-3).
- "Show as table" stays (A11Y-4); tables render on the same card.
- Everything else in v1 section 8 (forms, scales, label rules, interaction, keyboard) is unchanged.

## 9. Greeting, subline and empty states

All copy in `frontend/src/data/messages.json` under `sky` (verbatim list in `spec.md` Appendix D). Name and copy are inserted with `textContent`.

- **Window** by the real local clock: dawn 04:30 to 06:59, morning 07:00 to 11:59, afternoon 12:00 to 16:59, evening 17:00 to 20:59, night 21:00 to 04:29.
- **Variant**: each window has 3 lines; the variant is chosen by a stable hash of `studyDay + window`, so it does not change during a visit but varies day to day.
- **Name**: lines are `"<salutation>, {name}"`. With a blank name the `", {name}"` part is dropped.
- **Night rule**: every night line contains "night" and none of these words appear in any greeting or subline: late, sleep, sleepy, tired, bed, bedtime, exhausted. Night is framed as "lights on", never as "it's late".
- **Subline** (glass chip), first match wins:
  1. Today has sessions and current streak is 7 or more: "{n}-day streak, look at you"
  2. Today has sessions and current streak is 2 or more: "{k} session(s) today · {n}-day streak"
  3. Today has sessions: "{k} session(s) today"
  4. No sessions today and current streak is 1 or more: "Keep your {n}-day streak going" (n = 1: "Keep your streak going")
  5. Otherwise: "Ready when you are"
  Numbers are digits; "session" is singular for 1.
- **Empty states**: v1 copy is kept verbatim (EDGE-8). Tasks empty and Stats first run (no sessions ever) also show the 72 px `idle` mascot beside the caption, decorative only.

## 10. Motion summary

| Thing | Duration | Notes |
|---|---|---|
| Polarity cross-fade | 600 ms | colors only |
| Cloud drift | 160 / 210 / 250 s | transform only |
| Star twinkle | 3 to 5 s | opacity only |
| Sun rays | 90 s per turn | transform only |
| Sticker drift | 30 to 42 s | transform only |
| Sticker burst | 1400 ms | transform and opacity |
| Mascot states | see 3.2 | transform only |
| Bubble glow | 4 s | box-shadow, focus phase running only |
| Views | 200 ms cross-fade | as v1 |

v1 durations, easings and the ring rules (rAF-driven progress, 600 ms refill) still hold.

## 11. Performance rules

- CSS animations only, on `transform` and `opacity` (plus the bubble glow's `box-shadow`). No JS animation loops besides the existing ring rAF.
- No canvas drawing (the one-time emoji support probe in 4.2 is the only canvas, never attached). No WebGL, no images for the scene: inline SVG and gradients.
- At most 3 clouds, a fixed star count (28 or 16), at most 3 drifting stickers, and burst nodes removed after 1.5 s.
- The sky is recomputed once a minute (aligned to the minute boundary), on `visibilitychange` to visible, and on resize (debounced 150 ms) for positions only. One write of about 30 custom properties per recompute, no layout reads in the tick.
- When the page is hidden: `html[data-hidden]` sets `animation-play-state: paused` on every scene, mascot and sticker animation, the sticker spawner stops, and no burst is queued.
- The scene layer is `position: fixed; inset: 0; z-index: 0; contain: strict`; drifting layers get `will-change: transform` only while animating.
- Budgets: initial JS stays under 60 KB gzipped (sky, mascot, stickers and greeting add about 6 KB); CSS under 16 KB gzipped (raised from 12 KB); font one 39 KB woff2.

## 12. Accessibility

- The scene, mascot and stickers are `aria-hidden="true"`, never focusable, never interactive, and never carry information. Turning them off changes no text on the page.
- Contrast was verified for every minute of the day (1,440 samples) in "Follow the sky" plus both fixed modes, compositing glass and cards over the blended top, mid, horizon and both hill colors and taking the worst. Normal text 4.5:1, large on-sky text 3:1, focus indicator and non-text UI 3:1, chart marks per section 8. Zero failures.
- Keyframe table (minimum ratio across the sky colors at that keyframe):

| Keyframe | Sky ink | Sky ink on top / mid | Card ink | Card ink-2 | Card ink-3 | Card accent-text | Card danger | Glass ink | Glass ink-2 | Glass accent-text | Focus ring vs sky | Heat-3 on chart card |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| latenight 02:30 (dark) | `#FFFFFF` | 19.3 / 16.6 | 14.3 | 8.3 | 6.1 | 10.4 | 8.6 | 13.9 | 8.1 | 10.1 | 7.9 | 7.2 |
| dawn 06:00 (light) | `#10263F` | 9.1 / 10.8 | 15.5 | 7.1 | 5.1 | 6.0 | 6.2 | 13.9 | 6.4 | 5.4 | 5.5 | 4.3 |
| morning 08:30 (light) | `#10263F` | 7.1 / 10.1 | 15.3 | 7.1 | 5.1 | 5.9 | 6.1 | 13.5 | 6.2 | 5.2 | 4.9 | 4.3 |
| midday 12:30 (light) | `#10263F` | 6.0 / 8.5 | 15.1 | 6.9 | 5.0 | 5.8 | 6.0 | 12.9 | 5.9 | 5.0 | 4.1 | 4.2 |
| afternoon 16:00 (light) | `#10263F` | 5.9 / 9.1 | 15.1 | 7.0 | 5.0 | 5.8 | 6.0 | 12.9 | 5.9 | 5.0 | 4.0 | 4.2 |
| dusk 18:30 (dark) | `#FFFFFF` | 9.4 / 5.8 | 12.0 | 7.0 | 5.1 | 8.7 | 7.2 | 9.7 | 5.6 | 7.1 | 3.6 | 6.7 |
| evening 20:30 (dark) | `#FFFFFF` | 13.6 / 9.6 | 13.4 | 7.8 | 5.7 | 9.7 | 8.0 | 12.2 | 7.1 | 8.8 | 3.7 | 7.0 |
| night 23:00 (dark) | `#FFFFFF` | 18.2 / 15.1 | 14.0 | 8.2 | 5.9 | 10.2 | 8.5 | 13.4 | 7.8 | 9.8 | 6.5 | 7.1 |

- Worst minutes found by the sweep (all passing): sky ink 3.10:1 at 17:19 (large text only, threshold 3:1); glass accent-text 4.52:1 at 16:59; glass ink-2 4.99:1 at 17:00; card ink-3 4.78:1 at 17:00; focus indicator 3.24:1 at 16:28; heat-1 on the chart card 2.04:1 at 16:59. These minutes are part of the e2e axe set.
- Rules: ink-3 only on cards, never on glass; accent fills are decoration (selected states also carry the inset accent-text edge and weight 800); category colors keep the v1 relief rule (always beside their names).
- axe cannot compute contrast over gradients and translucent layers and reports those nodes as "incomplete". The proof for those pairs is the unit sweep; e2e axe must still report zero serious or critical violations.
- v1 rules that still hold: timer live region and throttle (A11Y-3), keyboard paths, dialogs trap focus, 44 px targets, visible labels, chart tables, `forced-colors` (the scene is hidden under `forced-colors: active`, and glass and cards become `Canvas` with a `CanvasText` border).

## 13. PWA and icon

- `<meta name="theme-color">` is set to the current `--sky-top` on every recompute.
- Manifest: `description` "Your little sky for focus.", `theme_color` `#4FA8EE`, `background_color` `#8CC8F5`; everything else as v1.
- iOS: `apple-mobile-web-app-status-bar-style` changes to `black-translucent` so the sky runs under the status bar; the header pads with `env(safe-area-inset-top)`.
- HTML shell before JS: an inline 6-line script sets `data-theme` and the body background (`#8CC8F5` from 05:15 to 16:59, `#16244D` otherwise) so the first paint matches the coming sky.
- **Icon** (`frontend/public/icon.svg`, 512 viewBox, regenerated rasters as v1): full-bleed linear gradient `#6EB8F2` to `#BFE3FB` top to bottom; a sun disc `#FFE07A` r 44 at (356,170) peeking behind the cloud's upper right; the cloud friend in the `idle` state, scaled to 300 px wide, centered at (256,286), day colors, outline `#A9D2F2` scaled to 8 px. All content inside the central 80% (maskable safe zone). The favicon is the same SVG. The desktop nav glyph is the mascot body and face at 28 px.
