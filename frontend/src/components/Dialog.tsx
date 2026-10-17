// Modal dialog and bottom sheet: focus trap, Escape to close, focus returned on close.
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { IconButton } from './ui';

let openCount = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
  footer,
  sheet,
  hideClose,
  testid,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** Bottom sheet on phones; centered on desktop either way. */
  sheet?: boolean;
  hideClose?: boolean;
  testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    openCount++;
    document.body.classList.add('modal-open');
    const el = ref.current!;
    const first =
      el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus();
    return () => {
      openCount--;
      if (openCount <= 0) document.body.classList.remove('modal-open');
      prev?.focus?.();
    };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (x) => x.offsetParent !== null,
    );
    if (list.length === 0) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div class="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        class={`dialog${sheet ? ' dialog--sheet' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKey}
        data-testid={testid}
      >
        <div class="dialog__head">
          <h2 id={titleId} class="dialog__title">
            {title}
          </h2>
          {hideClose ? null : <IconButton icon="x" label="Close" size={44} onClick={onClose} />}
        </div>
        <div class="dialog__body">{children}</div>
        {footer ? <div class="dialog__foot">{footer}</div> : null}
      </div>
    </div>
  );
}
