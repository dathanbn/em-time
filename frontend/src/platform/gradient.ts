// Time-of-day background (UI-2): four periods, blended in OKLab over the 60 minutes before each
// boundary, recomputed once per minute. Both themes.
import { DAY_PERIODS, GRADIENT_BLEND_MIN } from '@core';

type Stop = [string, string];
const TABLE: Record<'light' | 'dark', Record<string, Stop>> = {
  light: {
    dawn: ['#EEF5FC', '#FBF8F6'],
    day: ['#F4F9FE', '#FFFFFF'],
    dusk: ['#EEF3F9', '#F6F4F9'],
    night: ['#E8EFF9', '#F2F6FB'],
  },
  dark: {
    dawn: ['#121B2E', '#16182A'],
    day: ['#0F1A2C', '#0B1220'],
    dusk: ['#141629', '#1A1A2C'],
    night: ['#070D18', '#0B1220'],
  },
};

type Lab = [number, number, number];

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
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
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const mix = (a: string, b: string, t: number): string => {
  const A = hexToLab(a);
  const B = hexToLab(b);
  return labToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
};

/** Pure: the two gradient colors for a local time (minutes since midnight) and theme. */
export function gradientAt(minutes: number, theme: 'light' | 'dark'): Stop {
  const periods = DAY_PERIODS.map((p) => ({ id: p.id, from: p.from * 60 }));
  const cur = [...periods].reverse().find((p) => minutes >= p.from) ?? periods[periods.length - 1]!;
  const idx = periods.indexOf(cur);
  const next = periods[(idx + 1) % periods.length]!;
  const untilNext = (next.from - minutes + 1440) % 1440;
  const table = TABLE[theme];
  const from = table[cur.id]!;
  if (untilNext >= GRADIENT_BLEND_MIN) return from;
  const to = table[next.id]!;
  const t = 1 - untilNext / GRADIENT_BLEND_MIN;
  return [mix(from[0], to[0], t), mix(from[1], to[1], t)];
}

export function applyGradient(theme: 'light' | 'dark', date = new Date()): void {
  const [top, bottom] = gradientAt(date.getHours() * 60 + date.getMinutes(), theme);
  const root = document.documentElement.style;
  root.setProperty('--em-bg-grad-top', top);
  root.setProperty('--em-bg-grad-bottom', bottom);
}

let timer: number | undefined;
export function startGradient(getTheme: () => 'light' | 'dark'): void {
  const run = () => applyGradient(getTheme());
  run();
  window.clearInterval(timer);
  timer = window.setInterval(run, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
}
