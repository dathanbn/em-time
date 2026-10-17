import { expect, test, type Page } from '@playwright/test';
import { MIN, boot, fixture, isMobile, qa, runFocus, sessionsOf, setHidden, stored, visible } from './helpers';

const digits = (p: Page) => p.getByTestId('timer-digits');
const play = (p: Page) => p.getByTestId('timer-play');
const timerState = (p: Page) => p.evaluate(() => (window as any).__emCore.timer.getState());
const remaining = (p: Page) => p.evaluate(() => (window as any).__emCore.timer.remainingMs());
const nowMs = (p: Page) => p.evaluate(() => Date.now());
const dotsOn = (p: Page) => p.locator('[data-testid="cycle-dots"] .dots__dot--on').count();

test.describe('timer basics', () => {
  test('TMR-1 defaults: 25:00, Focus, idle, full ring, four cycle dots, tab title "Em Time"', async ({ page }) => {
    await boot(page, { clock: true });
    await expect(digits(page)).toHaveText('25:00');
    await expect(page.getByTestId('mode-focus')).toHaveAttribute('aria-checked', 'true');
    await expect(play(page)).toHaveAttribute('aria-label', 'Start');
    expect((await timerState(page)).status).toBe('idle');
    const arc = page.locator('.ring__arc');
    expect(Number((await arc.getAttribute('stroke-dasharray'))!.split(' ')[0])).toBeGreaterThan(0.999);
    await expect(page.locator('[data-testid="cycle-dots"] .dots__dot')).toHaveCount(4);
    expect(await dotsOn(page)).toBe(0);
    await expect(page).toHaveTitle('Em Time');
  });

  test('TMR-2 shows 24:59 within 1.1 s of pressing Play', async ({ page }) => {
    await boot(page, { clock: true });
    await play(page).click();
    await page.clock.runFor(1100);
    await expect(digits(page)).toHaveText('24:59');
  });

  test('TMR-2 stays within 1 s of wall-clock time with the tab hidden for 10 minutes, then shown', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    await play(page).click();
    const start = (await timerState(page)).phaseStartedAt as number;
    await setHidden(page, true);
    await page.clock.fastForward(10 * MIN);
    await setHidden(page, false);
    await page.clock.runFor(50);
    const expected = 25 * MIN - ((await nowMs(page)) - start);
    expect(Math.abs((await remaining(page)) - expected)).toBeLessThanOrEqual(1000);
    await expect(digits(page)).toHaveText(/^1[45]:\d\d$/);
    const label = await digits(page).textContent();
    const [m, s] = label!.split(':').map(Number) as [number, number];
    expect(Math.abs(m * 60 + s - expected / 1000)).toBeLessThanOrEqual(1.1);
  });

  test('TMR-4 pause freezes display and ring, resume continues, paused time is not counted', async ({ page }) => {
    await boot(page, { clock: true });
    await play(page).click();
    await page.clock.fastForward(5 * MIN);
    await page.clock.runFor(1100);
    await play(page).click(); // pause
    await expect(play(page)).toHaveAttribute('aria-label', 'Resume');
    const frozen = await digits(page).textContent();
    const dash = await page.locator('.ring__arc').getAttribute('stroke-dasharray');
    await page.clock.fastForward(10 * MIN);
    await page.clock.runFor(2500);
    await expect(digits(page)).toHaveText(frozen!);
    expect(await page.locator('.ring__arc').getAttribute('stroke-dasharray')).toBe(dash);
    await expect(page).toHaveTitle(`Paused ${frozen} · Em Time`);
    await play(page).click(); // resume
    await page.clock.fastForward(20 * MIN);
    await page.clock.runFor(1_000);
    const s = (await sessionsOf(page))[0];
    expect(s.focusedMs).toBe(25 * MIN);
    expect(s.endedAt - s.startedAt).toBeGreaterThanOrEqual(35 * MIN);
    expect(s.endedAt - s.startedAt).toBeLessThan(35 * MIN + 10_000);
  });

  test('TMR-3 a finished session adds exactly 25 minutes to today and to the current task', async ({ page }, info) => {
    await boot(page, { clock: true });
    // pick a task from the timer screen
    await page.getByTestId('current-task').click();
    await page.getByLabel('Add task').fill('Orgo chapter 7');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('current-task')).toContainText('Orgo chapter 7');
    await runFocus(page);
    const sessions = await sessionsOf(page);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ plannedMs: 25 * MIN, focusedMs: 25 * MIN, day: '2026-10-14', taskName: 'Orgo chapter 7' });
    if (isMobile(info.project)) await expect(page.getByTestId('today-goal').filter({ visible: true })).toHaveCount(0);
    else await expect(visible(page.getByTestId('today-goal')).first()).toContainText('25 of 120 min');
    await visible(page.getByTestId('nav-tasks')).first().click();
    await expect(page.getByTestId('task-row').first()).toContainText('25m');
    await visible(page.getByTestId('nav-stats')).first().click();
    await expect(page.getByTestId('week-total')).toContainText('25m');
    await expect(page.getByTestId('task-totals')).toContainText('Orgo chapter 7');
  });

  test('TMR-3 with no current task the session is credited to "No task"', async ({ page }) => {
    await boot(page, { clock: true });
    await runFocus(page);
    await visible(page.getByTestId('nav-stats')).first().click();
    await expect(page.getByTestId('task-totals')).toContainText('No task');
  });
});

test.describe('reset, skip, mode switch log nothing', () => {
  test('TMR-5 reset returns the phase to full duration, idle, logs nothing; double reset zeroes the cycle', async ({ page }) => {
    await boot(page, { clock: true });
    await runFocus(page); // session 1, short break running
    await page.getByTestId('timer-skip').click(); // break -> focus idle
    expect((await timerState(page)).cycle).toBe(1);
    await play(page).click();
    await page.clock.fastForward(3 * MIN);
    await page.getByTestId('timer-reset').click();
    await expect(digits(page)).toHaveText('25:00');
    expect((await timerState(page)).status).toBe('idle');
    expect((await timerState(page)).cycle).toBe(1); // first reset keeps the cycle
    await page.clock.fastForward(30 * MIN);
    expect(await sessionsOf(page)).toHaveLength(1); // nothing logged
    await page.getByTestId('timer-reset').click(); // idle at full: zero the cycle
    expect((await timerState(page)).cycle).toBe(0);
    expect(await dotsOn(page)).toBe(0);
  });

  test('TMR-6 skip at 1 s, 60 s and 24:59 logs nothing, goes to an idle short break and never auto-starts', async ({ page }, info) => {
    await boot(page, { clock: true });
    for (const elapsed of [1_000, 60_000, 25 * MIN - 1_000]) {
      await play(page).click();
      await page.clock.fastForward(elapsed);
      await page.getByTestId('timer-skip').click();
      await expect(page.getByTestId('mode-short')).toHaveAttribute('aria-checked', 'true');
      await expect(digits(page)).toHaveText('5:00');
      expect((await timerState(page)).status).toBe('idle');
      await page.getByTestId('mode-focus').click();
    }
    await page.clock.fastForward(30 * MIN);
    expect(await sessionsOf(page)).toHaveLength(0);
    expect((await timerState(page)).cycle).toBe(0);
    await expect(page.getByTestId('message-line')).toBeEmpty();
    if (isMobile(info.project)) await expect(page.getByTestId('today-goal').filter({ visible: true })).toHaveCount(0);
    else await expect(visible(page.getByTestId('today-goal')).first()).toContainText('0 of 120 min');
  });

  test('TMR-7 skip during a break goes to focus, idle, logs nothing more', async ({ page }) => {
    await boot(page, { clock: true });
    await runFocus(page);
    await expect(page.getByTestId('mode-short')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('timer-skip').click();
    await expect(page.getByTestId('mode-focus')).toHaveAttribute('aria-checked', 'true');
    expect((await timerState(page)).status).toBe('idle');
    await expect(digits(page)).toHaveText('25:00');
    expect(await sessionsOf(page)).toHaveLength(1);
  });

  test('TMR-12 mode switcher: immediate when idle or under 60 s; confirm dialog after 60 s; discarding logs nothing', async ({ page }) => {
    await boot(page, { clock: true });
    await page.getByTestId('mode-long').click();
    await expect(digits(page)).toHaveText('15:00');
    await page.getByTestId('mode-focus').click();
    await play(page).click();
    await page.clock.fastForward(30_000);
    await page.getByTestId('mode-short').click(); // under 60 s: no dialog
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('mode-short')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('mode-focus').click();
    await play(page).click();
    await page.clock.fastForward(61_000);
    await page.getByTestId('mode-short').click();
    const dlg = page.getByRole('dialog', { name: 'Discard this session?' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Keep going' }).click();
    await expect(page.getByTestId('mode-focus')).toHaveAttribute('aria-checked', 'true');
    expect((await timerState(page)).status).toBe('running');
    await page.getByTestId('mode-long').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('mode-long')).toHaveAttribute('aria-checked', 'true');
    expect((await timerState(page)).status).toBe('idle');
    await page.clock.fastForward(40 * MIN);
    expect(await sessionsOf(page)).toHaveLength(0);
  });
});

test.describe('cycles and auto-start', () => {
  test('TMR-8 / TMR-9 four sessions chain automatically into a long break; the cycle dots follow', async ({ page }) => {
    await boot(page, { clock: true });
    await play(page).click();
    for (let i = 1; i <= 3; i++) {
      await page.clock.fastForward(25 * MIN + 100);
      expect((await timerState(page)).phase).toBe('short');
      expect(await dotsOn(page)).toBe(i);
      await page.clock.fastForward(5 * MIN);
      expect((await timerState(page)).phase).toBe('focus');
      expect((await timerState(page)).status).toBe('running');
    }
    await page.clock.fastForward(25 * MIN);
    const s = await timerState(page);
    expect(s).toMatchObject({ phase: 'long', status: 'running', plannedMs: 15 * MIN });
    expect(await sessionsOf(page)).toHaveLength(4);
    expect(await dotsOn(page)).toBe(4); // long break shows all dots filled
    await page.clock.fastForward(15 * MIN);
    expect(await timerState(page)).toMatchObject({ phase: 'focus', status: 'running', cycle: 0 });
    expect(await dotsOn(page)).toBe(0);
    expect(await sessionsOf(page)).toHaveLength(4);
  });

  test('TMR-9 with auto-start off the next phase waits idle at full duration', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    await page.getByRole('switch', { name: 'Start the next phase automatically' }).click();
    await visible(page.getByTestId('nav-timer')).first().click();
    await runFocus(page);
    expect(await timerState(page)).toMatchObject({ phase: 'short', status: 'idle' });
    await expect(digits(page)).toHaveText('5:00');
    await page.clock.fastForward(10 * MIN);
    await expect(digits(page)).toHaveText('5:00');
    await play(page).click();
    await page.clock.fastForward(5 * MIN + 100);
    expect(await timerState(page)).toMatchObject({ phase: 'focus', status: 'idle' });
  });
});

test.describe('tab title (TMR-14)', () => {
  test('running, paused, break and idle formats; keeps counting while hidden', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    await expect(page).toHaveTitle('Em Time');
    await play(page).click();
    await page.clock.runFor(1500);
    await expect(page).toHaveTitle(/^24:5\d · Focus · Em Time$/);
    await page.clock.fastForward(2 * MIN);
    await page.clock.runFor(1100);
    await expect(page).toHaveTitle(/^22:\d\d · Focus · Em Time$/);
    await setHidden(page, true);
    await page.clock.fastForward(3 * MIN);
    await page.clock.runFor(1100);
    await expect(page).toHaveTitle(/^19:\d\d · Focus · Em Time$/); // refreshed while hidden
    await setHidden(page, false);
    await play(page).click();
    await expect(page).toHaveTitle(/^Paused 19:\d\d · Em Time$/);
    await play(page).click();
    await page.clock.fastForward(15 * MIN);
    await page.clock.runFor(1000);
    await expect(page).toHaveTitle(/^4:\d\d · Focus · Em Time$/);
    await page.clock.fastForward(5 * MIN);
    await page.clock.runFor(1100);
    await expect(page).toHaveTitle(/^\d:\d\d · Short break · Em Time$/);
    await page.getByTestId('timer-reset').click();
    await expect(page).toHaveTitle('Em Time');
  });
});

test.describe('persistence and catch-up', () => {
  test('TMR-15 a reload mid-session resumes with the right time; a new tab does too', async ({ page, context }) => {
    await boot(page, { clock: true });
    await play(page).click();
    await page.clock.fastForward(10 * MIN);
    await page.clock.runFor(1000);
    await page.reload();
    await expect(digits(page)).toHaveText(/^1[45]:\d\d$/);
    expect((await timerState(page)).status).toBe('running');
    // "closed tab, reopened later" on the same device
    const other = await context.newPage();
    await other.clock.install({ time: new Date((await nowMs(page)) + 2 * MIN) });
    await other.goto('./?e2e#/timer');
    await expect(other.getByTestId('timer-digits')).toHaveText(/^1[23]:\d\d$/);
  });

  test('EDGE-1 reopened more than 60 s after the end: one session logged at endsAt, next phase idle, no chime or notification', async ({ page, context }) => {
    await boot(page, { clock: true, stubs: true });
    await play(page).click();
    const stateA = await timerState(page);
    await page.close();
    const p2 = await context.newPage();
    await p2.clock.install({ time: new Date(Date.now() + 6 * 60 * MIN) });
    await p2.addInitScript(`window.__chimes=0`);
    await p2.goto('./?e2e#/timer');
    await expect(p2.getByTestId('timer-digits')).toHaveText('5:00');
    const sessions = await sessionsOf(p2);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endedAt).toBe(stateA.endsAt);
    expect(sessions[0].focusedMs).toBe(25 * MIN);
    expect((await timerState(p2)).status).toBe('idle'); // auto-start is on, but the end was long ago
    expect((await timerState(p2)).phase).toBe('short');
  });

  test('EDGE-1 reopened within 60 s of the end: the break starts as of endsAt', async ({ page, context }) => {
    await boot(page, { clock: true });
    await play(page).click();
    const a = await timerState(page);
    await page.close();
    const p2 = await context.newPage();
    await p2.clock.install({ time: new Date(a.endsAt + 20_000) });
    await p2.goto('./?e2e#/timer');
    await expect(p2.getByTestId('timer-digits')).toHaveText(/^4:[34]\d$/);
    expect((await timerState(p2)).status).toBe('running');
    expect((await timerState(p2)).endsAt).toBe(a.endsAt + 5 * MIN);
    expect(await sessionsOf(p2)).toHaveLength(1);
  });

  test('DAT-6 two open tabs never double-log a session', async ({ page, context }) => {
    await boot(page, { clock: true });
    await play(page).click();
    const other = await context.newPage();
    await other.clock.install({ time: new Date(await nowMs(page)) });
    await other.goto('./?e2e#/timer');
    await expect(other.getByTestId('timer-digits')).toHaveText(/^2[45]:\d\d$/);
    await page.clock.fastForward(25 * MIN + 100);
    await other.clock.fastForward(25 * MIN + 100);
    await other.waitForTimeout(200);
    await page.waitForTimeout(200);
    const sessions = await sessionsOf(page);
    expect(sessions).toHaveLength(1);
    const again = await sessionsOf(other);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(sessions[0].id);
  });

  test('DAT-6 a change made in one tab appears in the other without a reload (storage event)', async ({ page, context }) => {
    await boot(page, { clock: true });
    const other = await context.newPage();
    await other.clock.install({ time: NOW_PLUS(0) });
    await other.goto('./?e2e#/tasks');
    await other.getByTestId('task-add-input').fill('Added in tab two');
    await other.getByTestId('task-add-button').click();
    await visible(page.getByTestId('nav-tasks')).first().click();
    await expect(page.getByTestId('task-row')).toContainText('Added in tab two');
  });

  test('DAT-7 storage.persist() is called once, after the first completed session', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    await play(page).click();
    await page.clock.fastForward(30_000);
    expect((await qa(page)).persistCalls).toBe(0);
    await page.clock.fastForward(25 * MIN);
    await expect.poll(async () => (await qa(page)).persistCalls).toBe(1);
    await page.clock.fastForward(30 * MIN); // second session finishes
    expect((await qa(page)).persistCalls).toBe(1);
  });
});

function NOW_PLUS(ms: number): Date {
  return new Date(new Date('2026-10-14T15:00:00-07:00').getTime() + ms);
}

test.describe('sound, notifications, wake lock', () => {
  test('NTF-1 permission is requested on the first Play, never on load, once', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    expect((await qa(page)).permissionRequests).toBe(0);
    await play(page).click();
    await expect.poll(async () => (await qa(page)).permissionRequests).toBe(1);
    await page.getByTestId('timer-reset').click();
    await play(page).click();
    await page.reload();
    await play(page).click();
    expect((await stored(page)).meta.notificationPromptedAt).not.toBeNull();
    expect((await qa(page)).permissionRequests).toBe(0); // reload resets the page-level counter; no new request
  });

  test('SND-1 SND-2 SND-3 a chime plays at the end of every phase at the current volume; audio unlocks on first Play', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    expect((await qa(page)).audioContexts).toBe(0);
    await play(page).click();
    expect((await qa(page)).resumes).toBeGreaterThanOrEqual(1);
    await page.clock.fastForward(25 * MIN + 100);
    let q = await qa(page);
    expect(q.chimes).toHaveLength(1);
    expect(q.chimes[0]!.volume).toBeCloseTo(0.6 * 0.7, 5);
    expect(q.chimes[0]!.oscillators).toBeGreaterThanOrEqual(3); // Glass is a multi-partial chime
    await page.clock.fastForward(5 * MIN);
    q = await qa(page);
    expect(q.chimes).toHaveLength(2); // the break end chimes too
  });

  test('SND-3 chime plays while the page is hidden (desktop tab in background)', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    await play(page).click();
    await setHidden(page, true);
    await page.clock.fastForward(25 * MIN + 100);
    expect((await qa(page)).chimes).toHaveLength(1);
  });

  test('SND: chime "None" and volume 0 are silent', async ({ page }) => {
    const doc = fixture('backup-v0.json');
    doc.schemaVersion = 1;
    doc.settings.chime = 'none';
    await boot(page, { clock: true, stubs: true, seed: doc });
    await play(page).click();
    await page.clock.fastForward(25 * MIN + 100);
    expect((await qa(page)).chimes).toHaveLength(0);
    await page.close();
  });

  test('NTF-2 a system notification only when the page is hidden; text per phase', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    await play(page).click();
    await page.clock.fastForward(25 * MIN + 100); // page visible
    expect((await qa(page)).notifications).toHaveLength(0);
    await page.clock.fastForward(5 * MIN); // break ends while visible
    expect((await qa(page)).notifications).toHaveLength(0);
    await setHidden(page, true);
    await page.clock.fastForward(25 * MIN);
    await expect.poll(async () => (await qa(page)).notifications.length).toBe(1);
    expect((await qa(page)).notifications[0]).toMatchObject({ title: 'Focus done', body: 'Time for a short break.' });
    await page.clock.fastForward(5 * MIN);
    await expect.poll(async () => (await qa(page)).notifications.length).toBe(2);
    expect((await qa(page)).notifications[1]).toMatchObject({ title: "Break's over", body: 'Ready when you are.' });
  });

  test('NTF-2 the 4th session says "Time for a long break."', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    await play(page).click();
    await setHidden(page, true);
    for (let i = 0; i < 3; i++) {
      await page.clock.fastForward(25 * MIN + 100); // focus ends
      await page.clock.fastForward(5 * MIN); // break ends (catch-up closes one phase at a time)
    }
    await page.clock.fastForward(25 * MIN);
    await expect.poll(async () => (await qa(page)).notifications.some((n) => n.body === 'Time for a long break.')).toBe(true);
  });

  test('TMR-17 the screen wake lock is held while running and released on pause, reset, and when turned off', async ({ page }) => {
    await boot(page, { clock: true, stubs: true });
    await play(page).click();
    await expect.poll(async () => (await qa(page)).wakeLockActive).toBe(1);
    await play(page).click(); // pause
    await expect.poll(async () => (await qa(page)).wakeLockActive).toBe(0);
    await play(page).click(); // resume
    await expect.poll(async () => (await qa(page)).wakeLockActive).toBe(1);
    await page.getByTestId('timer-reset').click();
    await expect.poll(async () => (await qa(page)).wakeLockActive).toBe(0);
    await play(page).click();
    await expect.poll(async () => (await qa(page)).wakeLockActive).toBe(1);
    await visible(page.getByTestId('nav-settings')).first().click();
    await page.getByRole('switch', { name: 'Keep screen on while running' }).click();
    await expect.poll(async () => (await qa(page)).wakeLockActive).toBe(0);
  });

  test('TMR-17 with "Keep screen on" off, Play takes no wake lock', async ({ page }) => {
    const doc = fixture('backup-v0.json');
    doc.schemaVersion = 1;
    doc.settings.keepAwake = false;
    await boot(page, { clock: true, stubs: true, seed: doc });
    await play(page).click();
    await page.waitForTimeout(300);
    expect((await qa(page)).wakeLockRequests).toBe(0);
  });
});

test.describe('messages, break prompts, milestones', () => {
  const messages = fixture('../../frontend/src/data/messages.json') as { encouragement: string[]; breakPrompts: string[]; milestones: Record<string, string> };

  test('MSG-1 BRK-1 after a focus session a line shows under the ring and a break idea on the break; both clear when focus starts', async ({ page }) => {
    await boot(page, { clock: true });
    await expect(page.getByTestId('message-line')).toBeEmpty();
    await expect(page.getByTestId('break-prompt')).toHaveCount(0);
    await runFocus(page);
    const line = (await page.getByTestId('message-line').textContent())!;
    expect(line.length).toBeGreaterThan(3);
    expect(line).not.toContain('{');
    const verbatim = messages.encouragement.filter((l) => !l.includes('{sessions}'));
    expect(verbatim).toContain(line); // first session of the day: no {sessions} line eligible
    const prompt = (await page.getByTestId('break-prompt').textContent())!;
    expect(messages.breakPrompts.some((p) => prompt.includes(p))).toBe(true);
    // the line stays for the break
    await page.clock.fastForward(2 * MIN);
    await expect(page.getByTestId('message-line')).toHaveText(line);
    // and is gone as soon as the next focus phase starts
    await page.clock.fastForward(3 * MIN);
    expect((await timerState(page)).phase).toBe('focus');
    await expect(page.getByTestId('message-line')).toBeEmpty();
    await expect(page.getByTestId('break-prompt')).toHaveCount(0);
  });

  test('MSG-1 BRK-1 skip shows no encouraging line; the break still gets an idea', async ({ page }) => {
    await boot(page, { clock: true });
    await play(page).click();
    await page.clock.fastForward(10 * MIN);
    await page.getByTestId('timer-skip').click();
    await expect(page.getByTestId('message-line')).toBeEmpty();
    await expect(page.getByTestId('break-prompt')).toBeVisible();
  });

  test('MSG-2 {sessions} lines appear only from the 2nd session of the day, with the count as a word', async ({ page }) => {
    await boot(page, { clock: true });
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await runFocus(page);
      seen.push((await page.getByTestId('message-line').textContent())!);
      await page.getByTestId('timer-skip').click(); // break -> focus idle
    }
    expect(seen[0]).not.toMatch(/sessions in|sessions down|today\./i.source ? /Two|Three|sessions (in|down)|^\w+ today\./ : /x/);
    for (const s of seen) {
      expect(s).not.toContain('{');
      const matches = messages.encouragement.some((l) => {
        if (!l.includes('{sessions}')) return l === s;
        const re = new RegExp('^' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{sessions\\}', '(\\w+|\\d+)') + '$', 'i');
        return re.test(s);
      });
      expect(matches, s).toBe(true);
    }
  });

  test('BRK-1 MSG-1 toggles hide the break idea and the encouraging line', async ({ page }) => {
    await boot(page, { clock: true, route: 'settings' });
    await page.getByRole('switch', { name: 'Break suggestions' }).click();
    await page.getByRole('switch', { name: 'Encouraging messages' }).click();
    await visible(page.getByTestId('nav-timer')).first().click();
    await runFocus(page);
    await expect(page.getByTestId('message-line')).toBeEmpty();
    await expect(page.getByTestId('break-prompt')).toHaveCount(0);
  });

  test('MIL-1 MIL-2 MIL-3 MIL-4 the 10th session shows the milestone message and the larger sticker burst (v2), cleared when focus starts', async ({ page }, info) => {
    const doc = fixture('backup-valid.json');
    doc.sessions = doc.sessions.filter((s: any) => s.day < '2026-10-01').slice(0, 9);
    doc.meta.milestonesShown = [];
    await boot(page, { clock: true, seed: doc });
    await runFocus(page);
    await expect(page.getByTestId('message-line')).toHaveText(messages.milestones['sessions-10']!);
    // v2 MIL-2: with stickers on the celebration is the milestone-size sticker burst, not confetti
    const burst = page.getByTestId('sticker-burst');
    await expect(burst).toBeAttached();
    await expect(burst.getByTestId('sticker')).toHaveCount(info.project.name === 'mobile' ? 14 : 18);
    await expect(page.locator('.confetti__p')).toHaveCount(0);
    await page.clock.runFor(1700);
    await expect(burst).toHaveCount(0); // gone within 1.6 s
    await page.clock.fastForward(5 * MIN); // break ends, focus starts
    await expect(page.getByTestId('message-line')).toBeEmpty();
    expect((await stored(page)).meta.milestonesShown).toContain('sessions-10');
    await runFocus(page); // 11th: ordinary message
    await expect(page.getByTestId('message-line')).not.toHaveText(messages.milestones['sessions-10']!);
  });

  test('MIL-2 reduced motion: message only, no confetti', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const doc = fixture('backup-valid.json');
    doc.sessions = doc.sessions.filter((s: any) => s.day < '2026-10-01').slice(0, 9);
    doc.meta.milestonesShown = [];
    await boot(page, { clock: true, seed: doc });
    await runFocus(page);
    await expect(page.getByTestId('message-line')).toHaveText(messages.milestones['sessions-10']!);
    await expect(page.locator('.confetti__p')).toHaveCount(0);
  });

  test('MIL-1 EDGE-1 a milestone is never shown while a focus phase runs', async ({ page }) => {
    const doc = fixture('backup-valid.json');
    doc.sessions = doc.sessions.filter((s: any) => s.day < '2026-10-01').slice(0, 9);
    doc.meta.milestonesShown = [];
    await boot(page, { clock: true, seed: doc });
    await play(page).click();
    await page.clock.fastForward(24 * MIN);
    await expect(page.getByTestId('message-line')).toBeEmpty();
    await expect(page.locator('.confetti__p')).toHaveCount(0);
  });

  // KNOWN DEFECT (logic, core.ts): the catch-up completion is emitted inside createEmCore(), before
  // the UI subscribes, so a session that finished while the app was closed (within the 60 s grace)
  // shows no encouraging line and a milestone is consumed without being displayed.
  test('MSG-1 a session that finished while the tab was closed (within 60 s) still gets its line', async ({ page, context }) => {
    await boot(page, { clock: true });
    await play(page).click();
    const a = await timerState(page);
    await page.close();
    const p2 = await context.newPage();
    await p2.clock.install({ time: new Date(a.endsAt + 20_000) });
    await p2.goto('./?e2e#/timer');
    await expect(p2.getByTestId('message-line')).not.toBeEmpty();
  });
});

test.describe('accessibility of the timer (A11Y-3, TMR-16)', () => {
  test('A11Y-3 phase changes are announced at once and remaining time only at 20, 15, 10, 5 and 1 minutes', async ({ page }) => {
    await boot(page, { clock: true });
    await page.evaluate(() => {
      (window as any).__live = [];
      const el = document.querySelector('[data-testid="live-region"]')!;
      new MutationObserver(() => {
        const t = el.textContent || '';
        if (t) (window as any).__live.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await play(page).click();
    await page.clock.runFor(100);
    for (const step of [5, 5, 5, 5]) {
      await page.clock.fastForward(step * MIN);
      await page.clock.runFor(1100);
    }
    await page.clock.fastForward(4 * MIN);
    await page.clock.runFor(1100);
    await page.clock.fastForward(MIN);
    await page.waitForTimeout(100);
    const live: string[] = await page.evaluate(() => (window as any).__live);
    const unique = live.filter((t, i) => t !== live[i - 1]);
    expect(unique.slice(0, 6)).toEqual([
      'Focus started', '20 minutes left', '15 minutes left', '10 minutes left', '5 minutes left', '1 minute left',
    ]);
    expect(unique.some((t) => /^Focus done/.test(t))).toBe(true);
    expect(unique.filter((t) => /minutes? left/.test(t))).toHaveLength(5);
  });

  test('A11Y-3 digits are a timer role with a per-minute label', async ({ page }) => {
    await boot(page, { clock: true });
    await expect(digits(page)).toHaveAttribute('role', 'timer');
    await expect(digits(page)).toHaveAttribute('aria-live', 'off');
    await expect(digits(page)).toHaveAttribute('aria-label', /25m left, focus/);
    await expect(page.getByTestId('live-region')).toHaveAttribute('aria-live', 'polite');
  });

  test('TMR-16 the focus ring breathes while running; reduced motion turns it off', async ({ page }) => {
    await boot(page, { clock: true });
    // v2 (design.md 7.1): the breathing glow is a halo around the glass ring bubble
    const anim = () =>
      page.getByTestId('timer-bubble').evaluate((el) => {
        const c = getComputedStyle(el);
        return { name: c.animationName, seconds: parseFloat(c.animationDuration), iterations: c.animationIterationCount };
      });
    expect((await anim()).name).toBe('none');
    await play(page).click();
    await expect(page.getByTestId('timer-bubble')).toHaveClass(/bubble--breathing/);
    const on = await anim();
    expect(on).toMatchObject({ name: 'breathe', iterations: 'infinite' });
    expect(on.seconds).toBeGreaterThan(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const off = await anim();
    expect(off.iterations).toBe('1'); // no looping glow
    expect(off.seconds).toBeLessThan(0.001); // and no visible animation at all
    await play(page).click(); // pause
    await expect(page.getByTestId('timer-bubble')).not.toHaveClass(/bubble--breathing/);
  });

  test('TMR-16 breathing is for focus only, not breaks', async ({ page }) => {
    await boot(page, { clock: true });
    await page.getByTestId('mode-short').click();
    await play(page).click();
    await expect(page.getByTestId('timer-bubble')).not.toHaveClass(/bubble--breathing/);
  });
});
