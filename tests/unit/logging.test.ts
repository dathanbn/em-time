import { describe, expect, it } from 'vitest';
import {
  createDefaultData,
  createMemoryAdapter,
  mergeData,
  saveData,
  sessionId,
  STORAGE_KEY,
  type AppData,
  type PhaseCompleteEvent,
} from '@core';
import { at, DEVICE_A, DEVICE_B, expectedDay, mkSession } from './helpers';
import { FakeClock, makeCore, minutes } from './harness';

const run25 = (clock: FakeClock) => clock.advance(minutes(25) + 10);

describe('sessions are logged only when a focus phase reaches 00:00 (TMR-3, EDGE-2, R-2)', () => {
  it('a finished 25 minute session adds exactly one session to today, the week and "No task"', () => {
    const { core, clock, events } = makeCore();
    const start = clock.now();
    core.timer.start();
    run25(clock);
    const s = core.store.get().sessions;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      startedAt: start,
      endedAt: start + minutes(25),
      plannedMs: minutes(25),
      focusedMs: minutes(25),
      taskId: null,
      day: expectedDay(2026, 10, 14, 10),
      deletedAt: null,
    });
    expect(s[0]!.tzOffsetMin).toBe(-new Date(start).getTimezoneOffset());
    expect(s[0]!.id).toBe(sessionId(core.store.get().meta.deviceId, start));
    const today = core.select.today();
    expect(today.focusMs).toBe(minutes(25));
    expect(today.sessions).toBe(1);
    const week = core.select.week(0);
    expect(week.totalMs).toBe(minutes(25));
    expect(week.perTask).toHaveLength(1);
    expect(week.perTask[0]).toMatchObject({ taskId: null, name: 'No task', focusMs: minutes(25) });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ phase: 'focus', nextPhase: 'short', late: false, autoStarted: true });
    expect(events[0]!.session!.id).toBe(s[0]!.id);
  });

  it('is credited to the current task, and the task week total follows (TSK-4, TSK-5, TSK-7)', () => {
    const { core, clock } = makeCore();
    const t = core.store.addTask({ name: 'Orgo' });
    core.store.setCurrentTask(t.id);
    core.timer.start();
    run25(clock);
    const s = core.store.get().sessions[0]!;
    expect(s).toMatchObject({ taskId: t.id, taskName: 'Orgo', categoryId: t.categoryId });
    expect(core.select.taskWeekMs(t.id)).toBe(minutes(25));
    expect(core.select.week(0).perTask[0]).toMatchObject({ taskId: t.id, name: 'Orgo', focusMs: minutes(25) });
  });

  it('changing the current task mid-session moves the credit to the task current at the end (TSK-5)', () => {
    const { core, clock } = makeCore();
    const a = core.store.addTask({ name: 'A' });
    const b = core.store.addTask({ name: 'B' });
    core.store.setCurrentTask(a.id);
    core.timer.start();
    clock.advance(minutes(20));
    core.store.setCurrentTask(b.id);
    clock.advance(minutes(5) + 10);
    expect(core.store.get().sessions[0]).toMatchObject({ taskId: b.id, taskName: 'B' });
    expect(core.select.taskWeekMs(a.id)).toBe(0);
    expect(core.select.taskWeekMs(b.id)).toBe(minutes(25));
  });

  it('clearing the task to "No task" mid-session credits "No task"', () => {
    const { core, clock } = makeCore();
    const a = core.store.addTask({ name: 'A' });
    core.store.setCurrentTask(a.id);
    core.timer.start();
    clock.advance(minutes(10));
    core.store.setCurrentTask(null);
    clock.advance(minutes(15) + 10);
    expect(core.store.get().sessions[0]!.taskId).toBeNull();
  });

  it('checking off the current task does not clear it (TSK-5)', () => {
    const { core } = makeCore();
    const a = core.store.addTask({ name: 'A' });
    core.store.setCurrentTask(a.id);
    core.store.setTaskDone(a.id, true);
    expect(core.store.get().meta.currentTaskId).toBe(a.id);
  });

  it('paused time is never counted: 10 minutes paused mid-session, the session still has 25 focused minutes (TMR-4)', () => {
    const { core, clock } = makeCore();
    const start = clock.now();
    core.timer.start();
    clock.advance(minutes(5));
    core.timer.pause();
    clock.advance(minutes(10));
    core.timer.resume();
    clock.advance(minutes(20) + 10);
    const s = core.store.get().sessions;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ startedAt: start, endedAt: start + minutes(35), plannedMs: minutes(25), focusedMs: minutes(25) });
  });

  it('breaks are never logged: a full focus + short break adds one session only', () => {
    const { core, clock } = makeCore();
    core.timer.start();
    clock.advance(minutes(25) + minutes(5) + 20);
    expect(core.timer.getState().phase).toBe('focus');
    expect(core.store.get().sessions).toHaveLength(1);
  });

  it('with auto-start on, four focus sessions chain through breaks into a long break (TMR-8, TMR-9)', () => {
    const { core, clock, events } = makeCore();
    core.timer.start();
    clock.advance(minutes(4 * 25 + 3 * 5) + 100);
    expect(core.store.get().sessions).toHaveLength(4);
    expect(core.timer.getState()).toMatchObject({ phase: 'long', status: 'running', plannedMs: minutes(15), cycle: 0 });
    expect(events.filter((e) => e.phase === 'focus').map((e) => e.nextPhase)).toEqual(['short', 'short', 'short', 'long']);
    clock.advance(minutes(15) + 10);
    expect(core.timer.getState()).toMatchObject({ phase: 'focus', status: 'running', cycle: 0 });
    expect(core.store.get().sessions).toHaveLength(4);
  });

  it('auto-start off: the break waits idle at full duration (TMR-9)', () => {
    const { core, clock } = makeCore();
    core.store.updateSettings({ autoStart: false });
    core.timer.start();
    run25(clock);
    expect(core.timer.getState()).toMatchObject({ phase: 'short', status: 'idle', remainingMs: minutes(5) });
    clock.advance(minutes(30));
    expect(core.timer.getState().status).toBe('idle');
    expect(core.store.get().sessions).toHaveLength(1);
  });
});

describe('Skip, Reset and mode switches never log (TMR-5, TMR-6, TMR-7, TMR-12, EDGE-2, R-2)', () => {
  it.each([1_000, 60_000, 12 * 60_000, minutes(25) - 1_000])('skip %i ms into focus: nothing logged, idle short break, no auto-start', (el) => {
    const { core, clock, events } = makeCore();
    core.timer.start();
    clock.advance(el);
    core.timer.skip();
    expect(core.store.get().sessions).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(core.timer.getState()).toMatchObject({ phase: 'short', status: 'idle', cycle: 0 });
    clock.advance(minutes(40));
    expect(core.timer.getState().status).toBe('idle');
    expect(core.store.get().sessions).toHaveLength(0);
    expect(core.select.today().focusMs).toBe(0);
    expect(core.select.streak().current).toBe(0);
  });

  it('skip during a break goes to idle focus and logs nothing', () => {
    const { core, clock } = makeCore();
    core.timer.start();
    run25(clock); // logs one, break runs
    core.timer.skip();
    expect(core.timer.getState()).toMatchObject({ phase: 'focus', status: 'idle' });
    expect(core.store.get().sessions).toHaveLength(1);
  });

  it('skipping many times never advances the cycle toward a long break', () => {
    const { core } = makeCore();
    for (let i = 0; i < 10; i++) {
      core.timer.start();
      core.timer.skip(); // focus -> short
      core.timer.skip(); // short -> focus
    }
    expect(core.timer.getState()).toMatchObject({ phase: 'focus', cycle: 0 });
    expect(core.store.get().sessions).toHaveLength(0);
  });

  it('reset while running or paused logs nothing and returns the phase to full duration', () => {
    const { core, clock, events } = makeCore();
    core.timer.start();
    clock.advance(minutes(24));
    core.timer.reset();
    expect(core.timer.getState()).toMatchObject({ phase: 'focus', status: 'idle', remainingMs: minutes(25) });
    core.timer.start();
    clock.advance(minutes(3));
    core.timer.pause();
    core.timer.reset();
    clock.advance(minutes(60));
    expect(core.store.get().sessions).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('switching phase (mode switcher, discard) logs nothing', () => {
    const { core, clock } = makeCore();
    core.timer.start();
    clock.advance(minutes(20));
    core.timer.setPhase('long');
    expect(core.timer.getState()).toMatchObject({ phase: 'long', status: 'idle', remainingMs: minutes(15) });
    core.timer.setPhase('focus');
    clock.advance(minutes(100));
    expect(core.store.get().sessions).toHaveLength(0);
  });

  it('the stored document never contains a session after skip or reset', () => {
    const { core, clock, storage } = makeCore();
    core.timer.start();
    clock.advance(minutes(10));
    core.timer.skip();
    core.timer.start();
    clock.advance(minutes(10));
    core.timer.reset();
    const raw = JSON.parse(storage.read(STORAGE_KEY)!) as AppData;
    expect(raw.sessions).toEqual([]);
  });
});

describe('idempotence across tabs and devices (DAT-6, EDGE-7, D-39)', () => {
  it('sessionId is deviceId[0..24) + startedAt as 12 hex digits', () => {
    const t = at(2026, 10, 14, 8, 15);
    const id = sessionId(DEVICE_A, t);
    expect(id).toBe(DEVICE_A.slice(0, 24) + t.toString(16).padStart(12, '0'));
    expect(id).toHaveLength(36);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sessionId(DEVICE_A, t)).toBe(id); // deterministic
    expect(sessionId(DEVICE_B, t)).not.toBe(id); // different devices never collide
    expect(sessionId(DEVICE_A, t + 1)).not.toBe(id);
  });

  it('completing the same phase twice (a second tab adopting the same state) logs one session', () => {
    const { core, clock, events } = makeCore();
    core.timer.start();
    const runningSnapshot = core.timer.getState();
    run25(clock);
    expect(core.store.get().sessions).toHaveLength(1);
    core.timer.adopt(runningSnapshot); // the stale state from the other tab, long since over
    clock.advance(10);
    expect(core.store.get().sessions).toHaveLength(1);
    const logged = events.filter((e) => e.session);
    expect(logged).toHaveLength(1);
    expect(core.select.today().sessions).toBe(1);
  });

  it('two tabs, each with its own copy of the data, produce the same id so a merge keeps one', () => {
    const seed = createDefaultData(at(2026, 10, 14, 9, 0), DEVICE_A);
    const mk = () => {
      const storage = createMemoryAdapter();
      saveData(storage, structuredClone(seed));
      return makeCore({ storage, clock: new FakeClock(at(2026, 10, 14, 10, 0)) });
    };
    const a = mk();
    const b = mk();
    for (const t of [a, b]) {
      t.core.timer.start();
      run25(t.clock);
    }
    const sa = a.core.store.get().sessions;
    const sb = b.core.store.get().sessions;
    expect(sa).toHaveLength(1);
    expect(sb).toHaveLength(1);
    expect(sa[0]!.id).toBe(sb[0]!.id);
    expect(mergeData(a.core.store.get(), b.core.store.get()).sessions).toHaveLength(1);
  });

  it('a different device completing the same minute gets a different id', () => {
    const a = makeCore();
    const b = makeCore();
    for (const t of [a, b]) {
      t.core.timer.start();
      run25(t.clock);
    }
    expect(a.core.store.get().meta.deviceId).not.toBe(b.core.store.get().meta.deviceId);
    expect(a.core.store.get().sessions[0]!.id).not.toBe(b.core.store.get().sessions[0]!.id);
  });
});

describe('reload and catch-up (TMR-15, EDGE-1)', () => {
  it('a reload mid-session resumes with the right remaining time', () => {
    const clock = new FakeClock();
    const storage = createMemoryAdapter();
    const a = makeCore({ storage, clock });
    a.core.timer.start();
    clock.advance(minutes(10));
    a.core.dispose();
    clock.jump(minutes(2)); // reload takes a while
    const b = makeCore({ storage, clock });
    expect(b.core.timer.getState().status).toBe('running');
    expect(b.core.timer.remainingMs()).toBe(minutes(13));
  });

  it('reopened within 60 s of the end: logged at endsAt, break chained as of endsAt', () => {
    const clock = new FakeClock();
    const storage = createMemoryAdapter();
    const start = clock.now();
    const a = makeCore({ storage, clock });
    a.core.timer.start();
    a.core.dispose();
    clock.jump(minutes(25) + 30_000);
    const b = makeCore({ storage, clock });
    clock.advance(10);
    const s = b.core.store.get().sessions;
    expect(s).toHaveLength(1);
    expect(s[0]!.endedAt).toBe(start + minutes(25));
    expect(b.core.timer.getState()).toMatchObject({ phase: 'short', status: 'running', endsAt: start + minutes(30) });
  });

  it('reopened hours later: exactly one session at endsAt, late, break prepared idle even with auto-start', () => {
    const clock = new FakeClock();
    const storage = createMemoryAdapter();
    const start = clock.now();
    const a = makeCore({ storage, clock });
    a.core.timer.start();
    a.core.dispose();
    clock.jump(8 * 60 * minutes(1)); // overnight
    const b = makeCore({ storage, clock });
    clock.advance(10);
    clock.becomeVisible();
    const s = b.core.store.get().sessions;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ startedAt: start, endedAt: start + minutes(25), focusedMs: minutes(25) });
    expect(b.core.timer.getState()).toMatchObject({ phase: 'short', status: 'idle' });
  });

  // BUG (logic, core.ts): createEmCore() ends with a synchronous timer.sync(), so the catch-up
  // completion is emitted before the app can call onPhaseComplete(). The UI never sees the
  // message, the milestone or the persist() trigger for a session that finished while closed.
  it('a subscriber registered right after createEmCore still receives a within-grace catch-up completion', () => {
    const clock = new FakeClock();
    const storage = createMemoryAdapter();
    const a = makeCore({ storage, clock });
    a.core.timer.start();
    a.core.dispose();
    clock.jump(minutes(25) + 30_000);
    const b = makeCore({ storage, clock });
    clock.advance(10);
    expect(b.core.store.get().sessions).toHaveLength(1);
    expect(b.events).toHaveLength(1);
    expect(b.events[0]).toMatchObject({ phase: 'focus', late: false, autoStarted: true });
    expect(b.events[0]!.message).toBeTruthy();
  });
});

describe('study day attribution across midnight (EDGE-3)', () => {
  it('a 23:45 to 00:10 session belongs to the evening and "today" stays until 06:00', () => {
    const clock = new FakeClock(at(2026, 10, 14, 23, 45));
    const { core } = makeCore({ clock });
    core.store.updateSettings({ autoStart: false });
    core.timer.start();
    clock.advance(minutes(25) + 10);
    expect(new Date(core.store.get().sessions[0]!.endedAt).getDate()).toBe(15); // ended after midnight
    expect(core.store.get().sessions[0]!.day).toBe('2026-10-14');
    expect(core.select.today(at(2026, 10, 15, 0, 30)).focusMs).toBe(minutes(25));
    expect(core.select.today(at(2026, 10, 15, 5, 59)).focusMs).toBe(minutes(25));
    expect(core.select.today(at(2026, 10, 15, 6, 0)).focusMs).toBe(0);
    expect(core.select.streak(at(2026, 10, 15, 3, 0))).toMatchObject({ current: 1, todayCounts: true });
  });
});

describe('milestones and messages (MIL-1, MIL-3, MIL-4, MSG-1, MSG-2, BRK-1)', () => {
  const seedSessions = (n: number, firstDay = 1) =>
    Array.from({ length: n }, (_, i) => mkSession(at(2026, 9, firstDay + i * 2, 9, 0)));

  function coreWith(sessions: ReturnType<typeof mkSession>[], extra: Partial<AppData['meta']> = {}) {
    const clock = new FakeClock();
    const data = createDefaultData(clock.now(), DEVICE_A);
    data.sessions = sessions;
    data.meta = { ...data.meta, ...extra };
    const storage = createMemoryAdapter();
    saveData(storage, data);
    return makeCore({ storage, clock });
  }

  it('the 10th session fires "sessions-10" once; its text replaces the encouragement (MIL-4)', () => {
    const { core, clock, events } = coreWith(seedSessions(9));
    core.timer.start();
    run25(clock);
    const first = events[0]!;
    expect(first.milestone?.id).toBe('sessions-10');
    expect(first.message).toBe('Ten sessions. A real habit is starting.');
    expect(first.message).toBe(first.milestone!.text);
    expect(core.store.get().meta.milestonesShown).toContain('sessions-10');
    // next focus session: no milestone, an ordinary message
    core.timer.skip(); // break -> idle focus
    core.timer.start();
    run25(clock);
    const second = events.filter((e) => e.phase === 'focus')[1]!;
    expect(second.milestone).toBeNull();
    expect(second.message).not.toBe(first.message);
  });

  it('never fires twice: the milestone is remembered per device', () => {
    const { core, clock, events } = coreWith(seedSessions(9), { milestonesShown: ['sessions-10'] });
    core.timer.start();
    run25(clock);
    expect(events[0]!.milestone).toBeNull();
  });

  it('pulled history never replays milestones and emits no phase-complete event (SYNC-15, MIL-1)', () => {
    const { core, clock, events } = makeCore();
    const pulled = Array.from({ length: 12 }, (_, i) => mkSession(at(2026, 9, 1 + i * 2, 9, 0)));
    const before = events.length;
    const res = core.store.applyRemote('sessions', pulled.map((s) => ({ ...s })));
    expect(res.applied).toBe(12);
    expect(events.length).toBe(before);
    expect(core.store.get().meta.milestonesShown).toEqual([]);
    core.timer.start();
    run25(clock); // 13th session, 10 already crossed by someone else's device
    expect(events[0]!.milestone).toBeNull();
  });

  it('a 7 day streak fires "streak-7" when the 7th day is completed on this device', () => {
    const prior = [8, 9, 10, 11, 12, 13].map((d) => mkSession(at(2026, 10, d, 9, 0)));
    const { core, clock, events } = coreWith(prior);
    core.timer.start();
    run25(clock);
    expect(events[0]!.milestone?.id).toBe('streak-7');
    expect(events[0]!.message).toBe('Seven days in a row. A full week of showing up.');
  });

  it('no encouragement or prompt when their toggles are off; prompt only for focus completions (MSG-1, BRK-1)', () => {
    const { core, clock, events } = makeCore();
    core.timer.start();
    run25(clock);
    expect(events[0]!.message).toBeTruthy();
    expect(events[0]!.breakPrompt).toBeTruthy();
    expect(core.copy.breakPrompts).toContain(events[0]!.breakPrompt);
    core.store.updateSettings({ encouragement: false, breakPrompts: false });
    clock.advance(minutes(5) + 10); // break ends, focus runs
    clock.advance(minutes(25) + 10);
    const focusEvents = events.filter((e) => e.phase === 'focus');
    expect(focusEvents[1]!.message).toBeNull();
    expect(focusEvents[1]!.breakPrompt).toBeNull();
    expect(core.pickBreakPrompt()).toBeNull();
    const breakEnd = events.find((e) => e.phase === 'short')!;
    expect(breakEnd.message).toBeNull();
    expect(breakEnd.session).toBeNull();
  });

  it('{sessions} lines are not used until the day has 2 sessions and are rendered as words (MSG-2)', () => {
    const only: PhaseCompleteEvent[] = [];
    const { core, clock, events } = makeCore({ random: () => 0 });
    for (let i = 0; i < 6; i++) {
      core.timer.start();
      run25(clock);
      clock.advance(minutes(5) + 10);
      if (core.timer.getState().status === 'running') core.timer.reset();
    }
    only.push(...events.filter((e) => e.phase === 'focus'));
    expect(only.length).toBeGreaterThanOrEqual(5);
    expect(only[0]!.message).not.toMatch(/sessions in|\{|That's .* today|sessions down|\d+ today/);
    for (const e of only) expect(e.message).not.toContain('{');
  });
});

describe('export reminder due rule (DAT-4)', () => {
  const days = (n: number) => n * 86_400_000;
  function withSessions(n: number, over: Partial<AppData['meta']> = {}) {
    const clock = new FakeClock();
    const data = createDefaultData(clock.now(), DEVICE_A);
    data.sessions = Array.from({ length: n }, (_, i) => mkSession(clock.now() - days(30) + i * 3_600_000));
    data.meta = { ...data.meta, ...over };
    const storage = createMemoryAdapter();
    saveData(storage, data);
    return makeCore({ storage, clock });
  }

  it('due at 10 sessions with no export ever, not before', () => {
    expect(withSessions(9).core.select.exportReminderDue()).toBe(false);
    expect(withSessions(10).core.select.exportReminderDue()).toBe(true);
  });

  it('snooze hides it for 7 days', () => {
    const { core, clock } = withSessions(12);
    core.store.snoozeExportReminder(clock.now() + days(7));
    expect(core.select.exportReminderDue()).toBe(false);
    expect(core.select.exportReminderDue(clock.now() + days(7) + 1)).toBe(true);
  });

  it('after an export it is quiet until 14+ days pass with new sessions added since', () => {
    const { core, clock } = withSessions(12, { lastExportAt: at(2026, 10, 14, 9, 0) });
    expect(core.select.exportReminderDue(clock.now() + days(20))).toBe(false); // nothing new since export
    const sessions = core.store.get().sessions;
    core.store.importData(
      { ...core.store.get(), sessions: [...sessions, mkSession(clock.now() + 5 * 60_000)] },
      'merge',
    );
    expect(core.select.exportReminderDue(clock.now() + days(3))).toBe(false); // too soon
    expect(core.select.exportReminderDue(clock.now() + days(15))).toBe(true);
  });

  it('suppressed while sync is healthy (synced within 7 days)', () => {
    const { core, clock } = withSessions(12);
    expect(core.select.exportReminderDue()).toBe(true);
    core.store.setSyncMeta({ userId: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b', lastSyncedAt: clock.now() - days(1) });
    expect(core.select.exportReminderDue()).toBe(false);
    core.store.setSyncMeta({ lastSyncedAt: clock.now() - days(9) });
    expect(core.select.exportReminderDue()).toBe(true);
  });
});

describe('erase (DAT-5)', () => {
  it('resets to first-run state and keeps the device id', () => {
    const { core, clock } = makeCore();
    core.store.addTask({ name: 'x' });
    core.timer.start();
    run25(clock);
    const id = core.store.get().meta.deviceId;
    core.store.eraseAll(clock.now());
    const d = core.store.get();
    expect(d.sessions).toEqual([]);
    expect(d.tasks).toEqual([]);
    expect(d.categories).toHaveLength(5);
    expect(d.meta.deviceId).toBe(id);
    expect(d.settings.dailyGoalMin).toBe(120);
    expect(d.meta.milestonesShown).toEqual([]);
  });
});

void expectedDay;
