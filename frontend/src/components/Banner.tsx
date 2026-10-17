import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

export function Banner({
  tone = 'danger',
  children,
  actions,
}: {
  tone?: 'danger' | 'info';
  children: ComponentChildren;
  actions?: ComponentChildren;
}) {
  return (
    <div class={`banner banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'} data-testid="banner">
      <Icon name={tone === 'danger' ? 'alert' : 'info'} size={20} class="banner__icon" />
      <p class="banner__text">{children}</p>
      {actions ? <div class="banner__actions">{actions}</div> : null}
    </div>
  );
}
