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

/**
 * Reads a typed date, day first: 23/10/2026, 23.10.26, 23-10, or ISO
 * 2026-10-23. Without a year it is `today`'s year. Null if it isn't a real day.
 */
export function parseDate(text: string, today: Temporal.PlainDate): Temporal.PlainDate | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{2}|\d{4}))?\.?$/.exec(t);
  let year: number, month: number, day: number;
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) {
    [day, month] = [Number(dmy[1]), Number(dmy[2])];
    year = dmy[3] === undefined ? today.year : dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  } else return null;
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  } catch {
    return null;
  }
}

/** Reads a typed 24-hour time: 9, 09:30, 9.30, 930, 2105. Null if it isn't one. */
export function parseTime(text: string): Temporal.PlainTime | null {
  const t = text.trim();
  // "930" is 9:30 and "2105" is 21:05: the last two digits are the minutes.
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const [hour, minute] = [Number(m[1]), Number(m[2] ?? 0)];
  if (hour > 23 || minute > 59) return null;
  return new Temporal.PlainTime(hour, minute);
}
