import { Temporal } from "../time/temporal";

export type ViewMode = "month" | "week" | "day";

/** Weeks start on Monday (ISO 8601), as in Outlook's default for most of Europe. */
export function startOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 });
}

/** The days a view shows, first to last. */
export function visibleDays(mode: ViewMode, anchor: Temporal.PlainDate): Temporal.PlainDate[] {
  let first: Temporal.PlainDate;
  let count: number;
  if (mode === "day") {
    first = anchor;
    count = 1;
  } else if (mode === "week") {
    first = startOfWeek(anchor);
    count = 7;
  } else {
    first = startOfWeek(anchor.with({ day: 1 }));
    count = 42; // Six weeks always covers a month and keeps the grid steady.
  }
  return Array.from({ length: count }, (_, i) => first.add({ days: i }));
}

export function stepAnchor(mode: ViewMode, anchor: Temporal.PlainDate, direction: 1 | -1) {
  const unit = mode === "month" ? { months: direction } : mode === "week" ? { weeks: direction } : { days: direction };
  return anchor.add(unit);
}

/** The exact instants a list of days covers in `zone`. */
export function dayRange(days: Temporal.PlainDate[], zone: string) {
  return {
    start: days[0].toZonedDateTime(zone).toInstant(),
    end: days[days.length - 1].add({ days: 1 }).toZonedDateTime(zone).toInstant(),
  };
}

/**
 * The app writes dates as day/month/year numbers and times on the 24-hour
 * clock, whatever the computer's region settings say. British English gives
 * exactly that and keeps weekday names in English.
 */
export const APP_LOCALE = "en-GB";

/** 20/10/2026, or 20/10 without the year. */
export function formatDate(date: Temporal.PlainDate, withYear = true): string {
  return date.toLocaleString(APP_LOCALE, { day: "2-digit", month: "2-digit", ...(withYear && { year: "numeric" }) });
}

export function formatWeekday(date: Temporal.PlainDate, style: "short" | "long" = "short"): string {
  return date.toLocaleString(APP_LOCALE, { weekday: style });
}

export function viewTitle(mode: ViewMode, anchor: Temporal.PlainDate): string {
  if (mode === "month") return anchor.toLocaleString(APP_LOCALE, { month: "long", year: "numeric" });
  if (mode === "day") return `${formatWeekday(anchor, "long")} ${formatDate(anchor)}`;
  const days = visibleDays("week", anchor);
  const first = days[0];
  const last = days[6];
  return `${formatDate(first, first.year !== last.year)} – ${formatDate(last)}`;
}

/** 09:00, 14:30. */
export function formatTime(time: Temporal.ZonedDateTime | Temporal.PlainTime): string {
  return time.toLocaleString(APP_LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
