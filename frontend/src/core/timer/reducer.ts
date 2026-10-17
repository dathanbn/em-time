import { LATE_GRACE_MS } from '../constants';
import type { Phase, TimerState } from '../types';
import type { PhaseEnd, TimerAction, TimerConfig } from '../api';

export interface ReducerResult {
  state: TimerState;
  ended: PhaseEnd | null;
  autoStarted: boolean;
}

export function phaseMs(phase: Phase, cfg: TimerConfig): number {
  return phase === 'focus' ? cfg.focusMs : phase === 'short' ? cfg.shortMs : cfg.longMs;
}

function idleState(phase: Phase, cycle: number, cfg: TimerConfig, now: number): TimerState {
  const planned = phaseMs(phase, cfg);
  return {
    phase,
    status: 'idle',
    plannedMs: planned,
    remainingMs: planned,
    endsAt: null,
    phaseStartedAt: null,
    cycle,
    updatedAt: now,
  };
}

export function initialTimerState(cfg: TimerConfig, now: number): TimerState {
  return idleState('focus', 0, cfg, now);
}

const unchanged = (state: TimerState): ReducerResult => ({ state, ended: null, autoStarted: false });
const changed = (state: TimerState): ReducerResult => ({ state, ended: null, autoStarted: false });

/**
 * Pure timer transition. `now` is passed in explicitly; nothing here reads a clock.
 * Rules are normative in docs/contract.md section 3.2.
 */
export function timerReducer(
  state: TimerState,
  action: TimerAction,
  now: number,
  cfg: TimerConfig,
): ReducerResult {
  switch (action.type) {
    case 'start': {
      if (state.status === 'paused') return timerReducer(state, { type: 'resume' }, now, cfg);
      if (state.status !== 'idle') return unchanged(state);
      return changed({
        ...state,
        status: 'running',
        phaseStartedAt: now,
        endsAt: now + state.remainingMs,
        updatedAt: now,
      });
    }
    case 'pause': {
      if (state.status !== 'running' || state.endsAt === null) return unchanged(state);
      return changed({
        ...state,
        status: 'paused',
        remainingMs: Math.max(0, state.endsAt - now),
        endsAt: null,
        updatedAt: now,
      });
    }
    case 'resume': {
      if (state.status !== 'paused') return unchanged(state);
      return changed({
        ...state,
        status: 'running',
        endsAt: now + state.remainingMs,
        updatedAt: now,
      });
    }
    case 'toggle': {
      const next: TimerAction['type'] =
        state.status === 'running' ? 'pause' : state.status === 'paused' ? 'resume' : 'start';
      return timerReducer(state, { type: next } as TimerAction, now, cfg);
    }
    case 'skip': {
      // Never logs, never auto-starts, never touches the cycle.
      const next: Phase = state.phase === 'focus' ? 'short' : 'focus';
      return changed(idleState(next, state.cycle, cfg, now));
    }
    case 'reset': {
      if (state.status !== 'idle') return changed(idleState(state.phase, state.cycle, cfg, now));
      // Idle at full duration: a focus reset zeroes the cycle (double reset).
      if (state.phase === 'focus' && state.cycle !== 0) return changed(idleState('focus', 0, cfg, now));
      return unchanged(state);
    }
    case 'setPhase': {
      return changed(idleState(action.phase, state.cycle, cfg, now));
    }
    case 'config': {
      // Running and paused phases keep their length (TMR-11). Idle phases are always full.
      if (state.status !== 'idle') return unchanged(state);
      const planned = phaseMs(state.phase, action.cfg);
      if (planned === state.plannedMs && state.remainingMs === planned) return unchanged(state);
      return changed({ ...state, plannedMs: planned, remainingMs: planned, updatedAt: now });
    }
    case 'sync': {
      if (state.status !== 'running' || state.endsAt === null || now < state.endsAt) return unchanged(state);
      const endedAt = state.endsAt;
      const late = now - endedAt > LATE_GRACE_MS;
      const ended: PhaseEnd = {
        phase: state.phase,
        late,
        phaseStartedAt: state.phaseStartedAt ?? endedAt - state.plannedMs,
        endedAt,
        plannedMs: state.plannedMs,
      };
      let nextPhase: Phase;
      let cycle = state.cycle;
      if (state.phase === 'focus') {
        cycle += 1;
        if (cycle >= cfg.longEvery) {
          nextPhase = 'long';
          cycle = 0;
        } else {
          nextPhase = 'short';
        }
      } else {
        nextPhase = 'focus';
      }
      const planned = phaseMs(nextPhase, cfg);
      if (cfg.autoStart && !late) {
        return {
          state: {
            phase: nextPhase,
            status: 'running',
            plannedMs: planned,
            remainingMs: planned,
            endsAt: endedAt + planned,
            phaseStartedAt: endedAt,
            cycle,
            updatedAt: now,
          },
          ended,
          autoStarted: true,
        };
      }
      return { state: idleState(nextPhase, cycle, cfg, now), ended, autoStarted: false };
    }
  }
}
