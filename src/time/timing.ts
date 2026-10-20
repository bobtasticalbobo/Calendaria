import { Temporal } from "./temporal";

/**
 * When an event happens, as the person entered it.
 *
 * Timed events keep their wall-clock time plus the IANA time zone it was
 * entered in, so "9:00 every Monday in Stockholm" stays 9:00 across daylight
 * saving changes. All-day events are plain dates with no time zone: a birthday
 * is the same date wherever you are. `end` is exclusive for all-day events
 * (a one-day event on the 3rd ends on the 4th), matching iCalendar.
 */
export type EventTiming =
  | {
      allDay: false;
      start: Temporal.PlainDateTime;
      end: Temporal.PlainDateTime;
      timeZone: string;
    }
  | {
      allDay: true;
      start: Temporal.PlainDate;
      end: Temporal.PlainDate;
    };

export function systemTimeZone(): string {
  return Temporal.Now.timeZoneId();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a wall-clock time to an exact instant. Times skipped by a
 * spring-forward change move forward by the gap (02:30 becomes 03:30), and
 * times repeated by a fall-back change use the first one, as calendar apps do.
 */
export function toZoned(
  dateTime: Temporal.PlainDateTime,
  timeZone: string,
): Temporal.ZonedDateTime {
  return dateTime.toZonedDateTime(timeZone, { disambiguation: "compatible" });
}

/** Start and end as exact instants; all-day events span midnight to midnight in `viewZone`. */
export function timingBounds(
  timing: EventTiming,
  viewZone: string,
): { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } {
  if (timing.allDay) {
    return {
      start: timing.start.toZonedDateTime({ timeZone: viewZone }),
      end: timing.end.toZonedDateTime({ timeZone: viewZone }),
    };
  }
  return {
    start: toZoned(timing.start, timing.timeZone).withTimeZone(viewZone),
    end: toZoned(timing.end, timing.timeZone).withTimeZone(viewZone),
  };
}

export function validateTiming(timing: EventTiming): void {
  if (!timing.allDay && !isValidTimeZone(timing.timeZone)) {
    throw new Error(`Unknown time zone "${timing.timeZone}"`);
  }
  const ordered = timing.allDay
    ? Temporal.PlainDate.compare(timing.start, timing.end) < 0
    : Temporal.Instant.compare(
        toZoned(timing.start, timing.timeZone).toInstant(),
        toZoned(timing.end, timing.timeZone).toInstant(),
      ) <= 0;
  if (!ordered) throw new Error("Event must end after it starts");
}
