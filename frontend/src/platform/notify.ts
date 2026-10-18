// Notifications: permission is requested on the first Play press, never on load. A system
// notification is shown only when the page is hidden (D-21).
import type { Phase } from '@core';
import { notificationsSupported } from './env';

export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function phaseEndContent(ended: Phase, next: Phase): { title: string; body: string } {
  if (ended === 'focus') {
    return {
      title: 'Focus done',
      body: next === 'long' ? 'Time for a long break.' : 'Time for a short break.',
    };
  }
  return { title: "Break's over", body: 'Ready when you are.' };
}

export async function showPhaseNotification(ended: Phase, next: Phase): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted' || !document.hidden) return;
  const { title, body } = phaseEndContent(ended, next);
  const options: NotificationOptions = {
    body,
    tag: 'em-time-phase',
    icon: `${import.meta.env.BASE_URL}pwa-192x192.png`,
    silent: true,
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    /* fall through to the page-level API */
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some mobile browsers only allow the service worker route */
  }
}
