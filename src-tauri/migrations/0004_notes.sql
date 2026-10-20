-- Sticky notes pinned to a day.
--   day           the date the note sits on, e.g. 2026-10-20
--   body          the note's text
--   color         paper color name (yellow, pink, blue, green)
--   remind_local  wall-clock reminder time, e.g. 2026-10-20T09:00:00, or NULL
--   remind_zone   IANA zone of remind_local
--   remind_utc    derived from the two above on every write, for lookups
CREATE TABLE notes (
  id            TEXT PRIMARY KEY NOT NULL,
  day           TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT 'yellow',
  remind_local  TEXT,
  remind_zone   TEXT,
  remind_utc    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_notes_day ON notes (day) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_remind ON notes (remind_utc) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_updated_at ON notes (updated_at);
