// STICKER-1, STICKER-3, STICKER-4 and the unrenderable-glyph filter (STICKER-8, logic part).
// Pools and weights are copied from design.md 4.2; the schema check is written independently of
// validateStickerData and run against the shipped frontend/src/data/stickers.json.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BURST,
  DRIFT_S,
  FIRST_SPAWN_S,
  FOCUS_SPAWN_S,
  MAX_ON_SCREEN,
  SPAWN_S,
  createStickerPicker,
  mulberry32,
  validateStickerData,
  type StickerData,
} from '../../frontend/src/platform/stickers';
import type { SkyPhaseId } from '../../frontend/src/platform/sky';

const shipped = JSON.parse(readFileSync(new URL('../../frontend/src/data/stickers.json', import.meta.url), 'utf8')) as StickerData;
const PHASES: SkyPhaseId[] = ['latenight', 'dawn', 'morning', 'midday', 'afternoon', 'dusk', 'evening', 'night'];

const DESIGN_POOLS: Record<string, string[]> = {
  medicine: ['🚑', '🩺', '🧬', '🩹', '🏥', '💊', '📚', '🦴', '❤️‍🩹'],
  girly: ['🎀', '🌸', '💖', '✨', '💫', '🫧', '🦋', '🍓', '🧸', '🌈'],
  makeup: ['💄', '💅'],
  night: ['🌙', '⭐', '🦉', '🚑', '🔦'],
  dawn: ['☕', '🌅', '🐦'],
  study: ['📖', '🧠', '🧪', '✏️', '🔬', '⚗️', '🧫', '📝'],
};
// medicine, girly, makeup, night, dawn, study
const DESIGN_WEIGHTS: Record<SkyPhaseId, number[]> = {
  latenight: [4, 2, 0.5, 5, 0, 2],
  dawn: [2, 3, 0.5, 1, 5, 2],
  morning: [3, 3, 0.5, 0, 2, 4],
  midday: [3, 4, 0.5, 0, 0, 4],
  afternoon: [3, 4, 0.5, 0, 0, 3],
  dusk: [3, 4, 0.5, 2, 0, 2],
  evening: [3, 3, 0.5, 3, 0, 2],
  night: [4, 2, 0.5, 5, 0, 2],
};
const POOL_ORDER = ['medicine', 'girly', 'makeup', 'night', 'dawn', 'study'];

const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string) => [...seg.segment(s)].length;

/** The contract V2.5 schema, written out independently. Returns a list of problems. */
function schemaProblems(x: any): string[] {
  const p: string[] = [];
  if (x?.version !== 1) p.push('version');
  if (!x?.pools || typeof x.pools !== 'object') return [...p, 'pools'];
  for (const [id, list] of Object.entries<any>(x.pools)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) p.push(`pool id ${id}`);
    if (!Array.isArray(list)) p.push(`pool ${id} not array`);
    else for (const e of list) if (typeof e !== 'string' || graphemes(e) !== 1) p.push(`pool ${id}: ${e}`);
  }
  const keys = Object.keys(x.weights ?? {});
  if (keys.length !== 8 || !PHASES.every((k) => keys.includes(k))) p.push('weights keys');
  for (const k of keys) for (const [pool, w] of Object.entries<any>(x.weights[k])) if (typeof w !== 'number' || !(w >= 0)) p.push(`weight ${k}.${pool}`);
  return p;
}

describe('the shipped stickers.json (STICKER-1)', () => {
  it('passes validateStickerData and the independent schema check', () => {
    expect(() => validateStickerData(shipped)).not.toThrow();
    expect(schemaProblems(shipped)).toEqual([]);
  });
  it('every emoji is exactly one grapheme (Intl.Segmenter), including the ZWJ and variation-selector ones', () => {
    for (const [id, list] of Object.entries(shipped.pools)) for (const e of list) expect(graphemes(e), `${id}: ${e}`).toBe(1);
    expect(graphemes('❤️‍🩹')).toBe(1);
    expect(graphemes('✏️')).toBe(1);
  });
  it('pools equal design.md 4.2 exactly', () => {
    expect(shipped.pools).toEqual(DESIGN_POOLS);
  });
  it('weights equal design.md 4.2 exactly, for every phase and pool', () => {
    for (const ph of PHASES) {
      const row = POOL_ORDER.map((p) => shipped.weights[ph][p]);
      expect(row, ph).toEqual(DESIGN_WEIGHTS[ph]);
    }
    expect(Object.keys(shipped.weights).sort()).toEqual([...PHASES].sort());
  });
  it('no emoji appears twice inside one pool', () => {
    for (const [id, list] of Object.entries(shipped.pools)) expect(new Set(list).size, id).toBe(list.length);
  });
  it('the timing constants are the documented ones (D-63)', () => {
    expect(FIRST_SPAWN_S).toEqual([20, 40]);
    expect(SPAWN_S).toEqual([45, 90]);
    expect(FOCUS_SPAWN_S).toEqual([120, 240]);
    expect(MAX_ON_SCREEN).toEqual({ wide: 3, narrow: 2, focus: 1 });
    expect(DRIFT_S).toEqual([30, 42]);
    expect(BURST).toEqual({ wide: 12, narrow: 9, milestoneWide: 18, milestoneNarrow: 14, ms: 1400 });
  });
});

describe('validateStickerData rejects schema violations', () => {
  const clone = () => JSON.parse(JSON.stringify(shipped)) as any;
  const bad: Array<[string, (d: any) => void]> = [
    ['version 2', (d) => (d.version = 2)],
    ['missing version', (d) => delete d.version],
    ['uppercase pool id', (d) => (d.pools.Medicine = ['🚑'])],
    ['pool id starting with a digit', (d) => (d.pools['1x'] = ['🚑'])],
    ['pool not an array', (d) => (d.pools.makeup = '💄')],
    ['a two-grapheme string', (d) => d.pools.makeup.push('💄💅')],
    ['an empty string', (d) => d.pools.makeup.push('')],
    ['a number in a pool', (d) => d.pools.makeup.push(5)],
    ['a missing phase', (d) => delete d.weights.dusk],
    ['an extra phase', (d) => (d.weights.noon = {})],
    ['a negative weight', (d) => (d.weights.dawn.study = -1)],
    ['a string weight', (d) => (d.weights.dawn.study = '2')],
    ['a NaN weight', (d) => (d.weights.dawn.study = NaN)],
    ['pools missing', (d) => delete d.pools],
    ['weights missing', (d) => delete d.weights],
  ];
  it.each(bad)('rejects %s', (_n, mut) => {
    const d = clone();
    mut(d);
    expect(() => validateStickerData(d)).toThrow();
  });
  it.each([null, undefined, 3, 'x', []])('rejects %j', (v) => {
    expect(() => validateStickerData(v)).toThrow();
  });
  it('accepts empty pools, extra pools, a pool missing from a row, and an unknown pool in a row', () => {
    const d = clone();
    d.pools.empty = [];
    d.pools['new-pool'] = ['🍀'];
    delete d.weights.dusk.study;
    d.weights.dusk.ghost = 3;
    expect(() => validateStickerData(d)).not.toThrow();
    expect(schemaProblems(d)).toEqual([]);
  });
});

describe('mulberry32 (seeded e2e randomness)', () => {
  const ref = (seed: number) => {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  it('matches the reference algorithm and stays in [0, 1)', () => {
    for (const seed of [1, 7, 42, 20261014]) {
      const a = mulberry32(seed);
      const b = ref(seed);
      for (let i = 0; i < 200; i++) {
        const v = a();
        expect(v).toBe(b());
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe('picker: no back-to-back repeats (STICKER-3)', () => {
  it('across 500 seeded picks per phase, no pick equals the previous one', () => {
    for (const ph of PHASES) {
      const pk = createStickerPicker(shipped, mulberry32(1));
      let prev: string | null = null;
      for (let i = 0; i < 500; i++) {
        const e = pk.pick(ph);
        if (ph === 'dusk' && e === null) throw new Error('unexpected null');
        expect(e, `${ph} #${i}`).not.toBeNull();
        expect(e).not.toBe(prev);
        prev = e;
      }
    }
  });
  it('holds for several seeds, and when the phase changes between picks', () => {
    for (const seed of [2, 3, 99, 123456]) {
      const pk = createStickerPicker(shipped, mulberry32(seed));
      let prev: string | null = null;
      for (let i = 0; i < 500; i++) {
        const e = pk.pick(PHASES[i % PHASES.length]!);
        expect(e).not.toBe(prev);
        prev = e;
      }
    }
  });
  it('never returns anything in `exclude` (what is on screen)', () => {
    const pk = createStickerPicker(shipped, mulberry32(5));
    const onScreen: string[] = [];
    for (let i = 0; i < 500; i++) {
      const e = pk.pick('midday', onScreen)!;
      expect(onScreen).not.toContain(e);
      onScreen.push(e);
      if (onScreen.length > 2) onScreen.shift(); // up to 2 on screen at a time
    }
  });
  it('a burst of 12 from one phase has no duplicates while the pools can supply them', () => {
    const pk = createStickerPicker(shipped, mulberry32(9));
    for (let round = 0; round < 50; round++) {
      const used: string[] = [];
      for (let i = 0; i < 12; i++) {
        const e = pk.pick('midday', used)!;
        expect(used).not.toContain(e);
        used.push(e);
      }
    }
  });
  it('when only one emoji is not excluded it returns exactly that one', () => {
    const d: StickerData = { version: 1, pools: { a: ['🍀', '🍄', '🌵'] }, weights: Object.fromEntries(PHASES.map((p) => [p, { a: 1 }])) as any };
    const pk = createStickerPicker(d, mulberry32(1));
    expect(pk.pick('midday', ['🍀', '🍄'])).toBe('🌵');
    // 🌵 is now the previous pick: whatever comes next (the design only fixes 6 redraws), it is not 🌵
    let prev: string | null = '🌵';
    for (let i = 0; i < 20; i++) {
      const e = pk.pick('midday', ['🍀', '🍄']);
      expect(e).not.toBe(prev);
      prev = e;
    }
  });
  it('a pool with a single emoji never repeats back-to-back (null rather than a repeat)', () => {
    const d: StickerData = { version: 1, pools: { a: ['🍀'] }, weights: Object.fromEntries(PHASES.map((p) => [p, { a: 1 }])) as any };
    const pk = createStickerPicker(d, mulberry32(1));
    expect(pk.pick('midday')).toBe('🍀');
    for (let i = 0; i < 5; i++) expect(pk.pick('midday')).not.toBe('🍀');
  });
});

describe('picker: weights by time (STICKER-4)', () => {
  const N = 10_000;
  const sample = (ph: SkyPhaseId, data: StickerData = shipped, seed = 77) => {
    const pk = createStickerPicker(data, mulberry32(seed));
    return Array.from({ length: N }, () => pk.pick(ph)!);
  };
  const share = (picks: string[], set: string[]) => picks.filter((e) => set.includes(e)).length / picks.length;
  const total = (ph: SkyPhaseId) => DESIGN_WEIGHTS[ph].reduce((a, b) => a + b, 0);

  it('at 23:00 (phase night) the night pool\'s share is within 3 points of its weight fraction', () => {
    const picks = sample('night');
    const frac = 5 / total('night');
    const got = share(picks, DESIGN_POOLS.night!);
    expect(Math.abs(got - frac), `share ${got.toFixed(3)} vs ${frac.toFixed(3)}`).toBeLessThanOrEqual(0.03);
  });
  it('with disjoint pools the share equals the weight fraction within 3 points, in every phase and pool', () => {
    const pools: Record<string, string[]> = { medicine: ['🚑', '🩺', '🧬', '🩹'], girly: ['🎀', '🌸', '💖', '✨'], makeup: ['💄', '💅'], night: ['🌙', '⭐', '🦉', '🔦'], dawn: ['☕', '🌅', '🐦'], study: ['📖', '🧠', '🧪', '✏️'] };
    const data: StickerData = { version: 1, pools, weights: shipped.weights };
    for (const ph of PHASES) {
      const picks = sample(ph, data);
      POOL_ORDER.forEach((pool, i) => {
        const frac = DESIGN_WEIGHTS[ph][i]! / total(ph);
        const got = share(picks, pools[pool]!);
        expect(Math.abs(got - frac), `${ph}/${pool}: ${got.toFixed(3)} vs ${frac.toFixed(3)}`).toBeLessThanOrEqual(0.03);
      });
    }
  });
  it('the dawn pool is never picked at 12:30 (midday) or in the afternoon, dusk, evening or night', () => {
    for (const ph of ['midday', 'afternoon', 'dusk', 'evening', 'night'] as SkyPhaseId[]) {
      const picks = sample(ph);
      expect(share(picks, DESIGN_POOLS.dawn!), ph).toBe(0);
    }
  });
  it('the night pool is never picked by day (zero weight at morning, midday, afternoon)', () => {
    for (const ph of ['morning', 'midday', 'afternoon'] as SkyPhaseId[]) {
      const picks = sample(ph);
      // 🚑 is also a medicine emoji, so test the night-only emoji
      expect(share(picks, ['🌙', '⭐', '🦉', '🔦']), ph).toBe(0);
    }
  });
  it('the night pool dominates after dark and the dawn pool near sunrise', () => {
    expect(share(sample('latenight'), ['🌙', '⭐', '🦉', '🔦'])).toBeGreaterThan(share(sample('dusk'), ['🌙', '⭐', '🦉', '🔦']));
    expect(share(sample('dawn'), DESIGN_POOLS.dawn!)).toBeGreaterThan(0.25);
  });
  it('STICKER-4: the makeup pool is at most 8% at every phase (weight fraction, then measured)', () => {
    const rows = PHASES.map((ph) => {
      const frac = DESIGN_WEIGHTS[ph][2]! / total(ph);
      return { ph, frac, got: share(sample(ph), DESIGN_POOLS.makeup!) };
    });
    console.log(rows.map((r) => `${r.ph}: weight ${(r.frac * 100).toFixed(1)}%, measured ${(r.got * 100).toFixed(1)}%`).join('\n'));
    for (const r of rows) {
      expect(r.frac, `${r.ph} weight fraction`).toBeLessThanOrEqual(0.08);
      expect(r.got, `${r.ph} measured`).toBeLessThanOrEqual(0.08);
    }
  });
});

describe('picker: weights are honoured as data', () => {
  it('a pool with weight 0 is never picked, a pool missing from the row is never picked, an unknown pool in the row is ignored', () => {
    const data: StickerData = {
      version: 1,
      pools: { a: ['🍀', '🍄'], b: ['🌵', '🌴'], c: ['🍎', '🍐'] },
      weights: Object.fromEntries(PHASES.map((p) => [p, { a: 1, b: 0, ghost: 9 }])) as any,
    };
    const pk = createStickerPicker(data, mulberry32(3));
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(pk.pick('midday')!);
    expect([...seen].sort()).toEqual(['🍀', '🍄']);
  });
  it('an all-zero or empty phase returns null (no sticker spawns, no error)', () => {
    const data: StickerData = {
      version: 1,
      pools: { a: ['🍀'], e: [] },
      weights: { ...Object.fromEntries(PHASES.map((p) => [p, { a: 0, e: 5 }])), dawn: { a: 1 } } as any,
    };
    const pk = createStickerPicker(data, mulberry32(1));
    expect(pk.pick('midday')).toBeNull(); // a is zero, e is empty
    expect(pk.pick('night')).toBeNull();
    expect(pk.pick('dawn')).toBe('🍀');
  });
  it('a phase with no weights row at all returns null instead of throwing', () => {
    const data = { version: 1, pools: { a: ['🍀'] }, weights: {} } as unknown as StickerData;
    expect(createStickerPicker(data, mulberry32(1)).pick('midday')).toBeNull();
  });
  it('no pools at all: null', () => {
    const data: StickerData = { version: 1, pools: {}, weights: Object.fromEntries(PHASES.map((p) => [p, {}])) as any };
    expect(createStickerPicker(data, mulberry32(1)).pick('night')).toBeNull();
  });
  it('same seed, same sequence; different seed, different sequence', () => {
    const run = (seed: number) => {
      const pk = createStickerPicker(shipped, mulberry32(seed));
      return Array.from({ length: 50 }, () => pk.pick('night'));
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
});

describe('unrenderable glyph filtering (STICKER-8, D-68)', () => {
  const ALL = [...new Set(Object.values(DESIGN_POOLS).flat())];
  it('supported() drops the emoji a device cannot draw: they are never picked afterwards', () => {
    const missing = new Set(['🫧', '❤️‍🩹']); // Windows 10
    const pk = createStickerPicker(shipped, mulberry32(8));
    pk.supported((e) => !missing.has(e));
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const ph = PHASES[i % PHASES.length]!;
      const e = pk.pick(ph);
      if (e) seen.add(e);
    }
    for (const m of missing) expect(seen.has(m), m).toBe(false);
    expect(seen.size).toBe(ALL.length - 2); // every other emoji still shows up
  });
  it('before supported() is called they can still be picked (the filter is what removes them)', () => {
    const pk = createStickerPicker(shipped, mulberry32(8));
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const e = pk.pick('midday');
      if (e) seen.add(e);
    }
    expect(seen.has('🫧')).toBe(true);
  });
  it('filtering a whole pool leaves the others; filtering everything yields null, never a box or an error', () => {
    const pk = createStickerPicker(shipped, mulberry32(2));
    pk.supported((e) => !DESIGN_POOLS.girly!.includes(e));
    for (let i = 0; i < 500; i++) expect(DESIGN_POOLS.girly).not.toContain(pk.pick('midday'));
    pk.supported(() => false);
    expect(pk.pick('midday')).toBeNull();
    expect(pk.pick('night')).toBeNull();
  });
  it('every emoji in every pool is asked about', () => {
    const asked = new Set<string>();
    const pk = createStickerPicker(shipped, mulberry32(2));
    pk.supported((e) => (asked.add(e), true));
    expect(ALL.every((e) => asked.has(e))).toBe(true);
  });
});
