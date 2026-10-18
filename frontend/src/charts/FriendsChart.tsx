// Friends tile (v6): focus minutes per day for the last 7 study days, You plus up to 5 friends.
// The series carry their own colors; names, values and the table never rely on color alone.
import { useRef, useState } from 'preact/hooks';
import { MIN, formatDayLabel, formatDuration, type ISODay } from '@core';
import type { FriendsState } from '../app/friends';
import { agoText, friendName } from '../app/friendsText';
import { go } from '../app/router';
import { Button } from '../components/ui';
import { evenX, nearestIndex, niceFriendsMax, shortMinutes } from './friendsGeometry';
import { durationTicks, thinTicks } from './geometry';
import { anchorOf, hideTip, showTip } from './Tooltip';
import { useSize } from './useSize';

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

const LEFT = 34;
const RIGHT = 20;
const TOP = 10;
const AXIS = 24;
const X_LABELS = ['6', '5', '4', '3', '2', '1', 'Today'];

/** "2 h 10 min", "45 min", "0 min": for the spoken summary and the table. */
function spoken(min: number): string {
  const t = Math.round(min);
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const daysAgo = (i: number, n: number): string => (i === n - 1 ? 'Today' : `${n - 1 - i} days ago`);

export function FriendsChart({ days, series, narrow }: { days: ISODay[]; series: FriendSeries[]; narrow: boolean }) {
  const [wrap, width] = useSize();
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const n = days.length;
  const plotH = narrow ? 120 : 140;
  const H = TOP + plotH + AXIS;
  const drawn = series.filter((s) => !s.inactive);
  const top = Math.max(0, ...drawn.flatMap((s) => s.values));
  const { max, step } = niceFriendsMax(top);
  const yOf = (m: number) => TOP + plotH - (Math.min(m, max) / max) * plotH;
  const plotW = Math.max(1, width - LEFT - RIGHT);
  const xOf = (i: number) => evenX(i, n, LEFT, plotW);
  const ticks = thinTicks(durationTicks(max, step), 3);
  const baseY = yOf(0);

  const select = (i: number | null) => {
    setActive(i);
    if (i === null) {
      hideTip();
      return;
    }
    const rows = drawn
      .map((s) => ({ name: s.name, min: s.values[i] ?? 0, dot: s.color }))
      .sort((a, b) => b.min - a.min)
      .map((r) => ({ name: r.name, value: formatDuration(r.min * MIN), dot: r.dot }));
    const a = anchorOf(svg.current, xOf(i), TOP);
    showTip({
      ...a,
      value: '',
      rows,
      label: i === n - 1 ? `${formatDayLabel(days[i]!)} · today so far` : formatDayLabel(days[i]!),
    });
  };
  const fromPointer = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    select(nearestIndex(e.clientX - r.left, n, LEFT, plotW));
  };
  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? n - 1;
    let nx: number;
    if (e.key === 'ArrowLeft') nx = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') nx = Math.min(n - 1, cur + 1);
    else if (e.key === 'Home') nx = 0;
    else if (e.key === 'End') nx = n - 1;
    else return;
    e.preventDefault();
    select(nx);
  };

  const summary = series
    .map((s) => (s.inactive ? `${s.name}, code off` : `${s.name} ${spoken(s.values.reduce((a, b) => a + b, 0))} total`))
    .join(', ');

  return (
    <div class="fchart" data-testid="friends-chart">
      <div class="chartbox" ref={wrap}>
        {width > 0 ? (
          <svg
            ref={svg}
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            tabindex={0}
            role="img"
            aria-label={`Focus minutes per day, last 7 days, 6 days ago to today. ${summary}.`}
            class="trend fsvg"
            data-tipzone
            onKeyDown={onKey}
            onFocus={() => active === null && select(n - 1)}
            onBlur={() => select(null)}
          >
            {ticks.map((t) =>
              t === 0 ? null : (
                <g key={t}>
                  <line x1={LEFT} x2={width - RIGHT} y1={yOf(t)} y2={yOf(t)} stroke="var(--em-grid)" stroke-width="1" />
                  <text x={LEFT - 8} y={yOf(t)} text-anchor="end" dominant-baseline="middle" class="axis-text">
                    {shortMinutes(t)}
                  </text>
                </g>
              ),
            )}
            <line x1={LEFT} x2={width - RIGHT} y1={baseY} y2={baseY} stroke="var(--em-axis)" stroke-width="1" />
            <text x={LEFT - 8} y={baseY} text-anchor="end" dominant-baseline="middle" class="axis-text">
              0
            </text>
            {X_LABELS.slice(-n).map((l, i) => (
              <text
                key={l}
                x={xOf(i)}
                y={baseY + 18}
                text-anchor="middle"
                class={`axis-text${i === n - 1 ? ' axis-text--today' : ''}`}
              >
                {l}
              </text>
            ))}
            {active !== null ? (
              <line
                x1={xOf(active)}
                x2={xOf(active)}
                y1={TOP}
                y2={baseY}
                stroke="var(--em-axis)"
                stroke-width="1"
                pointer-events="none"
              />
            ) : null}
            {drawn.map((s) => (
              <path
                key={s.key}
                class="fseries"
                data-series={s.key}
                d={s.values.map((v, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join('')}
                fill="none"
                stroke={s.color}
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
                stroke-dasharray={s.you ? '4 3' : undefined}
              />
            ))}
            {drawn.map((s) => (
              <g key={s.key} class="fdots" data-series={s.key} pointer-events="none">
                {s.values.map((v, i) => (
                  <circle
                    key={i}
                    cx={xOf(i)}
                    cy={yOf(v)}
                    r={(i === n - 1 ? 4 : 3) + (i === active ? 1 : 0)}
                    fill={s.color}
                    stroke="var(--em-surface-solid)"
                    stroke-width="2"
                  />
                ))}
              </g>
            ))}
            <rect
              x={LEFT - 8}
              y={TOP - 6}
              width={plotW + 16}
              height={plotH + 12}
              fill="transparent"
              class="trend__hit"
              onPointerMove={fromPointer}
              onPointerDown={fromPointer}
              onPointerLeave={(e) => e.pointerType === 'mouse' && select(null)}
            />
          </svg>
        ) : (
          <div style={{ height: `${H}px` }} />
        )}
      </div>
      <ul class="flegend" data-testid="friends-legend" aria-label="Series">
        {series.map((s) => (
          <li key={s.key} class={s.inactive ? 'flegend__off' : undefined} data-series={s.key}>
            <span
              class={`flegend__dot${s.inactive ? ' flegend__dot--off' : ''}`}
              style={{ '--dot': s.color } as never}
              aria-hidden="true"
            />
            <span class="flegend__name">{s.name}</span>{' '}
            {s.inactive ? <span class="flegend__note">(code off)</span> : null}
          </li>
        ))}
      </ul>
      <div class="sr-only">
        <table data-testid="friends-table">
          <caption>Focus minutes per day, last 7 days</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {drawn.map((s) => (
                <th key={s.key} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d}>
                <th scope="row">{`${formatDayLabel(d)}, ${daysAgo(i, n)}`}</th>
                {drawn.map((s) => (
                  <td key={s.key}>{spoken(s.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const toSettings = () => go('settings');

/** The tile body for the current friends state (everything inside the Friends tile below its label). */
export function FriendsTileBody({
  state,
  days,
  you,
  narrow,
  now,
}: {
  state: FriendsState;
  days: ISODay[];
  /** My minutes for each of `days`. */
  you: number[];
  narrow: boolean;
  now: number;
}) {
  if (state.status === 'signed-out') {
    return (
      <div class="ftile__empty">
        <p class="ftile__text">Link this device in Settings to compare focus time with friends.</p>
        <Button variant="secondary" onClick={toSettings} data-testid="friends-tile-link">
          Open Settings
        </Button>
      </div>
    );
  }
  const series: FriendSeries[] = [
    { key: 'you', name: 'You', color: 'var(--em-ink-2)', you: true, values: you },
    ...state.list.map((f, i) => ({
      key: f.code,
      name: friendName(f, i),
      color: `var(--em-cat-${f.color})`,
      inactive: !f.active,
      values: days.map((d) => (f.days[d] ?? 0) / MIN),
    })),
  ];
  const have = state.fetchedAt !== null;
  const failed = state.status === 'offline' || state.status === 'error';
  return (
    <>
      <FriendsChart days={days} series={series} narrow={narrow} />
      {state.status === 'ready' && state.list.length === 0 ? (
        <div class="ftile__add">
          <p class="ftile__text">Add a friend's code in Settings.</p>
          <Button variant="secondary" onClick={toSettings} data-testid="friends-tile-link">
            Open Settings
          </Button>
        </div>
      ) : null}
      {state.status === 'loading' && !have ? (
        <p class="tile__note" data-testid="friends-note">
          Loading…
        </p>
      ) : null}
      {failed && !have ? (
        <p class="tile__note" data-testid="friends-note">
          {state.status === 'offline' ? "Friends will load when you're back online." : "Couldn't load friends."}
        </p>
      ) : null}
      {failed && have ? (
        <p class="tile__note" data-testid="friends-note">
          Updated {agoText(state.fetchedAt!, now)}
        </p>
      ) : null}
    </>
  );
}
