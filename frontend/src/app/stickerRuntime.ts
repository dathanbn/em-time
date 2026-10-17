// The one shared sticker picker (so "no back-to-back repeats" holds across drifting stickers and
// bursts) and the seeded rng for e2e builds.
import stickerData from '../data/stickers.json';
import {
  BURST,
  burst,
  createStickerPicker,
  emojiSupportFilter,
  makeRng,
  validateStickerData,
  type StickerPicker,
} from '../platform/stickers';
import { nearestPhase } from '../platform/sky';

export const rng = makeRng();

let picker: StickerPicker | null = null;

/** Lazily built; null if the shipped data fails validation (stickers then stay off). */
export function getPicker(): StickerPicker | null {
  if (picker) return picker;
  try {
    picker = createStickerPicker(validateStickerData(stickerData), rng);
    picker.supported(emojiSupportFilter());
  } catch (e) {
    console.warn('Em Time: stickers unavailable', e);
    picker = null;
  }
  return picker;
}

const isNarrow = (): boolean => window.matchMedia('(max-width: 899px)').matches;

/** Completion burst from the ring bubble (or the screen center when the timer is not showing). */
export function celebrateWithStickers(milestone: boolean): void {
  const p = getPicker();
  if (!p) return;
  const narrow = isNarrow();
  const count = milestone
    ? narrow
      ? BURST.milestoneNarrow
      : BURST.milestoneWide
    : narrow
      ? BURST.narrow
      : BURST.wide;
  const el = document.querySelector('[data-testid="timer-bubble"]');
  const origin = el?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0);
  const d = new Date();
  burst({ origin, count, picker: p, phase: nearestPhase(d.getHours() * 60 + d.getMinutes()), rng });
}
