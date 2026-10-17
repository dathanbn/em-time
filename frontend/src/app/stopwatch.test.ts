import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'em-time:stopwatch';

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    api: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  };
}

/** A fresh module per test: the state is read from storage once, at import. */
async function load(stored?: string) {
  vi.resetModules();
  const s = fakeStorage(stored === undefined ? {} : { [KEY]: stored });
  vi.stubGlobal('localStorage', s.api);
  const mod = await import('./stopwatch');
  return { mod, s };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('formatStopwatch', () => {
  it('m:ss under an hour, h:mm:ss from one hour', async () => {
    const { mod } = await load();
    const f = mod.formatStopwatch;
    expect(f(0)).toBe('0:00');
    expect(f(999)).toBe('0:00');
    expect(f(1000)).toBe('0:01');
    expect(f(59_000)).toBe('0:59');
    expect(f(60_000)).toBe('1:00');
    expect(f(754_000)).toBe('12:34');
    expect(f(3_599_999)).toBe('59:59');
    expect(f(3_600_000)).toBe('1:00:00');
    expect(f(3_723_000)).toBe('1:02:03');
    expect(f(36_000_000 + 59 * 60_000 + 59_000)).toBe('10:59:59');
    expect(f(-5)).toBe('0:00');
  });
});

describe('the stopwatch state machine', () => {
  it('starts idle, runs on timestamps, stops with the time banked, and resets', async () => {
    const { mod, s } = await load();
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('idle');
    mod.toggleStopwatch();
    expect(mod.stopwatch.value).toEqual({ startedAt: 1_000_000, accumulatedMs: 0 });
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('running');
    vi.setSystemTime(1_065_000);
    expect(mod.elapsedMs(mod.stopwatch.value, Date.now())).toBe(65_000);
    mod.toggleStopwatch();
    expect(mod.stopwatch.value).toEqual({ startedAt: null, accumulatedMs: 65_000 });
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('stopped');
    expect(JSON.parse(s.m.get(KEY)!)).toEqual({ startedAt: null, accumulatedMs: 65_000 });
    vi.setSystemTime(2_000_000);
    expect(mod.elapsedMs(mod.stopwatch.value, Date.now())).toBe(65_000); // holds while stopped
    mod.toggleStopwatch(); // continues from the banked time
    vi.setSystemTime(2_010_000);
    expect(mod.elapsedMs(mod.stopwatch.value, Date.now())).toBe(75_000);
    mod.resetStopwatch();
    expect(mod.stopwatch.value).toEqual({ startedAt: null, accumulatedMs: 0 });
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('idle');
    expect(JSON.parse(s.m.get(KEY)!)).toEqual({ startedAt: null, accumulatedMs: 0 });
  });

  it('reset at zero does nothing (not even a write)', async () => {
    const { mod, s } = await load();
    mod.resetStopwatch();
    expect(s.m.has(KEY)).toBe(false);
  });

  it('a stop within the same millisecond as the start returns to idle, not stopped at zero', async () => {
    const { mod } = await load();
    mod.toggleStopwatch();
    mod.toggleStopwatch();
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('idle');
  });

  it('a running stopwatch is restored from storage and keeps counting', async () => {
    const { mod } = await load(JSON.stringify({ startedAt: 990_000, accumulatedMs: 5_000 }));
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('running');
    expect(mod.elapsedMs(mod.stopwatch.value, 1_000_000)).toBe(15_000);
  });

  it('a start in the future (clock set back) counts as zero, never negative', async () => {
    const { mod } = await load(JSON.stringify({ startedAt: 9_000_000, accumulatedMs: 2_000 }));
    expect(mod.elapsedMs(mod.stopwatch.value, 1_000_000)).toBe(2_000);
  });

  it.each([
    'not json',
    'null',
    '{}',
    '{"startedAt":null}',
    '{"startedAt":"x","accumulatedMs":1}',
    '{"startedAt":null,"accumulatedMs":-1}',
    '{"startedAt":null,"accumulatedMs":"5"}',
    '[]',
  ])('bad stored value %s falls back to idle', async (bad) => {
    const { mod } = await load(bad);
    expect(mod.stopwatch.value).toEqual({ startedAt: null, accumulatedMs: 0 });
  });

  it('clearStopwatch (Erase all data) removes the key and resets the state', async () => {
    const { mod, s } = await load();
    mod.toggleStopwatch();
    expect(s.m.has(KEY)).toBe(true);
    mod.clearStopwatch();
    expect(s.m.has(KEY)).toBe(false);
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('idle');
  });

  it('every storage access is guarded: a throwing localStorage never breaks it', async () => {
    vi.resetModules();
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    const mod = await import('./stopwatch');
    expect(() => {
      mod.toggleStopwatch();
      vi.setSystemTime(1_005_000);
      mod.toggleStopwatch();
      mod.resetStopwatch();
      mod.clearStopwatch();
    }).not.toThrow();
    expect(mod.stopwatchPhase(mod.stopwatch.value)).toBe('idle');
  });

  it('lives outside core: nothing in frontend/src/core mentions the stopwatch', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('../core', import.meta.url).pathname;
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    for (const f of walk(root).filter((x) => /\.(ts|json|mjs)$/.test(x)))
      expect(readFileSync(f, 'utf8').toLowerCase(), f).not.toContain('stopwatch');
  });
});
