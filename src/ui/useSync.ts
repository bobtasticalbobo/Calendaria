import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SqlDriver } from "../db/driver";
import type { SettingsRepository } from "../db/settings";
import { DEFAULT_PORT, LanSync, type Peer } from "../sync/lan";
import { SyncError, retireGist } from "../sync/sync";
import { advertise, deviceName, localAddresses, reply, serve, tauriTransport } from "../sync/tauriLan";
import { IS_MOBILE } from "./useUpdate";

const SYNC_EVERY_MS = 30_000;
/** Wait this long after a change before syncing it, so typing doesn't sync every key. */
const AFTER_CHANGE_MS = 3_000;

export interface Pairing {
  code: string;
  link: string;
  until: number;
}

function message(e: unknown): string {
  return e instanceof SyncError ? e.message : `Couldn't sync: ${String(e)}`;
}

/**
 * Keeps this device in sync with the others on the home network (or
 * Tailscale): at launch, every 30 seconds, when the window gains focus or the
 * phone app comes back, and shortly after each change here. PCs also answer
 * the others. `onRemoteChange` reloads the views.
 */
export function useSync(
  db: SqlDriver | null,
  settings: SettingsRepository | null,
  localVersion: number,
  onRemoteChange: () => void,
) {
  const [lan, setLan] = useState<LanSync | null>(null);
  const [paired, setPaired] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [reached, setReached] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const port = useRef<number | null>(null);
  const advertised = useRef(false);
  const onChange = useRef(onRemoteChange);
  onChange.current = onRemoteChange;

  // PCs serve the others; the phone only calls out, so it has no port.
  const startServer = useCallback(async (sync: LanSync) => {
    if (IS_MOBILE) return;
    port.current ??= await serve(DEFAULT_PORT);
    const group = await sync.group();
    if (group && !advertised.current) {
      advertised.current = true;
      await advertise(sync.id, await deviceName(), group, port.current);
    }
  }, []);

  useEffect(() => {
    if (!db || !settings || !("__TAURI_INTERNALS__" in window)) return;
    let name: Promise<string> | null = null;
    const sync = new LanSync(db, settings, tauriTransport, async () => ({
      name: await (name ??= deviceName()),
      port: port.current,
      addresses: IS_MOBILE ? [] : await localAddresses(),
    }));
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      await sync.load();
      retireGist(settings).catch((e) => console.warn("Couldn't delete the old GitHub copy yet", e));
      const unlisten = await listen<{ id: number; body: string }>("lan-request", async ({ payload }) => {
        const answer = await sync
          .handle(payload.body, () => onChange.current())
          .catch(() => ({ status: 500, body: "" }));
        await reply(payload.id, answer.status, answer.body);
        setPeers(sync.peerList());
      });
      if (cancelled) return unlisten();
      stop = unlisten;
      if (sync.paired) await startServer(sync).catch((e) => setError(message(e)));
      setPaired(sync.paired);
      setPeers(sync.peerList());
      setLan(sync);
    })().catch((e) => setError(message(e)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [db, settings, startServer]);

  const running = useRef<Promise<void> | null>(null);
  const syncNow = useCallback(async () => {
    if (!lan?.paired) return;
    // A round already running covers this one.
    if (running.current) return running.current;
    running.current = (async () => {
      setSyncing(true);
      try {
        const result = await lan.syncAll();
        if (result.localChanged) onChange.current();
        setReached(result.reached);
        if (result.reached.length) setLastSynced(new Date());
        setError(null);
      } catch (e) {
        setError(message(e));
      } finally {
        setPeers(lan.peerList());
        setSyncing(false);
        running.current = null;
      }
    })();
    return running.current;
  }, [lan]);

  useEffect(() => {
    if (!paired) return;
    syncNow();
    const timer = setInterval(syncNow, SYNC_EVERY_MS);
    const visible = () => document.visibilityState === "visible" && syncNow();
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [paired, syncNow]);

  useEffect(() => {
    if (!paired || localVersion === 0) return;
    const timer = setTimeout(syncNow, AFTER_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [paired, localVersion, syncNow]);

  /** Shows a code for another device to join with (PCs only). */
  const startPairing = async () => {
    if (!lan) return;
    setError(null);
    try {
      port.current ??= await serve(DEFAULT_PORT);
      setPairing(await lan.startPairing());
      await startServer(lan);
      setPaired(true);
    } catch (e) {
      setError(message(e));
    }
  };

  const stopPairing = () => {
    lan?.cancelPairing();
    setPairing(null);
    if (lan) setPeers(lan.peerList());
  };

  /** Joins using a code typed, pasted or scanned from a PC. Throws a readable error. */
  const join = async (text: string, address?: string) => {
    if (!lan) return;
    setError(null);
    await lan.join(text, address);
    advertised.current = false;
    await startServer(lan);
    setPaired(true);
    setPeers(lan.peerList());
    await syncNow();
  };

  const forget = async (id: string) => {
    if (!lan) return;
    await lan.forget(id);
    setPeers(lan.peerList());
  };

  const leave = async () => {
    if (!lan) return;
    await lan.leave();
    setPaired(false);
    setPeers([]);
    setPairing(null);
    setLastSynced(null);
    setError(null);
  };

  return {
    ready: lan !== null,
    canHost: !IS_MOBILE,
    paired,
    peers,
    reached,
    syncing,
    lastSynced,
    error,
    pairing,
    syncNow,
    startPairing,
    stopPairing,
    join,
    forget,
    leave,
  };
}
