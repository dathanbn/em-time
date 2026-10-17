// The sky: eight clock-keyed keyframes blended continuously in OKLab (design.md section 2), the
// sun and moon arcs, the polarity snap, and the writer that puts it all on <html> as custom
// properties. The pure parts (skyAt, skyFor, polarityAt, arcPosition, moonPhase, contrastRatio,
// composite) have no DOM access and are unit tested in Node.
import type { ThemeId } from '@core';

export type SkyPhaseId =
  | 'latenight'
  | 'dawn'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'dusk'
  | 'evening'
  | 'night';
export type Polarity = 'light' | 'dark';

export interface SkyKeyframe {
  id: SkyPhaseId;
  atMin: number;
  top: string;
  mid: string;
  horizon: string;
  hillBack: string;
  hillFront: string;
  sunInner: string;
  sunOuter: string;
  sunGlow: string;
  moonGlow: string;
  cloudFill: string;
  cloudOpacity: number;
  starOpacity: number;
}

const kf = (
  id: SkyPhaseId,
  atMin: number,
  sky: [string, string, string, string, string],
  sun: [string, string, string, string],
  cloud: [string, number, number],
): SkyKeyframe => ({
  id,
  atMin,
  top: sky[0],
  mid: sky[1],
  horizon: sky[2],
  hillBack: sky[3],
  hillFront: sky[4],
  sunInner: sun[0],
  sunOuter: sun[1],
  sunGlow: sun[2],
  moonGlow: sun[3],
  cloudFill: cloud[0],
  cloudOpacity: cloud[1],
  starOpacity: cloud[2],
});

export const SKY_KEYFRAMES: readonly SkyKeyframe[] = [
  kf(
    'latenight',
    150,
    ['#070D22', '#101C40', '#22305E', '#18234A', '#111A3A'],
    ['#FFD9A0', '#FF7A59', 'rgba(255,140,100,0)', 'rgba(150,170,255,0.35)'],
    ['#4A578A', 0.18, 1],
  ),
  kf(
    'dawn',
    360,
    ['#A9CBF0', '#F6CFD6', '#FFDDB5', '#B9D3EE', '#9CC0E6'],
    ['#FFF1C9', '#FFB46B', 'rgba(255,180,107,0.55)', 'rgba(150,170,255,0.15)'],
    ['#FFF4F0', 0.9, 0.15],
  ),
  kf(
    'morning',
    510,
    ['#6EB8F2', '#A9D8FA', '#E3F3FD', '#C6E9E4', '#A8DCD4'],
    ['#FFFBE6', '#FFD86B', 'rgba(255,236,170,0.60)', 'rgba(150,170,255,0)'],
    ['#FFFFFF', 1, 0],
  ),
  kf(
    'midday',
    750,
    ['#4FA8EE', '#8CC8F5', '#D6EEFC', '#BFE6D9', '#9FD6C6'],
    ['#FFFDF0', '#FFE07A', 'rgba(255,244,190,0.65)', 'rgba(150,170,255,0)'],
    ['#FFFFFF', 1, 0],
  ),
  kf(
    'afternoon',
    960,
    ['#5AA7E6', '#A3CDEF', '#FBE3C6', '#C3E2D2', '#A6D2BD'],
    ['#FFF4D6', '#FFC861', 'rgba(255,214,140,0.60)', 'rgba(150,170,255,0)'],
    ['#FFFDF8', 0.95, 0],
  ),
  kf(
    'dusk',
    1110,
    ['#363F88', '#7D5596', '#F09A7E', '#5A4F8E', '#463F7A'],
    ['#FFD9A0', '#FF7A59', 'rgba(255,140,100,0.55)', 'rgba(190,180,255,0.30)'],
    ['#F6C3D0', 0.7, 0.35],
  ),
  kf(
    'evening',
    1230,
    ['#1E2A5E', '#34407E', '#6B5A94', '#2A3468', '#222B58'],
    ['#FFD9A0', '#FF7A59', 'rgba(255,140,100,0)', 'rgba(170,190,255,0.45)'],
    ['#7C88BC', 0.35, 0.8],
  ),
  kf(
    'night',
    1380,
    ['#0B1430', '#16244D', '#2B3D73', '#1A2A55', '#142147'],
    ['#FFD9A0', '#FF7A59', 'rgba(255,140,100,0)', 'rgba(159,180,255,0.40)'],
    ['#56639A', 0.22, 1],
  ),
];

/** Polarity snap times: light from 05:15 to 16:59, dark otherwise. */
export const POLARITY_FLIP_MIN = { toLight: 315, toDark: 1020 } as const;
export const SKY_INK = { dark: '#10263F', light: '#FFFFFF' } as const;
/** Label ink on clear glass (v5): navy, or the near-white of the dark theme. */
export const GLASS_INK = { navy: '#10263F', white: '#EEF5FF' } as const;

/** Pinned clocks for the fixed theme modes: 12:30 and 02:30. */
const PIN_LIGHT = 750;
const PIN_DARK = 150; // 02:30, the deepest night (moon high, stars out)

// ---- color math ------------------------------------------------------------------------------

type Lab = [number, number, number];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToLab(hex: string): Lab {
  const [R, G, B] = hexToRgb(hex);
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(R);
  const g = lin(G);
  const b = lin(B);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const mixHex = (a: string, b: string, t: number): string => {
  if (t <= 0) return a.toUpperCase();
  if (t >= 1) return b.toUpperCase();
  const A = hexToLab(a);
  const B = hexToLab(b);
  return labToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
};

const num = (a: number, b: number, t: number): number => a + (b - a) * t;

function parseRgba(c: string): [number, number, number, number] {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  const p = (m ? m[1]! : '0,0,0,1').split(',').map((x) => parseFloat(x));
  return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
}

const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;

function mixRgba(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const A = parseRgba(a);
  const B = parseRgba(b);
  const r = A.map((v, i) => num(v, B[i]!, t));
  return `rgba(${Math.round(r[0]!)},${Math.round(r[1]!)},${Math.round(r[2]!)},${round(r[3]!, 3)})`;
}

function relLum(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two opaque hex colors. */
export function contrastRatio(fg: string, bg: string): number {
  const a = relLum(fg);
  const b = relLum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Alpha-composites an `rgba()` color over an opaque hex color and returns an opaque hex. */
export function composite(rgba: string, under: string): string {
  const [r, g, b, a] = parseRgba(rgba);
  const [R, G, B] = hexToRgb(under);
  const f = (s: number, u: number) => Math.round(s * a + u * (1 - a));
  return `#${[f(r, R), f(g, G), f(b, B)].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// ---- clear glass -------------------------------------------------------------------------------

const GLASS_TARGET = 4.6; // above the 4.5:1 floor so rounding cannot tip it under
/**
 * Where the clear glass sits on the sky gradient, as fractions of the viewport height: the mode
 * selector and desktop tabs in the upper part, the phone Sounds and stopwatch pills in the lower.
 */
const GLASS_ZONES = { top: [0, 0.2, 0.3, 0.4], low: [0.55, 0.7, 0.8, 0.85] } as const;
/** White the glass itself adds under a label: a plain label (fill) and a selected or hovered one (bead), per polarity. */
const GLASS_LIFT = { light: [0.06, 0.4], dark: [0.04, 0.23] } as const;

const lerpHex = (a: string, b: string, t: number): string => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * Clear glass keeps almost nothing under its labels, so the label ink is picked per minute: navy or
 * white, whichever needs the thinner scrim, plus (only where neither reaches 4.5:1 over the sky behind
 * the glass) a scrim of the opposite tone under it. The sky is sampled down the scene gradient
 * (top 0%, mid 55%, horizon 100%) at the heights of one zone.
 */
export function glassFor(
  sky: { top: string; mid: string; horizon: string },
  polarity: Polarity,
  preferNavy: boolean,
  zone: keyof typeof GLASS_ZONES,
): { ink: string; scrim: string } {
  const under = GLASS_ZONES[zone].map((y) =>
    y <= 0.55 ? lerpHex(sky.top, sky.mid, y / 0.55) : lerpHex(sky.mid, sky.horizon, (y - 0.55) / 0.45),
  );
  const [plain, bead] = GLASS_LIFT[polarity];
  const order = preferNavy ? (['navy', 'white'] as const) : (['white', 'navy'] as const);
  let best = { ink: GLASS_INK.navy as string, scrim: 'transparent', alpha: Infinity };
  for (const tone of order) {
    const ink = GLASS_INK[tone];
    const base = tone === 'navy' ? '255,255,255' : '8,16,40';
    const lift = tone === 'navy' ? plain : bead;
    for (let a = 0; a <= 0.7001 && a < best.alpha; a += 0.05) {
      const alpha = Math.round(a * 100) / 100;
      const ok = under.every(
        (u) =>
          contrastRatio(
            ink,
            composite(`rgba(255,255,255,${lift})`, alpha ? composite(`rgba(${base},${alpha})`, u) : u),
          ) >= GLASS_TARGET,
      );
      if (ok) {
        best = { ink, scrim: alpha ? `rgba(${base},${alpha})` : 'transparent', alpha };
        break;
      }
    }
  }
  return { ink: best.ink, scrim: best.scrim };
}

// ---- state -----------------------------------------------------------------------------------

export interface BodyState {
  visible: boolean;
  p: number;
  opacity: number;
}

export interface SkyState {
  minutes: number;
  phase: SkyPhaseId;
  polarity: Polarity;
  top: string;
  mid: string;
  horizon: string;
  hillBack: string;
  hillFront: string;
  sunInner: string;
  sunOuter: string;
  sunGlow: string;
  moonGlow: string;
  cloudFill: string;
  cloudOpacity: number;
  starOpacity: number;
  ink: string;
  glassInk: string;
  glassScrim: string;
  glassInkLow: string;
  glassScrimLow: string;
  sun: BodyState;
  moon: BodyState & { illumination: number; waxing: boolean };
}

export function polarityAt(minutes: number): Polarity {
  const m = ((minutes % 1440) + 1440) % 1440;
  return m >= POLARITY_FLIP_MIN.toLight && m < POLARITY_FLIP_MIN.toDark ? 'light' : 'dark';
}

/** Nearest keyframe by circular distance in minutes; ties go to the later keyframe. */
export function nearestPhase(minutes: number): SkyPhaseId {
  const m = ((minutes % 1440) + 1440) % 1440;
  let best = SKY_KEYFRAMES[0]!;
  let bestD = Infinity;
  let bestAhead = false;
  for (const k of SKY_KEYFRAMES) {
    const forward = (k.atMin - m + 1440) % 1440;
    const d = Math.min(forward, 1440 - forward);
    const ahead = forward <= 720; // the later keyframe (still to come) wins ties
    if (d < bestD || (d === bestD && ahead && !bestAhead)) {
      best = k;
      bestD = d;
      bestAhead = ahead;
    }
  }
  return best.id;
}

const SUN_START = 330; // 05:30
const SUN_SPAN = 840; // to 19:30
const MOON_START = 1140; // 19:00
const MOON_SPAN = 690; // to 06:30 next day
const FADE_MIN = 20;

function body(elapsed: number, span: number): BodyState {
  if (elapsed < 0 || elapsed > span) return { visible: false, p: 0, opacity: 0 };
  const p = elapsed / span;
  const opacity = Math.min(1, elapsed / FADE_MIN, (span - elapsed) / FADE_MIN);
  return { visible: true, p, opacity: Math.max(0, opacity) };
}

/** Lunar phase from the mean synodic month, anchored at the 2000-01-06 new moon. */
export function moonPhase(now: Date): { illumination: number; waxing: boolean } {
  const SYNODIC = 29.530588853;
  const days = (now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  return { illumination: (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2, waxing: age < SYNODIC / 2 };
}

/** Pure: the whole sky at a local clock time (minutes since midnight). `date` only drives the moon phase. */
export function skyAt(minutes: number, date: Date = new Date()): SkyState {
  const t = ((minutes % 1440) + 1440) % 1440;
  const n = SKY_KEYFRAMES.length;
  let ai = n - 1;
  for (let i = 0; i < n; i++) if (SKY_KEYFRAMES[i]!.atMin <= t) ai = i;
  const A = SKY_KEYFRAMES[ai]!;
  const B = SKY_KEYFRAMES[(ai + 1) % n]!;
  const aAt = A.atMin <= t ? A.atMin : A.atMin - 1440;
  const bAt = B.atMin > aAt ? B.atMin : B.atMin + 1440;
  const k = (t - aAt) / (bAt - aAt);
  const top = mixHex(A.top, B.top, k);
  const mid = mixHex(A.mid, B.mid, k);
  const ink = Math.min(contrastRatio(SKY_INK.dark, top), contrastRatio(SKY_INK.dark, mid)) >=
    Math.min(contrastRatio(SKY_INK.light, top), contrastRatio(SKY_INK.light, mid))
    ? SKY_INK.dark
    : SKY_INK.light;
  const horizon = mixHex(A.horizon, B.horizon, k);
  const polarity = polarityAt(t);
  const navy = ink === SKY_INK.dark;
  const glass = glassFor({ top, mid, horizon }, polarity, navy, 'top');
  const glassLow = glassFor({ top, mid, horizon }, polarity, navy, 'low');
  const moonElapsed = t >= MOON_START ? t - MOON_START : t + 1440 - MOON_START;
  return {
    minutes: t,
    phase: nearestPhase(t),
    polarity,
    top,
    mid,
    horizon,
    hillBack: mixHex(A.hillBack, B.hillBack, k),
    hillFront: mixHex(A.hillFront, B.hillFront, k),
    sunInner: mixHex(A.sunInner, B.sunInner, k),
    sunOuter: mixHex(A.sunOuter, B.sunOuter, k),
    sunGlow: mixRgba(A.sunGlow, B.sunGlow, k),
    moonGlow: mixRgba(A.moonGlow, B.moonGlow, k),
    cloudFill: mixHex(A.cloudFill, B.cloudFill, k),
    cloudOpacity: round(num(A.cloudOpacity, B.cloudOpacity, k)),
    starOpacity: round(num(A.starOpacity, B.starOpacity, k)),
    ink,
    glassInk: glass.ink,
    glassScrim: glass.scrim,
    glassInkLow: glassLow.ink,
    glassScrimLow: glassLow.scrim,
    sun: body(t - SUN_START, SUN_SPAN),
    moon: { ...body(moonElapsed, MOON_SPAN), ...moonPhase(date) },
  };
}

/** The sky for a theme mode: 'light' pins 12:30, 'dark' pins 02:30, 'sky' follows the clock. */
export function skyFor(mode: ThemeId, now: Date): SkyState {
  if (mode === 'light') return skyAt(PIN_LIGHT, now);
  if (mode === 'dark') return skyAt(PIN_DARK, now);
  return skyAt(now.getHours() * 60 + now.getMinutes(), now);
}

/** Back hill height in px: clamp(84px, 18vh, 170px). */
export const backHillHeight = (vh: number): number => Math.min(170, Math.max(84, vh * 0.18));

/** Body center in px and body size, for a viewport. Rises left, sets right, sinks behind the back hill. */
export function arcPosition(
  p: number,
  vw: number,
  vh: number,
  kind: 'sun' | 'moon',
): { x: number; y: number; size: number } {
  const desktop = vw >= 900;
  const size = kind === 'sun' ? (desktop ? 88 : 64) : desktop ? 64 : 48;
  const horizon = vh - backHillHeight(vh) + size * 0.35;
  // Phone: the moon skims the strip between the stats card and the hills, clear of the timer bubble.
  const apex = desktop ? 296 : kind === 'moon' ? Math.max(180, horizon - 56) : 180;
  const x = vw * (0.06 + 0.88 * p);
  const y = horizon - Math.sin(Math.PI * p) * Math.max(0, horizon - apex);
  return { x, y, size };
}

// ---- DOM writer ------------------------------------------------------------------------------

const px = (n: number): string => `${Math.round(n * 10) / 10}px`;

/** Writes the sky custom properties and the html attributes, and syncs the theme-color meta. */
export function applySky(state: SkyState, root: HTMLElement = document.documentElement): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = root.style;
  const set = (k: string, v: string) => s.setProperty(k, v);
  set('--sky-top', state.top);
  set('--sky-mid', state.mid);
  set('--sky-horizon', state.horizon);
  set('--sky-hill-back', state.hillBack);
  set('--sky-hill-front', state.hillFront);
  set('--sky-ink', state.ink);
  set('--sky-lg-ink', state.glassInk);
  set('--sky-lg-scrim', state.glassScrim);
  set('--sky-lg-ink-low', state.glassInkLow);
  set('--sky-lg-scrim-low', state.glassScrimLow);
  set('--sky-ink-shadow', state.ink === SKY_INK.dark ? 'rgba(255,255,255,0.5)' : 'rgba(10,22,50,0.5)');
  set('--sky-sun-inner', state.sunInner);
  set('--sky-sun-outer', state.sunOuter);
  set('--sky-sun-glow', state.sunGlow);
  set('--sky-moon-glow', state.moonGlow);
  set('--sky-cloud-fill', state.cloudFill);
  set('--sky-cloud-opacity', String(state.cloudOpacity));
  set('--sky-star-opacity', String(state.starOpacity));
  set('--sky-star-vis', state.starOpacity > 0 ? 'visible' : 'hidden');
  const sun = arcPosition(state.sun.p, vw, vh, 'sun');
  set('--sky-sun-x', px(sun.x));
  set('--sky-sun-y', px(sun.y));
  set('--sky-sun-size', px(sun.size));
  set('--sky-sun-opacity', String(round(state.sun.opacity)));
  set('--sky-sun-display', state.sun.visible ? 'block' : 'none');
  const moon = arcPosition(state.moon.p, vw, vh, 'moon');
  set('--sky-moon-x', px(moon.x));
  set('--sky-moon-y', px(moon.y));
  set('--sky-moon-size', px(moon.size));
  set('--sky-moon-opacity', String(round(state.moon.opacity)));
  set('--sky-moon-display', state.moon.visible ? 'block' : 'none');
  root.dataset.theme = state.polarity;
  root.dataset.skyPhase = state.phase;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.top);
}

let currentMode: () => ThemeId = () => 'sky';
let onState: ((s: SkyState) => void) | undefined;

/** Recompute and write right now (after a theme change, a visibility change or a resize). */
export function refreshSky(): void {
  const mode = currentMode();
  const state = skyFor(mode, new Date());
  document.documentElement.dataset.themeMode = mode;
  applySky(state);
  onState?.(state);
}

/**
 * Starts the sky: writes now, then once per minute aligned to the minute boundary, again when the
 * page becomes visible, and (debounced) on resize. Returns a stop function.
 */
export function startSky(getMode: () => ThemeId, onApply?: (s: SkyState) => void): () => void {
  currentMode = getMode;
  onState = onApply;
  const root = document.documentElement;
  let timer = 0;
  let resizeTimer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    const now = Date.now();
    timer = window.setTimeout(
      () => {
        refreshSky();
        schedule();
      },
      60_000 - (now % 60_000) + 30,
    );
  };
  const onVisibility = () => {
    root.toggleAttribute('data-hidden', document.hidden);
    if (!document.hidden) {
      refreshSky();
      schedule();
    }
  };
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(refreshSky, 150);
  };
  root.toggleAttribute('data-hidden', document.hidden);
  refreshSky();
  schedule();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  return () => {
    window.clearTimeout(timer);
    window.clearTimeout(resizeTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
  };
}
