import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { ChartTooltip } from '../charts/Tooltip';
import { Dialog } from '../components/Dialog';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/ui';
import { setLiveRegion } from '../platform/announce';
import { applyGradient } from '../platform/gradient';
import { applyUpdate, needRefresh } from '../platform/pwa';
import { ShortcutsList, Settings } from '../screens/Settings';
import { Stats } from '../screens/Stats';
import { Tasks } from '../screens/Tasks';
import { Timer } from '../screens/Timer';
import { confirmDiscard, pendingDiscard, shortcutsOpen } from './actions';
import { Banners } from './Banners';
import { data, timerState } from './coreBridge';
import { ROUTES, route, type Route } from './router';

const NAV: Record<Route, { label: string; icon: IconName }> = {
  timer: { label: 'Timer', icon: 'timer' },
  tasks: { label: 'Tasks', icon: 'tasks' },
  stats: { label: 'Stats', icon: 'stats' },
  settings: { label: 'Settings', icon: 'settings' },
};

function Nav() {
  const running = timerState.value.status === 'running' && timerState.value.phase === 'focus';
  return (
    <nav class={`nav${running ? ' nav--dim' : ''}`} aria-label="Main">
      <a class="nav__brand" href="#/timer" aria-label="Em Time, timer">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--em-ring-track)" stroke-width="3.2" />
          <path
            d="M12 3.5a8.5 8.5 0 1 1-8.2 6.3"
            fill="none"
            stroke="var(--em-ring-fill)"
            stroke-width="3.2"
            stroke-linecap="round"
          />
        </svg>
        <span>Em Time</span>
      </a>
      <ul class="nav__tabs">
        {ROUTES.map((r) => (
          <li key={r}>
            <a
              class="nav__tab"
              href={`#/${r}`}
              data-testid={`nav-${r}`}
              aria-current={route.value === r ? 'page' : undefined}
            >
              <Icon name={NAV[r].icon} size={r === route.value ? 20 : 20} />
              <span>{NAV[r].label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function App() {
  const live = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLiveRegion(live.current);
    // Theme: data-theme on <html>, theme-color meta, and the matching gradient stops.
    const stop = effect(() => {
      const theme = data.value.settings.theme;
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#0B1220' : '#F4F9FE');
      applyGradient(theme);
    });
    return () => {
      stop();
      setLiveRegion(null);
    };
  }, []);

  const r = route.value;
  return (
    <>
      <a
        class="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} class="view" key={r}>
        <Banners />
        {r === 'timer' ? <Timer /> : r === 'tasks' ? <Tasks /> : r === 'stats' ? <Stats /> : <Settings />}
      </main>
      <div class="sr-only" aria-live="polite" role="status" data-testid="live-region" ref={live} />
      {needRefresh.value && timerState.value.status !== 'running' ? (
        <div class="updatepill" role="status">
          <span>Update ready</span>
          <button type="button" class="linkbtn" onClick={applyUpdate}>
            Refresh
          </button>
        </div>
      ) : null}
      {pendingDiscard.value ? (
        <Dialog
          title="Discard this session?"
          onClose={() => (pendingDiscard.value = null)}
          footer={
            <>
              <Button variant="text" onClick={() => (pendingDiscard.value = null)} data-autofocus>
                Keep going
              </Button>
              <Button variant="danger" onClick={confirmDiscard}>
                Discard
              </Button>
            </>
          }
        >
          <p>Your focus time so far won't be logged.</p>
        </Dialog>
      ) : null}
      {shortcutsOpen.value ? (
        <Dialog title="Keyboard shortcuts" onClose={() => (shortcutsOpen.value = false)} sheet>
          <ShortcutsList />
        </Dialog>
      ) : null}
      <ChartTooltip />
    </>
  );
}
