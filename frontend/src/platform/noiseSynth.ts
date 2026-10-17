// Synthesized noise colors as plain sample arrays (no Web Audio), so they can be unit tested in
// Node. platform/noise.ts copies them into stereo AudioBuffers.
export type SynthColor = 'white' | 'pink' | 'brown';

/**
 * RMS at volume 1, before the master curve. Measured with ffmpeg ebur128 so pink and brown match the
 * -26 LUFS recordings and white (the harshest) sits 1 dB under them, at -27 LUFS.
 */
export const SYNTH_RMS: Record<SynthColor, number> = { white: 0.022, pink: 0.037, brown: 0.043 };
export const SYNTH_SECONDS = 10;
export const SYNTH_FADE_SECONDS = 0.5;

const WARMUP = 20_000;

export function rms(a: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * a[i]!;
  return Math.sqrt(sum / Math.max(1, a.length));
}

/**
 * One channel of loopable noise. `length + fadeLen` raw samples are generated and the extra tail is
 * mixed (equal power) into the first `fadeLen` samples, so out[length - 1] flows into out[0] without a
 * click even for pink and brown, whose slow drift would otherwise jump at the loop point.
 * The result has no DC offset and the RMS of SYNTH_RMS[color].
 */
export function synthChannel(
  color: SynthColor,
  length: number,
  fadeLen: number,
  rand: () => number = Math.random,
): Float32Array<ArrayBuffer> {
  const raw = new Float32Array(length + fadeLen);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; // pink filter state
  let brown = 0;
  for (let i = -WARMUP; i < raw.length; i++) {
    const w = rand() * 2 - 1;
    let v = w;
    if (color === 'pink') {
      // Paul Kellet's refined method
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else if (color === 'brown') {
      brown = (brown + 0.02 * w) / 1.02; // leaky integrator
      v = brown;
    }
    if (i >= 0) raw[i] = v;
  }
  const out = raw.slice(0, length);
  for (let i = 0; i < fadeLen; i++) {
    const a = ((i + 0.5) / fadeLen) * (Math.PI / 2);
    out[i] = raw[i]! * Math.sin(a) + raw[length + i]! * Math.cos(a);
  }
  let mean = 0;
  for (let i = 0; i < length; i++) mean += out[i]!;
  mean /= length;
  for (let i = 0; i < length; i++) out[i] = out[i]! - mean;
  const k = SYNTH_RMS[color] / (rms(out) || 1);
  for (let i = 0; i < length; i++) out[i] = out[i]! * k;
  return out;
}
