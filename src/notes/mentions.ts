import { Temporal } from "../time/temporal";
import { formatDate } from "../ui/dates";

/** A date written in a page, like 24/10/2026 or 24/10/2026 14:30. */
export interface DateMention {
  start: number;
  end: number;
  text: string;
  date: Temporal.PlainDate;
  /** A time written right after the date, if any. */
  time: Temporal.PlainTime | null;
}

// A time after a date: "24/10/2026 14:30", "24/10/2026 at 14:30", "24/10/2026, 14:30".
const TIME = String.raw`(?:(?:\s+(?:at\s+|kl\.?\s*)?|,\s*)(\d{1,2}):(\d{2})(?!\d))?`;
// Day first, as the app writes dates: 24/10/2026, 24.10.2026, 24-10-2026.
const DAY_FIRST = String.raw`(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(?!\d|[/.-]\d)` + TIME;
// ISO: 2026-10-24, 2026-10-24T14:30.
const ISO = String.raw`(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?(?!\d)`;
const PATTERN = new RegExp(`${DAY_FIRST}|${ISO}`, "g");

function plainDate(year: number, month: number, day: number): Temporal.PlainDate | null {
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  } catch {
    return null;
  }
}

function plainTime(hour: string | undefined, minute: string | undefined): Temporal.PlainTime | null {
  if (hour === undefined || minute === undefined) return null;
  try {
    return Temporal.PlainTime.from({ hour: Number(hour), minute: Number(minute) }, { overflow: "reject" });
  } catch {
    return null;
  }
}

/** Every real date written in `text`, in order. Impossible dates like 31/02/2026 are left out. */
export function findDateMentions(text: string): DateMention[] {
  const found: DateMention[] = [];
  for (const m of text.matchAll(PATTERN)) {
    const dayFirst = m[1] !== undefined;
    const date = dayFirst
      ? plainDate(Number(m[4]), Number(m[3]), Number(m[1]))
      : plainDate(Number(m[7]), Number(m[8]), Number(m[9]));
    if (!date) continue;
    let time = dayFirst ? plainTime(m[5], m[6]) : plainTime(m[10], m[11]);
    let matched = m[0];
    if (!time && /\d:\d\d$/.test(matched)) {
      // A time that doesn't exist, like 25:00, isn't part of the date.
      matched = dayFirst ? `${m[1]}${m[2]}${m[3]}${m[2]}${m[4]}` : `${m[7]}-${m[8]}-${m[9]}`;
      time = null;
    }
    found.push({ start: m.index, end: m.index + matched.length, text: matched, date, time });
  }
  return found;
}

/** The text a page uses for a date: 24/10/2026. */
export function writeDate(date: Temporal.PlainDate): string {
  return formatDate(date);
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * The date a typed shortcut stands for, or null. Shortcuts are what follows
 * an @: today, tomorrow, yesterday, a weekday (the next one, never today),
 * +3 or 3d (days from today), 2w (weeks), 1m (months), or a day and month
 * like 24/10 (this year, or next year once it has passed).
 */
export function expandDateShortcut(word: string, today: Temporal.PlainDate): Temporal.PlainDate | null {
  const w = word.toLowerCase();
  if (w === "today" || w === "tod") return today;
  if (w === "tomorrow" || w === "tom" || w === "tmrw") return today.add({ days: 1 });
  if (w === "yesterday") return today.subtract({ days: 1 });
  const weekday = WEEKDAYS.findIndex((d) => w.length >= 3 && fullDay(d).startsWith(w));
  if (weekday >= 0) {
    const ahead = (weekday + 1 - today.dayOfWeek + 7) % 7 || 7;
    return today.add({ days: ahead });
  }
  const offset = /^\+?(\d{1,3})([dwm]?)$/.exec(w);
  if (offset && (offset[2] || w.startsWith("+"))) {
    const n = Number(offset[1]);
    const unit = offset[2] === "w" ? { weeks: n } : offset[2] === "m" ? { months: n } : { days: n };
    return today.add(unit);
  }
  const dm = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?$/.exec(w);
  if (dm) {
    const year = dm[3] ? Number(dm[3]) : today.year;
    const date = plainDate(year, Number(dm[2]), Number(dm[1]));
    if (!date) return null;
    if (!dm[3] && Temporal.PlainDate.compare(date, today) < 0) return plainDate(year + 1, Number(dm[2]), Number(dm[1]));
    return date;
  }
  return null;
}

function fullDay(short: string): string {
  return {
    mon: "monday",
    tue: "tuesday",
    wed: "wednesday",
    thu: "thursday",
    fri: "friday",
    sat: "saturday",
    sun: "sunday",
  }[short]!;
}

/**
 * Called after a space or new line is typed at `cursor`: turns an @shortcut
 * just before it into a written date. Returns the new text and cursor, or null.
 */
export function expandShortcutBeforeCursor(
  value: string,
  cursor: number,
  today: Temporal.PlainDate,
): { value: string; cursor: number } | null {
  if (cursor < 1 || !/\s/.test(value[cursor - 1])) return null;
  const m = /(^|\s)@([^\s@]+)$/.exec(value.slice(0, cursor - 1));
  if (!m) return null;
  const date = expandDateShortcut(m[2], today);
  if (!date) return null;
  const start = cursor - 1 - m[2].length - 1;
  const written = writeDate(date);
  return {
    value: value.slice(0, start) + written + value.slice(cursor - 1),
    cursor: start + written.length + 1,
  };
}

/** The line of `text` that mentions `date`, for a reminder's notification, or null. */
export function lineMentioning(text: string, date: Temporal.PlainDate): string | null {
  for (const line of text.split("\n")) {
    if (findDateMentions(line).some((m) => m.date.equals(date)))
      return line.trim().replace(/^([-*]|\d+\.)\s+(\[[ xX]\]\s+)?/, "");
  }
  return null;
}
