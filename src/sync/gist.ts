import { SyncError } from "./sync";

// Sync through a GitHub gist was replaced by home-network sync in 0.9. This
// is what is left of it: enough to find the old gists and delete them.

const API = "https://api.github.com";
/** Every device with the same GitHub key finds the gist by this description. */
export const GIST_DESCRIPTION = "Calendaria sync";
/** Unencrypted file written by versions before 0.6.0. */
export const PLAIN_FILE = "calendaria.json";
export const ENCRYPTED_FILE = "calendaria.enc.json";

interface GistFile {
  raw_url: string;
}

interface Gist {
  id: string;
  description: string | null;
  files: Record<string, GistFile>;
}

/** The old shared copies: JSON files in private (secret) gists. */
export class GistStore {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (response.status === 401) throw new SyncError("GitHub didn't accept the key. Check it, or make a new one.");
    if (response.status === 404) throw new SyncError("not found");
    if (!response.ok) throw new SyncError(`GitHub answered ${response.status} ${response.statusText}`);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** This account's Calendaria gists, with whether each holds the encrypted file. */
  async list(): Promise<{ id: string; encrypted: boolean }[]> {
    const found: { id: string; encrypted: boolean }[] = [];
    for (let page = 1; ; page++) {
      const gists = await this.request<Gist[]>("GET", `/gists?per_page=100&page=${page}`);
      for (const g of gists) {
        if (g.description !== GIST_DESCRIPTION) continue;
        if (ENCRYPTED_FILE in g.files) found.push({ id: g.id, encrypted: true });
        else if (PLAIN_FILE in g.files) found.push({ id: g.id, encrypted: false });
      }
      if (gists.length < 100) return found;
    }
  }

  /** Deletes the gist and its history. */
  async remove(id: string): Promise<void> {
    await this.request("DELETE", `/gists/${id}`);
  }
}
