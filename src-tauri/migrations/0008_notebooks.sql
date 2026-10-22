-- Notes become pages in notebooks: notebook > chapter > page.
--
-- The default notebook and chapter have fixed ids and timestamps, so every
-- device creates the same rows and sync sees one notebook, not one per device.
-- Notes already on the calendar move into them.

CREATE TABLE notebooks (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  position   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_notebooks_updated_at ON notebooks (updated_at);

CREATE TABLE chapters (
  id          TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  position    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE INDEX idx_chapters_updated_at ON chapters (updated_at);

INSERT INTO notebooks (id, name, color, position, created_at, updated_at, deleted_at)
VALUES ('019a0a00-0000-7000-8000-000000000001', 'Notebook', '#7aa2f7', 0,
        '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z', NULL);

INSERT INTO chapters (id, notebook_id, name, position, created_at, updated_at, deleted_at)
VALUES ('019a0a00-0000-7000-8000-000000000002', '019a0a00-0000-7000-8000-000000000001', 'Day notes', 0,
        '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z', NULL);

-- Pages. Rebuilt because a page no longer needs a day.
--   chapter_id  the chapter it is in; NULL or a missing chapter means the default one
--   day         the calendar day it is linked to, or NULL
--   body        markdown; the first line is the title
--   pinned      1 keeps the page at the top of lists
--   position    order within the chapter
CREATE TABLE notes_new (
  id          TEXT PRIMARY KEY NOT NULL,
  chapter_id  TEXT,
  day         TEXT,
  body        TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT 'yellow',
  pinned      INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL DEFAULT 0,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

INSERT INTO notes_new (id, chapter_id, day, body, color, pinned, position, tags, created_at, updated_at, deleted_at)
SELECT id, '019a0a00-0000-7000-8000-000000000002', day, body, color, 0, 0, tags, created_at, updated_at, deleted_at
FROM notes;

-- Reminders on pages, any number per page.
--   remind_local  wall-clock time, e.g. 2026-10-24T09:00:00
--   remind_zone   IANA zone of remind_local
--   remind_utc    derived from the two above on every write, for lookups
CREATE TABLE note_reminders (
  id           TEXT PRIMARY KEY NOT NULL,
  note_id      TEXT NOT NULL,
  remind_local TEXT NOT NULL,
  remind_zone  TEXT NOT NULL,
  remind_utc   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

-- A note's old single reminder keeps the note's id plus a suffix, the same on every device.
INSERT INTO note_reminders (id, note_id, remind_local, remind_zone, remind_utc, created_at, updated_at, deleted_at)
SELECT id || '/remind', id, remind_local, remind_zone, remind_utc, created_at, updated_at, deleted_at
FROM notes
WHERE remind_local IS NOT NULL AND remind_zone IS NOT NULL AND remind_utc IS NOT NULL;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

CREATE INDEX idx_notes_day ON notes (day) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_updated_at ON notes (updated_at);
CREATE INDEX idx_note_reminders_note ON note_reminders (note_id);
CREATE INDEX idx_note_reminders_remind ON note_reminders (remind_utc) WHERE deleted_at IS NULL;
CREATE INDEX idx_note_reminders_updated_at ON note_reminders (updated_at);
