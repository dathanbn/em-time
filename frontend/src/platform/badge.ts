// App icon badge: the minutes left in the current phase, on the installed app's icon (Windows
// taskbar and Start, macOS Dock, ChromeOS shelf). The Badging API only shows a number, so the badge
// is "17" while the tab title says "16:42". Browsers ignore it for a plain tab, so there is no
// setting: it appears only where it can. Every call is guarded; a browser without the API, or one
// that rejects the call (Firefox, Safari in a tab), costs nothing.
import { MIN, type TimerStatus } from '@core';

/** The badge for a timer state: minutes left (rounded up, at least 1) while running or paused, null when idle. */
export function badgeFor(status: TimerStatus, remainingMs: number): number | null {
  if (status === 'idle') return null;
  return Math.max(1, Math.ceil(remainingMs / MIN));
}

type BadgeNav = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

let shown: number | null | undefined; // undefined: nothing asked yet

/** Applies a badge value once per change; a repeated value is free. */
export function applyBadge(value: number | null): void {
  if (value === shown) return;
  const nav = navigator as BadgeNav;
  if (typeof nav.setAppBadge !== 'function' || typeof nav.clearAppBadge !== 'function') return;
  shown = value;
  try {
    const p = value === null ? nav.clearAppBadge() : nav.setAppBadge(value);
    void p.catch(() => {});
  } catch {
    /* not supported here */
  }
}
