import { useRef, useState } from 'preact/hooks';
import {
  DAILY_GOAL_STEP_MIN,
  IMPORT_MAX_BYTES,
  LIMITS,
  MIN,
  ValidationError,
  dayKey,
  formatDuration,
  formatShortDate,
  isSyncConfigured,
  parseImport,
  readSyncEnv,
  type ChimeId,
  type ImportError,
  type ImportResult,
  type PresetId,
  type Settings as SettingsT,
} from '@core';
import { ExportReminder, exportBackup } from '../app/Banners';
import { breakPrompt, message } from '../app/actions';
import { core, data } from '../app/coreBridge';
import { Dialog } from '../components/Dialog';
import { Button, Card, Segmented, Select, Stepper, Switch } from '../components/ui';
import { playChime, unlockAudio } from '../platform/audio';
import { isIOS, isStandalone, notificationPermission, notificationsSupported } from '../platform/env';
import { requestPermission } from '../platform/notify';
import { wakeLockSupported } from '../platform/wakeLock';
import { SyncCard } from './SyncCard';

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Start, pause or resume'],
  ['S', 'Skip to the next phase'],
  ['R', 'Reset the current phase'],
  ['1', 'Focus'],
  ['2', 'Short break'],
  ['3', 'Long break'],
  ['?', 'Show this list'],
];

const IMPORT_ERRORS: Record<ImportError, string> = {
  'not-json': "That file isn't a backup from Em Time.",
  'not-em-time': "That file isn't a backup from Em Time.",
  'newer-version': 'This backup is from a newer version. Refresh Em Time, then try again.',
  'invalid-shape': "This backup looks damaged and can't be imported.",
  'too-large': 'That file is too large to be an Em Time backup.',
  empty: 'That file is empty.',
};

const CHIMES: { id: ChimeId; label: string }[] = [
  { id: 'glass', label: 'Glass' },
  { id: 'bowl', label: 'Bowl' },
  { id: 'bell', label: 'Bell' },
  { id: 'wood', label: 'Wood' },
  { id: 'none', label: 'None' },
];

function set(patch: Partial<SettingsT>): void {
  try {
    core.store.updateSettings(patch);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
  }
}

function TimerCard({ s }: { s: SettingsT }) {
  const presets: { value: PresetId; label: string }[] = [
    { value: '25/5', label: '25 / 5' },
    { value: '50/10', label: '50 / 10' },
    { value: '90/20', label: '90 / 20' },
    { value: 'custom', label: 'Custom' },
  ];
  return (
    <Card title="Timer">
      <div class="setrow">
        <div class="setrow__label">Focus and break lengths</div>
        <Segmented options={presets} value={s.preset} onChange={(v) => set({ preset: v })} label="Preset" />
      </div>
      {s.preset === 'custom' ? (
        <div class="steppers">
          <Stepper
            label="Focus"
            unit="min"
            value={s.focusMin}
            min={LIMITS.focusMin[0]}
            max={LIMITS.focusMin[1]}
            onChange={(v) => set({ focusMin: v })}
          />
          <Stepper
            label="Short break"
            unit="min"
            value={s.shortMin}
            min={LIMITS.shortMin[0]}
            max={LIMITS.shortMin[1]}
            onChange={(v) => set({ shortMin: v })}
          />
          <Stepper
            label="Long break"
            unit="min"
            value={s.longMin}
            min={LIMITS.longMin[0]}
            max={LIMITS.longMin[1]}
            onChange={(v) => set({ longMin: v })}
          />
          <Stepper
            label="Long break every"
            unit="sessions"
            value={s.longEvery}
            min={LIMITS.longEvery[0]}
            max={LIMITS.longEvery[1]}
            onChange={(v) => set({ longEvery: v })}
          />
        </div>
      ) : (
        <p class="hint">
          {s.focusMin} min focus, {s.shortMin} min short break, {s.longMin} min long break, every{' '}
          {s.longEvery} sessions.
        </p>
      )}
      <Switch
        checked={s.autoStart}
        onChange={(v) => set({ autoStart: v })}
        label="Start the next phase automatically"
        hint="When a phase ends, the next one begins on its own."
      />
    </Card>
  );
}

function GoalCard({ s }: { s: SettingsT }) {
  return (
    <Card title="Daily goal">
      <Stepper
        label="Focus time per day"
        value={s.dailyGoalMin}
        min={LIMITS.dailyGoalMin[0]}
        max={LIMITS.dailyGoalMin[1]}
        step={DAILY_GOAL_STEP_MIN}
        unit="min"
        format={(v) => formatDuration(v * MIN)}
        onChange={(v) => set({ dailyGoalMin: v })}
      />
    </Card>
  );
}

function SoundCard({ s }: { s: SettingsT }) {
  return (
    <Card title="Sound">
      <div role="radiogroup" aria-label="Chime" class="chimes">
        {CHIMES.map((c) => (
          <div class="chimerow" key={c.id}>
            <label class="radiorow">
              <input
                type="radio"
                name="chime"
                checked={s.chime === c.id}
                onChange={() => set({ chime: c.id })}
              />
              <span class="radiorow__dot" />
              <span>{c.label}</span>
            </label>
            <Button
              variant="text"
              disabled={c.id === 'none'}
              aria-label={`Preview ${c.label}`}
              onClick={() => {
                unlockAudio();
                playChime(c.id, s.volume);
              }}
            >
              Preview
            </Button>
          </div>
        ))}
      </div>
      <div class="slider">
        <label for="vol" class="slider__label">
          Volume
        </label>
        <input
          id="vol"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(s.volume * 100)}
          aria-valuetext={`${Math.round(s.volume * 100)} percent`}
          onInput={(e) => set({ volume: Number((e.target as HTMLInputElement).value) / 100 })}
        />
        <span class="slider__value">{Math.round(s.volume * 100)}</span>
      </div>
    </Card>
  );
}

function NotificationsCard({ s }: { s: SettingsT }) {
  const [, force] = useState(0);
  const perm = notificationPermission();
  const supported = notificationsSupported();
  let state = 'Off';
  if (!supported) state = 'Not available in this browser';
  else if (perm === 'denied') state = 'Blocked in browser settings';
  else if (perm === 'granted' && s.notifications) state = 'On';
  else if (perm === 'default' && s.notifications) state = 'Asks permission when you first press Start';
  return (
    <Card title="Notifications">
      <Switch
        checked={s.notifications && perm !== 'denied'}
        disabled={!supported || perm === 'denied'}
        label="Notify me when a phase ends"
        hint={state}
        onChange={async (v) => {
          set({ notifications: v });
          if (v && supported && Notification.permission === 'default') {
            core.store.markNotificationPrompted(Date.now());
            await requestPermission();
          }
          force((x) => x + 1);
        }}
      />
      {isIOS() ? (
        <p class="hint">
          On iPhone, chimes and notifications only work while Em Time is open, because iOS pauses web apps
          when the screen locks. The timer is always right when you come back.
        </p>
      ) : null}
      <Switch
        checked={s.keepAwake}
        onChange={(v) => set({ keepAwake: v })}
        label="Keep screen on while running"
        hint={wakeLockSupported() ? undefined : 'This browser does not support keeping the screen on.'}
        disabled={!wakeLockSupported()}
      />
    </Card>
  );
}

function MessagesCard({ s }: { s: SettingsT }) {
  return (
    <Card title="Breaks and messages">
      <Switch
        checked={s.breakPrompts}
        onChange={(v) => {
          set({ breakPrompts: v });
          if (!v) breakPrompt.value = null;
        }}
        label="Break suggestions"
        hint="A small idea for how to spend each break."
      />
      <Switch
        checked={s.encouragement}
        onChange={(v) => {
          set({ encouragement: v });
          if (!v) message.value = null;
        }}
        label="Encouraging messages"
        hint="A kind line after each finished focus session."
      />
    </Card>
  );
}

function AppearanceCard({ s }: { s: SettingsT }) {
  return (
    <Card title="Appearance">
      <div class="setrow">
        <div class="setrow__label">Theme</div>
        <Segmented
          testid="settings-theme"
          label="Theme"
          value={s.theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>
      <Select
        label="Week starts on"
        value={s.weekStartsOn}
        onChange={(v) => set({ weekStartsOn: Number(v) as 0 | 1 })}
        options={[
          { value: 1, label: 'Monday' },
          { value: 0, label: 'Sunday' },
        ]}
      />
      <p class="hint">Days roll over at 6 AM, so late nights count for the evening.</p>
    </Card>
  );
}

function ImportFlow() {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Extract<ImportResult, { ok: true }> | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [done, setDone] = useState('');

  const onFile = async (e: Event) => {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    setDone('');
    if (!file) return;
    if (file.size === 0) return setError(IMPORT_ERRORS.empty);
    if (file.size > IMPORT_MAX_BYTES) return setError(IMPORT_ERRORS['too-large']);
    const text = await file.text();
    const r = parseImport(text, Date.now());
    if (!r.ok) {
      setResult(null);
      return setError(IMPORT_ERRORS[r.error]);
    }
    setError('');
    setResult(r);
  };

  const apply = (mode: 'replace' | 'merge') => {
    if (!result) return;
    core.store.importData(result.data, mode);
    core.timer.adopt(core.store.get().timer);
    setDone(mode === 'replace' ? 'Backup restored.' : 'Backup merged into your data.');
    setResult(null);
    setConfirmReplace(false);
  };

  const sum = result?.summary;
  const range =
    sum?.firstDay && sum.lastDay
      ? `${formatShortDate(sum.firstDay)} to ${formatShortDate(sum.lastDay)}`
      : 'no sessions';
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="import-input"
        onChange={onFile}
      />
      <Button variant="secondary" onClick={() => input.current?.click()}>
        Import
      </Button>
      {error ? (
        <p class="error" role="alert" data-testid="import-error">
          {error}
        </p>
      ) : null}
      {done ? (
        <p class="hint" role="status">
          {done}
        </p>
      ) : null}
      {result && sum ? (
        <Dialog
          title={confirmReplace ? 'Replace everything?' : 'Import this backup'}
          onClose={() => {
            setResult(null);
            setConfirmReplace(false);
          }}
          testid="import-dialog"
          footer={
            confirmReplace ? (
              <>
                <Button variant="text" onClick={() => setConfirmReplace(false)}>
                  Back
                </Button>
                <Button variant="danger" onClick={() => apply('replace')}>
                  Replace everything
                </Button>
              </>
            ) : (
              <>
                <Button variant="text" onClick={() => setResult(null)}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={() => apply('merge')}>
                  Merge
                </Button>
                <Button variant="primary" onClick={() => setConfirmReplace(true)}>
                  Replace everything
                </Button>
              </>
            )
          }
        >
          {confirmReplace ? (
            <p>
              This replaces all tasks, sessions and settings on this device with the backup. This can't be
              undone.
            </p>
          ) : (
            <>
              <p>
                {sum.sessions} sessions, {sum.tasks} tasks and {sum.categories} categories, from {range}.
              </p>
              {result.warnings.length ? (
                <ul class="warnlist">
                  {result.warnings.map((w) => (
                    <li key={w.code}>
                      {w.code === 'future-sessions'
                        ? `${w.count} ${w.count === 1 ? 'session is' : 'sessions are'} dated in the future and will appear on their dates.`
                        : w.code === 'dropped-records'
                          ? `${w.count} damaged ${w.count === 1 ? 'record was' : 'records were'} skipped.`
                          : w.code === 'orphan-task-refs'
                            ? `${w.count} ${w.count === 1 ? 'task points' : 'tasks point'} to a missing category and will show under the first one.`
                            : 'This backup came from an older version and was updated.'}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p class="hint">
                Merge adds sessions and tasks you don't have yet and keeps your current settings.
              </p>
            </>
          )}
        </Dialog>
      ) : null}
    </>
  );
}

function EraseFlow() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'device' | 'cloud'>('device');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signedIn = data.value.meta.sync.userId !== null;
  const close = () => {
    setOpen(false);
    setText('');
    setErr('');
    setScope('device');
  };
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      const eng = signedIn ? await core.loadSync() : null;
      if (signedIn && scope === 'cloud') {
        const r = await eng?.eraseCloud();
        if (!r?.ok) {
          setErr("Couldn't reach the cloud, so nothing was erased. Check your connection and try again.");
          setBusy(false);
          return;
        }
      } else {
        await eng?.signOut();
        core.store.eraseAll(Date.now());
      }
      core.timer.adopt(core.store.get().timer);
      message.value = null;
      breakPrompt.value = null;
      close();
    } catch {
      setErr('Something went wrong, so nothing was erased. Try again.');
    }
    setBusy(false);
  };
  return (
    <>
      <Button variant="text" class="btn--dangertext" onClick={() => setOpen(true)}>
        Erase all data
      </Button>
      {open ? (
        <Dialog
          title="Erase all data?"
          onClose={close}
          footer={
            <>
              <Button variant="text" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || text.trim().toLowerCase() !== 'erase'}
                onClick={() => void run()}
              >
                {busy ? 'Erasing…' : 'Erase'}
              </Button>
            </>
          }
        >
          <p>
            This removes your tasks, sessions and settings and returns Em Time to a fresh start. Export a
            backup first if you might want them back.
          </p>
          {signedIn ? (
            <div class="radiogroup" role="radiogroup" aria-label="What to erase">
              <label class="radiorow">
                <input
                  type="radio"
                  name="erase-scope"
                  checked={scope === 'device'}
                  onChange={() => setScope('device')}
                />
                <span class="radiorow__dot" />
                <span>This device only</span>
              </label>
              <label class="radiorow">
                <input
                  type="radio"
                  name="erase-scope"
                  checked={scope === 'cloud'}
                  onChange={() => setScope('cloud')}
                />
                <span class="radiorow__dot" />
                <span>This device and the cloud</span>
              </label>
            </div>
          ) : null}
          <div class="field">
            <label class="field__label" for="erase-confirm">
              Type erase to confirm
            </label>
            <input
              id="erase-confirm"
              class="input"
              autoComplete="off"
              autoCapitalize="off"
              data-autofocus
              value={text}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
            />
          </div>
          {err ? <p class="error">{err}</p> : null}
        </Dialog>
      ) : null}
    </>
  );
}

function DataCard() {
  const last = data.value.meta.lastExportAt;
  return (
    <Card title="Your data">
      <p class="hint hint--lead">Last backup: {last ? formatShortDate(dayKey(last, 0)) : 'Never'}</p>
      <div class="btnrow">
        <Button variant="primary" data-testid="export-button" onClick={exportBackup}>
          Export
        </Button>
        <ImportFlow />
      </div>
      {isIOS() && !isStandalone() ? (
        <p class="hint">
          Install tip: tap Share, then Add to Home Screen. Safari can clear website data after 7 days without
          use, and an installed app keeps it safe.
        </p>
      ) : null}
      <div class="erase">
        <EraseFlow />
      </div>
    </Card>
  );
}

export function ShortcutsList() {
  return (
    <dl class="shortcuts">
      {SHORTCUTS.map(([k, d]) => (
        <div key={k} class="shortcuts__row">
          <dt>
            <kbd>{k}</kbd>
          </dt>
          <dd>{d}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Settings() {
  const s = data.value.settings;
  const syncOn = isSyncConfigured(readSyncEnv());
  return (
    <div class="page page--settings">
      <ExportReminder />
      <div class="pagehead">
        <h1 class="pagehead__title">Settings</h1>
      </div>
      <div class="stack">
        <TimerCard s={s} />
        <GoalCard s={s} />
        <SoundCard s={s} />
        <NotificationsCard s={s} />
        <MessagesCard s={s} />
        <AppearanceCard s={s} />
        {syncOn ? <SyncCard /> : null}
        <DataCard />
        <Card title="About">
          <p class="about__ver">Em Time {__APP_VERSION__}</p>
          <div class="only-desktop">
            <h3 class="subhead">Keyboard shortcuts</h3>
            <ShortcutsList />
          </div>
          <p class="about__line">{core.copy.aboutLine}</p>
        </Card>
      </div>
    </div>
  );
}
