import { signal } from '@preact/signals';

export type Route = 'timer' | 'tasks' | 'stats' | 'settings';
export const ROUTES: Route[] = ['timer', 'tasks', 'stats', 'settings'];

function parse(): Route {
  const m = /^#\/(\w+)/.exec(location.hash);
  const r = m?.[1] as Route | undefined;
  return r && ROUTES.includes(r) ? r : 'timer';
}

export const route = signal<Route>(parse());

export function initRouter(): void {
  if (!/^#\/\w+/.test(location.hash))
    history.replaceState(null, '', `${location.pathname}${location.search}#/timer`);
  route.value = parse();
  window.addEventListener('hashchange', () => {
    route.value = parse();
    window.scrollTo(0, 0);
  });
}

export function go(r: Route): void {
  location.hash = `#/${r}`;
}
