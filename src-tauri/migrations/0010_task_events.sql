-- What happened to tasks, for statistics. One row per event:
--   item_table  notebooks, chapters or notes
--   item_id     the task
--   kind        made (became a task), done, deadline (one was set), snoozed ("Not yet")
--   title       the task's name or first line at the time, so deleted tasks still read well
--   due_day     the deadline when it happened, if any
--   at          when it happened (ISO UTC)
-- Unticking a task deletes its latest done row, so live done rows are real completions.
CREATE TABLE task_events (
  id          TEXT PRIMARY KEY NOT NULL,
  item_table  TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  due_day     TEXT,
  at          TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE INDEX idx_task_events_item ON task_events (item_id);
CREATE INDEX idx_task_events_at ON task_events (at) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_events_updated_at ON task_events (updated_at);

-- Tasks already ticked count as done when they were ticked. The ids are the
-- same on every device, so two devices migrating don't count them twice.
INSERT INTO task_events (id, item_table, item_id, kind, title, due_day, at, created_at, updated_at, deleted_at)
SELECT id || '/done', 'notebooks', id, 'done', name, due_day, done_at, done_at, done_at, NULL
FROM notebooks WHERE task = 1 AND done_at IS NOT NULL;
INSERT INTO task_events (id, item_table, item_id, kind, title, due_day, at, created_at, updated_at, deleted_at)
SELECT id || '/done', 'chapters', id, 'done', name, due_day, done_at, done_at, done_at, NULL
FROM chapters WHERE task = 1 AND done_at IS NOT NULL;
INSERT INTO task_events (id, item_table, item_id, kind, title, due_day, at, created_at, updated_at, deleted_at)
SELECT id || '/done', 'notes', id, 'done', substr(body, 1, instr(body || char(10), char(10)) - 1), due_day, done_at, done_at, done_at, NULL
FROM notes WHERE task = 1 AND done_at IS NOT NULL;
