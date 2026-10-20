import { relaunch } from "@tauri-apps/plugin-process";
import { type Update, check } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

const CHECK_EVERY_MS = 5 * 60_000;

/**
 * A newer version published as a GitHub release, checked at launch, every
 * five minutes, and whenever the window comes back into focus. Releases are
 * signed, and the app only installs ones signed with the key whose public
 * half is in tauri.conf.json.
 */
export function useUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const look = () =>
      check()
        .then((found) => {
          setUpdate(found);
          setCheckedAt(new Date());
        })
        .catch((e) => console.warn("Update check failed", e));
    look();
    const timer = setInterval(look, CHECK_EVERY_MS);
    window.addEventListener("focus", look);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", look);
    };
  }, []);

  const install = async () => {
    if (!update || installing) return;
    setError(null);
    setInstalling(true);
    try {
      // On Windows the installer closes the app itself; relaunch covers other platforms.
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  /** Checks right away, for the button in Settings. */
  const checkNow = async () => {
    if (checking) return;
    setError(null);
    setChecking(true);
    try {
      setUpdate(await check());
      setCheckedAt(new Date());
    } catch (e) {
      setError(`Couldn't check for updates: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  return { update, installing, error, install, checking, checkedAt, checkNow };
}
