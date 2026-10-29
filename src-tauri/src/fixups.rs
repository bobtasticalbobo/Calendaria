//! Repairs a database before tauri-plugin-sql migrates it, for migrations that
//! can't be edited once released (sqlx refuses a changed migration).

use std::path::PathBuf;

use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, Connection, Row};
use tauri::{plugin::TauriPlugin, Manager, Runtime};

/// SQL to run on a device that has applied everything before `version` but not
/// `version` itself.
const FIXUPS: &[(i64, &str)] = &[(12, include_str!("../fixups/before_0012.sql"))];

/// Must be registered before the sql plugin, so it runs first.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("db-fixups")
        .setup(|app, _| {
            let Ok(dir) = app.path().app_config_dir() else { return Ok(()) };
            let file = dir.join(crate::DB_URL.trim_start_matches("sqlite:"));
            if file.exists() {
                // A thread of its own, so blocking here never nests runtimes.
                let result = std::thread::spawn(move || tauri::async_runtime::block_on(run(file)))
                    .join()
                    .unwrap_or_else(|_| Err("fixup thread panicked".into()));
                // A failed fixup must not stop the app; the migration reports its own error.
                if let Err(e) = result {
                    eprintln!("database fixup failed: {e}");
                }
            }
            Ok(())
        })
        .build()
}

async fn run(file: PathBuf) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut conn = SqliteConnectOptions::new().filename(&file).connect().await?;
    let tracked: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'")
            .fetch_optional(&mut conn)
            .await?;
    if tracked.is_some() {
        let applied: Vec<i64> = sqlx::query("SELECT version FROM _sqlx_migrations WHERE success = 1")
            .fetch_all(&mut conn)
            .await?
            .iter()
            .map(|row| row.get(0))
            .collect();
        for (version, sql) in FIXUPS {
            if applied.contains(&(version - 1)) && !applied.contains(version) {
                let mut tx = conn.begin().await?;
                sqlx::raw_sql(sql).execute(&mut *tx).await?;
                tx.commit().await?;
            }
        }
    }
    conn.close().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clears_synced_calendar_notebook_before_0012() {
        let file = std::env::temp_dir().join(format!("calendaria-fixup-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&file);
        let count = |sql: &'static str| {
            let file = file.clone();
            tauri::async_runtime::block_on(async move {
                let mut conn = SqliteConnectOptions::new().filename(&file).connect().await.unwrap();
                let n: i64 = sqlx::query_scalar(sql).fetch_one(&mut conn).await.unwrap();
                n
            })
        };
        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(&file)
                .create_if_missing(true)
                .connect()
                .await
                .unwrap();
            sqlx::raw_sql(
                "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success BOOLEAN NOT NULL);
                 INSERT INTO _sqlx_migrations VALUES (11, 1);
                 CREATE TABLE notebooks (id TEXT PRIMARY KEY);
                 CREATE TABLE chapters (id TEXT PRIMARY KEY);
                 INSERT INTO notebooks VALUES ('019a0a00-0000-7000-8000-000000000001'), ('019a0a00-0000-7000-8000-000000000003');
                 INSERT INTO chapters VALUES ('019a0a00-0000-7000-8000-000000000004');",
            )
            .execute(&mut conn)
            .await
            .unwrap();
        });
        tauri::async_runtime::block_on(run(file.clone())).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM notebooks"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM chapters"), 0);
        std::fs::remove_file(&file).unwrap();
    }
}
