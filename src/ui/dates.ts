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

export function viewTitle(mode: ViewMode, anchor: Temporal.PlainDate, locale?: string): string {
  if (mode === "month") return anchor.toLocaleString(locale, { month: "long", year: "numeric" });
  if (mode === "day") {
    return anchor.toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  const days = visibleDays("week", anchor);
  const first = days[0];
  const last = days[6];
  const sameMonth = first.month === last.month;
  return `${first.toLocaleString(locale, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })} – ${last.toLocaleString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function formatTime(time: Temporal.ZonedDateTime | Temporal.PlainTime, locale?: string): string {
  return time.toLocaleString(locale, { hour: "numeric", minute: "2-digit" });
}
