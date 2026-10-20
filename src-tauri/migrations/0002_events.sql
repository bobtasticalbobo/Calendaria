-- Events. The wall-clock fields are the source of truth; the *_utc columns
-- are derived from them on every write and exist only so range queries can
-- use an index.
--   all_day         1 for date-only events (start_local/end_local are dates,
--                   end exclusive, time_zone NULL)
--   start_local     wall-clock start, e.g. 2026-10-19T09:00:00 or 2026-10-19
--   end_local       wall-clock end, same format
--   time_zone       IANA zone the wall-clock times are in, e.g. Europe/Stockholm
--   start_utc       first occurrence start (all-day: the date at 00:00Z)
--   end_utc         first occurrence end; for a repeating series, the last
--                   occurrence's end, or NULL if it repeats forever
--   rrule           iCalendar RRULE without DTSTART, NULL if not repeating
--   exdates         JSON array of start_local values of removed occurrences
--   reminders       JSON array of minutes before the start
CREATE TABLE events (
  id           TEXT PRIMARY KEY NOT NULL,
  calendar_id  TEXT NOT NULL REFERENCES calendars (id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  all_day      INTEGER NOT NULL DEFAULT 0,
  start_local  TEXT NOT NULL,
  end_local    TEXT NOT NULL,
  time_zone    TEXT,
  start_utc    TEXT NOT NULL,
  end_utc      TEXT,
  rrule        TEXT,
  exdates      TEXT NOT NULL DEFAULT '[]',
  reminders    TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE INDEX idx_events_range ON events (start_utc, end_utc) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_updated_at ON events (updated_at);
CREATE INDEX idx_events_calendar ON events (calendar_id);
