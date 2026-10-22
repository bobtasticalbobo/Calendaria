import type { TaskEvent, TaskFields } from "../db/tasks";
import { Temporal } from "../time/temporal";
import { APP_LOCALE, formatDate } from "../ui/dates";

export type StatsRange = "week" | "month" | "year" | "all";

export interface StatsItem extends TaskFields {
  id: string;
}

export interface StatsInput {
  events: TaskEvent[];
  /** Live notebooks, chapters and pages, for what's open now. */
  items: StatsItem[];
  /** The notebook a task is in, or null if it's gone. */
  notebookOf: (itemId: string) => string | null;
  now: Temporal.ZonedDateTime;
  range: StatsRange;
}

export interface Bucket {
  label: string;
  count: number;
}

export interface Completion {
  event: TaskEvent;
  /** Ticked after its deadline day. */
  late: boolean;
}

export interface TaskStats {
  done: number;
  made: number;
  openNow: number;
  overdueNow: number;
  onTime: number;
  late: number;
  /** Average days from becoming a task to being ticked, or null when nothing has both. */
  averageDays: number | null;
  /** Days in a row, up to today, with at least one task ticked. Today not done yet doesn't break it. */
  streak: number;
  bestStreak: number;
  perPeriod: Bucket[];
  /** Completions by weekday (Monday first) and hour. */
  heat: number[][];
  byNotebook: { notebookId: string | null; count: number }[];
  /** Tasks answered "Not yet" most often, in the range. */
  putOff: { itemId: string; title: string; count: number }[];
  recent: Completion[];
}

function localDay(at: Temporal.Instant, zone: string): Temporal.PlainDate {
  return at.toZonedDateTimeISO(zone).toPlainDate();
}

/** The first day the range covers, or null for all time. */
export function rangeStart(range: StatsRange, today: Temporal.PlainDate): Temporal.PlainDate | null {
  if (range === "week") return today.subtract({ days: 6 });
  if (range === "month") return today.subtract({ days: 29 });
  if (range === "year") return today.with({ day: 1 }).subtract({ months: 11 });
  return null;
}

function monthLabel(month: Temporal.PlainYearMonth, withYear: boolean): string {
  return month
    .toPlainDate({ day: 1 })
    .toLocaleString(APP_LOCALE, { month: "short", ...(withYear && { year: "2-digit" }) });
}

/** Counts by day for a week or month, by month for a year or all time. */
function periods(
  range: StatsRange,
  today: Temporal.PlainDate,
  first: Temporal.PlainDate | null,
  days: Temporal.PlainDate[],
): Bucket[] {
  if (range === "week" || range === "month") {
    const start = rangeStart(range, today)!;
    const length = range === "week" ? 7 : 30;
    return Array.from({ length }, (_, i) => {
      const day = start.add({ days: i });
      return {
        label: range === "week" ? day.toLocaleString(APP_LOCALE, { weekday: "short" }) : formatDate(day, false),
        count: days.filter((d) => d.equals(day)).length,
      };
    });
  }
  const end = today.toPlainYearMonth();
  let month = range === "year" ? end.subtract({ months: 11 }) : (first ?? today).toPlainYearMonth();
  const buckets: Bucket[] = [];
  const spansYears = month.year !== end.year;
  while (Temporal.PlainYearMonth.compare(month, end) <= 0) {
    const m = month;
    buckets.push({
      label: monthLabel(m, spansYears),
      count: days.filter((d) => d.year === m.year && d.month === m.month).length,
    });
    month = month.add({ months: 1 });
  }
  return buckets;
}

function streaks(doneDays: Set<string>, today: Temporal.PlainDate): { current: number; best: number } {
  let current = 0;
  let day = doneDays.has(today.toString()) ? today : today.subtract({ days: 1 });
  while (doneDays.has(day.toString())) {
    current++;
    day = day.subtract({ days: 1 });
  }
  let best = 0;
  for (const d of doneDays) {
    const date = Temporal.PlainDate.from(d);
    if (doneDays.has(date.subtract({ days: 1 }).toString())) continue;
    let run = 0;
    for (let x = date; doneDays.has(x.toString()); x = x.add({ days: 1 })) run++;
    best = Math.max(best, run);
  }
  return { current, best };
}

export function computeStats({ events, items, notebookOf, now, range }: StatsInput): TaskStats {
  const zone = now.timeZoneId;
  const today = now.toPlainDate();
  const start = rangeStart(range, today);
  const inRange = (e: TaskEvent) => !start || Temporal.PlainDate.compare(localDay(e.at, zone), start) >= 0;

  const allDone = events.filter((e) => e.kind === "done");
  const done = allDone.filter(inRange);
  const doneDays = done.map((e) => localDay(e.at, zone));

  const completions: Completion[] = done.map((event) => ({
    event,
    late: !!event.dueDay && Temporal.PlainDate.compare(localDay(event.at, zone), event.dueDay) > 0,
  }));
  const withDeadline = completions.filter((c) => c.event.dueDay);

  // Time to finish: from the latest "made" before each completion of the same task.
  const spans: number[] = [];
  for (const e of done) {
    const made = events
      .filter((m) => m.kind === "made" && m.itemId === e.itemId && Temporal.Instant.compare(m.at, e.at) <= 0)
      .at(-1);
    if (made) spans.push(e.at.since(made.at).total({ unit: "hours" }) / 24);
  }

  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const e of done) {
    const z = e.at.toZonedDateTimeISO(zone);
    heat[z.dayOfWeek - 1][z.hour]++;
  }

  const byNotebook = new Map<string | null, number>();
  for (const e of done) {
    const nb = notebookOf(e.itemId);
    byNotebook.set(nb, (byNotebook.get(nb) ?? 0) + 1);
  }

  const putOff = new Map<string, { itemId: string; title: string; count: number }>();
  for (const e of events.filter((x) => x.kind === "snoozed" && inRange(x))) {
    const entry = putOff.get(e.itemId) ?? { itemId: e.itemId, title: e.title, count: 0 };
    entry.count++;
    entry.title = e.title;
    putOff.set(e.itemId, entry);
  }

  const open = items.filter((i) => i.task && !i.doneAt);
  const earliest = events.reduce<Temporal.Instant | null>(
    (min, e) => (!min || Temporal.Instant.compare(e.at, min) < 0 ? e.at : min),
    null,
  );
  const first = earliest && localDay(earliest, zone);
  const { current, best } = streaks(new Set(allDone.map((e) => localDay(e.at, zone).toString())), today);

  return {
    done: done.length,
    made: events.filter((e) => e.kind === "made" && inRange(e)).length,
    openNow: open.length,
    overdueNow: open.filter((i) => i.dueDay && Temporal.PlainDate.compare(i.dueDay, today) < 0).length,
    onTime: withDeadline.filter((c) => !c.late).length,
    late: withDeadline.filter((c) => c.late).length,
    averageDays: spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : null,
    streak: current,
    bestStreak: best,
    perPeriod: periods(range, today, first, doneDays),
    heat,
    byNotebook: [...byNotebook].map(([notebookId, count]) => ({ notebookId, count })).sort((a, b) => b.count - a.count),
    putOff: [...putOff.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    recent: [...completions].reverse().slice(0, 15),
  };
}

/** 2 hours, 3 days: how long tasks take. */
export function describeDays(days: number): string {
  if (days < 1 / 24) return "under an hour";
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}
