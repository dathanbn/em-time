import { effect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { MIN, ValidationError, formatClock, formatDuration, todayKey, type Phase } from '@core';
import {
  PHASE_LABEL,
  breakPrompt,
  confettiKey,
  message,
  refill,
  reset,
  skip,
  switchMode,
  togglePlay,
} from '../app/actions';
import { clockTick, core, data, timerState, track } from '../app/coreBridge';
import { greetingFor, type SkyCopy } from '../app/greeting';
import { currentTask, openTasks, plural } from '../app/selectors';
import { useNarrow } from '../app/useNarrow';
import { GoalRing } from '../charts/GoalRing';
import { Companion } from '../components/Companion';
import { Icon } from '../components/Icon';
import { Dialog } from '../components/Dialog';
import { IconButton, Segmented } from '../components/ui';
import { reducedMotion } from '../platform/env';
import { Confetti } from '../components/Confetti';

const RING_R = 175;
const MODE_OPTIONS = [
  { value: 'focus' as Phase, label: 'Focus', testid: 'mode-focus' },
  { value: 'short' as Phase, label: 'Short break', testid: 'mode-short' },
  { value: 'long' as Phase, label: 'Long break', testid: 'mode-long' },
];

/**
 * Ring and digits are driven imperatively from the engine clock (requestAnimationFrame while
 * running) so ticking never goes through signals or re-renders.
 */
function TimerFace({ children }: { children?: ComponentChildren }) {
  const arc = useRef<SVGCircleElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const digits = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let raf = 0;
    let shown = '';
    let labelMin = -2;
    let drawn = -1;
    let tween: { from: number; start: number } | null = null;

    const draw = (p: number) => {
      drawn = p;
      const a = arc.current;
      if (!a) return;
      if (p <= 0.0005) {
        a.setAttribute('stroke-opacity', '0');
        return;
      }
      a.setAttribute('stroke-opacity', '1');
      a.setAttribute('stroke-dasharray', `${p} 2`);
      a.setAttribute('stroke-dashoffset', String(-(1 - p)));
    };

    const paint = () => {
      const s = core.timer.getState();
      const rem = core.timer.remainingMs();
      const text = formatClock(rem);
      const el = digits.current;
      if (el && text !== shown) {
        shown = text;
        el.textContent = text;
        el.classList.toggle('digits--long', text.length > 5);
      }
      const mins = Math.ceil(rem / MIN);
      if (el && mins !== labelMin) {
        labelMin = mins;
        el.setAttribute(
          'aria-label',
          `${formatDuration(mins * MIN)} left, ${PHASE_LABEL[s.phase].toLowerCase()}`,
        );
      }
      let p = core.timer.progress();
      if (tween) {
        const t = Math.min(1, (performance.now() - tween.start) / 600);
        const eased = 1 - (1 - t) ** 3;
        p = tween.from + (p - tween.from) * eased;
        if (t >= 1) tween = null;
      }
      draw(p);
      const bubble = svg.current?.parentElement;
      if (bubble) {
        bubble.classList.toggle('bubble--breathing', s.status === 'running' && s.phase === 'focus');
        bubble.classList.toggle('bubble--paused', s.status === 'paused');
      }
    };

    const loop = () => {
      raf = 0;
      paint();
      if ((core.timer.getState().status === 'running' || tween) && !document.hidden)
        raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!raf) loop();
    };

    paint();
    let first = true;
    let lastRefill = refill.value;
    const stop = effect(() => {
      void timerState.value;
      const r = refill.value;
      if (first) {
        first = false;
        return;
      }
      if (r !== lastRefill) {
        lastRefill = r;
        if (!reducedMotion() && drawn >= 0 && drawn < 0.999)
          tween = { from: drawn, start: performance.now() };
      }
      kick();
    });
    document.addEventListener('visibilitychange', kick);
    kick();
    return () => {
      stop();
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', kick);
    };
  }, []);

  return (
    <>
      <svg
        ref={svg}
        class="ring"
        viewBox="0 0 360 360"
        aria-hidden="true"
        focusable="false"
        data-testid="timer-ring"
      >
        <circle cx="180" cy="180" r={RING_R} fill="none" stroke="var(--em-ring-track)" stroke-width="10" />
        <circle
          ref={arc}
          class="ring__arc"
          cx="180"
          cy="180"
          r={RING_R}
          fill="none"
          stroke="var(--em-ring-fill)"
          stroke-width="10"
          stroke-linecap="round"
          pathLength={1}
          transform="rotate(-90 180 180)"
        />
      </svg>
      <div class="ringcenter">
        <div ref={digits} class="digits" role="timer" aria-live="off" data-testid="timer-digits" />
        {children}
      </div>
    </>
  );
}

function CycleDots() {
  const s = timerState.value;
  const n = data.value.settings.longEvery;
  const filled = s.phase === 'long' ? n : s.cycle;
  return (
    <div
      class="dots"
      data-testid="cycle-dots"
      role="img"
      aria-label={`${filled} of ${n} focus sessions before the long break`}
    >
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class={`dots__dot${i < filled ? ' dots__dot--on' : ''}`} />
      ))}
    </div>
  );
}

function TaskButton({ onOpen }: { onOpen: () => void }) {
  const t = currentTask(data.value);
  return (
    <button
      type="button"
      class={`taskbtn${t ? '' : ' taskbtn--empty'}`}
      data-testid="current-task"
      onClick={onOpen}
      aria-label={t ? `Current task: ${t.name}. Change task` : 'Pick a task'}
      title={t?.name}
      aria-haspopup="dialog"
    >
      <span class="taskbtn__name">{t ? t.name : 'Pick a task'}</span>
      <Icon name="chevron-down" size={16} />
    </button>
  );
}

function TaskPicker({ onClose }: { onClose: () => void }) {
  const d = data.value;
  const tasks = openTasks(d);
  const cur = d.meta.currentTaskId;
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const pick = (id: string | null) => {
    core.store.setCurrentTask(id);
    onClose();
  };
  const add = (e: Event) => {
    e.preventDefault();
    try {
      const t = core.store.addTask({ name });
      core.store.setCurrentTask(t.id);
      onClose();
    } catch (x) {
      if (x instanceof ValidationError)
        setErr(x.reason === 'too-long' ? 'Task names can be up to 80 characters.' : 'Enter a task name.');
      else throw x;
    }
  };
  return (
    <Dialog title="Pick a task" onClose={onClose} sheet>
      <div class="picker" role="radiogroup" aria-label="Current task">
        <button
          type="button"
          role="radio"
          aria-checked={cur === null}
          class="pick"
          onClick={() => pick(null)}
        >
          <span class="pick__radio" />
          <span class="pick__name">No task</span>
        </button>
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={cur === t.id}
            class="pick"
            onClick={() => pick(t.id)}
          >
            <span class="pick__radio" />
            <span class="pick__name" title={t.name}>
              {t.name}
            </span>
          </button>
        ))}
      </div>
      <form class="picker__add" onSubmit={add}>
        <label class="field__label" for="picker-new">
          Add task
        </label>
        <div class="inline-form">
          <input
            id="picker-new"
            class="input"
            value={name}
            maxLength={80}
            placeholder="What are you working on?"
            aria-describedby={err ? 'picker-err' : undefined}
            onInput={(e) => {
              setName((e.target as HTMLInputElement).value);
              setErr('');
            }}
          />
          <button type="submit" class="btn btn--secondary">
            Add
          </button>
        </div>
        {err ? (
          <p class="error" id="picker-err">
            {err}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function Controls() {
  const s = timerState.value;
  const playLabel = s.status === 'running' ? 'Pause' : s.status === 'paused' ? 'Resume' : 'Start';
  return (
    <div class="controls">
      <IconButton
        icon="reset"
        label="Reset"
        tip="Reset (R)"
        size={52}
        iconSize={22}
        class="iconbtn--ghost"
        data-timer-control
        data-testid="timer-reset"
        aria-keyshortcuts="R"
        onClick={reset}
      />
      <button
        type="button"
        class="playbtn"
        data-timer-control
        data-testid="timer-play"
        data-tip={`${playLabel} (Space)`}
        aria-label={playLabel}
        aria-keyshortcuts="Space"
        onClick={togglePlay}
      >
        <Icon name={s.status === 'running' ? 'pause' : 'play'} size={28} />
      </button>
      <IconButton
        icon="skip"
        label="Skip"
        tip="Skip (S)"
        size={52}
        iconSize={22}
        class="iconbtn--ghost"
        data-timer-control
        data-testid="timer-skip"
        aria-keyshortcuts="S"
        onClick={skip}
      />
    </div>
  );
}

/** Desktop side card only: the phone Timer shows no stats at all. */
function TodaySummary() {
  track();
  void clockTick.value;
  const t = core.select.today();
  const goal = Math.round(t.goalMs / MIN);
  const mins = Math.round(t.focusMs / MIN);
  return (
    <div class="today" data-testid="today-goal">
      <GoalRing summary={t} size={72} testid="today-ring" />
      <div class="today__text">
        <div class="today__min">
          {mins} of {goal} min
        </div>
        <div class="today__sub">{plural(t.sessions, 'session')}</div>
      </div>
    </div>
  );
}

function UpNext() {
  const d = data.value;
  const tasks = openTasks(d).slice(0, 6);
  const cur = d.meta.currentTaskId;
  return (
    <>
      <h3 class="side__h">Up next</h3>
      {tasks.length === 0 ? (
        <p class="side__empty">Nothing here yet. Add what you're working on.</p>
      ) : (
        <div class="upnext" role="radiogroup" aria-label="Current task">
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={cur === t.id}
              class={`pick${cur === t.id ? ' pick--on' : ''}`}
              onClick={() => core.store.setCurrentTask(cur === t.id ? null : t.id)}
            >
              <span class="pick__radio" />
              <span class="pick__name" title={t.name}>
                {t.name}
              </span>
            </button>
          ))}
        </div>
      )}
      <a class="side__link" href="#/tasks">
        All tasks
      </a>
    </>
  );
}

function Greeting() {
  track();
  const d = data.value;
  const g = greetingFor({
    now: new Date(),
    studyDay: todayKey(Date.now()),
    name: d.settings.displayName,
    todaySessions: core.select.today().sessions,
    streak: core.select.streak(),
    copy: (core.copy as unknown as { sky: SkyCopy }).sky,
  });
  return (
    <div class="thead__text">
      <p class="greeting" data-testid="greeting">
        {g.title}
      </p>
    </div>
  );
}

export function Timer() {
  const s = timerState.value;
  const [picker, setPicker] = useState(false);
  const narrow = useNarrow();
  const isBreak = s.phase !== 'focus';
  const msg = message.value;
  const prompt = breakPrompt.value;
  return (
    <div class="timerpage">
      <h1 class="sr-only">Timer</h1>
      <div class="timerpage__main">
        <header class="thead">
          <Greeting />
          {narrow ? <Companion size={68} mirror class="thead__mascot" /> : null}
        </header>
        <Segmented
          options={MODE_OPTIONS}
          value={s.phase}
          onChange={switchMode}
          label="Timer mode"
          full
          class="modes"
        />
        <div class="timerpage__mid">
          <div class="bubblewrap">
            <div class="bubble" data-testid="timer-bubble">
              <TimerFace>
                <TaskButton onOpen={() => setPicker(true)} />
                <CycleDots />
              </TimerFace>
            </div>
            {narrow ? null : <Companion size={112} class="timermascot" />}
            <Confetti trigger={confettiKey.value} />
          </div>
          <div class="controlswrap">
            <Controls />
            <div class="timerpage__aux">
              <p class={`msg${msg ? ' msgchip' : ''}`} data-testid="message-line">
                {msg}
              </p>
              {isBreak && prompt ? (
                <div class="promptcard card" data-testid="break-prompt">
                  <div class="promptcard__label">Break idea</div>
                  <p class="promptcard__text" title={prompt}>
                    {prompt}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <aside class="timerpage__side" aria-label="Today">
        <div class="card side">
          <h2 class="side__title">Today</h2>
          <TodaySummary />
        </div>
        <div class="card side">
          <UpNext />
        </div>
      </aside>
      {picker ? <TaskPicker onClose={() => setPicker(false)} /> : null}
    </div>
  );
}
