import { expect, test, type Page } from '@playwright/test';
import { MIN, boot, fixture, go, isMobile, runFocus, sessionsOf, stored } from './helpers';

const rows = (page: Page) => page.getByTestId('task-row');
const rowOf = (page: Page, name: string) => rows(page).filter({ hasText: name });
const taskNames = async (page: Page) => (await stored(page)).tasks.filter((t: any) => !t.deletedAt).map((t: any) => t.name);

async function addTask(page: Page, name: string, category?: string) {
  if (category) await page.getByTestId('task-add-category').selectOption({ label: category });
  await page.getByTestId('task-add-input').fill(name);
  await page.getByTestId('task-add-button').click();
}

/** The category manager: a side card on desktop, the "Manage categories" sheet on the phone. */
async function categoryScope(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: 'Manage categories' }).click();
    return page.getByRole('dialog', { name: 'Categories' });
  }
  return page.getByRole('complementary', { name: 'Categories' });
}

/** Ticks a task like a user: the real input is visually replaced by a box, so click the box. */
async function tick(page: Page, name: string, to: 'done' | 'open') {
  const label = to === 'done' ? `Mark done: ${name}` : `Mark not done: ${name}`;
  await page.locator('label.check', { has: page.getByRole('checkbox', { name: label }) }).click();
}

async function menu(page: Page, taskName: string, item: string) {
  await page.getByRole('button', { name: `More actions for ${taskName}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('tasks', () => {
  test('TSK-2 add a task: trimmed, at the top of the open list, category defaults to the first then to the last used', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    const sel = page.getByTestId('task-add-category');
    await expect(sel).toHaveValue('5e5e0000-0000-4000-8000-000000000001');

    await addTask(page, '   Spaced name   ');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('.trow__name')).toHaveText('Spaced name');
    await expect(page.getByTestId('task-add-input')).toHaveValue('');
    await expect(page.getByTestId('task-add-input')).toBeFocused();

    await addTask(page, 'Second', 'Reading');
    await expect(rows(page).first()).toContainText('Second');
    await expect(rows(page).first()).toContainText('Reading');
    // the next task defaults to the category used last
    await expect(sel.locator('option:checked')).toHaveText('Reading');
    await addTask(page, 'Third');
    await expect(rows(page).first()).toContainText('Third');
    await expect(rows(page).first()).toContainText('Reading');
    expect(await taskNames(page)).toEqual(expect.arrayContaining(['Spaced name', 'Second', 'Third']));
    // survives a reload
    await page.reload();
    await expect(rows(page)).toHaveCount(3);
  });

  test('TSK-2 name is required, trimmed, and capped at 80 characters', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    await page.getByTestId('task-add-button').click();
    await expect(page.getByText('Enter a task name.')).toBeVisible();
    await page.getByTestId('task-add-input').fill('    ');
    await page.getByTestId('task-add-button').click();
    await expect(page.getByText('Enter a task name.')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    // typing past the cap is blocked by the field
    const input = page.getByTestId('task-add-input');
    await input.fill('');
    await input.pressSequentially('x'.repeat(95));
    expect((await input.inputValue()).length).toBe(80);
    await input.fill('y'.repeat(80));
    await page.getByTestId('task-add-button').click();
    await expect(rows(page)).toHaveCount(1);
    // an 81 character value that bypasses the cap (paste, autofill) is refused with a message
    await input.evaluate((el: HTMLInputElement) => {
      el.removeAttribute('maxlength');
      el.value = 'z'.repeat(81);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByTestId('task-add-button').click();
    await expect(page.getByText('Task names can be up to 80 characters.')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
  });

  test('TSK-3 rename, change category, check off into Done, uncheck, delete with confirm', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    await addTask(page, 'Alpha');
    await addTask(page, 'Beta');

    // rename
    await menu(page, 'Alpha', 'Rename');
    const edit = page.getByRole('textbox', { name: 'Task name' });
    await expect(edit).toBeFocused();
    await edit.fill('Alpha renamed');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(rowOf(page, 'Alpha renamed')).toHaveCount(1);
    // Escape cancels a rename
    await menu(page, 'Alpha renamed', 'Rename');
    await page.getByRole('textbox', { name: 'Task name' }).fill('nope');
    await page.keyboard.press('Escape');
    await expect(rowOf(page, 'Alpha renamed')).toHaveCount(1);

    // change category
    await menu(page, 'Beta', 'Change category');
    await page.getByRole('dialog', { name: 'Change category' }).getByRole('radio', { name: 'Writing' }).click();
    await expect(rowOf(page, 'Beta')).toContainText('Writing');
    const beta = (await stored(page)).tasks.find((t: any) => t.name === 'Beta');
    expect(beta.categoryId).toBe('5e5e0000-0000-4000-8000-000000000004');

    // check off: leaves the open list, Done (1) appears collapsed
    await tick(page, 'Beta', 'done');
    await expect(page.getByRole('list', { name: 'Open tasks' }).getByText('Beta')).toHaveCount(0);
    const toggle = page.getByRole('button', { name: /Done \(1\)/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name: 'Done tasks' })).toHaveCount(0);
    await toggle.click();
    await expect(page.getByRole('list', { name: 'Done tasks' }).getByText('Beta')).toBeVisible();
    // uncheck: back in the open list
    await tick(page, 'Beta', 'open');
    await expect(page.getByRole('list', { name: 'Open tasks' }).getByText('Beta')).toBeVisible();
    await expect(page.getByRole('button', { name: /Done \(/ })).toHaveCount(0);

    // delete asks first; Cancel keeps it
    await menu(page, 'Beta', 'Delete');
    const dlg = page.getByRole('dialog', { name: 'Delete this task?' });
    await expect(dlg).toContainText('Focus time you already logged for it stays in your stats.');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(rowOf(page, 'Beta')).toHaveCount(1);
    await menu(page, 'Beta', 'Delete');
    await page.getByRole('dialog', { name: 'Delete this task?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(rowOf(page, 'Beta')).toHaveCount(0);
    // soft delete: the record is kept as a tombstone for sync
    const doc = await stored(page);
    expect(doc.tasks.find((t: any) => t.name === 'Beta').deletedAt).toBeGreaterThan(0);
  });

  test('TSK-3 a deleted task keeps its sessions; stats show them under its last name with "(deleted)"', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'tasks' });
    const before = (await sessionsOf(page)).length;
    await menu(page, 'Lab report draft', 'Delete');
    await page.getByRole('dialog', { name: 'Delete this task?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(rowOf(page, 'Lab report draft')).toHaveCount(0);
    expect((await sessionsOf(page)).length).toBe(before);
    await go(page, 'stats');
    await expect(page.getByTestId('task-totals')).toContainText('Lab report draft (deleted)');
  });

  test('TSK-4 set as current from a row; the timer shows it; the picker lists open tasks, No task and Add task', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    await addTask(page, 'One');
    await addTask(page, 'Two');
    await page.getByRole('button', { name: 'Set as current: One' }).click();
    await expect(rowOf(page, 'One')).toContainText('Current');
    await expect(page.getByRole('button', { name: 'Set as current: Two' })).toHaveAttribute('aria-pressed', 'false');
    // only one task is current at a time
    await page.getByRole('button', { name: 'Set as current: Two' }).click();
    await expect(rows(page).filter({ hasText: 'Current' })).toHaveCount(1);
    await expect(rowOf(page, 'Two')).toContainText('Current');

    await go(page, 'timer');
    const cur = page.getByTestId('current-task').filter({ visible: true }).first();
    await expect(cur).toContainText('Two');
    await cur.click();
    const picker = page.getByRole('dialog', { name: 'Pick a task' });
    await expect(picker.getByRole('radio')).toHaveText(['No task', 'Two', 'One']);
    await expect(picker.getByRole('radio', { name: 'Two' })).toHaveAttribute('aria-checked', 'true');
    await picker.getByRole('radio', { name: 'One' }).click();
    await expect(picker).toHaveCount(0);
    await expect(cur).toContainText('One');
    // Add task from the picker creates it and makes it current
    await cur.click();
    await page.getByRole('dialog', { name: 'Pick a task' }).getByLabel('Add task').fill('From picker');
    await page.getByRole('dialog', { name: 'Pick a task' }).getByRole('button', { name: 'Add' }).click();
    await expect(cur).toContainText('From picker');
    // No task clears it
    await cur.click();
    await page.getByRole('dialog', { name: 'Pick a task' }).getByRole('radio', { name: 'No task' }).click();
    await expect(cur).toContainText('Pick a task');
    expect((await stored(page)).meta.currentTaskId).toBeNull();
    // current is per device: it lives in meta, which a new tab of the same device shares, not in the task rows
    expect((await stored(page)).tasks.every((t: any) => !('current' in t))).toBe(true);
  });

  test('TSK-4 picker: Escape closes it and returns focus to the task button', async ({ page }) => {
    await boot(page, { route: 'timer' });
    const cur = page.getByTestId('current-task').filter({ visible: true }).first();
    await cur.click();
    const picker = page.getByRole('dialog', { name: 'Pick a task' });
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(cur).toBeFocused();
  });

  test('TSK-5 a session is credited to the task current when it completes; changing it mid-session moves the credit', async ({ page }) => {
    await boot(page, { clock: true, stubs: true, route: 'tasks' });
    await addTask(page, 'First');
    await addTask(page, 'Second');
    await page.getByRole('button', { name: 'Set as current: First' }).click();
    await go(page, 'timer');
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(10 * MIN);
    await go(page, 'tasks');
    await page.getByRole('button', { name: 'Set as current: Second' }).click();
    await go(page, 'timer');
    await page.clock.fastForward(15 * MIN + 250);
    await expect.poll(async () => (await sessionsOf(page)).length).toBe(1);
    const [s] = await sessionsOf(page);
    expect(s.taskName).toBe('Second');
    expect(s.focusedMs).toBe(25 * MIN);
    const second = (await stored(page)).tasks.find((t: any) => t.name === 'Second');
    expect(s.taskId).toBe(second.id);
    // the week minutes follow the credited task
    await go(page, 'tasks');
    await expect(rowOf(page, 'Second').locator('.trow__mins')).toContainText('25m');
    await expect(rowOf(page, 'First').locator('.trow__mins')).toContainText('0m');
  });

  test('TSK-5 checking off the current task does not clear it', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    await addTask(page, 'Finish me');
    await page.getByRole('button', { name: 'Set as current: Finish me' }).click();
    await tick(page, 'Finish me', 'done');
    const meta = (await stored(page)).meta;
    const t = (await stored(page)).tasks[0];
    expect(t.done).toBe(true);
    expect(meta.currentTaskId).toBe(t.id);
    await go(page, 'timer');
    await expect(page.getByTestId('current-task').filter({ visible: true }).first()).toContainText('Finish me');
  });

  test('TSK-6 categories: rename, recolor from 8 swatches, add up to 8 (colors may repeat), delete moves tasks, last one is protected', async ({ page }, info) => {
    const mobile = isMobile(info.project);
    await boot(page, { route: 'tasks' });
    await addTask(page, 'Movable', 'Reading');
    const scope = await categoryScope(page, mobile);
    await expect(scope.getByTestId('category-row')).toHaveCount(5);

    // rename: 1 to 30 characters
    const first = scope.getByTestId('category-row').first().getByRole('textbox', { name: 'Category name' });
    await first.fill('Deep work');
    await first.press('Enter');
    expect((await stored(page)).categories.find((c: any) => c.id.endsWith('01')).name).toBe('Deep work');
    await first.fill('');
    await first.press('Enter');
    await expect(scope.getByText('Enter a category name.')).toBeVisible();
    await first.fill('');
    await first.pressSequentially('q'.repeat(40));
    expect((await first.inputValue()).length).toBe(30);
    await first.fill('Deep work');
    await first.press('Enter');

    // recolor: eight swatches, the choice persists
    await scope.getByRole('button', { name: /Deep work: .*\. Change color/ }).click();
    const pop = scope.getByRole('radiogroup', { name: 'Category color' });
    await expect(pop.getByRole('radio')).toHaveCount(8);
    await pop.getByRole('radio').last().click();
    const recolored = (await stored(page)).categories.find((c: any) => c.id.endsWith('01'));
    expect(recolored.color).toBe(8);

    // add: three more reach the limit of 8; a shared colour is allowed
    const add = scope.getByPlaceholder(/^(New category|Category limit reached)$/);
    for (const n of ['Six', 'Seven', 'Eight']) {
      await add.fill(n);
      await scope.getByRole('button', { name: 'Add category' }).click();
    }
    await expect(scope.getByTestId('category-row')).toHaveCount(8);
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute('placeholder', 'Category limit reached');
    await expect(scope.getByRole('button', { name: 'Add category' })).toBeDisabled();
    const colours = (await stored(page)).categories.filter((c: any) => !c.deletedAt).map((c: any) => c.color);
    expect(colours).toHaveLength(8);

    // delete asks which category receives the tasks (default: first remaining)
    await scope.getByRole('button', { name: 'Delete category Reading' }).click();
    const dlg = page.getByRole('dialog', { name: 'Delete Reading?' });
    const moveTo = dlg.getByLabel('Move its tasks to');
    await expect(moveTo.locator('option:checked')).toHaveText('Deep work');
    await moveTo.selectOption({ label: 'Writing' });
    await dlg.getByRole('button', { name: 'Delete category' }).click();
    await expect(dlg).toHaveCount(0);
    const doc = await stored(page);
    const writing = doc.categories.find((c: any) => c.name === 'Writing');
    expect(doc.tasks.find((t: any) => t.name === 'Movable').categoryId).toBe(writing.id);
    expect(doc.categories.find((c: any) => c.name === 'Reading').deletedAt).toBeGreaterThan(0);

    // reduce to a single category: its delete button is disabled
    for (let i = 0; i < 6; i++) {
      await scope.getByTestId('category-row').first().getByRole('button', { name: /^Delete category/ }).click();
      await page.getByRole('dialog', { name: /^Delete / }).getByRole('button', { name: 'Delete category' }).click();
    }
    await expect(scope.getByTestId('category-row')).toHaveCount(1);
    await expect(scope.getByTestId('category-row').first().getByRole('button', { name: /^Delete category/ })).toBeDisabled();
    expect((await stored(page)).categories.filter((c: any) => !c.deletedAt)).toHaveLength(1);
  });

  test('TSK-6 the delete dialog never offers the category being deleted as the destination', async ({ page }, info) => {
    await boot(page, { route: 'tasks' });
    const scope = await categoryScope(page, isMobile(info.project));
    await scope.getByRole('button', { name: 'Delete category Study' }).click();
    const options = await page.getByRole('dialog', { name: 'Delete Study?' }).getByLabel('Move its tasks to').locator('option').allTextContents();
    expect(options).toEqual(['Reading', 'Problem sets', 'Writing', 'Review']);
  });

  test('TSK-7 each row shows this week focus time for that task', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'tasks' });
    const doc = fixture('backup-valid.json');
    // independent computation: Mon 12 Oct to Sun 18 Oct 2026, local days from the fixture's own day field
    const mins = (id: string) =>
      doc.sessions
        .filter((s: any) => s.taskId === id && !s.deletedAt && s.day >= '2026-10-12' && s.day <= '2026-10-18')
        .reduce((a: number, s: any) => a + s.focusedMs / 60000, 0);
    const fmt = (m: number) => (m === 0 ? '0m' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
    const open = doc.tasks.filter((t: any) => !t.deletedAt && !t.done);
    expect(open.length).toBeGreaterThan(0);
    for (const t of open) {
      // desktop shows .trow__mins, the phone shows the figure on the category line (.trow__catmins);
      // exactly one of them must be visible, and its text is the figure (hidden elements do not count)
      const figure = rowOf(page, t.name).locator('.trow__mins, .trow__catmins').filter({ visible: true });
      await expect(figure, t.name).toHaveCount(1);
      await expect(figure, t.name).toBeVisible();
      const text = (await figure.innerText()).replace(/\s+this week/, '').replace(/^\W+/, '').trim();
      expect(text, t.name).toBe(fmt(mins(t.id)));
    }
    // the week figure updates after a session without a reload
    await go(page, 'timer');
    await page.getByTestId('current-task').filter({ visible: true }).first().click();
    await page.getByRole('dialog', { name: 'Pick a task' }).getByRole('radio', { name: 'Lab report draft' }).click();
    const before = mins('4b0e2f8a-77c2-4a8e-8b7d-2a3c1e9f0b13');
    await runFocus(page);
    await go(page, 'tasks');
    await expect(rowOf(page, 'Lab report draft').locator('.trow__mins, .trow__catmins').filter({ visible: true })).toContainText(fmt(before + 25));
  });

  test('TSK-8 Clear done removes every done task after a confirm; sessions stay', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'tasks' });
    const sessions = (await sessionsOf(page)).length;
    await expect(page.getByRole('button', { name: /Done \(1\)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Clear done' }).click();
    const dlg = page.getByRole('dialog', { name: 'Clear done tasks?' });
    await expect(dlg).toContainText('Logged focus time stays in your stats.');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: /Done \(1\)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Clear done' }).click();
    await page.getByRole('dialog', { name: 'Clear done tasks?' }).getByRole('button', { name: 'Clear 1' }).click();
    await expect(page.getByRole('button', { name: /Done \(/ })).toHaveCount(0);
    expect((await sessionsOf(page)).length).toBe(sessions);
    await go(page, 'stats');
    await expect(page.getByTestId('task-totals')).not.toContainText('undefined');
  });

  test('EDGE-10 Tasks screen: an 80 character task name and a 30 character category name never break the layout', async ({ page }, info) => {
    await boot(page, { route: 'tasks' });
    const long = 'Wordless'.repeat(10); // 80 characters, no spaces
    await addTask(page, long);
    const row = rows(page).first();
    const vw = page.viewportSize()!.width;
    await expect(row.locator('.trow__name')).toHaveAttribute('title', long);
    const box = await row.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const menuBox = await row.getByRole('button', { name: `More actions for ${long}` }).boundingBox();
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(vw + 1);

    const scope = await categoryScope(page, isMobile(info.project));
    const name = scope.getByTestId('category-row').first().getByRole('textbox', { name: 'Category name' });
    await name.fill('C'.repeat(30));
    await name.press('Enter');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await stored(page)).categories.find((c: any) => c.id.endsWith('01')).name).toHaveLength(30);
  });

  test('EDGE-10 Timer screen: a long current task, the Up next list and the task picker stay inside the viewport', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    const long = 'Wordless'.repeat(10);
    await addTask(page, long);
    await page.getByRole('button', { name: /^Set as current/ }).click();
    await go(page, 'timer');
    const vw = page.viewportSize()!.width;
    const tb = await page.getByTestId('current-task').filter({ visible: true }).first().boundingBox();
    expect(tb!.x + tb!.width).toBeLessThanOrEqual(vw + 1);
    // every visible element sits inside the viewport (catches the desktop "Up next" side card)
    const outside = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .map((el) => `${el.tagName}.${el.className}`),
    );
    expect(outside).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('EDGE-10 the task picker truncates an 80 character name inside its dialog', async ({ page }) => {
    await boot(page, { route: 'tasks' });
    const long = 'Wordless'.repeat(10);
    await addTask(page, long);
    await go(page, 'timer');
    await page.getByTestId('current-task').filter({ visible: true }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Pick a task' });
    const d = await dlg.boundingBox();
    const r = await dlg.getByRole('radio', { name: long }).boundingBox();
    expect(r!.x + r!.width).toBeLessThanOrEqual(d!.x + d!.width + 1);
    expect(r!.x + r!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });

  test('TSK-6 the new-category field keeps its accessible name "New category name" while the phone sheet is open', async ({ page }, info) => {
    await boot(page, { route: 'tasks' });
    const scope = await categoryScope(page, isMobile(info.project));
    await expect(scope.getByRole('textbox', { name: 'New category name' })).toBeVisible();
  });

  test('TSK-6 a rename error clears once a valid name is entered', async ({ page }, info) => {
    await boot(page, { route: 'tasks' });
    const scope = await categoryScope(page, isMobile(info.project));
    const first = scope.getByTestId('category-row').first().getByRole('textbox', { name: 'Category name' });
    await first.fill('');
    await first.press('Enter');
    await expect(scope.getByText('Enter a category name.')).toBeVisible();
    // typing the old name back is a no-op rename, and must still dismiss the error
    await first.fill('Study');
    await first.press('Enter');
    await expect(scope.getByText('Enter a category name.')).toHaveCount(0);
  });
});
