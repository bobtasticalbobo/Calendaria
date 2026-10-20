import type { EventOccurrence } from "../db/events";
import { Temporal } from "./temporal";
import { timingBounds } from "./timing";

export interface DueReminder {
  eventId: string;
  occurrenceKey: string;
  title: string;
  start: Temporal.ZonedDateTime;
  minutesBefore: number;
  fireAt: Temporal.Instant;
}

/** Reminder choices offered in the editor, in minutes before the start. */
export const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

/** The longest reminder offered, so the scheduler knows how far ahead to look. */
export const MAX_REMINDER = Temporal.Duration.from({ minutes: Math.max(...REMINDER_OPTIONS) });

/**
 * Reminders whose time falls in (since, until]. Checking consecutive windows
 * means each reminder fires exactly once, even if checks run late.
 */
export function dueReminders(
  occurrences: EventOccurrence[],
  since: Temporal.Instant,
  until: Temporal.Instant,
  viewZone: string,
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const { event, occurrence } of occurrences) {
    const start = timingBounds(occurrence.timing, viewZone).start;
    for (const minutesBefore of event.reminders) {
      const fireAt = start.toInstant().subtract({ minutes: minutesBefore });
      if (
        Temporal.Instant.compare(fireAt, since) > 0 &&
        Temporal.Instant.compare(fireAt, until) <= 0
      ) {
        due.push({
          eventId: event.id,
          occurrenceKey: occurrence.key,
          title: event.title,
          start,
          minutesBefore,
          fireAt,
        });
      }
    }
  }
  return due.sort((a, b) => Temporal.Instant.compare(a.fireAt, b.fireAt));
}
