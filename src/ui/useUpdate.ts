import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";

const CHECK_EVERY_MS = 5 * 60_000;
const LATEST_RELEASE = "https://api.github.com/repos/bobtasticalbobo/Calendaria/releases/latest";

/** The phone app can't replace itself: Android installs the newer APK. */
export const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);

interface Found {
  version: string;
  /** Desktop: installs the signed update. Phone: opens the APK download. */
  apply: () => Promise<void>;
}

/** Compares dotted version numbers, e.g. "0.8.10" > "0.8.9". */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function checkDesktop(): Promise<Found | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    apply: async () => {
      // On Windows the installer closes the app itself; relaunch covers other platforms.
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}

async function checkMobile(): Promise<Found | null> {
  const res = await fetch(LATEST_RELEASE, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const release = (await res.json()) as {
    tag_name: string;
    html_url: string;
    assets: { name: string; browser_download_url: string }[];
  };
  const version = release.tag_name.replace(/^v/, "");
  if (!isNewer(version, __APP_VERSION__)) return null;
  const apk = release.assets.find((a) => a.name.endsWith(".apk"));
  if (!apk) return null;
  return { version, apply: () => openUrl(apk.browser_download_url) };
}

/**
 * A newer version published as a GitHub release, checked at launch, every
 * five minutes, and whenever the window comes back into focus. On desktop
 * releases are signed, and the app only installs ones signed with the key
 * whose public half is in tauri.conf.json. On a phone the update opens the
 * release's APK, which Android checks against the installed app's signature.
 */
export function useUpdate() {
  const [update, setUpdate] = useState<Found | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const lookRef = useRef(IS_MOBILE ? checkMobile : checkDesktop);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const look = () =>
      lookRef
        .current()
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
      await update.apply();
    } catch (e) {
      setError(String(e));
    } finally {
      // Desktop restarts on success; the phone hands off to the browser.
      setInstalling(false);
    }
  };

  /** Checks right away, for the button in Settings. */
  const checkNow = async () => {
    if (checking) return;
    setError(null);
    setChecking(true);
    try {
      setUpdate(await lookRef.current());
      setCheckedAt(new Date());
    } catch (e) {
      setError(`Couldn't check for updates: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  const installLabel = IS_MOBILE ? "Download update" : "Update and restart";

  return { update, installing, error, install, installLabel, checking, checkedAt, checkNow };
}

/**
 * How a version is shown: "0.9.0" as "0.9" and "0.9.1" as "0.9.001", so the
 * small steps after a milestone read as small. The real number stays plain
 * semver, which the updater and Android need.
 */
export function displayVersion(version: string): string {
  const [major, minor, patch] = version.split(".");
  if (patch === undefined) return version;
  return Number(patch) === 0 ? `${major}.${minor}` : `${major}.${minor}.${patch.padStart(3, "0")}`;
}
