import type { TaskFields } from "../db/tasks";
import { Temporal } from "../time/temporal";

/** Ticked tasks stay in the tree, crossed out, for this long. */
export const KEEP_DONE_DAYS = 7;

/** Whether an item shows in the tree: not a task ticked more than a week ago, unless completed tasks are shown. */
export function isVisible(item: TaskFields, showCompleted: boolean, now: Temporal.Instant): boolean {
  if (showCompleted || !item.doneAt) return true;
  return Temporal.Instant.compare(Temporal.Instant.from(item.doneAt).add({ hours: 24 * KEEP_DONE_DAYS }), now) > 0;
}

/**
 * How often an unfinished important task asks whether it's done, by how many
 * days past its deadline it is: every 4 hours on the day, 2 the day after,
 * then hourly, then every half hour from the third day.
 */
export function nagInterval(daysLate: number): Temporal.Duration {
  if (daysLate <= 0) return Temporal.Duration.from({ hours: 4 });
  if (daysLate === 1) return Temporal.Duration.from({ hours: 2 });
  if (daysLate === 2) return Temporal.Duration.from({ hours: 1 });
  return Temporal.Duration.from({ minutes: 30 });
}

/** Asks only between these times, so it doesn't wake anyone at night. */
const FIRST_ON_DUE_DAY = new Temporal.PlainTime(9);
const FIRST = new Temporal.PlainTime(8);
const LAST = new Temporal.PlainTime(22);

/** The times on `day` that a task due on `due` asks, earliest first. */
export function nagTimes(due: Temporal.PlainDate, day: Temporal.PlainDate): Temporal.PlainTime[] {
  const late = due.until(day, { largestUnit: "days" }).days;
  if (late < 0) return [];
  const step = nagInterval(late);
  const times: Temporal.PlainTime[] = [];
  let at = day.toPlainDateTime(late === 0 ? FIRST_ON_DUE_DAY : FIRST);
  const end = day.toPlainDateTime(LAST);
  while (Temporal.PlainDateTime.compare(at, end) <= 0) {
    times.push(at.toPlainTime());
    at = at.add(step);
  }
  return times;
}

/** The latest time at or before `now` that a task due on `due` should have asked, or null before the first. */
export function latestNag(due: Temporal.PlainDate, now: Temporal.ZonedDateTime): Temporal.ZonedDateTime | null {
  const today = now.toPlainDate();
  const earlier = nagTimes(due, today).filter((t) => Temporal.PlainTime.compare(t, now.toPlainTime()) <= 0);
  if (earlier.length)
    return today.toZonedDateTime({ timeZone: now.timeZoneId, plainTime: earlier[earlier.length - 1] });
  const yesterday = today.subtract({ days: 1 });
  const before = nagTimes(due, yesterday);
  if (!before.length) return null;
  return yesterday.toZonedDateTime({ timeZone: now.timeZoneId, plainTime: before[before.length - 1] });
}

/** Whether to ask now: a nag time has passed since it last asked. */
export function shouldNag(
  due: Temporal.PlainDate,
  lastAsked: Temporal.Instant | null,
  now: Temporal.ZonedDateTime,
): boolean {
  const latest = latestNag(due, now);
  if (!latest) return false;
  return !lastAsked || Temporal.Instant.compare(lastAsked, latest.toInstant()) < 0;
}

/** Days until an important task's deadline: negative when late. */
export function daysLeft(due: Temporal.PlainDate, today: Temporal.PlainDate): number {
  return today.until(due, { largestUnit: "days" }).days;
}

/** "today", "tomorrow", "in 3 days", "1 day late". */
export function describeDue(due: Temporal.PlainDate, today: Temporal.PlainDate): string {
  const left = daysLeft(due, today);
  if (left === 0) return "due today";
  if (left === 1) return "due tomorrow";
  if (left > 1) return `due in ${left} days`;
  return `${-left} day${left === -1 ? "" : "s"} late`;
}
