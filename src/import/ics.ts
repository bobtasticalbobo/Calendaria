import ICAL from "ical.js";
import { findIana } from "windows-iana";
import { Temporal } from "../time/temporal";
import { type EventTiming, isValidTimeZone, toZoned } from "../time/timing";

/** One event read from an .ics file, ready to save. */
export interface ImportedEvent {
  /** The file's UID, plus `#<occurrence>` for a changed occurrence of a series. */
  sourceUid: string;
  title: string;
  description: string;
  location: string;
  timing: EventTiming;
  rule: string | null;
  exdates: string[];
  reminders: number[];
}

export interface ParsedCalendar {
  name: string | null;
  events: ImportedEvent[];
  /** Things that couldn't be imported exactly, in plain words. */
  warnings: string[];
}

type IcalTime = ICAL.Time;

function plainDateTime(t: IcalTime): Temporal.PlainDateTime {
  return new Temporal.PlainDateTime(t.year, t.month, t.day, t.hour, t.minute, t.second);
}

function plainDate(t: IcalTime): Temporal.PlainDate {
  return new Temporal.PlainDate(t.year, t.month, t.day);
}

class Parser {
  readonly warnings = new Set<string>();

  constructor(private readonly defaultZone: string) {}

  /**
   * Maps a TZID to an IANA zone. Outlook writes Windows zone names such as
   * "W. Europe Standard Time"; those are mapped with the CLDR table.
   */
  zone(tzid: string | null): string {
    if (!tzid) return this.defaultZone;
    const name = tzid.replace(/^"|"$/g, "").trim();
    if (isValidTimeZone(name)) return name;
    const iana = findIana(name)?.[0];
    if (iana && isValidTimeZone(iana)) return iana;
    this.warnings.add(`Unknown time zone "${name}"; used ${this.defaultZone} instead.`);
    return this.defaultZone;
  }

  /** The exact instant of a date-time property value. */
  instant(prop: ICAL.Property, value: IcalTime): Temporal.Instant {
    if (value.zone?.tzid === "UTC") {
      return Temporal.Instant.from(`${plainDateTime(value).toString()}Z`);
    }
    return toZoned(plainDateTime(value), this.zone(prop.getParameter("tzid") as string | null)).toInstant();
  }

  /** Where a date-time property value falls on the wall clock in `zone`. */
  wallClock(prop: ICAL.Property, value: IcalTime, zone: string): Temporal.PlainDateTime {
    return this.instant(prop, value).toZonedDateTimeISO(zone).toPlainDateTime();
  }

  timing(vevent: ICAL.Component): EventTiming {
    const startProp = vevent.getFirstProperty("dtstart");
    if (!startProp) throw new Error("Event has no start");
    const start = startProp.getFirstValue() as IcalTime;
    const endProp = vevent.getFirstProperty("dtend");
    const end = endProp?.getFirstValue() as IcalTime | undefined;
    const duration = vevent.getFirstPropertyValue("duration") as ICAL.Duration | null;

    if (start.isDate) {
      const startDate = plainDate(start);
      let endDate = end ? plainDate(end) : null;
      if (!endDate && duration) endDate = startDate.add({ days: Math.round(duration.toSeconds() / 86400) });
      if (!endDate || Temporal.PlainDate.compare(endDate, startDate) <= 0) endDate = startDate.add({ days: 1 });
      return { allDay: true, start: startDate, end: endDate };
    }

    // UTC and floating times are shown in the importer's own zone.
    const tzid = startProp.getParameter("tzid") as string | null;
    const zone = tzid ? this.zone(tzid) : this.defaultZone;
    const startLocal = this.wallClock(startProp, start, zone);
    let endLocal = startLocal;
    if (endProp && end && !end.isDate) endLocal = this.wallClock(endProp, end, zone);
    else if (duration) {
      endLocal = toZoned(startLocal, zone).add({ seconds: duration.toSeconds() }).toPlainDateTime();
    }
    if (Temporal.PlainDateTime.compare(endLocal, startLocal) < 0) endLocal = startLocal;
    return { allDay: false, start: startLocal, end: endLocal, timeZone: zone };
  }

  /** The occurrence key (see `occurrenceKey`) that a date in a series refers to. */
  occurrenceKey(prop: ICAL.Property, value: IcalTime, series: EventTiming): string {
    if (series.allDay) return plainDate(value).toString();
    if (value.isDate) return plainDate(value).toPlainDateTime(series.start.toPlainTime()).toString();
    return this.wallClock(prop, value, series.timeZone).toString();
  }

  reminders(vevent: ICAL.Component): number[] {
    const minutes: number[] = [];
    for (const alarm of vevent.getAllSubcomponents("valarm")) {
      const trigger = alarm.getFirstProperty("trigger");
      const value = trigger?.getFirstValue();
      const related = trigger?.getParameter("related");
      if (!(value instanceof ICAL.Duration) || (related && related !== "START")) {
        this.warnings.add("Some reminders weren't relative to the start time and were skipped.");
        continue;
      }
      const before = -value.toSeconds() / 60;
      if (before >= 0) minutes.push(Math.round(before));
    }
    return minutes;
  }

  rule(vevent: ICAL.Component): string | null {
    const rules = vevent.getAllProperties("rrule");
    if (rules.length > 1) this.warnings.add("Some events had more than one repeat rule; only the first was kept.");
    if (vevent.getFirstProperty("rdate")) {
      this.warnings.add("Extra one-off dates (RDATE) on repeating events aren't supported yet and were skipped.");
    }
    return rules.length ? String(rules[0].getFirstValue()) : null;
  }

  event(vevent: ICAL.Component, sourceUid: string): ImportedEvent {
    return {
      sourceUid,
      title: String(vevent.getFirstPropertyValue("summary") ?? ""),
      description: String(vevent.getFirstPropertyValue("description") ?? ""),
      location: String(vevent.getFirstPropertyValue("location") ?? ""),
      timing: this.timing(vevent),
      rule: this.rule(vevent),
      exdates: [],
      reminders: this.reminders(vevent),
    };
  }
}

function isCancelled(vevent: ICAL.Component): boolean {
  return String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

/**
 * Reads the events from an iCalendar (.ics) file, such as an Outlook export.
 * Changed occurrences of a repeating event become separate events and are
 * removed from the series, matching how the editor stores them.
 */
export function parseIcs(text: string, defaultZone: string): ParsedCalendar {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (e) {
    throw new Error(`This doesn't look like a calendar (.ics) file: ${e instanceof Error ? e.message : e}`);
  }
  const parser = new Parser(defaultZone);
  const events: ImportedEvent[] = [];
  let skipped = 0;

  // Group the series and its changed occurrences by UID.
  const byUid = new Map<string, ICAL.Component[]>();
  root.getAllSubcomponents("vevent").forEach((vevent, i) => {
    const uid = String(vevent.getFirstPropertyValue("uid") ?? `no-uid-${i}`);
    byUid.set(uid, [...(byUid.get(uid) ?? []), vevent]);
  });

  for (const [uid, components] of byUid) {
    const master = components.find((c) => !c.getFirstProperty("recurrence-id"));
    const overrides = components.filter((c) => c.getFirstProperty("recurrence-id"));
    try {
      let series: ImportedEvent | null = null;
      if (master && !isCancelled(master)) {
        series = parser.event(master, uid);
        if (series.rule) {
          for (const prop of master.getAllProperties("exdate")) {
            for (const value of prop.getValues() as IcalTime[]) {
              series.exdates.push(parser.occurrenceKey(prop, value, series.timing));
            }
          }
        }
        events.push(series);
      }
      for (const override of overrides) {
        const prop = override.getFirstProperty("recurrence-id")!;
        const value = prop.getFirstValue() as IcalTime;
        const key = series ? parser.occurrenceKey(prop, value, series.timing) : value.toString();
        if (series?.rule && !series.exdates.includes(key)) series.exdates.push(key);
        if (!isCancelled(override)) {
          events.push({ ...parser.event(override, `${uid}#${key}`), rule: null });
        }
      }
    } catch (e) {
      skipped++;
      console.warn(`Skipped event ${uid}`, e);
    }
  }

  if (skipped) parser.warnings.add(`${skipped} event${skipped === 1 ? "" : "s"} couldn't be read and were skipped.`);
  const name = root.getFirstPropertyValue("x-wr-calname");
  return { name: name ? String(name) : null, events, warnings: [...parser.warnings] };
}
