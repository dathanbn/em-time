# Focus sounds (white noise), v4 feature spec

Approved by Dathan 2026-10-17: mix of synthesized + recorded sounds; plays during focus only, with an on/off toggle; controls on the Timer screen and in Settings.

## 1. Sound catalog (9 sounds)

| id | Label | Emoji | Source | File / loop |
|---|---|---|---|---|
| `white` | White noise | ❄️ | synth | n/a |
| `pink` | Pink noise | 🌸 | synth | n/a |
| `brown` | Brown noise | 🍂 | synth | n/a |
| `rain` | Rain | 🌧️ | recorded | `sounds/rain.m4a`, loop 40 s |
| `waves` | Ocean | 🌊 | recorded | `sounds/waves.m4a`, loop 40 s |
| `stream` | Stream | 💧 | recorded | `sounds/stream.m4a`, loop 40 s |
| `cafe` | Café | ☕ | recorded | `sounds/cafe.m4a`, loop 14.5 s |
| `fireplace` | Fireplace | 🔥 | recorded | `sounds/fireplace.m4a`, loop 23 s |
| `night` | Summer night | 🌙 | recorded | `sounds/night.m4a`, loop 45 s |

Recorded files are already in `frontend/public/sounds/` (AAC-LC 80 kbps stereo 44.1 kHz, ~2 MB total). Each was cut with an equal-power crossfade baked in so `buffer` played with `loop = true`, `loopStart = 0`, `loopEnd = loopSec` (table) is seamless. All six are loudness-normalized to -26 LUFS integrated, so they need no per-sound trim. Synth noise must be calibrated to sound about as loud (target RMS, recalibrated by measuring LUFS: white 0.022 (-27 LUFS), pink 0.037, brown 0.043 (-26 LUFS) at volume 1 before the master curve; adjust by ear-equivalent: render each in an OfflineAudioContext in a unit test and assert RMS within ±1.5 dB of its target).

Credits (show in Settings, small text under the sound list, and write `frontend/public/sounds/CREDITS.md`):
- Rain by alex36917 (freesound.org/s/524605) and Ocean by Luftrum (freesound.org/s/48412), CC BY, edited by Porrumentzio for the Blanket app; looped for Em Time.
- Stream by gluckose (freesound.org/s/333987), CC0.
- Café by stephan, Fireplace by ezwa, Summer night by Lisa Redfern (SoundBible), public domain.

## 2. Settings (core, device-only, like `mascot`/`stickers`)

Add to `Settings` in `core/types.ts`:
- `noiseOn: boolean`, default `false`.
- `noise: NoiseId`, default `'rain'`. `NoiseId = 'white' | 'pink' | 'brown' | 'rain' | 'waves' | 'stream' | 'cafe' | 'fireplace' | 'night'`. Export a `NOISE_IDS` constant.
- `noiseVolume: number` 0..1, default `0.5` (separate from chime `volume`). Range in `LIMITS` like `volume`.

Rules: device-only (never pushed in the settings row, never applied from a pulled row, same mechanism as `mascot`/`stickers`); included in export/import like other device-only settings are today (follow whatever `mascot` does). Additive: NO schema bump. `validate.ts` fills missing keys with defaults and replaces an unknown `noise` id with the default. `updateSettings` validates (`ValidationError('noise','required')` for unknown ids, `'limit'` for volume out of range, booleans). Editing these must NOT change `settings.updatedAt` semantics for synced keys differently from how `mascot` edits do (mirror it). Update stub fixture/defaults only if needed for types. Add core unit tests (pattern: `core/settings.v2.test.ts`) and fix any existing tests that enumerate settings keys.

## 3. Audio engine: `frontend/src/platform/noise.ts` (lazy chunk)

- Reuse the chime `AudioContext`: export a `getAudioCtx()` from `platform/audio.ts` (keep `playChime` behavior identical).
- Graph: `AudioBufferSourceNode(loop) -> mixGain -> masterNoiseGain -> ctx.destination`. One source at a time; switching sound crossfades (old fades out 0.6 s while new fades in 0.6 s).
- Volume curve: gain = `noiseVolume² × 1.2`. Changing volume ramps over 80 ms (no zipper noise).
- Fade in 1.5 s on start, fade out 1.0 s on stop; after fade-out stop and disconnect sources. Use `setTargetAtTime` or linear ramps; always `cancelScheduledValues` first so rapid toggles never jump or click.
- Synth: generate one stereo AudioBuffer per color on first use (10 s, independent L/R, at `ctx.sampleRate`), with the last 0.5 s crossfaded into the start so the loop has no click (brown/pink have low-frequency drift). White: uniform. Pink: Paul Kellet's refined filter. Brown: leaky integrator (`b = (b + 0.02 * w) / 1.02`), DC-free. Normalize each to its target RMS. Cache buffers in a Map.
- Recorded: `fetch(import.meta.env.BASE_URL + 'sounds/<id>.m4a')` -> `arrayBuffer` -> `decodeAudioData` (promise form with callback fallback for old Safari). Cache decoded buffers in memory; dedupe concurrent loads. On failure (offline first time, decode error) report an error state; never throw into the UI.
- iOS: Web Audio is muted by the ring/silent switch unless `navigator.audioSession.type = 'playback'` (Safari 16.4+, feature-detect). Set `'playback'` while noise is audible, restore `'auto'` after the fade-out completes.
- Public API (sketch, refine as needed):
  - `setNoiseDesired(desired: { play: boolean; id: NoiseId; volume: number })` — idempotent; called by the controller whenever inputs change.
  - `previewNoise(id, volume)` — plays the sound for ~5 s then fades out, ignored while noise is already audible for focus (then it just switches the sound live, because the selection changed anyway).
  - `subscribeNoiseState(cb)`, state = `{ status: 'idle' | 'loading' | 'playing' | 'error'; id: NoiseId | null; error?: string }`.

## 4. Controller: when it plays

`desired.play = settings.noiseOn && timer.phase === 'focus' && timer is running` (use the real timer state names). So: starts with Play on a focus session, fades out on Pause, Reset, Skip, phase end (the chime then plays over silence), and during short/long breaks; fades back in when the next focus starts (including auto-start). Changing sound or volume while playing applies live. Turning the toggle off fades out; turning it on mid-focus fades in.

- AudioContext unlock: Play already calls `unlockAudio()`. If the app reloads with a running focus session, the context is suspended until a gesture: add a one-time `pointerdown`/`keydown` listener that resumes it and lets the controller start.
- Hidden tab: keep playing (desktop). Do not tie to `visibilitychange`.
- Bundle: the controller in the main chunk must be tiny and must dynamic-`import('../platform/noise')` only when `noiseOn` is true and focus is running, or a preview is requested. Main-chunk growth for the whole feature must stay ≤ 1.0 KB gzipped (current 58.9 / 60 KB). The picker sheet may also be a lazy chunk if needed. Do not raise the budget; if it is truly impossible, stop and report numbers.

## 5. UI

### Timer screen: sound chip + picker
- A small pill button in the Timer header row (`.thead`), right-aligned, both widths: shows the sound emoji + label when on (`🌧️ Rain`), and a muted style with a speaker-off glyph + "Sounds" when off. 44 px min hit target on phone, frosted like the `.modes` pill. `data-testid="noise-chip"`, `data-state` = `off | idle | loading | playing | error` (`idle` = on but not currently audible, e.g. paused or break). `aria-label` e.g. "Focus sounds: Rain, on" / "Focus sounds: off". `aria-haspopup="dialog"`.
- While `playing`, a subtle 3-bar equalizer animation next to the emoji (CSS only, disabled under `prefers-reduced-motion`).
- Tap opens the picker (reuse `Dialog`; bottom-sheet style on phone if Dialog supports it, else centered). `data-testid="noise-picker"`. Contents, top to bottom:
  1. Title "Focus sounds" and the hint "Plays during focus sessions, pauses on breaks."
  2. A `Switch` "Sounds on" (`data-testid="noise-toggle"`).
  3. A 3-column grid of 9 sound tiles (emoji large, label under), radio semantics (`role="radiogroup"`, each `role="radio"`, arrow-key navigation like the existing Segmented/radio patterns), `data-testid="noise-option-<id>"`. Selected tile has the light-blue selected treatment used elsewhere. Loading tile shows a small spinner; error shows "Couldn't load. Check your connection." under the grid (`data-testid="noise-error"`).
  4. Volume slider "Volume" (`data-testid="noise-volume"`), same component/style as the Sound card slider, 0..100.
- Selecting a tile sets `noise` and turns `noiseOn` on (picking a sound means you want it). If focus is running it switches live; otherwise it plays a ~5 s preview.
- Keyboard shortcut: `N` toggles `noiseOn` (add to `platform/shortcuts.ts` and to any shortcut help list; respect the existing rules for ignoring shortcuts inside inputs).

### Settings
Add a "Focus sounds" section to the existing Sound card (below chime + volume), or a new card right after it if the Sound card gets too long. Same controls as the picker: switch "Play during focus", radio list of the 9 sounds with emoji and a Preview button each (pattern of the chime rows), volume slider. Then the credits text (small, muted). Test ids: `settings-noise-toggle`, `settings-noise-<id>`, `settings-noise-volume`.

Copy tone: friendly, short, no em-dashes anywhere in user-facing text.

## 6. Service worker

Recorded sounds are NOT precached (keep install light). Add a Workbox `runtimeCaching` rule: URL path contains `/sounds/` and ends with `.m4a` -> `CacheFirst`, cache name `em-time-sounds`, `cacheableResponse: { statuses: [0, 200] }`, expiration max 12 entries. So a sound works offline after it played once. Synth sounds always work offline.

## 7. Tests and verification
- Core unit tests (section 2). Engine unit tests where practical (synth buffer RMS, loop crossfade continuity: last sample vs first sample difference small).
- New e2e `tests/e2e/noise.spec.ts` (desktop + phone projects): chip visible and `data-state="off"` on first run; open picker; pick Rain -> toggle on, chip label "Rain"; selection persists after reload; Start focus -> chip `data-state` becomes `playing` (Chromium headless with `--autoplay-policy=no-user-gesture-required` if needed; the Play click is a gesture anyway); Pause -> not `playing`; Settings mirrors the selection; `N` toggles; axe has no violations in the open picker; the `sounds/rain.m4a` request returns 200 from the preview server.
- Full suite must stay green: `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `VITE_E2E=1 npm run build` (includes size check), `npx playwright test`.
- Screenshots of the Timer screen (chip off and on/playing) and the open picker at 390x844 and 1280x800, light and dark; save under `tests/screenshots/noise-*.png`.
