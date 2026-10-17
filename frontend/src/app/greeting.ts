// Greeting and subline (design.md section 9). Pure: the clock, study day, name and stats go in,
// two strings come out. The caller renders them as text nodes, never as HTML.
import type { ISODay, StreakInfo } from '@core';

export type GreetingWindow = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

export interface SkyCopy {
  greetings: Record<GreetingWindow, string[]>;
  subline: {
    streakStar: string;
    todayAndStreak: string;
    todayAndStreakOne: string;
    today: string;
    todayOne: string;
    keepStreak: string;
    keepStreakOne: string;
    ready: string;
  };
}

/** Window by the real local clock: dawn 04:30, morning 07:00, afternoon 12:00, evening 17:00, night 21:00. */
export function greetingWindow(minutes: number): GreetingWindow {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m >= 270 && m < 420) return 'dawn';
  if (m >= 420 && m < 720) return 'morning';
  if (m >= 720 && m < 1020) return 'afternoon';
  if (m >= 1020 && m < 1260) return 'evening';
  return 'night';
}

/** Small stable string hash (FNV-1a), so a variant holds for a whole study day. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const fill = (tpl: string, vars: Record<string, string | number>): string =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

export function greetingFor(input: {
  now: Date;
  studyDay: ISODay;
  name: string;
  todaySessions: number;
  streak: StreakInfo;
  copy: SkyCopy;
}): { title: string; sub: string } {
  const { now, studyDay, copy, todaySessions: k, streak } = input;
  const name = input.name.trim();
  const win = greetingWindow(now.getHours() * 60 + now.getMinutes());
  const lines = copy.greetings[win];
  const tpl = lines[hash(`${studyDay}|${win}`) % lines.length]!;
  const title = name ? fill(tpl, { name }) : tpl.replace(/,?\s*\{name\}/, '');

  const n = streak.current;
  const c = copy.subline;
  let sub: string;
  if (k > 0 && n >= 7) sub = fill(c.streakStar, { n });
  else if (k > 0 && n >= 2) sub = fill(k === 1 ? c.todayAndStreakOne : c.todayAndStreak, { k, n });
  else if (k > 0) sub = fill(k === 1 ? c.todayOne : c.today, { k });
  else if (n >= 1) sub = n === 1 ? c.keepStreakOne : fill(c.keepStreak, { n });
  else sub = c.ready;
  return { title, sub };
}
