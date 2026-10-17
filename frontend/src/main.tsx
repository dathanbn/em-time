import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/scene.css';
import { createEmCore, type Copy, type EmCore } from '@core';
import messages from './data/messages.json';
import { App } from './app/App';
import { initPhaseEffects } from './app/actions';
import { initNoise } from './app/noise';
import { initBridge, core, timerState } from './app/coreBridge';
import { initRouter } from './app/router';
import { initPwa } from './platform/pwa';
import { startSky } from './platform/sky';
import { skyPolarity } from './app/skySignals';
import { initFirstOpenWave } from './app/mascotState';
import { initShortcuts } from './platform/shortcuts';
import { initTitle } from './platform/title';
import { initWakeLock } from './platform/wakeLock';
import { shortcutsOpen, skip, reset, switchMode, toggleNoise, togglePlay } from './app/actions';

async function boot(): Promise<void> {
  const copy = messages as unknown as Copy;
  let em: EmCore;
  // Dev only: ?stub runs the real core on fixture data and memory storage.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('stub')) {
    const { createStubCore } = await import('@core/stub');
    em = createStubCore({ copy, empty: new URLSearchParams(location.search).get('stub') === 'empty' });
  } else {
    em = createEmCore({ copy });
  }
  // Test hook: in dev, or in a build made with VITE_E2E=1 when the URL has ?e2e. Never in a normal build.
  if (import.meta.env.DEV || (import.meta.env.VITE_E2E === '1' && new URLSearchParams(location.search).has('e2e'))) {
    (window as unknown as { __emCore: EmCore }).__emCore = em;
  }

  initBridge(em);
  initRouter();
  initPhaseEffects();
  initNoise();
  initTitle();
  initWakeLock();
  startSky(
    () => core.store.get().settings.theme,
    (s) => {
      skyPolarity.value = s.polarity;
    },
  );
  initShortcuts({
    toggle: togglePlay,
    skip,
    reset,
    noise: toggleNoise,
    mode: switchMode,
    help: () => {
      shortcutsOpen.value = true;
    },
  });
  initPwa();
  void timerState.value;

  const root = document.getElementById('app')!;
  render(<App />, root);
  initFirstOpenWave();
  document.getElementById('boot')?.remove();
}

void boot();
