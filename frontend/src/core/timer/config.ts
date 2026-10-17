import { MIN } from '../constants';
import type { Settings } from '../types';
import type { TimerConfig } from '../api';

export function timerConfigFromSettings(
  s: Pick<Settings, 'focusMin' | 'shortMin' | 'longMin' | 'longEvery' | 'autoStart'>,
): TimerConfig {
  return {
    focusMs: s.focusMin * MIN,
    shortMs: s.shortMin * MIN,
    longMs: s.longMin * MIN,
    longEvery: s.longEvery,
    autoStart: s.autoStart,
  };
}
