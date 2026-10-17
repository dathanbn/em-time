import { useRef, useState } from 'preact/hooks';
import { formatDuration, parseDay, type HeatmapCell } from '@core';
import { ChartTable, Empty } from './ChartTable';
import { anchorOf, hideTip, showTip } from './Tooltip';
import { useSize } from './useSize';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEFT = 34;
const TOP = 20;
const GAP = 4;

export function Heatmap({
  cells,
  weekStartsOn,
  empty,
  table,
}: {
  cells: HeatmapCell[];
  weekStartsOn: 0 | 1;
  empty: boolean;
  table: boolean;
}) {
  const [wrap, width] = useSize();
  const svg = useRef<SVGSVGElement>(null);
  const todayCell = cells.find((c) => c.isToday) ?? cells[cells.length - 1];
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const active = focusDay && cells.some((c) => c.day === focusDay) ? focusDay : (todayCell?.day ?? null);

  if (table) {
    return (
      <ChartTable
        testid="heatmap-table"
        caption="Focus time per day, last 9 weeks"
        head={['Date', 'Focus time', 'Level (0 to 4)']}
        rows={[...cells].reverse().map((c) => [c.label.split(' · ')[0]!, formatDuration(c.focusMs), c.level])}
      />
    );
  }

  const size = Math.max(18, Math.min(32, Math.floor((width - 32) / 9 - GAP)));
  const pitch = size + GAP;
  const gridW = LEFT + 9 * pitch - GAP;
  const H = TOP + 7 * pitch - GAP;
  const rowNames = Array.from({ length: 7 }, (_, r) => DOW[(weekStartsOn + r) % 7]!);

  const monthLabels: { col: number; text: string }[] = [];
  const firstOfCol = new Map<number, HeatmapCell>();
  for (const c of cells) {
    const prev = firstOfCol.get(c.col);
    if (!prev || c.row < prev.row) firstOfCol.set(c.col, c);
    const { d, m } = parseDay(c.day);
    if (d === 1) monthLabels.push({ col: c.col, text: MONTHS[m - 1]! });
  }
  const first = firstOfCol.get(0);
  if (first && !monthLabels.some((l) => l.col <= 1)) {
    monthLabels.unshift({ col: 0, text: MONTHS[parseDay(first.day).m - 1]! });
  }

  const posOf = (c: HeatmapCell) => ({ x: LEFT + c.col * pitch, y: TOP + c.row * pitch });
  const tipFor = (c: HeatmapCell) => {
    const p = posOf(c);
    const a = anchorOf(svg.current, p.x + size / 2, p.y);
    const [day, ...rest] = c.label.split(' · ');
    showTip({
      ...a,
      value: rest.join(' · ') || formatDuration(c.focusMs),
      label: `${day} · Level ${c.level}`,
    });
  };
  const focusCell = (c: HeatmapCell) => {
    setFocusDay(c.day);
    requestAnimationFrame(() => svg.current?.querySelector<SVGElement>(`[data-day="${c.day}"]`)?.focus());
  };
  const onKey = (e: KeyboardEvent, c: HeatmapCell) => {
    let target: HeatmapCell | undefined;
    const find = (col: number, row: number) => cells.find((x) => x.col === col && x.row === row);
    if (e.key === 'ArrowRight') target = find(c.col + 1, c.row);
    else if (e.key === 'ArrowLeft') target = find(c.col - 1, c.row);
    else if (e.key === 'ArrowDown') target = find(c.col, c.row + 1);
    else if (e.key === 'ArrowUp') target = find(c.col, c.row - 1);
    else if (e.key === 'Home') target = cells[0];
    else if (e.key === 'End') target = cells[cells.length - 1];
    else return;
    e.preventDefault();
    if (target) focusCell(target);
  };

  const rows: HeatmapCell[][] = Array.from({ length: 7 }, () => []);
  for (const c of cells) rows[c.row]!.push(c);

  return (
    <div class="chartbox heatbox" ref={wrap} data-testid="heatmap">
      {width > 0 ? (
        <>
          <svg
            ref={svg}
            width={Math.min(width, gridW)}
            height={H}
            viewBox={`0 0 ${gridW} ${H}`}
            role="grid"
            aria-label="Focus time per day, last 9 weeks"
          >
            {monthLabels.map((l) => (
              <text key={l.col} x={LEFT + l.col * pitch} y={11} class="axis-text">
                {l.text}
              </text>
            ))}
            {[0, 2, 4].map((r) => (
              <text key={r} x={0} y={TOP + r * pitch + size / 2} dominant-baseline="middle" class="axis-text">
                {rowNames[r]}
              </text>
            ))}
            {rows.map((row, r) => (
              <g role="row" key={r}>
                {row.map((c) => {
                  const p = posOf(c);
                  return (
                    <g key={c.day}>
                      <rect
                        x={p.x}
                        y={p.y}
                        width={size}
                        height={size}
                        rx="4"
                        fill={`var(--em-heat-${c.level})`}
                        class="hm-cell"
                        data-testid="heatmap-cell"
                        data-day={c.day}
                        data-level={c.level}
                        role="gridcell"
                        aria-label={`${c.label}, level ${c.level}`}
                        tabindex={active === c.day ? 0 : -1}
                        data-tipzone
                        onPointerEnter={() => tipFor(c)}
                        onPointerDown={() => tipFor(c)}
                        onPointerLeave={hideTip}
                        onFocus={() => {
                          setFocusDay(c.day);
                          tipFor(c);
                        }}
                        onBlur={hideTip}
                        onKeyDown={(e) => onKey(e, c)}
                      />
                      {c.isToday ? (
                        <rect
                          x={p.x + 1}
                          y={p.y + 1}
                          width={size - 2}
                          height={size - 2}
                          rx="3"
                          fill="none"
                          stroke="var(--em-ink-2)"
                          stroke-width="2"
                          pointer-events="none"
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
          <div class="heatlegend">
            <span class="heatlegend__cap">Strongest shade: daily goal met</span>
            <span class="heatlegend__scale" aria-hidden="true">
              Less
              {[0, 1, 2, 3, 4].map((l) => (
                <svg key={l} width="12" height="12">
                  <rect width="12" height="12" rx="3" fill={`var(--em-heat-${l})`} />
                </svg>
              ))}
              More
            </span>
          </div>
        </>
      ) : (
        <div style={{ height: `${H}px` }} />
      )}
      {empty ? <Empty>Your first session will show up here.</Empty> : null}
    </div>
  );
}

export function heatSummary(cells: HeatmapCell[]): {
  active: number;
  totalMs: number;
  best: HeatmapCell | null;
} {
  let active = 0;
  let totalMs = 0;
  let best: HeatmapCell | null = null;
  for (const c of cells) {
    if (c.focusMs > 0) active++;
    totalMs += c.focusMs;
    if (c.focusMs > 0 && (!best || c.focusMs > best.focusMs)) best = c;
  }
  return { active, totalMs, best };
}
