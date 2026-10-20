import type { SqlDriver } from "./driver";
import {
  type Clock,
  type SyncedRecord,
  type SyncedRow,
  newId,
  syncedFieldsFromRow,
  systemClock,
  toTimestamp,
} from "./records";

export interface Calendar extends SyncedRecord {
  name: string;
  color: string;
}

export interface CalendarInput {
  name: string;
  color?: string;
}

interface CalendarRow extends SyncedRow {
  name: string;
  color: string;
}

export const DEFAULT_CALENDAR_COLOR = "#3b82f6";
export const DEFAULT_CALENDAR_NAME = "Personal";

const COLUMNS = "id, name, color, created_at, updated_at, deleted_at";

function fromRow(row: CalendarRow): Calendar {
  return { ...syncedFieldsFromRow(row), name: row.name, color: row.color };
}

function validName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Calendar name cannot be empty");
  return trimmed;
}

function validColor(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error(`Invalid calendar color "${color}", expected #rrggbb`);
  }
  return color.toLowerCase();
}

export class CalendarRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Calendars that have not been deleted, oldest first. */
  async list(): Promise<Calendar[]> {
    const rows = await this.db.select<CalendarRow>(
      `SELECT ${COLUMNS} FROM calendars WHERE deleted_at IS NULL ORDER BY id`,
    );
    return rows.map(fromRow);
  }

  /** Includes deleted calendars, since sync needs to see tombstones. */
  async get(id: string): Promise<Calendar | null> {
    const rows = await this.db.select<CalendarRow>(
      `SELECT ${COLUMNS} FROM calendars WHERE id = $1`,
      [id],
    );
    return rows.length ? fromRow(rows[0]) : null;
  }

  async create(input: CalendarInput): Promise<Calendar> {
    const now = toTimestamp(this.clock());
    const calendar: Calendar = {
      id: newId(),
      name: validName(input.name),
      color: validColor(input.color ?? DEFAULT_CALENDAR_COLOR),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.db.execute(
      `INSERT INTO calendars (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        calendar.id,
        calendar.name,
        calendar.color,
        calendar.createdAt,
        calendar.updatedAt,
        calendar.deletedAt,
      ],
    );
    return calendar;
  }

  async update(id: string, patch: Partial<CalendarInput>): Promise<Calendar> {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt) throw new Error(`Calendar ${id} not found`);
    const updated: Calendar = {
      ...existing,
      name: patch.name === undefined ? existing.name : validName(patch.name),
      color: patch.color === undefined ? existing.color : validColor(patch.color),
      updatedAt: toTimestamp(this.clock()),
    };
    await this.db.execute(
      `UPDATE calendars SET name = $1, color = $2, updated_at = $3 WHERE id = $4`,
      [updated.name, updated.color, updated.updatedAt, id],
    );
    return updated;
  }

  /** Soft delete: the row stays as a tombstone so other devices learn about it. */
  async remove(id: string): Promise<void> {
    const now = toTimestamp(this.clock());
    const { rowsAffected } = await this.db.execute(
      `UPDATE calendars SET deleted_at = $1, updated_at = $1
       WHERE id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
    if (rowsAffected === 0) throw new Error(`Calendar ${id} not found`);
  }

  /**
   * Creates the default calendar on first launch only. Counting tombstones too
   * means deleting every calendar doesn't resurrect the default one.
   */
  async ensureDefault(): Promise<void> {
    const [{ count }] = await this.db.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM calendars",
    );
    if (count === 0) await this.create({ name: DEFAULT_CALENDAR_NAME });
  }
}
