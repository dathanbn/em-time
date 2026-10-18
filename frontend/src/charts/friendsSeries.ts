// Series for the Friends charts (the Stats tile and the Timer card): built once here so both draw
// the same lines. Pure; no DOM.
import { MIN, type FriendWeek, type ISODay } from '@core';
import { friendName } from '../app/friendsText';
import { monotonePath } from './geometry';

export interface FriendSeries {
  key: string;
  name: string;
  /** CSS color of the line and the dots (a var() token). */
  color: string;
  you?: boolean;
  /** Code off: named in the legend, no line. */
  inactive?: boolean;
  /** Minutes for each of the 7 days, oldest first. */
  values: number[];
}

/** You: solid and in ink, told apart from the colored friends by weight and the legend, never by color alone. */
export const YOU_COLOR = 'var(--em-ink)';
export const YOU_WIDTH = 2.5;
export const FRIEND_WIDTH = 2;

/** You first, then the friends in list order, each in the color the server gave them. */
export function buildFriendSeries(list: FriendWeek[], days: ISODay[], you: number[]): FriendSeries[] {
  return [
    { key: 'you', name: 'You', color: YOU_COLOR, you: true, values: you },
    ...list.map((f, i) => ({
      key: f.code,
      name: friendName(f, i),
      color: `var(--em-cat-${f.color})`,
      inactive: !f.active,
      values: days.map((d) => (f.days[d] ?? 0) / MIN),
    })),
  ];
}

/** The highest value of any line that is drawn (inactive friends have none). */
export const seriesTop = (series: FriendSeries[]): number =>
  Math.max(0, ...series.filter((s) => !s.inactive).flatMap((s) => s.values));

/** One continuous smooth path through every day's value (monotone: no overshoot between days). */
export function seriesPath(values: number[], xOf: (i: number) => number, yOf: (m: number) => number): string {
  return monotonePath(values.map((v, i) => ({ x: xOf(i), y: yOf(v) })));
}

/** "2 h 10 min", "45 min", "0 min": for spoken summaries and the hidden table. */
export function spoken(min: number): string {
  const t = Math.round(min);
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "You 2 h 10 min total, Cathy 3 h 5 min total, Sam, code off". */
export const seriesSummary = (series: FriendSeries[]): string =>
  series
    .map((s) => (s.inactive ? `${s.name}, code off` : `${s.name} ${spoken(s.values.reduce((a, b) => a + b, 0))} total`))
    .join(', ');

export interface Standing {
  key: string;
  name: string;
  color: string;
  /** Minutes on the last day (today). */
  min: number;
}

/** Today's standings for the Timer card: active series only, in series order (You first). */
export const standings = (series: FriendSeries[]): Standing[] =>
  series
    .filter((s) => !s.inactive)
    .map((s) => ({ key: s.key, name: s.name, color: s.color, min: s.values[s.values.length - 1] ?? 0 }));
