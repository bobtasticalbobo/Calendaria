import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { SqlDriver } from "../src/db/driver";

// node:sqlite is loaded via require so Vite doesn't try to bundle it.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

export const MIGRATIONS_DIR = join(import.meta.dirname, "../src-tauri/migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** In-memory SQLite with the app's real migrations applied. */
export function createTestDriver(): SqlDriver {
  const db = new DatabaseSync(":memory:");
  // sqlx, which tauri-plugin-sql uses, turns foreign keys on by default.
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of migrationFiles()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  // tauri-plugin-sql uses $1-style placeholders; ?1 is SQLite's numbered equivalent.
  const prepare = (sql: string) => db.prepare(sql.replace(/\$(\d+)/g, "?$1"));
  return {
    async execute(sql, params = []) {
      const result = prepare(sql).run(...(params as never[]));
      return { rowsAffected: Number(result.changes) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return prepare(sql).all(...(params as never[])) as T[];
    },
  };
}
