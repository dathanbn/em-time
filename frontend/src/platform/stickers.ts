// Emoji stickers (design.md section 4): data validation, the weighted no-repeat picker, the emoji
// support probe, the drifting spawner and the completion burst. The picker and validator are pure.
import { nearestPhase, type SkyPhaseId } from './sky';

export interface StickerData {
  version: 1;
  pools: Record<string, string[]>;
  weights: Record<SkyPhaseId, Record<string, number>>;
}

export const FIRST_SPAWN_S = [20, 40] as const;
export const SPAWN_S = [45, 90] as const;
export const FOCUS_SPAWN_S = [120, 240] as const;
export const MAX_ON_SCREEN = { wide: 3, narrow: 2, focus: 1 } as const;
export const DRIFT_S = [30, 42] as const;
export const BURST = { wide: 12, narrow: 9, milestoneWide: 18, milestoneNarrow: 14, ms: 1400 } as const;

const PHASES: SkyPhaseId[] = [
  'latenight',
  'dawn',
  'morning',
  'midday',
  'afternoon',
  'dusk',
  'evening',
  'night',
];

function graphemes(s: string): string[] {
  const Seg = (
    Intl as unknown as {
      Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (!Seg) return [...s];
  return [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
}

/** Throws on a schema violation (contract V2.5). */
export function validateStickerData(x: unknown): StickerData {
  const fail = (m: string): never => {
    throw new Error(`stickers.json: ${m}`);
  };
  if (typeof x !== 'object' || x === null) return fail('not an object');
  const o = x as Record<string, unknown>;
  if (o.version !== 1) fail('version must be 1');
  const pools = o.pools;
  if (typeof pools !== 'object' || pools === null || Array.isArray(pools)) return fail('pools missing');
  for (const [id, list] of Object.entries(pools)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`bad pool id ${id}`);
    if (!Array.isArray(list)) fail(`pool ${id} is not an array`);
    for (const e of list as unknown[]) {
      if (typeof e !== 'string' || graphemes(e).length !== 1) fail(`pool ${id}: ${String(e)} is not one grapheme`);
    }
  }
  const weights = o.weights;
  if (typeof weights !== 'object' || weights === null) return fail('weights missing');
  const keys = Object.keys(weights);
  if (keys.length !== PHASES.length || !PHASES.every((p) => keys.includes(p))) fail('weights need the 8 phases');
  for (const p of PHASES) {
    const row = (weights as Record<string, unknown>)[p];
    if (typeof row !== 'object' || row === null) return fail(`weights.${p} missing`);
    for (const [pool, w] of Object.entries(row)) {
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) fail(`weights.${p}.${pool} must be a number >= 0`);
    }
  }
  return x as StickerData;
}

export interface StickerPicker {
  /** Returns one emoji for a phase, never equal to the previous pick or to anything in `exclude`. */
  pick(phase: SkyPhaseId, exclude?: readonly string[]): string | null;
  /** Drops emoji the device cannot draw. */
  supported(filter: (emoji: string) => boolean): void;
}

export function createStickerPicker(data: StickerData, rng: () => number): StickerPicker {
  let pools: Record<string, string[]> = Object.fromEntries(
    Object.entries(data.pools).map(([k, v]) => [k, [...v]]),
  );
  let prev: string | null = null;
  return {
    supported(filter) {
      const keep: Record<string, string[]> = {};
      for (const [k, list] of Object.entries(pools)) keep[k] = list.filter(filter);
      pools = keep;
    },
    pick(phase, exclude = []) {
      const row = data.weights[phase] ?? {};
      const eligible = Object.entries(row).filter(([id, w]) => w > 0 && (pools[id]?.length ?? 0) > 0);
      const total = eligible.reduce((s, [, w]) => s + w, 0);
      if (total <= 0) return null;
      const draw = (): string => {
        let r = rng() * total;
        let id = eligible[eligible.length - 1]![0];
        for (const [pid, w] of eligible) {
          r -= w;
          if (r < 0) {
            id = pid;
            break;
          }
        }
        const list = pools[id]!;
        return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
      };
      for (let i = 0; i < 6; i++) {
        const e = draw();
        if (e !== prev && !exclude.includes(e)) return (prev = e);
      }
      // Fallback: anything eligible that is not the previous pick, preferring unexcluded ones.
      const all = [...new Set(eligible.flatMap(([id]) => pools[id]!))].filter((e) => e !== prev);
      const free = all.filter((e) => !exclude.includes(e));
      const from = free.length ? free : all;
      if (!from.length) return null;
      return (prev = from[Math.min(from.length - 1, Math.floor(rng() * from.length))]!);
    },
  };
}

// ---- randomness -------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Math.random, or mulberry32 for an e2e build with `?e2e&seed=<int>`. */
export function makeRng(): () => number {
  if (typeof location !== 'undefined' && import.meta.env.VITE_E2E === '1') {
    const q = new URLSearchParams(location.search);
    const seed = q.get('seed');
    if (q.has('e2e') && seed !== null && /^-?\d+$/.test(seed)) return mulberry32(parseInt(seed, 10));
  }
  return Math.random;
}

// ---- emoji support probe -----------------------------------------------------------------------

/**
 * One offscreen canvas measureText probe per emoji (never attached, never drawn). A glyph the
 * device lacks renders as the same box as a never-assigned code point, or as two emoji side by
 * side (a broken ZWJ sequence). If the probe cannot tell (no canvas, or no emoji font at all),
 * everything is kept.
 */
export function emojiSupportFilter(): (emoji: string) => boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return () => true;
    ctx.font = '32px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    const width = (s: string) => ctx.measureText(s).width;
    const missing = width('\u{10FFFF}');
    const ref = width('😀');
    if (!(ref > 0) || Math.abs(ref - missing) < 0.5) return () => true;
    return (e) => {
      const w = width(e);
      return Math.abs(w - missing) >= 0.5 && w < ref * 1.6;
    };
  } catch {
    return () => true;
  }
}

// ---- DOM: drifting stickers -------------------------------------------------------------------

const reduced = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const between = (r: () => number, [lo, hi]: readonly [number, number] | readonly number[]): number =>
  lo! + r() * (hi! - lo!);

const onScreen = (layer: HTMLElement): string[] =>
  [...layer.querySelectorAll<HTMLElement>('[data-testid="sticker"]')].map((n) => n.dataset.emoji ?? '');

/** Real-clock phase id, which drives sticker weights even in the fixed theme modes. */
const realPhase = (): SkyPhaseId => {
  const d = new Date();
  return nearestPhase(d.getHours() * 60 + d.getMinutes());
};

export function startStickers(opts: {
  layer: HTMLElement;
  picker: StickerPicker;
  isFocusRunning: () => boolean;
  isNarrow: () => boolean;
  rng: () => number;
}): () => void {
  const { layer, picker, rng } = opts;
  let timer = 0;
  let first = true;
  let stopped = false;

  const arm = () => {
    window.clearTimeout(timer);
    if (stopped || document.hidden) return;
    const range = first ? FIRST_SPAWN_S : opts.isFocusRunning() ? FOCUS_SPAWN_S : SPAWN_S;
    first = false;
    timer = window.setTimeout(spawn, between(rng, range) * 1000);
  };

  const spawn = () => {
    if (stopped || document.hidden) return;
    const cap = opts.isFocusRunning() ? MAX_ON_SCREEN.focus : opts.isNarrow() ? MAX_ON_SCREEN.narrow : MAX_ON_SCREEN.wide;
    const current = onScreen(layer);
    if (!reduced() && current.length < cap) {
      const emoji = picker.pick(realPhase(), current);
      if (emoji) add(emoji);
    }
    arm();
  };

  const add = (emoji: string) => {
    const dur = between(rng, DRIFT_S);
    const fromLeft = rng() < 0.5;
    const el = document.createElement('span');
    el.className = 'sticker';
    el.dataset.testid = 'sticker';
    el.setAttribute('data-testid', 'sticker');
    el.dataset.emoji = emoji;
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--from', fromLeft ? '-48px' : 'calc(100vw + 18px)');
    el.style.setProperty('--to', fromLeft ? 'calc(100vw + 18px)' : '-48px');
    el.style.setProperty('--y', `${12 + rng() * 46}%`);
    el.style.setProperty('--dur', `${dur.toFixed(1)}s`);
    const inner = document.createElement('span');
    inner.className = 'sticker__in';
    inner.textContent = emoji;
    el.append(inner);
    const remove = () => {
      el.remove();
      window.clearTimeout(fallback);
    };
    const fallback = window.setTimeout(remove, dur * 1000 + 1500);
    el.addEventListener('animationend', (e) => {
      if (e.target === el) remove();
    });
    layer.append(el);
  };

  const onVis = () => {
    if (document.hidden) window.clearTimeout(timer);
    else arm();
  };
  document.addEventListener('visibilitychange', onVis);
  arm();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
    layer.replaceChildren();
  };
}

// ---- DOM: completion burst --------------------------------------------------------------------

let burstEl: HTMLElement | null = null;
let burstTimer = 0;

export function clearBurst(): void {
  window.clearTimeout(burstTimer);
  burstEl?.remove();
  burstEl = null;
}

export function burst(opts: {
  origin: DOMRect;
  count: number;
  picker: StickerPicker;
  phase: SkyPhaseId;
  rng?: () => number;
}): void {
  clearBurst();
  const rng = opts.rng ?? Math.random;
  const still = reduced();
  const count = still ? 3 : opts.count;
  const root = document.createElement('div');
  root.className = still ? 'burst burst--still' : 'burst';
  root.setAttribute('data-testid', 'sticker-burst');
  root.setAttribute('aria-hidden', 'true');
  const cx = opts.origin.left + opts.origin.width / 2;
  const cy = opts.origin.top + opts.origin.height / 2;
  const used: string[] = [];
  // Stickers start on the bubble's rim and land 10-80px outside it, so they never sit on the digits.
  const rim = (opts.origin.width || 200) / 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Worst-case half extent of a sticker box (34px glyph, scale 1.15, rotated up to 25 degrees) plus
  // the 8px viewport margin. The animation ends at 1.1x the offset, so clamp that position too.
  const reach = 8 + (34 * 1.15 * (Math.cos(0.4363) + Math.sin(0.4363))) / 2;
  const fit = (off: number, c: number, size: number): number => {
    const lo = Math.min(0, reach - c) / 1.1;
    const hi = Math.max(0, size - reach - c) / 1.1;
    return Math.round(Math.min(Math.max(off, lo), hi));
  };
  const place = (a: number, d: number): [number, number] => [
    fit(Math.cos(a) * d, cx, vw),
    fit(Math.sin(a) * d, cy, vh),
  ];
  for (let i = 0; i < count; i++) {
    const emoji = opts.picker.pick(opts.phase, used) ?? opts.picker.pick(opts.phase);
    if (!emoji) break;
    used.push(emoji);
    const el = document.createElement('span');
    el.className = 'burst__s';
    el.setAttribute('data-testid', 'sticker');
    el.dataset.emoji = emoji;
    el.textContent = emoji;
    if (still) {
      const a = ((i + 0.5) / count) * Math.PI * 2 - Math.PI / 2;
      const [dx, dy] = place(a, rim + 36);
      el.style.setProperty('--dx', `${dx}px`);
      el.style.setProperty('--dy', `${dy}px`);
    } else {
      const a = ((i * 360) / count + (rng() * 24 - 12)) * (Math.PI / 180);
      const d = rim + 10 + rng() * 70;
      const [dx, dy] = place(a, d);
      el.style.setProperty('--dx', `${dx}px`);
      el.style.setProperty('--dy', `${dy}px`);
      el.style.setProperty('--sx', `${Math.round(Math.cos(a) * rim)}px`);
      el.style.setProperty('--sy', `${Math.round(Math.sin(a) * rim)}px`);
      el.style.setProperty('--rot', `${Math.round((rng() * 50 - 25) * 10) / 10}deg`);
    }
    root.append(el);
  }
  root.style.left = `${cx}px`;
  root.style.top = `${cy}px`;
  document.body.append(root);
  burstEl = root;
  burstTimer = window.setTimeout(clearBurst, still ? 2400 : 1500);
}
