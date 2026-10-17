// NAME-1, NAME-3, NAME-4 (copy side), NAME-5, NAME-6. Copy is compared with spec.md Appendix D
// and design.md section 9, not with the implementation.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { greetingFor, greetingWindow, type GreetingWindow, type SkyCopy } from '../../frontend/src/app/greeting';
import type { StreakInfo } from '@core';

const root = new URL('../../', import.meta.url);
const spec = readFileSync(new URL('docs/spec.md', root), 'utf8');
const messages = JSON.parse(readFileSync(new URL('frontend/src/data/messages.json', root), 'utf8')) as { sky: SkyCopy };
const copy = messages.sky;
const WINDOWS: GreetingWindow[] = ['dawn', 'morning', 'afternoon', 'evening', 'night'];
const BANNED = ['late', 'sleep', 'sleepy', 'tired', 'bed', 'bedtime', 'exhausted'];
const hasBanned = (s: string) => BANNED.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s));

const streak = (current: number): StreakInfo => ({ current, best: current, todayCounts: current > 0, currentStartDay: null, lastCountingDay: null });
const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m);
const g = (over: Partial<Parameters<typeof greetingFor>[0]> = {}) =>
  greetingFor({ now: at(14), studyDay: '2026-10-14', name: 'Em', todaySessions: 0, streak: streak(0), copy, ...over });

describe('copy is Appendix D verbatim', () => {
  const section = spec.slice(spec.indexOf('## Appendix D'));
  it('every greeting line, in order', () => {
    for (const w of WINDOWS) {
      const re = new RegExp(`^- ${w} \\([^)]*\\): (.+)$`, 'm');
      const lines = [...re.exec(section)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      expect(lines, w).toHaveLength(3);
      expect(copy.greetings[w], w).toEqual(lines);
    }
  });
  it('every subline template', () => {
    const tpls = [...section.slice(section.indexOf('Subline templates')).matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(tpls.sort()).toEqual(Object.values(copy.subline).sort());
  });
  it('has no em or en dashes (house rule)', () => {
    expect(JSON.stringify(copy)).not.toMatch(/[–—]/);
  });
});

describe('greeting windows by the real clock (NAME-5)', () => {
  it.each([
    ['00:00', 'night'], ['04:29', 'night'], ['04:30', 'dawn'], ['06:59', 'dawn'], ['07:00', 'morning'], ['11:59', 'morning'],
    ['12:00', 'afternoon'], ['16:59', 'afternoon'], ['17:00', 'evening'], ['20:59', 'evening'], ['21:00', 'night'], ['23:59', 'night'],
  ])('%s is %s', (t, w) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    expect(greetingWindow(h * 60 + m)).toBe(w);
    // and the rendered greeting is one of that window's lines
    const lines = copy.greetings[w as GreetingWindow].map((l) => l.replace(', {name}', ', Em'));
    expect(lines).toContain(g({ now: at(h, m) }).title);
  });
});

describe('variants (NAME-5)', () => {
  it('stable across 100 calls within a study day and window', () => {
    const first = g().title;
    for (let i = 0; i < 100; i++) expect(g({ now: at(12 + (i % 5), i % 60) }).title).toBe(first);
  });
  it('same study day, same window, different minute: same variant', () => {
    expect(g({ now: at(12, 0) }).title).toBe(g({ now: at(16, 59) }).title);
  });
  it('varies across days: all 3 variants appear over 60 study days, and consecutive days are not all equal', () => {
    const titles: string[] = [];
    for (let d = 0; d < 60; d++) {
      const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      titles.push(g({ studyDay: day as any }).title);
    }
    expect(new Set(titles).size).toBe(3);
    expect(titles.some((t, i) => i > 0 && t !== titles[i - 1])).toBe(true);
  });
  it('the night window has the "Night owl session" variant reachable', () => {
    const titles = new Set<string>();
    for (let d = 0; d < 60; d++) {
      const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      titles.add(g({ now: at(23), studyDay: day as any }).title);
    }
    expect([...titles].sort()).toEqual(['Night owl session, Em', 'Night shift focus, Em', 'Starry night session, Em']);
  });
});

describe('name handling (NAME-1, NAME-3, NAME-4)', () => {
  it('the default name goes in after the comma', () => {
    expect(g().title).toMatch(/, Em$/);
  });
  it('a blank or whitespace name drops the comma and the name', () => {
    for (const name of ['', '   ', '\t']) {
      for (const w of WINDOWS) {
        const lines = copy.greetings[w].map((l) => l.replace(/,\s*\{name\}/, ''));
        const hour = { dawn: 5, morning: 9, afternoon: 14, evening: 18, night: 23 }[w];
        const t = g({ name, now: at(hour) }).title;
        expect(lines, `${w} "${name}"`).toContain(t);
        expect(t).not.toMatch(/[,{}]\s*$/);
        expect(t).not.toContain('{name}');
      }
    }
  });
  it('the name is trimmed', () => {
    expect(g({ name: '  Emily  ' }).title).toMatch(/, Emily$/);
  });
  it('markup in a name is returned as plain text, untouched (the caller renders it with textContent)', () => {
    const t = g({ name: '<b>x</b>' }).title;
    expect(t.endsWith(', <b>x</b>')).toBe(true);
  });
  it('a name containing replacement patterns is inserted literally', () => {
    expect(g({ name: '$& {name} $1' }).title.endsWith(', $& {name} $1')).toBe(true);
  });
  it('a 24 character name fits', () => {
    const name = 'abcdefghijklmnopqrstuvwx';
    expect(g({ name }).title.endsWith(`, ${name}`)).toBe(true);
  });
});

describe('night copy and the banned words (NAME-5)', () => {
  it('every night line contains "night", case-insensitively', () => {
    for (const l of copy.greetings.night) expect(l.toLowerCase(), l).toContain('night');
  });
  it('at least one night line is "Night owl session"', () => {
    expect(copy.greetings.night.some((l) => /night owl/i.test(l))).toBe(true);
  });
  it('no greeting or subline template contains late, sleep, sleepy, tired, bed, bedtime or exhausted', () => {
    const all = [...WINDOWS.flatMap((w) => copy.greetings[w]), ...Object.values(copy.subline)];
    for (const s of all) expect(hasBanned(s), s).toBe(false);
  });
  it('the rendered night greeting at 02:30, 03:00, 23:00 and 21:00 contains "night" and no banned word', () => {
    for (const [h, m] of [[2, 30], [3, 0], [23, 0], [21, 0], [4, 29]] as const) {
      for (let d = 0; d < 20; d++) {
        const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
        const t = g({ now: at(h, m), studyDay: day as any }).title;
        expect(t.toLowerCase()).toContain('night');
        expect(hasBanned(t), t).toBe(false);
      }
    }
  });
  it('the word "late" is not hiding inside any rendered subline across a sweep of states', () => {
    for (let k = 0; k <= 12; k++) for (let n = 0; n <= 40; n++) expect(hasBanned(g({ todaySessions: k, streak: streak(n) }).sub)).toBe(false);
  });
});

describe('the subline, first match wins (NAME-6)', () => {
  const sub = (k: number, n: number) => g({ todaySessions: k, streak: streak(n) }).sub;
  it('rule 1: sessions today and a streak of 7 or more', () => {
    expect(sub(1, 7)).toBe('7-day streak, look at you');
    expect(sub(3, 9)).toBe('9-day streak, look at you');
    expect(sub(5, 30)).toBe('30-day streak, look at you');
  });
  it('rule 2: sessions today and a streak of 2 to 6', () => {
    expect(sub(3, 6)).toBe('3 sessions today · 6-day streak');
    expect(sub(2, 2)).toBe('2 sessions today · 2-day streak');
    expect(sub(1, 3)).toBe('1 session today · 3-day streak');
  });
  it('rule 3: sessions today, no streak to speak of', () => {
    expect(sub(4, 0)).toBe('4 sessions today');
    expect(sub(1, 0)).toBe('1 session today');
    expect(sub(1, 1)).toBe('1 session today');
    expect(sub(2, 1)).toBe('2 sessions today');
  });
  it('rule 4: no sessions today, a live streak', () => {
    expect(sub(0, 1)).toBe('Keep your streak going');
    expect(sub(0, 2)).toBe('Keep your 2-day streak going');
    expect(sub(0, 12)).toBe('Keep your 12-day streak going');
  });
  it('rule 5: otherwise', () => {
    expect(sub(0, 0)).toBe('Ready when you are');
  });
  it('singular for exactly 1, plural otherwise, digits always', () => {
    expect(sub(1, 0)).not.toContain('sessions');
    expect(sub(0 + 2, 0)).toContain('sessions');
    for (let k = 1; k <= 12; k++) for (let n = 0; n <= 10; n++) expect(sub(k, n)).toMatch(/\d/);
  });
  it('the subline does not depend on the clock window', () => {
    expect(g({ now: at(2, 30), todaySessions: 3, streak: streak(6) }).sub).toBe('3 sessions today · 6-day streak');
  });
});
