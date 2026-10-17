// Small form and button primitives shared by every screen.
import type { ButtonHTMLAttributes, ComponentChildren, CSSProperties } from 'preact';
import {useEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from './Icon';
import { useUid } from './uid';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'text';

export function Button({
  variant = 'secondary',
  class: cls,
  children,
  ...rest
}: { variant?: BtnVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} class={`btn btn--${variant}${cls ? ` ${cls}` : ''}`}>
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  size = 44,
  iconSize = 20,
  tip,
  class: cls,
  ...rest
}: {
  icon: IconName;
  label: string;
  size?: number;
  iconSize?: number;
  tip?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={tip ?? label}
      {...rest}
      class={`iconbtn${cls ? ` ${cls}` : ''}`}
      style={{ '--size': `${size}px` } as CSSProperties}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  testid?: string;
}

/** Radio group with arrow-key navigation (roving tabindex). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  full,
  testid,
  class: cls,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  full?: boolean;
  testid?: string;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    let n: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') n = 0;
    else n = options.length - 1;
    onChange(options[n]!.value);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  return (
    <div
      ref={ref}
      class={`seg${full ? ' seg--full' : ''}${cls ? ` ${cls}` : ''}`}
      role="radiogroup"
      aria-label={label}
      data-testid={testid}
      onKeyDown={onKey}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-testid={o.testid}
          class="seg__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  id,
  disabled,
  testid,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: ComponentChildren;
  id?: string;
  disabled?: boolean;
  testid?: string;
}) {
  const auto = useUid();
  const sid = id ?? auto;
  return (
    <div class="row-switch">
      <div class="row-switch__text">
        <label for={sid} class="row-switch__label">
          {label}
        </label>
        {hint ? <div class="hint">{hint}</div> : null}
      </div>
      <button
        id={sid}
        data-testid={testid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        class="switch"
        onClick={() => onChange(!checked)}
      >
        <span class="switch__thumb" />
      </button>
    </div>
  );
}

/** Number stepper. Typing is allowed; the value is clamped when the field loses focus (TMR-10). */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  unit,
  format,
  testid,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  unit?: string;
  format?: (v: number) => string;
  testid?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const id = useUid();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    if (text === null) return;
    const n = parseInt(text, 10);
    setText(null);
    if (Number.isFinite(n)) onChange(clamp(n));
  };
  return (
    <div class="stepper">
      <label for={id} class="stepper__label">
        {label}
      </label>
      <div class="stepper__ctl">
        <button
          type="button"
          class="stepper__btn"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          <Icon name="minus" size={16} />
        </button>
        <input
          id={id}
          class="stepper__input"
          data-testid={testid}
          inputMode="numeric"
          autoComplete="off"
          value={text ?? String(value)}
          onInput={(e) => setText((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'ArrowUp') {
              e.preventDefault();
              onChange(clamp(value + step));
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              onChange(clamp(value - step));
            }
          }}
        />
        <button
          type="button"
          class="stepper__btn"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          <Icon name="plus" size={16} />
        </button>
        {unit ? <span class="stepper__unit">{unit}</span> : null}
        {format ? <span class="stepper__fmt">{format(value)}</span> : null}
      </div>
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  id,
  hideLabel,
  testid,
  class: cls,
}: {
  value: string | number;
  onChange: (v: string) => void;
  options: { value: string | number; label: string }[];
  label: string;
  id?: string;
  hideLabel?: boolean;
  testid?: string;
  class?: string;
}) {
  const auto = useUid();
  const sid = id ?? auto;
  return (
    <div class={`field${cls ? ` ${cls}` : ''}`}>
      <label for={sid} class={hideLabel ? 'sr-only' : 'field__label'}>
        {label}
      </label>
      <div class="select">
        <select
          id={sid}
          data-testid={testid}
          value={String(value)}
          onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
        >
          {options.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} class="select__chev" />
      </div>
    </div>
  );
}

export function Card({
  title,
  children,
  class: cls,
  id,
  testid,
  actions,
}: {
  title?: string;
  children: ComponentChildren;
  class?: string;
  id?: string;
  testid?: string;
  actions?: ComponentChildren;
}) {
  const hid = useUid();
  return (
    <section
      class={`card${cls ? ` ${cls}` : ''}`}
      aria-labelledby={title ? hid : undefined}
      data-testid={testid}
      id={id}
    >
      {title ? (
        <div class="card__head">
          <h2 id={hid} class="card__title">
            {title}
          </h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Popover menu for row actions. Escape and outside click close it; arrows move between items. */
export function Menu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const els = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const i = els.indexOf(document.activeElement as HTMLElement);
      els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div class="menu" ref={root} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        class="iconbtn"
        style={{ '--size': '44px' } as CSSProperties}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" size={20} />
      </button>
      {open ? (
        <div class="menu__list" role="menu" aria-label={label}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              class={`menu__item${it.danger ? ' menu__item--danger' : ''}`}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
