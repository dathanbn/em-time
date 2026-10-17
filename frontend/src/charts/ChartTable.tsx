import type { ComponentChildren } from 'preact';

/** Real table alternative to a chart: caption, scoped headers, identical values (A11Y-4). */
export function ChartTable({
  caption,
  head,
  rows,
  testid,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
  testid?: string;
}) {
  return (
    <div class="ctable-wrap" data-testid={testid} tabIndex={0} role="region" aria-label={caption}>
      <table class="ctable">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" class={i > 0 ? 'num' : ''}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j} class="num">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div class="chartfoot">
      <button type="button" class="btn btn--text" aria-pressed={on} onClick={onToggle}>
        {on ? 'Show as chart' : 'Show as table'}
      </button>
    </div>
  );
}

export function Empty({
  children,
  inline,
  mascot,
}: {
  children: ComponentChildren;
  inline?: boolean;
  mascot?: ComponentChildren;
}) {
  return (
    <p class={`chart-empty${inline ? ' chart-empty--inline' : ''}${mascot ? ' chart-empty--mascot' : ''}`}>
      {mascot}
      <span>{children}</span>
    </p>
  );
}
