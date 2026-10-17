// Independent colour math for the v2 QA tests. Deliberately NOT imported from the app: WCAG
// contrast, alpha compositing and OKLab mixing are re-implemented here from the specs, so a bug in
// frontend/src/platform/sky.ts cannot hide in its own tests.
import { readFileSync } from 'node:fs';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export const hexRgb = (h: string): RGB => {
  const n = parseInt(h.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbHex = (a: readonly number[]): string =>
  '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

export function parseColor(c: string): RGBA {
  const s = c.trim();
  if (s.startsWith('#')) {
    // Chromium serialises a custom property such as rgba(255, 255, 255, 0.9) as #ffffffe6: keep the alpha byte
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [...hexRgb('#' + h.slice(0, 6)), alpha];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) throw new Error(`unparseable colour ${c}`);
  const p = m[1]!.split(',').map((x) => parseFloat(x));
  return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const luminance = (rgb: RGB): number => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
export const contrast = (a: RGB, b: RGB): number => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Alpha-composite `fg` (rgba) over an opaque rgb. */
export const over = (fg: RGBA, bg: RGB): RGB => [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])) as RGB;

// OKLab (Bjorn Ottosson's matrices)
type Lab = [number, number, number];
const toLab = (rgb: RGB): Lab => {
  const [r, g, b] = rgb.map(lin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const fromLab = ([L, a, b]: Lab): RGB => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  }) as RGB;
};
export const mixOklab = (a: RGB, b: RGB, t: number): RGB => {
  const A = toLab(a);
  const B = toLab(b);
  return fromLab(A.map((v, i) => v + (B[i]! - v) * t) as Lab);
};

// ---- design.md section 2.1, copied by hand (not from the app) ----------------------------------

export interface DesignKeyframe {
  id: string;
  at: string;
  min: number;
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
const K = (
  id: string, at: string, top: string, mid: string, horizon: string, hillBack: string, hillFront: string,
  sunInner: string, sunOuter: string, sunGlow: string, moonGlow: string, cloudFill: string, cloudOpacity: number, starOpacity: number,
): DesignKeyframe => {
  const [h, m] = at.split(':').map(Number) as [number, number];
  return { id, at, min: h * 60 + m, top, mid, horizon, hillBack, hillFront, sunInner, sunOuter, sunGlow, moonGlow, cloudFill, cloudOpacity, starOpacity };
};
export const DESIGN_KEYFRAMES: DesignKeyframe[] = [
  K('latenight', '02:30', '#070D22', '#101C40', '#22305E', '#18234A', '#111A3A', '#FFD9A0', '#FF7A59', 'rgba(255,140,100,0)', 'rgba(150,170,255,0.35)', '#4A578A', 0.18, 1),
  K('dawn', '06:00', '#A9CBF0', '#F6CFD6', '#FFDDB5', '#B9D3EE', '#9CC0E6', '#FFF1C9', '#FFB46B', 'rgba(255,180,107,0.55)', 'rgba(150,170,255,0.15)', '#FFF4F0', 0.9, 0.15),
  K('morning', '08:30', '#6EB8F2', '#A9D8FA', '#E3F3FD', '#C6E9E4', '#A8DCD4', '#FFFBE6', '#FFD86B', 'rgba(255,236,170,0.60)', 'rgba(150,170,255,0)', '#FFFFFF', 1, 0),
  K('midday', '12:30', '#4FA8EE', '#8CC8F5', '#D6EEFC', '#BFE6D9', '#9FD6C6', '#FFFDF0', '#FFE07A', 'rgba(255,244,190,0.65)', 'rgba(150,170,255,0)', '#FFFFFF', 1, 0),
  K('afternoon', '16:00', '#5AA7E6', '#A3CDEF', '#FBE3C6', '#C3E2D2', '#A6D2BD', '#FFF4D6', '#FFC861', 'rgba(255,214,140,0.60)', 'rgba(150,170,255,0)', '#FFFDF8', 0.95, 0),
  K('dusk', '18:30', '#363F88', '#7D5596', '#F09A7E', '#5A4F8E', '#463F7A', '#FFD9A0', '#FF7A59', 'rgba(255,140,100,0.55)', 'rgba(190,180,255,0.30)', '#F6C3D0', 0.7, 0.35),
  K('evening', '20:30', '#1E2A5E', '#34407E', '#6B5A94', '#2A3468', '#222B58', '#FFD9A0', '#FF7A59', 'rgba(255,140,100,0)', 'rgba(170,190,255,0.45)', '#7C88BC', 0.35, 0.8),
  K('night', '23:00', '#0B1430', '#16244D', '#2B3D73', '#1A2A55', '#142147', '#FFD9A0', '#FF7A59', 'rgba(255,140,100,0)', 'rgba(159,180,255,0.40)', '#56639A', 0.22, 1),
];

/** Independent sky blend at a minute of the day (design.md 2.2): OKLab between neighbouring keyframes. */
export function blendAt(min: number): { top: RGB; mid: RGB; horizon: RGB; hillBack: RGB; hillFront: RGB } {
  const ks = [...DESIGN_KEYFRAMES].sort((a, b) => a.min - b.min);
  let ai = ks.length - 1;
  for (let i = 0; i < ks.length; i++) if (ks[i]!.min <= min) ai = i;
  const A = ks[ai]!;
  const B = ks[(ai + 1) % ks.length]!;
  const span = (B.min - A.min + 1440) % 1440;
  const k = ((min - A.min + 1440) % 1440) / span;
  const mix = (f: 'top' | 'mid' | 'horizon' | 'hillBack' | 'hillFront') => mixOklab(hexRgb(A[f]), hexRgb(B[f]), k);
  return { top: mix('top'), mid: mix('mid'), horizon: mix('horizon'), hillBack: mix('hillBack'), hillFront: mix('hillFront') };
}

export const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---- tokens.css ---------------------------------------------------------------------------------

/** Declarations of the first rule whose selector is exactly `selector` (outside any @media). */
export function tokenBlock(css: string, selector: string): Record<string, string> {
  const idx = css.indexOf(`${selector} {`);
  if (idx < 0) throw new Error(`no ${selector} block in tokens.css`);
  const open = css.indexOf('{', idx);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

export const tokensCss = (): string => readFileSync(new URL('../../frontend/src/styles/tokens.css', import.meta.url), 'utf8');

export interface Polarity {
  glass: RGBA; card: RGBA; solid: RGBA;
  ink: RGB; ink2: RGB; ink3: RGB; accentText: RGB; danger: RGB; accent: RGB; onAccent: RGB;
  ring: RGB; halo: RGB; heat0: RGB; heat1: RGB; heat3: RGB;
}
export function polarityTokens(): { light: Polarity; dark: Polarity } {
  const css = tokensCss();
  const light = { ...tokenBlock(css, ':root') };
  const dark = { ...light, ...tokenBlock(css, ":root[data-theme='dark']") };
  const mk = (t: Record<string, string>): Polarity => {
    const c = (k: string) => parseColor(t[k] ?? (() => { throw new Error(`missing token ${k}`); })());
    const rgb = (k: string): RGB => c(k).slice(0, 3) as RGB;
    return {
      glass: c('--em-glass'), card: c('--em-surface'), solid: c('--em-surface-solid'),
      ink: rgb('--em-ink'), ink2: rgb('--em-ink-2'), ink3: rgb('--em-ink-3'), accentText: rgb('--em-accent-text'),
      danger: rgb('--em-danger'), accent: rgb('--em-accent'), onAccent: rgb('--em-on-accent'),
      ring: rgb('--em-focus-ring'), halo: rgb('--em-focus-halo'), heat0: rgb('--em-heat-0'), heat1: rgb('--em-heat-1'), heat3: rgb('--em-heat-3'),
    };
  };
  return { light: mk(light), dark: mk(dark) };
}
