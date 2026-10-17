import { describe, expect, it } from 'vitest';
import { statsSessions, streakInfo, todayKey, type Session } from '@core';
import { at, mkSession, onDay } from './helpers';

const TODAY = '2026-10-14';
const run = (days: number[], month = 10): Session[] => days.map((d) => onDay(2026, month, d, 10));
const info = (s: Session[], today = TODAY) => streakInfo(statsSessions(s, today), today);

describe('streaks (STK-1..3)', () => {
  it('no sessions: everything zero', () => {
    expect(info([])).toMatchObject({ current: 0, best: 0, todayCounts: false, currentStartDay: null });
  });

  it('counts consecutive days ending today', () => {
    const r = info(run([10, 11, 12, 13, 14]));
    expect(r).toMatchObject({ current: 5, best: 5, todayCounts: true, currentStartDay: '2026-10-10' });
  });

  it('several sessions on one day count once', () => {
    const s = [...run([13, 14]), onDay(2026, 10, 14, 11), onDay(2026, 10, 14, 12), onDay(2026, 10, 13, 15)];
    expect(info(s)).toMatchObject({ current: 2, best: 2 });
  });

  it('today not counted yet but yesterday did: current streak is kept, todayCounts false', () => {
    const r = info(run([11, 12, 13]));
    expect(r).toMatchObject({ current: 3, best: 3, todayCounts: false, currentStartDay: '2026-10-11' });
  });

  it('one missed day resets the current streak; best remembers the longer old run', () => {
    // Oct 1-5 (5 days), gap, Oct 8-9, gap on Oct 10, Oct 11-13 (3 days); today Oct 13
    const s = run([1, 2, 3, 4, 5, 8, 9, 11, 12, 13]);
    const r = info(s, '2026-10-13');
    expect(r.current).toBe(3);
    expect(r.best).toBe(5);
    expect(r.currentStartDay).toBe('2026-10-11');
  });

  it('neither today nor yesterday counted: current is 0, best is kept', () => {
    const r = info(run([8, 9, 10, 11]));
    expect(r.current).toBe(0);
    expect(r.best).toBe(4);
    expect(r.todayCounts).toBe(false);
  });

  it('best includes the current run when it is the longest', () => {
    const r = info(run([1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    expect(r.current).toBe(10);
    expect(r.best).toBe(10);
  });

  it('a 23:45 to 00:10 session counts only for its start day', () => {
    const overnight = mkSession(at(2026, 10, 12, 23, 45), { plannedMs: 25 * 60_000 }); // ends 00:10 Oct 13
    expect(overnight.day).toBe('2026-10-12');
    const s = [onDay(2026, 10, 11, 10), overnight, onDay(2026, 10, 13, 10), onDay(2026, 10, 14, 10)];
    expect(info(s)).toMatchObject({ current: 4, best: 4 });
    // without the overnight session there would be a hole on Oct 12
    expect(info([s[0]!, s[2]!, s[3]!]).current).toBe(2);
  });

  it('01:30 and 05:59 sessions count for the previous date, 06:00 for the new one', () => {
    // "now" is 06:00 on Oct 15, so today is Oct 15
    const today = todayKey(at(2026, 10, 15, 6, 0));
    expect(today).toBe('2026-10-15');
    const s = [
      onDay(2026, 10, 13, 10),
      mkSession(at(2026, 10, 14, 1, 30)), // counts for Oct 13
      mkSession(at(2026, 10, 15, 5, 59)), // counts for Oct 14
    ];
    expect(info(s, '2026-10-14')).toMatchObject({ current: 2, todayCounts: true });
    expect(info(s, today)).toMatchObject({ current: 2, todayCounts: false }); // Oct 15 not yet
    const withSix = [...s, mkSession(at(2026, 10, 15, 6, 0))];
    expect(info(withSix, today)).toMatchObject({ current: 3, todayCounts: true });
  });

  it('05:59 and 06:00 on the same morning are different days (a 2-day streak from two sessions)', () => {
    const s = [mkSession(at(2026, 10, 14, 5, 59)), mkSession(at(2026, 10, 14, 6, 0))];
    expect(s[0]!.day).toBe('2026-10-13');
    expect(s[1]!.day).toBe('2026-10-14');
    expect(info(s).current).toBe(2);
  });

  it('a streak running across the spring-forward and fall-back days is unbroken', () => {
    const spring = [6, 7, 8, 9, 10].map((d) => onDay(2026, 3, d, 7, 30));
    expect(info(spring, '2026-03-10')).toMatchObject({ current: 5, best: 5 });
    const fall = [onDay(2026, 10, 31, 20), mkSession(at(2026, 11, 1, 5, 30)), onDay(2026, 11, 1, 6, 0), onDay(2026, 11, 2, 9)];
    // 05:30 on Nov 1 belongs to Oct 31, so Oct 31, Nov 1, Nov 2 are consecutive
    expect(info(fall, '2026-11-02')).toMatchObject({ current: 3 });
  });

  it('future-dated sessions are ignored by the stats pipeline', () => {
    const s = [...run([13, 14]), onDay(2026, 10, 15, 10), onDay(2026, 10, 16, 10)];
    expect(info(s)).toMatchObject({ current: 2, best: 2 });
  });

  it('tombstoned sessions do not count', () => {
    const s = [...run([12, 13]), onDay(2026, 10, 14, 10, 0, { deletedAt: at(2026, 10, 14, 11) })];
    expect(info(s)).toMatchObject({ current: 2, todayCounts: false });
  });
});
