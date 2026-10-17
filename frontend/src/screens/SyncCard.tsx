// Settings > Sync (design.md 7.5). Quiet by design: all sync copy lives in this card. It talks to
// the engine only through core.loadSync() and the SyncEngine API of contract.md section 3.7.
import { useEffect, useState } from 'preact/hooks';
import { useUid } from '../components/uid';
import {
  SYNC_CODE_MAX,
  SYNC_CODE_MIN,
  formatDayLabel,
  hasStoredAuth,
  normalizeSyncCode,
  todayKey,
  type SyncEngine,
  type SyncState,
} from '@core';
import { core, data } from '../app/coreBridge';
import { Dialog } from '../components/Dialog';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/ui';

const SIGNED_IN = new Set(['idle', 'syncing', 'offline', 'error', 'auth-expired']);

const ERRORS: Record<string, string> = {
  code_empty: `Use at least ${SYNC_CODE_MIN} characters.`,
  code_too_short: `Use at least ${SYNC_CODE_MIN} characters.`,
  code_too_long: `That code is too long. Use up to ${SYNC_CODE_MAX} characters.`,
  code_invalid_chars: 'Use letters, numbers, spaces, dashes, underscores or dots.',
  confirm_email_on:
    'Supabase still has Confirm email on. Turn it off under Authentication → Sign In / Providers → Email.',
  rate_limited: 'Too many tries. Wait a minute and try again.',
  network: "Can't reach the server. Check your connection and try again.",
  unknown: 'Something went wrong. Try again in a moment.',
};

function relative(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return formatDayLabel(todayKey(ts));
}

function statusView(st: SyncState | null, now: number): { icon: IconName; text: string; spin?: boolean } {
  if (!st) return { icon: 'sync', text: 'Syncing', spin: true };
  switch (st.status) {
    case 'syncing':
      return { icon: 'sync', text: 'Syncing', spin: true };
    case 'offline':
      return { icon: 'cloud-off', text: 'Offline, will sync when back online' };
    case 'error':
      return { icon: 'alert', text: "Couldn't sync. Retrying." };
    case 'auth-expired':
      return { icon: 'alert', text: 'Sync paused: link this device again' };
    default:
      return st.lastSyncedAt
        ? { icon: 'check-circle', text: `Synced · ${relative(st.lastSyncedAt, now)}` }
        : { icon: 'sync', text: 'Waiting to sync' };
  }
}

export function SyncCard() {
  const meta = data.value.meta.sync;
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [st, setSt] = useState<SyncState | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [confirmOut, setConfirmOut] = useState(false);
  const codeId = useUid();

  const attach = async (): Promise<SyncEngine | null> => {
    try {
      const e = await core.loadSync();
      if (!e) return null;
      setEngine(e);
      setSt(e.state());
      return e;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (meta.userId !== null || hasStoredAuth()) void attach();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!engine) return;
    setSt(engine.state());
    return engine.subscribe(setSt);
  }, [engine]);

  const status = st?.status;
  const signedIn = status ? SIGNED_IN.has(status) : meta.userId !== null;
  const expired = status === 'auth-expired';
  const rejected = st?.rejected ?? meta.rejected;

  const link = async () => {
    if (busy) return;
    setErr('');
    const n = normalizeSyncCode(code);
    if (!n.ok) {
      setErr(ERRORS[n.error] ?? ERRORS.unknown!);
      return;
    }
    setBusy(true);
    const e = engine ?? (await attach());
    if (!e) {
      setBusy(false);
      setErr(ERRORS.network!);
      return;
    }
    const r = await e.signInWithCode(code);
    setBusy(false);
    if (r.ok) setCode('');
    else setErr(r.message ?? ERRORS[r.error] ?? ERRORS.unknown!);
  };

  const view = statusView(st, now);
  const codeForm = (
    <form
      class="sync__form"
      onSubmit={(e) => {
        e.preventDefault();
        void link();
      }}
      novalidate
    >
      <label class="field__label" for={codeId}>
        Sync code
      </label>
      <input
        id={codeId}
        class="input"
        data-testid="sync-code-input"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellcheck={false}
        value={code}
        placeholder="a secret phrase"
        aria-describedby={err ? 'sync-err sync-help' : 'sync-help'}
        aria-invalid={err ? true : undefined}
        onFocus={() => void attach()}
        onInput={(e) => {
          setCode((e.target as HTMLInputElement).value);
          setErr('');
        }}
      />
      <p class="smallprint" id="sync-help">
        Pick a secret phrase ({SYNC_CODE_MIN}+ characters). Type the same code on your other device to link
        them. Anyone with the code can see your history, so keep it to yourself.
      </p>
      {err ? (
        <p class="error" id="sync-err" role="alert">
          {err}
        </p>
      ) : null}
      <div class="sync__actions">
        <Button variant="secondary" type="submit" disabled={busy} data-testid="sync-send">
          {busy ? 'Linking…' : 'Link this device'}
        </Button>
      </div>
      {meta.lastUserId !== null ? (
        <p class="smallprint">This device's data will be added to the account you link to.</p>
      ) : null}
    </form>
  );

  return (
    <section class="card sync" data-testid="sync-card" aria-labelledby="sync-h">
      <div class="card__head">
        <h2 id="sync-h" class="card__title">
          Sync
        </h2>
      </div>
      {signedIn ? (
        <>
          <p class="sync__lead">
            <strong>Linked</strong>
          </p>
          <p class="syncstatus" data-testid="sync-status" role="status">
            <Icon name={view.icon} size={16} class={view.spin ? 'spin' : ''} />
            <span>{view.text}</span>
          </p>
          {rejected > 0 ? (
            <p class="smallprint">
              {rejected === 1 ? "1 change couldn't sync" : `${rejected} changes couldn't sync`}
            </p>
          ) : null}
          {expired ? codeForm : null}
          <div class="sync__actions">
            {!expired ? (
              <Button
                variant="secondary"
                data-testid="sync-now"
                disabled={status === 'syncing' || !engine}
                onClick={() => void engine?.syncNow()}
              >
                Sync now
              </Button>
            ) : null}
            <Button variant="text" data-testid="sync-signout" onClick={() => setConfirmOut(true)}>
              Sign out
            </Button>
          </div>
        </>
      ) : (
        <>
          <p class="sync__lead">Link this device to sync across devices.</p>
          {codeForm}
          <p class="smallprint">Optional. Em Time works fully without an account.</p>
        </>
      )}
      {confirmOut ? (
        <Dialog
          title="Sign out?"
          onClose={() => setConfirmOut(false)}
          footer={
            <>
              <Button variant="text" onClick={() => setConfirmOut(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  setConfirmOut(false);
                  await engine?.signOut();
                  setCode('');
                }}
              >
                Sign out
              </Button>
            </>
          }
        >
          <p>Your data stays on this device.</p>
        </Dialog>
      ) : null}
    </section>
  );
}
