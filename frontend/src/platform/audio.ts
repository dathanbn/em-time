// Web Audio chimes, synthesized: no audio files, works offline. The context is created and
// resumed from a user gesture (first Play, or a Preview press).
import type { ChimeId } from '@core';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a click or key handler. */
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

interface Partial {
  f: number;
  gain: number;
  decay: number;
  at?: number;
  type?: OscillatorType;
  attack?: number;
  glideTo?: number;
}

const RECIPES: Record<Exclude<ChimeId, 'none'>, Partial[]> = {
  glass: [
    { f: 1046.5, gain: 0.5, decay: 1.8 },
    { f: 1568, gain: 0.22, decay: 1.2 },
    { f: 1318.5, gain: 0.4, decay: 1.9, at: 0.22 },
    { f: 2093, gain: 0.1, decay: 0.9, at: 0.22 },
  ],
  bowl: [
    { f: 220, gain: 0.55, decay: 3.6, attack: 0.03 },
    { f: 222.6, gain: 0.35, decay: 3.2, attack: 0.03 },
    { f: 440.8, gain: 0.18, decay: 2.2, attack: 0.03 },
    { f: 598, gain: 0.08, decay: 1.4, attack: 0.03 },
  ],
  bell: [
    { f: 784, gain: 0.45, decay: 2.8 },
    { f: 1568, gain: 0.2, decay: 2.0 },
    { f: 1976, gain: 0.14, decay: 1.5 },
    { f: 2349, gain: 0.08, decay: 1.1 },
  ],
  wood: [
    { f: 640, gain: 0.6, decay: 0.16, type: 'triangle', glideTo: 420 },
    { f: 640, gain: 0.5, decay: 0.16, type: 'triangle', glideTo: 420, at: 0.24 },
  ],
};

export function playChime(id: ChimeId, volume: number): void {
  if (id === 'none' || volume <= 0) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  const master = c.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume)) * 0.7;
  master.connect(c.destination);
  const t0 = c.currentTime + 0.02;
  let end = t0;
  for (const p of RECIPES[id]) {
    const osc = c.createOscillator();
    const g = c.createGain();
    const start = t0 + (p.at ?? 0);
    const attack = p.attack ?? 0.006;
    osc.type = p.type ?? 'sine';
    osc.frequency.setValueAtTime(p.f, start);
    if (p.glideTo) osc.frequency.exponentialRampToValueAtTime(p.glideTo, start + p.decay);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(p.gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + p.decay);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + p.decay + 0.05);
    end = Math.max(end, start + p.decay + 0.1);
  }
  window.setTimeout(() => master.disconnect(), (end - c.currentTime) * 1000 + 100);
}
