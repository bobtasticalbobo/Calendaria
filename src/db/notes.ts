import { Temporal } from "../time/temporal";
import { isValidTimeZone, toZoned } from "../time/timing";
import type { SqlDriver } from "./driver";
import {
  type Clock,
  type SyncedRecord,
  type SyncedRow,
  newId,
  parseIdList,
  syncedFieldsFromRow,
  systemClock,
  toTimestamp,
} from "./records";

export const NOTE_COLORS = ["yellow", "pink", "blue", "green"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** A reminder at a wall-clock time in a zone, like a timed event's start. */
export interface NoteReminder {
  at: Temporal.PlainDateTime;
  timeZone: string;
}

export interface Note extends SyncedRecord {
  day: Temporal.PlainDate;
  body: string;
  color: NoteColor;
  remind: NoteReminder | null;
  /** Tag ids, in the order they were added. */
  tags: string[];
}

export interface NoteInput {
  day: Temporal.PlainDate;
  body?: string;
  color?: NoteColor;
  remind?: NoteReminder | null;
  tags?: string[];
}

interface NoteRow extends SyncedRow {
  day: string;
  body: string;
  color: string;
  remind_local: string | null;
  remind_zone: string | null;
  remind_utc: string | null;
  tags: string;
}

const COLUMNS =
  "id, day, body, color, remind_local, remind_zone, remind_utc, tags, created_at, updated_at, deleted_at";

function fromRow(row: NoteRow): Note {
  return {
    ...syncedFieldsFromRow(row),
    day: Temporal.PlainDate.from(row.day),
    body: row.body,
    color: (NOTE_COLORS as readonly string[]).includes(row.color) ? (row.color as NoteColor) : "yellow",
    remind:
      row.remind_local && row.remind_zone
        ? { at: Temporal.PlainDateTime.from(row.remind_local), timeZone: row.remind_zone }
        : null,
    tags: parseIdList(row.tags),
  };
}

function validColor(color: string): NoteColor {
  if (!(NOTE_COLORS as readonly string[]).includes(color)) throw new Error(`Unknown note color "${color}"`);
  return color as NoteColor;
}

function validReminder(remind: NoteReminder | null): NoteReminder | null {
  if (remind && !isValidTimeZone(remind.timeZone)) throw new Error(`Unknown time zone "${remind.timeZone}"`);
  return remind;
}

/** Same text format as events' *_utc columns, so comparisons sort correctly. */
function utcText(instant: Temporal.Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 });
}

function remindUtc(remind: NoteReminder | null): string | null {
  return remind ? utcText(toZoned(remind.at, remind.timeZone).toInstant()) : null;
}

export class NoteRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Includes deleted notes, since sync needs to see tombstones. */
  async get(id: string): Promise<Note | null> {
    const rows = await this.db.select<NoteRow>(`SELECT ${COLUMNS} FROM notes WHERE id = $1`, [id]);
    return rows.length ? fromRow(rows[0]) : null;
  }

  /** Live notes on the days from `first` to `last`, inclusive, oldest first. */
  async listOnDays(first: Temporal.PlainDate, last: Temporal.PlainDate): Promise<Note[]> {
    const rows = await this.db.select<NoteRow>(
      `SELECT ${COLUMNS} FROM notes
       WHERE deleted_at IS NULL AND day >= $1 AND day <= $2
       ORDER BY id`,
      [first.toString(), last.toString()],
    );
    return rows.map(fromRow);
  }

  /** Live notes whose reminder time falls in (since, until]. */
  async remindersDue(since: Temporal.Instant, until: Temporal.Instant): Promise<Note[]> {
    const rows = await this.db.select<NoteRow>(
      `SELECT ${COLUMNS} FROM notes
       WHERE deleted_at IS NULL AND remind_utc > $1 AND remind_utc <= $2
       ORDER BY remind_utc`,
      [utcText(since), utcText(until)],
    );
    return rows.map(fromRow);
  }

  async create(input: NoteInput): Promise<Note> {
    const now = toTimestamp(this.clock());
    const note: Note = {
      id: newId(),
      day: input.day,
      body: input.body ?? "",
      color: validColor(input.color ?? "yellow"),
      remind: validReminder(input.remind ?? null),
      tags: [...new Set(input.tags ?? [])],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.db.execute(
      `INSERT INTO notes (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        note.id,
        note.day.toString(),
        note.body,
        note.color,
        note.remind?.at.toString() ?? null,
        note.remind?.timeZone ?? null,
        remindUtc(note.remind),
        JSON.stringify(note.tags),
        note.createdAt,
        note.updatedAt,
        note.deletedAt,
      ],
    );
    return note;
  }

  async update(id: string, patch: Partial<NoteInput>): Promise<Note> {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt) throw new Error(`Note ${id} not found`);
    const updated: Note = {
      ...existing,
      day: patch.day ?? existing.day,
      body: patch.body ?? existing.body,
      color: patch.color === undefined ? existing.color : validColor(patch.color),
      remind: patch.remind === undefined ? existing.remind : validReminder(patch.remind),
      tags: patch.tags === undefined ? existing.tags : [...new Set(patch.tags)],
      updatedAt: toTimestamp(this.clock()),
    };
    await this.db.execute(
      `UPDATE notes SET day = $1, body = $2, color = $3, remind_local = $4, remind_zone = $5,
         remind_utc = $6, tags = $7, updated_at = $8
       WHERE id = $9`,
      [
        updated.day.toString(),
        updated.body,
        updated.color,
        updated.remind?.at.toString() ?? null,
        updated.remind?.timeZone ?? null,
        remindUtc(updated.remind),
        JSON.stringify(updated.tags),
        updated.updatedAt,
        id,
      ],
    );
    return updated;
  }

  /**
   * Moves a note to another day. A reminder moves with it by the same number
   * of days, keeping its time of day.
   */
  async moveToDay(id: string, day: Temporal.PlainDate): Promise<Note> {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt) throw new Error(`Note ${id} not found`);
    const shift = existing.day.until(day, { largestUnit: "days" });
    const remind = existing.remind && { ...existing.remind, at: existing.remind.at.add(shift) };
    return this.update(id, { day, remind });
  }

  /** Soft delete: the row stays as a tombstone so other devices learn about it. */
  async remove(id: string): Promise<void> {
    const now = toTimestamp(this.clock());
    const { rowsAffected } = await this.db.execute(
      `UPDATE notes SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
    if (rowsAffected === 0) throw new Error(`Note ${id} not found`);
  }
}
