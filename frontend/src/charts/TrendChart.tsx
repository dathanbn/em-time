import { useRef, useState } from 'preact/hooks';
import {
  MIN,
  formatDayLabel,
  formatDuration,
  formatShortDate,
  parseDay,
  weekStart,
  type TrendPoint,
  type TrendRange,
} from '@core';
import { ChartTable, Empty } from './ChartTable';
import { durationTicks, monotonePath, niceMaxMinutes, splitRuns, thinTicks, type Pt } from './geometry';
import { anchorOf, hideTip, showTip } from './Tooltip';
import { useSize } from './useSize';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEFT = 46;
const RIGHT = 12;
const TOP = 16;
const AXIS = 28;

function tickLabels(
  points: TrendPoint[],
  range: TrendRange,
  weekStartsOn: 0 | 1,
): { i: number; text: string }[] {
  const out: { i: number; text: string }[] = [];
  points.forEach((p, i) => {
    const { y, m, d } = parseDay(p.day);
    if (range === 30) {
      if (weekStart(p.day, weekStartsOn) === p.day) out.push({ i, text: formatShortDate(p.day) });
    } else if (range === 90) {
      if (d === 1) out.push({ i, text: MONTHS[m - 1]! });
      else if (d === 15) out.push({ i, text: formatShortDate(p.day) });
    } else if (d === 1) {
      out.push({ i, text: m === 1 ? `Jan ${y}` : MONTHS[m - 1]! });
    }
  });
  // Drop a first label that would collide with the next one.
  if (out.length > 1 && out[1]!.i - out[0]!.i < points.length / 14) out.shift();
  return out;
}

export function TrendChart({
  points,
  range,
  goalMin,
  weekStartsOn,
  narrow,
  table,
}: {
  points: TrendPoint[];
  range: TrendRange;
  goalMin: number;
  weekStartsOn: 0 | 1;
  narrow: boolean;
  table: boolean;
}) {
  const [wrap, width] = useSize();
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const plotH = narrow ? 180 : 240;
  const H = TOP + plotH + AXIS;
  const hasAny = points.some((p) => (p.valueMin ?? 0) > 0);
  const avgCount = points.filter((p) => p.avgMin !== null).length;

  if (table) {
    return (
      <ChartTable
        testid="trend-table"
        caption={`Daily focus time and 7-day average, last ${range} days`}
        head={['Date', 'Focus time', '7-day average']}
        rows={[...points]
          .reverse()
          .map((p) => [
            formatDayLabel(p.day),
            p.valueMin === null ? 'No data' : formatDuration(p.valueMin * MIN),
            p.avgMin === null ? '' : formatDuration(p.avgMin * MIN),
          ])}
      />
    );
  }

  const maxVal = Math.max(goalMin, ...points.map((p) => Math.max(p.valueMin ?? 0, p.avgMin ?? 0)));
  const { max, step } = niceMaxMinutes(maxVal * 1.1);
  const yOf = (m: number) => TOP + plotH - (m / max) * plotH;
  const plotW = Math.max(1, width - LEFT - RIGHT);
  const n = points.length;
  const xOf = (i: number) => LEFT + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const ticks = thinTicks(durationTicks(max, step), 3);

  const dots = points.map((p, i) =>
    p.valueMin === null || p.isToday ? null : { x: xOf(i), y: yOf(p.valueMin), i },
  );
  const avgPts: (Pt | null)[] = points.map((p, i) =>
    p.avgMin === null ? null : { x: xOf(i), y: yOf(p.avgMin) },
  );
  const runs = splitRuns(avgPts);
  const todayIdx = points.findIndex((p) => p.isToday);
  const today = todayIdx >= 0 ? points[todayIdx]! : null;
  const dotR = range === 30 ? 2 : range === 90 ? 1.75 : 1.25;
  const lastAvgIdx = (() => {
    for (let i = n - 1; i >= 0; i--) if (points[i]!.avgMin !== null) return i;
    return -1;
  })();
  const lastAvg = lastAvgIdx >= 0 ? points[lastAvgIdx]!.avgMin! : null;
  const goalY = yOf(goalMin);
  const baseY = yOf(0);
  const labels = tickLabels(points, range, weekStartsOn);

  const select = (i: number | null) => {
    setActive(i);
    if (i === null) {
      hideTip();
      return;
    }
    const p = points[i]!;
    const yy = yOf(Math.max(p.valueMin ?? 0, p.avgMin ?? 0));
    const a = anchorOf(svg.current, xOf(i), yy);
    showTip({
      ...a,
      value: p.valueMin === null ? 'No data' : formatDuration(p.valueMin * MIN),
      extra: p.avgMin === null ? undefined : `7-day avg ${formatDuration(p.avgMin * MIN)}`,
      label: p.isToday ? `${formatDayLabel(p.day)} · today so far` : formatDayLabel(p.day),
    });
  };
  const fromPointer = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.round(((x - LEFT) / plotW) * (n - 1));
    select(Math.min(n - 1, Math.max(0, i)));
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

  const showAvgNote = hasAny && avgCount === 0;
  const avgNearGoal = lastAvg !== null && Math.abs(yOf(lastAvg) - goalY) < 18;
  const activeAvgY = active !== null && points[active]!.avgMin !== null ? yOf(points[active]!.avgMin!) : null;
  const lastX = lastAvgIdx >= 0 ? xOf(lastAvgIdx) : 0;

  return (
    <div class="chartbox" ref={wrap} data-testid="trend-chart" data-range={range}>
      {width > 0 ? (
        <svg
          ref={svg}
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          tabindex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`Daily focus time with 7-day average, last ${range} days. Use left and right arrow keys to move between days.`}
          class="trend"
          data-tipzone
          onKeyDown={onKey}
          onFocus={() => active === null && select(n - 1)}
          onBlur={() => select(null)}
        >
          {ticks.map((t) =>
            t === 0 ? null : (
              <g key={t}>
                <line
                  x1={LEFT}
                  x2={width - RIGHT}
                  y1={yOf(t)}
                  y2={yOf(t)}
                  stroke="var(--em-grid)"
                  stroke-width="1"
                />
                <text x={LEFT - 8} y={yOf(t)} text-anchor="end" dominant-baseline="middle" class="axis-text">
                  {formatDuration(t * MIN)}
                </text>
              </g>
            ),
          )}
          <line x1={LEFT} x2={width - RIGHT} y1={baseY} y2={baseY} stroke="var(--em-axis)" stroke-width="1" />
          <text x={LEFT - 8} y={baseY} text-anchor="end" dominant-baseline="middle" class="axis-text">
            0
          </text>
          {labels.map((l) => (
            <text key={l.i} x={xOf(l.i)} y={baseY + 18} text-anchor="middle" class="axis-text">
              {l.text}
            </text>
          ))}
          <line
            x1={LEFT}
            x2={width - RIGHT}
            y1={goalY}
            y2={goalY}
            stroke="var(--em-ink-3)"
            stroke-opacity="0.4"
            stroke-width="1"
          />
          <text x={width - RIGHT} y={goalY - 5} text-anchor="end" class="axis-text">
            Goal
          </text>
          {runs.map((run, k) => {
            const d = monotonePath(run);
            const a = run[0]!;
            const b = run[run.length - 1]!;
            return run.length > 1 ? (
              <g key={k}>
                <path
                  d={`${d}L${b.x},${baseY}L${a.x},${baseY}Z`}
                  fill="var(--em-heat-3)"
                  fill-opacity="0.1"
                />
                <path
                  d={d}
                  fill="none"
                  stroke="var(--em-heat-3)"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </g>
            ) : null;
          })}
          {dots.map((p) =>
            p ? (
              <circle key={p.i} class="trend__dot" cx={p.x} cy={p.y} r={dotR} />
            ) : null,
          )}
          {today ? (
            <circle
              cx={xOf(todayIdx)}
              cy={yOf(today.valueMin ?? 0)}
              r="4"
              fill="var(--em-surface)"
              stroke="var(--em-heat-3)"
              stroke-width="2"
            />
          ) : null}
          {lastAvg !== null ? (
            <text
              x={Math.min(lastX, width - RIGHT)}
              y={avgNearGoal && yOf(lastAvg) > goalY ? yOf(lastAvg) + 18 : yOf(lastAvg) - 10}
              text-anchor="end"
              class="axis-text axis-text--value"
            >
              Avg {formatDuration(lastAvg * MIN)}
            </text>
          ) : null}
          {active !== null ? (
            <g pointer-events="none">
              <line
                x1={xOf(active)}
                x2={xOf(active)}
                y1={TOP}
                y2={baseY}
                stroke="var(--em-axis)"
                stroke-width="1"
              />
              {activeAvgY !== null ? (
                <circle
                  cx={xOf(active)}
                  cy={activeAvgY}
                  r="4"
                  fill="var(--em-heat-3)"
                  stroke="var(--em-surface)"
                  stroke-width="2"
                />
              ) : null}
            </g>
          ) : null}
          <rect
            x={LEFT}
            y={TOP}
            width={plotW}
            height={plotH}
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
      {width > 0 && !hasAny ? <Empty>Your first session will show up here.</Empty> : null}
      {width > 0 && showAvgNote ? <Empty>The average line appears after 3 days.</Empty> : null}
    </div>
  );
}
