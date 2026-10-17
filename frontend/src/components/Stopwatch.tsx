// Stopwatch controls (v5): a labelled block for the desktop "Focus tools" card and a compact glass
// pill under the phone controls. The digits are painted by ref (about every 250 ms, only while
// running and the page is visible), never through a signal.
import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  elapsedMs,
  formatStopwatch,
  resetStopwatch,
  stopwatch,
  stopwatchPhase,
  toggleStopwatch,
} from '../app/stopwatch';
import { Icon } from './Icon';
import { IconButton } from './ui';
import { useUid } from './uid';

function useFace() {
  const s = stopwatch.value;
  const time = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    let id = 0;
    const paint = () => {
      const el = time.current;
      const text = formatStopwatch(elapsedMs(stopwatch.peek(), Date.now()));
      if (el && el.textContent !== text) el.textContent = text;
    };
    const sync = () => {
      window.clearInterval(id);
      id = 0;
      paint();
      if (s.startedAt !== null && !document.hidden) id = window.setInterval(paint, 250);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [s]);
  return { phase: stopwatchPhase(s), time };
}

/** Desktop: label, digits, and real Start/Stop and Reset buttons. */
export function StopwatchCard() {
  const { phase, time } = useFace();
  const label = useUid('swlabel');
  return (
    <div class="swatch" role="group" aria-labelledby={label} data-testid="stopwatch" data-state={phase}>
      <div class="swatch__label" id={label}>
        Stopwatch
      </div>
      <div class="swatch__row">
        <span ref={time} class="swatch__time" role="timer" aria-live="off" data-testid="stopwatch-time" />
        <div class="swatch__btns">
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="stopwatch-toggle"
            onClick={toggleStopwatch}
          >
            {phase === 'running' ? 'Stop' : 'Start'}
          </button>
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="stopwatch-reset"
            aria-disabled={phase === 'idle' ? 'true' : undefined}
            onClick={resetStopwatch}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

/** Phone: glyph, digits, and two 44px icon buttons in one clear-glass pill. */
export function StopwatchPill() {
  const { phase, time } = useFace();
  return (
    <div class="swpill" role="group" aria-label="Stopwatch" data-testid="stopwatch" data-state={phase}>
      <Icon name="stopwatch" size={18} class="swpill__glyph" />
      <span ref={time} class="swpill__time" role="timer" aria-live="off" data-testid="stopwatch-time" />
      <IconButton
        icon={phase === 'running' ? 'pause' : 'play'}
        label={phase === 'running' ? 'Stop stopwatch' : 'Start stopwatch'}
        iconSize={18}
        data-testid="stopwatch-toggle"
        onClick={toggleStopwatch}
      />
      <IconButton
        icon="reset"
        label="Reset stopwatch"
        iconSize={18}
        data-testid="stopwatch-reset"
        aria-disabled={phase === 'idle' ? 'true' : undefined}
        onClick={resetStopwatch}
      />
    </div>
  );
}
