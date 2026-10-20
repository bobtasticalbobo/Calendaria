import { relaunch } from "@tauri-apps/plugin-process";
import { type Update, check } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

const CHECK_EVERY_MS = 30 * 60_000;

/**
 * A newer version published as a GitHub release, checked at launch and every
 * half hour. Releases are signed, and the app only installs ones signed with
 * the key whose public half is in tauri.conf.json.
 */
export function useUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const look = () =>
      check()
        .then(setUpdate)
        .catch((e) => console.warn("Update check failed", e));
    look();
    const timer = setInterval(look, CHECK_EVERY_MS);
    return () => clearInterval(timer);
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

  return { update, installing, error, install };
}
