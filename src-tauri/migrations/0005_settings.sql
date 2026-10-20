-- Settings that belong to this device only and never sync, such as the key
-- used to reach the sync store.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
