import { beforeEach, expect, it } from "vitest";
import { CalendarRepository } from "../src/db/calendars";
import { EventRepository } from "../src/db/events";
import { dueReminders } from "../src/time/reminders";
import { Temporal } from "../src/time/temporal";
import { createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const instant = Temporal.Instant.from;
let events: EventRepository;

beforeEach(async () => {
  const db = createTestDriver();
  events = new EventRepository(db);
  const calendarId = (await new CalendarRepository(db).create({ name: "Work" })).id;
  await events.create({
    calendarId,
    title: "Standup",
    rule: "FREQ=DAILY",
    reminders: [10, 60],
    timing: {
      allDay: false,
      start: Temporal.PlainDateTime.from("2026-10-19T09:00"),
      end: Temporal.PlainDateTime.from("2026-10-19T09:15"),
      timeZone: ZONE,
    },
  });
});

async function due(since: string, until: string) {
  const occurrences = await events.occurrencesInRange(
    instant(since),
    instant(until).add({ hours: 2 }),
    ZONE,
  );
  return dueReminders(occurrences, instant(since), instant(until), ZONE).map(
    (r) => `${r.occurrenceKey} -${r.minutesBefore}m`,
  );
}

it("fires each reminder once across consecutive checks", async () => {
  // 20 October 09:00 Stockholm is 07:00Z; reminders at 06:00Z and 06:50Z.
  expect(await due("2026-10-20T05:59Z", "2026-10-20T06:00Z")).toEqual(["2026-10-20T09:00:00 -60m"]);
  expect(await due("2026-10-20T06:00Z", "2026-10-20T06:30Z")).toEqual([]);
  expect(await due("2026-10-20T06:30Z", "2026-10-20T07:00Z")).toEqual(["2026-10-20T09:00:00 -10m"]);
});

it("catches up on reminders missed while a check was late", async () => {
  expect(await due("2026-10-20T05:00Z", "2026-10-20T07:00Z")).toEqual([
    "2026-10-20T09:00:00 -60m",
    "2026-10-20T09:00:00 -10m",
  ]);
});

it("uses the local time after a daylight saving change", async () => {
  // 26 October 09:00 Stockholm is 08:00Z (winter time).
  expect(await due("2026-10-26T07:49Z", "2026-10-26T07:50Z")).toEqual(["2026-10-26T09:00:00 -10m"]);
});
