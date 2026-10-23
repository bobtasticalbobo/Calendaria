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
import { TAG_COLORS } from "./tags";
import { TASK_COLUMNS, type TaskFields, type TaskRow, taskFromRow } from "./tasks";

/** Made by migration 0008 with these ids on every device, so they never come in twos. */
export const DEFAULT_NOTEBOOK_ID = "019a0a00-0000-7000-8000-000000000001";
/** The first notebook's first chapter: where new pages and pages whose chapter is gone go. */
export const DEFAULT_CHAPTER_ID = "019a0a00-0000-7000-8000-000000000002";
/** The "Calendar" notebook from migration 0012, fixed ids like the default ones. */
export const CALENDAR_NOTEBOOK_ID = "019a0a00-0000-7000-8000-000000000003";
/** Where notes made on the calendar go. */
export const CALENDAR_CHAPTER_ID = "019a0a00-0000-7000-8000-000000000004";

export interface Notebook extends SyncedRecord, TaskFields {
  name: string;
  color: string;
  position: number;
}

export interface Chapter extends SyncedRecord, TaskFields {
  notebookId: string;
  name: string;
  position: number;
}

interface NotebookRow extends SyncedRow, TaskRow {
  name: string;
  color: string;
  position: number;
}

interface ChapterRow extends SyncedRow, TaskRow {
  notebook_id: string;
  name: string;
  position: number;
}

const NOTEBOOK_COLUMNS = "id, name, color, position, created_at, updated_at, deleted_at";
const CHAPTER_COLUMNS = "id, notebook_id, name, position, created_at, updated_at, deleted_at";

const NO_TASK: TaskFields = { task: false, doneAt: null, dueDay: null };

function validName(name: string, what: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error(`${what} name cannot be empty`);
  return trimmed;
}

function validColor(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid color "${color}", expected #rrggbb`);
  return color.toLowerCase();
}

/** Notebooks and their chapters. Pages live in NoteRepository. */
export class NotebookRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  async listNotebooks(): Promise<Notebook[]> {
    const rows = await this.db.select<NotebookRow>(
      `SELECT ${NOTEBOOK_COLUMNS}, ${TASK_COLUMNS} FROM notebooks WHERE deleted_at IS NULL ORDER BY position, id`,
    );
    return rows.map((r) => ({
      ...syncedFieldsFromRow(r),
      ...taskFromRow(r),
      name: r.name,
      color: r.color,
      position: r.position,
    }));
  }

  async listChapters(): Promise<Chapter[]> {
    const rows = await this.db.select<ChapterRow>(
      `SELECT ${CHAPTER_COLUMNS}, ${TASK_COLUMNS} FROM chapters WHERE deleted_at IS NULL ORDER BY position, id`,
    );
    return rows.map((r) => ({
      ...syncedFieldsFromRow(r),
      ...taskFromRow(r),
      notebookId: r.notebook_id,
      name: r.name,
      position: r.position,
    }));
  }

  /** A new notebook at the end, with a first chapter so it can hold pages straight away. */
  async createNotebook(name: string, color?: string): Promise<{ notebook: Notebook; chapter: Chapter }> {
    const now = toTimestamp(this.clock());
    const [{ last }] = await this.db.select<{ last: number | null }>(
      "SELECT MAX(position) AS last FROM notebooks WHERE deleted_at IS NULL",
    );
    const [{ count }] = await this.db.select<{ count: number }>("SELECT COUNT(*) AS count FROM notebooks");
    const notebook: Notebook = {
      id: newId(),
      name: validName(name, "Notebook"),
      color: validColor(color ?? TAG_COLORS[Number(count) % TAG_COLORS.length]),
      position: (last ?? 0) + 1,
      ...NO_TASK,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.db.execute(`INSERT INTO notebooks (${NOTEBOOK_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.position,
      now,
      now,
      null,
    ]);
    const chapter = await this.createChapter(notebook.id, "Chapter 1");
    return { notebook, chapter };
  }

  async updateNotebook(id: string, patch: { name?: string; color?: string; position?: number }): Promise<void> {
    const [row] = await this.db.select<NotebookRow>(`SELECT ${NOTEBOOK_COLUMNS} FROM notebooks WHERE id = $1`, [id]);
    if (!row || row.deleted_at) throw new Error(`Notebook ${id} not found`);
    await this.db.execute("UPDATE notebooks SET name = $1, color = $2, position = $3, updated_at = $4 WHERE id = $5", [
      patch.name === undefined ? row.name : validName(patch.name, "Notebook"),
      patch.color === undefined ? row.color : validColor(patch.color),
      patch.position ?? row.position,
      toTimestamp(this.clock()),
      id,
    ]);
  }

  async createChapter(notebookId: string, name: string): Promise<Chapter> {
    const now = toTimestamp(this.clock());
    const [{ last }] = await this.db.select<{ last: number | null }>(
      "SELECT MAX(position) AS last FROM chapters WHERE notebook_id = $1 AND deleted_at IS NULL",
      [notebookId],
    );
    const chapter: Chapter = {
      id: newId(),
      notebookId,
      name: validName(name, "Chapter"),
      position: (last ?? 0) + 1,
      ...NO_TASK,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.db.execute(`INSERT INTO chapters (${CHAPTER_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      chapter.id,
      chapter.notebookId,
      chapter.name,
      chapter.position,
      now,
      now,
      null,
    ]);
    return chapter;
  }

  async updateChapter(id: string, patch: { name?: string; notebookId?: string; position?: number }): Promise<void> {
    const [row] = await this.db.select<ChapterRow>(`SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE id = $1`, [id]);
    if (!row || row.deleted_at) throw new Error(`Chapter ${id} not found`);
    await this.db.execute(
      "UPDATE chapters SET name = $1, notebook_id = $2, position = $3, updated_at = $4 WHERE id = $5",
      [
        patch.name === undefined ? row.name : validName(patch.name, "Chapter"),
        patch.notebookId ?? row.notebook_id,
        patch.position ?? row.position,
        toTimestamp(this.clock()),
        id,
      ],
    );
  }

  /** Soft-deletes a chapter and moves its pages to the trash. The default and calendar chapters stay. */
  async removeChapter(id: string): Promise<void> {
    if (id === DEFAULT_CHAPTER_ID) throw new Error("The first notebook's first chapter can't be deleted");
    if (id === CALENDAR_CHAPTER_ID) throw new Error("The calendar's day notes chapter can't be deleted");
    const now = toTimestamp(this.clock());
    await this.db.execute(
      "UPDATE notes SET deleted_at = $1, updated_at = $1 WHERE chapter_id = $2 AND deleted_at IS NULL",
      [now, id],
    );
    await this.db.execute("UPDATE chapters SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL", [
      now,
      id,
    ]);
  }

  /** Soft-deletes a notebook with its chapters, and moves their pages to the trash. */
  async removeNotebook(id: string): Promise<void> {
    if (id === DEFAULT_NOTEBOOK_ID) throw new Error("The first notebook can't be deleted");
    if (id === CALENDAR_NOTEBOOK_ID) throw new Error("The Calendar notebook can't be deleted");
    const chapters = await this.db.select<{ id: string }>(
      "SELECT id FROM chapters WHERE notebook_id = $1 AND deleted_at IS NULL",
      [id],
    );
    for (const chapter of chapters) await this.removeChapter(chapter.id);
    const now = toTimestamp(this.clock());
    await this.db.execute(
      "UPDATE notebooks SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL",
      [now, id],
    );
  }
}
