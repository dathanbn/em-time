import { readFileSync } from 'node:fs';
import { expect, type Page, type Locator } from '@playwright/test';

/** Wed 14 Oct 2026, 15:00 PDT: the fixtures end on this day. */
export const NOW = new Date('2026-10-14T15:00:00-07:00');
export const MIN = 60_000;

const fixtureUrl = (name: string) => new URL(`../fixtures/${name}`, import.meta.url);
export const fixtureText = (name: string): string => readFileSync(fixtureUrl(name), 'utf8');
export const fixture = (name: string): any => JSON.parse(fixtureText(name));

export interface BootOptions {
  /** localStorage['em-time:data'] to start from: a fixture name, an object, or raw text. */
  seed?: string | object;
  rawSeed?: string;
  /** Install Playwright's fake clock at this time (default: not installed). */
  clock?: Date | true;
  /** Hash route to open. */
  route?: 'timer' | 'tasks' | 'stats' | 'settings';
  /** Stub Notification, AudioContext, wake lock and storage.persist so hooks can be asserted. */
  stubs?: boolean;
  /** Expose window.__emCore (adds ?e2e). */
  core?: boolean;
  /** Extra init scripts evaluated before the app. */
  init?: string;
}

/** The recorder the stubs write to; read it with `qa(page)`. */
export interface QaState {
  notifications: Array<{ title: string; body?: string; via: string }>;
  permissionRequests: number;
  chimes: Array<{ volume: number; oscillators: number }>;
  audioContexts: number;
  resumes: number;
  persistCalls: number;
  wakeLockRequests: number;
  wakeLockReleases: number;
  wakeLockActive: number;
}

const STUBS = `
(() => {
  const qa = (window.__qa = {
    notifications: [], permissionRequests: 0, chimes: [], audioContexts: 0, resumes: 0,
    persistCalls: 0, wakeLockRequests: 0, wakeLockReleases: 0, wakeLockActive: 0,
  });
  // Notification: starts at 'default' so "never on load" can be asserted
  class FakeNotification {
    static permission = 'default';
    static requestPermission() { qa.permissionRequests++; FakeNotification.permission = 'granted'; return Promise.resolve('granted'); }
    constructor(title, opts) { qa.notifications.push({ title, body: opts && opts.body, via: 'page' }); }
    close() {}
  }
  window.Notification = FakeNotification;
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
      qa.notifications.push({ title, body: opts && opts.body, via: 'sw' });
      return Promise.resolve();
    };
  }
  // Web Audio: counts chimes (a chime = a master gain connected to the destination)
  class FakeAudioContext {
    constructor() { qa.audioContexts++; this.state = 'suspended'; this.currentTime = 0; this.destination = { __dest: true }; }
    resume() { qa.resumes++; this.state = 'running'; return Promise.resolve(); }
    createGain() {
      const g = { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect(n) { if (n && n.__dest) { qa.chimes.push({ volume: g.gain.value, oscillators: 0 }); } return n; }, disconnect() {} };
      return g;
    }
    createOscillator() {
      const last = qa.chimes[qa.chimes.length - 1];
      if (last) last.oscillators++;
      return { type: 'sine', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(n) { return n; }, start() {}, stop() {} };
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
  // storage.persist
  try {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist() { qa.persistCalls++; return Promise.resolve(true); }, persisted() { return Promise.resolve(false); }, estimate() { return Promise.resolve({}); } } });
  } catch (e) {}
  // Screen Wake Lock
  try {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request() { qa.wakeLockRequests++; qa.wakeLockActive++; let released = false;
        const s = { released: false, addEventListener() {}, release() { if (!released) { released = true; qa.wakeLockReleases++; qa.wakeLockActive--; } return Promise.resolve(); } };
        return Promise.resolve(s); } } });
  } catch (e) {}
  // Page visibility switch for background tests
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  window.__qaSetHidden = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); };
})();
`;

export async function boot(page: Page, opts: BootOptions = {}): Promise<void> {
  if (opts.clock) await page.clock.install({ time: opts.clock === true ? NOW : opts.clock });
  if (opts.stubs) await page.addInitScript(STUBS);
  const seedText =
    opts.rawSeed ??
    (typeof opts.seed === 'string'
      ? fixtureText(opts.seed)
      : opts.seed
        ? JSON.stringify(opts.seed)
        : null);
  if (seedText !== null) {
    // once per tab: a reload must keep whatever the app has written since
    await page.addInitScript((text: string) => {
      if (!sessionStorage.getItem('qa-seeded')) {
        localStorage.setItem('em-time:data', text);
        sessionStorage.setItem('qa-seeded', '1');
      }
    }, seedText);
  }
  if (opts.init) await page.addInitScript(opts.init);
  const q = opts.core === false ? '' : '?e2e';
  await page.goto(`${q}#/${opts.route ?? 'timer'}`);
  await expect(page.getByTestId('nav-timer').first()).toBeVisible();
}

export const qa = (page: Page): Promise<QaState> => page.evaluate(() => (window as any).__qa as QaState);
export const setHidden = (page: Page, hidden: boolean): Promise<void> =>
  page.evaluate((h) => (window as any).__qaSetHidden(h), hidden);

/** Reads the persisted document straight from localStorage. */
export const stored = (page: Page): Promise<any> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('em-time:data') || 'null'));

export const sessionsOf = async (page: Page): Promise<any[]> => (await stored(page))?.sessions ?? [];

export const go = async (page: Page, route: 'timer' | 'tasks' | 'stats' | 'settings'): Promise<void> => {
  await page.getByTestId(`nav-${route}`).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
};

export const visible = (loc: Locator): Locator => loc.filter({ visible: true });

export const isMobile = (project: { name: string }): boolean => project.name.startsWith('mobile');

/** Presses Play and lets a whole focus phase run on the fake clock. */
export async function runFocus(page: Page, minutes = 25): Promise<void> {
  await page.getByTestId('timer-play').click();
  await page.clock.fastForward(minutes * MIN + 250);
}
