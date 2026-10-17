// A deterministic clock plus a core factory. The clock never uses real time: `advance` runs the
// scheduled callbacks in due order, and `lateBy` simulates browser timer throttling.
import {
  createEmCore,
  createMemoryAdapter,
  MIN,
  type EmCore,
  type PhaseCompleteEvent,
  type StorageAdapter,
  type TimerDeps,
} from '@core';
import { at, copyFixture } from './helpers';

export interface Pending {
  id: number;
  due: number;
  fn: () => void;
}

export class FakeClock {
  t: number;
  private seq = 0;
  pending: Pending[] = [];
  private visListeners: Array<() => void> = [];
  constructor(start: number = at(2026, 10, 14, 10, 0)) {
    this.t = start;
  }
  now = (): number => this.t;
  deps: TimerDeps = {
    now: () => this.t,
    setTimeout: (fn, ms) => {
      const p = { id: ++this.seq, due: this.t + Math.max(0, ms), fn };
      this.pending.push(p);
      return p.id;
    },
    clearTimeout: (h) => {
      this.pending = this.pending.filter((p) => p.id !== h);
    },
    onVisibility: (fn) => {
      this.visListeners.push(fn);
      return () => {
        this.visListeners = this.visListeners.filter((f) => f !== fn);
      };
    },
  };
  /** Run due timers up to `ms` from now. `lateBy` delays every callback (throttled background tab). */
  advance(ms: number, lateBy = 0): void {
    const target = this.t + ms;
    for (;;) {
      const next = this.pending.filter((p) => p.due <= target).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      this.pending = this.pending.filter((p) => p !== next);
      this.t = Math.max(this.t, next.due + lateBy);
      next.fn();
    }
    this.t = Math.max(this.t, target);
  }
  /** Jump forward without running anything (suspended laptop, frozen tab). */
  jump(ms: number): void {
    this.t += ms;
  }
  /** What the browser does when the tab becomes visible / window gains focus. */
  becomeVisible(): void {
    for (const f of [...this.visListeners]) f();
  }
}

export function makeCore(opts: { storage?: StorageAdapter; clock?: FakeClock; random?: () => number } = {}) {
  const clock = opts.clock ?? new FakeClock();
  const storage = opts.storage ?? createMemoryAdapter();
  const core: EmCore = createEmCore({
    storage,
    copy: copyFixture,
    deps: clock.deps,
    now: clock.now,
    random: opts.random ?? (() => 0.5),
    syncEnv: {},
  });
  const events: PhaseCompleteEvent[] = [];
  core.onPhaseComplete((e) => events.push(e));
  return { core, clock, storage, events };
}

export const minutes = (n: number): number => n * MIN;
