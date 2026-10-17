import { NOISE_IDS, type NoiseId } from '@core';

/** Label and emoji of each sound, in NOISE_IDS order. */
const INFO = [
  ['White noise', '❄️'],
  ['Pink noise', '🌸'],
  ['Brown noise', '🍂'],
  ['Rain', '🌧️'],
  ['Ocean', '🌊'],
  ['Stream', '💧'],
  ['Café', '☕'],
  ['Fireplace', '🔥'],
  ['Summer night', '🌙'],
] as const;

export const noiseInfo = (id: NoiseId): (typeof INFO)[number] => INFO[NOISE_IDS.indexOf(id)]!;
