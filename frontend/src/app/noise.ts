// Focus sounds controller. Everything heavy is lazy: the engine (platform/noise.ts, a dynamic import
// that only loads once sounds are actually needed) and the picker UI (components/NoisePanel.tsx).
import { effect, signal } from '@preact/signals';
import type * as NoiseEngine from '../platform/noise';
import type * as NoisePanel from '../components/NoisePanel';
import { data, timerState } from './coreBridge';

export const noiseState = signal<NoiseEngine.NoiseState>({ status: 'idle', id: null });
export const noiseUi = signal<typeof NoisePanel | null>(null);

let engine: Promise<typeof NoiseEngine> | undefined;

export const loadNoise = () =>
  (engine ??= import('../platform/noise').then((m) => {
    m.subscribeNoiseState((s) => (noiseState.value = s));
    return m;
  }));

export const loadNoiseUi = () => {
  void import('../components/NoisePanel').then((m) => (noiseUi.value = m));
};

/** Plays while sounds are on and a focus phase runs; fades out on pause, reset, skip, breaks and phase end. */
export function initNoise(): void {
  effect(() => {
    const s = data.value.settings;
    const t = timerState.value;
    const play = s.noiseOn && t.phase === 'focus' && t.status === 'running';
    if (play || engine)
      void loadNoise().then((m) => m.setNoiseDesired({ play, id: s.noise, volume: s.noiseVolume }));
  });
}
