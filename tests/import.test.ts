import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CalendarRepository } from "../src/db/calendars";
import { EventRepository } from "../src/db/events";
import { parseIcs } from "../src/import/ics";
import { importIcs } from "../src/import/importCalendar";
import { Temporal } from "../src/time/temporal";
import { timingBounds } from "../src/time/timing";
import { createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const outlook = readFileSync(join(import.meta.dirname, "fixtures/outlook.ics"), "utf8");

describe("parseIcs on an Outlook export", () => {
  const parsed = parseIcs(outlook, ZONE);
  const byTitle = (title: string) => parsed.events.find((e) => e.title === title)!;

  it("reads every event except cancelled ones", () => {
    expect(parsed.name).toBe("Calendar");
    expect(parsed.events.map((e) => e.title).sort()).toEqual([
      "Call with Seattle team",
      "Christmas",
      "Dentist",
      "Odd zone",
      "Weekly planning",
      "Weekly planning (moved)",
    ]);
  });

  it("maps Outlook's Windows time zone names to real zones", () => {
    expect(byTitle("Weekly planning").timing).toMatchObject({ timeZone: "Europe/Berlin" });
    expect(byTitle("Call with Seattle team").timing).toMatchObject({ timeZone: "America/Los_Angeles" });
  });

  it("keeps the repeat rule, deleted dates, changed occurrences and reminders", () => {
    const series = byTitle("Weekly planning");
    expect(series.rule).toContain("FREQ=WEEKLY");
    expect(series.location).toBe("Room 4");
    expect(series.description).toBe("Agenda:\nReview last week, plan this week\n");
    expect(series.reminders).toEqual([15]);
    expect(series.exdates.sort()).toEqual([
      "2026-10-12T09:00:00", // EXDATE
      "2026-10-19T09:00:00", // moved
      "2026-10-26T09:00:00", // cancelled
    ]);
    const moved = byTitle("Weekly planning (moved)");
    expect(moved.rule).toBeNull();
    expect(moved.timing.start.toString()).toBe("2026-10-19T10:30:00");
    expect(moved.sourceUid).toBe("040000008200E00074C5B7101A82E00800000000A0B1#2026-10-19T09:00:00");
  });

  it("reads all-day events as dates with an exclusive end", () => {
    const christmas = byTitle("Christmas");
    expect(christmas.timing).toEqual({
      allDay: true,
      start: Temporal.PlainDate.from("2026-12-24"),
      end: Temporal.PlainDate.from("2026-12-26"),
    });
    expect(christmas.reminders).toEqual([1080]);
  });

  it("shows UTC times in your own zone", () => {
    const dentist = byTitle("Dentist").timing;
    expect(dentist).toMatchObject({ timeZone: ZONE });
    expect(dentist.start.toString()).toBe("2026-10-22T16:00:00");
    expect(dentist.end.toString()).toBe("2026-10-22T17:00:00");
  });

  it("falls back to your zone for unknown zones and says so", () => {
    const odd = byTitle("Odd zone").timing;
    expect(odd).toMatchObject({ timeZone: ZONE });
    expect(odd.end.toString()).toBe("2026-10-23T09:45:00");
    expect(parsed.warnings).toEqual([`Unknown time zone "Mars Standard Time"; used ${ZONE} instead.`]);
  });

  it("rejects files that aren't calendars", () => {
    expect(() => parseIcs("hello", ZONE)).toThrow(/calendar/);
  });
});

describe("importIcs", () => {
  let calendars: CalendarRepository;
  let events: EventRepository;

  beforeEach(() => {
    const db = createTestDriver();
    calendars = new CalendarRepository(db);
    events = new EventRepository(db);
  });

  const occurrencesIn = async (from: string, to: string) =>
    (await events.occurrencesInRange(Temporal.Instant.from(from), Temporal.Instant.from(to), ZONE)).map(
      (o) => `${timingBounds(o.occurrence.timing, ZONE).start.toPlainDateTime().toString()} ${o.event.title}`,
    );

  it("puts Outlook's generically named export in an Outlook calendar", async () => {
    const summary = await importIcs(outlook, { calendars, events }, ZONE);
    expect(summary).toMatchObject({ calendarName: "Outlook", created: 6, updated: 0, skipped: 0 });
    expect((await calendars.list()).map((c) => c.name)).toEqual(["Outlook"]);
  });

  it("uses the file's own calendar name when it has one", async () => {
    const named = outlook.replace("X-WR-CALNAME:Calendar", "X-WR-CALNAME:Holidays");
    expect((await importIcs(named, { calendars, events }, ZONE)).calendarName).toBe("Holidays");
  });

  it("shows the series as Outlook does", async () => {
    await importIcs(outlook, { calendars, events }, ZONE);
    const planning = (await occurrencesIn("2026-10-01T00:00Z", "2026-11-30T00:00Z")).filter((o) =>
      o.includes("Weekly planning"),
    );
    // Berlin and Stockholm share a zone; UNTIL is 2 November 09:00 local.
    expect(planning).toEqual([
      "2026-10-05T09:00:00 Weekly planning",
      "2026-10-19T10:30:00 Weekly planning (moved)",
      "2026-11-02T09:00:00 Weekly planning",
    ]);
  });

  it("updates instead of duplicating when the same file is imported again", async () => {
    await importIcs(outlook, { calendars, events }, ZONE);
    const dentist = (await occurrencesIn("2026-10-22T00:00Z", "2026-10-23T00:00Z"))[0];
    expect(dentist).toBe("2026-10-22T16:00:00 Dentist");

    const changed = outlook.replace("SUMMARY:Dentist", "SUMMARY:Dentist (rebooked)");
    const again = await importIcs(changed, { calendars, events }, ZONE);
    expect(again).toMatchObject({ created: 0, updated: 6 });
    expect(await occurrencesIn("2026-10-22T00:00Z", "2026-10-23T00:00Z")).toEqual([
      "2026-10-22T16:00:00 Dentist (rebooked)",
    ]);
  });

  it("doesn't bring back events you deleted after importing", async () => {
    await importIcs(outlook, { calendars, events }, ZONE);
    const [dentist] = await events.occurrencesInRange(
      Temporal.Instant.from("2026-10-22T00:00Z"),
      Temporal.Instant.from("2026-10-23T00:00Z"),
      ZONE,
    );
    await events.remove(dentist.event.id);
    const again = await importIcs(outlook, { calendars, events }, ZONE);
    expect(again).toMatchObject({ created: 0, updated: 5, skipped: 1 });
    expect(await occurrencesIn("2026-10-22T00:00Z", "2026-10-23T00:00Z")).toEqual([]);
  });
});
