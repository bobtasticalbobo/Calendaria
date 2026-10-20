import Database from "@tauri-apps/plugin-sql";
import type { SqlDriver } from "./driver";

/** Must match DB_URL in src-tauri/src/lib.rs, where migrations are registered. */
export const DB_URL = "sqlite:calendaria.db";

export async function openTauriDriver(): Promise<SqlDriver> {
  const db = await Database.load(DB_URL);
  return {
    execute: (sql, params = []) => db.execute(sql, params),
    select: (sql, params = []) => db.select(sql, params),
  };
}
