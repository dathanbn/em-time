// Focus sounds UI, loaded on demand: the picker sheet on the Timer and the Settings card.
import { useRef } from 'preact/hooks';
import { NOISE_IDS, ValidationError, type NoiseId, type Settings } from '@core';
import { core, data, timerState } from '../app/coreBridge';
import { loadNoise, noiseState } from '../app/noise';
import { noiseInfo } from '../app/noiseInfo';
import { unlockAudio } from '../platform/audio';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { Button, Card, Switch } from './ui';
import { useUid } from './uid';

const ERROR_TEXT = "Couldn't load. Check your connection.";

function save(patch: Partial<Settings>): void {
  try {
    core.store.updateSettings(patch);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
  }
}

const focusRunning = (): boolean => {
  const t = timerState.value;
  return t.phase === 'focus' && t.status === 'running';
};

/** A short taste of a sound. During a running focus session the engine owns the sound, so it does nothing. */
function preview(id: NoiseId, volume: number): void {
  unlockAudio();
  void loadNoise().then((m) => m.previewNoise(id, volume));
}

/** Picking a sound means you want it: turns sounds on. Live during focus, a 5 s preview otherwise. */
function pick(id: NoiseId): void {
  const s = core.store.get().settings;
  unlockAudio();
  save({ noise: id, noiseOn: true });
  if (!focusRunning()) preview(id, s.noiseVolume);
  else if (id === s.noise && noiseState.value.status === 'error') void loadNoise().then((m) => m.retryNoise());
}

function Tiles({ s }: { s: Settings }) {
  const st = noiseState.value;
  const ref = useRef<HTMLDivElement>(null);
  const last = NOISE_IDS.length - 1;
  const onKey = (e: KeyboardEvent) => {
    const i = NOISE_IDS.indexOf(s.noise);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = i === 0 ? last : i - 1;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = last;
    if (n < 0) return;
    e.preventDefault();
    pick(NOISE_IDS[n]!);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  return (
    <>
      <div ref={ref} class="ntiles" role="radiogroup" aria-label="Focus sound" onKeyDown={onKey}>
        {NOISE_IDS.map((id) => {
          const [label, emoji] = noiseInfo(id);
          const loading = st.status === 'loading' && st.id === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={s.noise === id}
              aria-busy={loading || undefined}
              tabIndex={s.noise === id ? 0 : -1}
              class="ntile"
              data-testid={`noise-option-${id}`}
              onClick={() => pick(id)}
            >
              <span class="ntile__emoji" aria-hidden="true">
                {emoji}
              </span>
              <span class="ntile__label">{label}</span>
              {loading ? <Icon name="sync" size={16} class="spin ntile__spin" /> : null}
            </button>
          );
        })}
      </div>
      {st.status === 'error' ? (
        <p class="error" role="status" data-testid="noise-error">
          {ERROR_TEXT}
        </p>
      ) : null}
    </>
  );
}

/** `name` is the accessible name when the page also has the chime volume slider (Settings). */
function Volume({ s, testid, name }: { s: Settings; testid: string; name?: string }) {
  const id = useUid('noise-vol');
  const pct = Math.round(s.noiseVolume * 100);
  return (
    <div class="slider">
      <label for={id} class="slider__label">
        Volume
      </label>
      <input
        id={id}
        data-testid={testid}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        aria-label={name}
        aria-valuetext={`${pct} percent`}
        onInput={(e) => {
          const v = Number((e.target as HTMLInputElement).value) / 100;
          save({ noiseVolume: v });
          preview(s.noise, v);
        }}
      />
      <span class="slider__value">{pct}</span>
    </div>
  );
}

function PickerBody() {
  const s = data.value.settings;
  return (
    <>
      <p class="hint hint--lead">Plays during focus sessions, pauses on breaks.</p>
      <Switch
        checked={s.noiseOn}
        onChange={(v) => {
          unlockAudio();
          save({ noiseOn: v });
        }}
        label="Sounds on"
        testid="noise-toggle"
      />
      <Tiles s={s} />
      <Volume s={s} testid="noise-volume" />
    </>
  );
}

export function NoisePicker({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Focus sounds" onClose={onClose} sheet testid="noise-picker">
      <PickerBody />
    </Dialog>
  );
}

const CREDITS = (
  <p class="smallprint" data-testid="noise-credits">
    Rain by alex36917 (freesound.org/s/524605) and Ocean by Luftrum (freesound.org/s/48412), CC BY, edited by
    Porrumentzio for the Blanket app, looped for Em Time. Stream by gluckose (freesound.org/s/333987), CC0.
    Café by stephan, Fireplace by ezwa and Summer night by Lisa Redfern (SoundBible), public domain.
  </p>
);

export function NoiseSettings() {
  const s = data.value.settings;
  return (
    <Card title="Focus sounds" testid="settings-noise">
      <Switch
        checked={s.noiseOn}
        onChange={(v) => {
          unlockAudio();
          save({ noiseOn: v });
        }}
        label="Play during focus"
        hint="Plays during focus sessions, pauses on breaks."
        testid="settings-noise-toggle"
      />
      <div role="radiogroup" aria-label="Focus sound" class="chimes">
        {NOISE_IDS.map((id) => {
          const [label, emoji] = noiseInfo(id);
          return (
            <div class="chimerow" key={id}>
              <label class="radiorow">
                <input
                  type="radio"
                  name="noise"
                  data-testid={`settings-noise-${id}`}
                  checked={s.noise === id}
                  onChange={() => pick(id)}
                />
                <span class="radiorow__dot" />
                <span aria-hidden="true">{emoji}</span>
                <span>{label}</span>
              </label>
              <Button variant="text" aria-label={`Preview ${label}`} onClick={() => preview(id, s.noiseVolume)}>
                Preview
              </Button>
            </div>
          );
        })}
      </div>
      <Volume s={s} testid="settings-noise-volume" name="Focus sounds volume" />
      {noiseState.value.status === 'error' ? (
        <p class="error" role="status">
          {ERROR_TEXT}
        </p>
      ) : null}
      {CREDITS}
    </Card>
  );
}
