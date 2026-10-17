import type { ComponentChildren } from 'preact';

export function StatTile({
  label,
  value,
  note,
  testid,
  children,
}: {
  label: string;
  value?: string;
  note?: string | null;
  testid?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="tile" data-testid={testid}>
      <div class="tile__label">{label}</div>
      {children ?? <div class="tile__value">{value}</div>}
      {note ? <div class="tile__note">{note}</div> : null}
    </div>
  );
}
