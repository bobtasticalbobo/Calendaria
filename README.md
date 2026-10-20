# Calendaria

A local-first calendar and notes app. It runs on the desktop today and is
structured so the same code can become a phone app (Tauri 2 supports iOS and
Android) with sync between devices.

## Stack

- **Tauri 2** desktop shell (Rust) with a **React + TypeScript** UI built by Vite
- **SQLite** on the device via `tauri-plugin-sql`
- **Vitest** tests that run against an in-memory SQLite database with the real migrations

## Getting started

Install the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for
your OS (Rust, plus WebView2 on Windows or webkit2gtk on Linux), then:

```sh
npm install
npm run tauri dev     # run the app
npm test              # run the tests
npm run typecheck
npm run tauri build   # build an installer
```

The database is `calendaria.db` in the app's config folder (for example
`%APPDATA%\com.calendaria.app` on Windows or `~/.config/com.calendaria.app` on Linux).

## How data is stored

Every table that will sync between devices has the same columns:

| Column       | Meaning                                                           |
| ------------ | ----------------------------------------------------------------- |
| `id`         | UUIDv7, created on the device, so devices never clash             |
| `created_at` | ISO-8601 UTC timestamp                                            |
| `updated_at` | ISO-8601 UTC timestamp, bumped on every change                    |
| `deleted_at` | Set instead of deleting the row, so deletions can sync too        |

Repositories in `src/db/` (for example `CalendarRepository`) are the only code
that writes SQL. The UI talks to them, never to the database directly.

## Adding a schema change

1. Add `src-tauri/migrations/NNNN_description.sql` with the next number.
2. Register it in `migrations()` in `src-tauri/src/lib.rs` with the next version.
3. Never edit a migration that has already shipped.

A test fails if a migration file isn't registered, so step 2 can't be forgotten.
