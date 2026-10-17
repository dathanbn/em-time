// SKY-2, SKY-3, SKY-4, SKY-5, SKY-7, SKY-9, THEME-2/3 (pure part). Expected values come from
// docs/design.md section 2 (copied into colorMath.ts), not from the implementation.
import { describe, expect, it } from 'vitest';
import {
  POLARITY_FLIP_MIN,
  SKY_INK,
  SKY_KEYFRAMES,
  arcPosition,
  backHillHeight,
  composite,
  contrastRatio,
  moonPhase,
  nearestPhase,
  polarityAt,
  skyAt,
  skyFor,
} from '../../frontend/src/platform/sky';
import { DESIGN_KEYFRAMES, blendAt, contrast, hexRgb, hhmm, mixOklab, rgbHex, type RGB } from './colorMath';

const DAY = new Date(2026, 9, 14, 12, 0); // Wed 14 Oct 2026 (the moon phase is not under test here)
const near = (a: string, b: string, tol = 1) => {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return x.every((v, i) => Math.abs(v - y[i]!) <= tol);
};
const hex = (c: RGB) => rgbHex(c);

describe('SKY_KEYFRAMES equals design.md 2.1 hex for hex', () => {
  it('has the 8 keyframes in time order with the exact ids and minutes', () => {
    expect(SKY_KEYFRAMES.map((k) => [k.id, k.atMin])).toEqual(DESIGN_KEYFRAMES.map((k) => [k.id, k.min]));
  });
  it.each(DESIGN_KEYFRAMES)('$id ($at): every colour and number', (d) => {
    const k = SKY_KEYFRAMES.find((x) => x.id === d.id)!;
    for (const f of ['top', 'mid', 'horizon', 'hillBack', 'hillFront', 'sunInner', 'sunOuter', 'cloudFill'] as const) {
      expect(k[f].toUpperCase(), `${d.id}.${f}`).toBe(d[f]);
    }
    expect(k.sunGlow.replace(/\s/g, '')).toBe(d.sunGlow.replace(/\s/g, ''));
    expect(k.moonGlow.replace(/\s/g, '')).toBe(d.moonGlow.replace(/\s/g, ''));
    expect(k.cloudOpacity).toBe(d.cloudOpacity);
    expect(k.starOpacity).toBe(d.starOpacity);
  });
  it('the polarity flip times and sky inks are the documented constants', () => {
    expect(POLARITY_FLIP_MIN).toEqual({ toLight: 315, toDark: 1020 });
    expect(SKY_INK).toEqual({ dark: '#10263F', light: '#FFFFFF' });
  });
});

describe('skyAt: keyframe minutes return the exact stops (SKY-2)', () => {
  it.each(DESIGN_KEYFRAMES)('$id at $at', (d) => {
    const s = skyAt(d.min, DAY);
    expect(s.top).toBe(d.top);
    expect(s.mid).toBe(d.mid);
    expect(s.horizon).toBe(d.horizon);
    expect(s.hillBack).toBe(d.hillBack);
    expect(s.hillFront).toBe(d.hillFront);
    expect(s.phase).toBe(d.id);
    expect(s.cloudOpacity).toBeCloseTo(d.cloudOpacity, 3);
    expect(s.starOpacity).toBeCloseTo(d.starOpacity, 3);
    expect(s.cloudFill).toBe(d.cloudFill);
  });
});

describe('skyAt: blending between keyframes (SKY-5)', () => {
  const sorted = [...DESIGN_KEYFRAMES].sort((a, b) => a.min - b.min);
  it('10:30 is the OKLab midpoint of morning and midday (top within 1 channel)', () => {
    const expected = mixOklab(hexRgb('#6EB8F2'), hexRgb('#4FA8EE'), 0.5);
    expect(near(skyAt(630, DAY).top, hex(expected), 1)).toBe(true);
  });
  it('10:10 differs from 10:00 (the sky moves continuously)', () => {
    expect(skyAt(610, DAY).top).not.toBe(skyAt(600, DAY).top);
  });
  it.each(sorted.map((a, i) => [a, sorted[(i + 1) % sorted.length]!] as const))('midpoint %# between %s: every stop', (a, b) => {
    const span = (b.min - a.min + 1440) % 1440;
    const min = (a.min + span / 2) % 1440;
    expect(Number.isInteger(min)).toBe(true);
    const s = skyAt(min, DAY);
    for (const f of ['top', 'mid', 'horizon', 'hillBack', 'hillFront'] as const) {
      const want = mixOklab(hexRgb(a[f]), hexRgb(b[f]), 0.5);
      expect(near(s[f], hex(want), 1), `${a.id}->${b.id} ${f} at ${hhmm(min)}: ${s[f]} vs ${hex(want)}`).toBe(true);
    }
    // numeric channels blend linearly
    expect(s.cloudOpacity).toBeCloseTo((a.cloudOpacity + b.cloudOpacity) / 2, 2);
    expect(s.starOpacity).toBeCloseTo((a.starOpacity + b.starOpacity) / 2, 2);
  });
  it('every minute of the day equals the independent blend within 1 RGB channel', () => {
    for (let m = 0; m < 1440; m++) {
      const s = skyAt(m, DAY);
      const want = blendAt(m);
      for (const f of ['top', 'mid', 'horizon', 'hillBack', 'hillFront'] as const) {
        if (!near(s[f], hex(want[f]), 1)) throw new Error(`${hhmm(m)} ${f}: ${s[f]} vs ${hex(want[f])}`);
      }
    }
  });
  it('is continuous: no channel jumps by more than 3 between adjacent minutes, midnight included', () => {
    let worst = 0;
    for (let m = 0; m < 1440; m++) {
      const a = skyAt(m, DAY);
      const b = skyAt((m + 1) % 1440, DAY);
      for (const f of ['top', 'mid', 'horizon', 'hillBack', 'hillFront'] as const) {
        const x = hexRgb(a[f]);
        const y = hexRgb(b[f]);
        const d = Math.max(...x.map((v, i) => Math.abs(v - y[i]!)));
        worst = Math.max(worst, d);
        if (d > 3) throw new Error(`${hhmm(m)} to ${hhmm((m + 1) % 1440)} ${f} jumps ${d}`);
      }
    }
    expect(worst).toBeLessThanOrEqual(3);
  });
  it('wraps past midnight: 00:00 sits between night (23:00) and latenight (02:30)', () => {
    const s = skyAt(0, DAY);
    const want = mixOklab(hexRgb('#0B1430'), hexRgb('#070D22'), 60 / 210);
    expect(near(s.top, hex(want), 1)).toBe(true);
    expect(skyAt(1440 + 750, DAY).top).toBe(skyAt(750, DAY).top); // minutes normalise
  });
});

describe('polarity (SKY-9)', () => {
  it.each([
    [314, 'dark'], [315, 'light'], [1019, 'light'], [1020, 'dark'], [0, 'dark'], [750, 'light'], [1439, 'dark'],
  ] as const)('minute %i is %s', (m, p) => {
    expect(polarityAt(m)).toBe(p);
    expect(skyAt(m, DAY).polarity).toBe(p);
  });
  it('the four boundaries by clock', () => {
    expect(polarityAt(5 * 60 + 14)).toBe('dark');
    expect(polarityAt(5 * 60 + 15)).toBe('light');
    expect(polarityAt(16 * 60 + 59)).toBe('light');
    expect(polarityAt(17 * 60)).toBe('dark');
  });
  it('light exactly from 05:15 to 16:59 across the whole day, no other flips', () => {
    let flips = 0;
    for (let m = 0; m < 1440; m++) if (polarityAt(m) !== polarityAt((m + 1) % 1440)) flips++;
    expect(flips).toBe(2);
    for (let m = 0; m < 1440; m++) expect(polarityAt(m)).toBe(m >= 315 && m <= 1019 ? 'light' : 'dark');
  });
});

describe('phase is the nearest keyframe (SKY-3, SKY-4)', () => {
  it.each([
    ['00:00', 'night'], ['01:00', 'latenight'], ['02:00', 'latenight'], ['02:30', 'latenight'], ['04:00', 'latenight'],
    ['04:15', 'dawn'], ['06:00', 'dawn'], ['07:14', 'dawn'], ['07:15', 'morning'], ['08:30', 'morning'], ['10:30', 'midday'],
    ['12:00', 'midday'], ['12:30', 'midday'], ['14:15', 'afternoon'], ['16:00', 'afternoon'], ['17:15', 'dusk'], ['18:30', 'dusk'],
    ['19:30', 'evening'], ['20:30', 'evening'], ['21:45', 'night'], ['23:00', 'night'], ['23:59', 'night'],
  ])('%s is %s', (t, id) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    expect(nearestPhase(h * 60 + m)).toBe(id);
    expect(skyAt(h * 60 + m, DAY).phase).toBe(id);
  });
  it('every keyframe minute is its own phase and the phase never flickers between neighbours', () => {
    for (const k of DESIGN_KEYFRAMES) expect(nearestPhase(k.min)).toBe(k.id);
    const seq: string[] = [];
    for (let m = 0; m < 1440; m++) {
      const p = nearestPhase(m);
      if (seq[seq.length - 1] !== p) seq.push(p);
    }
    // 8 phases, and the wrap joins "night" at both ends of the day
    expect(seq.length).toBe(9);
    expect(seq[0]).toBe('night');
    expect(seq[seq.length - 1]).toBe('night');
  });
});

describe('sun and moon windows and arcs (SKY-3, SKY-4, SKY-7)', () => {
  it('sun is visible only from 05:30 to 19:30', () => {
    for (let m = 0; m < 1440; m++) expect(skyAt(m, DAY).sun.visible, hhmm(m)).toBe(m >= 330 && m <= 1170);
  });
  it('moon is visible only from 19:00 to 06:30 (wrapping)', () => {
    for (let m = 0; m < 1440; m++) expect(skyAt(m, DAY).moon.visible, hhmm(m)).toBe(m >= 1140 || m <= 390);
  });
  it('bodies fade in and out over 20 minutes', () => {
    expect(skyAt(330, DAY).sun.opacity).toBeCloseTo(0, 3);
    expect(skyAt(340, DAY).sun.opacity).toBeCloseTo(0.5, 2);
    expect(skyAt(350, DAY).sun.opacity).toBe(1);
    expect(skyAt(750, DAY).sun.opacity).toBe(1);
    expect(skyAt(1160, DAY).sun.opacity).toBeCloseTo(0.5, 2);
    expect(skyAt(1140, DAY).moon.opacity).toBeCloseTo(0, 3);
    expect(skyAt(1430, DAY).moon.opacity).toBe(1);
  });
  it('at 12:30 the sun is at the apex and x is half the width', () => {
    const s = skyAt(750, DAY);
    expect(s.sun.p).toBeCloseTo(0.5, 6);
    for (const [w, h] of [[1280, 800], [390, 844], [1024, 768]] as const) {
      const pos = arcPosition(s.sun.p, w, h, 'sun');
      expect(pos.x).toBeCloseTo(w * 0.5, 4);
    }
    expect(arcPosition(0.5, 1280, 800, 'sun').y).toBeCloseTo(296, 4);
    expect(arcPosition(0.5, 390, 844, 'sun').y).toBeCloseTo(180, 4);
  });
  it('rises left and sets right: x = W * (0.06 + 0.88 p)', () => {
    expect(arcPosition(0, 1000, 800, 'sun').x).toBeCloseTo(60, 6);
    expect(arcPosition(1, 1000, 800, 'sun').x).toBeCloseTo(940, 6);
  });
  it('sizes: sun 88/64, moon 64/48', () => {
    expect(arcPosition(0.5, 1280, 800, 'sun').size).toBe(88);
    expect(arcPosition(0.5, 390, 844, 'sun').size).toBe(64);
    expect(arcPosition(0.5, 1280, 800, 'moon').size).toBe(64);
    expect(arcPosition(0.5, 390, 844, 'moon').size).toBe(48);
  });
  it('at 06:00 the sun is still low, within 15% of the viewport height of the back-hill top (SKY-7)', () => {
    const s = skyAt(360, DAY);
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      const pos = arcPosition(s.sun.p, w, h, 'sun');
      const hillTop = h - backHillHeight(h);
      expect(Math.abs(pos.y - hillTop)).toBeLessThanOrEqual(0.15 * h);
    }
  });
  it('the back hill height is clamp(84px, 18vh, 170px)', () => {
    expect(backHillHeight(300)).toBe(84);
    expect(backHillHeight(800)).toBeCloseTo(144, 6);
    expect(backHillHeight(2000)).toBe(170);
  });
  it.each([
    [1280, 900, 232], [1280, 800, 232], [1024, 768, 232], [390, 844, 132],
  ])('no visible body ever enters the header band at %ix%i (band %ipx), every minute', (w, h, band) => {
    for (let m = 0; m < 1440; m++) {
      const s = skyAt(m, DAY);
      for (const kind of ['sun', 'moon'] as const) {
        const b = s[kind];
        if (!b.visible) continue;
        const pos = arcPosition(b.p, w, h, kind);
        const top = pos.y - pos.size / 2;
        if (!(top > band)) throw new Error(`${kind} at ${hhmm(m)} top ${top.toFixed(1)} is inside the ${band}px band`);
      }
    }
  });
});

describe('theme overrides (THEME-2, THEME-3)', () => {
  const at0200 = new Date(2026, 9, 14, 2, 0);
  const at1230 = new Date(2026, 9, 14, 12, 30);
  it("'light' pins 12:30 whatever the clock says", () => {
    for (const d of [at0200, at1230, new Date(2026, 9, 14, 23, 0)]) {
      const s = skyFor('light', d);
      expect(s.minutes).toBe(750);
      expect(s.phase).toBe('midday');
      expect(s.polarity).toBe('light');
      expect(s.sun.visible).toBe(true);
      expect(s.sun.p).toBeCloseTo(0.5, 6);
      expect(s.moon.visible).toBe(false);
      expect(s.starOpacity).toBe(0);
      expect(s.top).toBe('#4FA8EE');
    }
  });
  it("'dark' pins 02:30 whatever the clock says (fix round: was 23:00)", () => {
    for (const d of [at0200, at1230, new Date(2026, 9, 14, 8, 0)]) {
      const s = skyFor('dark', d);
      expect(s.minutes).toBe(150);
      expect(s.phase).toBe('latenight');
      expect(s.polarity).toBe('dark');
      expect(s.moon.visible).toBe(true);
      expect(s.sun.visible).toBe(false);
      expect(s.starOpacity).toBe(1);
      expect(s.top).toBe('#070D22');
    }
  });
  it("'sky' follows the clock", () => {
    expect(skyFor('sky', at0200).phase).toBe('latenight');
    expect(skyFor('sky', at0200).polarity).toBe('dark');
    expect(skyFor('sky', at1230).phase).toBe('midday');
    expect(skyFor('sky', at1230).polarity).toBe('light');
  });
  it('SKY-3 at 02:00: dark, moon, stars at least 0.9, no sun; SKY-4 at 12:30: light, sun, no stars, no moon', () => {
    const n = skyAt(120, DAY);
    expect(n.phase).toBe('latenight');
    expect(n.polarity).toBe('dark');
    expect(n.moon.visible).toBe(true);
    expect(n.sun.visible).toBe(false);
    expect(n.starOpacity).toBeGreaterThanOrEqual(0.9);
    const d = skyAt(750, DAY);
    expect(d.phase).toBe('midday');
    expect(d.polarity).toBe('light');
    expect(d.sun.visible).toBe(true);
    expect(d.starOpacity).toBe(0);
    expect(d.moon.visible).toBe(false);
  });
});

describe('sky ink', () => {
  it('is the better of navy and white against top and mid, every minute', () => {
    for (let m = 0; m < 1440; m++) {
      const s = skyAt(m, DAY);
      const score = (c: string) => Math.min(contrast(hexRgb(c), hexRgb(s.top)), contrast(hexRgb(c), hexRgb(s.mid)));
      const best = score(SKY_INK.dark) >= score(SKY_INK.light) ? SKY_INK.dark : SKY_INK.light;
      if (s.ink !== best) throw new Error(`${hhmm(m)}: ink ${s.ink}, expected ${best}`);
    }
  });
  it('flips exactly twice a day, near 04:40 and 17:15, independently of polarity', () => {
    const flips: number[] = [];
    for (let m = 0; m < 1440; m++) if (skyAt(m, DAY).ink !== skyAt((m + 1) % 1440, DAY).ink) flips.push(m + 1);
    expect(flips).toHaveLength(2);
    expect(flips[0]!).toBeGreaterThan(4 * 60 + 20);
    expect(flips[0]!).toBeLessThan(5 * 60 + 5);
    expect(flips[1]!).toBeGreaterThan(17 * 60 - 10);
    expect(flips[1]!).toBeLessThan(17 * 60 + 40);
    expect(skyAt(750, DAY).ink).toBe(SKY_INK.dark);
    expect(skyAt(1380, DAY).ink).toBe(SKY_INK.light);
  });
});

describe('contrastRatio and composite (exported helpers)', () => {
  it('agree with the independent implementation', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 6);
    for (const [a, b] of [['#13202F', '#4FA8EE'], ['#FFFFFF', '#F09A7E'], ['#9CD3F5', '#16244D']] as const) {
      expect(contrastRatio(a, b)).toBeCloseTo(contrast(hexRgb(a), hexRgb(b)), 6);
    }
  });
  it('composite blends rgba over an opaque hex', () => {
    expect(composite('rgba(255,255,255,0.5)', '#000000')).toBe('#808080');
    expect(composite('rgba(18,27,43,0.78)', '#FFFFFF')).toBe(rgbHex([0.78 * 18 + 0.22 * 255, 0.78 * 27 + 0.22 * 255, 0.78 * 43 + 0.22 * 255]));
    expect(composite('rgba(10,20,30,1)', '#FFFFFF')).toBe('#0A141E');
  });
});

describe('moon phase (D-65)', () => {
  it('new moon at the 2000-01-06 anchor, full about 14.8 days later, waxing before full', () => {
    const nm = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)));
    expect(nm.illumination).toBeLessThan(0.01);
    const full = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14) + 14.765 * 86_400_000));
    expect(full.illumination).toBeGreaterThan(0.99);
    expect(moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14) + 7 * 86_400_000)).waxing).toBe(true);
    expect(moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14) + 22 * 86_400_000)).waxing).toBe(false);
  });
  it('a real full moon (2024-01-25 17:54 UTC) reads as nearly full, a real new moon (2024-01-11 11:57 UTC) as nearly new', () => {
    expect(moonPhase(new Date(Date.UTC(2024, 0, 25, 17, 54))).illumination).toBeGreaterThan(0.95);
    expect(moonPhase(new Date(Date.UTC(2024, 0, 11, 11, 57))).illumination).toBeLessThan(0.05);
  });
  it('illumination stays within 0..1 for a year of days', () => {
    for (let i = 0; i < 400; i++) {
      const p = moonPhase(new Date(2026, 0, 1 + i, 12));
      expect(p.illumination).toBeGreaterThanOrEqual(0);
      expect(p.illumination).toBeLessThanOrEqual(1);
    }
  });
});
