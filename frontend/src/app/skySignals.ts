import { signal } from '@preact/signals';
import type { Polarity } from '../platform/sky';

/** Current polarity of the UI, mirrored from the sky writer so components can react to it. */
export const skyPolarity = signal<Polarity>('light');
