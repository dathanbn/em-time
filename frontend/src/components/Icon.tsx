// Inline SVG icons: 24px grid, 2.25px stroke, round caps and joins (Lucide-style shapes drawn in-repo).
const PATHS = {
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 3h5"/>',
  tasks: '<path d="M10 6h10M10 12h10M10 18h10M3.5 6.5 5 8l2.5-3M3.5 12.5 5 14l2.5-3M3.5 18.5 5 20l2.5-3"/>',
  stats: '<path d="M5 20v-8M12 20V5M19 20v-11"/>',
  settings:
    '<path d="M4 7h8M17 7h3M4 17h3M12 17h8"/><circle cx="14.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  stopwatch:
    '<circle cx="12" cy="14" r="7.5"/><path d="M12 14l3-3.5M10 2.8h4M12 2.8v3.7M18.4 7.3l1.4-1.4"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause:
    '<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V9H8"/>',
  skip: '<path d="M6 6v12l9-6z" fill="currentColor"/><path d="M19 5.5v13"/>',
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>',
  'chevron-left': '<path d="m14.5 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  target:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  'target-fill': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5" fill="currentColor"/>',
  more: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/>',
  sync: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 4v5h-5"/>',
  'cloud-off':
    '<path d="m3 3 18 18M17.5 17.5H8a4.5 4.5 0 0 1-1-8.9M9.5 5.6A6 6 0 0 1 17.8 9 4 4 0 0 1 21 13"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.3v.2"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.2 2.6 2.6 5-5.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>',
  'volume-off': '<path d="M11 5 6.5 9H3v6h3.5L11 19zM22 9.5l-5 5M17 9.5l5 5"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={cls ? `icon ${cls}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
