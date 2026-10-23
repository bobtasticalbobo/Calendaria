-- Where a day's note sits on the week/day board.
--   board_time  wall-clock time on the note's day, e.g. 18:30, or NULL when the
--               note is only a marker in the day's header
ALTER TABLE notes ADD COLUMN board_time TEXT;
