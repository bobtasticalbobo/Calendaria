import type { SettingsRepository } from "../db/settings";
import { GistStore } from "./gist";

export class SyncError extends Error {}

/** Settings from the GitHub gist sync of 0.4 to 0.8. */
const OLD_KEYS = ["sync.token", "sync.passphrase", "sync.gist"];

/**
 * Deletes the old gist copies from GitHub, history included, then forgets the
 * GitHub key. Runs at launch until it succeeds once; any device that still has
 * the key can do it.
 */
export async function retireGist(
  settings: SettingsRepository,
  store: (token: string) => GistStore = (token) => new GistStore(token),
): Promise<void> {
  const token = await settings.get("sync.token");
  if (token) {
    const gists = store(token);
    for (const gist of await gists.list()) {
      await gists.remove(gist.id).catch((e) => {
        if (!(e instanceof SyncError && e.message === "not found")) throw e;
      });
    }
  }
  for (const key of OLD_KEYS) await settings.remove(key);
}
