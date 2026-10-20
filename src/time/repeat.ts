import { Temporal } from "./temporal";

/** The repeat choices offered in the event editor. */
export type RepeatFrequency =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "monthlyLast"
  | "yearly"
  /** A rule the editor can't express (e.g. imported); kept unchanged. */
  | "custom";

export type RepeatEnd =
  | { type: "never" }
  | { type: "on"; date: Temporal.PlainDate }
  | { type: "after"; count: number };

export interface RepeatChoice {
  frequency: RepeatFrequency;
  end: RepeatEnd;
}

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function isLastDayOfMonth(date: Temporal.PlainDate): boolean {
  return date.day === date.daysInMonth;
}

/** Frequencies that make sense for an event starting on `start`. */
export function repeatOptions(start: Temporal.PlainDate): RepeatFrequency[] {
  const options: RepeatFrequency[] = ["none", "daily", "weekdays", "weekly", "biweekly", "monthly"];
  if (isLastDayOfMonth(start)) options.push("monthlyLast");
  options.push("yearly");
  return options;
}

const BODIES: Record<Exclude<RepeatFrequency, "none" | "custom">, (start: Temporal.PlainDate) => string> = {
  daily: () => "FREQ=DAILY",
  weekdays: () => "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: (s) => `FREQ=WEEKLY;BYDAY=${WEEKDAYS[s.dayOfWeek - 1]}`,
  biweekly: (s) => `FREQ=WEEKLY;INTERVAL=2;BYDAY=${WEEKDAYS[s.dayOfWeek - 1]}`,
  monthly: (s) => `FREQ=MONTHLY;BYMONTHDAY=${s.day}`,
  monthlyLast: () => "FREQ=MONTHLY;BYMONTHDAY=-1",
  yearly: () => "FREQ=YEARLY",
};

function endPart(end: RepeatEnd, allDay: boolean): string {
  if (end.type === "after") return `;COUNT=${Math.max(1, Math.floor(end.count))}`;
  if (end.type === "on") {
    const d = end.date.toString().replace(/-/g, "");
    // Inclusive of the whole end date, in the event's own wall-clock time.
    return allDay ? `;UNTIL=${d}` : `;UNTIL=${d}T235959`;
  }
  return "";
}

/**
 * Builds the RRULE for a choice, or null for "none". "custom" returns
 * `existing` unchanged.
 */
export function buildRepeatRule(
  choice: RepeatChoice,
  start: Temporal.PlainDate,
  allDay: boolean,
  existing: string | null = null,
): string | null {
  if (choice.frequency === "none") return null;
  if (choice.frequency === "custom") return existing;
  return BODIES[choice.frequency](start) + endPart(choice.end, allDay);
}

/** Reads a stored rule back into an editor choice; anything unrecognised is "custom". */
export function parseRepeatRule(rule: string | null, start: Temporal.PlainDate): RepeatChoice {
  if (!rule) return { frequency: "none", end: { type: "never" } };
  const parts = rule.split(";");
  const count = parts.find((p) => p.startsWith("COUNT="));
  const until = parts.find((p) => p.startsWith("UNTIL="));
  const body = parts.filter((p) => !p.startsWith("COUNT=") && !p.startsWith("UNTIL=")).join(";");

  let end: RepeatEnd = { type: "never" };
  if (count) end = { type: "after", count: Number(count.slice(6)) };
  else if (until && /^UNTIL=\d{8}(T235959)?$/.test(until)) {
    const d = until.slice(6, 14);
    end = { type: "on", date: Temporal.PlainDate.from(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`) };
  } else if (until) {
    return { frequency: "custom", end };
  }

  for (const [frequency, make] of Object.entries(BODIES)) {
    if (make(start) === body) return { frequency: frequency as RepeatFrequency, end };
  }
  return { frequency: "custom", end };
}
