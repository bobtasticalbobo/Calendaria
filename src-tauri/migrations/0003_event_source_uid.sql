-- Identifies an event that came from an imported calendar file (its iCalendar
-- UID, plus the occurrence for a changed occurrence), so importing the same
-- file again updates events instead of duplicating them.
ALTER TABLE events ADD COLUMN source_uid TEXT;

CREATE UNIQUE INDEX idx_events_source_uid ON events (calendar_id, source_uid)
  WHERE source_uid IS NOT NULL;
