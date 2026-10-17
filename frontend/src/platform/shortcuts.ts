// Keyboard shortcuts (TMR-13). Ignored while typing, with Ctrl/Meta/Alt held, and while a
// dialog is open (except `?`).
export interface ShortcutHandlers {
  toggle(): void;
  skip(): void;
  reset(): void;
  noise(): void;
  mode(phase: 'focus' | 'short' | 'long'): void;
  help(): void;
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isNativeActivator(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.closest) return false;
  if (el.closest('[data-timer-control]')) return false;
  return !!el.closest(
    'button, a[href], summary, [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"]',
  );
}

export function initShortcuts(h: ShortcutHandlers): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    const dialogOpen = !!document.querySelector('[role="dialog"][aria-modal="true"]');
    if (e.key === '?') {
      if (!dialogOpen) {
        e.preventDefault();
        h.help();
      }
      return;
    }
    if (dialogOpen) return;
    switch (e.key) {
      case ' ':
        if (isNativeActivator(e.target)) return;
        e.preventDefault();
        h.toggle();
        break;
      case 's':
      case 'S':
        e.preventDefault();
        h.skip();
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        h.reset();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        h.noise();
        break;
      case '1':
        h.mode('focus');
        break;
      case '2':
        h.mode('short');
        break;
      case '3':
        h.mode('long');
        break;
    }
  };
  window.addEventListener('keydown', onKey);
  // A Space keyup on a focused timer button would otherwise also "click" it after we toggled.
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' && (e.target as HTMLElement | null)?.closest?.('[data-timer-control]'))
      e.preventDefault();
  };
  window.addEventListener('keyup', onKeyUp);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
  };
}
