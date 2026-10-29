/* global document */
// Ad-hoc layout screenshots at many window sizes. Usage: node scripts/shots.mjs <outDir> [tag]
// Needs `VITE_E2E=1 npm run build` and `npm run preview` (port 4173) running.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || 'shots';
const tag = process.argv[3] || '';
mkdirSync(out, { recursive: true });

function exe() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const rel of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = join(root, dir, rel);
      if (existsSync(p)) return p;
    }
  }
}

const seed = readFileSync('tests/fixtures/backup-valid.json', 'utf8');
const d = JSON.parse(seed);
d.settings.theme = 'sky';
d.settings.noiseOn = true;
d.settings.noise = 'fireplace';
d.meta.currentTaskId = d.tasks.find((t) => !t.deletedAt && !t.done)?.id ?? null;
const shifted = (iso) => `
(() => { const R = Date; let off = ${new Date(iso).getTime()} - R.now();
const P = new Proxy(R, { construct(t, a, nt) { return a.length ? Reflect.construct(t, a, nt) : Reflect.construct(t, [R.now() + off], nt); },
apply() { return new R(R.now() + off).toString(); }, get(t, k) { return k === 'now' ? () => R.now() + off : Reflect.get(t, k); } });
window.Date = P; })();`;

const SIZES = (process.env.SIZES || '1280x800,1100x650,900x600,1000x480,700x900,600x500,480x640,420x420,390x844,360x740,330x560')
  .split(',')
  .map((s) => s.split('x').map(Number));

const browser = await chromium.launch({ executablePath: exe(), args: ['--no-sandbox'] });
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
  const page = await ctx.newPage();
  await page.addInitScript(shifted('2026-10-14T12:30:00-07:00'));
  await page.addInitScript((text) => {
    localStorage.setItem('em-time:data', text);
    localStorage.setItem('em-time:ui', JSON.stringify({ lastWaveDay: '2026-10-14' }));
    localStorage.setItem('em-time:stopwatch', JSON.stringify({ startedAt: null, accumulatedMs: 754000 }));
  }, JSON.stringify(d));
  await page.goto('http://localhost:4173/em-time/?e2e#/timer');
  await page.waitForSelector('[data-testid="timer-digits"]');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `t${tag}-${w}x${h}.png`), animations: 'disabled' });
  const info = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    };
    return {
      scrollH: document.documentElement.scrollHeight,
      bubble: r('[data-testid="timer-bubble"]'),
      modes: r('.modes'),
      chip: r('[data-testid="noise-chip"]'),
      sw: r('[data-testid="stopwatch"]'),
      play: r('[data-testid="timer-play"]'),
    };
  });
  console.log(`${w}x${h}`, JSON.stringify(info));
  await ctx.close();
}
await browser.close();
