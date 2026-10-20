import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface LocalUpdate {
  version: string;
  path: string;
}

/** A newer installer in Documents\Calendaria\updates, checked at launch. */
export function useLocalUpdate() {
  const [update, setUpdate] = useState<LocalUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<LocalUpdate | null>("check_local_update")
      .then(setUpdate)
      .catch((e) => console.warn("Update check failed", e));
  }, []);

  const install = () => {
    if (!update) return;
    setError(null);
    // The app closes and the installer reopens it when done.
    invoke("install_local_update", { path: update.path }).catch((e) => setError(String(e)));
  };

  return { update, error, install };
}
