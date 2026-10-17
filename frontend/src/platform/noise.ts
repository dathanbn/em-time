// Focus sounds engine (lazy chunk: the main bundle imports it only when sounds are needed).
// Graph: AudioBufferSourceNode(loop) -> mixGain -> masterGain -> destination, on the chime context.
// Three colors are synthesized (platform/noiseSynth.ts); six ambient loops are fetched, decoded and
// cached (sounds/<id>.m4a, AAC, cut with a baked-in crossfade so they loop without a seam).
import type { NoiseId } from '@core';
import { getAudioCtx } from './audio';
import { SYNTH_FADE_SECONDS, SYNTH_RMS, SYNTH_SECONDS, rms, synthChannel, type SynthColor } from './noiseSynth';

export interface NoiseState {
  status: 'idle' | 'loading' | 'playing' | 'error';
  id: NoiseId | null;
  /** 'unsupported' (no Web Audio), 'network' (fetch failed) or 'decode'. */
  error?: string;
}
export interface NoiseDesired {
  play: boolean;
  id: NoiseId;
  volume: number;
}

const FADE_IN = 1.5;
const FADE_OUT = 1.0;
const XFADE = 0.6;
const VOLUME_RAMP = 0.08;
const PREVIEW_MS = 5000;
/** Loop length in seconds of each recording (the file is cut to exactly this). */
const LOOP_SEC: Partial<Record<NoiseId, number>> = {
  rain: 40,
  waves: 40,
  stream: 40,
  cafe: 14.5,
  fireplace: 23,
  night: 45,
};

/** Perceptual volume curve: slider 0..1 -> gain. */
export const noiseGain = (volume: number): number => Math.min(1, Math.max(0, volume)) ** 2 * 1.2;

interface Voice {
  id: NoiseId;
  src: AudioBufferSourceNode;
  mix: GainNode;
}

// ---------------------------------------------------------------------------------------- buffers

/** A stereo loop of one synthesized color: independent L/R, seamless at the loop point. */
export function makeSynthBuffer(ctx: BaseAudioContext, color: SynthColor): AudioBuffer {
  const n = Math.round(ctx.sampleRate * SYNTH_SECONDS);
  const fade = Math.round(ctx.sampleRate * SYNTH_FADE_SECONDS);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) buf.copyToChannel(synthChannel(color, n, fade), ch);
  return buf;
}

const buffers = new Map<NoiseId, AudioBuffer>();
const pending = new Map<NoiseId, Promise<AudioBuffer>>();

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    // Old Safari only has the callback form; newer ones return a promise as well.
    const r = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (r && typeof r.then === 'function') r.then(resolve, reject);
  });
}

class LoadError extends Error {
  constructor(readonly kind: 'network' | 'decode') {
    super(kind);
  }
}

/** Decoded recordings are cached; concurrent requests for one sound share one load. */
function load(ctx: AudioContext, id: NoiseId): Promise<AudioBuffer> {
  const hit = buffers.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      let data: ArrayBuffer;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}sounds/${id}.m4a`);
        if (!res.ok) throw new Error(String(res.status));
        data = await res.arrayBuffer();
      } catch {
        throw new LoadError('network');
      }
      try {
        return await decode(ctx, data);
      } catch {
        throw new LoadError('decode');
      }
    })();
    pending.set(id, p);
    void p.then(
      (b) => {
        buffers.set(id, b);
        pending.delete(id);
      },
      () => {
        pending.delete(id);
      },
    );
  }
  return p;
}

/** The buffer if it is ready right now (synth sounds are generated on first use). */
function ready(ctx: AudioContext, id: NoiseId): AudioBuffer | null {
  let b = buffers.get(id) ?? null;
  if (!b && id in SYNTH_RMS) {
    b = makeSynthBuffer(ctx, id as SynthColor);
    buffers.set(id, b);
  }
  return b;
}

// ------------------------------------------------------------------------------------------ engine

let wanted: NoiseDesired = { play: false, id: 'rain', volume: 0.5 };
let preview: { id: NoiseId; volume: number } | null = null;
let previewTimer = 0;
let stopTimer = 0;
let master: GainNode | null = null;
let voice: Voice | null = null;
const retiring = new Set<Voice>();
let audible = false;
let loadingId: NoiseId | null = null;
let errorState: { id: NoiseId; error: string } | null = null;
let seq = 0;
let unlockArmed = false;
let hooked: AudioContext | null = null;
let state: NoiseState = { status: 'idle', id: null };
const subs = new Set<(s: NoiseState) => void>();

export function getNoiseState(): NoiseState {
  return state;
}

export function subscribeNoiseState(cb: (s: NoiseState) => void): () => void {
  subs.add(cb);
  cb(state);
  return () => {
    subs.delete(cb);
  };
}

function publish(): void {
  const ctx = getAudioCtx();
  let next: NoiseState;
  if (errorState) next = { status: 'error', id: errorState.id, error: errorState.error };
  else if (loadingId) next = { status: 'loading', id: loadingId };
  else if (audible && voice && ctx?.state === 'running') next = { status: 'playing', id: voice.id };
  else next = { status: 'idle', id: null };
  if (next.status === state.status && next.id === state.id && next.error === state.error) return;
  state = next;
  for (const cb of [...subs]) cb(state);
}

/** Moves a parameter to `to` over `sec` from wherever it is now, so rapid changes never jump or click. */
function ramp(p: AudioParam, to: number, sec: number): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const from = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(from, now);
  p.linearRampToValueAtTime(to, now + sec);
}

/** iOS mutes Web Audio on the ring/silent switch unless the page declares playback audio. */
function setSession(type: 'playback' | 'auto'): void {
  try {
    const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (s) s.type = type;
  } catch {
    /* not supported */
  }
}

function drop(v: Voice): void {
  try {
    v.src.stop();
  } catch {
    /* already stopped */
  }
  v.src.disconnect();
  v.mix.disconnect();
  retiring.delete(v);
}

function retire(v: Voice, immediately: boolean): void {
  if (immediately) return drop(v);
  retiring.add(v);
  ramp(v.mix.gain, 0, XFADE);
  window.setTimeout(() => drop(v), XFADE * 1000 + 100);
}

function target(): { id: NoiseId; volume: number } | null {
  return wanted.play ? wanted : preview;
}

function armUnlock(ctx: AudioContext): void {
  if (unlockArmed) return;
  unlockArmed = true;
  const go = () => {
    for (const e of ['pointerdown', 'keydown']) window.removeEventListener(e, go, true);
    unlockArmed = false;
    void ctx.resume().then(publish, () => undefined);
  };
  for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, go, true);
}

/** Fades the sound out and releases the sources. `error` keeps a failed start visible in the state. */
function fadeOut(error: { id: NoiseId; error: string } | null = null): void {
  seq++;
  loadingId = null;
  errorState = error;
  window.clearTimeout(stopTimer);
  if (master && audible) ramp(master.gain, 0, FADE_OUT);
  audible = false;
  const my = seq;
  stopTimer = window.setTimeout(() => {
    if (my !== seq) return;
    for (const v of [voice, ...retiring]) if (v) drop(v);
    voice = null;
    setSession('auto');
  }, FADE_OUT * 1000 + 100);
  publish();
}

function start(ctx: AudioContext, t: { id: NoiseId; volume: number }, buf: AudioBuffer): void {
  window.clearTimeout(stopTimer);
  loadingId = null;
  errorState = null;
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  if (!voice || voice.id !== t.id) {
    const src = ctx.createBufferSource();
    const mix = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    const sec = LOOP_SEC[t.id];
    if (sec) {
      src.loopStart = 0;
      src.loopEnd = Math.min(sec, buf.duration);
    }
    src.connect(mix).connect(master);
    const next: Voice = { id: t.id, src, mix };
    if (voice) {
      // still faintly audible (a fade-out in progress) counts: dropping it now would click
      const crossfade = audible || master.gain.value > 0.001;
      retire(voice, !crossfade);
      if (crossfade) {
        mix.gain.value = 0;
        ramp(mix.gain, 1, XFADE);
      }
    }
    voice = next;
    src.start();
  }
  const g = noiseGain(t.volume);
  if (audible) ramp(master.gain, g, VOLUME_RAMP);
  else {
    audible = true;
    setSession('playback');
    ramp(master.gain, g, FADE_IN);
  }
  publish();
}

function apply(): void {
  const my = ++seq;
  const t = target();
  if (!t) return fadeOut();
  const ctx = getAudioCtx();
  if (!ctx) {
    return fadeOut({ id: t.id, error: 'unsupported' });
  }
  window.clearTimeout(stopTimer);
  if (hooked !== ctx) {
    hooked = ctx;
    ctx.addEventListener('statechange', publish);
  }
  if (ctx.state !== 'running') {
    void ctx.resume().then(publish, () => undefined);
    armUnlock(ctx);
  }
  errorState = null;
  const buf = ready(ctx, t.id);
  if (buf) return start(ctx, t, buf);
  loadingId = t.id;
  publish();
  load(ctx, t.id).then(
    (b) => {
      if (my === seq) start(ctx, t, b);
    },
    (e: unknown) => {
      if (my !== seq) return;
      fadeOut({ id: t.id, error: e instanceof LoadError ? e.kind : 'network' });
    },
  );
}

/** Idempotent: the controller calls this whenever settings or the timer change. */
export function setNoiseDesired(d: NoiseDesired): void {
  const same = d.play === wanted.play && d.id === wanted.id && d.volume === wanted.volume;
  if (same) return;
  wanted = { play: d.play, id: d.id, volume: d.volume };
  if (d.play) {
    window.clearTimeout(previewTimer);
    preview = null;
  }
  apply();
}

/**
 * Plays a sound for about five seconds, then fades out. While a focus session owns the sound this does
 * nothing (a changed selection already reaches the engine through setNoiseDesired). Calling it again
 * while a preview plays switches the sound or volume live and restarts the five seconds.
 */
export function previewNoise(id: NoiseId, volume: number): void {
  if (wanted.play) return;
  preview = { id, volume };
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    preview = null;
    apply();
  }, PREVIEW_MS);
  apply();
}

/** Tries the current target again (after a failed load). */
export function retryNoise(): void {
  if (errorState) apply();
}

if (typeof window !== 'undefined') window.addEventListener('online', retryNoise);

// ------------------------------------------------------------------------------------ test hook
// Same gating as window.__emCore: dev, or a VITE_E2E=1 build with ?e2e in the URL. Never in production.
if (
  typeof window !== 'undefined' &&
  (import.meta.env.DEV || (import.meta.env.VITE_E2E === '1' && new URLSearchParams(location.search).has('e2e')))
) {
  let analyser: AnalyserNode | null = null;
  (window as unknown as { __emNoise: unknown }).__emNoise = {
    state: getNoiseState,
    /** RMS of the master output right now (attaches an analyser on first call). */
    level(): number {
      const ctx = getAudioCtx();
      if (!ctx || !master) return 0;
      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        master.connect(analyser);
      }
      const a = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(a);
      return rms(a);
    },
    masterGain: () => master?.gain.value ?? 0,
    /** Renders a synth color offline at volume 1 (no master curve) and returns its RMS. */
    async renderRms(color: SynthColor): Promise<number> {
      const off = new OfflineAudioContext(2, 44100 * 3, 44100);
      const src = off.createBufferSource();
      src.buffer = makeSynthBuffer(off, color);
      src.connect(off.destination);
      src.start();
      const out = await off.startRendering();
      return Math.sqrt((rms(out.getChannelData(0)) ** 2 + rms(out.getChannelData(1)) ** 2) / 2);
    },
    /** Fetches and decodes a recording the way the engine does. */
    async decode(id: NoiseId): Promise<{ duration: number; channels: number; rate: number }> {
      const off = new OfflineAudioContext(2, 44100, 44100);
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/${id}.m4a`);
      const b = await decode(off, await res.arrayBuffer());
      return { duration: b.duration, channels: b.numberOfChannels, rate: b.sampleRate };
    },
  };
}
