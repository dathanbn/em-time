import { describe, expect, it } from 'vitest';
import { heatLevel, heatmapCells, MIN, statsSessions, type Session } from '@core';
import { at, mkSession, onDay } from './helpers';

const TODAY = '2026-10-14'; // a Wednesday
const mins = (n: number) => ({ plannedMs: n * MIN, focusedMs: n * MIN });
const cells = (s: Session[], goal = 120, ws: 0 | 1 = 1, today = TODAY) =>
  heatmapCells(statsSessions(s, today), today, ws, goal);

describe('heatLevel thresholds (HM-2)', () => {
  it('goal 120: 0 | 1-29 | 30-59 | 60-119 | 120+', () => {
    const lv = (m: number) => heatLevel(m * MIN, 120);
    expect([lv(0), lv(1), lv(29), lv(30), lv(59), lv(60), lv(119), lv(120), lv(300)]).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('boundaries are exact to the millisecond', () => {
    expect(heatLevel(30 * MIN - 1, 120)).toBe(1);
    expect(heatLevel(60 * MIN - 1, 120)).toBe(2);
    expect(heatLevel(120 * MIN - 1, 120)).toBe(3);
    expect(heatLevel(1, 120)).toBe(1);
  });

  it('goal 60: 0 | 1-14 | 15-29 | 30-59 | 60+', () => {
    const lv = (m: number) => heatLevel(m * MIN, 60);
    expect([lv(0), lv(1), lv(14), lv(15), lv(29), lv(30), lv(59), lv(60), lv(61)]).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('scales with any goal (D-9: changing the goal recolours history)', () => {
    expect(heatLevel(50 * MIN, 120)).toBe(2);
    expect(heatLevel(50 * MIN, 60)).toBe(3);
    expect(heatLevel(50 * MIN, 45)).toBe(4);
    expect(heatLevel(15 * MIN, 720)).toBe(1);
  });
});

describe('heatmapCells (HM-1, HM-2)', () => {
  it('draws 9 week columns ending with the current week; future days are omitted', () => {
    const c = cells([]);
    // columns 0-7 are full weeks (56 days) and column 8 holds Mon, Tue, Wed
    expect(c).toHaveLength(8 * 7 + 3);
    expect(Math.max(...c.map((x) => x.col))).toBe(8);
    expect(Math.min(...c.map((x) => x.col))).toBe(0);
    expect(c.filter((x) => x.col === 8).map((x) => x.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(c.every((x) => x.day <= TODAY)).toBe(true);
    expect(c[0]!.day).toBe('2026-08-17'); // 8 weeks before the current week's Monday
    expect(c.filter((x) => x.isToday).map((x) => x.day)).toEqual([TODAY]);
  });

  it('rows follow weekStartsOn: Monday-start row 0 is Monday, Sunday-start row 0 is Sunday', () => {
    const mon = cells([], 120, 1);
    expect(mon.find((x) => x.day === '2026-10-12')!.row).toBe(0);
    expect(mon.find((x) => x.day === '2026-10-14')!.row).toBe(2);
    const sun = cells([], 120, 0);
    expect(sun.find((x) => x.day === '2026-10-11')!.row).toBe(0);
    expect(sun.find((x) => x.day === '2026-10-14')!.row).toBe(3);
    expect(sun.find((x) => x.day === '2026-10-14')!.col).toBe(8);
    expect(sun.filter((x) => x.col === 8)).toHaveLength(4); // Sun..Wed
  });

  it('on a Sunday the current week is complete', () => {
    const c = cells([], 120, 1, '2026-10-18');
    expect(c).toHaveLength(63);
    expect(c.filter((x) => x.col === 8)).toHaveLength(7);
  });

  it('assigns levels from each study day total against the goal', () => {
    const s = [
      onDay(2026, 10, 12, 9, 0, mins(29)),
      onDay(2026, 10, 13, 9, 0, mins(60)),
      onDay(2026, 10, 14, 9, 0, mins(120)),
      onDay(2026, 10, 7, 9, 0, mins(30)),
      onDay(2026, 10, 8, 9, 0, mins(119)),
    ];
    const lv = (d: string, goal = 120) => cells(s, goal).find((x) => x.day === d)!.level;
    expect(lv('2026-10-12')).toBe(1);
    expect(lv('2026-10-13')).toBe(3);
    expect(lv('2026-10-14')).toBe(4);
    expect(lv('2026-10-07')).toBe(2);
    expect(lv('2026-10-08')).toBe(3);
    expect(lv('2026-10-09')).toBe(0);
    // goal 60 recolours the same history
    expect(lv('2026-10-12', 60)).toBe(2);
    expect(lv('2026-10-13', 60)).toBe(4);
    expect(lv('2026-10-08', 60)).toBe(4);
  });

  it('adds up several sessions on one study day', () => {
    const s = [onDay(2026, 10, 13, 9), onDay(2026, 10, 13, 10), onDay(2026, 10, 13, 11)]; // 75 min
    const cell = cells(s).find((x) => x.day === '2026-10-13')!;
    expect(cell.focusMs).toBe(75 * MIN);
    expect(cell.level).toBe(3);
  });

  it('a 1 AM session colours the previous date cell', () => {
    const s = [mkSession(at(2026, 10, 14, 1, 0), mins(60))];
    const c = cells(s);
    expect(c.find((x) => x.day === '2026-10-13')!.focusMs).toBe(60 * MIN);
    expect(c.find((x) => x.day === '2026-10-14')!.focusMs).toBe(0);
  });

  it('labels carry the date and duration', () => {
    const s = [onDay(2026, 10, 14, 9, 0, mins(85))];
    const cell = cells(s).find((x) => x.isToday)!;
    expect(cell.label).toBe('Wed, Oct 14 · 1h 25m');
    expect(cells(s).find((x) => x.day === '2026-10-13')!.label).toMatch(/^Tue, Oct 13 · 0m$/);
  });

  it('sessions older than the 9-week window are not drawn', () => {
    const s = [onDay(2026, 6, 1, 9)];
    expect(cells(s).every((x) => x.focusMs === 0)).toBe(true);
  });

  it('future-dated sessions never colour a cell (EDGE-5)', () => {
    const s = [onDay(2026, 10, 15, 9)];
    expect(cells(s).every((x) => x.focusMs === 0)).toBe(true);
  });
});
