-- Every synced table follows the same shape:
--   id          UUIDv7 text, generated on the device that created the row
--   created_at  ISO-8601 UTC timestamp
--   updated_at  ISO-8601 UTC timestamp, bumped on every change (used by sync)
--   deleted_at  ISO-8601 UTC timestamp when soft-deleted, so deletions can sync
CREATE TABLE calendars (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_calendars_updated_at ON calendars (updated_at);
