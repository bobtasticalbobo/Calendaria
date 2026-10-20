import type { SqlDriver } from "../db/driver";
import { type Clock, systemClock } from "../db/records";
import type { SettingsRepository } from "../db/settings";
import { GistStore, SyncError } from "./gist";
import { syncDatabase } from "./merge";

export const TOKEN_KEY = "sync.token";
const GIST_KEY = "sync.gist";

/**
 * One round of sync: read the shared copy, merge it in, and write it back if
 * this device had changes it was missing. Returns whether local data changed.
 */
export async function syncOnce(
  db: SqlDriver,
  settings: SettingsRepository,
  store: (token: string) => GistStore = (token) => new GistStore(token),
  clock: Clock = systemClock,
): Promise<boolean> {
  const token = await settings.get(TOKEN_KEY);
  if (!token) return false;
  const gists = store(token);

  let id = (await settings.get(GIST_KEY)) ?? (await gists.find());
  let remote = null;
  if (id) {
    try {
      remote = await gists.read(id);
    } catch (e) {
      // The gist was deleted on GitHub: start a new one from this device's data.
      if (!(e instanceof SyncError && e.message === "not found")) throw e;
      id = null;
    }
  }

  const result = await syncDatabase(db, remote, clock);
  if (!id) id = await gists.create(result.snapshot);
  else if (result.remoteChanged) await gists.write(id, result.snapshot);
  await settings.set(GIST_KEY, id);
  return result.localChanged;
}

export async function connect(settings: SettingsRepository, token: string): Promise<void> {
  await settings.set(TOKEN_KEY, token.trim());
  await settings.remove(GIST_KEY);
}

export async function disconnect(settings: SettingsRepository): Promise<void> {
  await settings.remove(TOKEN_KEY);
  await settings.remove(GIST_KEY);
}
