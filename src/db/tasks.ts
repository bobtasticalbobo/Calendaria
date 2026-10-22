import { Temporal } from "../time/temporal";
import type { SqlDriver } from "./driver";
import { type Clock, systemClock, toTimestamp } from "./records";

/** Notebooks, chapters and pages can all be tasks. */
export interface TaskFields {
  task: boolean;
  /** When it was ticked, ISO UTC, or null. */
  doneAt: string | null;
  /** Set on important tasks: the day it must be done by. */
  dueDay: Temporal.PlainDate | null;
}

export interface TaskRow {
  task: number;
  done_at: string | null;
  due_day: string | null;
}

export const TASK_COLUMNS = "task, done_at, due_day";

export function taskFromRow(row: TaskRow): TaskFields {
  return {
    task: Boolean(row.task),
    doneAt: row.done_at ?? null,
    dueDay: row.due_day ? Temporal.PlainDate.from(row.due_day) : null,
  };
}

export type TaskTable = "notebooks" | "chapters" | "notes";
const TABLES: readonly TaskTable[] = ["notebooks", "chapters", "notes"];

export interface TaskPatch {
  task?: boolean;
  done?: boolean;
  dueDay?: Temporal.PlainDate | null;
}

/** An unfinished important task, for the reminders that ask whether it's done. */
export interface OpenTask {
  table: TaskTable;
  id: string;
  /** The notebook or chapter name, or the page's text. */
  text: string;
  dueDay: Temporal.PlainDate;
}

export class TaskRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Changes an item's task state. Ticking stamps the time; making it not a
   * task clears the tick and deadline; giving it a deadline makes it a task.
   */
  async set(table: TaskTable, id: string, patch: TaskPatch): Promise<TaskFields> {
    if (!TABLES.includes(table)) throw new Error(`Unknown table ${table}`);
    const [row] = await this.db.select<TaskRow & { deleted_at: string | null }>(
      `SELECT ${TASK_COLUMNS}, deleted_at FROM ${table} WHERE id = $1`,
      [id],
    );
    if (!row || row.deleted_at) throw new Error(`${id} not found`);
    const now = toTimestamp(this.clock());
    const current = taskFromRow(row);
    let next: TaskFields = { ...current };
    if (patch.dueDay !== undefined) next = { ...next, dueDay: patch.dueDay, task: next.task || patch.dueDay !== null };
    if (patch.task !== undefined)
      next = patch.task ? { ...next, task: true } : { task: false, doneAt: null, dueDay: null };
    if (patch.done !== undefined && next.task) next = { ...next, doneAt: patch.done ? (current.doneAt ?? now) : null };
    await this.db.execute(`UPDATE ${table} SET task = $1, done_at = $2, due_day = $3, updated_at = $4 WHERE id = $5`, [
      next.task ? 1 : 0,
      next.doneAt,
      next.dueDay?.toString() ?? null,
      now,
      id,
    ]);
    return next;
  }

  /** Live, unticked tasks with a deadline, soonest first. */
  async openImportant(): Promise<OpenTask[]> {
    const rows = await this.db.select<{ tbl: TaskTable; id: string; text: string; due_day: string }>(
      `SELECT 'notebooks' AS tbl, id, name AS text, due_day FROM notebooks
         WHERE task = 1 AND done_at IS NULL AND due_day IS NOT NULL AND deleted_at IS NULL
       UNION ALL
       SELECT 'chapters', id, name, due_day FROM chapters
         WHERE task = 1 AND done_at IS NULL AND due_day IS NOT NULL AND deleted_at IS NULL
       UNION ALL
       SELECT 'notes', id, body, due_day FROM notes
         WHERE task = 1 AND done_at IS NULL AND due_day IS NOT NULL AND deleted_at IS NULL
       ORDER BY due_day, id`,
    );
    return rows.map((r) => ({ table: r.tbl, id: r.id, text: r.text, dueDay: Temporal.PlainDate.from(r.due_day) }));
  }
}
