import { v7 as uuidv7 } from "uuid";

/**
 * Fields shared by every record that will sync between devices.
 * Timestamps are ISO-8601 strings in UTC (e.g. 2026-10-20T12:00:00.000Z),
 * which sort correctly as text.
 */
export interface SyncedRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Set instead of deleting the row, so the deletion can reach other devices. */
  deletedAt: string | null;
}

export interface SyncedRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** UUIDv7: globally unique without coordination, and ordered by creation time. */
export function newId(): string {
  return uuidv7();
}

export function toTimestamp(date: Date): string {
  return date.toISOString();
}

/** Reads a JSON array of ids, such as a tags column, ignoring anything malformed. */
export function parseIdList(json: string): string[] {
  try {
    const ids: unknown = JSON.parse(json);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function syncedFieldsFromRow(row: SyncedRow): SyncedRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
