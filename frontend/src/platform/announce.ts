// Screen reader announcements through one polite live region (A11Y-3). Remaining time is
// announced at most once per 60 s, at 20, 15, 10, 5 and 1 minutes left.
import { ANNOUNCE_MINUTES_LEFT } from '@core';

let region: HTMLElement | null = null;
let lastTimeAt = 0;
let lastKey = '';
let clearTimer: number | undefined;

export function setLiveRegion(el: HTMLElement | null): void {
  region = el;
}

export function announce(text: string): void {
  if (!region) return;
  window.clearTimeout(clearTimer);
  // Blank first so repeating the same text is still read out.
  region.textContent = '';
  window.setTimeout(() => {
    if (region) region.textContent = text;
  }, 30);
  clearTimer = window.setTimeout(() => {
    if (region) region.textContent = '';
  }, 8000);
}

export function announceRemaining(remainingMs: number, phaseStartedAt: number | null, now: number): void {
  const mins = Math.ceil(remainingMs / 60_000);
  if (!(ANNOUNCE_MINUTES_LEFT as readonly number[]).includes(mins)) return;
  // Skip the first seconds of a phase: "Focus started" was just announced.
  if (phaseStartedAt !== null && now - phaseStartedAt < 10_000) return;
  const key = `${phaseStartedAt}:${mins}`;
  if (key === lastKey || now - lastTimeAt < 60_000) return;
  lastKey = key;
  lastTimeAt = now;
  announce(mins === 1 ? '1 minute left' : `${mins} minutes left`);
}
