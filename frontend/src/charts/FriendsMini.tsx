// Friends card on the Timer (v6.1): the Stats chart without axes. One smooth line per active series,
// "6 days ago" and "Today" under it, and a legend that doubles as today's standings. The whole card
// opens Stats. Lazy chunk; it draws the same series as charts/FriendsChart.tsx (charts/friendsSeries.ts).
import { MIN, formatDuration } from '@core';
import { clockTick, core, data } from '../app/coreBridge';
import { friends } from '../app/friends';
import { evenX, niceFriendsMax } from './friendsGeometry';
import {
  FRIEND_WIDTH,
  YOU_WIDTH,
  buildFriendSeries,
  seriesPath,
  seriesSummary,
  seriesTop,
  standings,
} from './friendsSeries';
import { useSize } from './useSize';

const PAD_X = 4;
const PAD_TOP = 5;
const PAD_BOTTOM = 4;

export function FriendsMini({ narrow }: { narrow: boolean }) {
  const [wrap, width] = useSize();
  void data.value;
  void clockTick.value;
  const pts = core.select.trend(30).slice(-7);
  const days = pts.map((p) => p.day);
  const series = buildFriendSeries(
    friends.value.list,
    days,
    pts.map((p) => p.valueMin ?? 0),
  );
  const drawn = series.filter((s) => !s.inactive);
  const n = days.length;
  const plotH = narrow ? 80 : 90;
  const { max } = niceFriendsMax(seriesTop(series));
  const inner = plotH - PAD_TOP - PAD_BOTTOM;
  const yOf = (m: number) => PAD_TOP + inner - (Math.min(m, max) / max) * inner;
  const plotW = Math.max(1, width - 2 * PAD_X);
  const xOf = (i: number) => evenX(i, n, PAD_X, plotW);
  const baseY = yOf(0);
  return (
    <a class="card side fmini" href="#/stats" data-testid="friends-mini" aria-label="Friends this week, open Stats">
      <div class="fmini__head">
        <h2 class="side__title">Friends</h2>
        <span class="fmini__cap">This week</span>
      </div>
      <div class="fmini__plot" ref={wrap} style={{ height: `${plotH}px` }}>
        {width > 0 ? (
          <svg
            width={width}
            height={plotH}
            viewBox={`0 0 ${width} ${plotH}`}
            role="img"
            aria-label={`Focus minutes per day, last 7 days. ${seriesSummary(series)}.`}
            class="fmini__svg"
            data-testid="friends-mini-chart"
          >
            <line x1={0} x2={width} y1={baseY} y2={baseY} stroke="var(--em-grid)" stroke-width="1" />
            {drawn.map((s) => (
              <path
                key={s.key}
                class="fseries"
                data-series={s.key}
                d={seriesPath(s.values, xOf, yOf)}
                fill="none"
                stroke={s.color}
                stroke-width={s.you ? YOU_WIDTH : FRIEND_WIDTH}
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            ))}
          </svg>
        ) : null}
      </div>
      <div class="fmini__x" aria-hidden="true">
        <span>6 days ago</span>
        <span>Today</span>
      </div>
      <ul class="flegend fmini__legend" data-testid="friends-mini-legend">
        {standings(series).map((s) => (
          <li key={s.key} data-series={s.key}>
            <span class="flegend__dot" style={{ '--dot': s.color } as never} aria-hidden="true" />
            <span class="flegend__name">{s.name}</span>{' '}
            <span class="fmini__min">{formatDuration(s.min * MIN)}</span>
          </li>
        ))}
      </ul>
    </a>
  );
}
