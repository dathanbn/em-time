// Timer actions with their UI side effects: audio unlock, first-Play notification prompt,
// announcements, the discard confirm (TMR-12) and the message/break-prompt state.
import { effect, signal } from '@preact/signals';
import { DISCARD_CONFIRM_MS, todayKey, type Phase, type PhaseCompleteEvent } from '@core';
import { announce } from '../platform/announce';
import { playChime, unlockAudio } from '../platform/audio';
import { notificationsSupported } from '../platform/env';
import { requestPermission, showPhaseNotification } from '../platform/notify';
import { clearBurst } from '../platform/stickers';
import { setWakeLock } from '../platform/wakeLock';
import { core, data, timerState } from './coreBridge';
import { celebrate, initThumbs, noteGoalProgress, wave } from './mascotState';
import { celebrateWithStickers } from './stickerRuntime';

export const PHASE_LABEL: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

export const message = signal<string | null>(null);
export const breakPrompt = signal<string | null>(null);
export const confettiKey = signal(0);
/** Phase the user asked to switch to, waiting on the discard dialog. */
export const pendingDiscard = signal<Phase | null>(null);
export const shortcutsOpen = signal(false);
export const refill = signal(0);

function clearCelebration(): void {
  message.value = null;
  breakPrompt.value = null;
}

function afterStart(): void {
  // MIL-3 and MSG-1: nothing celebratory while a focus phase runs.
  if (timerState.value.phase === 'focus') {
    clearCelebration();
    clearBurst();
  }
}

function firstPlayEffects(): void {
  unlockAudio();
  const meta = core.store.get().meta;
  if (
    meta.notificationPromptedAt === null &&
    core.store.get().settings.notifications &&
    notificationsSupported()
  ) {
    core.store.markNotificationPrompted(Date.now());
    void requestPermission();
  }
}

export function togglePlay(): void {
  const s = timerState.value;
  if (s.status === 'idle') {
    firstPlayEffects();
    core.timer.start();
    announce(`${PHASE_LABEL[s.phase]} started`);
    afterStart();
  } else if (s.status === 'running') {
    core.timer.pause();
    announce('Paused');
  } else {
    unlockAudio();
    core.timer.resume();
    announce('Resumed');
    afterStart();
  }
}

/** The N shortcut. */
export function toggleNoise(): void {
  unlockAudio();
  const on = !core.store.get().settings.noiseOn;
  core.store.updateSettings({ noiseOn: on });
  announce(on ? 'Focus sounds on' : 'Focus sounds off');
}

export function skip(): void {
  core.timer.skip();
  const p = core.timer.getState().phase;
  breakPrompt.value = p === 'focus' ? null : core.pickBreakPrompt();
  message.value = null;
  announce(PHASE_LABEL[p]);
}

export function reset(): void {
  core.timer.reset();
  refill.value++;
  announce('Reset');
}

export function elapsedMs(): number {
  const s = timerState.value;
  return s.plannedMs - core.timer.remainingMs();
}

export function switchMode(p: Phase, force = false): void {
  const s = timerState.value;
  if (s.phase === p && s.status === 'idle') return;
  if (
    !force &&
    s.status !== 'idle' &&
    s.phase === 'focus' &&
    p !== 'focus' &&
    elapsedMs() >= DISCARD_CONFIRM_MS
  ) {
    pendingDiscard.value = p;
    return;
  }
  if (!force && s.status !== 'idle' && s.phase === p) return;
  core.timer.setPhase(p);
  refill.value++;
  breakPrompt.value = p === 'focus' ? null : core.pickBreakPrompt();
  message.value = null;
  announce(PHASE_LABEL[p]);
}

export function confirmDiscard(): void {
  const p = pendingDiscard.value;
  pendingDiscard.value = null;
  if (p) switchMode(p, true);
}

/** Called once at startup: reacts to phases ending. */
export function initPhaseEffects(): void {
  initThumbs();
  noteGoalProgress(core.select.today().goalMet, todayKey(Date.now()), true);
  core.onPhaseComplete((e: PhaseCompleteEvent) => {
    const settings = core.store.get().settings;
    if (!e.late) {
      playChime(settings.chime, settings.volume);
      if (settings.notifications) void showPhaseNotification(e.phase, e.nextPhase);
    }
    if (e.phase === 'focus') {
      message.value = e.message;
      breakPrompt.value = e.breakPrompt;
      if (e.session) noteGoalProgress(core.select.today().goalMet, todayKey(Date.now()), e.late);
      if (e.session && !e.late) {
        celebrate();
        if (e.milestone && (e.milestone.id === 'streak-7' || e.milestone.id === 'streak-30'))
          window.setTimeout(wave, 1600);
      }
      if (settings.stickers) {
        if (e.session && !e.late && !document.hidden) celebrateWithStickers(e.milestone !== null);
      } else if (e.milestone) confettiKey.value++;
      const meta = core.store.get().meta;
      if (e.session && meta.persistRequestedAt === null) {
        core.store.markPersistRequested(Date.now());
        void navigator.storage?.persist?.().catch(() => undefined);
      }
    } else {
      message.value = null;
      breakPrompt.value = null;
    }
    if (e.autoStarted && e.nextPhase === 'focus') {
      clearCelebration();
      clearBurst();
    }
    if (!e.late) {
      announce(
        e.phase === 'focus'
          ? `Focus done. ${PHASE_LABEL[e.nextPhase]}`
          : `${PHASE_LABEL[e.phase]} over. ${PHASE_LABEL[e.nextPhase]}`,
      );
    }
    refill.value++;
  });
  // A break that is already showing after a reload gets a suggestion too (BRK-1).
  if (timerState.value.phase !== 'focus' && breakPrompt.value === null)
    breakPrompt.value = core.pickBreakPrompt();
  // Wake lock follows the timer and the setting (TMR-17).
  effect(() => {
    setWakeLock(data.value.settings.keepAwake && timerState.value.status === 'running');
  });
}
