// Small Copy object for core tests and quick experiments. NOT the product copy: the frontend's
// data/messages.json holds the verbatim spec appendices.
import type { Copy } from '../types';

export const TEST_COPY: Copy = {
  encouragement: [
    '{sessions} sessions in. Nicely done.',
    "That's {sessions} today. Steady work.",
    'One more session in the books.',
    'That counted. Take your break.',
    'Quietly getting it done.',
  ],
  breakPrompts: [
    'Look at something 20 feet away for 20 seconds.',
    'Drink a glass of water.',
    'Stand up and stretch your arms overhead.',
  ],
  milestones: {
    'sessions-10': 'Ten sessions. A real habit is starting.',
    'sessions-50': "Fifty sessions. That's a lot of focused hours.",
    'sessions-100': 'One hundred sessions. Remarkable consistency.',
    'sessions-250': "Two hundred fifty sessions. Look how far you've come.",
    'streak-7': 'Seven days in a row. A full week of showing up.',
    'streak-30': "Thirty days straight. That's a real rhythm.",
  },
  aboutLine: 'Made with care, for you.',
};
