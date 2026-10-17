import { formatDuration, type Category, type WeekSummary } from '@core';
import { ChartTable, Empty } from './ChartTable';

function barColor(t: WeekSummary['perTask'][number]): string {
  if (t.taskId === '__other__') return 'var(--em-ink-3)';
  if (t.color === null) return 'var(--em-axis)';
  return `var(--em-cat-${t.color})`;
}

export function TaskBars({
  week,
  categories,
  table,
}: {
  week: WeekSummary;
  categories: Category[];
  table: boolean;
}) {
  const rows = week.perTask;
  const nameOf = (t: WeekSummary['perTask'][number]) => (t.deleted ? `${t.name} (deleted)` : t.name);
  if (table) {
    return (
      <ChartTable
        testid="task-table"
        caption="Focus time per task this week"
        head={['Task', 'Category', 'Focus time', 'Sessions']}
        rows={rows.map((t) => [
          nameOf(t),
          t.categoryId ? (categories.find((c) => c.id === t.categoryId)?.name ?? '') : '',
          formatDuration(t.focusMs),
          t.sessions,
        ])}
      />
    );
  }
  if (rows.length === 0) return <Empty inline>Tasks you focus on this week will appear here.</Empty>;
  const max = Math.max(...rows.map((r) => r.focusMs), 1);
  const used = new Map<number, string>();
  for (const r of rows) {
    if (r.color !== null && r.categoryId && !used.has(r.color)) {
      const c = categories.find((x) => x.id === r.categoryId);
      if (c) used.set(r.color, c.name);
    }
  }
  return (
    <div class="taskbars" data-testid="task-totals">
      {used.size >= 2 ? (
        <ul class="legend" aria-label="Categories">
          {[...used.entries()].map(([slot, name]) => (
            <li key={slot}>
              <svg width="10" height="10" aria-hidden="true">
                <rect width="10" height="10" rx="2" fill={`var(--em-cat-${slot})`} />
              </svg>
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      <ul class="tbars">
        {rows.map((t) => (
          <li key={t.taskId ?? 'none'} class="tbar">
            <span class="tbar__name" title={nameOf(t)}>
              <span class="tbar__text">{t.name}</span>
              {t.deleted ? <span class="tbar__del"> (deleted)</span> : null}
            </span>
            <span class="tbar__track">
              <span
                class="tbar__bar"
                style={{ width: `calc((100% - 58px) * ${t.focusMs / max})`, background: barColor(t) }}
              />
              <span class="tbar__val">{formatDuration(t.focusMs)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
