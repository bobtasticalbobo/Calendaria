import type { SqlDriver } from "../db/driver";
import { type Clock, toTimestamp } from "../db/records";

/** Synced tables, parents before children so foreign keys hold while applying. */
export const SYNCED_TABLES = [
  "calendars",
  "events",
  "notebooks",
  "chapters",
  "notes",
  "note_reminders",
  "tags",
  "day_tags",
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** A database row as stored, column name to value. */
export type Row = Record<string, unknown> & { id: string; updated_at: string; deleted_at: string | null };

/** Every synced row from every device, including deletions. */
export interface Snapshot {
  format: 1;
  tables: Record<SyncedTable, Row[]>;
}

export interface SyncResult {
  /** What the shared copy should hold afterwards. */
  snapshot: Snapshot;
  /** Rows on this device changed, so the views should reload. */
  localChanged: boolean;
  /** The shared copy is missing changes made here and should be written. */
  remoteChanged: boolean;
}

async function columnsOf(db: SqlDriver, table: SyncedTable): Promise<string[]> {
  const rows = await db.select<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`);
  return rows.map((r) => r.name);
}

async function upsert(db: SqlDriver, table: SyncedTable, row: Row, known: string[]): Promise<void> {
  // Columns this version doesn't know (from a newer app) are left out.
  const cols = known.filter((c) => c in row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  await db.execute(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
    cols.map((c) => row[c]),
  );
}

/**
 * Imported events are unique per calendar and source UID. When two devices
 * imported the same event, the one with the smaller id stays and the other is
 * deleted, so every device makes the same choice. Returns the row to write.
 */
async function resolveImportClash(db: SqlDriver, row: Row, now: string): Promise<Row> {
  if (row.source_uid == null) return row;
  const [other] = await db.select<{ id: string }>(
    "SELECT id FROM events WHERE calendar_id = $1 AND source_uid = $2 AND id <> $3",
    [row.calendar_id, row.source_uid, row.id],
  );
  if (!other) return row;
  if (other.id < row.id) return { ...row, source_uid: null, deleted_at: row.deleted_at ?? now, updated_at: now };
  await db.execute(
    `UPDATE events SET source_uid = NULL, deleted_at = COALESCE(deleted_at, $1), updated_at = $1 WHERE id = $2`,
    [now, other.id],
  );
  return row;
}

/**
 * Each device creates its own "Personal" calendar, and may import into its own
 * "Outlook" one. Calendars with the same name become one: the oldest stays and
 * the others' events move into it.
 */
async function mergeSameNamedCalendars(db: SqlDriver, now: string): Promise<boolean> {
  const calendars = await db.select<{ id: string; name: string }>(
    "SELECT id, name FROM calendars WHERE deleted_at IS NULL ORDER BY id",
  );
  const keep = new Map<string, string>();
  let changed = false;
  for (const cal of calendars) {
    const name = cal.name.trim().toLowerCase();
    const target = keep.get(name);
    if (!target) {
      keep.set(name, cal.id);
      continue;
    }
    const events = await db.select<Row>("SELECT * FROM events WHERE calendar_id = $1", [cal.id]);
    for (const event of events) {
      const moved = await resolveImportClash(db, { ...event, calendar_id: target }, now);
      await db.execute(
        "UPDATE events SET calendar_id = $1, source_uid = $2, deleted_at = $3, updated_at = $4 WHERE id = $5",
        [target, moved.source_uid, moved.deleted_at, now, event.id],
      );
    }
    await db.execute("UPDATE calendars SET deleted_at = $1, updated_at = $1 WHERE id = $2", [now, cal.id]);
    changed = true;
  }
  return changed;
}

/**
 * Merges the shared copy into this device's database and works out what the
 * shared copy should become. Per row, the newer change wins; deletions are
 * rows too, so they spread like any other change.
 */
export async function syncDatabase(db: SqlDriver, remote: Snapshot | null, clock: Clock): Promise<SyncResult> {
  const now = toTimestamp(clock());
  let localChanged = false;

  if (remote) {
    for (const table of SYNCED_TABLES) {
      const known = await columnsOf(db, table);
      const local = new Map(
        (await db.select<{ id: string; updated_at: string }>(`SELECT id, updated_at FROM ${table}`)).map((r) => [
          r.id,
          r.updated_at,
        ]),
      );
      for (const theirs of remote.tables[table] ?? []) {
        const ours = local.get(theirs.id);
        if (ours !== undefined && ours >= theirs.updated_at) continue;
        const row = table === "events" ? await resolveImportClash(db, theirs, now) : theirs;
        await upsert(db, table, row, known);
        localChanged = true;
      }
    }
  }
  if (await mergeSameNamedCalendars(db, now)) localChanged = true;

  const tables = {} as Snapshot["tables"];
  let remoteChanged = !remote;
  for (const table of SYNCED_TABLES) {
    tables[table] = await db.select<Row>(`SELECT * FROM ${table} ORDER BY id`);
    const theirs = new Map((remote?.tables[table] ?? []).map((r) => [r.id, r.updated_at]));
    if (tables[table].some((r) => theirs.get(r.id) !== r.updated_at)) remoteChanged = true;
  }
  return { snapshot: { format: 1, tables }, localChanged, remoteChanged };
}
