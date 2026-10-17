import { numberWord } from '../time/format';

const TOKEN = '{sessions}';

function shuffled(length: number, random: () => number): number[] {
  const a = Array.from({ length }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A fresh shuffled bag of indices 0..length-1. */
export function createBag(length: number, random: () => number): number[] {
  return shuffled(Math.max(0, Math.floor(length)), random);
}

/**
 * Takes the first eligible index out of the bag. Ineligible indices stay in the bag for later.
 * When the bag holds no eligible index, it is refilled with every index (a new round) first.
 * Returns index -1 when nothing at all is eligible.
 */
export function nextFromBag(
  bag: number[],
  eligible: (i: number) => boolean,
  length: number,
  random: () => number,
): { index: number; bag: number[] } {
  const valid = bag.filter((i) => Number.isInteger(i) && i >= 0 && i < length);
  let pos = valid.findIndex(eligible);
  let working = valid;
  if (pos === -1) {
    working = createBag(length, random);
    pos = working.findIndex(eligible);
    if (pos === -1) return { index: -1, bag: working };
  }
  const index = working[pos]!;
  return { index, bag: working.filter((_, i) => i !== pos) };
}

/**
 * Renders one encouragement line. Lines with the {sessions} token need at least 2 sessions today
 * (null otherwise). The count is a word for 2..12 (capitalized at the start of a line), digits above.
 */
export function renderMessage(line: string, sessionsToday: number): string | null {
  if (!line.includes(TOKEN)) return line;
  if (sessionsToday < 2) return null;
  const word = numberWord(sessionsToday);
  let out = '';
  let rest = line;
  while (rest.length > 0) {
    const at = rest.indexOf(TOKEN);
    if (at === -1) {
      out += rest;
      break;
    }
    const before = out + rest.slice(0, at);
    const atStart = before.length === 0;
    out = before + (atStart ? word.charAt(0).toUpperCase() + word.slice(1) : word);
    rest = rest.slice(at + TOKEN.length);
  }
  return out;
}
