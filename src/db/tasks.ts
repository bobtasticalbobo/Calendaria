import { Temporal } from "../time/temporal";
import type { SqlDriver } from "./driver";
import { type Clock, newId, systemClock, toTimestamp } from "./records";

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

export type TaskEventKind = "made" | "done" | "deadline" | "snoozed";

/** Something that happened to a task, kept for statistics. */
export interface TaskEvent {
  id: string;
  table: TaskTable;
  itemId: string;
  kind: TaskEventKind;
  /** The task's name, or a page's first line, when it happened. */
  title: string;
  dueDay: Temporal.PlainDate | null;
  at: Temporal.Instant;
}

interface TaskEventRow {
  id: string;
  item_table: TaskTable;
  item_id: string;
  kind: TaskEventKind;
  title: string;
  due_day: string | null;
  at: string;
}

/** A name, or a page's first non-empty line. */
function titleOf(table: TaskTable, text: string): string {
  return table === "notes" ? (text.split("\n").find((l) => l.trim()) ?? "").trim() : text;
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
    const [row] = await this.db.select<TaskRow & { deleted_at: string | null; text: string }>(
      `SELECT ${TASK_COLUMNS}, deleted_at, ${table === "notes" ? "body" : "name"} AS text FROM ${table} WHERE id = $1`,
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
    const title = titleOf(table, row.text);
    if (!current.task && next.task) await this.log(table, id, "made", title, next.dueDay, now);
    if (next.dueDay && !(current.dueDay && next.dueDay.equals(current.dueDay)))
      await this.log(table, id, "deadline", title, next.dueDay, now);
    if (!current.doneAt && next.doneAt) await this.log(table, id, "done", title, next.dueDay, now);
    if (current.doneAt && !next.doneAt) {
      // Unticked: that completion didn't happen after all.
      await this.db.execute(
        `UPDATE task_events SET deleted_at = $1, updated_at = $1
         WHERE id = (SELECT id FROM task_events WHERE item_id = $2 AND kind = 'done' AND deleted_at IS NULL
                     ORDER BY at DESC LIMIT 1)`,
        [now, id],
      );
    }
    return next;
  }

  /** Records a "Not yet" answer to "Is this done?". */
  async snoozed(table: TaskTable, id: string, title: string, dueDay: Temporal.PlainDate | null): Promise<void> {
    await this.log(table, id, "snoozed", title, dueDay, toTimestamp(this.clock()));
  }

  /** Every recorded event, oldest first. */
  async events(): Promise<TaskEvent[]> {
    const rows = await this.db.select<TaskEventRow>(
      "SELECT id, item_table, item_id, kind, title, due_day, at FROM task_events WHERE deleted_at IS NULL ORDER BY at, id",
    );
    return rows.map((r) => ({
      id: r.id,
      table: r.item_table,
      itemId: r.item_id,
      kind: r.kind,
      title: r.title,
      dueDay: r.due_day ? Temporal.PlainDate.from(r.due_day) : null,
      at: Temporal.Instant.from(r.at),
    }));
  }

  private async log(
    table: TaskTable,
    itemId: string,
    kind: TaskEventKind,
    title: string,
    dueDay: Temporal.PlainDate | null,
    at: string,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO task_events (id, item_table, item_id, kind, title, due_day, at, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, NULL)`,
      [newId(), table, itemId, kind, title, dueDay?.toString() ?? null, at],
    );
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
