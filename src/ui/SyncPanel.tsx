import { openUrl } from "@tauri-apps/plugin-opener";
import { type FormEvent, useState } from "react";
import { Temporal } from "../time/temporal";
import { NEW_KEY_URL } from "../sync/gist";
import { formatTime } from "./dates";
import type { useSync } from "./useSync";

const PASSPHRASE_HINT =
  "Your calendar is encrypted with this before it leaves the device. Use the same passphrase on every device. If you forget it, the synced copy can't be read, though each device keeps its own data.";

/** The sync section in Settings: set up once per device with a GitHub key and a passphrase. */
export function SyncPanel({ sync }: { sync: ReturnType<typeof useSync> }) {
  const [settingUp, setSettingUp] = useState(false);
  const [token, setToken] = useState("");
  const [passphrase, setPassphrase] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim() || !passphrase) return;
    await sync.connect(token, passphrase);
    setToken("");
    setPassphrase("");
    setSettingUp(false);
  }

  async function submitPassphrase(e: FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    await sync.setPassphrase(passphrase);
    setPassphrase("");
  }

  if (sync.enabled && sync.needsPassphrase) {
    return (
      <form className="sync" onSubmit={submitPassphrase}>
        {sync.error && <p className="error-text">{sync.error}</p>}
        <p className="muted">{PASSPHRASE_HINT}</p>
        <div className="add-calendar">
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            aria-label="Sync passphrase"
            autoFocus
          />
          <button type="submit">Save</button>
        </div>
        <button type="button" className="link" onClick={sync.disconnect}>
          Stop syncing
        </button>
      </form>
    );
  }

  if (sync.enabled) {
    const at = sync.lastSynced && Temporal.Instant.fromEpochMilliseconds(sync.lastSynced.getTime());
    return (
      <div className="sync">
        <p className="muted">
          {sync.syncing && !at ? "Syncing…" : at ? `Synced at ${formatTime(at.toZonedDateTimeISO(Temporal.Now.timeZoneId()))}` : "Not synced yet"}
        </p>
        {sync.error && <p className="error-text">{sync.error}</p>}
        <div className="sync-actions">
          <button type="button" className="link" onClick={sync.syncNow}>
            Sync now
          </button>
          <button type="button" className="link" onClick={sync.disconnect}>
            Stop syncing
          </button>
        </div>
      </div>
    );
  }

  if (!settingUp) {
    return (
      <button type="button" className="link sync-start" onClick={() => setSettingUp(true)}>
        Sync with your other devices
      </button>
    );
  }

  return (
    <form className="sync" onSubmit={submit}>
      <p className="muted">
        Paste a GitHub key that can use gists. Use the same key on every device.
      </p>
      <button type="button" className="link accent" onClick={() => openUrl(NEW_KEY_URL)}>
        Make a key on GitHub
      </button>
      <div className="add-calendar">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_…"
          aria-label="GitHub key"
          autoFocus
        />
      </div>
      <p className="muted">{PASSPHRASE_HINT}</p>
      <div className="add-calendar">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          aria-label="Sync passphrase"
        />
        <button type="submit" disabled={!token.trim() || !passphrase}>
          Sync
        </button>
      </div>
      <button type="button" className="link" onClick={() => setSettingUp(false)}>
        Cancel
      </button>
    </form>
  );
}
