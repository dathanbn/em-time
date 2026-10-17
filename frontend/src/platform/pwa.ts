// Service worker registration. The update prompt only appears while the timer is not running
// and never reloads by itself (PWA-3).
import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';

export const needRefresh = signal(false);
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export function initPwa(): void {
  try {
    updateSW = registerSW({
      onNeedRefresh() {
        needRefresh.value = true;
      },
      onRegisterError(err: unknown) {
        console.warn('Em Time: service worker registration failed', err);
      },
    });
  } catch (err) {
    console.warn('Em Time: service worker unavailable', err);
  }
}

export function applyUpdate(): void {
  if (updateSW) void updateSW(true);
  else location.reload();
}
