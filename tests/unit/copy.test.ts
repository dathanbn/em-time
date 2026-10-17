import { describe, expect, it } from 'vitest';
import { createBag, milestonesReached, nextFromBag, renderMessage, type StreakInfo } from '@core';
import { copyFixture } from './helpers';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const spec = readFileSync(new URL('docs/spec.md', root), 'utf8');
const messages = JSON.parse(readFileSync(new URL('frontend/src/data/messages.json', root), 'utf8')) as {
  encouragement: string[];
  breakPrompts: string[];
  milestones: Record<string, string>;
  aboutLine: string;
};

function appendix(letter: 'A' | 'B' | 'C'): string {
  const start = spec.indexOf(`## Appendix ${letter}`);
  const next = spec.indexOf('\n## ', start + 5);
  return spec.slice(start, next === -1 ? undefined : next);
}

describe('MSG-2 / BRK-1 / MIL-2: copy is used verbatim from the spec appendices', () => {
  it('Appendix A: 40 encouraging lines, in order', () => {
    const lines = [...appendix('A').matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
    expect(lines).toHaveLength(40);
    expect(messages.encouragement).toEqual(lines);
    expect(messages.encouragement.filter((l) => l.includes('{sessions}'))).toHaveLength(4);
    expect(messages.encouragement.slice(0, 4).every((l) => l.includes('{sessions}'))).toBe(true);
  });

  it('Appendix B: 12 break prompts, in order', () => {
    const lines = [...appendix('B').matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
    expect(lines).toHaveLength(12);
    expect(messages.breakPrompts).toEqual(lines);
  });

  it('Appendix C: 6 milestone messages', () => {
    const rows = [...appendix('C').matchAll(/^- `([a-z0-9-]+)`: (.+)$/gm)];
    expect(rows).toHaveLength(6);
    for (const [, id, text] of rows) expect(messages.milestones[id!]).toBe(text);
  });

  it('has an about line and no em or en dashes anywhere in the copy', () => {
    expect(messages.aboutLine.length).toBeGreaterThan(0);
    expect(JSON.stringify(messages)).not.toMatch(/[–—]/);
  });
});

describe('shuffle bag (BRK-2, MSG-3)', () => {
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it('createBag holds each index once, shuffled by the random source', () => {
    const bag = createBag(12, seeded(1));
    expect([...bag].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
    expect(createBag(12, seeded(2))).not.toEqual(createBag(12, seeded(3)));
  });

  it('no repeat until every item has been shown, then it refills', () => {
    const rand = seeded(7);
    let bag: number[] = [];
    const drawn: number[] = [];
    for (let i = 0; i < 36; i++) {
      const r = nextFromBag(bag, () => true, 12, rand);
      drawn.push(r.index);
      bag = r.bag;
    }
    for (let round = 0; round < 3; round++) {
      const slice = drawn.slice(round * 12, round * 12 + 12);
      expect([...slice].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
    }
  });

  it('ineligible items are skipped and stay in the bag for later', () => {
    const rand = seeded(11);
    let bag: number[] = [];
    const eligible = (i: number) => i >= 4; // lines 0-3 need 2+ sessions
    const first: number[] = [];
    for (let i = 0; i < 36; i++) {
      const r = nextFromBag(bag, eligible, 40, rand);
      first.push(r.index);
      bag = r.bag;
    }
    expect(first.every((i) => i >= 4)).toBe(true);
    expect(new Set(first).size).toBe(36); // all 36 eligible lines, no repeats
    const withAll = nextFromBag(bag, () => true, 40, rand);
    expect(withAll.index).toBeGreaterThanOrEqual(0);
  });

  it('an empty eligible set yields no index instead of looping forever', () => {
    const r = nextFromBag([], () => false, 5, seeded(1));
    expect(r.index).toBe(-1);
  });
});

describe('renderMessage: the {sessions} token (MSG-2)', () => {
  it('is ineligible below 2 sessions today', () => {
    expect(renderMessage('{sessions} sessions in. Nicely done.', 1)).toBeNull();
    expect(renderMessage('{sessions} sessions in. Nicely done.', 0)).toBeNull();
  });
  it('capitalised word at the start of a line, lowercase elsewhere, digits above 12', () => {
    expect(renderMessage('{sessions} sessions in. Nicely done.', 3)).toBe('Three sessions in. Nicely done.');
    expect(renderMessage("That's {sessions} today. Steady work.", 3)).toBe("That's three today. Steady work.");
    expect(renderMessage('{sessions} sessions down. You\'re building something.', 2)).toBe("Two sessions down. You're building something.");
    expect(renderMessage('{sessions} today. The pages add up.', 12)).toBe('Twelve today. The pages add up.');
    expect(renderMessage('{sessions} sessions in. Nicely done.', 13)).toBe('13 sessions in. Nicely done.');
    expect(renderMessage("That's {sessions} today. Steady work.", 21)).toBe("That's 21 today. Steady work.");
  });
  it('lines without the token are always eligible and unchanged', () => {
    expect(renderMessage('Well earned.', 0)).toBe('Well earned.');
    expect(renderMessage('Well earned.', 5)).toBe('Well earned.');
  });
});

describe('milestonesReached (MIL-1)', () => {
  const streak = (current: number, start: string | null = null): StreakInfo => ({
    current,
    best: current,
    todayCounts: true,
    currentStartDay: start,
    lastCountingDay: start,
  });
  const none = streak(1, '2026-10-14');
  const reach = (p: number, n: number, shown: string[] = [], ps = none, ns = none) =>
    milestonesReached({ total: p, streak: ps }, { total: n, streak: ns }, shown, copyFixture).map((m) => m.id);

  it('fires exactly when a session threshold is crossed', () => {
    expect(reach(9, 10)).toEqual(['sessions-10']);
    expect(reach(10, 11)).toEqual([]);
    expect(reach(49, 50)).toEqual(['sessions-50']);
    expect(reach(99, 100)).toEqual(['sessions-100']);
    expect(reach(249, 250)).toEqual(['sessions-250']);
    expect(reach(0, 1)).toEqual([]);
  });

  it('never replays a milestone that was already shown', () => {
    expect(reach(9, 10, ['sessions-10'])).toEqual([]);
  });

  it('streak milestones at 7 and 30 days, once per streak run', () => {
    const r6 = streak(6, '2026-10-01');
    const r7 = streak(7, '2026-10-01');
    expect(reach(20, 21, [], r6, r7)).toEqual(['streak-7']);
    expect(reach(21, 22, ['streak-7@2026-10-01'], r7, streak(8, '2026-10-01'))).toEqual([]);
    // a new run later fires again
    expect(reach(30, 31, ['streak-7@2026-10-01'], streak(6, '2026-11-01'), streak(7, '2026-11-01'))).toEqual(['streak-7']);
    expect(reach(60, 61, [], streak(29, '2026-09-01'), streak(30, '2026-09-01'))).toEqual(['streak-30']);
  });

  it('text comes from the copy', () => {
    const [m] = milestonesReached({ total: 9, streak: none }, { total: 10, streak: none }, [], copyFixture);
    expect(m!.text).toBe(copyFixture.milestones['sessions-10']);
  });
});
