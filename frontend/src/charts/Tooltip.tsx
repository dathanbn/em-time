// One shared chart tooltip. Values are rendered as text nodes (never HTML).
import { signal } from '@preact/signals';
import { useLayoutEffect, useEffect, useRef } from 'preact/hooks';

export interface TipRow {
  name: string;
  value: string;
  /** CSS color of the dot in front of the name (a swatch only; the text stays in ink). */
  dot: string;
}
interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
  extra?: string;
  /** Several series at once (friends chart): the label is the heading, `value` is not shown. */
  rows?: TipRow[];
}
const tip = signal<Tip | null>(null);

export function showTip(t: Tip): void {
  tip.value = t;
}
export function hideTip(): void {
  tip.value = null;
}

/** Client-space anchor (top center) for a point in an SVG's own coordinates. */
export function anchorOf(svg: SVGSVGElement | null, x: number, y: number): { x: number; y: number } {
  const r = svg?.getBoundingClientRect();
  return { x: (r?.left ?? 0) + x, y: (r?.top ?? 0) + y };
}

export function ChartTooltip() {
  const t = tip.value;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !t) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, t.x - w / 2), window.innerWidth - w - 8);
    let top = t.y - h - 10;
    if (top < 8) top = t.y + 18;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });
  useEffect(() => {
    const onDown = (e: Event) => {
      if (!(e.target as Element).closest?.('[data-tipzone]')) hideTip();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hideTip();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    // Scrolling hides the tooltip, except while a chart element has keyboard focus.
    const onScroll = () => {
      if (!document.activeElement?.closest?.('[data-tipzone]')) hideTip();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  if (!t) return null;
  return (
    <div ref={ref} class="tooltip" role="presentation">
      {t.rows ? (
        <>
          <div class="tooltip__label tooltip__label--head">{t.label}</div>
          <ul class="tooltip__rows">
            {t.rows.map((r, i) => (
              <li key={i}>
                <span class="tooltip__dot" style={{ background: r.dot }} />
                <span class="tooltip__name">{r.name}</span>
                <span class="tooltip__num">{r.value}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div class="tooltip__value">{t.value}</div>
          {t.extra ? <div class="tooltip__extra">{t.extra}</div> : null}
          <div class="tooltip__label">{t.label}</div>
        </>
      )}
    </div>
  );
}
