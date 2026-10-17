import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayKey,
  diffDays,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatRange,
  formatShortDate,
  isoWeekdayIndex,
  numberWord,
  parseDay,
  todayKey,
  weekStart,
} from '@core';
import { at, expectedDay, inLA } from './helpers';

describe('dayKey: 6 AM study-day rollover (EDGE-3)', () => {
  it('05:59:59.999 belongs to the previous date, 06:00:00.000 starts the new one', () => {
    expect(dayKey(at(2026, 10, 14, 5, 59, 59, 999))).toBe('2026-10-13');
    expect(dayKey(at(2026, 10, 14, 6, 0, 0, 0))).toBe('2026-10-14');
  });

  it('a 23:45 to 00:10 session, a 01:30 session and a 05:59 session all count for the evening', () => {
    expect(dayKey(at(2026, 10, 14, 23, 45))).toBe('2026-10-14');
    expect(dayKey(at(2026, 10, 15, 0, 1))).toBe('2026-10-14');
    expect(dayKey(at(2026, 10, 15, 1, 30))).toBe('2026-10-14');
    expect(dayKey(at(2026, 10, 15, 5, 59))).toBe('2026-10-14');
    expect(dayKey(at(2026, 10, 15, 6, 0))).toBe('2026-10-15');
  });

  it('crosses month and year boundaries', () => {
    expect(dayKey(at(2027, 1, 1, 3, 0))).toBe('2026-12-31');
    expect(dayKey(at(2026, 3, 1, 0, 30))).toBe('2026-02-28');
    expect(dayKey(at(2028, 3, 1, 5, 0))).toBe('2028-02-29');
  });

  it('matches an independent implementation over every hour of a week', () => {
    for (let d = 10; d < 17; d++) {
      for (let h = 0; h < 24; h++) {
        expect(dayKey(at(2026, 10, d, h, 30))).toBe(expectedDay(2026, 10, d, h));
      }
    }
  });

  it('todayKey is dayKey of now', () => {
    const now = at(2026, 10, 15, 2, 0);
    expect(todayKey(now)).toBe('2026-10-14');
  });

  it('honours an explicit dayStartHour', () => {
    expect(dayKey(at(2026, 10, 14, 3, 30), 4)).toBe('2026-10-13');
    expect(dayKey(at(2026, 10, 14, 4, 0), 4)).toBe('2026-10-14');
  });

  describe.skipIf(!inLA)('across DST in America/Los_Angeles (EDGE-4)', () => {
    it('spring forward 2026-03-08: 05:30 is still the previous date, 06:00 is the new date', () => {
      expect(dayKey(at(2026, 3, 8, 5, 30))).toBe('2026-03-07');
      expect(dayKey(at(2026, 3, 8, 5, 59))).toBe('2026-03-07');
      // a naive "timestamp minus 6 h" implementation returns 03-07 here: wall clock must win
      expect(dayKey(at(2026, 3, 8, 6, 0))).toBe('2026-03-08');
      expect(dayKey(at(2026, 3, 8, 3, 30))).toBe('2026-03-07'); // first minute after the gap
    });

    it('fall back 2026-11-01: 05:30 is still the previous date, 06:00 is the new date', () => {
      // a naive "timestamp minus 6 h" implementation returns 11-01 for 05:30 (the day is 25 h long)
      expect(dayKey(at(2026, 11, 1, 5, 30))).toBe('2026-10-31');
      expect(dayKey(at(2026, 11, 1, 5, 59))).toBe('2026-10-31');
      expect(dayKey(at(2026, 11, 1, 6, 0))).toBe('2026-11-01');
      expect(dayKey(at(2026, 11, 1, 0, 30))).toBe('2026-10-31');
    });

    it('the repeated 01:30 hour on fall back is the previous date both times', () => {
      const first = Date.UTC(2026, 10, 1, 8, 30); // 01:30 PDT
      const second = Date.UTC(2026, 10, 1, 9, 30); // 01:30 PST
      expect(dayKey(first)).toBe('2026-10-31');
      expect(dayKey(second)).toBe('2026-10-31');
    });

    it('addDays steps by calendar dates across both changes', () => {
      expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
      expect(addDays('2026-03-09', -2)).toBe('2026-03-07');
      expect(diffDays('2026-03-01', '2026-03-31')).toBe(30);
      expect(diffDays('2026-10-25', '2026-11-08')).toBe(14);
    });
  });
});

describe('calendar arithmetic', () => {
  it('addDays handles month, year and leap boundaries and negative steps', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-14', 0)).toBe('2026-10-14');
    expect(addDays('2026-10-14', 365)).toBe('2027-10-14');
  });

  it('diffDays is a whole-day, consistent measure', () => {
    expect(Math.abs(diffDays('2026-10-01', '2026-10-14'))).toBe(13);
    expect(diffDays('2026-10-14', '2026-10-14')).toBe(0);
    const d = diffDays('2026-02-20', '2026-03-05');
    expect(addDays('2026-02-20', d)).toBe('2026-03-05');
  });

  it('parseDay and isoWeekdayIndex', () => {
    expect(parseDay('2026-10-14')).toEqual({ y: 2026, m: 10, d: 14 });
    expect(isoWeekdayIndex('2026-10-18')).toBe(0); // Sunday
    expect(isoWeekdayIndex('2026-10-12')).toBe(1); // Monday
    expect(isoWeekdayIndex('2026-10-14')).toBe(3);
    expect(isoWeekdayIndex('2026-10-17')).toBe(6);
  });

  it('weekStart for Monday and Sunday weeks', () => {
    expect(weekStart('2026-10-14', 1)).toBe('2026-10-12');
    expect(weekStart('2026-10-14', 0)).toBe('2026-10-11');
    expect(weekStart('2026-10-12', 1)).toBe('2026-10-12'); // Monday itself
    expect(weekStart('2026-10-18', 1)).toBe('2026-10-12'); // Sunday belongs to the week before
    expect(weekStart('2026-10-18', 0)).toBe('2026-10-18'); // Sunday starts its own week
    expect(weekStart('2026-10-11', 1)).toBe('2026-10-05');
    expect(weekStart('2027-01-01', 1)).toBe('2026-12-28');
  });
});

describe('formatters', () => {
  it('formatClock ceils seconds: 25:00 for the first second, 0:00 only at the end', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(25 * 60_000 - 1)).toBe('25:00');
    expect(formatClock(25 * 60_000 - 999)).toBe('25:00');
    expect(formatClock(25 * 60_000 - 1000)).toBe('24:59');
    expect(formatClock(59_000)).toBe('0:59');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(90 * 60_000)).toBe('1:30:00');
    expect(formatClock(60 * 60_000)).toBe('1:00:00');
  });

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(60 * 60_000)).toBe('1h');
    expect(formatDuration(85 * 60_000)).toBe('1h 25m');
    expect(formatDuration(580 * 60_000)).toBe('9h 40m');
    expect(formatDuration(89_000)).toBe('1m');
    expect(formatDuration(10_000)).toBe('0m');
  });

  it('day labels and ranges', () => {
    expect(formatDayLabel('2026-10-14')).toBe('Wed, Oct 14');
    expect(formatShortDate('2026-10-14')).toBe('Oct 14');
    expect(formatRange('2026-10-13', '2026-10-19')).toBe('Oct 13 to Oct 19');
    expect(formatRange('2026-10-27', '2026-11-02')).toBe('Oct 27 to Nov 2');
  });

  it('numberWord: 2 to 12 as words, otherwise digits', () => {
    const words = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    words.forEach((w, i) => expect(numberWord(i + 2)).toBe(w));
    expect(numberWord(13)).toBe('13');
    expect(numberWord(40)).toBe('40');
    expect(numberWord(1)).toBe('1');
  });
});
