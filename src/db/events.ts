import { type Occurrence, type Recurrence, expandOccurrences, seriesEnd } from "../time/recurrence";
import { Temporal } from "../time/temporal";
import { type EventTiming, timingBounds, validateTiming } from "../time/timing";
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

export interface CalendarEvent extends SyncedRecord {
  calendarId: string;
  title: string;
  description: string;
  location: string;
  timing: EventTiming;
  recurrence: Recurrence | null;
  /** Minutes before the start, ascending. */
  reminders: number[];
  /** Set for events imported from a calendar file; see `importEvent`. */
  sourceUid: string | null;
}

export type ImportOutcome = "created" | "updated" | "skipped";

export interface EventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  timing: EventTiming;
  /** Repeat rule; exdates are managed by the repository, so only the rule is taken. */
  rule?: string | null;
  reminders?: number[];
}

export interface EventOccurrence {
  event: CalendarEvent;
  occurrence: Occurrence;
}

interface EventRow extends SyncedRow {
  calendar_id: string;
  title: string;
  description: string;
  location: string;
  all_day: number;
  start_local: string;
  end_local: string;
  time_zone: string | null;
  start_utc: string;
  end_utc: string | null;
  rrule: string | null;
  exdates: string;
  reminders: string;
  source_uid: string | null;
}

const COLUMNS =
  "id, calendar_id, title, description, location, all_day, start_local, end_local, " +
  "time_zone, start_utc, end_utc, rrule, exdates, reminders, created_at, updated_at, deleted_at, source_uid";

/** Fixed-width UTC text, so stored instants compare correctly as strings. */
function utcText(instant: Temporal.Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 });
}

function timingFromRow(row: EventRow): EventTiming {
  if (row.all_day) {
    return {
      allDay: true,
      start: Temporal.PlainDate.from(row.start_local),
      end: Temporal.PlainDate.from(row.end_local),
    };
  }
  return {
    allDay: false,
    start: Temporal.PlainDateTime.from(row.start_local),
    end: Temporal.PlainDateTime.from(row.end_local),
    timeZone: row.time_zone!,
  };
}

function fromRow(row: EventRow): CalendarEvent {
  return {
    ...syncedFieldsFromRow(row),
    calendarId: row.calendar_id,
    title: row.title,
    description: row.description,
    location: row.location,
    timing: timingFromRow(row),
    recurrence: row.rrule ? { rule: row.rrule, exdates: JSON.parse(row.exdates) } : null,
    reminders: JSON.parse(row.reminders),
    sourceUid: row.source_uid,
  };
}

function validReminders(reminders: number[]): number[] {
  for (const r of reminders) {
    if (!Number.isInteger(r) || r < 0) throw new Error(`Invalid reminder "${r}"`);
  }
  return [...new Set(reminders)].sort((a, b) => a - b);
}

/** The columns derived from an event's timing, written alongside it. */
function indexColumns(event: Pick<CalendarEvent, "timing" | "recurrence">) {
  const { start, end } = timingBounds(event.timing, "UTC");
  const last = event.recurrence ? seriesEnd(event) : end.toInstant();
  return {
    startUtc: utcText(start.toInstant()),
    endUtc: last ? utcText(last) : null,
  };
}

export class EventRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock = systemClock,
  ) {}

  async get(id: string): Promise<CalendarEvent | null> {
    const rows = await this.db.select<EventRow>(`SELECT ${COLUMNS} FROM events WHERE id = $1`, [id]);
    return rows.length ? fromRow(rows[0]) : null;
  }

  /**
   * Events with at least one occurrence that may overlap the range, from
   * calendars that haven't been deleted. Use `occurrencesInRange` for the
   * exact occurrences.
   */
  async listInRange(rangeStart: Temporal.Instant, rangeEnd: Temporal.Instant): Promise<CalendarEvent[]> {
    // Widened by a day each side because all-day events are indexed in UTC.
    const day = { hours: 24 };
    const rows = await this.db.select<EventRow>(
      `SELECT ${COLUMNS.split(", ").map((c) => `e.${c}`).join(", ")}
       FROM events e JOIN calendars c ON c.id = e.calendar_id
       WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL
         AND e.start_utc < $1
         AND (e.end_utc IS NULL OR e.end_utc >= $2)
       ORDER BY e.start_utc, e.id`,
      [utcText(rangeEnd.add(day)), utcText(rangeStart.subtract(day))],
    );
    return rows.map(fromRow);
  }

  /** Every occurrence overlapping [rangeStart, rangeEnd), sorted by start. */
  async occurrencesInRange(
    rangeStart: Temporal.Instant,
    rangeEnd: Temporal.Instant,
    viewZone: string,
  ): Promise<EventOccurrence[]> {
    const events = await this.listInRange(rangeStart, rangeEnd);
    const result = events.flatMap((event) =>
      expandOccurrences(event, rangeStart, rangeEnd, viewZone).map((occurrence) => ({
        event,
        occurrence,
      })),
    );
    const startOf = (o: EventOccurrence) => timingBounds(o.occurrence.timing, viewZone).start;
    return result.sort((a, b) => Temporal.ZonedDateTime.compare(startOf(a), startOf(b)));
  }

  async create(input: EventInput): Promise<CalendarEvent> {
    const now = toTimestamp(this.clock());
    const event = this.build(input, {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    await this.insert(event);
    return event;
  }

  /**
   * Saves an event read from a calendar file. Importing the same file again
   * updates the events it created, and leaves alone any you deleted since.
   */
  async importEvent(
    sourceUid: string,
    input: EventInput,
    exdates: string[],
  ): Promise<ImportOutcome> {
    const rows = await this.db.select<EventRow>(
      `SELECT ${COLUMNS} FROM events WHERE calendar_id = $1 AND source_uid = $2`,
      [input.calendarId, sourceUid],
    );
    const existing = rows.length ? fromRow(rows[0]) : null;
    if (existing?.deletedAt) return "skipped";

    const now = toTimestamp(this.clock());
    const event = this.build(
      input,
      existing
        ? { ...existing, updatedAt: now }
        : { id: newId(), createdAt: now, updatedAt: now, deletedAt: null },
    );
    event.sourceUid = sourceUid;
    if (event.recurrence) event.recurrence.exdates = [...new Set(exdates)];
    if (existing) {
      await this.write(event);
      return "updated";
    }
    await this.insert(event);
    return "created";
  }

  /**
   * Replaces an event's fields. Removed occurrences are kept only if the
   * start time and repeat rule are unchanged, since otherwise they no longer
   * line up with the series.
   */
  async update(id: string, input: EventInput): Promise<CalendarEvent> {
    const existing = await this.live(id);
    const rule = input.rule ?? null;
    const keepExdates =
      existing.recurrence?.rule === rule &&
      existing.timing.start.toString() === input.timing.start.toString();
    const event = this.build(input, { ...existing, updatedAt: toTimestamp(this.clock()) });
    if (event.recurrence && keepExdates) event.recurrence.exdates = existing.recurrence!.exdates;
    await this.write(event);
    return event;
  }

  /** Removes one occurrence of a repeating event. */
  async removeOccurrence(id: string, key: string): Promise<void> {
    const event = await this.live(id);
    if (!event.recurrence) throw new Error(`Event ${id} doesn't repeat`);
    if (!event.recurrence.exdates.includes(key)) event.recurrence.exdates.push(key);
    event.updatedAt = toTimestamp(this.clock());
    await this.write(event);
  }

  /**
   * Changes one occurrence of a repeating event: it becomes a separate event
   * and is removed from the series.
   */
  async detachOccurrence(id: string, key: string, input: EventInput): Promise<CalendarEvent> {
    // Create first: if the second write fails you see a duplicate, not a lost event.
    const detached = await this.create({ ...input, rule: null });
    await this.removeOccurrence(id, key);
    return detached;
  }

  /** Soft delete, leaving a tombstone for sync. */
  async remove(id: string): Promise<void> {
    const now = toTimestamp(this.clock());
    const { rowsAffected } = await this.db.execute(
      `UPDATE events SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL`,
      [now, id],
    );
    if (rowsAffected === 0) throw new Error(`Event ${id} not found`);
  }

  private async live(id: string): Promise<CalendarEvent> {
    const event = await this.get(id);
    if (!event || event.deletedAt) throw new Error(`Event ${id} not found`);
    return event;
  }

  private build(
    input: EventInput,
    synced: SyncedRecord & { sourceUid?: string | null },
  ): CalendarEvent {
    validateTiming(input.timing);
    const event: CalendarEvent = {
      ...synced,
      calendarId: input.calendarId,
      title: input.title.trim(),
      description: input.description ?? "",
      location: input.location?.trim() ?? "",
      timing: input.timing,
      recurrence: input.rule ? { rule: input.rule, exdates: [] } : null,
      reminders: validReminders(input.reminders ?? []),
      sourceUid: synced.sourceUid ?? null,
    };
    indexColumns(event); // Throws early on an unparseable rule.
    return event;
  }

  private async insert(event: CalendarEvent): Promise<void> {
    await this.db.execute(
      `INSERT INTO events (${COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      this.rowValues(event),
    );
  }

  private async write(event: CalendarEvent): Promise<void> {
    // rowValues minus created_at and deleted_at, which updates never change.
    const [id, ...fields] = this.rowValues(event).slice(0, 14);
    await this.db.execute(
      `UPDATE events SET calendar_id = $1, title = $2, description = $3, location = $4,
         all_day = $5, start_local = $6, end_local = $7, time_zone = $8, start_utc = $9,
         end_utc = $10, rrule = $11, exdates = $12, reminders = $13, updated_at = $14
       WHERE id = $15`,
      [...fields, event.updatedAt, id],
    );
  }

  private rowValues(event: CalendarEvent): unknown[] {
    const { startUtc, endUtc } = indexColumns(event);
    return [
      event.id,
      event.calendarId,
      event.title,
      event.description,
      event.location,
      event.timing.allDay ? 1 : 0,
      event.timing.start.toString(),
      event.timing.end.toString(),
      event.timing.allDay ? null : event.timing.timeZone,
      startUtc,
      endUtc,
      event.recurrence?.rule ?? null,
      JSON.stringify(event.recurrence?.exdates ?? []),
      JSON.stringify(event.reminders),
      event.createdAt,
      event.updatedAt,
      event.deletedAt,
      event.sourceUid,
    ];
  }
}
