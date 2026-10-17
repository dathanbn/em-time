// Keeps the screen awake while a phase runs (TMR-17). Re-acquired when the page becomes visible.
let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!('wakeLock' in navigator) || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    if (!wanted) release();
  } catch {
    sentinel = null;
  }
}

function release(): void {
  const s = sentinel;
  sentinel = null;
  void s?.release().catch(() => undefined);
}

export function setWakeLock(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else release();
}

export const wakeLockSupported = (): boolean => 'wakeLock' in navigator;

export function initWakeLock(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) void acquire();
  });
}
