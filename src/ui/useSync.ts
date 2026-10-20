import { useCallback, useEffect, useRef, useState } from "react";
import type { SqlDriver } from "../db/driver";
import type { SettingsRepository } from "../db/settings";
import { WrongPassphraseError } from "../sync/crypto";
import { SyncError } from "../sync/gist";
import {
  NeedsPassphraseError,
  PASSPHRASE_KEY,
  TOKEN_KEY,
  connect as save,
  disconnect as forget,
  setPassphrase as savePassphrase,
  syncOnce,
} from "../sync/sync";

const SYNC_EVERY_MS = 30_000;
/** Wait this long after a change before syncing it, so typing doesn't sync every key. */
const AFTER_CHANGE_MS = 3_000;

/**
 * Keeps this device in sync with the others through the shared gist: at
 * launch, every 30 seconds, when the window gains or loses focus, and shortly
 * after each change here. `onRemoteChange` reloads the views.
 */
export function useSync(
  db: SqlDriver | null,
  settings: SettingsRepository | null,
  localVersion: number,
  onRemoteChange: () => void,
) {
  const [enabled, setEnabled] = useState(false);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const onChange = useRef(onRemoteChange);
  onChange.current = onRemoteChange;

  const sync = useCallback(async () => {
    if (!db || !settings) return;
    // A round already running finishes first, then this one catches what it missed.
    while (running.current) await running.current;
    running.current = (async () => {
      setSyncing(true);
      try {
        if (await syncOnce(db, settings)) onChange.current();
        setLastSynced(new Date());
        setError(null);
        setNeedsPassphrase(false);
      } catch (e) {
        if (e instanceof NeedsPassphraseError || e instanceof WrongPassphraseError) setNeedsPassphrase(true);
        setError(e instanceof SyncError ? e.message : `Couldn't sync: ${String(e)}`);
      } finally {
        setSyncing(false);
      }
    })();
    await running.current;
    running.current = null;
  }, [db, settings]);

  useEffect(() => {
    if (!settings) return;
    Promise.all([settings.get(TOKEN_KEY), settings.get(PASSPHRASE_KEY)]).then(([token, passphrase]) => {
      setEnabled(token !== null);
      setNeedsPassphrase(token !== null && passphrase === null);
    });
  }, [settings]);

  useEffect(() => {
    if (!enabled) return;
    sync();
    const timer = setInterval(sync, SYNC_EVERY_MS);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, [enabled, sync]);

  useEffect(() => {
    if (!enabled || localVersion === 0) return;
    const timer = setTimeout(sync, AFTER_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [enabled, localVersion, sync]);

  const connect = async (token: string, passphrase: string) => {
    if (!settings || !token.trim() || !passphrase) return;
    await save(settings, token, passphrase);
    setEnabled(true);
  };

  const setPassphrase = async (passphrase: string) => {
    if (!settings || !passphrase) return;
    await savePassphrase(settings, passphrase);
    setNeedsPassphrase(false);
    await sync();
  };

  const disconnect = async () => {
    if (!settings) return;
    await forget(settings);
    setEnabled(false);
    setNeedsPassphrase(false);
    setLastSynced(null);
    setError(null);
  };

  return { enabled, needsPassphrase, syncing, lastSynced, error, syncNow: sync, connect, setPassphrase, disconnect };
}
