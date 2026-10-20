import type { Snapshot } from "./merge";

const API = "https://api.github.com";
/** Every device with the same GitHub key finds the gist by this description. */
export const GIST_DESCRIPTION = "Calendaria sync";
const FILE = "calendaria.json";

/** Opens the GitHub page that creates a key allowed to touch gists only. */
export const NEW_KEY_URL = "https://github.com/settings/tokens/new?scopes=gist&description=Calendaria%20sync";

export class SyncError extends Error {}

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url: string;
}

interface Gist {
  id: string;
  description: string | null;
  files: Record<string, GistFile>;
}

/** The shared copy, kept as one JSON file in a private (secret) gist. */
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
    return (await response.json()) as T;
  }

  /** The id of this account's Calendaria gist, or null if there isn't one yet. */
  async find(): Promise<string | null> {
    for (let page = 1; ; page++) {
      const gists = await this.request<Gist[]>("GET", `/gists?per_page=100&page=${page}`);
      const match = gists.find((g) => g.description === GIST_DESCRIPTION && FILE in g.files);
      if (match) return match.id;
      if (gists.length < 100) return null;
    }
  }

  async create(snapshot: Snapshot): Promise<string> {
    const gist = await this.request<Gist>("POST", "/gists", {
      description: GIST_DESCRIPTION,
      public: false,
      files: { [FILE]: { content: JSON.stringify(snapshot) } },
    });
    return gist.id;
  }

  async read(id: string): Promise<Snapshot | null> {
    const gist = await this.request<Gist>("GET", `/gists/${id}`);
    const file = gist.files[FILE];
    if (!file) return null;
    // The API cuts files over 1 MB short; the raw copy is complete.
    const content =
      file.truncated || file.content === undefined
        ? await (await this.fetcher(file.raw_url, { cache: "no-store" })).text()
        : file.content;
    return JSON.parse(content) as Snapshot;
  }

  async write(id: string, snapshot: Snapshot): Promise<void> {
    await this.request("PATCH", `/gists/${id}`, { files: { [FILE]: { content: JSON.stringify(snapshot) } } });
  }
}
