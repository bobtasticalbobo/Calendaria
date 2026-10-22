import { Temporal } from "../time/temporal";
import { isValidTimeZone, toZoned } from "../time/timing";
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

/** A notification at a wall-clock time in a zone, from a page. */
export interface NoteReminder extends SyncedRecord {
  noteId: string;
  at: Temporal.PlainDateTime;
  timeZone: string;
}

interface ReminderRow extends SyncedRow {
  note_id: string;
  remind_local: string;
  remind_zone: string;
  remind_utc: string;
}

const COLUMNS = "id, note_id, remind_local, remind_zone, remind_utc, created_at, updated_at, deleted_at";
const R_COLUMNS = COLUMNS.split(", ")
  .map((c) => `r.${c}`)
  .join(", ");

function fromRow(row: ReminderRow): NoteReminder {
  return {
    ...syncedFieldsFromRow(row),
    noteId: row.note_id,
    at: Temporal.PlainDateTime.from(row.remind_local),
    timeZone: row.remind_zone,
  };
}

/** Same text format as events' *_utc columns, so comparisons sort correctly. */
function utcText(instant: Temporal.Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 });
}

function validZone(zone: string): string {
  if (!isValidTimeZone(zone)) throw new Error(`Unknown time zone "${zone}"`);
  return zone;
}

export class NoteReminderRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  async get(id: string): Promise<NoteReminder | null> {
    const rows = await this.db.select<ReminderRow>(`SELECT ${COLUMNS} FROM note_reminders WHERE id = $1`, [id]);
    return rows.length ? fromRow(rows[0]) : null;
  }

  /** Every live reminder on a live page, soonest first. */
  async list(): Promise<NoteReminder[]> {
    const rows = await this.db.select<ReminderRow>(
      `SELECT ${R_COLUMNS} FROM note_reminders r JOIN notes n ON n.id = r.note_id
       WHERE r.deleted_at IS NULL AND n.deleted_at IS NULL
       ORDER BY r.remind_utc, r.id`,
    );
    return rows.map(fromRow);
  }

  /** Live reminders on live pages whose wall-clock day is from `first` to `last`, inclusive. */
  async onDays(first: Temporal.PlainDate, last: Temporal.PlainDate): Promise<NoteReminder[]> {
    const rows = await this.db.select<ReminderRow>(
      `SELECT ${R_COLUMNS} FROM note_reminders r JOIN notes n ON n.id = r.note_id
       WHERE r.deleted_at IS NULL AND n.deleted_at IS NULL AND r.remind_local >= $1 AND r.remind_local < $2
       ORDER BY r.remind_local, r.id`,
      [first.toString(), last.add({ days: 1 }).toString()],
    );
    return rows.map(fromRow);
  }

  /** Live reminders on live pages whose time falls in (since, until]. */
  async due(since: Temporal.Instant, until: Temporal.Instant): Promise<NoteReminder[]> {
    const rows = await this.db.select<ReminderRow>(
      `SELECT ${R_COLUMNS} FROM note_reminders r JOIN notes n ON n.id = r.note_id
       WHERE r.deleted_at IS NULL AND n.deleted_at IS NULL AND r.remind_utc > $1 AND r.remind_utc <= $2
       ORDER BY r.remind_utc`,
      [utcText(since), utcText(until)],
    );
    return rows.map(fromRow);
  }

  async create(noteId: string, at: Temporal.PlainDateTime, timeZone: string): Promise<NoteReminder> {
    const now = toTimestamp(this.clock());
    const reminder: NoteReminder = {
      id: newId(),
      noteId,
      at: at.round({ smallestUnit: "minute" }),
      timeZone: validZone(timeZone),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.db.execute(`INSERT INTO note_reminders (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      reminder.id,
      noteId,
      reminder.at.toString(),
      reminder.timeZone,
      utcText(toZoned(reminder.at, reminder.timeZone).toInstant()),
      now,
      now,
      null,
    ]);
    return reminder;
  }

  async move(id: string, at: Temporal.PlainDateTime, timeZone?: string): Promise<NoteReminder> {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt) throw new Error(`Reminder ${id} not found`);
    const updated: NoteReminder = {
      ...existing,
      at: at.round({ smallestUnit: "minute" }),
      timeZone: timeZone === undefined ? existing.timeZone : validZone(timeZone),
      updatedAt: toTimestamp(this.clock()),
    };
    await this.db.execute(
      "UPDATE note_reminders SET remind_local = $1, remind_zone = $2, remind_utc = $3, updated_at = $4 WHERE id = $5",
      [
        updated.at.toString(),
        updated.timeZone,
        utcText(toZoned(updated.at, updated.timeZone).toInstant()),
        updated.updatedAt,
        id,
      ],
    );
    return updated;
  }

  async remove(id: string): Promise<void> {
    const now = toTimestamp(this.clock());
    await this.db.execute(
      "UPDATE note_reminders SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL",
      [now, id],
    );
  }
}
