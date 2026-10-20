import type { EventTiming } from "../time/timing";
import { Temporal } from "../time/temporal";

function dateOf(value: Temporal.PlainDate | Temporal.PlainDateTime): Temporal.PlainDate {
  return value instanceof Temporal.PlainDate ? value : value.toPlainDate();
}

/**
 * The editor shows one occurrence; when the change applies to the whole
 * series, move the series' first occurrence by the same amount. Works by
 * keeping the day offset between that occurrence and the series start, so
 * changing times, dates, zone or all-day all carry over.
 */
export function seriesTimingFromOccurrenceEdit(
  series: EventTiming,
  occurrence: EventTiming,
  edited: EventTiming,
): EventTiming {
  const offset = { days: dateOf(occurrence.start).until(dateOf(series.start)).days };
  return edited.allDay
    ? { ...edited, start: edited.start.add(offset), end: edited.end.add(offset) }
    : { ...edited, start: edited.start.add(offset), end: edited.end.add(offset) };
}
