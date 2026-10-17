import { signal } from '@preact/signals';
import { MIN } from '@core';
import { Banner } from '../components/Banner';
import { Button } from '../components/ui';
import { downloadText } from '../platform/env';
import { clockTick, core, data } from './coreBridge';

const corruptDismissed = signal(false);

export function exportBackup(): void {
  const { filename, json } = core.store.exportNow(Date.now());
  downloadText(filename, json);
  core.store.markExported(Date.now());
}

/** Storage and recovery banners: shown at the top of every page. */
export function Banners() {
  void data.value;
  const status = core.store.status();
  const out = [];
  if (status === 'read-only-newer') {
    out.push(
      <Banner
        key="newer"
        actions={
          <Button variant="secondary" onClick={() => location.reload()}>
            Refresh
          </Button>
        }
      >
        This data is from a newer version of Em Time. Refresh to update.
      </Banner>,
    );
  } else if (status === 'quota' || status === 'unavailable') {
    out.push(
      <Banner
        key="storage"
        actions={
          <Button variant="secondary" onClick={exportBackup}>
            Export
          </Button>
        }
      >
        Em Time can't save on this device right now. Export to keep a copy.
      </Banner>,
    );
  }
  if (core.boot.status === 'recovered-corrupt' && core.boot.backupKey && !corruptDismissed.value) {
    const key = core.boot.backupKey;
    out.push(
      <Banner
        key="corrupt"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                let raw: string | null = null;
                try {
                  raw = localStorage.getItem(key);
                } catch {
                  /* storage unavailable */
                }
                if (raw) downloadText('em-time-damaged-data.json', raw);
              }}
            >
              Download
            </Button>
            <Button variant="text" onClick={() => (corruptDismissed.value = true)}>
              Dismiss
            </Button>
          </>
        }
      >
        Saved data couldn't be read, so Em Time started fresh. Your old data is kept as a file you can
        download.
      </Banner>,
    );
  }
  return out.length ? <div class="banners">{out}</div> : null;
}

/** Quiet backup reminder: Stats and Settings only (DAT-4). */
export function ExportReminder() {
  void data.value;
  void clockTick.value;
  if (!core.select.exportReminderDue()) return null;
  const never = core.store.get().meta.lastExportAt === null;
  return (
    <div class="banners">
      <Banner
        tone="info"
        actions={
          <>
            <Button variant="secondary" onClick={exportBackup}>
              Export
            </Button>
            <Button
              variant="text"
              onClick={() => core.store.snoozeExportReminder(Date.now() + 7 * 24 * 60 * MIN)}
            >
              Later
            </Button>
          </>
        }
      >
        {never
          ? 'Your history is saved on this device only. Export a backup so it can never get lost.'
          : "It's been a while since your last backup. Export a copy to keep your history safe."}
      </Banner>
    </div>
  );
}
