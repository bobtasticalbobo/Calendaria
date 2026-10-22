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

Switch to **Notes** at the top of the sidebar. Notes are pages, kept in
notebooks and chapters: notebook > chapter > page. A page's first line is its
title, and it is written in markdown (`# heading`, `- list`, `- [ ] checklist`,
`**bold**`, `*italic*`, `` `code` ``, `> quote`, links). **Read** shows it
rendered, with checklists you can tick.

- **Dates.** Write a date like 24/10/2026 (or 24/10/2026 14:30), or type a
  shortcut and a space: `@today`, `@tomorrow`, `@fri`, `@+3`, `@2w`, `@24/12`.
  With the cursor on a date, a bar offers **Remind me** that day; every date in
  the page is also listed beside it with a bell. A page can have any number of
  reminders, and the notification shows the line the date is on.
- **Days.** A page can be linked to a calendar day, where it shows as a paper
  square. Right-click a day and pick **Note** for a quick sticky note (it goes
  in the *Day notes* chapter), or **Notes for this day** for every page linked
  to it, mentioning it, or reminding you on it. Reminders show as a bell on
  their day. Dragging a note to another day moves its reminders on that day.
- **Links.** `[[Page title]]` links to another page (or makes it), and each
  page lists the pages linking to it.
- **Finding things.** Search (Ctrl+K) matches every word in titles, text and
  tag names. Pin pages to keep them at the top. Drag pages between chapters
  and chapters between notebooks. Deleted pages stay in the trash for 30 days.
  Click a notebook's dot (or right-click it, **Colour…**) to change its colour.
- **Keys.** Ctrl+N new page, Ctrl+Enter tick a checklist item, Tab and
  Shift+Tab indent, Ctrl+B and Ctrl+I bold and italic. Enter continues a list.

Notes from before 0.7.0 are in *Notebook > Day notes*.

### Tasks

Right-click any notebook, chapter or page and pick **Make a task** to give it
a box to tick. Ticked tasks stay in the tree, crossed out, for a week, then
hide; tick **Completed tasks** at the top of the tree to see them again.

**Make important…** sets the day a task must be done by (its date shows next
to it, orange on the day and red once late). From 09:00 that day the app asks
"Is this done?" with a notification and a card in the corner (**Done** ticks
it, **Not yet** waits for the next time). It asks every 4 hours on the day,
every 2 hours the day after, then hourly, then every half hour from the third
day late, between 08:00 and 22:00, until the task is ticked. If the app was
closed, it asks as soon as it opens.

**Statistics** (under Trash in the tree) shows, for the last 7 days, 30 days,
12 months or all time: tasks done and made, open and overdue tasks, how many
deadlines were met, the average time from making a task to ticking it, your
streak of days with something ticked, done per day or month, a weekday × hour
map of when you tick things, done per notebook, the tasks most often answered
"Not yet", and what you finished recently. History starts with 0.8.1; tasks
ticked before that count from when they were ticked.

## Tags

Right-click an event to pick its tags, or open it and use **Tags** (type a name and press Enter
to make a new one), or open a note and click **Tags**. A tagged event is
tinted in its first tag's color in every view, and a tagged note's paper takes
on that color. Right-clicking a day and picking **Tags** labels the day itself. Make, rename, recolor and
delete tags under **Settings** at the bottom of the sidebar. Tags sync like
everything else.

## Settings

**Settings** at the bottom of the sidebar shows the installed version with a
**Check for updates** button, the sync setup, and your tags.

## Syncing between devices

Calendaria keeps every device in step through a private gist on your GitHub
account. To set it up, open **Settings**, click **Sync with your other
devices**, then **Make a key on GitHub**. That opens GitHub with a key that can
only touch gists; choose *No expiration*, generate it, and paste it in. Then
choose a passphrase. Do the same on each device with the same key and the same
passphrase.

Everything is encrypted on the device before it is sent: AES-256-GCM, with
the key derived from the passphrase by PBKDF2-SHA-256 (600,000 rounds). GitHub
only ever stores the encrypted copy, so neither GitHub nor anyone who finds the
gist can read it, and a wrong passphrase is refused rather than overwriting
anything. The passphrase can't be recovered: if it is forgotten, stop syncing
on every device and set sync up again with a new one (each device keeps its
own data). The GitHub key and passphrase are stored in the app's database on
each device.

Devices sync at launch, every 30 seconds, when the window gains or loses
focus, and a few seconds after each change. For each event, calendar, note or
tag, the newest change wins, and deletions spread like any other change.
Calendars with the same name on two devices (such as each device's own
"Personal") become one, and events both devices imported from the same
Outlook file are kept once. Unencrypted copies left by versions before 0.6.0
are merged in and then deleted from GitHub, history included. The code is in
`src/sync/`.

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
