-- Notes made on the calendar get their own "Calendar" notebook, so they no
-- longer land in the first notebook, which people use for their own pages.
--
-- Fixed ids and timestamps, as in 0008, so every device makes the same rows.
-- Day notes already in the first notebook's default chapter move across.
-- updated_at is left alone: every device runs this same move, and an
-- unchanged timestamp means sync from a device not yet updated can't undo it.

INSERT INTO notebooks (id, name, color, position, created_at, updated_at, deleted_at)
VALUES ('019a0a00-0000-7000-8000-000000000003', 'Calendar', '#ff5a1f', -1,
        '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z', NULL);

INSERT INTO chapters (id, notebook_id, name, position, created_at, updated_at, deleted_at)
VALUES ('019a0a00-0000-7000-8000-000000000004', '019a0a00-0000-7000-8000-000000000003', 'Day notes', 0,
        '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z', NULL);

UPDATE notes SET chapter_id = '019a0a00-0000-7000-8000-000000000004'
WHERE day IS NOT NULL
  AND (chapter_id IS NULL OR chapter_id = '019a0a00-0000-7000-8000-000000000002');
