/**
 * The minimal SQL interface the app depends on. The app uses tauri-plugin-sql;
 * tests use an in-memory SQLite database with the same migrations applied.
 * Placeholders are positional: $1, $2, ...
 */
export interface SqlDriver {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
