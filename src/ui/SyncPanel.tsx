import { openUrl } from "@tauri-apps/plugin-opener";
import { type FormEvent, useState } from "react";
import { Temporal } from "../time/temporal";
import { NEW_KEY_URL } from "../sync/gist";
import { formatTime } from "./dates";
import type { useSync } from "./useSync";

/** The sidebar's sync section: set up once per device with a GitHub key. */
export function SyncPanel({ sync }: { sync: ReturnType<typeof useSync> }) {
  const [settingUp, setSettingUp] = useState(false);
  const [token, setToken] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await sync.connect(token);
    setToken("");
    setSettingUp(false);
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
        <button type="submit">Sync</button>
      </div>
      <button type="button" className="link" onClick={() => setSettingUp(false)}>
        Cancel
      </button>
    </form>
  );
}
