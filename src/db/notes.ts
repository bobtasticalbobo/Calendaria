import { Temporal } from "../time/temporal";
import type { SqlDriver } from "./driver";
import { DEFAULT_CHAPTER_ID } from "./notebooks";
import { NoteReminderRepository } from "./noteReminders";
import { TASK_COLUMNS, type TaskFields, type TaskRow, taskFromRow } from "./tasks";
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

/** A page in a chapter. Notes on the calendar are pages linked to a day. */
export interface Note extends SyncedRecord, TaskFields {
  chapterId: string;
  /** The calendar day the page is linked to, if any. */
  day: Temporal.PlainDate | null;
  /** Where the note sits on the day's week/day board, or null when it is only a marker in the day's header. */
  boardTime: Temporal.PlainTime | null;
  /** Markdown. The first line is the title. */
  body: string;
  color: NoteColor;
  pinned: boolean;
  /** Order within the chapter. */
  position: number;
  /** Tag ids, in the order they were added. */
  tags: string[];
}

export interface NoteInput {
  chapterId?: string;
  day?: Temporal.PlainDate | null;
  boardTime?: Temporal.PlainTime | null;
  body?: string;
  color?: NoteColor;
  pinned?: boolean;
  position?: number;
  tags?: string[];
}

interface NoteRow extends SyncedRow, TaskRow {
  chapter_id: string | null;
  day: string | null;
  board_time: string | null;
  body: string;
  color: string;
  pinned: number;
  position: number;
  tags: string;
}

const COLUMNS = "id, chapter_id, day, board_time, body, color, pinned, position, tags, created_at, updated_at, deleted_at";
/** Read with the task columns, which are only written by TaskRepository. */
const READ = `${COLUMNS}, ${TASK_COLUMNS}`;

/** How long deleted pages stay in the trash. */
export const TRASH_DAYS = 30;

function fromRow(row: NoteRow): Note {
  return {
    ...syncedFieldsFromRow(row),
    ...taskFromRow(row),
    chapterId: row.chapter_id ?? DEFAULT_CHAPTER_ID,
    day: row.day ? Temporal.PlainDate.from(row.day) : null,
    boardTime: row.board_time ? Temporal.PlainTime.from(row.board_time) : null,
    body: row.body,
    color: (NOTE_COLORS as readonly string[]).includes(row.color) ? (row.color as NoteColor) : "yellow",
    pinned: Boolean(row.pinned),
    position: Number(row.position),
    tags: parseIdList(row.tags),
  };
}

/** Board times are kept to the minute, as "HH:MM". */
function boardTimeText(time: Temporal.PlainTime | null): string | null {
  return time ? time.toString({ smallestUnit: "minute" }) : null;
}

function validColor(color: string): NoteColor {
  if (!(NOTE_COLORS as readonly string[]).includes(color)) throw new Error(`Unknown note color "${color}"`);
  return color as NoteColor;
}

export class NoteRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Includes deleted notes, since sync needs to see tombstones. */
  async get(id: string): Promise<Note | null> {
    const rows = await this.db.select<NoteRow>(`SELECT ${READ} FROM notes WHERE id = $1`, [id]);
    return rows.length ? fromRow(rows[0]) : null;
  }

  /** Every live page. A notebook is small enough to hold in memory for the tree, search and links. */
  async list(): Promise<Note[]> {
    const rows = await this.db.select<NoteRow>(
      `SELECT ${READ} FROM notes WHERE deleted_at IS NULL ORDER BY position, id`,
    );
    return rows.map(fromRow);
  }

  /** Live notes on the days from `first` to `last`, inclusive, oldest first. */
  async listOnDays(first: Temporal.PlainDate, last: Temporal.PlainDate): Promise<Note[]> {
    const rows = await this.db.select<NoteRow>(
      `SELECT ${READ} FROM notes
       WHERE deleted_at IS NULL AND day >= $1 AND day <= $2
       ORDER BY id`,
      [first.toString(), last.toString()],
    );
    return rows.map(fromRow);
  }

  /** Pages deleted in the last TRASH_DAYS days, most recent first. */
  async listTrash(): Promise<Note[]> {
    const since = toTimestamp(new Date(this.clock().getTime() - TRASH_DAYS * 86_400_000));
    const rows = await this.db.select<NoteRow>(
      `SELECT ${READ} FROM notes WHERE deleted_at IS NOT NULL AND deleted_at >= $1 ORDER BY deleted_at DESC`,
      [since],
    );
    return rows.map(fromRow);
  }

  async create(input: NoteInput): Promise<Note> {
    const now = toTimestamp(this.clock());
    const chapterId = input.chapterId ?? DEFAULT_CHAPTER_ID;
    let position = input.position;
    if (position === undefined) {
      const [{ last }] = await this.db.select<{ last: number | null }>(
        "SELECT MAX(position) AS last FROM notes WHERE chapter_id = $1 AND deleted_at IS NULL",
        [chapterId],
      );
      position = (last ?? 0) + 1;
    }
    const note: Note = {
      id: newId(),
      chapterId,
      day: input.day ?? null,
      boardTime: input.day ? (input.boardTime ?? null) : null,
      body: input.body ?? "",
      color: validColor(input.color ?? "yellow"),
      pinned: input.pinned ?? false,
      position,
      tags: [...new Set(input.tags ?? [])],
      task: false,
      doneAt: null,
      dueDay: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.db.execute(`INSERT INTO notes (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
      note.id,
      note.chapterId,
      note.day?.toString() ?? null,
      boardTimeText(note.boardTime),
      note.body,
      note.color,
      note.pinned ? 1 : 0,
      note.position,
      JSON.stringify(note.tags),
      note.createdAt,
      note.updatedAt,
      note.deletedAt,
    ]);
    return note;
  }

  async update(id: string, patch: NoteInput): Promise<Note> {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt) throw new Error(`Note ${id} not found`);
    const updated: Note = {
      ...existing,
      chapterId: patch.chapterId ?? existing.chapterId,
      day: patch.day === undefined ? existing.day : patch.day,
      boardTime: patch.boardTime === undefined ? existing.boardTime : patch.boardTime,
      body: patch.body ?? existing.body,
      color: patch.color === undefined ? existing.color : validColor(patch.color),
      pinned: patch.pinned ?? existing.pinned,
      position: patch.position ?? existing.position,
      tags: patch.tags === undefined ? existing.tags : [...new Set(patch.tags)],
      updatedAt: toTimestamp(this.clock()),
    };
    // A page without a day has no board to sit on.
    if (!updated.day) updated.boardTime = null;
    await this.db.execute(
      `UPDATE notes SET chapter_id = $1, day = $2, board_time = $3, body = $4, color = $5, pinned = $6,
         position = $7, tags = $8, updated_at = $9
       WHERE id = $10`,
      [
        updated.chapterId,
        updated.day?.toString() ?? null,
        boardTimeText(updated.boardTime),
        updated.body,
        updated.color,
        updated.pinned ? 1 : 0,
        updated.position,
        JSON.stringify(updated.tags),
        updated.updatedAt,
        id,
      ],
    );
    return updated;
  }

  /**
   * Moves a note to another day. Reminders on its old day move with it by the
   * same number of days, keeping their time of day. `boardTime` places it on
   * the day's board, null takes it off, and leaving it out keeps it where it was.
   */
  async moveToDay(id: string, day: Temporal.PlainDate, boardTime?: Temporal.PlainTime | null): Promise<Note> {
    const existing = await this.get(id);
    if (!existing || existing.deletedAt) throw new Error(`Note ${id} not found`);
    if (existing.day) {
      const shift = existing.day.until(day, { largestUnit: "days" });
      const reminders = new NoteReminderRepository(this.db, this.clock);
      for (const r of await reminders.list()) {
        if (r.noteId === id && r.at.toPlainDate().equals(existing.day)) await reminders.move(r.id, r.at.add(shift));
      }
    }
    return this.update(id, { day, boardTime });
  }

  /** Soft delete: the row stays as a tombstone so other devices learn about it, and the page can be restored. */
  async remove(id: string): Promise<void> {
    const now = toTimestamp(this.clock());
    const { rowsAffected } = await this.db.execute(
      `UPDATE notes SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
    if (rowsAffected === 0) throw new Error(`Note ${id} not found`);
  }

  /** Brings a page back from the trash, into `chapterId` if its own chapter is gone. */
  async restore(id: string, chapterId?: string): Promise<Note> {
    const now = toTimestamp(this.clock());
    await this.db.execute(
      `UPDATE notes SET deleted_at = NULL, updated_at = $1, chapter_id = COALESCE($2, chapter_id) WHERE id = $3`,
      [now, chapterId ?? null, id],
    );
    const note = await this.get(id);
    if (!note) throw new Error(`Note ${id} not found`);
    return note;
  }
}
