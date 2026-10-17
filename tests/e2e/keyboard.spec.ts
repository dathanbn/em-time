import { expect, test, type Page } from '@playwright/test';
import { MIN, boot, go, visible } from './helpers';

test.skip(({ isMobile }) => isMobile, 'keyboard shortcuts are a desktop feature');

const state = (p: Page) => p.evaluate(() => (window as any).__emCore.timer.getState());

test.describe('TMR-13 keyboard shortcuts', () => {
  test('Space toggles play and pause, S skips, R resets, 1/2/3 select the phase, ? opens the sheet', async ({ page }) => {
    await boot(page, { clock: true });
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('running');
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('paused');
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('running');
    await page.keyboard.press('r');
    expect(await state(page)).toMatchObject({ status: 'idle', phase: 'focus' });
    await page.keyboard.press('2');
    expect(await state(page)).toMatchObject({ phase: 'short', status: 'idle' });
    await page.keyboard.press('3');
    expect((await state(page)).phase).toBe('long');
    await page.keyboard.press('1');
    expect((await state(page)).phase).toBe('focus');
    await page.keyboard.press('Space');
    await page.keyboard.press('Shift+S'); // capital S
    expect(await state(page)).toMatchObject({ phase: 'short', status: 'idle' });
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dlg).toBeVisible();
    for (const k of ['Space', 'S', 'R', '1', '2', '3', '?']) await expect(dlg.locator('kbd', { hasText: new RegExp(`^${k === '?' ? '\\?' : k}$`) })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });

  test('1/2/3 follow the discard rule of the mode switcher (TMR-12)', async ({ page }) => {
    await boot(page, { clock: true });
    await page.keyboard.press('Space');
    await page.clock.fastForward(90_000);
    await page.keyboard.press('2');
    await expect(page.getByRole('dialog', { name: 'Discard this session?' })).toBeVisible();
    expect((await state(page)).phase).toBe('focus');
  });

  test('shortcuts are ignored while typing in an input, textarea, select or contenteditable', async ({ page }) => {
    await boot(page, { clock: true, route: 'tasks' });
    await page.keyboard.press('Space'); // start a timer first so a stray "r" or "s" would be visible
    expect((await state(page)).status).toBe('running');
    const input = page.getByTestId('task-add-input');
    await input.click();
    await page.keyboard.type('s r 1 2 3 ? Space test');
    await expect(input).toHaveValue('s r 1 2 3 ? Space test');
    expect(await state(page)).toMatchObject({ status: 'running', phase: 'focus' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const select = page.getByTestId('task-add-category');
    await select.focus();
    await page.keyboard.press('s');
    await page.keyboard.press('r');
    await page.keyboard.press('Space');
    expect(await state(page)).toMatchObject({ status: 'running', phase: 'focus' });
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.contentEditable = 'true';
      d.id = 'qa-editable';
      d.textContent = 'edit';
      document.body.appendChild(d);
    });
    await page.locator('#qa-editable').focus();
    await page.keyboard.press('s');
    await page.keyboard.press('2');
    expect(await state(page)).toMatchObject({ status: 'running', phase: 'focus' });
  });

  test('shortcuts are ignored while Ctrl, Meta or Alt is held', async ({ page }) => {
    await boot(page, { clock: true });
    await page.keyboard.press('Space');
    for (const mod of ['Control', 'Meta', 'Alt']) {
      for (const k of ['s', 'r', '1', '2', '3', 'Space']) await page.keyboard.press(`${mod}+${k}`);
    }
    expect(await state(page)).toMatchObject({ status: 'running', phase: 'focus' });
  });

  test('Space on another focused button keeps its native behaviour; on the three timer controls it always means play/pause', async ({ page }) => {
    await boot(page, { clock: true });
    // a mode radio: Space selects it natively and does not start the timer
    await page.getByTestId('mode-short').focus();
    await page.keyboard.press('Space');
    expect(await state(page)).toMatchObject({ phase: 'short', status: 'idle' });
    await page.keyboard.press('1');
    // Reset focused: Space toggles play, it does not reset
    await page.getByTestId('timer-reset').focus();
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('running');
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('paused');
    // Skip focused: Space toggles play, it does not skip
    await page.getByTestId('timer-skip').focus();
    await page.keyboard.press('Space');
    expect(await state(page)).toMatchObject({ status: 'running', phase: 'focus' });
    // Play focused: exactly one toggle per press (no native click on top of the shortcut)
    await page.getByTestId('timer-play').focus();
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('paused');
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('running');
    // a link keeps native behaviour (Space does not toggle)
    await page.getByTestId('nav-tasks').focus();
    await page.keyboard.press('Space');
    expect((await state(page)).status).toBe('running');
    await go(page, 'timer');
  });

  test('A11Y-2 every control is reachable by Tab and shows a visible focus ring', async ({ page }) => {
    await boot(page, { clock: true });
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return { id: el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20) || el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow };
      });
      if (!info) continue;
      seen.add(info.id as string);
      expect(info.outline !== 'none' || info.shadow !== 'none', `focus ring on ${info.id}`).toBe(true);
    }
    for (const needed of ['nav-timer', 'nav-tasks', 'nav-stats', 'nav-settings', 'mode-focus', 'current-task', 'timer-reset', 'timer-play', 'timer-skip']) {
      expect(seen.has(needed), `${needed} reachable`).toBe(true);
    }
    void MIN; void visible;
  });
});
