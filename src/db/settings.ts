import type { SqlDriver } from "./driver";

/** Device-local key/value settings. These never sync. */
export class SettingsRepository {
  constructor(private readonly db: SqlDriver) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db.select<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
    return rows.length ? rows[0].value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  async remove(key: string): Promise<void> {
    await this.db.execute("DELETE FROM settings WHERE key = $1", [key]);
  }
}
