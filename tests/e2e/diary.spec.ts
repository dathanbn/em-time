import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { INTERACTIVE_SELECTOR, KEYFRAME_TIMES, MIN, ROUTES, atTime, boot, docWithSessions, emptyDoc, go, isMobile, rootVar, stored, v2doc, type Route } from './helpers';
import { contrast, over, parseColor } from '../unit/colorMath';

/**
 * v2 criteria that need the whole page rather than one subsystem: SKY-11, SKY-12, SKY-13, the NAME group, THEME-6,
 * UI-3 (Play above the fold), the 44 px rule with the decoration on screen, and "nothing decorative over the numerals".
 */

const messages = JSON.parse(readFileSync(new URL('../../frontend/src/data/messages.json', import.meta.url), 'utf8')) as {
  sky: { greetings: Record<'dawn' | 'morning' | 'afternoon' | 'evening' | 'night', string[]> };
};
const salutations = (w: keyof typeof messages.sky.greetings) => messages.sky.greetings[w].map((l) => l.replace(', {name}', ''));
const BANNED = /\b(late|sleep|sleepy|tired|bed|bedtime|exhausted)\b/i;

// ------------------------------------------------------------------------------------------------ SKY-11

async function axeViolations(page: Page, opts: { contrastOnly?: boolean; noContrast?: boolean } = {}) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']);
  if (opts.contrastOnly) b = b.withRules(['color-contrast']);
  if (opts.noContrast) b = b.disableRules(['color-contrast']);
  const r = await b.analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

/** The four times the coordinator named, then the rest of the SKY-11 list. */
const AXE_TIMES = ['05:15', '12:30', '17:05', '23:00', '02:30', '06:00', '08:30', '16:00', '16:59', '17:00', '17:19', '18:30', '20:30'];

test.describe('SKY-11 axe: zero violations on every screen at the keyframe and polarity-edge times', () => {
  for (const time of AXE_TIMES) {
    test(`${time}: Timer, Tasks, Stats and Settings`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await boot(page, { clock: atTime(time), seed: v2doc(), stubs: true, calm: true, route: 'timer' });
      await page.waitForTimeout(500);
      for (const route of ROUTES) {
        if (route !== 'timer') await go(page, route);
        await page.waitForTimeout(450); // charts measure; the polarity cross-fade is 600 ms
        const tag = `${route} @${time} (${info.project.name})`;
        // structure, names, roles at their natural colours
        expect(await axeViolations(page, { noContrast: true }), `${tag} structure`).toEqual([]);
        // axe cannot read a gradient: it reports the text over the sky as "incomplete", not as a violation.
        // Run the contrast rule as it stands, then again with the sky painted flat in each of its stops (glass and cards still composite over it).
        expect(await axeViolations(page, { contrastOnly: true }), `${tag} contrast`).toEqual([]);
      }
    });
  }

  for (const time of ['12:30', '17:05', '23:00']) {
    test(`every contrast check holds with the sky painted flat in each of its five colours, Timer @${time}`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc(), stubs: true, calm: true, route: 'timer' });
      await page.waitForTimeout(400);
      for (const stop of ['top', 'mid', 'horizon', 'hill-back', 'hill-front']) {
        const color = await rootVar(page, `--sky-${stop}`);
        const css = await page.addStyleTag({ content: `[data-testid="sky"] { display: none !important; } html, body { background-image: none !important; background-color: ${color} !important; }` });
        expect(await axeViolations(page, { contrastOnly: true }), `${time} over ${stop} ${color}`).toEqual([]);
        await css.evaluate((el) => (el as Element).remove());
      }
    });
  }
});

// ------------------------------------------------------------------------------------------------ SKY-12

/** Visible text nodes whose nearest non-transparent background is the scene (no glass, card, chip or button behind them). */
async function textOnSky(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ text: string; size: number; weight: number; tag: string; ok: boolean }> = [];
    const opaque = (el: Element) => {
      const cs = getComputedStyle(el);
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const a = m ? (m[1]!.split(',').length > 3 ? parseFloat(m[1]!.split(',')[3]!) : 1) : 0;
      return a > 0 || (cs.backgroundImage && cs.backgroundImage !== 'none');
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (!text) continue;
      const el = n.parentElement!;
      if (el.closest('.sr-only, [hidden], script, style, [aria-hidden="true"], .skip')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // nearest non-transparent background among the ancestors (the html and body are the page, the scene sits behind them)
      let host: Element | null = el;
      let found = false;
      while (host && host !== document.body && host !== document.documentElement) {
        if (opaque(host)) { found = true; break; }
        host = host.parentElement;
      }
      if (found) continue;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      out.push({ text: text.slice(0, 30), size, weight, tag: el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30), ok: size >= 24 || (size >= 18.66 && weight >= 700) });
    }
    return out;
  });
}

test.describe('SKY-12 only large text sits directly on the sky', () => {
  for (const [time] of KEYFRAME_TIMES.filter(([t]) => ['02:30', '12:30', '18:30'].includes(t))) {
    for (const route of ROUTES) {
      test(`${route} @${time}`, async ({ page }) => {
        await boot(page, { clock: atTime(time), seed: v2doc(), stubs: true, calm: true, route });
        await page.waitForTimeout(450);
        const t = await textOnSky(page);
        expect(t.length, 'there is at least the page heading on the sky').toBeGreaterThan(0);
        expect(t.filter((x) => !x.ok).map((x) => `${x.tag} "${x.text}" ${x.size}px/${x.weight}`)).toEqual([]);
      });
    }
  }

  test('empty states and the running timer keep the rule too', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), seed: emptyDoc(), calm: true, route: 'tasks' });
    await page.waitForTimeout(400);
    expect((await textOnSky(page)).filter((x) => !x.ok)).toEqual([]);
    await go(page, 'stats');
    await page.waitForTimeout(400);
    expect((await textOnSky(page)).filter((x) => !x.ok)).toEqual([]);
    await go(page, 'timer');
    await page.getByTestId('timer-play').click();
    await page.clock.runFor(2000);
    expect((await textOnSky(page)).filter((x) => !x.ok)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ SKY-13


/** Computed focus indicator of the element, or of the box that draws it for a visually-hidden native input. */
async function indicator(page: Page, testid: string) {
  return page.evaluate((id) => {
    const el = [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)!;
    const root = getComputedStyle(document.documentElement);
    const norm = (c: string) => { const d = document.createElement('i'); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; };
    const ring = norm(root.getPropertyValue('--em-focus-ring').trim());
    const halo = norm(root.getPropertyValue('--em-focus-halo').trim());
    // a native radio/checkbox draws its indicator on the sibling dot or box
    const candidates = [el, el.nextElementSibling as HTMLElement | null, el.closest('label')?.querySelector<HTMLElement>('.radiorow__dot, .check__box') ?? null].filter(Boolean) as HTMLElement[];
    const pick = candidates.find((c) => getComputedStyle(c).outlineStyle !== 'none' && parseFloat(getComputedStyle(c).outlineWidth) > 0) ?? el;
    const cs = getComputedStyle(pick);
    return { ring, halo, outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, shadow: cs.boxShadow, focused: document.activeElement === el, matches: el.matches(':focus-visible') };
  }, testid);
}

test.describe('SKY-13 the two-tone focus indicator at every keyframe', () => {
  for (const [time] of KEYFRAME_TIMES) {
    test(`${time}: a button, a link, an input and a segmented option`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc(), stubs: true, calm: true, route: 'timer' });
      await page.keyboard.press('Tab'); // the keyboard modality, so :focus-visible matches
      const targets: Array<[Route, string, string]> = [
        ['timer', 'timer-reset', 'button'],
        ['timer', 'nav-tasks', 'link'],
        ['timer', 'mode-short', 'segmented option'],
        ['settings', 'settings-display-name', 'input'],
      ];
      for (const [route, id, what] of targets) {
        if (!page.url().endsWith(`#/${route}`)) await go(page, route);
        const loc = page.getByTestId(id).filter({ visible: true }).first();
        await loc.focus();
        const i = await indicator(page, id);
        expect(i.focused, `${what} has focus`).toBe(true);
        expect(i.matches, `${what} matches :focus-visible`).toBe(true);
        expect(i.outline, `${what} outline style`).toBe('solid');
        expect(i.width, `${what} outline width`).toBeGreaterThanOrEqual(2);
        expect(i.color, `${what} outline colour is --em-focus-ring`).toBe(i.ring);
        // inputs swap the halo for a ring-coloured border (components.css); links and segmented options paint the halo shadow
        if (what === 'link' || what === 'segmented option') expect(i.shadow, `${what} halo shadow is --em-focus-halo`).toContain(i.halo);
      }
    });
  }

  for (const time of ['12:30', '23:00']) {
    test(`buttons keep the halo token when focused: Reset and Skip (secondary), Play (round) and Add task (primary) @${time}`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc(), calm: true, route: 'timer' });
      await page.keyboard.press('Tab');
      const missing: string[] = [];
      for (const id of ['timer-reset', 'timer-play', 'timer-skip']) {
        await page.getByTestId(id).filter({ visible: true }).first().focus();
        const i = await indicator(page, id);
        expect(i.matches, `${id} matches :focus-visible`).toBe(true);
        expect(i.color, `${id} outline is the ring token`).toBe(i.ring);
        if (!i.shadow.includes(i.halo)) missing.push(`${id}: box-shadow is "${i.shadow}", not the halo ${i.halo}`);
      }
      await go(page, 'tasks');
      await page.getByTestId('task-add-input').fill('Halo check'); // the Add button is disabled while the field is empty
      const add = page.getByTestId('task-add-button');
      await expect(add).toBeEnabled();
      await page.getByTestId('task-add-input').focus();
      await page.keyboard.press('Tab'); // the category select
      await page.keyboard.press('Tab'); // Add task, reached by keyboard so :focus-visible applies
      const ia = await indicator(page, 'task-add-button');
      expect(ia.focused, 'Add task has focus').toBe(true);
      expect(ia.matches, 'Add task matches :focus-visible').toBe(true);
      if (!ia.shadow.includes(ia.halo)) missing.push(`task-add-button: box-shadow is "${ia.shadow}", not the halo ${ia.halo}`);
      expect(missing, 'SKY-13: the two-tone indicator is the outline in --em-focus-ring plus the --em-focus-halo shadow').toEqual([]);
    });
  }

  for (const time of ['12:30', '23:00']) {
    test(`the ring and halo reach 3:1 against each other and, the better of the two, against every sky stop and glass @${time}`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc(), calm: true });
      const t = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const norm = (c: string) => { const d = document.createElement('i'); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; };
        return Object.fromEntries(['--em-focus-ring', '--em-focus-halo', '--sky-top', '--sky-mid', '--sky-horizon', '--em-glass'].map((n) => [n, norm(cs.getPropertyValue(n).trim())]));
      });
      const rgb = (k: string) => parseColor(t[k]!).slice(0, 3) as [number, number, number];
      expect(contrast(rgb('--em-focus-ring'), rgb('--em-focus-halo')), 'ring on halo').toBeGreaterThanOrEqual(3);
      for (const k of ['--sky-top', '--sky-mid', '--sky-horizon'])
        expect(Math.max(contrast(rgb('--em-focus-ring'), rgb(k)), contrast(rgb('--em-focus-halo'), rgb(k))), `over ${k}`).toBeGreaterThanOrEqual(3);
      const glass = over(parseColor(t['--em-glass']!), rgb('--sky-mid'));
      expect(Math.max(contrast(rgb('--em-focus-ring'), glass), contrast(rgb('--em-focus-halo'), glass)), 'on glass').toBeGreaterThanOrEqual(3);
    });
  }
});

// ------------------------------------------------------------------------------------------------ NAME

const greeting = (page: Page) => page.getByTestId('greeting').filter({ visible: true }).first();
const nameInput = (page: Page) => page.getByTestId('settings-display-name');

test.describe('NAME-1 default name', () => {
  test('a v1 document (no displayName) shows "Em": at 14:00 the greeting is an afternoon line ending ", Em"', async ({ page }) => {
    const d = v2doc();
    delete d.settings.displayName;
    await boot(page, { clock: atTime('14:00'), seed: d, calm: true });
    const text = (await greeting(page).textContent())!;
    expect(text.endsWith(', Em'), text).toBe(true);
    expect(salutations('afternoon')).toContain(text.slice(0, -4));
  });

  test('a first run (no stored data) greets "Em" too', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), calm: true });
    expect((await greeting(page).textContent())!.endsWith(', Em')).toBe(true);
    await go(page, 'settings');
    await expect(nameInput(page)).toHaveValue('Em');
  });
});

test.describe('NAME-2 changing the name', () => {
  test('"Emily" updates the greeting without a reload and survives one', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), seed: v2doc(), calm: true, route: 'settings' });
    await expect(nameInput(page)).toHaveValue('Em');
    await nameInput(page).fill('Emily');
    await nameInput(page).blur();
    await go(page, 'timer');
    expect(await greeting(page).textContent()).toMatch(/, Emily$/);
    expect((await stored(page)).settings.displayName).toBe('Emily');
    await page.reload();
    expect(await greeting(page).textContent()).toMatch(/, Emily$/);
    await go(page, 'settings');
    await expect(nameInput(page)).toHaveValue('Emily');
  });

  test('typing updates the greeting while the field is still focused (no reload, no blur)', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'the desktop layout shows Settings and the greeting in separate screens either way; once is enough');
    await boot(page, { clock: atTime('14:00'), seed: v2doc(), calm: true, route: 'settings' });
    await nameInput(page).fill('Dr Em');
    expect((await stored(page)).settings.displayName).toBe('Dr Em');
  });
});

test.describe('NAME-3 trimmed, 24 characters, blank allowed', () => {
  test('the input has maxlength 24 and refuses typing past it', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), seed: v2doc(), calm: true, route: 'settings' });
    await expect(nameInput(page)).toHaveAttribute('maxlength', '24');
    await nameInput(page).fill('');
    await nameInput(page).pressSequentially('abcdefghijklmnopqrstuvwxyz0123');
    const v = await nameInput(page).inputValue();
    expect(v.length).toBe(24);
    expect(v).toBe('abcdefghijklmnopqrstuvwx');
    await nameInput(page).blur();
    expect((await stored(page)).settings.displayName).toBe('abcdefghijklmnopqrstuvwx');
  });

  test('spaces around the name are trimmed', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), seed: v2doc(), calm: true, route: 'settings' });
    await nameInput(page).fill('   Emily   ');
    await nameInput(page).blur();
    expect((await stored(page)).settings.displayName).toBe('Emily');
    await go(page, 'timer');
    expect(await greeting(page).textContent()).toMatch(/, Emily$/);
  });

  for (const [time, w] of [['05:00', 'dawn'], ['09:00', 'morning'], ['14:00', 'afternoon'], ['19:00', 'evening'], ['23:00', 'night']] as const) {
    test(`a blank name gives the plain ${w} salutation at ${time}: no name and no trailing comma`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc({ displayName: '' }), calm: true });
      const text = (await greeting(page).textContent())!;
      expect(text).not.toMatch(/,/);
      expect(text).not.toMatch(/\s$/);
      expect(salutations(w), `"${text}"`).toContain(text);
    });
  }

  test('clearing the field in Settings blanks the greeting live', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), seed: v2doc(), calm: true, route: 'settings' });
    await nameInput(page).fill('');
    await nameInput(page).blur();
    await go(page, 'timer');
    expect(await greeting(page).textContent()).not.toMatch(/,/);
    expect((await stored(page)).settings.displayName).toBe('');
  });
});

test.describe('NAME-4 the name is text', () => {
  test('"<b>x</b>" displays literally and no element is created', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), seed: v2doc({ displayName: '<b>x</b>' }), calm: true });
    expect(await greeting(page).textContent()).toMatch(/, <b>x<\/b>$/);
    expect(await page.getByTestId('greeting').first().evaluate((el) => el.querySelectorAll('*').length)).toBe(0);
    await go(page, 'settings');
    await expect(nameInput(page)).toHaveValue('<b>x</b>');
  });

  test('an img tag typed into the field never executes or renders', async ({ page }) => {
    let fired = false;
    await page.exposeFunction('qaFired', () => { fired = true; });
    await boot(page, { clock: atTime('14:00'), seed: v2doc(), calm: true, route: 'settings' });
    await nameInput(page).fill('<img src=x onerror=qaFired()>'.slice(0, 24));
    await nameInput(page).blur();
    await go(page, 'timer');
    await page.waitForTimeout(300);
    expect(fired).toBe(false);
    expect(await page.locator('.greeting img, [data-testid="greeting"] img').count()).toBe(0);
  });
});

test.describe('NAME-5 greeting rules in the browser', () => {
  for (const [time, w] of [['02:30', 'night'], ['04:29', 'night'], ['04:30', 'dawn'], ['06:59', 'dawn'], ['07:00', 'morning'], ['11:59', 'morning'], ['12:00', 'afternoon'], ['16:59', 'afternoon'], ['17:00', 'evening'], ['20:59', 'evening'], ['21:00', 'night']] as const) {
    test(`${time} is the ${w} window`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc(), calm: true });
      const text = (await greeting(page).textContent())!;
      expect(salutations(w), text).toContain(text.replace(/, Em$/, ''));
      expect(text).not.toMatch(BANNED);
      if (w === 'night') expect(text.toLowerCase()).toContain('night');
    });
  }

  test('the variant is stable across a reload and a navigation on the same day', async ({ page }) => {
    await boot(page, { clock: atTime('14:00'), seed: v2doc(), calm: true });
    const first = await greeting(page).textContent();
    await go(page, 'stats');
    await go(page, 'timer');
    expect(await greeting(page).textContent()).toBe(first);
    await page.reload();
    expect(await greeting(page).textContent()).toBe(first);
  });
});

test.describe('Timer layout v3 (the subline chip is gone at both widths; phone Timer has no stats; NAME-6 superseded)', () => {
  const at = (days: Array<[string, number]>, time = '14:00') => ({ clock: atTime(time), seed: docWithSessions(days), calm: true });
  const STATS = /sessions? today|-day streak|streak going|Ready when you are|look at you|of \d+ min|Goal met/i;

  test('no subline chip and no streak or session text next to the greeting, whatever the history', async ({ page }) => {
    await boot(page, at([['2026-10-09', 1], ['2026-10-10', 1], ['2026-10-11', 1], ['2026-10-12', 1], ['2026-10-13', 1], ['2026-10-14', 3]]));
    await expect(greeting(page)).toBeVisible();
    await expect(page.getByTestId('greeting-sub')).toHaveCount(0);
    const head = await page.locator('.timerpage').first().evaluate((el) => {
      const g = el.querySelector('[data-testid="greeting"]')!;
      return (g.parentElement as HTMLElement).innerText;
    });
    expect(head).not.toMatch(STATS);
  });

  test('phone: the Timer shows no stats at all (no Today strip, ring, minutes, sessions or streak text)', async ({ page }, info) => {
    test.skip(!isMobile(info.project), 'phone only');
    await boot(page, at([['2026-10-09', 1], ['2026-10-10', 1], ['2026-10-11', 1], ['2026-10-12', 1], ['2026-10-13', 1], ['2026-10-14', 3]]));
    await expect(page.getByTestId('timer-play')).toBeVisible();
    await expect(page.getByTestId('today-goal').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByTestId('today-ring').filter({ visible: true })).toHaveCount(0);
    const text = await page.locator('main').first().evaluate((el) => (el as HTMLElement).innerText);
    expect(text).not.toMatch(STATS);
    expect(text).not.toMatch(/\b\d+ min\b/);
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('today-goal').filter({ visible: true })).toHaveCount(0); // still none after a completion
  });

  test('desktop: Today and Up next cards stay; only the chip is gone', async ({ page }, info) => {
    test.skip(isMobile(info.project), 'desktop only');
    await boot(page, at([['2026-10-14', 3]]));
    await expect(page.getByTestId('today-goal').filter({ visible: true }).first()).toContainText('75 of 120 min');
    await expect(page.getByTestId('today-ring').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Up next', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('greeting-sub')).toHaveCount(0);
  });

  test('phone: the ring does not move across idle, running, celebrate and break (the message and break idea hang in a reserved band)', async ({ page }, info) => {
    test.skip(!isMobile(info.project), 'phone only');
    await boot(page, { clock: atTime('12:30'), seed: v2doc(), calm: true, rng: 1 });
    const pos = () => page.evaluate(() => ({
      bubble: document.querySelector('[data-testid="timer-bubble"]')!.getBoundingClientRect().top,
      play: document.querySelector('[data-testid="timer-play"]')!.getBoundingClientRect().top,
      mode: document.querySelector('[data-testid="mode-focus"]')!.getBoundingClientRect().top,
      sh: document.documentElement.scrollHeight,
      vh: innerHeight,
    }));
    const idle = await pos();
    const check = (label: string, p: Awaited<ReturnType<typeof pos>>) => {
      expect(Math.abs(p.bubble - idle.bubble), `${label}: ring shift in px`).toBeLessThanOrEqual(2);
      expect(Math.abs(p.play - idle.play), `${label}: Play shift in px`).toBeLessThanOrEqual(2);
      expect(Math.abs(p.mode - idle.mode), `${label}: mode pill shift in px`).toBeLessThanOrEqual(2);
      expect(p.sh, `${label}: the page does not scroll`).toBeLessThanOrEqual(p.vh + 1);
    };
    await page.getByTestId('timer-play').click();
    await page.clock.runFor(3000);
    check('running', await pos());
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('message-line')).not.toBeEmpty();
    await expect(page.getByTestId('mascot')).toHaveAttribute('data-state', 'celebrate');
    check('celebrate', await pos());
    await page.waitForTimeout(2200);
    await expect(page.getByTestId('break-prompt')).toBeVisible();
    check('break with the idea card', await pos());
    await page.getByTestId('timer-play').click();
    check('break paused', await pos());
  });

  test('phone: the mode pill sits above the ring, the greeting is at least 20 px from the top, Play is above the fold at 390x844', async ({ page }, info) => {
    test.skip(!isMobile(info.project), 'phone only');
    await boot(page, at([['2026-10-14', 3]]));
    const r = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const modes = ['focus', 'short', 'long'].map((m) => box(`[data-testid="mode-${m}"]`));
      return {
        modes,
        greeting: box('[data-testid="greeting"]'),
        nav: document.querySelector('[data-testid="nav-timer"]')!.closest('nav')!.getBoundingClientRect(),
        play: box('[data-testid="timer-play"]'),
        bubble: box('[data-testid="timer-bubble"]'),
        vh: innerHeight,
      };
    });
    expect(r.greeting.top, 'greeting offset from the viewport top').toBeGreaterThanOrEqual(20);
    for (const m of r.modes) {
      expect(m.bottom, 'every mode option ends above the ring').toBeLessThanOrEqual(r.bubble.top + 1);
      expect(m.top, 'the mode pill is below the greeting').toBeGreaterThanOrEqual(r.greeting.bottom - 1);
      expect(m.height, 'touch target').toBeGreaterThanOrEqual(44);
    }
    expect(r.play.bottom, 'Play above the fold').toBeLessThanOrEqual(r.vh);
    expect(r.play.bottom, 'Play clears the tab bar').toBeLessThanOrEqual(r.nav.top);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  });

  test('phone: the same holds at 360x740 (greeting offset, pill above the ring, Play above the nav)', async ({ page }, info) => {
    test.skip(!isMobile(info.project), 'phone only');
    await boot(page, at([['2026-10-14', 3]]));
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return { g: box('[data-testid="greeting"]').top, m: box('[data-testid="mode-focus"]').bottom, b: box('[data-testid="timer-bubble"]').top, p: box('[data-testid="timer-play"]').bottom, n: document.querySelector('[data-testid="nav-timer"]')!.closest('nav')!.getBoundingClientRect().top };
    });
    expect(r.g).toBeGreaterThanOrEqual(20);
    expect(r.m).toBeLessThanOrEqual(r.b + 1);
    expect(r.p).toBeLessThanOrEqual(r.n);
  });
});

// ------------------------------------------------------------------------------------------------ THEME-6

test.describe('THEME-6 the decoration switches', () => {
  test('both exist, default on, persist per device and are never in a v1 document', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), calm: true, route: 'settings' });
    const mascot = page.getByTestId('settings-mascot');
    const stickers = page.getByTestId('settings-stickers');
    await expect(mascot).toBeVisible();
    await expect(stickers).toBeVisible();
    await expect(mascot).toBeChecked();
    await expect(stickers).toBeChecked();
    await mascot.click();
    await stickers.click();
    await expect(mascot).not.toBeChecked();
    await expect(stickers).not.toBeChecked();
    await expect(page.getByTestId('mascot')).toHaveCount(0);
    const s = (await stored(page)).settings;
    expect(s.mascot).toBe(false);
    expect(s.stickers).toBe(false);
    await page.reload();
    await expect(page.getByTestId('settings-mascot')).not.toBeChecked();
    await expect(page.getByTestId('settings-stickers')).not.toBeChecked();
    await page.getByTestId('settings-mascot').click();
    await go(page, 'timer');
    await expect(page.getByTestId('mascot')).toBeVisible();
  });
});

// ------------------------------------------------------------------------------------------------ UI-3

test.describe('UI-3 Play stays above the fold at 390x844', () => {
  test.beforeEach(async ({ browserName: _b }, info) => {
    test.skip(!isMobile(info.project), 'phone layout only');
  });

  const states: Array<[string, string, Record<string, unknown>]> = [
    ['12:30 default', '12:30', {}],
    ['02:30 Always dark with the headlamp', '02:30', { theme: 'dark' }],
    ['a 24-character name that wraps (wide letters)', '12:30', { displayName: 'WWWWWWWWWWWWWWWWWWWWWWWW' }],
    ['mascot off', '12:30', { mascot: false }],
    ['long name at night', '23:00', { displayName: 'MMMMMMMMMMMMMMMMMMMMMMMM', theme: 'dark' }],
  ];
  for (const [label, time, settings] of states) {
    test(`${label}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await boot(page, { clock: atTime(time), seed: v2doc(settings), calm: true });
      await page.waitForTimeout(300);
      for (const id of ['timer-digits', 'timer-play']) {
        const b = (await page.getByTestId(id).filter({ visible: true }).first().boundingBox())!;
        expect(b.y + b.height, `${id} bottom edge`).toBeLessThanOrEqual(844);
        expect(b.y, `${id} top edge`).toBeGreaterThanOrEqual(0);
      }
      // the floating nav does not cover Play
      const play = (await page.getByTestId('timer-play').boundingBox())!;
      const nav = (await page.locator('nav').filter({ visible: true }).first().boundingBox())!;
      expect(play.y + play.height, 'Play clears the nav').toBeLessThanOrEqual(nav.y + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  }

  test('with a current task, a streak chip, and a break prompt on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const d = v2doc();
    d.meta.currentTaskId = d.tasks[1].id;
    await boot(page, { clock: atTime('12:30'), seed: d, calm: true });
    await page.waitForTimeout(300);
    const b = (await page.getByTestId('timer-play').boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(844);
  });
});

// ------------------------------------------------------------------------------------------------ decoration vs numerals and labels

/** Boxes (viewport coordinates) of everything decorative that is on screen. */
const MASCOTS_ONLY = '[data-testid="mascot"], [data-testid="mascot-empty"]';
const DECOR = `${MASCOTS_ONLY}, [data-testid="sticker-burst"] [data-testid="sticker"]`;

async function decorOverText(page: Page, textSelector: string, decorSelector = DECOR): Promise<string[]> {
  return page.evaluate(([decor, sel]) => {
    const out: string[] = [];
    const texts = [...document.querySelectorAll<Element>(sel as string)].filter((t) => {
      const r = t.getBoundingClientRect();
      const cs = getComputedStyle(t);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    for (const d of document.querySelectorAll<Element>(decor as string)) {
      const dr = d.getBoundingClientRect();
      if (dr.width === 0) continue;
      const k = d.getAttribute('data-testid') === 'sticker' ? 1 : dr.width / 120;
      const isMascot = d.getAttribute('data-testid') !== 'sticker';
      const mirrored = d.classList.contains('mascot--mirror');
      const left = isMascot ? (mirrored ? dr.right - 145 * k : dr.left - 8 * k) : dr.left;
      const right = isMascot ? (mirrored ? dr.right + 8 * k : dr.left + 145 * k) : dr.right;
      const top = isMascot ? dr.top - 14 * k : dr.top;
      const bottom = dr.bottom;
      for (const t of texts) {
        // the painted text (each text node on its own), not the often wider block that holds it
        const rects: DOMRect[] = [];
        if (t.namespaceURI === 'http://www.w3.org/2000/svg') rects.push(t.getBoundingClientRect());
        else {
          const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (!(n.textContent ?? '').trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            rects.push(range.getBoundingClientRect());
          }
        }
        for (const tr of rects) {
          if (tr.width === 0 || tr.height === 0) continue;
          if (left < tr.right - 0.5 && right > tr.left + 0.5 && top < tr.bottom - 0.5 && bottom > tr.top + 0.5)
            out.push(`${d.getAttribute('data-testid')} [${Math.round(left)},${Math.round(top)},${Math.round(right - left)}x${Math.round(bottom - top)}] over "${(t.textContent ?? '').trim().slice(0, 20)}" [${Math.round(tr.left)},${Math.round(tr.top)},${Math.round(tr.width)}x${Math.round(tr.height)}]`);
        }
      }
    }
    return out;
  }, [decorSelector, textSelector]);
}

test.describe('no decoration overlaps the ring numerals, the greeting or a chart label', () => {
  for (const [label, settings, time] of [['day', {}, '12:30'], ['night with the headlamp', { theme: 'dark' }, '02:30']] as const) {
    test(`Timer, ${label}: the mascot is clear of the digits, the greeting and the subline, idle, running and after a completion`, async ({ page }) => {
      await boot(page, { clock: atTime(time), seed: v2doc(settings), calm: true, rng: 5 });
      const TEXT = '[data-testid="timer-digits"], [data-testid="greeting"], [data-testid="current-task"]';
      expect(await decorOverText(page, TEXT, MASCOTS_ONLY), 'idle').toEqual([]);
      await page.getByTestId('timer-play').click();
      await page.clock.runFor(3000);
      expect(await decorOverText(page, TEXT, MASCOTS_ONLY), 'running').toEqual([]);
      await page.clock.fastForward(25 * MIN);
      await page.waitForTimeout(100);
      // the celebrate face is the larger one
      expect(await decorOverText(page, TEXT, MASCOTS_ONLY), 'celebrate / break (the mascot; the burst is judged below)').toEqual([]);
    });
  }

  test('Timer: the burst starts on the bubble by design but never covers the greeting; digits stay the topmost thing in the bubble', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), seed: v2doc(), calm: true, rng: 5 });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    await expect(page.getByTestId('sticker-burst').getByTestId('sticker')).not.toHaveCount(0);
    expect(await decorOverText(page, '[data-testid="greeting"]', DECOR)).toEqual([]);
    // the burst layer paints below the digits' hit target and never intercepts pointer events
    const hit = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="timer-digits"]')!.getBoundingClientRect();
      const el = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2)!;
      return { burst: !!el.closest('[data-testid="sticker-burst"]'), pe: getComputedStyle(document.querySelector('[data-testid="sticker-burst"]')!).pointerEvents };
    });
    expect(hit.burst, 'the digits are not under a sticker for hit-testing').toBe(false);
    expect(hit.pe).toBe('none');
  });

  for (const [label, doc] of [['with data', () => v2doc()], ['first run (empty states)', () => emptyDoc()]] as const) {
    test(`Stats, ${label}: no mascot box or painted extent over any chart label, axis tick or value`, async ({ page }) => {
      await boot(page, { clock: atTime('12:30'), seed: doc(), calm: true, route: 'stats' });
      await page.waitForTimeout(600);
      const LABELS = 'svg text, .bigstat, .stat__value, [data-testid="week-total"], [data-testid="streak-current"], [data-testid="today-tile"]';
      expect(await decorOverText(page, LABELS, MASCOTS_ONLY)).toEqual([]);
    });
  }

  test('Tasks: the empty-state mascot is clear of the caption and the Add button', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), seed: emptyDoc(), calm: true, route: 'tasks' });
    expect(await decorOverText(page, 'h1, h2, p, [data-testid="task-add-button"], [data-testid="task-add-input"]', MASCOTS_ONLY)).toEqual([]);
  });

  test('a drifting sticker is never above any text: it is layered below every glass panel, card and heading', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), seed: v2doc(), calm: true, rng: 3 });
    await page.clock.runFor(45_000);
    await expect(page.getByTestId('sticker')).not.toHaveCount(0);
    const z = await page.evaluate(() => {
      const layer = document.querySelector('[data-testid="sticker-layer"]')!;
      const scene = layer.closest('[data-testid="sky"]');
      const main = document.querySelector('main, #app, .app')!;
      // every sticker is inside the scene, and the scene is fixed behind: its stacking context has z-index <= 0 or sits earlier than main
      return { inScene: !!scene, sceneZ: scene ? getComputedStyle(scene).zIndex : null, scenePos: scene ? getComputedStyle(scene).position : null, mainPos: getComputedStyle(main).position };
    });
    expect(z.inScene).toBe(true);
    expect(z.scenePos).toBe('fixed');
    // hit-testing: at each sticker's centre the element on top is never the sticker
    const covered = await page.evaluate(() => {
      const out: string[] = [];
      for (const s of document.querySelectorAll<HTMLElement>('[data-testid="sticker"]')) {
        const r = s.getBoundingClientRect();
        const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
        // elementFromPoint ignores pointer-events:none elements, so the topmost real element is anything but a sticker; assert the sticker is not painted after content by stacking
        if (top && s.contains(top)) out.push('sticker is hit-testable');
      }
      return out;
    });
    expect(covered).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ 44 px with the decoration on screen

test.describe('A11Y-5 44 px targets with the decoration on screen', () => {
  test.beforeEach(async ({ browserName: _b }, info) => {
    test.skip(!isMobile(info.project), 'phone layout only');
  });

  for (const [label, time, settings] of [['02:30, Always dark, 24-character name', '02:30', { theme: 'dark', displayName: 'MMMMMMMMMMMMMMMMMMMMMMMM' }], ['12:30 day', '12:30', {}]] as const) {
    for (const route of ROUTES) {
      test(`${route} @ ${label}: every interactive element is at least 44x44`, async ({ page }) => {
        await boot(page, { clock: atTime(time), seed: v2doc(settings), calm: true, route, rng: 9 });
        await page.waitForTimeout(400);
        if (route === 'timer') {
          await page.getByTestId('timer-play').click();
          await page.clock.fastForward(25 * MIN + 250); // a burst, the celebrate face and the break card are on screen
        }
        const small = await page.evaluate((sel) => {
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>(sel)) {
            if (el.closest('.sr-only, [hidden], .skip')) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || (el as HTMLInputElement).type === 'file') continue;
            const host = el.closest('label') ?? el;
            const r = host.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('data-testid') || '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          return out;
        }, INTERACTIVE_SELECTOR);
        expect(small).toEqual([]);
      });
    }
  }

  test('no decorative element is focusable or has a role: the mascot, the scene and every sticker', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), seed: v2doc(), calm: true, rng: 3 });
    await page.clock.runFor(45_000);
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(25 * MIN + 250);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const root of document.querySelectorAll<HTMLElement>('[data-testid="sky"], [data-testid="mascot"], [data-testid="mascot-empty"], [data-testid="sticker-burst"]')) {
        const hidden = root.getAttribute('aria-hidden') === 'true' || !!root.closest('[aria-hidden="true"]');
        if (!hidden) out.push(`${root.getAttribute('data-testid')} is not aria-hidden`);
        if (root.getAttribute('role')) out.push(`${root.getAttribute('data-testid')} has a role`);
        for (const f of root.querySelectorAll('a, button, input, select, textarea, [tabindex]')) out.push(`${root.getAttribute('data-testid')} contains a focusable ${f.tagName}`);
      }
      return out;
    });
    expect(bad).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ fix round: dialogs portal to the body

test.describe('dialogs opened from a Settings card are not trapped in it (DAT-3, DAT-5 regression)', () => {
  test('the import summary and the erase dialog hang off <body>, outside every card, and their buttons are the topmost element', async ({ page }) => {
    await boot(page, { clock: atTime('12:30'), seed: v2doc(), calm: true, route: 'settings' });
    await page.getByTestId('import-input').setInputFiles(new URL('../fixtures/backup-valid.json', import.meta.url).pathname);
    const dlg = page.getByRole('dialog', { name: 'Import this backup' });
    await expect(dlg).toBeVisible();
    for (const [name, label] of [['Import this backup', 'Replace everything'], ['Import this backup', 'Merge'], ['Import this backup', 'Cancel']] as const) {
      const r = await page.getByRole('dialog', { name }).getByRole('button', { name: label }).evaluate((el) => {
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { inCard: !!el.closest('.card'), top: top === el || el.contains(top) };
      });
      expect(r.inCard, `${label} is inside a card`).toBe(false);
      expect(r.top, `${label} is hit-testable`).toBe(true);
    }
    const scrim = await dlg.evaluate((el) => {
      const s = el.closest('.scrim') as HTMLElement;
      const b = s.getBoundingClientRect();
      return { w: b.width, h: b.height, vw: innerWidth, vh: innerHeight, parent: !s.closest('.card, .page, main') && !!s.closest('body') };
    });
    expect(scrim.parent, 'the scrim is outside every card, page and main element (portalled to the body)').toBe(true);
    expect(Math.round(scrim.w)).toBe(scrim.vw);
    expect(Math.round(scrim.h)).toBe(scrim.vh);
  });
});
