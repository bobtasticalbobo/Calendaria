-- Any notebook, chapter or page can be a task.
--   task     1 when it is a task with a box to tick
--   done_at  when it was ticked (ISO UTC), or NULL
--   due_day  the day an important task must be done by, e.g. 2026-10-30, or NULL
ALTER TABLE notebooks ADD COLUMN task INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notebooks ADD COLUMN done_at TEXT;
ALTER TABLE notebooks ADD COLUMN due_day TEXT;
ALTER TABLE chapters ADD COLUMN task INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chapters ADD COLUMN done_at TEXT;
ALTER TABLE chapters ADD COLUMN due_day TEXT;
ALTER TABLE notes ADD COLUMN task INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN done_at TEXT;
ALTER TABLE notes ADD COLUMN due_day TEXT;
