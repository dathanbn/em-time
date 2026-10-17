// v5 clear glass: the token contract of docs/v5-spec.md section 1 that no browser test can reach
// (the no-backdrop-filter fallback and the forced-colors block), plus the "no !important" rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tokenBlock, tokensCss } from './colorMath';

const css = tokensCss();
const style = (f: string) => readFileSync(new URL(`../../frontend/src/styles/${f}`, import.meta.url), 'utf8');

/** The body of the first `@rule {` block that starts with `head`, braces balanced. */
function atBlock(src: string, head: string, last = false): string {
  const i = last ? src.lastIndexOf(`\n${head}`) + 1 : src.indexOf(head);
  if (i < 0) throw new Error(`no ${head} block`);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}' && --depth === 0) return src.slice(open + 1, k);
  }
  throw new Error('unbalanced');
}

describe('glass tokens (v5)', () => {
  const light = tokenBlock(css, ':root');
  const dark = tokenBlock(css, ":root[data-theme='dark']");
  const NAMES = ['--lg-fill', '--lg-rim', '--lg-blur', '--lg-depth', '--lg-bead', '--lg-bead-depth', '--lg-hover', '--lg-ink'];

  it('light lives in :root and dark in :root[data-theme=dark], every token of the spec in both', () => {
    for (const n of NAMES) {
      expect(light[n], `${n} in :root`).toBeTruthy();
      expect(dark[n], `${n} in dark`).toBeTruthy();
    }
    expect(light['--lg-rim']).toBe('rgba(255, 255, 255, 0.45)');
    expect(dark['--lg-rim']).toBe('rgba(255, 255, 255, 0.2)');
    expect(light['--lg-hover']).toBe('rgba(255, 255, 255, 0.22)');
    expect(dark['--lg-hover']).toBe('rgba(255, 255, 255, 0.08)');
  });

  it('without backdrop-filter the glass becomes an opaque pill with the card ink, in both polarities', () => {
    const block = atBlock(css, '@supports not');
    const l = tokenBlock(block, ':root');
    const d = tokenBlock(block, ":root[data-theme='dark']");
    for (const t of [l, d]) {
      expect(t['--lg-fill']).toMatch(/0\.9\d?\)/); // at least 90% opaque
      expect(t['--lg-ink']).toBe('var(--em-ink)');
      expect(t['--lg-ink-low']).toBe('var(--em-ink)');
      expect(t['--lg-scrim']).toBe('transparent');
      expect(t['--lg-scrim-low']).toBe('transparent');
      expect(t['--lg-bead']).toBe('var(--em-accent-soft)'); // the selected option stays visible without the glass
    }
    expect(l['--lg-blur']).toBe('none');
  });

  it('forced colors: Canvas fill, CanvasText ink and rim, Highlight bead', () => {
    const t = tokenBlock(atBlock(css, '@media (forced-colors: active)'), ':root');
    expect(t['--lg-fill']).toContain('Canvas');
    expect(t['--lg-ink']).toBe('CanvasText');
    expect(t['--lg-rim']).toBe('CanvasText');
    expect(t['--lg-bead']).toBe('Highlight');
  });

  it('no !important in tokens, components or screens (the glass is real rules, not an override)', () => {
    for (const f of ['tokens.css', 'components.css', 'screens.css']) expect(style(f), f).not.toContain('!important');
  });

  it('every glass container reads the tokens: .modes, the desktop .nav__tabs, .nchip and .swpill', () => {
    const screens = style('screens.css');
    const comps = style('components.css');
    for (const sel of ['.modes {', '.nchip {', '.swpill {']) {
      const body = atBlock(screens, sel, true);
      expect(body, sel).toContain('var(--lg-base)');
      expect(body, sel).toMatch(/backdrop-filter: var\(--lg-blur\)/);
      expect(body, sel).toContain('var(--lg-rim)');
      expect(body, sel).toContain('var(--lg-depth)');
    }
    // the desktop tabs: the only glass rules in components.css, inside a >= 900px query
    const at = comps.indexOf('/* Clear liquid glass: the tabs');
    expect(at).toBeGreaterThan(0);
    const tabs = comps.slice(at, at + 600);
    expect(tabs).toContain('background: var(--lg-base)');
    expect(tabs).toContain('backdrop-filter: var(--lg-blur)');
    expect(tabs).toContain('box-shadow: var(--lg-depth)');
    expect(comps.slice(comps.lastIndexOf('@media (min-width: 900px)', at), at)).not.toContain('}\n}'); // still the same query
  });
});
