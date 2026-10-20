# Calendaria

A local-first calendar and notes app. It runs on the desktop today and is
structured so the same code can become a phone app (Tauri 2 supports iOS and
Android) with sync between devices.

## Stack

- **Tauri 2** desktop shell (Rust) with a **React + TypeScript** UI built by Vite
- **SQLite** on the device via `tauri-plugin-sql`
- **Vitest** tests that run against an in-memory SQLite database with the real migrations

## Installing on Windows

Download `Calendaria_<version>_x64-setup.exe` from the newest release on the
repository's **Releases** page and run it. It installs Calendaria with a Start
menu entry, and from then on the app updates itself. Every pull request is also
built by GitHub Actions, with the installer and a portable exe attached to the
run as the `Calendaria-windows` artifact.

The builds aren't code-signed yet, so Windows SmartScreen may warn the first
time; choose *More info → Run anyway*. Windows 10 and 11 already include the
WebView2 runtime the app needs.

### Updates

Calendaria checks GitHub for a newer release when it starts, every five
minutes, and when its window comes back into focus. When there is one, the sidebar shows **Update and restart**, which
downloads it, installs it with just a progress bar and reopens the app. Your
data is kept, since it lives separately in your user profile.

Each version merged to `main` becomes a release: GitHub Actions builds it,
signs it with the `TAURI_SIGNING_PRIVATE_KEY` repository secret, and publishes
the installer with a `latest.json` the app reads. The app only installs
releases signed with that key (its public half is in `tauri.conf.json`).
Remember to bump the version in `tauri.conf.json`, `Cargo.toml` and
`package.json`, or the release replaces the previous one under the same
version and installed copies won't see it as new.

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

## How dates and times work

Date handling uses the [Temporal](https://tc39.es/proposal-temporal/docs/) API
(via `temporal-polyfill`) and repeat rules use the iCalendar RRULE standard
(via `rrule`), the same format Outlook and Google export. No date arithmetic is
done by hand. The code lives in `src/time/`.

- **Timed events** store their wall-clock time plus the time zone they were
  entered in (e.g. 09:00 `Europe/Stockholm`). A weekly 9:00 meeting stays at
  9:00 across daylight saving changes, and an event set in New York time moves
  correctly in your calendar when the US and Europe change clocks on different
  weeks.
- **All-day events** are plain dates with no time zone, so a birthday is on the
  same date wherever you are. Their end date is exclusive, as in iCalendar.
- **Times that don't exist** (02:30 on a spring-forward night) move forward
  past the gap; **times that happen twice** (fall-back night) use the first one.
- **Monthly on the 29th–31st** skips months without that day, as the iCalendar
  standard says. Events on the last day of a month can instead repeat "every
  month on the last day".
- **Reminders** show a system notification while Calendaria is running
  (minimised is fine). Each check covers the time since the last one, so a
  reminder that falls due while the computer sleeps appears when it wakes.

`tests/recurrence.test.ts` covers these cases.

## Notes

Right-click a day and pick **Note** to stick a paper note on it. Notes fold down to a small square next to the day's number; click one to open it, and drag it onto another day to move it. A note can carry a reminder, which moves along with the note when you drag it to another day.

## Tags

Right-click a day and pick **Tags**, or open a note and click **Tags**, to tag
it. A tagged day is tinted in its first tag's color with the tag names in its
corner, and a tagged note gets a colored edge. Make, rename, recolor and
delete tags under **Settings** at the bottom of the sidebar. Tags sync like
everything else.

## Settings

**Settings** at the bottom of the sidebar shows the installed version with a
**Check for updates** button, the sync setup, and your tags.

## Syncing between devices

Calendaria keeps every device in step through a private gist on your GitHub
account. To set it up, open **Settings**, click **Sync with your other devices**,
then **Make a key on GitHub**. That opens GitHub with a key that can only touch
gists; choose *No expiration*, generate it, and paste it in. Do the same on
each device with the same key. Each device finds the shared gist by its
description, "Calendaria sync".

Devices sync at launch, every 30 seconds, when the window gains or loses
focus, and a few seconds after each change. For each event, calendar or note,
the newest change wins, and deletions spread like any other change.
Calendars with the same name on two devices (such as each device's own
"Personal") become one, and events both devices imported from the same
Outlook file are kept once. The code is in `src/sync/`.

## Importing from Outlook

Use **Import .ics file** in the sidebar. Events go into a calendar called
"Outlook" (or the file's own calendar name), and importing a newer export of
the same calendar updates those events instead of duplicating them. Events you
deleted in Calendaria stay deleted.

To get the file:

- **Classic Outlook for Windows:** select your calendar, then *File → Save
  Calendar*. Click *More Options*, set *Date Range* to *Whole calendar* and
  *Detail* to *Full details*, then save.
- **New Outlook / Outlook on the web:** *Settings → Calendar → Shared
  calendars → Publish a calendar*, choose your calendar and *Can view all
  details*, publish, then open the ICS link to download the file.

Outlook's Windows time zone names (e.g. "W. Europe Standard Time") are mapped
to standard zones. Repeating events keep their changed and deleted
occurrences. Anything that can't be imported exactly is listed after the import.

## Adding a schema change

1. Add `src-tauri/migrations/NNNN_description.sql` with the next number.
2. Register it in `migrations()` in `src-tauri/src/lib.rs` with the next version.
3. Never edit a migration that has already shipped.

A test fails if a migration file isn't registered, so step 2 can't be forgotten.
