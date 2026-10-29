-- Runs before migration 0012 on a device that hasn't applied it yet.
--
-- 0012 inserts the Calendar notebook and its chapter with fixed ids. A device
-- that synced with one already on 0.9.4 got those rows through sync first, so
-- the inserts hit an existing id, the migration failed and the app closed on
-- launch. Removing the synced copies lets 0012 put back the same rows; sync
-- then restores anything newer (a rename, say) from the other devices.

DELETE FROM chapters WHERE id = '019a0a00-0000-7000-8000-000000000004';
DELETE FROM notebooks WHERE id = '019a0a00-0000-7000-8000-000000000003';
