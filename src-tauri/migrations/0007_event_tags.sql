-- An event's tags: JSON array of tag ids, in the order they were added.
ALTER TABLE events ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
