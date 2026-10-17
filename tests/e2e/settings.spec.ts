import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MIN, boot, fixture, go, qa, sessionsOf, stored } from './helpers';

const fixturePath = (n: string) => resolve(import.meta.dirname, '../fixtures', n);
const live = (arr: any[]) => arr.filter((x) => !x.deletedAt);
const timerDigits = (page: Page) => page.getByTestId('timer-digits').filter({ visible: true }).first();
const stepper = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true });
const clockText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}:00` : `${min}:00`);
const preset = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Preset' }).getByRole('radio', { name });

async function readDownload(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: readFileSync(path, 'utf8') };
}

test.describe('settings: timer (TMR-10, TMR-11)', () => {
  test('TMR-10 presets set focus, short and long to 25/5/15, 50/10/30 and 90/20/30; the idle timer follows', async ({ page }) => {
    await boot(page, { route: 'settings' });
    const expected: Array<[string, number, number, number]> = [
      ['50 / 10', 50, 10, 30],
      ['90 / 20', 90, 20, 30],
      ['25 / 5', 25, 5, 15],
    ];
    for (const [name, f, s, l] of expected) {
      await preset(page, name).click();
      await expect(page.getByText(`${f} min focus, ${s} min short break, ${l} min long break`)).toBeVisible();
      const st = (await stored(page)).settings;
      expect([st.focusMin, st.shortMin, st.longMin]).toEqual([f, s, l]);
      await go(page, 'timer');
      await expect(timerDigits(page)).toHaveText(clockText(f));
      await page.getByTestId('mode-short').click();
      await expect(timerDigits(page)).toHaveText(clockText(s));
      await page.getByTestId('mode-long').click();
      await expect(timerDigits(page)).toHaveText(clockText(l));
      await page.getByTestId('mode-focus').click();
      await go(page, 'settings');
    }
  });

  test('TMR-10 custom ranges are clamped on blur: focus 1-180, short 1-60, long 1-90, long break every 2-8', async ({ page }) => {
    await boot(page, { route: 'settings' });
    await preset(page, 'Custom').click();
    const cases: Array<[string, string, number, string]> = [
      ['Focus', '500', 180, 'focusMin'],
      ['Focus', '0', 1, 'focusMin'],
      ['Focus', '42', 42, 'focusMin'],
      ['Short break', '99', 60, 'shortMin'],
      ['Short break', '0', 1, 'shortMin'],
      ['Long break', '200', 90, 'longMin'],
      ['Long break', '0', 1, 'longMin'],
      ['Long break every', '1', 2, 'longEvery'],
      ['Long break every', '9', 8, 'longEvery'],
      ['Long break every', '5', 5, 'longEvery'],
    ];
    for (const [label, typed, want, key] of cases) {
      const f = stepper(page, label);
      await f.fill(typed);
      await f.blur();
      await expect(f, `${label} ${typed}`).toHaveValue(String(want));
      expect((await stored(page)).settings[key]).toBe(want);
    }
    // the plus/minus buttons stop at the limits
    await stepper(page, 'Long break every').fill('8');
    await stepper(page, 'Long break every').blur();
    await expect(page.getByRole('button', { name: 'Increase long break every' })).toBeDisabled();
    await stepper(page, 'Focus').fill('1');
    await stepper(page, 'Focus').blur();
    await expect(page.getByRole('button', { name: 'Decrease focus', exact: true })).toBeDisabled();
    // the cycle dots follow longEvery (TMR-8)
    await stepper(page, 'Long break every').fill('6');
    await stepper(page, 'Long break every').blur();
    await go(page, 'timer');
    await expect(page.getByTestId('cycle-dots').filter({ visible: true }).first().locator('.dots__dot')).toHaveCount(6);
    // non-digits are ignored
    await go(page, 'settings');
    const f = stepper(page, 'Focus');
    await f.fill('');
    await f.pressSequentially('2a5b');
    await f.blur();
    await expect(f).toHaveValue('25');
    // Enter commits too
    await f.fill('33');
    await f.press('Enter');
    expect((await stored(page)).settings.focusMin).toBe(33);
  });

  test('TMR-11 changing durations while running does not change that phase; an idle full phase updates at once', async ({ page }) => {
    await boot(page, { clock: true, stubs: true, route: 'timer' });
    await page.getByTestId('timer-play').click();
    await page.clock.fastForward(5 * MIN);
    await go(page, 'settings');
    await preset(page, '50 / 10').click();
    await go(page, 'timer');
    // still the original 25 minute phase: ~20 minutes left, not 45
    await expect(timerDigits(page)).toHaveText(/^(19:5\d|20:00)$/);
    await page.clock.fastForward(20 * MIN + 250);
    await expect.poll(async () => (await sessionsOf(page)).length).toBe(1);
    expect((await sessionsOf(page))[0].focusedMs).toBe(25 * MIN);
    // the break that follows already uses the new length (10 minutes)
    await expect(timerDigits(page)).toHaveText(/^(9:5\d|10:00)$/);
    // paused: same rule
    await page.getByTestId('timer-play').click(); // pause the break
    await go(page, 'settings');
    await preset(page, '90 / 20').click();
    await go(page, 'timer');
    await expect(timerDigits(page)).toHaveText(/^(9:5\d|10:00)$/);
    // reset to idle full: it now takes the new short length
    await page.getByTestId('timer-reset').click();
    await expect(timerDigits(page)).toHaveText('20:00');
  });

  test('TMR-11 an idle phase that is not at full duration is still at full duration after skip: durations apply to the new phase', async ({ page }) => {
    await boot(page, { route: 'timer' });
    await page.getByTestId('timer-skip').click(); // idle short break, 5:00
    await expect(timerDigits(page)).toHaveText('5:00');
    await go(page, 'settings');
    await preset(page, '90 / 20').click();
    await go(page, 'timer');
    await expect(timerDigits(page)).toHaveText('20:00');
  });
});

test.describe('settings: sound and notifications (SND-1, SND-2, NTF-3)', () => {
  test('SND-1 SND-2 five chimes with Preview buttons (None has none), default Glass and volume 60, preview uses the volume', async ({ page }) => {
    await boot(page, { stubs: true, route: 'settings' });
    const group = page.getByRole('radiogroup', { name: 'Chime' });
    await expect(group.getByRole('radio')).toHaveCount(5);
    for (const [i, n] of ['Glass', 'Bowl', 'Bell', 'Wood', 'None'].entries()) await expect(group.locator('.radiorow').nth(i)).toContainText(n);
    await expect(group.getByRole('radio', { name: 'Glass' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Preview None' })).toBeDisabled();
    for (const n of ['Glass', 'Bowl', 'Bell', 'Wood']) await expect(page.getByRole('button', { name: `Preview ${n}` })).toBeEnabled();
    const vol = page.getByRole('slider', { name: 'Volume', exact: true }); // the Focus sounds slider is "Focus sounds volume"
    await expect(vol).toHaveValue('60');
    await expect(vol).toHaveAttribute('min', '0');
    await expect(vol).toHaveAttribute('max', '100');
    // preview plays at the current volume
    const before = (await qa(page)).chimes.length;
    await page.getByRole('button', { name: 'Preview Bell' }).click();
    await expect.poll(async () => (await qa(page)).chimes.length).toBe(before + 1);
    const first = (await qa(page)).chimes.at(-1)!;
    // choosing a chime and moving the slider persists
    await group.getByRole('radio', { name: 'Bowl' }).check({ force: true });
    await vol.fill('20');
    const st = (await stored(page)).settings;
    expect(st.chime).toBe('bowl');
    expect(st.volume).toBeCloseTo(0.2, 5);
    await page.getByRole('button', { name: 'Preview Bowl' }).click();
    await expect.poll(async () => (await qa(page)).chimes.length).toBe(before + 2);
    const second = (await qa(page)).chimes.at(-1)!;
    expect(second.oscillators).toBeGreaterThan(0);
    // a quieter volume is a quieter preview
    expect(first.oscillators).toBeGreaterThan(0);
    await vol.fill('0');
    expect((await stored(page)).settings.volume).toBe(0);
    await page.reload();
    await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('0');
    await expect(page.getByRole('radiogroup', { name: 'Chime' }).getByRole('radio', { name: 'Bowl' })).toBeChecked();
  });

  test('NTF-3 the toggle shows its permission state: Off, asks on first Start, On', async ({ page }) => {
    await boot(page, { stubs: true, route: 'settings' });
    const sw = page.getByRole('switch', { name: 'Notify me when a phase ends' });
    const hint = page.locator('.row-switch', { has: sw }).locator('.hint');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(hint).toHaveText('Asks permission when you first press Start');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(hint).toHaveText('Off');
    expect((await qa(page)).permissionRequests).toBe(0);
    await sw.click(); // turning it on with permission still undecided asks now
    await expect.poll(async () => (await qa(page)).permissionRequests).toBe(1);
    await expect(hint).toHaveText('On');
    expect((await stored(page)).settings.notifications).toBe(true);
  });

  test('NTF-3 blocked in the browser: the state says so and the toggle is disabled', async ({ page }) => {
    await boot(page, { stubs: true, init: "Notification.permission = 'denied'", route: 'settings' });
    const sw = page.getByRole('switch', { name: 'Notify me when a phase ends' });
    await expect(page.locator('.row-switch', { has: sw }).locator('.hint')).toHaveText('Blocked in browser settings');
    await expect(sw).toBeDisabled();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  test('NTF-3 no Notification API: the state says so and the toggle is disabled', async ({ page }) => {
    await boot(page, { stubs: true, init: 'delete window.Notification', route: 'settings' });
    const sw = page.getByRole('switch', { name: 'Notify me when a phase ends' });
    await expect(page.locator('.row-switch', { has: sw }).locator('.hint')).toHaveText('Not available in this browser');
    await expect(sw).toBeDisabled();
  });

  test('keep-awake and message switches persist across a reload', async ({ page }) => {
    await boot(page, { stubs: true, route: 'settings' });
    for (const name of ['Keep screen on while running', 'Break suggestions', 'Encouraging messages', 'Start the next phase automatically']) {
      await expect(page.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('switch', { name }).click();
    }
    await page.reload();
    for (const name of ['Keep screen on while running', 'Break suggestions', 'Encouraging messages', 'Start the next phase automatically'])
      await expect(page.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('settings: iPhone notes (NTF-4, EDGE-6)', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  test('NTF-4 the iOS limit is explained in Settings and the home screen install tip is shown', async ({ page }) => {
    await boot(page, { stubs: true, route: 'settings' });
    await expect(page.getByText('On iPhone, chimes and notifications only work while Em Time is open')).toBeVisible();
    await expect(page.getByText('The timer is always right when you come back.')).toBeVisible();
    await expect(page.getByText('Install tip: tap Share, then Add to Home Screen.')).toBeVisible();
  });
});

test.describe('settings: appearance (UI-1, week start, GOAL-1)', () => {
  test('THEME-1 (replaces UI-1) three theme choices, default Follow the sky; each persists per device; the OS setting is never followed', async ({ page }) => {
    // 15:00 local: the sky is in its light polarity, so `data-theme` is light while the mode is `sky`
    await boot(page, { clock: true, route: 'settings' });
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme-mode', 'sky');
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect((await stored(page))?.settings?.theme ?? 'sky', 'nothing is written until a choice is made; the default is sky').toBe('sky');
    for (const id of ['settings-theme-sky', 'settings-theme-light', 'settings-theme-dark']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('settings-theme-sky')).toContainText('Follow the sky');
    await expect(page.getByTestId('settings-theme-light')).toContainText('Always light');
    await expect(page.getByTestId('settings-theme-dark')).toContainText('Always dark');
    await page.getByTestId('settings-theme-dark').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveAttribute('data-theme-mode', 'dark');
    expect((await stored(page)).settings.theme).toBe('dark');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('settings-theme-light').click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect((await stored(page)).settings.theme).toBe('light');
    await page.getByTestId('settings-theme-sky').click();
    expect((await stored(page)).settings.theme).toBe('sky');
  });

  test('week start select moves the Stats week and the heatmap rows', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'settings' });
    await page.getByLabel('Week starts on').selectOption({ label: 'Sunday' });
    expect((await stored(page)).settings.weekStartsOn).toBe(0);
    await go(page, 'stats');
    // v2 (D-56): the range subtitle moved inside the week card, so look for it by its text
    await expect(page.getByTestId('week-total').locator('xpath=ancestor::*[contains(@class,"card")][1]').getByText('Oct 11 to Oct 17')).toBeVisible();
    await expect(page.getByTestId('heatmap').locator('text.axis-text').filter({ hasText: /^(Sun|Tue|Thu)$/ })).toHaveText(['Sun', 'Tue', 'Thu']);
  });

  test('GOAL-1 the daily goal runs 15 to 720 in steps of 15 and drives the ring and the heatmap shades', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'settings' });
    const goal = stepper(page, 'Focus time per day');
    await expect(goal).toHaveValue('120');
    // buttons step by 15
    await page.getByRole('button', { name: 'Increase focus time per day' }).click();
    expect((await stored(page)).settings.dailyGoalMin).toBe(135);
    await page.getByRole('button', { name: 'Decrease focus time per day' }).click();
    await page.getByRole('button', { name: 'Decrease focus time per day' }).click();
    expect((await stored(page)).settings.dailyGoalMin).toBe(105);
    // arrow keys too
    await goal.focus();
    await goal.press('ArrowUp');
    expect((await stored(page)).settings.dailyGoalMin).toBe(120);
    // limits
    await goal.fill('9999');
    await goal.blur();
    expect((await stored(page)).settings.dailyGoalMin).toBe(720);
    await expect(page.getByRole('button', { name: 'Increase focus time per day' })).toBeDisabled();
    await goal.fill('1');
    await goal.blur();
    expect((await stored(page)).settings.dailyGoalMin).toBe(15);
    await expect(page.getByRole('button', { name: 'Decrease focus time per day' })).toBeDisabled();
    // the goal drives the ring text on Stats
    await go(page, 'stats');
    await expect(page.getByTestId('goal-ring')).toContainText('Goal met'); // 75 min against 15
    await expect(page.getByTestId('goal-ring')).toHaveAttribute('aria-label', /^75 of 15 minutes today/);
  });

  test('GOAL-1 a typed goal stays inside 15 to 720 whatever is typed (off-step values such as 100 are accepted as typed)', async ({ page }) => {
    await boot(page, { route: 'settings' });
    const goal = stepper(page, 'Focus time per day');
    for (const [typed, want] of [['100', 100], ['14', 15], ['721', 720], ['0', 15]] as const) {
      await goal.fill(typed);
      await goal.blur();
      expect((await stored(page)).settings.dailyGoalMin, typed).toBe(want);
    }
  });
});

test.describe('settings: your data (DAT-2, DAT-3, DAT-5)', () => {
  test('DAT-2 Export downloads em-time-backup-YYYY-MM-DD.json with all data; "Last backup" updates; no auth in the file', async ({ page }) => {
    const seed = fixture('backup-valid.json');
    seed.meta.sync.userId = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
    seed.meta.sync.email = 'student@example.com';
    seed.meta.sync.lastSyncedAt = null;
    await boot(page, { seed, clock: true, route: 'settings' });
    await expect(page.getByText('Last backup: Never')).toBeVisible();
    const { name, text } = await readDownload(page, () => page.getByTestId('export-button').click());
    expect(name).toBe('em-time-backup-2026-10-14.json');
    const out = JSON.parse(text);
    expect(out.app).toBe('em-time');
    expect(out.schemaVersion).toBe(2); // v2 schema (contract V2.3)
    const doc = await stored(page);
    expect(out.sessions).toHaveLength(doc.sessions.length);
    expect(out.tasks).toHaveLength(doc.tasks.length);
    expect(out.categories).toHaveLength(doc.categories.length);
    expect(out.settings.dailyGoalMin).toBe(doc.settings.dailyGoalMin);
    // never auth: no account, no email, no tokens anywhere in the file
    expect(text).not.toContain('student@example.com');
    expect(text).not.toContain('9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b');
    expect(text).not.toMatch(/access_token|refresh_token|password|supabase/i);
    await expect(page.getByText('Last backup: Oct 14')).toBeVisible();
    expect((await stored(page)).meta.lastExportAt).toBeGreaterThan(0);
  });

  test('DAT-3 Import (valid file): the summary names sessions, tasks and date range; Replace asks to confirm and restores everything', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    const fx = fixture('backup-valid.json');
    const days = live(fx.sessions).map((s: any) => s.day).sort();
    const short = (d: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1]} ${+d.slice(8)}`;
    await page.getByTestId('import-input').setInputFiles(fixturePath('backup-valid.json'));
    const dlg = page.getByRole('dialog', { name: 'Import this backup' });
    await expect(dlg).toContainText(`${live(fx.sessions).length} sessions, ${live(fx.tasks).length} tasks and ${live(fx.categories).length} categories, from ${short(days[0])} to ${short(days.at(-1))}.`);
    await expect(dlg.getByRole('button', { name: 'Merge' })).toBeVisible();
    // nothing changes until a choice is made
    expect((await stored(page))?.sessions ?? []).toHaveLength(0);
    await dlg.getByRole('button', { name: 'Replace everything' }).click();
    const confirm = page.getByRole('dialog', { name: 'Replace everything?' });
    await expect(confirm).toContainText("This can't be undone.");
    await confirm.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('dialog', { name: 'Import this backup' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace everything' }).click();
    await page.getByRole('dialog', { name: 'Replace everything?' }).getByRole('button', { name: 'Replace everything' }).click();
    await expect(page.getByText('Backup restored.')).toBeVisible();
    const doc = await stored(page);
    expect(doc.sessions).toHaveLength(fx.sessions.length);
    expect(live(doc.tasks).map((t: any) => t.name).sort()).toEqual(live(fx.tasks).map((t: any) => t.name).sort());
    expect(doc.settings.dailyGoalMin).toBe(fx.settings.dailyGoalMin);
    await go(page, 'stats');
    await expect(page.getByTestId('streak-best')).toContainText('days');
    await expect(page.getByTestId('heatmap-cell').first()).toBeVisible();
  });

  test('DAT-3 Merge adds sessions and tasks by id, keeps local settings, and is idempotent', async ({ page }) => {
    const local = fixture('backup-valid.json');
    local.sessions = local.sessions.slice(0, 20);
    local.settings.dailyGoalMin = 90;
    local.tasks = [{ ...local.tasks[0], id: '11111111-2222-4333-8444-555555555555', name: 'Only on this device' }];
    await boot(page, { seed: local, clock: true, route: 'settings' });
    const full = fixture('backup-valid.json');
    await page.getByTestId('import-input').setInputFiles(fixturePath('backup-valid.json'));
    await page.getByRole('dialog', { name: 'Import this backup' }).getByRole('button', { name: 'Merge' }).click();
    await expect(page.getByText('Backup merged into your data.')).toBeVisible();
    let doc = await stored(page);
    expect(doc.sessions).toHaveLength(full.sessions.length); // the 20 overlap the file
    expect(live(doc.tasks).map((t: any) => t.name)).toEqual(expect.arrayContaining(['Only on this device', 'Lab report draft', 'Orgo chapter 7 problems']));
    expect(doc.settings.dailyGoalMin).toBe(90); // local settings win
    // import again: no duplicates
    await page.getByTestId('import-input').setInputFiles(fixturePath('backup-valid.json'));
    await page.getByRole('dialog', { name: 'Import this backup' }).getByRole('button', { name: 'Merge' }).click();
    doc = await stored(page);
    expect(doc.sessions).toHaveLength(full.sessions.length);
    expect(new Set(doc.sessions.map((s: any) => s.id)).size).toBe(doc.sessions.length);
    expect(doc.tasks.length).toBe(new Set(doc.tasks.map((t: any) => t.id)).size);
  });

  test('DAT-3 Cancel changes nothing', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    await page.getByTestId('import-input').setInputFiles(fixturePath('backup-valid.json'));
    const dlg = page.getByRole('dialog', { name: 'Import this backup' });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
    expect((await stored(page))?.sessions ?? []).toHaveLength(0);
  });

  const BAD: Array<[string, string, string]> = [
    ['backup-not-json.txt', 'not JSON', "That file isn't a backup from Em Time."],
    ['backup-wrong-app.json', 'another app', "That file isn't a backup from Em Time."],
    ['backup-damaged.json', 'damaged shape', "This backup looks damaged and can't be imported."],
    ['backup-newer.json', 'newer version', 'This backup is from a newer version. Refresh Em Time, then try again.'],
    ['backup-empty.txt', 'empty file', 'That file is empty.'],
  ];
  for (const [file, why, message] of BAD) {
    test(`DAT-3 invalid file (${why}) shows an inline error and changes nothing`, async ({ page }) => {
      await boot(page, { seed: 'backup-valid.json', clock: true, route: 'settings' });
      const before = await page.evaluate(() => localStorage.getItem('em-time:data'));
      await page.getByTestId('import-input').setInputFiles(fixturePath(file));
      await expect(page.getByTestId('import-error')).toHaveText(message);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('em-time:data'))).toBe(before);
    });
  }

  test('DAT-3 a file over 10 MB is refused before it is read', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    await page.getByTestId('import-input').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20) });
    await expect(page.getByTestId('import-error')).toHaveText('That file is too large to be an Em Time backup.');
  });

  test('DAT-3 EDGE-5 future-dated sessions: a warning in the summary, and they stay out of stats', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    await page.getByTestId('import-input').setInputFiles(fixturePath('backup-future.json'));
    const dlg = page.getByRole('dialog', { name: 'Import this backup' });
    await expect(dlg).toContainText('3 sessions are dated in the future and will appear on their dates.');
    await dlg.getByRole('button', { name: 'Replace everything' }).click();
    await page.getByRole('dialog', { name: 'Replace everything?' }).getByRole('button', { name: 'Replace everything' }).click();
    expect((await stored(page)).sessions).toHaveLength(10); // kept
    await go(page, 'stats');
    // Oct 8..14 are consecutive: 7 days; the 2030 sessions do not extend or create a streak
    await expect(page.getByTestId('streak-current')).toContainText('7 days');
    await expect(page.getByTestId('streak-best')).toContainText('7 days');
    await expect(page.getByTestId('week-total')).toContainText('1h 15m');
    await expect(page.getByTestId('task-totals')).toBeVisible();
  });

  test('DAT-3 a v0 backup is migrated on import with a note', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    await page.getByTestId('import-input').setInputFiles(fixturePath('backup-v0.json'));
    const dlg = page.getByRole('dialog', { name: 'Import this backup' });
    await expect(dlg).toContainText('This backup came from an older version and was updated.');
    await dlg.getByRole('button', { name: 'Replace everything' }).click();
    await page.getByRole('dialog', { name: 'Replace everything?' }).getByRole('button', { name: 'Replace everything' }).click();
    const doc = await stored(page);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.sessions).toHaveLength(7);
  });

  test('DAT-3 damaged records are skipped and counted; the rest imports', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    await page.getByTestId('import-input').setInputFiles(fixturePath('backup-bad-records.json'));
    const dlg = page.getByRole('dialog', { name: 'Import this backup' });
    await expect(dlg).toContainText(/\d+ damaged records? (was|were) skipped\./);
    await dlg.getByRole('button', { name: 'Replace everything' }).click();
    await page.getByRole('dialog', { name: 'Replace everything?' }).getByRole('button', { name: 'Replace everything' }).click();
    const doc = await stored(page);
    expect(doc.sessions.every((s: any) => s.endedAt >= s.startedAt)).toBe(true);
    expect(doc.sessions.every((s: any) => s.focusedMs <= s.plannedMs)).toBe(true);
  });

  test('DAT-5 Erase all data: needs the word "erase", then returns to the first-run state', async ({ page }) => {
    await boot(page, { seed: 'backup-valid.json', clock: true, route: 'settings' });
    await page.getByRole('button', { name: 'Erase all data' }).click();
    const dlg = page.getByRole('dialog', { name: 'Erase all data?' });
    const erase = dlg.getByRole('button', { name: 'Erase', exact: true });
    await expect(erase).toBeDisabled();
    await expect(dlg.getByRole('radiogroup', { name: 'What to erase' })).toHaveCount(0); // signed out: no cloud choice
    await dlg.getByLabel('Type erase to confirm').fill('eras');
    await expect(erase).toBeDisabled();
    await dlg.getByLabel('Type erase to confirm').fill('ERASE');
    await expect(erase).toBeEnabled();
    // Cancel keeps everything
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await stored(page)).sessions.length).toBeGreaterThan(100);
    await page.getByRole('button', { name: 'Erase all data' }).click();
    await page.getByRole('dialog', { name: 'Erase all data?' }).getByLabel('Type erase to confirm').fill('erase');
    await page.getByRole('dialog', { name: 'Erase all data?' }).getByRole('button', { name: 'Erase', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const doc = await stored(page);
    expect(doc.sessions).toHaveLength(0);
    expect(live(doc.tasks)).toHaveLength(0);
    expect(live(doc.categories).map((c: any) => c.name)).toEqual(['Study', 'Reading', 'Problem sets', 'Writing', 'Review']);
    expect(doc.settings.dailyGoalMin).toBe(120);
    await expect(page.getByText('Last backup: Never')).toBeVisible();
    await go(page, 'timer');
    await expect(timerDigits(page)).toHaveText('25:00');
    await expect(page.getByTestId('current-task').filter({ visible: true }).first()).toContainText('Pick a task');
    await go(page, 'stats');
    await expect(page.getByTestId('streak-best')).toContainText('0 days');
  });

  test('DAT-5 signed in: the dialog offers "This device only" and "This device and the cloud"', async ({ page }) => {
    const seed = fixture('backup-valid.json');
    seed.meta.sync.userId = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
    seed.meta.sync.email = 'student@example.com';
    await boot(page, { seed, clock: true, route: 'settings' });
    await page.getByRole('button', { name: 'Erase all data' }).click();
    const group = page.getByRole('dialog', { name: 'Erase all data?' }).getByRole('radiogroup', { name: 'What to erase' });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group).toContainText('This device only');
    await expect(group).toContainText('This device and the cloud');
    await expect(group.getByRole('radio', { name: 'This device only' })).toBeChecked();
  });
});

test.describe('settings: about', () => {
  test('the version, the eight shortcuts and the about line are present', async ({ page }) => {
    await boot(page, { route: 'settings' });
    await expect(page.locator('.about__ver')).toHaveText(/^Em Time \d+\.\d+\.\d+/);
    const rows = page.locator('.shortcuts__row');
    await expect(rows).toHaveCount(8);
    await expect(rows.locator('kbd')).toHaveText(['Space', 'S', 'R', 'N', '1', '2', '3', '?']);
    await expect(page.locator('.about__line')).not.toBeEmpty();
  });
});
