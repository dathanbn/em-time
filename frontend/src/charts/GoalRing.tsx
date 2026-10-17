import { MIN, type TodaySummary } from '@core';
import { Icon } from '../components/Icon';

const STROKE = { 120: 10, 72: 8, 40: 5 } as const;

export function GoalRing({
  summary,
  size,
  testid = 'goal-ring',
}: {
  summary: TodaySummary;
  size: 120 | 72 | 40;
  testid?: string;
}) {
  const sw = STROKE[size];
  const r = (size - sw) / 2;
  const p = Math.min(1, Math.max(0, summary.progress));
  const mins = Math.round(summary.focusMs / MIN);
  const goal = Math.round(summary.goalMs / MIN);
  const label = `${mins} of ${goal} minutes today, ${Math.round(summary.progress * 100)} percent of goal`;
  return (
    <div
      class={`gring gring--${size}`}
      role="img"
      aria-label={label}
      data-testid={testid}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--em-accent-soft)"
          stroke-width={sw}
        />
        {p > 0 ? (
          <circle
            class="gring__fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--em-ring-fill)"
            stroke-width={sw}
            stroke-linecap="round"
            pathLength={1}
            stroke-dasharray={`${p} 2`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
      {size !== 40 ? (
        <div class="gring__center" aria-hidden="true">
          <span class="gring__value">{mins}</span>
          {summary.goalMet ? (
            <span class="gring__sub gring__sub--met">
              {size === 120 ? <Icon name="check" size={14} /> : null}
              {size === 120 ? 'Goal met' : <Icon name="check" size={12} />}
            </span>
          ) : (
            <span class="gring__sub">{size === 120 ? `of ${goal} min` : 'min'}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
