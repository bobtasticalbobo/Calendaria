-- Tags change how days and notes look.
--   name   shown on the day or note
--   color  #rrggbb, tints what the tag is on
CREATE TABLE tags (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_tags_updated_at ON tags (updated_at);

-- A tag on a day. The id is "<tag id>/<day>", the same on every device, so
-- tagging a day on two devices doesn't make two rows. Removing the tag sets
-- deleted_at; tagging the day again clears it.
CREATE TABLE day_tags (
  id         TEXT PRIMARY KEY NOT NULL,
  day        TEXT NOT NULL,
  tag_id     TEXT NOT NULL REFERENCES tags (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_day_tags_day ON day_tags (day) WHERE deleted_at IS NULL;
CREATE INDEX idx_day_tags_updated_at ON day_tags (updated_at);

-- A note's tags: JSON array of tag ids, in the order they were added.
ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
