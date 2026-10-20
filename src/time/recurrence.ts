import { RRule } from "rrule";
import { Temporal } from "./temporal";
import { type EventTiming, timingBounds, toZoned } from "./timing";

/**
 * A repeat rule in iCalendar RRULE syntax without DTSTART, e.g.
 * "FREQ=WEEKLY;BYDAY=MO,WE". `exdates` lists the start (as stored, see
 * `occurrenceKey`) of each occurrence that was deleted or moved.
 */
export interface Recurrence {
  rule: string;
  exdates: string[];
}

export interface RepeatingEvent {
  timing: EventTiming;
  recurrence: Recurrence | null;
}

export interface Occurrence {
  /** Identifies this occurrence within its series: its original start. */
  key: string;
  timing: EventTiming;
}

type DateOrDateTime = Temporal.PlainDate | Temporal.PlainDateTime;

/*
 * rrule.js does its arithmetic on JS Dates using their UTC fields. We hand it
 * wall-clock times dressed up as UTC ("floating" times) so it never applies a
 * time zone itself; Temporal then turns each wall-clock result into a real
 * instant in the event's zone. This is what keeps a 9:00 meeting at 9:00 on
 * both sides of a daylight saving change.
 */
function toFloating(value: DateOrDateTime): Date {
  const dt = value instanceof Temporal.PlainDate ? value.toPlainDateTime() : value;
  return new Date(
    Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second),
  );
}

function fromFloating(date: Date): Temporal.PlainDateTime {
  return new Temporal.PlainDateTime(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
}

export function occurrenceKey(timing: EventTiming): string {
  return timing.start.toString();
}

function buildRule(timing: EventTiming, rule: string): RRule {
  const options = RRule.parseString(rule.replace(/^RRULE:/i, ""));
  delete options.dtstart;
  delete options.tzid;
  // UNTIL ending in Z is an exact instant (common in imported calendars);
  // convert it to the event's wall-clock time to match the floating DTSTART.
  if (options.until && !timing.allDay && /UNTIL=\d{8}T\d{6}Z/i.test(rule)) {
    const instant = Temporal.Instant.fromEpochMilliseconds(options.until.getTime());
    options.until = toFloating(instant.toZonedDateTimeISO(timing.timeZone).toPlainDateTime());
  }
  return new RRule({ ...options, dtstart: toFloating(timing.start) });
}

/** The timing of the occurrence that starts at `start` (wall-clock, event zone). */
function occurrenceTiming(timing: EventTiming, start: Temporal.PlainDateTime): EventTiming {
  if (timing.allDay) {
    const date = start.toPlainDate();
    return { allDay: true, start: date, end: date.add(timing.start.until(timing.end)) };
  }
  // Keep the exact length, so a 23:00–01:00 event stays two hours long
  // even on the night the clocks change.
  const length = toZoned(timing.start, timing.timeZone).until(
    toZoned(timing.end, timing.timeZone),
  );
  const end = toZoned(start, timing.timeZone).add(length).toPlainDateTime();
  return { allDay: false, start, end, timeZone: timing.timeZone };
}

function overlaps(
  timing: EventTiming,
  rangeStart: Temporal.Instant,
  rangeEnd: Temporal.Instant,
  viewZone: string,
): boolean {
  const { start, end } = timingBounds(timing, viewZone);
  const s = start.toInstant();
  const e = end.toInstant();
  if (Temporal.Instant.compare(s, rangeEnd) >= 0) return false;
  if (Temporal.Instant.compare(e, rangeStart) > 0) return true;
  // Zero-length events still show up at their start time.
  return s.equals(e) && Temporal.Instant.compare(s, rangeStart) >= 0;
}

/**
 * Every occurrence of `event` that overlaps [rangeStart, rangeEnd), in start
 * order. `viewZone` is the zone the calendar is displayed in; it decides where
 * all-day events begin and end.
 */
export function expandOccurrences(
  event: RepeatingEvent,
  rangeStart: Temporal.Instant,
  rangeEnd: Temporal.Instant,
  viewZone: string,
): Occurrence[] {
  const { timing, recurrence } = event;
  if (!recurrence) {
    return overlaps(timing, rangeStart, rangeEnd, viewZone)
      ? [{ key: occurrenceKey(timing), timing }]
      : [];
  }

  // Search a wider wall-clock window than asked for (by the event's length
  // plus a day either side for zone offsets) and filter precisely below.
  const zone = timing.allDay ? viewZone : timing.timeZone;
  const { start, end } = timingBounds(timing, zone);
  const length = start.until(end, { largestUnit: "hours" });
  const windowStart = rangeStart
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .subtract(length)
    .subtract({ days: 1 });
  const windowEnd = rangeEnd.toZonedDateTimeISO(zone).toPlainDateTime().add({ days: 1 });

  const excluded = new Set(recurrence.exdates);
  return buildRule(timing, recurrence.rule)
    .between(toFloating(windowStart), toFloating(windowEnd), true)
    .map((date) => occurrenceTiming(timing, fromFloating(date)))
    .map((t) => ({ key: occurrenceKey(t), timing: t }))
    .filter((o) => !excluded.has(o.key) && overlaps(o.timing, rangeStart, rangeEnd, viewZone));
}

/**
 * When the last occurrence ends, or null if the series repeats forever.
 * Used to index recurring events so range queries can skip finished series.
 * All-day events are measured in UTC; callers widen ranges by a day.
 */
export function seriesEnd(event: RepeatingEvent): Temporal.Instant | null {
  const { timing, recurrence } = event;
  if (!recurrence) return timingBounds(timing, "UTC").end.toInstant();
  const rule = buildRule(timing, recurrence.rule);
  if (!rule.options.count && !rule.options.until) return null;
  const all = rule.all();
  const last = all.length
    ? occurrenceTiming(timing, fromFloating(all[all.length - 1]))
    : timing;
  return timingBounds(last, "UTC").end.toInstant();
}
