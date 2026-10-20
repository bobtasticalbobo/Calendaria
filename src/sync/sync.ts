import type { SqlDriver } from "../db/driver";
import { type Clock, systemClock } from "../db/records";
import type { SettingsRepository } from "../db/settings";
import { decrypt, encrypt, isEnvelope, newSalt } from "./crypto";
import { ENCRYPTED_FILE, GistStore, PLAIN_FILE, SyncError } from "./gist";
import { type Snapshot, syncDatabase } from "./merge";

export const TOKEN_KEY = "sync.token";
export const PASSPHRASE_KEY = "sync.passphrase";
// Set by versions before 0.6.0, which remembered the gist's id.
const GIST_KEY = "sync.gist";

export class NeedsPassphraseError extends SyncError {
  constructor() {
    super("Choose a passphrase to keep syncing. Your data is now encrypted before it leaves this device.");
  }
}

/**
 * One round of sync: read the shared copy, decrypt and merge it in, and write
 * it back encrypted if this device had changes it was missing. Returns
 * whether local data changed.
 *
 * There should be one gist. Any others (unencrypted ones from versions before
 * 0.6.0, or two devices starting at once) are merged in and then deleted,
 * history included, so no readable copy stays on GitHub.
 */
export async function syncOnce(
  db: SqlDriver,
  settings: SettingsRepository,
  store: (token: string) => GistStore = (token) => new GistStore(token),
  clock: Clock = systemClock,
): Promise<boolean> {
  const token = await settings.get(TOKEN_KEY);
  if (!token) return false;
  const passphrase = await settings.get(PASSPHRASE_KEY);
  if (!passphrase) throw new NeedsPassphraseError();
  const gists = store(token);

  const found = await gists.list();
  const primary = found.find((g) => g.encrypted)?.id ?? null;
  const extras = found.filter((g) => g.id !== primary);

  // Read everything before changing anything, so a wrong passphrase stops the round early.
  let salt = newSalt();
  let remote: Snapshot | null = null;
  const others: Snapshot[] = [];
  for (const gist of found) {
    const text = await gists.read(gist.id, gist.encrypted ? ENCRYPTED_FILE : PLAIN_FILE);
    if (!text) continue;
    const content: unknown = JSON.parse(text);
    const snapshot = isEnvelope(content) ? await decrypt(content, passphrase) : (content as Snapshot);
    if (gist.id === primary && isEnvelope(content)) {
      remote = snapshot;
      salt = content.kdf.salt;
    } else others.push(snapshot);
  }

  let localChanged = false;
  for (const snapshot of others) {
    if ((await syncDatabase(db, snapshot, clock)).localChanged) localChanged = true;
  }
  const result = await syncDatabase(db, remote, clock);
  const content = async () => JSON.stringify(await encrypt(result.snapshot, passphrase, salt));
  if (!primary) await gists.create(ENCRYPTED_FILE, await content());
  else if (result.remoteChanged || !remote) await gists.write(primary, ENCRYPTED_FILE, await content());

  for (const extra of extras) {
    await gists.remove(extra.id).catch((e) => {
      if (!(e instanceof SyncError && e.message === "not found")) throw e;
    });
  }
  return localChanged || result.localChanged;
}

export async function connect(settings: SettingsRepository, token: string, passphrase: string): Promise<void> {
  await settings.set(TOKEN_KEY, token.trim());
  await settings.set(PASSPHRASE_KEY, passphrase);
  await settings.remove(GIST_KEY);
}

export async function setPassphrase(settings: SettingsRepository, passphrase: string): Promise<void> {
  await settings.set(PASSPHRASE_KEY, passphrase);
}

export async function disconnect(settings: SettingsRepository): Promise<void> {
  await settings.remove(TOKEN_KEY);
  await settings.remove(PASSPHRASE_KEY);
  await settings.remove(GIST_KEY);
}
