use tauri_plugin_sql::{Migration, MigrationKind};

/// Database file name, resolved by tauri-plugin-sql inside the app's data directory.
pub const DB_URL: &str = "sqlite:calendaria.db";

/// Schema migrations. The SQL files are the single source of truth: the
/// TypeScript tests apply the same files, so the schema is tested as shipped.
/// Never edit a released migration; add a new one instead.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "calendars",
            sql: include_str!("../migrations/0001_calendars.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "events",
            sql: include_str!("../migrations/0002_events.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "event source uid",
            sql: include_str!("../migrations/0003_event_source_uid.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "notes",
            sql: include_str!("../migrations/0004_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "settings",
            sql: include_str!("../migrations/0005_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "tags",
            sql: include_str!("../migrations/0006_tags.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "event tags",
            sql: include_str!("../migrations/0007_event_tags.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
