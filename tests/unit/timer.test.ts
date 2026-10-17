import { describe, expect, it } from 'vitest';
import {
  createTimerEngine,
  formatClock,
  initialTimerState,
  LATE_GRACE_MS,
  timerReducer,
  type TimerConfig,
  type TimerState,
} from '@core';
import { at } from './helpers';
import { FakeClock, minutes } from './harness';

const CFG: TimerConfig = { focusMs: minutes(25), shortMs: minutes(5), longMs: minutes(15), longEvery: 4, autoStart: true };
const T0 = at(2026, 10, 14, 10, 0);

const step = (s: TimerState, a: Parameters<typeof timerReducer>[1], now: number, cfg = CFG) =>
  timerReducer(s, a, now, cfg);
const running = (now = T0, cfg = CFG, s = initialTimerState(cfg, now)) => step(s, { type: 'start' }, now, cfg).state;

describe('timerReducer: basic rules (TMR-1, TMR-4)', () => {
  it('initial state is an idle full focus phase with cycle 0 (TMR-1)', () => {
    const s = initialTimerState(CFG, T0);
    expect(s).toMatchObject({ phase: 'focus', status: 'idle', plannedMs: minutes(25), remainingMs: minutes(25), cycle: 0, endsAt: null });
  });

  it('start sets endsAt = now + remaining and phaseStartedAt = now', () => {
    const s = running();
    expect(s).toMatchObject({ status: 'running', endsAt: T0 + minutes(25), phaseStartedAt: T0 });
  });

  it('pause freezes the remaining time; resume continues from it and paused time is not counted (TMR-4)', () => {
    const r = running();
    const p = step(r, { type: 'pause' }, T0 + minutes(10)).state;
    expect(p).toMatchObject({ status: 'paused', remainingMs: minutes(15), endsAt: null });
    const later = step(p, { type: 'resume' }, T0 + minutes(40)).state;
    expect(later.status).toBe('running');
    expect(later.endsAt).toBe(T0 + minutes(55));
    expect(later.phaseStartedAt).toBe(T0); // the run keeps its original start
  });

  it('start while already running is a no-op', () => {
    const r = running();
    const again = step(r, { type: 'start' }, T0 + 1000).state;
    expect(again.endsAt).toBe(r.endsAt);
  });
});

describe('timerReducer: completion and cycle (TMR-8, TMR-9, EDGE-1)', () => {
  it('sync at endsAt ends the phase exactly at endsAt and auto-starts the break from there', () => {
    const r = running();
    const out = step(r, { type: 'sync' }, T0 + minutes(25));
    expect(out.ended).toMatchObject({ phase: 'focus', late: false, endedAt: T0 + minutes(25), phaseStartedAt: T0, plannedMs: minutes(25) });
    expect(out.autoStarted).toBe(true);
    expect(out.state).toMatchObject({ phase: 'short', status: 'running', cycle: 1, plannedMs: minutes(5), endsAt: T0 + minutes(30) });
  });

  it('sync before endsAt does nothing', () => {
    const r = running();
    const out = step(r, { type: 'sync' }, T0 + minutes(25) - 1);
    expect(out.ended).toBeNull();
    expect(out.state.status).toBe('running');
  });

  it('auto-start off: the next phase waits idle at full duration (TMR-9)', () => {
    const cfg = { ...CFG, autoStart: false };
    const r = running(T0, cfg);
    const out = step(r, { type: 'sync' }, T0 + minutes(25), cfg);
    expect(out.autoStarted).toBe(false);
    expect(out.state).toMatchObject({ phase: 'short', status: 'idle', remainingMs: minutes(5), endsAt: null });
  });

  it('a phase noticed up to 60 s late still chains as of its endsAt', () => {
    const r = running();
    const out = step(r, { type: 'sync' }, T0 + minutes(25) + LATE_GRACE_MS);
    expect(out.ended!.late).toBe(false);
    expect(out.state).toMatchObject({ phase: 'short', status: 'running', endsAt: T0 + minutes(30) });
  });

  it('noticed more than 60 s late: ends at endsAt, marked late, next phase idle even with auto-start on', () => {
    const r = running();
    const out = step(r, { type: 'sync' }, T0 + minutes(25) + LATE_GRACE_MS + 1);
    expect(out.ended).toMatchObject({ late: true, endedAt: T0 + minutes(25) });
    expect(out.autoStarted).toBe(false);
    expect(out.state).toMatchObject({ phase: 'short', status: 'idle', remainingMs: minutes(5) });
  });

  it('six hours later is still exactly one end (no phantom sessions)', () => {
    const r = running();
    const out = step(r, { type: 'sync' }, T0 + 6 * 60 * MIN_MS);
    expect(out.ended).toMatchObject({ late: true, endedAt: T0 + minutes(25) });
    expect(out.state.status).toBe('idle');
    const again = step(out.state, { type: 'sync' }, T0 + 12 * 60 * MIN_MS);
    expect(again.ended).toBeNull();
  });

  it('catch-up completes at most one phase per sync', () => {
    const cfg = { ...CFG, shortMs: 30_000 };
    const r = running(T0, cfg);
    const out = step(r, { type: 'sync' }, T0 + minutes(25) + 50_000, cfg); // short already over too
    expect(out.ended!.phase).toBe('focus');
    expect(out.state.phase).toBe('short');
    expect(out.state.status).toBe('running');
    const next = step(out.state, { type: 'sync' }, T0 + minutes(25) + 50_000, cfg);
    expect(next.ended).toMatchObject({ phase: 'short' });
  });

  it('the 4th completed focus session leads to a long break and the cycle returns to 0 (TMR-8)', () => {
    let s = running();
    const seen: Array<[string, number]> = [];
    for (let i = 0; i < 4; i++) {
      s = step(s, { type: 'sync' }, s.endsAt!).state; // focus ends, break starts
      seen.push([s.phase, s.cycle]);
      if (i < 3) {
        s = step(s, { type: 'sync' }, s.endsAt!).state; // break ends, focus starts
        expect(s.phase).toBe('focus');
      }
    }
    expect(seen).toEqual([['short', 1], ['short', 2], ['short', 3], ['long', 0]]);
    expect(s.plannedMs).toBe(minutes(15));
    s = step(s, { type: 'sync' }, s.endsAt!).state; // long break ends
    expect(s).toMatchObject({ phase: 'focus', cycle: 0 });
  });

  it.each([2, 3, 8])('long break after %i sessions when longEvery is %i', (n) => {
    const cfg = { ...CFG, longEvery: n };
    let s = running(T0, cfg);
    for (let i = 0; i < n; i++) {
      s = step(s, { type: 'sync' }, s.endsAt!, cfg).state;
      if (i < n - 1) {
        expect(s.phase).toBe('short');
        s = step(s, { type: 'sync' }, s.endsAt!, cfg).state;
      }
    }
    expect(s.phase).toBe('long');
  });
});

describe('timerReducer: skip, reset, setPhase (TMR-5, 6, 7, 11, 12, EDGE-2)', () => {
  const cycle2 = (): TimerState => ({ ...initialTimerState(CFG, T0), cycle: 2 });

  it.each([1_000, 60_000, minutes(25) - 1_000])('skip in focus at %i ms elapsed logs nothing, goes to an idle short break, keeps the cycle', (el) => {
    const r = step(cycle2(), { type: 'start' }, T0).state;
    const out = step(r, { type: 'skip' }, T0 + el);
    expect(out.ended).toBeNull();
    expect(out.autoStarted).toBe(false);
    expect(out.state).toMatchObject({ phase: 'short', status: 'idle', cycle: 2, remainingMs: minutes(5) });
  });

  it('skip never auto-starts even with auto-start on, and works while paused', () => {
    const r = step(running(), { type: 'pause' }, T0 + 5_000).state;
    const out = step(r, { type: 'skip' }, T0 + 6_000);
    expect(CFG.autoStart).toBe(true);
    expect(out.state.status).toBe('idle');
    expect(out.ended).toBeNull();
  });

  it('skip never increments the cycle, even on the 4th session', () => {
    const s: TimerState = { ...cycle2(), cycle: 3 };
    const r = step(s, { type: 'start' }, T0).state;
    const out = step(r, { type: 'skip' }, T0 + minutes(24));
    expect(out.state.cycle).toBe(3);
    expect(out.state.phase).toBe('short');
  });

  it('skip during a break goes to an idle focus phase, logs nothing (TMR-7)', () => {
    const brk = step(running(), { type: 'sync' }, T0 + minutes(25)).state; // short break running
    const out = step(brk, { type: 'skip' }, T0 + minutes(26));
    expect(out.ended).toBeNull();
    expect(out.state).toMatchObject({ phase: 'focus', status: 'idle', remainingMs: minutes(25) });
    expect(out.state.cycle).toBe(1);
  });

  it('reset during a running phase returns it to full duration idle and keeps the cycle (TMR-5)', () => {
    const r = step(cycle2(), { type: 'start' }, T0).state;
    const out = step(r, { type: 'reset' }, T0 + minutes(10));
    expect(out.ended).toBeNull();
    expect(out.state).toMatchObject({ phase: 'focus', status: 'idle', remainingMs: minutes(25), cycle: 2, endsAt: null });
  });

  it('reset while paused returns to full duration idle', () => {
    const r = step(running(), { type: 'pause' }, T0 + 1_000).state;
    const out = step(r, { type: 'reset' }, T0 + 2_000);
    expect(out.state).toMatchObject({ status: 'idle', remainingMs: minutes(25) });
  });

  it('the second reset (idle at full focus) zeroes the cycle (D-17)', () => {
    const r = step(cycle2(), { type: 'start' }, T0).state;
    const once = step(r, { type: 'reset' }, T0 + 5_000).state;
    expect(once.cycle).toBe(2);
    const twice = step(once, { type: 'reset' }, T0 + 6_000).state;
    expect(twice).toMatchObject({ cycle: 0, phase: 'focus', status: 'idle' });
  });

  it('setPhase selects the phase idle at full duration and discards the current run', () => {
    const r = step(running(), { type: 'pause' }, T0 + 10_000).state;
    for (const phase of ['short', 'long', 'focus'] as const) {
      const out = step(r, { type: 'setPhase', phase }, T0 + 20_000);
      expect(out.ended).toBeNull();
      expect(out.state).toMatchObject({ phase, status: 'idle', endsAt: null });
      expect(out.state.remainingMs).toBe({ focus: minutes(25), short: minutes(5), long: minutes(15) }[phase]);
    }
  });

  it('changing durations does not touch a running phase but updates an idle full one (TMR-11)', () => {
    const cfg2 = { ...CFG, focusMs: minutes(50) };
    const r = running();
    const same = step(r, { type: 'config', cfg: cfg2 }, T0 + 5_000, cfg2).state;
    expect(same.endsAt).toBe(r.endsAt);
    expect(same.plannedMs).toBe(minutes(25));
    const idle = initialTimerState(CFG, T0);
    const upd = step(idle, { type: 'config', cfg: cfg2 }, T0, cfg2).state;
    expect(upd).toMatchObject({ plannedMs: minutes(50), remainingMs: minutes(50) });
    const paused = step(step(r, { type: 'pause' }, T0 + 5_000).state, { type: 'config', cfg: cfg2 }, T0 + 6_000, cfg2).state;
    expect(paused.plannedMs).toBe(minutes(25));
  });
});

const MIN_MS = 60_000;

describe('timer engine against a mocked clock (TMR-2, EDGE-1)', () => {
  function engine(cfg = CFG) {
    const clock = new FakeClock(T0);
    const ends: Array<{ endedAt: number; late: boolean; nextPhase: string; autoStarted: boolean; phaseStartedAt: number }> = [];
    const eng = createTimerEngine({ initial: initialTimerState(cfg, T0), config: () => cfg, deps: clock.deps });
    eng.on('phaseEnd', (e) => ends.push(e));
    return { clock, eng, ends };
  }

  it('keeps exactly one pending timeout while running (single, non-chained timer)', () => {
    const { clock, eng } = engine();
    expect(clock.pending).toHaveLength(0);
    eng.start();
    expect(clock.pending).toHaveLength(1);
    const delay = clock.pending[0]!.due - clock.t;
    expect(delay).toBeGreaterThanOrEqual(minutes(25));
    expect(delay).toBeLessThan(minutes(25) + 100);
    eng.pause();
    expect(clock.pending).toHaveLength(0);
    eng.resume();
    eng.skip();
    expect(clock.pending).toHaveLength(0);
  });

  it('backgrounded for 10 minutes: on return the remaining time is correct and nothing was lost', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    clock.jump(minutes(10)); // timers frozen, no frames, no ticks
    clock.becomeVisible();
    expect(eng.remainingMs()).toBe(minutes(15));
    expect(eng.getState().status).toBe('running');
    expect(ends).toHaveLength(0);
    expect(formatClock(eng.remainingMs())).toBe('15:00');
  });

  it('backgrounded across the end: logs once at endsAt, chains the break, remaining time is right', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    clock.jump(minutes(25) + 20_000); // came back 20 s after the end
    clock.becomeVisible();
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ endedAt: T0 + minutes(25), late: false, nextPhase: 'short', autoStarted: true, phaseStartedAt: T0 });
    expect(eng.remainingMs()).toBe(minutes(5) - 20_000);
  });

  it('timer callbacks delayed up to 59 s by throttling still end exactly at endsAt', () => {
    for (const lateBy of [0, 1, 999, 30_000, 59_000]) {
      const { clock, eng, ends } = engine();
      eng.start();
      clock.advance(minutes(25) + 10, lateBy);
      expect(ends).toHaveLength(1);
      expect(ends[0]!.endedAt).toBe(T0 + minutes(25));
      expect(ends[0]!.late).toBe(false);
      expect(eng.getState().phase).toBe('short');
    }
  });

  it('a callback delayed past the grace window produces a late, silent, idle next phase', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    clock.advance(minutes(25) + 10, 75_000);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ late: true, autoStarted: false, endedAt: T0 + minutes(25) });
    expect(eng.getState().status).toBe('idle');
  });

  it('jumping 6 hours produces exactly one end and an idle next phase', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    clock.jump(6 * 60 * MIN_MS);
    clock.becomeVisible();
    clock.becomeVisible();
    eng.sync();
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ late: true, endedAt: T0 + minutes(25) });
    expect(eng.getState()).toMatchObject({ phase: 'short', status: 'idle' });
  });

  it('pausing 10 minutes mid-phase delays the end by exactly 10 minutes', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    clock.advance(minutes(5));
    eng.pause();
    clock.advance(minutes(10));
    expect(eng.remainingMs()).toBe(minutes(20));
    eng.resume();
    clock.advance(minutes(19) + 59_000);
    expect(ends).toHaveLength(0);
    clock.advance(1_020);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.endedAt).toBe(T0 + minutes(35));
    expect(ends[0]!.phaseStartedAt).toBe(T0);
  });

  it('remainingMs equals endsAt - now at every simulated frame, never negative; display is 25:00 for the first second', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    const endsAt = eng.getState().endsAt!;
    let sawZeroBeforeEnd = false;
    for (let el = 0; el <= minutes(25); el += 16) {
      clock.t = T0 + el;
      const rem = eng.remainingMs();
      expect(rem).toBe(Math.max(0, endsAt - clock.t));
      expect(rem).toBeGreaterThanOrEqual(0);
      const label = formatClock(rem);
      if (el < 1000) expect(label).toBe('25:00');
      if (label === '0:00' && el < minutes(25)) sawZeroBeforeEnd = true;
    }
    expect(sawZeroBeforeEnd).toBe(false);
    expect(formatClock(eng.remainingMs(T0 + 1000))).toBe('24:59');
    expect(formatClock(eng.remainingMs(endsAt))).toBe('0:00');
    expect(ends).toHaveLength(0); // frames alone never end the phase
  });

  it('reaches 24:59 within 1.1 s of pressing play (TMR-2)', () => {
    const { clock, eng } = engine();
    eng.start();
    clock.advance(1_100);
    expect(formatClock(eng.remainingMs())).toBe('24:59');
  });

  it('progress runs 1 to 0', () => {
    const { clock, eng } = engine();
    expect(eng.progress()).toBe(1);
    eng.start();
    clock.advance(minutes(12.5));
    expect(eng.progress()).toBeCloseTo(0.5, 5);
  });

  it('full cycle of four with auto-start: 4 focus ends, long break after the 4th, breaks never counted twice', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    clock.advance(minutes(25 * 4 + 5 * 3 + 1)); // 4 focus + 3 short breaks, then 1 min of the long break
    expect(ends.filter((e) => e.nextPhase === 'long')).toHaveLength(1);
    expect(eng.getState()).toMatchObject({ phase: 'long', status: 'running', cycle: 0 });
    expect(ends).toHaveLength(7);
  });

  it('dispose clears the timer and ignores later actions', () => {
    const { clock, eng, ends } = engine();
    eng.start();
    eng.dispose();
    clock.advance(minutes(30));
    eng.start();
    expect(ends).toHaveLength(0);
    expect(clock.pending).toHaveLength(0);
  });
});
