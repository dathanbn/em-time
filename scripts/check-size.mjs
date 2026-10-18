// Fails the build when the initial JS (the entry chunk and everything it imports eagerly)
// exceeds the budget from docs/architecture.md section 1 (60 KB, raised to 62 KB in v5 and 64 KB in v6): gzipped. Also reports the lazy
// sync chunk and CSS.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET = 64 * 1024; // 60 KB, then 62 KB for the v5 stopwatch and glass, 64 KB for v6 friends (docs/friends-spec.md section 3.4)
const CSS_BUDGET = 16 * 1024; // raised from 12 KB for the sky scene, mascot and glass styles (design.md 11)
const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const scripts = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="[^"]*?(assets\/[^"]+\.js)"/g)].map(
  (m) => m[1],
);
if (scripts.length === 0) {
  console.error('check-size: no entry script found in dist/index.html');
  process.exit(1);
}
let initial = 0;
for (const f of scripts) initial += gz(f);

const assets = readdirSync(join(dist, 'assets'));
const css = assets.filter((f) => f.endsWith('.css')).reduce((n, f) => n + gz(`assets/${f}`), 0);
const lazy = assets.filter((f) => f.endsWith('.js') && !scripts.includes(`assets/${f}`));

console.log(`initial JS: ${kb(initial)} gzipped (budget ${kb(BUDGET)})  CSS: ${kb(css)} (budget ${kb(CSS_BUDGET)})`);
for (const f of lazy) console.log(`  lazy chunk ${f}: ${kb(gz(`assets/${f}`))} gzipped`);
if (initial > BUDGET) {
  console.error('check-size: initial JS is over budget');
  process.exit(1);
}
if (css > CSS_BUDGET) {
  console.error('check-size: CSS is over budget');
  process.exit(1);
}
