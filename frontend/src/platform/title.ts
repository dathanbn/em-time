// Tab title countdown (TMR-14) and app icon badge (minutes left), plus the once-a-second housekeeping that must not depend on
// requestAnimationFrame, which stops in hidden tabs.
import { formatClock } from '@core';
import { timerState, core } from '../app/coreBridge';
import { announceRemaining } from './announce';
import { applyBadge, badgeFor } from './badge';

const PHASE_NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break' } as const;

function titleFor(): string {
  const s = timerState.value;
  if (s.status === 'idle') return 'Em Time';
  const clock = formatClock(core.timer.remainingMs());
  if (s.status === 'paused') return `Paused ${clock} · Em Time`;
  return `${clock} · ${PHASE_NAMES[s.phase]} · Em Time`;
}

function update(): void {
  const t = titleFor();
  if (document.title !== t) document.title = t;
  applyBadge(badgeFor(timerState.value.status, core.timer.remainingMs()));
}

export function initTitle(): void {
  const tick = () => {
    update();
    const s = core.timer.getState();
    if (s.status === 'running') announceRemaining(core.timer.remainingMs(), s.phaseStartedAt, Date.now());
  };
  setInterval(tick, 1000);
  timerState.subscribe(update);
  update();
}
