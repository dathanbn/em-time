import { useRef, useState } from 'preact/hooks';
import { MIN, formatDayLabel, formatDuration, isoWeekdayIndex, type WeekSummary } from '@core';
import { plural } from '../app/selectors';
import { ChartTable, Empty } from './ChartTable';
import { durationTicks, niceMaxMinutes, thinTicks } from './geometry';
import { anchorOf, hideTip, showTip } from './Tooltip';
import { useSize } from './useSize';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEFT = 46;
const RIGHT = 6;
const TOP = 22;

export function WeekColumns({ week, narrow, table }: { week: WeekSummary; narrow: boolean; table: boolean }) {
  const [wrap, width] = useSize();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const plotH = narrow ? 140 : 160;
  const axisH = 24;
  const H = TOP + plotH + axisH;
  const mins = week.days.map((d) => d.focusMs / MIN);
  const maxMin = Math.max(0, ...mins);
  const { max, step } = niceMaxMinutes(maxMin);
  const ticks = thinTicks(durationTicks(max, step), 3);
  const y = (m: number) => TOP + plotH - (m / max) * plotH;
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const band = plotW / 7;
  const cw = Math.min(24, band * 0.5);
  const tallest = maxMin > 0 ? mins.indexOf(maxMin) : -1;
  const today = week.todayIndex;
  const labelIdx = new Set<number>();
  if (tallest >= 0) labelIdx.add(tallest);
  if (today !== null && mins[today]! > 0) {
    if (!(tallest >= 0 && Math.abs(today - tallest) === 1 && band < 48)) labelIdx.add(today);
  }

  if (table) {
    return (
      <ChartTable
        testid="week-table"
        caption={`Focus time per day, ${week.start} to ${week.end}`}
        head={['Day', 'Focus time', 'Sessions']}
        rows={week.days.map((d) => [formatDayLabel(d.day), formatDuration(d.focusMs), d.sessions])}
      />
    );
  }

  const tipFor = (i: number) => {
    const d = week.days[i]!;
    const cx = LEFT + band * (i + 0.5);
    const a = anchorOf(svg.current, cx, y(mins[i]!) - 2);
    showTip({
      ...a,
      value: formatDuration(d.focusMs),
      label: `${formatDayLabel(d.day)} · ${plural(d.sessions, 'session')}`,
    });
    setHover(i);
  };
  const leave = () => {
    hideTip();
    setHover(null);
  };

  return (
    <div class="chartbox" ref={wrap} data-testid="week-columns">
      {width > 0 ? (
        <svg
          ref={svg}
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="group"
          aria-label="Focus time per day this week"
        >
          {ticks.map((t) =>
            t === 0 ? null : (
              <g key={t}>
                <line
                  x1={LEFT}
                  x2={width - RIGHT}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--em-grid)"
                  stroke-width="1"
                />
                <text x={LEFT - 8} y={y(t)} text-anchor="end" dominant-baseline="middle" class="axis-text">
                  {formatDuration(t * MIN)}
                </text>
              </g>
            ),
          )}
          <line x1={LEFT} x2={width - RIGHT} y1={y(0)} y2={y(0)} stroke="var(--em-axis)" stroke-width="1" />
          <text x={LEFT - 8} y={y(0)} text-anchor="end" dominant-baseline="middle" class="axis-text">
            0
          </text>
          {week.days.map((d, i) => {
            const cx = LEFT + band * (i + 0.5);
            const h = (mins[i]! / max) * plotH;
            const x0 = cx - cw / 2;
            const x1 = cx + cw / 2;
            const yt = y(mins[i]!);
            const yb = y(0);
            const r = Math.min(4, h / 2, cw / 2);
            const isToday = i === today;
            const label = `${formatDayLabel(d.day)}: ${formatDuration(d.focusMs)}, ${plural(d.sessions, 'session')}`;
            return (
              <g key={d.day}>
                {h > 0 ? (
                  <path
                    d={`M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${yb}Z`}
                    fill={isToday ? 'var(--em-heat-4)' : 'var(--em-heat-3)'}
                    opacity={hover !== null && hover !== i ? 0.85 : 1}
                    class="wk-col"
                  />
                ) : null}
                {labelIdx.has(i) ? (
                  <text x={cx} y={yt - 6} text-anchor="middle" class="axis-text axis-text--value">
                    {formatDuration(d.focusMs)}
                  </text>
                ) : null}
                <text
                  x={cx}
                  y={H - 7}
                  text-anchor="middle"
                  class={`axis-text${isToday ? ' axis-text--today' : ''}`}
                >
                  {DOW[isoWeekdayIndex(d.day)]}
                </text>
                <rect
                  x={LEFT + band * i}
                  y={TOP - 14}
                  width={band}
                  height={plotH + axisH + 14}
                  fill="transparent"
                  tabindex={0}
                  role="img"
                  aria-label={label}
                  data-tipzone
                  class="hit"
                  onPointerEnter={() => tipFor(i)}
                  onPointerDown={() => tipFor(i)}
                  onPointerLeave={leave}
                  onFocus={() => tipFor(i)}
                  onBlur={leave}
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height: `${H}px` }} />
      )}
      {week.totalMs === 0 && width > 0 ? (
        <Empty>{week.offset === 0 ? 'No focus time this week yet.' : 'No focus time this week.'}</Empty>
      ) : null}
    </div>
  );
}
