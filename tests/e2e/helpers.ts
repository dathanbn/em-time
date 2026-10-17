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
  /** With `clock`: hold the fake clock still after install, so nothing time-boxed (the 1.8 s wave) expires while a slow machine loads the page. Advance with `page.clock.runFor`. */
  freeze?: boolean;
  /** Hash route to open. */
  route?: 'timer' | 'tasks' | 'stats' | 'settings';
  /** Stub Notification, AudioContext, wake lock and storage.persist so hooks can be asserted. */
  stubs?: boolean;
  /** Expose window.__emCore (adds ?e2e). */
  core?: boolean;
  /** Extra init scripts evaluated before the app. */
  init?: string;
  /** v2: seeds the sticker randomness (?e2e&seed=N, honoured only by the VITE_E2E build). */
  rng?: number;
  /** v2: mark today's cloud-friend wave as already played, so the mascot starts in its plain state. */
  calm?: boolean;
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

/** The first open of each study day waves (D-61). This marks today as already waved, in the page's (fake) clock. */
const CALM = `
(() => { try {
  const d = new Date(); const s = new Date(d.getTime() - (d.getHours() < 6 ? 86400000 : 0)); const p = (n) => String(n).padStart(2, '0');
  localStorage.setItem('em-time:ui', JSON.stringify({ lastWaveDay: s.getFullYear() + '-' + p(s.getMonth() + 1) + '-' + p(s.getDate()) }));
} catch (e) {} })();
`;

export async function boot(page: Page, opts: BootOptions = {}): Promise<void> {
  if (opts.clock) {
    const at = opts.clock === true ? NOW : opts.clock;
    await page.clock.install({ time: at });
    if (opts.freeze) await page.clock.pauseAt(new Date(at.getTime() + 1000));
  }
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
  if (opts.calm) await page.addInitScript(CALM);
  if (opts.init) await page.addInitScript(opts.init);
  const q = opts.core === false ? '' : `?e2e${opts.rng !== undefined ? `&seed=${opts.rng}` : ''}`;
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

// ------------------------------------------------------------------------------------------ v2 helpers

export type Route = 'timer' | 'tasks' | 'stats' | 'settings';
export const ROUTES: Route[] = ['timer', 'tasks', 'stats', 'settings'];

/** A local time on the fixture day (Wed 14 Oct 2026, Pacific daylight time). */
export const atTime = (hhmm: string, day = '2026-10-14'): Date => new Date(`${day}T${hhmm}:00-07:00`);

/** The keyframe times of design.md 2.1 with their ids. */
export const KEYFRAME_TIMES: Array<[string, string]> = [
  ['02:30', 'latenight'], ['06:00', 'dawn'], ['08:30', 'morning'], ['12:30', 'midday'],
  ['16:00', 'afternoon'], ['18:30', 'dusk'], ['20:30', 'evening'], ['23:00', 'night'],
];

/** The v1 fixture lifted to a v2 document, with settings overrides. */
export function v2doc(settings: Record<string, unknown> = {}, over: Record<string, unknown> = {}): any {
  const d = fixture('backup-valid.json');
  return {
    ...d,
    schemaVersion: 2,
    settings: { ...d.settings, theme: 'sky', displayName: 'Em', mascot: true, stickers: true, ...settings },
    ...over,
  };
}

/** A computed custom property of <html>, trimmed. */
export const rootVar = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** An empty-history document (first run) with settings overrides, valid under schema 2. */
export function emptyDoc(settings: Record<string, unknown> = {}): any {
  const d = v2doc(settings);
  return { ...d, sessions: [], tasks: [], meta: { ...d.meta, currentTaskId: null, milestonesShown: [] } };
}

/**
 * The fixture with its sessions replaced by `perDay` sessions on each listed day (25 min each, 10:00 PDT).
 * `days` are ISO days. Valid under the schema (UUID-shaped ids).
 */
export function docWithSessions(days: Array<[string, number]>, settings: Record<string, unknown> = {}): any {
  const d = v2doc(settings);
  const sessions: any[] = [];
  let n = 0;
  for (const [day, count] of days) {
    for (let i = 0; i < count; i++) {
      const startedAt = new Date(`${day}T${String(10 + i).padStart(2, '0')}:00:00-07:00`).getTime();
      const planned = 25 * MIN;
      sessions.push({
        id: `5e550000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`,
        createdAt: startedAt + planned, updatedAt: startedAt + planned, deletedAt: null,
        startedAt, endedAt: startedAt + planned, day, tzOffsetMin: -420,
        plannedMs: planned, focusedMs: planned, taskId: null, taskName: null, categoryId: null,
      });
    }
  }
  return { ...d, sessions, meta: { ...d.meta, milestonesShown: ['sessions-10', 'sessions-50', 'sessions-100', 'sessions-250', 'streak-7', 'streak-30'] } };
}

export const INTERACTIVE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], summary, label.check, label.radiorow';

/** Viewport-coordinate boxes of every visible interactive element that a rect intersects (document coordinates). */
export async function controlsOverlapping(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ([sel, interactive]) => {
      const out: string[] = [];
      const targets = [...document.querySelectorAll<Element>(sel as string)];
      for (const t of targets) {
        const r = t.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // the glow of the headlamp and the wave arm are outside the layout box, so use the painted bounding box
        for (const el of document.querySelectorAll<HTMLElement>(interactive as string)) {
          if (el.closest('.sr-only, [hidden], .skip, .mascot')) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if ((el as HTMLInputElement).type === 'file') continue;
          const host = el.closest('label') && el.tagName === 'INPUT' ? (el.closest('label') as HTMLElement) : el;
          const b = host.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          const hit = r.left < b.right - 0.5 && r.right > b.left + 0.5 && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5;
          if (hit) out.push(`${t.getAttribute('data-testid') ?? t.tagName} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] over ${host.tagName.toLowerCase()}[${(host.getAttribute('data-testid') || host.getAttribute('aria-label') || host.textContent || '').trim().slice(0, 24)}] [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)}x${Math.round(b.height)}]`);
        }
      }
      return out;
    },
    [selector, INTERACTIVE_SELECTOR],
  );
}
