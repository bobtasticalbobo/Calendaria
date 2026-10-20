import type { EventOccurrence } from "../db/events";
import { Temporal } from "../time/temporal";
import { timingBounds } from "../time/timing";

export interface DaySegment {
  item: EventOccurrence;
  /** Minutes after midnight, wall-clock, in the view zone. */
  startMinute: number;
  endMinute: number;
  /** Side-by-side placement among overlapping events. */
  column: number;
  columns: number;
  /** Whether the event continues from the previous day or into the next. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

const MINUTES_PER_DAY = 24 * 60;
/** Short events are drawn at least this tall so they stay clickable. */
const MIN_DURATION = 15;

function minuteOfDay(time: Temporal.ZonedDateTime): number {
  return time.hour * 60 + time.minute;
}

/** Occurrences that touch `day`, split into all-day and timed. */
export function itemsOnDay(items: EventOccurrence[], day: Temporal.PlainDate, zone: string) {
  const dayStart = day.toZonedDateTime(zone);
  const dayEnd = day.add({ days: 1 }).toZonedDateTime(zone);
  const allDay: EventOccurrence[] = [];
  const timed: EventOccurrence[] = [];
  for (const item of items) {
    const { start, end } = timingBounds(item.occurrence.timing, zone);
    const startsBeforeDayEnd = Temporal.ZonedDateTime.compare(start, dayEnd) < 0;
    const endsAfterDayStart =
      Temporal.ZonedDateTime.compare(end, dayStart) > 0 ||
      (start.equals(end) && Temporal.ZonedDateTime.compare(start, dayStart) >= 0);
    if (startsBeforeDayEnd && endsAfterDayStart) {
      (item.occurrence.timing.allDay ? allDay : timed).push(item);
    }
  }
  return { allDay, timed };
}

/** Positions timed events on one day of the week/day grid. */
export function layoutDay(timed: EventOccurrence[], day: Temporal.PlainDate, zone: string): DaySegment[] {
  const dayStart = day.toZonedDateTime(zone);
  const dayEnd = day.add({ days: 1 }).toZonedDateTime(zone);

  const segments = timed.map((item): DaySegment => {
    const { start, end } = timingBounds(item.occurrence.timing, zone);
    const continuesBefore = Temporal.ZonedDateTime.compare(start, dayStart) < 0;
    const continuesAfter = Temporal.ZonedDateTime.compare(end, dayEnd) > 0;
    const startMinute = continuesBefore ? 0 : minuteOfDay(start);
    const endMinute =
      continuesAfter || Temporal.ZonedDateTime.compare(end, dayEnd) === 0
        ? MINUTES_PER_DAY
        : minuteOfDay(end);
    return {
      item,
      startMinute,
      endMinute: Math.min(MINUTES_PER_DAY, Math.max(endMinute, startMinute + MIN_DURATION)),
      column: 0,
      columns: 1,
      continuesBefore,
      continuesAfter,
    };
  });

  segments.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  // Group events that overlap (directly or through each other), then give
  // each the first free column within its group.
  let group: DaySegment[] = [];
  let groupEnd = -1;
  const columnEnds: number[] = [];
  const closeGroup = () => {
    for (const s of group) s.columns = columnEnds.length;
    group = [];
    columnEnds.length = 0;
  };
  for (const segment of segments) {
    if (segment.startMinute >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((end) => end <= segment.startMinute);
    if (column === -1) column = columnEnds.push(0) - 1;
    columnEnds[column] = segment.endMinute;
    segment.column = column;
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.endMinute);
  }
  closeGroup();
  return segments;
}
