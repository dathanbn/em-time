// SKY-10 / A11Y-1: the per-minute contrast sweep from design.md sections 2.6, 8 and 12.
// Everything is computed here: the sky is blended by an independent OKLab implementation from the
// design.md keyframe table, glass and card alphas are composited by an independent routine, and
// the ink tokens are read from frontend/src/styles/tokens.css so token drift is caught.
import { describe, expect, it } from 'vitest';
import { SKY_KEYFRAMES, skyAt } from '../../frontend/src/platform/sky';
import {
  DESIGN_KEYFRAMES,
  blendAt,
  contrast,
  hexRgb,
  hhmm,
  over,
  polarityTokens,
  type Polarity,
  type RGB,
} from './colorMath';

const TOKENS = polarityTokens();
const POL_LIGHT_FROM = 315; // 05:15
const POL_DARK_FROM = 1020; // 17:00
const polarityFor = (m: number): 'light' | 'dark' => (m >= POL_LIGHT_FROM && m < POL_DARK_FROM ? 'light' : 'dark');
const INK_NAVY = hexRgb('#10263F');
const INK_WHITE: RGB = [255, 255, 255];

interface Pair { name: string; min: number; threshold: number }
const PAIRS: Pair[] = [];
const defs: Array<[string, number]> = [
  ['card.ink', 4.5], ['card.ink2', 4.5], ['card.ink3', 4.5], ['card.accentText', 4.5], ['card.danger', 4.5],
  ['glass.ink', 4.5], ['glass.ink2', 4.5], ['glass.accentText', 4.5],
  ['solid.ink', 4.5], ['solid.ink2', 4.5], ['solid.ink3', 4.5],
  ['accent.onAccent', 4.5],
  ['sky.ink(top)', 3], ['sky.ink(mid)', 3],
  ['focus.vsSky', 3], ['focus.ringOnCard', 3],
  ['solid.heat3', 3], ['solid.heat1', 2],
];
for (const [name, threshold] of defs) PAIRS.push({ name, min: Infinity, threshold });

interface Worst { value: number; at: number; mode: string }

/** Every measured ratio for one minute under one polarity token set. */
function measure(sky: ReturnType<typeof blendAt>, pol: Polarity): Record<string, number> {
  const under: RGB[] = [sky.top, sky.mid, sky.horizon, sky.hillBack, sky.hillFront];
  const worst = (fill: Polarity['glass'], fg: RGB) => Math.min(...under.map((u) => contrast(fg, over(fill, u))));
  const r: Record<string, number> = {};
  for (const k of ['ink', 'ink2', 'ink3', 'accentText', 'danger'] as const) r[`card.${k}`] = worst(pol.card, pol[k]);
  for (const k of ['ink', 'ink2', 'accentText'] as const) r[`glass.${k}`] = worst(pol.glass, pol[k]);
  for (const k of ['ink', 'ink2', 'ink3'] as const) r[`solid.${k}`] = worst(pol.solid, pol[k]);
  r['accent.onAccent'] = contrast(pol.onAccent, pol.accent);
  // focus indicator: whichever of ring and halo contrasts better with each sky colour
  r['focus.vsSky'] = Math.min(...under.map((u) => Math.max(contrast(pol.ring, u), contrast(pol.halo, u))));
  r['focus.ringOnCard'] = worst(pol.card, pol.ring);
  r['solid.heat3'] = worst(pol.solid, pol.heat3);
  r['solid.heat1'] = worst(pol.solid, pol.heat1);
  // the sky ink is picked per minute: the better of navy and white against top and mid
  const score = (ink: RGB) => Math.min(contrast(ink, sky.top), contrast(ink, sky.mid));
  const ink = score(INK_NAVY) >= score(INK_WHITE) ? INK_NAVY : INK_WHITE;
  r['sky.ink(top)'] = contrast(ink, sky.top);
  r['sky.ink(mid)'] = contrast(ink, sky.mid);
  return r;
}

const worstOf: Record<string, Worst> = {};
const fails: string[] = [];
function sweep(mode: 'sky' | 'light' | 'dark'): void {
  for (let m = 0; m < 1440; m++) {
    // 'light' pins the 12:30 sky and the light tokens, 'dark' pins the 23:00 sky and the dark tokens
    const skyMin = mode === 'light' ? 750 : mode === 'dark' ? 1380 : m;
    const pol = mode === 'sky' ? polarityFor(m) : mode;
    const r = measure(blendAt(skyMin), TOKENS[pol]);
    for (const p of PAIRS) {
      const v = r[p.name]!;
      const key = mode === 'sky' ? p.name : `${p.name} [${mode}]`;
      if (!worstOf[key] || v < worstOf[key]!.value) worstOf[key] = { value: v, at: m, mode };
      if (v < p.threshold) fails.push(`${mode} ${hhmm(m)} ${p.name} = ${v.toFixed(2)} (needs ${p.threshold})`);
    }
  }
}
sweep('sky');
sweep('light');
sweep('dark');

describe('the contrast sweep (SKY-10): all 1,440 minutes, Follow the sky plus both fixed modes', () => {
  it('every pair passes at every minute', () => {
    expect(fails.slice(0, 20)).toEqual([]);
  });
  it.each(defs)('%s stays at or above %s:1 (worst minute printed)', (name, threshold) => {
    const w = worstOf[name]!;
    console.log(`worst ${name.padEnd(18)} ${w.value.toFixed(2)}:1 at ${hhmm(w.at)}`);
    expect(w.value).toBeGreaterThanOrEqual(threshold);
  });
  it.each(['light', 'dark'] as const)('fixed mode %s is flat and passes', (mode) => {
    for (const [name, threshold] of defs) {
      const w = worstOf[`${name} [${mode}]`]!;
      expect(w.value, `${name} in ${mode}`).toBeGreaterThanOrEqual(threshold);
    }
  });
  it('the worst-minute table matches design.md section 12 within 0.15', () => {
    // design.md 12: sky ink 3.10 at 17:19; glass accent-text 4.52 at 16:59; glass ink-2 4.99 at 17:00;
    // card ink-3 4.78 at 17:00; focus 3.24 at 16:28; heat-1 2.04 at 16:59.
    const want: Array<[string, number, number]> = [
      ['glass.accentText', 4.52, 16 * 60 + 59],
      ['glass.ink2', 4.99, 17 * 60],
      ['card.ink3', 4.78, 17 * 60],
      ['focus.vsSky', 3.24, 16 * 60 + 28],
      ['solid.heat1', 2.04, 16 * 60 + 59],
    ];
    const lines: string[] = [];
    for (const [name, value, at] of want) {
      const w = worstOf[name]!;
      lines.push(`${name}: sweep ${w.value.toFixed(2)} at ${hhmm(w.at)}, design ${value} at ${hhmm(at)}`);
      expect(Math.abs(w.value - value), lines[lines.length - 1]).toBeLessThanOrEqual(0.15);
    }
    const skyInk = Math.min(worstOf['sky.ink(top)']!.value, worstOf['sky.ink(mid)']!.value);
    lines.push(`sky.ink: sweep ${skyInk.toFixed(2)}, design 3.10 at 17:19`);
    expect(Math.abs(skyInk - 3.1)).toBeLessThanOrEqual(0.15);
    console.log(lines.join('\n'));
  });
});

describe('the keyframe table of design.md section 12', () => {
  // [id, polarity, card ink, ink-2, ink-3, accent-text, danger, glass ink, glass ink-2, glass accent-text, heat-3]
  const TABLE: Array<[string, 'light' | 'dark', number, number, number, number, number, number, number, number, number]> = [
    ['latenight', 'dark', 14.3, 8.3, 6.1, 10.4, 8.6, 13.9, 8.1, 10.1, 7.2],
    ['dawn', 'light', 15.5, 7.1, 5.1, 6.0, 6.2, 13.9, 6.4, 5.4, 4.3],
    ['morning', 'light', 15.3, 7.1, 5.1, 5.9, 6.1, 13.5, 6.2, 5.2, 4.3],
    ['midday', 'light', 15.1, 6.9, 5.0, 5.8, 6.0, 12.9, 5.9, 5.0, 4.2],
    ['afternoon', 'light', 15.1, 7.0, 5.0, 5.8, 6.0, 12.9, 5.9, 5.0, 4.2],
    ['dusk', 'dark', 12.0, 7.0, 5.1, 8.7, 7.2, 9.7, 5.6, 7.1, 6.7],
    ['evening', 'dark', 13.4, 7.8, 5.7, 9.7, 8.0, 12.2, 7.1, 8.8, 7.0],
    ['night', 'dark', 14.0, 8.2, 5.9, 10.2, 8.5, 13.4, 7.8, 9.8, 7.1],
  ];
  it.each(TABLE)('%s: ratios agree with the published table within 0.2', (id, pol, ink, ink2, ink3, acc, dng, gInk, gInk2, gAcc, heat3) => {
    const k = DESIGN_KEYFRAMES.find((x) => x.id === id)!;
    const r = measure(blendAt(k.min), TOKENS[polarityFor(k.min)]);
    expect(polarityFor(k.min)).toBe(pol);
    const got = [r['card.ink'], r['card.ink2'], r['card.ink3'], r['card.accentText'], r['card.danger'], r['glass.ink'], r['glass.ink2'], r['glass.accentText'], r['solid.heat3']];
    const want = [ink, ink2, ink3, acc, dng, gInk, gInk2, gAcc, heat3];
    got.forEach((g, i) => expect(Math.abs(g! - want[i]!), `${id} column ${i}: ${g!.toFixed(2)} vs ${want[i]}`).toBeLessThanOrEqual(0.2));
  });
});

describe('the app agrees with the independent sweep', () => {
  it('skyAt().ink, evaluated against the independent blend, meets 3:1 on top and mid at every minute', () => {
    for (let m = 0; m < 1440; m++) {
      const sky = blendAt(m);
      const ink = hexRgb(skyAt(m).ink);
      for (const bg of [sky.top, sky.mid]) {
        const c = contrast(ink, bg);
        if (c < 3) throw new Error(`${hhmm(m)}: ${skyAt(m).ink} on ${bg.join(',')} = ${c.toFixed(2)}`);
      }
    }
  });
  it('the app keyframes drive the same numbers: the sweep run on skyAt() colours also passes', () => {
    const bad: string[] = [];
    for (let m = 0; m < 1440; m++) {
      const s = skyAt(m, new Date(2026, 9, 14, 12));
      const sky = { top: hexRgb(s.top), mid: hexRgb(s.mid), horizon: hexRgb(s.horizon), hillBack: hexRgb(s.hillBack), hillFront: hexRgb(s.hillFront) };
      const r = measure(sky, TOKENS[s.polarity]);
      for (const [name, threshold] of defs) if (r[name]! < threshold) bad.push(`${hhmm(m)} ${name} ${r[name]!.toFixed(2)}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it('the app keyframe list has the same 8 sky stops the sweep used', () => {
    expect(SKY_KEYFRAMES.map((k) => [k.top, k.mid, k.horizon, k.hillBack, k.hillFront])).toEqual(
      DESIGN_KEYFRAMES.map((k) => [k.top, k.mid, k.horizon, k.hillBack, k.hillFront]),
    );
  });
});

describe('token sanity (design.md 2.6)', () => {
  it('light and dark ink tokens are the documented values', () => {
    const hx = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    expect([hx(TOKENS.light.ink), hx(TOKENS.light.ink2), hx(TOKENS.light.ink3), hx(TOKENS.light.accentText), hx(TOKENS.light.ring)]).toEqual(['#13202F', '#475569', '#5B6B82', '#1A62A0', '#0F416F']);
    expect([hx(TOKENS.dark.ink), hx(TOKENS.dark.ink2), hx(TOKENS.dark.ink3), hx(TOKENS.dark.accentText), hx(TOKENS.dark.ring)]).toEqual(['#E6EEF7', '#A9B8CC', '#8C9DB4', '#9CD3F5', '#9CD3F5']);
  });
  it('glass and card alphas are the documented values', () => {
    expect(TOKENS.light.glass).toEqual([255, 255, 255, 0.72]);
    expect(TOKENS.light.card).toEqual([255, 255, 255, 0.9]);
    expect(TOKENS.light.solid).toEqual([255, 255, 255, 0.97]);
    expect(TOKENS.dark.glass).toEqual([18, 27, 43, 0.78]);
    expect(TOKENS.dark.card).toEqual([18, 27, 43, 0.88]);
    expect(TOKENS.dark.solid).toEqual([18, 27, 43, 0.95]);
  });
});

// The design sweep composites glass over the five sky colours only. A cloud, the sun or a fully lit
// moon can sit directly behind a glass chip or a card, and they are brighter than any sky colour at
// dusk and night. The backdrop blur (18px) smears a 64px disc, so this is a worst case with the whole
// disc behind the text. Strict 4.5:1 is NOT met for ink-2 on glass behind the moon (4.28:1) and ink-3
// on a card behind the moon (4.41:1); the test pins the 4.0:1 floor so a regression is still caught
// and the numbers go in the QA report as an advisory (owner: frontend, tokens.css glass alpha).
describe('advisory: bright objects behind glass and cards', () => {
  it('stays at or above 4.0:1 with a cloud, the sun or the moon directly behind (worst case, unblurred)', () => {
    const worst: Record<string, { v: number; m: number }> = {};
    for (let m = 0; m < 1440; m++) {
      const s = skyAt(m, new Date(2026, 9, 14, 12));
      const sky = blendAt(m);
      const pol = TOKENS[s.polarity];
      const cf = hexRgb(s.cloudFill);
      for (const u of [sky.top, sky.mid, sky.horizon]) {
        const objects: Array<[string, RGB]> = [['cloud', over([cf[0], cf[1], cf[2], s.cloudOpacity], u)]];
        if (s.sun.visible) objects.push(['sun', over([...hexRgb(s.sunInner), s.sun.opacity] as [number, number, number, number], u)]);
        if (s.moon.visible) objects.push(['moon', over([255, 251, 232, s.moon.opacity], u)]);
        for (const [what, bg] of objects) {
          for (const [name, fill, fg] of [
            ['glass.ink', pol.glass, pol.ink], ['glass.ink2', pol.glass, pol.ink2], ['glass.accentText', pol.glass, pol.accentText],
            ['card.ink3', pol.card, pol.ink3], ['solid.ink3', pol.solid, pol.ink3],
          ] as const) {
            const c = contrast(fg, over(fill, bg));
            const key = `${what} ${name}`;
            if (!worst[key] || c < worst[key]!.v) worst[key] = { v: c, m };
          }
        }
      }
    }
    for (const [k, w] of Object.entries(worst)) console.log(`behind ${k.padEnd(24)} ${w.v.toFixed(2)}:1 at ${hhmm(w.m)}`);
    for (const [k, w] of Object.entries(worst)) expect(w.v, k).toBeGreaterThanOrEqual(4.0);
  });
});
