// Focus sounds: the synthesized colors (pure sample math) and the engine state machine against a fake
// Web Audio context. The real thing is exercised in tests/e2e/noise.spec.ts (Chromium).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as NoiseModule from './noise';
import { SYNTH_RMS, rms, synthChannel, type SynthColor } from './noiseSynth';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SR = 44100;
const N = SR * 10;
const FADE = SR / 2;
const db = (a: number, b: number): number => 20 * Math.log10(a / b);
const lag1 = (a: Float32Array): number => {
  let num = 0;
  let den = 0;
  for (let i = 1; i < a.length; i++) {
    num += a[i]! * a[i - 1]!;
    den += a[i]! * a[i]!;
  }
  return num / den;
};

describe('synthesized noise', () => {
  const colors: SynthColor[] = ['white', 'pink', 'brown'];
  const made = Object.fromEntries(
    colors.map((c) => [c, synthChannel(c, N, FADE, mulberry32(c.length * 7919))]),
  ) as Record<SynthColor, Float32Array>;

  it('targets: white 0.022, pink 0.037, brown 0.043 RMS', () => {
    expect(SYNTH_RMS).toEqual({ white: 0.022, pink: 0.037, brown: 0.043 });
    for (const c of colors) expect(Math.abs(db(rms(made[c]), SYNTH_RMS[c]))).toBeLessThan(1.5);
  });
  it('has no DC offset and no clipping even at the loudest setting (gain 1.2)', () => {
    for (const c of colors) {
      let mean = 0;
      let peak = 0;
      for (const v of made[c]) {
        mean += v;
        peak = Math.max(peak, Math.abs(v));
      }
      expect(Math.abs(mean / N)).toBeLessThan(SYNTH_RMS[c] * 0.001);
      expect(peak * 1.2).toBeLessThan(0.8);
    }
  });
  it('has the right color: white is uncorrelated, pink is tilted, brown is strongly low-passed', () => {
    expect(Math.abs(lag1(made.white))).toBeLessThan(0.02);
    expect(lag1(made.pink)).toBeGreaterThan(0.3);
    expect(lag1(made.pink)).toBeLessThan(0.9);
    expect(lag1(made.brown)).toBeGreaterThan(0.95);
  });
  it('left and right are independent', () => {
    for (const c of colors) {
      const other = synthChannel(c, N, FADE, mulberry32(123 + c.length));
      let num = 0;
      for (let i = 0; i < N; i++) num += made[c][i]! * other[i]!;
      expect(Math.abs(num / N / (rms(made[c]) * rms(other)))).toBeLessThan(0.05);
    }
  });
  it('loops without a click: the step from the last sample to the first is an ordinary step', () => {
    for (const c of ['pink', 'brown'] as const) {
      const a = made[c];
      const jump = Math.abs(a[0]! - a[N - 1]!);
      const steps: number[] = [];
      for (let i = 1; i < a.length; i += 1) steps.push(Math.abs(a[i]! - a[i - 1]!));
      steps.sort((x, y) => x - y);
      const p99 = steps[Math.floor(steps.length * 0.99)]!;
      expect(jump).toBeLessThanOrEqual(p99);
    }
    // brown drifts slowly; a naive loop would jump by around its own RMS (here at least 0.5 RMS is a click)
    const b = made.brown;
    expect(Math.abs(b[0]! - b[N - 1]!)).toBeLessThan(SYNTH_RMS.brown * 0.5);
  });
  it('keeps equal power across the crossfaded start', () => {
    for (const c of colors) {
      const head = made[c].subarray(0, FADE);
      const body = made[c].subarray(FADE, FADE * 3);
      expect(Math.abs(db(rms(head), rms(body)))).toBeLessThan(1.5);
    }
  });
});

// --------------------------------------------------------------------------------- engine, fake context

class Param {
  value = 0;
  calls: string[] = [];
  cancelScheduledValues(): void {
    this.calls.push('cancel');
  }
  setValueAtTime(v: number): void {
    this.value = v;
    this.calls.push(`set ${v}`);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push(`ramp ${+v.toFixed(4)} ${+t.toFixed(3)}`);
    this.value = v;
  }
}
class Node {
  out: Node | null = null;
  disconnected = false;
  connect<T extends Node>(n: T): T {
    this.out = n;
    return n;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}
class Gain extends Node {
  gain = new Param();
}
class Source extends Node {
  buffer: { duration: number } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}
class FakeCtx {
  static last: FakeCtx;
  sampleRate = 8000;
  currentTime = 0;
  state = 'running';
  destination = new Node();
  gains: Gain[] = [];
  sources: Source[] = [];
  constructor() {
    FakeCtx.last = this;
  }
  createGain(): Gain {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): Source {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createBuffer(ch: number, n: number, sr: number) {
    return { numberOfChannels: ch, length: n, duration: n / sr, copyToChannel: () => undefined };
  }
  decodeAudioData(_d: ArrayBuffer, ok?: (b: unknown) => void): Promise<unknown> {
    const b = { duration: 40, numberOfChannels: 2 };
    ok?.(b);
    return Promise.resolve(b);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  addEventListener(): void {
    /* statechange */
  }
}

type Engine = typeof NoiseModule;
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('engine', () => {
  let eng: Engine;
  let ctx: FakeCtx;
  let states: string[];
  let session: { type: string };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    session = { type: 'auto' };
    fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { audioSession: session });
    vi.stubGlobal('window', {
      AudioContext: FakeCtx,
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (id: number) => clearTimeout(id),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    // the chime module creates the shared context on first use
    const audio = await import('./audio');
    audio.unlockAudio();
    ctx = FakeCtx.last;
    eng = await import('./noise');
    states = [];
    eng.subscribeNoiseState((s) => states.push(`${s.status}:${s.id ?? ''}`));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const master = () => ctx.gains[0]!;
  const play = (id: 'white' | 'rain' | 'pink' | 'waves' = 'white', volume = 0.5, on = true) =>
    eng.setNoiseDesired({ play: on, id, volume });

  it('volume curve is volume squared times 1.2', () => {
    expect(eng.noiseGain(0)).toBe(0);
    expect(eng.noiseGain(0.5)).toBeCloseTo(0.3);
    expect(eng.noiseGain(1)).toBeCloseTo(1.2);
  });

  it('builds source -> mix -> master -> destination and fades in over 1.5 s', () => {
    play('white', 0.5);
    const src = ctx.sources[0]!;
    expect(src.started).toBe(true);
    expect(src.loop).toBe(true);
    expect(src.out).toBe(ctx.gains[1]);
    expect(ctx.gains[1]!.out).toBe(master());
    expect(master().out).toBe(ctx.destination);
    // cancel first, hold the current value, then ramp
    expect(master().gain.calls).toEqual(['cancel', 'set 0', 'ramp 0.3 1.5']);
    expect(states.at(-1)).toBe('playing:white');
    expect(session.type).toBe('playback');
  });

  it('is idempotent', () => {
    play('white', 0.5);
    const n = master().gain.calls.length;
    play('white', 0.5);
    expect(ctx.sources).toHaveLength(1);
    expect(master().gain.calls).toHaveLength(n);
  });

  it('ramps a volume change over 80 ms and never restarts the source', () => {
    play('white', 0.5);
    play('white', 1);
    expect(ctx.sources).toHaveLength(1);
    expect(master().gain.calls.slice(-3)).toEqual(['cancel', 'set 0.3', 'ramp 1.2 0.08']);
  });

  it('fades out over 1 s, then stops and disconnects the source and restores the audio session', () => {
    play('white');
    play('white', 0.5, false);
    expect(master().gain.calls.slice(-1)).toEqual(['ramp 0 1']);
    expect(states.at(-1)).toBe('idle:');
    expect(ctx.sources[0]!.stopped).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(ctx.sources[0]!.stopped).toBe(false);
    vi.advanceTimersByTime(150);
    expect(ctx.sources[0]!.stopped).toBe(true);
    expect(ctx.sources[0]!.disconnected).toBe(true);
    expect(session.type).toBe('auto');
  });

  it('a quick off and on again reuses the source and cancels the teardown (no jump, no click)', () => {
    play('white');
    play('white', 0.5, false);
    vi.advanceTimersByTime(300);
    play('white', 0.5, true);
    vi.advanceTimersByTime(5000);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.stopped).toBe(false);
    const last = master().gain.calls.slice(-3);
    expect(last[0]).toBe('cancel');
    expect(last[2]).toBe('ramp 0.3 1.5');
    expect(states.at(-1)).toBe('playing:white');
  });

  it('switching sounds crossfades 0.6 s and drops the old source afterwards', async () => {
    play('white');
    play('pink');
    expect(ctx.sources).toHaveLength(2);
    const oldMix = ctx.gains[1]!;
    const newMix = ctx.gains[2]!;
    expect(oldMix.gain.calls.slice(-1)).toEqual(['ramp 0 0.6']);
    expect(newMix.gain.calls.slice(-1)).toEqual(['ramp 1 0.6']);
    expect(ctx.sources[0]!.stopped).toBe(false);
    vi.advanceTimersByTime(750);
    expect(ctx.sources[0]!.stopped).toBe(true);
    expect(ctx.sources[1]!.stopped).toBe(false);
    expect(states.at(-1)).toBe('playing:pink');
  });

  it('a recorded sound shows loading, fetches sounds/<id>.m4a once, loops to its length, then plays', async () => {
    play('rain');
    expect(states.at(-1)).toBe('loading:rain');
    play('rain', 0.7);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/sounds\/rain\.m4a$/);
    const src = ctx.sources[0]!;
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBe(0);
    expect(src.loopEnd).toBe(40);
    expect(states.at(-1)).toBe('playing:rain');
    // decoded buffers are cached
    play('rain', 0.7, false);
    vi.advanceTimersByTime(2000);
    play('rain', 0.7, true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a failed load reports an error state and never throws; it recovers on retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    play('waves');
    await flush();
    expect(states.at(-1)).toBe('error:waves');
    expect(eng.getNoiseState().error).toBe('network');
    expect(ctx.sources).toHaveLength(0);
    eng.retryNoise();
    await flush();
    expect(states.at(-1)).toBe('playing:waves');
  });

  it('a bad response or an undecodable file is an error too', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
    play('waves');
    await flush();
    expect(eng.getNoiseState()).toMatchObject({ status: 'error', error: 'network' });
    ctx.decodeAudioData = () => Promise.reject(new Error('bad'));
    eng.retryNoise();
    await flush();
    expect(eng.getNoiseState()).toMatchObject({ status: 'error', error: 'decode' });
  });

  it('a preview plays for about 5 s and fades out; the focus session takes over and ignores it', () => {
    eng.previewNoise('pink', 0.4);
    expect(states.at(-1)).toBe('playing:pink');
    vi.advanceTimersByTime(4900);
    expect(states.at(-1)).toBe('playing:pink');
    vi.advanceTimersByTime(200);
    expect(states.at(-1)).toBe('idle:');
    vi.advanceTimersByTime(1200);
    expect(ctx.sources[0]!.stopped).toBe(true);
    // focus owns the sound: previews are ignored
    play('white', 0.5, true);
    const before = ctx.sources.length;
    eng.previewNoise('pink', 0.4);
    expect(ctx.sources).toHaveLength(before);
    expect(states.at(-1)).toBe('playing:white');
  });

  it('starting focus while a preview plays drops the preview and keeps playing the focus sound', () => {
    eng.previewNoise('pink', 0.4);
    play('white', 0.5, true);
    vi.advanceTimersByTime(6000);
    expect(states.at(-1)).toBe('playing:white');
  });

  it('with no Web Audio it reports an error instead of throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (id: number) => clearTimeout(id),
      addEventListener: () => undefined,
    });
    const e = await import('./noise');
    expect(() => e.setNoiseDesired({ play: true, id: 'white', volume: 0.5 })).not.toThrow();
    expect(e.getNoiseState()).toMatchObject({ status: 'error', error: 'unsupported' });
  });
});
