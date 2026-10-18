// Settings > Friends (v6), loaded on demand (app/friends.ts loadFriendsUi). A read-only friend code
// to share, and up to 5 friends' codes to follow. This is not the sync code, and says so.
import { useEffect, useState } from 'preact/hooks';
import type { FriendAddError, FriendWeek, FriendsApi, FriendsResult } from '@core';
import { FRIENDS_MAX, formatFriendCode } from '@core/sync/friendCode';
import { data } from '../app/coreBridge';
import { friends, refreshFriends } from '../app/friends';
import { friendsApi } from '../app/friendsRun';
const friendName = (f: FriendWeek, i: number) => f.nickname ?? f.displayName ?? `Friend ${i + 1}`;
import { announce } from '../platform/announce';
import { Dialog } from './Dialog';
import { Button, Card, IconButton } from './ui';
import { useUid } from './uid';

const ERRORS: Record<FriendAddError, string> = {
  invalid: 'Friend codes are 8 letters and numbers, like K7QP-2MXD.',
  not_found: 'No one is sharing with that code. Check it with your friend.',
  own_code: "That's your own code.",
  duplicate: 'That friend is already on your list.',
  limit: `You can add up to ${FRIENDS_MAX} friends.`,
  offline: "Can't reach the server. Try again when you're online.",
  'auth-expired': 'Link this device again to manage friends.',
  signed_out: 'Link this device again to manage friends.',
  unknown: 'Something went wrong. Try again.',
};

async function act<T>(fn: (api: FriendsApi) => Promise<FriendsResult<T>>): Promise<FriendsResult<T>> {
  const api = await friendsApi();
  return api ? fn(api) : { ok: false, error: 'unknown' };
}

const setShare = (share: string | null): void => {
  friends.value = { ...friends.value, share };
};

function Share({ share, loaded, failed }: { share: string | null; loaded: boolean; failed: boolean }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'rotate' | 'disable' | null>(null);
  const name = data.value.settings.displayName.trim();

  const run = async (fn: (api: FriendsApi) => Promise<FriendsResult<string | null>>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setErr('');
    const r = await act(fn);
    setBusy(false);
    if (!r.ok) {
      setErr(ERRORS[r.error]);
      return false;
    }
    setShare(r.value);
    void refreshFriends({ force: true });
    return true;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatFriendCode(share!));
      announce('Code copied');
    } catch {
      announce("Couldn't copy. Select the code and copy it by hand.");
    }
  };
  const share_ = async () => {
    try {
      await navigator.share({ text: `Add me on Em Time with my friend code ${formatFriendCode(share!)}` });
    } catch {
      /* closed without sharing */
    }
  };

  return (
    <div class="fshare">
      <h3 class="subhead">Your friend code</h3>
      {!loaded ? (
        <p class="hint hint--lead">{failed ? 'Your code will show when the connection is back.' : 'Loading…'}</p>
      ) : share === null ? (
        <>
          <p class="hint hint--lead">
            Friends with your code see your name{name ? ` (${name})` : ''} and how many minutes you focus each
            day. Nothing else.
          </p>
          <div class="btnrow">
            <Button
              variant="secondary"
              disabled={busy}
              data-testid="friends-share-enable"
              onClick={() => void run((api) => api.enableShare())}
            >
              Get my friend code
            </Button>
          </div>
        </>
      ) : (
        <>
          <p class="fcode" data-testid="friends-share-code" aria-label={`Your friend code: ${share.split('').join(' ')}`}>
            {formatFriendCode(share)}
          </p>
          <p class="hint hint--lead">
            Friends with your code see your name{name ? ` (${name})` : ''} and how many minutes you focus each
            day. Nothing else.
          </p>
          <div class="btnrow">
            <Button variant="secondary" data-testid="friends-share-copy" onClick={() => void copy()}>
              Copy
            </Button>
            {typeof navigator !== 'undefined' && 'share' in navigator ? (
              <Button variant="secondary" data-testid="friends-share-share" onClick={() => void share_()}>
                Share
              </Button>
            ) : null}
            <div class="btnrow fshare__more">
              <Button variant="text" disabled={busy} data-testid="friends-share-rotate" onClick={() => setConfirm('rotate')}>
                New code
              </Button>
              <Button variant="text" disabled={busy} data-testid="friends-share-disable" onClick={() => setConfirm('disable')}>
                Stop sharing
              </Button>
            </div>
          </div>
        </>
      )}
      <p class="smallprint">This is not your sync code. It can't open or change your data.</p>
      {err ? (
        <p class="error" role="alert" data-testid="friends-share-error">
          {err}
        </p>
      ) : null}
      {confirm === 'rotate' ? (
        <Dialog
          title="Get a new code?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                data-testid="friends-rotate-confirm"
                onClick={async () => {
                  setConfirm(null);
                  if (await run((api) => api.rotateShare())) announce('New friend code ready');
                }}
              >
                New code
              </Button>
            </>
          }
        >
          <p>Friends using your current code will stop seeing your minutes until you send them the new one.</p>
        </Dialog>
      ) : null}
      {confirm === 'disable' ? (
        <Dialog
          title="Stop sharing?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                data-testid="friends-disable-confirm"
                onClick={async () => {
                  setConfirm(null);
                  if (await run((api) => api.disableShare())) announce('Sharing is off');
                }}
              >
                Stop sharing
              </Button>
            </>
          }
        >
          <p>
            Friends will stop seeing your minutes. If you turn sharing on again you get a new code, so your
            friends will need it.
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}

function AddForm() {
  const codeId = useUid();
  const nameId = useUid();
  const [code, setCode] = useState('');
  const [nick, setNick] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const api = await friendsApi();
    const r: { ok: true } | { ok: false; error: FriendAddError } = api
      ? await api.add(code, nick)
      : { ok: false, error: 'unknown' };
    setBusy(false);
    if (!r.ok) {
      setErr(ERRORS[r.error]);
      return;
    }
    setCode('');
    setNick('');
    announce('Friend added');
    void refreshFriends({ force: true });
  };

  return (
    <form
      class="fadd"
      novalidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div class="field">
        <label class="field__label" for={codeId}>
          Friend's code
        </label>
        <input
          id={codeId}
          class="input fadd__code"
          data-testid="friends-add-code"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellcheck={false}
          placeholder="K7QP-2MXD"
          value={code}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? 'friends-add-error' : undefined}
          onInput={(e) => {
            setCode((e.target as HTMLInputElement).value);
            setErr('');
          }}
        />
      </div>
      <div class="field">
        <label class="field__label" for={nameId}>
          Name (optional)
        </label>
        <input
          id={nameId}
          class="input"
          data-testid="friends-add-name"
          autoComplete="off"
          maxLength={24}
          value={nick}
          onInput={(e) => setNick((e.target as HTMLInputElement).value)}
        />
      </div>
      {err ? (
        <p class="error" id="friends-add-error" role="alert" data-testid="friends-add-error">
          {err}
        </p>
      ) : null}
      <div class="btnrow">
        <Button variant="secondary" type="submit" disabled={busy} data-testid="friends-add">
          {busy ? 'Adding…' : 'Add friend'}
        </Button>
      </div>
    </form>
  );
}

function Row({ f, index }: { f: FriendWeek; index: number }) {
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useUid();
  const name = friendName(f, index);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const r = await act((api) => api.rename(f.code, text));
    setBusy(false);
    if (!r.ok) {
      setErr(ERRORS[r.error]);
      return;
    }
    setEdit(false);
    void refreshFriends({ force: true });
  };
  const remove = async () => {
    setBusy(true);
    const r = await act((api) => api.remove(f.code));
    setBusy(false);
    if (!r.ok) {
      setErr(ERRORS[r.error]);
      return;
    }
    setDel(false);
    announce(`${name} removed`);
    void refreshFriends({ force: true });
  };

  return (
    <li class="frow" data-testid="friends-row" data-code={f.code} data-active={f.active}>
      <span class="fdot" style={{ background: `var(--em-cat-${f.color})` }} aria-hidden="true" />
      <div class="frow__text">
        <span class="frow__name" data-testid="friends-row-name">
          {name}
        </span>
        <span class="frow__code">{formatFriendCode(f.code)}</span>
        {!f.active ? <span class="fbadge">Code off</span> : null}
      </div>
      <IconButton
        icon="pencil"
        label={`Rename ${name}`}
        class="iconbtn--ghost"
        data-testid="friends-rename"
        onClick={() => {
          setText(f.nickname ?? f.displayName ?? '');
          setErr('');
          setEdit(true);
        }}
      />
      <IconButton
        icon="trash"
        label={`Remove ${name}`}
        class="iconbtn--ghost"
        data-testid="friends-remove"
        onClick={() => {
          setErr('');
          setDel(true);
        }}
      />
      {edit ? (
        <Dialog
          title="Rename friend"
          onClose={() => setEdit(false)}
          footer={
            <>
              <Button variant="text" onClick={() => setEdit(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy} data-testid="friends-rename-save" onClick={() => void save()}>
                Save
              </Button>
            </>
          }
        >
          <form
            class="field"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label class="field__label" for={inputId}>
              Name
            </label>
            <input
              id={inputId}
              class="input"
              data-testid="friends-rename-input"
              data-autofocus
              autoComplete="off"
              maxLength={24}
              value={text}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
            />
            <p class="hint">Leave it empty to use their own name.</p>
            {err ? (
              <p class="error" role="alert">
                {err}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
      {del ? (
        <Dialog
          title={`Remove ${name}?`}
          onClose={() => setDel(false)}
          footer={
            <>
              <Button variant="text" onClick={() => setDel(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={busy} data-testid="friends-remove-confirm" onClick={() => void remove()}>
                Remove
              </Button>
            </>
          }
        >
          <p>They will leave your Friends chart. You can add them again with their code.</p>
          {err ? (
            <p class="error" role="alert">
              {err}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </li>
  );
}

export function FriendsCard() {
  const st = friends.value;
  const signedIn = st.status !== 'signed-out' && st.status !== 'off';
  useEffect(() => {
    if (signedIn) void refreshFriends();
  }, [signedIn]);

  const loaded = st.fetchedAt !== null || st.status === 'ready';
  const failed = st.status === 'offline' || st.status === 'error';
  return (
    <Card title="Friends" testid="settings-friends">
      {!signedIn ? (
        <p class="hint hint--lead" data-testid="friends-signed-out">
          Link this device with a sync code above to share with friends.
        </p>
      ) : (
        <>
          <Share share={st.share} loaded={loaded} failed={failed} />
          <div class="fgroup">
            <h3 class="subhead">
              Friends ({st.list.length} of {FRIENDS_MAX})
            </h3>
            {failed ? (
              <>
                <p class="hint hint--lead" role="status" data-testid="friends-load-error">
                  {st.error === 'auth-expired'
                    ? ERRORS['auth-expired']
                    : st.status === 'offline'
                      ? ERRORS.offline
                      : "Couldn't load your friends."}
                </p>
                <div class="btnrow">
                  <Button variant="text" data-testid="friends-retry" onClick={() => void refreshFriends({ force: true })}>
                    Try again
                  </Button>
                </div>
              </>
            ) : null}
            {st.list.length === 0 && loaded ? <p class="hint hint--lead">No friends yet.</p> : null}
            {st.list.length > 0 ? (
              <ul class="frows" data-testid="friends-list">
                {st.list.map((f, i) => (
                  <Row key={f.code} f={f} index={i} />
                ))}
              </ul>
            ) : null}
            {st.list.length < FRIENDS_MAX ? (
              <AddForm />
            ) : (
              <p class="smallprint" data-testid="friends-full">
                That's the limit of {FRIENDS_MAX} friends. Remove one to add another.
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

