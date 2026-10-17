import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { ChartTooltip } from '../charts/Tooltip';
import { Dialog } from '../components/Dialog';
import { Mascot } from '../components/Mascot';
import { Scene } from '../components/Scene';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/ui';
import { setLiveRegion } from '../platform/announce';
import { applyUpdate, needRefresh } from '../platform/pwa';
import { refreshSky } from '../platform/sky';
import { startStickers } from '../platform/stickers';
import { ShortcutsList, Settings } from '../screens/Settings';
import { Stats } from '../screens/Stats';
import { Tasks } from '../screens/Tasks';
import { Timer } from '../screens/Timer';
import { confirmDiscard, pendingDiscard, shortcutsOpen } from './actions';
import { Banners } from './Banners';
import { data, timerState } from './coreBridge';
import { ROUTES, route, type Route } from './router';
import { skyPolarity } from './skySignals';
import { getPicker, rng } from './stickerRuntime';

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
        <Mascot state="idle" dark={skyPolarity.value === 'dark'} size={36} class="mascot--still" testid="mascot-glyph" />
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
              <Icon name={NAV[r].icon} size={20} />
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
    // A theme change re-runs the sky right away (platform/sky.ts also ticks once a minute).
    let first = true;
    const stopTheme = effect(() => {
      void data.value.settings.theme;
      if (first) first = false;
      else refreshSky();
    });
    // Drifting stickers follow the "Sky stickers" setting.
    const stopStickers = effect(() => {
      if (!data.value.settings.stickers) return;
      const picker = getPicker();
      const layer = document.querySelector<HTMLElement>('[data-testid="sticker-layer"]');
      if (!picker || !layer) return;
      return startStickers({
        layer,
        picker,
        rng,
        isFocusRunning: () => timerState.value.status === 'running' && timerState.value.phase === 'focus',
        isNarrow: () => window.matchMedia('(max-width: 899px)').matches,
      });
    });
    return () => {
      stopTheme();
      stopStickers();
      setLiveRegion(null);
    };
  }, []);

  const r = route.value;
  return (
    <>
      <Scene />
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
