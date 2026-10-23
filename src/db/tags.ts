import type { Temporal } from "../time/temporal";
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

export interface Tag extends SyncedRecord {
  name: string;
  color: string;
}

export interface TagInput {
  name: string;
  color: string;
}

/** Colors offered for tags, muted to suit the dark theme. */
export const TAG_COLORS = ["#ff3b3b", "#ff5a1f", "#ffcf00", "#00b36b", "#00a5b5", "#2f6bff", "#a36bff", "#a3a3a0"];

interface TagRow extends SyncedRow {
  name: string;
  color: string;
}

const COLUMNS = "id, name, color, created_at, updated_at, deleted_at";

function fromRow(row: TagRow): Tag {
  return { ...syncedFieldsFromRow(row), name: row.name, color: row.color };
}

function validName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Tag name cannot be empty");
  return trimmed;
}

function validColor(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid tag color "${color}", expected #rrggbb`);
  return color.toLowerCase();
}

/** The same on every device, so a day tagged on two devices is one row. */
function dayTagId(tagId: string, day: Temporal.PlainDate): string {
  return `${tagId}/${day.toString()}`;
}

export class TagRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Tags that have not been deleted, in the order they were made. */
  async list(): Promise<Tag[]> {
    const rows = await this.db.select<TagRow>(`SELECT ${COLUMNS} FROM tags WHERE deleted_at IS NULL ORDER BY id`);
    return rows.map(fromRow);
  }

  async create(input: TagInput): Promise<Tag> {
    const now = toTimestamp(this.clock());
    const tag: Tag = {
      id: newId(),
      name: validName(input.name),
      color: validColor(input.color),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.db.execute(`INSERT INTO tags (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`, [
      tag.id,
      tag.name,
      tag.color,
      tag.createdAt,
      tag.updatedAt,
      tag.deletedAt,
    ]);
    return tag;
  }

  async update(id: string, patch: Partial<TagInput>): Promise<void> {
    const [existing] = await this.db.select<TagRow>(`SELECT ${COLUMNS} FROM tags WHERE id = $1`, [id]);
    if (!existing || existing.deleted_at) throw new Error(`Tag ${id} not found`);
    await this.db.execute("UPDATE tags SET name = $1, color = $2, updated_at = $3 WHERE id = $4", [
      patch.name === undefined ? existing.name : validName(patch.name),
      patch.color === undefined ? existing.color : validColor(patch.color),
      toTimestamp(this.clock()),
      id,
    ]);
  }

  /** Soft delete. Days and notes keep the tag's id, but deleted tags aren't shown. */
  async remove(id: string): Promise<void> {
    const now = toTimestamp(this.clock());
    await this.db.execute("UPDATE tags SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL", [
      now,
      id,
    ]);
  }

  /** Each day from `first` to `last` with tags, mapped to its tag ids in the order they were added. */
  async onDays(first: Temporal.PlainDate, last: Temporal.PlainDate): Promise<Map<string, string[]>> {
    const rows = await this.db.select<{ day: string; tag_id: string }>(
      `SELECT d.day, d.tag_id FROM day_tags d JOIN tags t ON t.id = d.tag_id
       WHERE d.deleted_at IS NULL AND t.deleted_at IS NULL AND d.day >= $1 AND d.day <= $2
       ORDER BY d.created_at`,
      [first.toString(), last.toString()],
    );
    const byDay = new Map<string, string[]>();
    for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row.tag_id]);
    return byDay;
  }

  /** Puts a tag on a day, or takes it off. */
  async setOnDay(day: Temporal.PlainDate, tagId: string, on: boolean): Promise<void> {
    const now = toTimestamp(this.clock());
    await this.db.execute(
      `INSERT INTO day_tags (id, day, tag_id, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $4, $5)
       ON CONFLICT (id) DO UPDATE SET deleted_at = excluded.deleted_at, updated_at = excluded.updated_at,
         created_at = CASE WHEN day_tags.deleted_at IS NULL THEN day_tags.created_at ELSE excluded.created_at END`,
      [dayTagId(tagId, day), day.toString(), tagId, now, on ? null : now],
    );
  }
}
