import { beforeEach, describe, expect, it } from "vitest";
import { CalendarRepository } from "../src/db/calendars";
import { type EventInput, EventRepository } from "../src/db/events";
import { Temporal } from "../src/time/temporal";
import { createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const instant = Temporal.Instant.from;

describe("EventRepository", () => {
  let events: EventRepository;
  let calendars: CalendarRepository;
  let calendarId: string;

  function input(overrides: Partial<EventInput> = {}): EventInput {
    return {
      calendarId,
      title: "Standup",
      timing: {
        allDay: false,
        start: Temporal.PlainDateTime.from("2026-10-19T09:00"),
        end: Temporal.PlainDateTime.from("2026-10-19T09:15"),
        timeZone: ZONE,
      },
      ...overrides,
    };
  }

  const keysBetween = async (from: string, to: string) =>
    (await events.occurrencesInRange(instant(from), instant(to), ZONE)).map(
      (o) => `${o.event.title} ${o.occurrence.key}`,
    );

  beforeEach(async () => {
    const db = createTestDriver();
    events = new EventRepository(db);
    calendars = new CalendarRepository(db);
    calendarId = (await calendars.create({ name: "Work" })).id;
  });

  it("stores and reads back an event exactly", async () => {
    const created = await events.create(
      input({ rule: "FREQ=WEEKLY;BYDAY=MO", reminders: [15, 5, 15], location: " Room 1 " }),
    );
    expect(created.reminders).toEqual([5, 15]);
    expect(created.location).toBe("Room 1");
    const read = await events.get(created.id);
    expect(read).toEqual(created);
    expect(read!.timing.start).toBeInstanceOf(Temporal.PlainDateTime);
  });

  it("stores all-day events as dates", async () => {
    const created = await events.create(
      input({
        title: "Holiday",
        timing: {
          allDay: true,
          start: Temporal.PlainDate.from("2026-12-24"),
          end: Temporal.PlainDate.from("2026-12-27"),
        },
      }),
    );
    expect(await events.get(created.id)).toEqual(created);
    expect(await keysBetween("2026-12-25T12:00Z", "2026-12-25T13:00Z")).toEqual(["Holiday 2026-12-24"]);
  });

  it("finds one-off and repeating events in a range", async () => {
    await events.create(input({ title: "Once" }));
    await events.create(input({ title: "Weekly", rule: "FREQ=WEEKLY" }));
    await events.create(input({ title: "Counted", rule: "FREQ=DAILY;COUNT=2" }));
    expect(await keysBetween("2026-10-19T00:00Z", "2026-10-21T00:00Z")).toEqual([
      "Once 2026-10-19T09:00:00",
      "Weekly 2026-10-19T09:00:00",
      "Counted 2026-10-19T09:00:00",
      "Counted 2026-10-20T09:00:00",
    ]);
    expect(await keysBetween("2027-03-01T00:00Z", "2027-03-02T00:00Z")).toEqual([
      "Weekly 2027-03-01T09:00:00",
    ]);
  });

  it("skips finished series without expanding them", async () => {
    await events.create(input({ title: "Counted", rule: "FREQ=DAILY;COUNT=2" }));
    expect(await events.listInRange(instant("2027-01-01T00:00Z"), instant("2027-02-01T00:00Z"))).toEqual(
      [],
    );
  });

  it("hides events of deleted calendars", async () => {
    await events.create(input());
    await calendars.remove(calendarId);
    expect(await keysBetween("2026-10-19T00:00Z", "2026-10-20T00:00Z")).toEqual([]);
  });

  it("rejects events in calendars that don't exist", async () => {
    await expect(events.create(input({ calendarId: "nope" }))).rejects.toThrow();
  });

  it("rejects invalid rules and reminders before writing", async () => {
    await expect(events.create(input({ rule: "FREQ=SOMETIMES" }))).rejects.toThrow();
    await expect(events.create(input({ reminders: [-5] }))).rejects.toThrow(/reminder/);
    expect(await keysBetween("2026-10-19T00:00Z", "2026-10-20T00:00Z")).toEqual([]);
  });

  it("removes a single occurrence", async () => {
    const series = await events.create(input({ rule: "FREQ=DAILY" }));
    await events.removeOccurrence(series.id, "2026-10-20T09:00:00");
    expect(await keysBetween("2026-10-19T00:00Z", "2026-10-22T00:00Z")).toEqual([
      "Standup 2026-10-19T09:00:00",
      "Standup 2026-10-21T09:00:00",
    ]);
  });

  it("moves a single occurrence out of its series", async () => {
    const series = await events.create(input({ rule: "FREQ=DAILY" }));
    await events.detachOccurrence(
      series.id,
      "2026-10-20T09:00:00",
      input({
        title: "Late standup",
        timing: {
          allDay: false,
          start: Temporal.PlainDateTime.from("2026-10-20T11:00"),
          end: Temporal.PlainDateTime.from("2026-10-20T11:15"),
          timeZone: ZONE,
        },
      }),
    );
    expect(await keysBetween("2026-10-20T00:00Z", "2026-10-21T00:00Z")).toEqual([
      "Late standup 2026-10-20T11:00:00",
    ]);
  });

  it("keeps removed occurrences only while they still line up with the series", async () => {
    const series = await events.create(input({ rule: "FREQ=DAILY" }));
    await events.removeOccurrence(series.id, "2026-10-20T09:00:00");
    const renamed = await events.update(series.id, input({ title: "Daily", rule: "FREQ=DAILY" }));
    expect(renamed.recurrence!.exdates).toEqual(["2026-10-20T09:00:00"]);
    const moved = await events.update(
      series.id,
      input({
        rule: "FREQ=DAILY",
        timing: {
          allDay: false,
          start: Temporal.PlainDateTime.from("2026-10-19T08:45"),
          end: Temporal.PlainDateTime.from("2026-10-19T09:15"),
          timeZone: ZONE,
        },
      }),
    );
    expect(moved.recurrence!.exdates).toEqual([]);
  });

  it("soft-deletes events", async () => {
    const event = await events.create(input());
    await events.remove(event.id);
    expect((await events.get(event.id))!.deletedAt).not.toBeNull();
    expect(await keysBetween("2026-10-19T00:00Z", "2026-10-20T00:00Z")).toEqual([]);
    await expect(events.update(event.id, input())).rejects.toThrow(/not found/);
  });
});
