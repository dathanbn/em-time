// Settings > Sync (design.md 7.5). Quiet by design: all sync copy lives in this card. It talks to
// the engine only through core.loadSync() and the SyncEngine API of contract.md section 3.7.
import { useEffect, useId, useState } from 'preact/hooks';
import { formatDayLabel, hasStoredAuth, todayKey, type SyncEngine, type SyncState } from '@core';
import { core, data } from '../app/coreBridge';
import { Dialog } from '../components/Dialog';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNED_IN = new Set(['idle', 'syncing', 'offline', 'error', 'auth-expired']);

const REQUEST_ERRORS = {
  'invalid-email': 'Enter a valid email address.',
  'rate-limited': 'Too many tries. Wait a minute and try again.',
  network: "Can't reach the server. Check your connection and try again.",
  unknown: 'Something went wrong. Try again in a moment.',
} as const;
const VERIFY_ERRORS = {
  'invalid-code': "That code didn't work. Check the latest email or send a new one.",
  expired: "That code didn't work. Check the latest email or send a new one.",
  network: "Can't reach the server. Check your connection and try again.",
  unknown: 'Something went wrong. Try again in a moment.',
} as const;

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
      return { icon: 'alert', text: 'Sync paused: sign in again' };
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
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(meta.email ?? '');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [confirmOut, setConfirmOut] = useState(false);
  const emailId = useId();
  const codeId = useId();

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
  useEffect(() => {
    if (st?.status === 'code-sent' && stage === 'email') {
      setStage('code');
      if (st.email) setEmail(st.email);
    }
  }, [st?.status]);

  const status = st?.status;
  const signedIn = status ? SIGNED_IN.has(status) : meta.userId !== null;
  const expired = status === 'auth-expired';
  const shownEmail = st?.email ?? meta.email ?? email;
  const rejected = st?.rejected ?? meta.rejected;

  const send = async () => {
    setErr('');
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setErr(REQUEST_ERRORS['invalid-email']);
      return;
    }
    setBusy(true);
    const e = engine ?? (await attach());
    if (!e) {
      setBusy(false);
      setErr(REQUEST_ERRORS.network);
      return;
    }
    const r = await e.requestCode(addr);
    setBusy(false);
    if (r.ok) {
      setStage('code');
      setCode('');
      setResendAt(Date.now() + 60_000);
    } else setErr(REQUEST_ERRORS[r.error]);
  };

  const verify = async (value: string) => {
    if (!engine || value.length !== 6 || busy) return;
    setBusy(true);
    setErr('');
    const r = await engine.verifyCode(email.trim(), value);
    setBusy(false);
    if (r.ok) {
      setStage('email');
      setCode('');
    } else {
      setErr(VERIFY_ERRORS[r.error]);
      setCode('');
    }
  };

  const view = statusView(st, now);
  const secs = Math.min(60, Math.max(0, Math.ceil((resendAt - now) / 1000)));

  const emailForm = (
    <form
      class="sync__form"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      novalidate
    >
      <label class="field__label" for={emailId}>
        Email
      </label>
      <input
        id={emailId}
        class="input"
        type="email"
        data-testid="sync-email-input"
        autoComplete="email"
        inputMode="email"
        value={email}
        placeholder="you@example.com"
        aria-describedby={err ? 'sync-err' : undefined}
        aria-invalid={err ? true : undefined}
        onFocus={() => void attach()}
        onInput={(e) => {
          setEmail((e.target as HTMLInputElement).value);
          setErr('');
        }}
      />
      {err ? (
        <p class="error" id="sync-err">
          {err}
        </p>
      ) : null}
      <div class="sync__actions">
        <Button variant="secondary" type="submit" disabled={busy} data-testid="sync-send">
          {busy ? 'Sending…' : 'Send sign-in link'}
        </Button>
      </div>
    </form>
  );

  const codeForm = (
    <form
      class="sync__form"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <p class="sync__lead">Check your email. Open the link on this device, or type the 6-digit code here.</p>
      <label class="field__label" for={codeId}>
        6-digit code
      </label>
      <input
        id={codeId}
        class="input input--code"
        data-testid="sync-code-input"
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={6}
        value={code}
        placeholder="123456"
        data-autofocus
        aria-describedby={err ? 'sync-err' : undefined}
        aria-invalid={err ? true : undefined}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
          setCode(v);
          setErr('');
          if (v.length === 6) void verify(v);
        }}
      />
      {err ? (
        <p class="error" id="sync-err">
          {err}
        </p>
      ) : null}
      <div class="sync__actions">
        <Button
          variant="secondary"
          type="submit"
          disabled={busy || code.length !== 6}
          data-testid="sync-verify"
        >
          {busy ? 'Checking…' : 'Verify'}
        </Button>
        <Button
          variant="text"
          onClick={() => {
            setStage('email');
            setErr('');
            setCode('');
          }}
        >
          Use a different email
        </Button>
        <Button variant="text" disabled={secs > 0 || busy} onClick={() => void send()}>
          {secs > 0 ? `Send again (${secs})` : 'Send again'}
        </Button>
      </div>
      {meta.lastUserId !== null ? (
        <p class="smallprint">This device's data will be added to the account you sign in to.</p>
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
            Signed in as <strong>{shownEmail}</strong>
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
          {expired ? (stage === 'code' ? codeForm : emailForm) : null}
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
      ) : stage === 'code' ? (
        codeForm
      ) : (
        <>
          <p class="sync__lead">Sign in to sync across devices.</p>
          {emailForm}
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
                  setStage('email');
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
