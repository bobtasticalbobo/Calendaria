import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CalendarRepository } from "../src/db/calendars";
import type { SqlDriver } from "../src/db/driver";
import { EventRepository } from "../src/db/events";
import { NoteRepository } from "../src/db/notes";
import { SettingsRepository } from "../src/db/settings";
import { TagRepository } from "../src/db/tags";
import { importIcs } from "../src/import/importCalendar";
import { GistStore, SyncError } from "../src/sync/gist";
import type { Snapshot } from "../src/sync/merge";
import { connect, syncOnce } from "../src/sync/sync";
import { Temporal } from "../src/time/temporal";
import { createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const outlook = readFileSync(join(import.meta.dirname, "fixtures/outlook.ics"), "utf8");

/** Stands in for GitHub: one account's gists, kept as JSON text like the real file. */
class FakeGists {
  gists = new Map<string, string>();
  writes = 0;
  store = () =>
    ({
      find: async () => this.gists.keys().next().value ?? null,
      create: async (s: Snapshot) => {
        const id = `gist${this.gists.size + 1}`;
        this.gists.set(id, JSON.stringify(s));
        return id;
      },
      read: async (id: string) => {
        const content = this.gists.get(id);
        if (content === undefined) throw new SyncError("not found");
        return JSON.parse(content) as Snapshot;
      },
      write: async (id: string, s: Snapshot) => {
        this.writes++;
        this.gists.set(id, JSON.stringify(s));
      },
    }) as unknown as GistStore;
}

/** Shared time across devices, moved forward a second at each read. */
let now = Date.parse("2026-10-20T12:00:00Z");
const clock = () => new Date((now += 1000));

class Device {
  db: SqlDriver = createTestDriver();
  settings = new SettingsRepository(this.db);
  calendars = new CalendarRepository(this.db, clock);
  events = new EventRepository(this.db, clock);
  notes = new NoteRepository(this.db, clock);
  tags = new TagRepository(this.db, clock);

  constructor(private readonly github: FakeGists) {}

  async start() {
    await this.calendars.ensureDefault();
    await connect(this.settings, "key");
    return this;
  }

  sync() {
    return syncOnce(this.db, this.settings, this.github.store, clock);
  }

  async eventTitles() {
    const range = await this.events.occurrencesInRange(
      Temporal.Instant.from("2026-01-01T00:00Z"),
      Temporal.Instant.from("2027-12-31T00:00Z"),
      ZONE,
    );
    return [...new Set(range.map((o) => o.event.title))].sort();
  }
}

function meeting(calendarId: string, title: string) {
  return {
    calendarId,
    title,
    timing: {
      allDay: false as const,
      start: Temporal.PlainDateTime.from("2026-10-21T10:00"),
      end: Temporal.PlainDateTime.from("2026-10-21T11:00"),
      timeZone: ZONE,
    },
  };
}

describe("sync between devices", () => {
  let github: FakeGists;
  let laptop: Device;
  let pc: Device;

  beforeEach(async () => {
    github = new FakeGists();
    laptop = await new Device(github).start();
    pc = await new Device(github).start();
  });

  it("brings the laptop's calendar to the PC", async () => {
    const [personal] = await laptop.calendars.list();
    await laptop.events.create(meeting(personal.id, "Dentist"));
    await laptop.notes.create({ day: Temporal.PlainDate.from("2026-10-21"), body: "Bring card" });

    await laptop.sync();
    expect(await pc.sync()).toBe(true);

    expect(await pc.eventTitles()).toEqual(["Dentist"]);
    const notes = await pc.notes.listOnDays(Temporal.PlainDate.from("2026-10-21"), Temporal.PlainDate.from("2026-10-21"));
    expect(notes.map((n) => n.body)).toEqual(["Bring card"]);
  });

  it("merges each device's own Personal calendar into one", async () => {
    await laptop.events.create(meeting((await laptop.calendars.list())[0].id, "From laptop"));
    await pc.events.create(meeting((await pc.calendars.list())[0].id, "From PC"));

    await laptop.sync();
    await pc.sync();
    await laptop.sync();

    for (const device of [laptop, pc]) {
      expect((await device.calendars.list()).map((c) => c.name)).toEqual(["Personal"]);
      expect(await device.eventTitles()).toEqual(["From PC", "From laptop"]);
    }
  });

  it("keeps one copy of events both devices imported from Outlook", async () => {
    await importIcs(outlook, laptop, ZONE);
    await importIcs(outlook, pc, ZONE);
    const titles = await laptop.eventTitles();

    await laptop.sync();
    await pc.sync();
    await laptop.sync();

    for (const device of [laptop, pc]) {
      const calendars = await device.calendars.list();
      expect(calendars.map((c) => c.name).sort()).toEqual(["Outlook", "Personal"]);
      const outlookEvents = await device.db.select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL AND calendar_id = $1",
        [calendars.find((c) => c.name === "Outlook")!.id],
      );
      expect(outlookEvents[0].n).toBe(6);
      expect(await device.eventTitles()).toEqual(titles);
    }
    // Importing again afterwards still updates rather than duplicating.
    const again = await importIcs(outlook, pc, ZONE);
    expect(again.created).toBe(0);
  });

  it("spreads edits and deletions, newest change winning", async () => {
    const [personal] = await laptop.calendars.list();
    const event = await laptop.events.create(meeting(personal.id, "Lunch"));
    await laptop.sync();
    await pc.sync();

    await pc.events.update(event.id, meeting(personal.id, "Lunch with Sam"));
    await pc.sync();
    await laptop.sync();
    expect(await laptop.eventTitles()).toEqual(["Lunch with Sam"]);

    // A deletion followed by a later edit elsewhere: the edit is newer, so it stays.
    await laptop.events.remove(event.id);
    await pc.events.update(event.id, meeting(personal.id, "Later edit"));
    await laptop.sync();
    await pc.sync();
    await laptop.sync();
    expect(await laptop.eventTitles()).toEqual(["Later edit"]);
    expect(await pc.eventTitles()).toEqual(["Later edit"]);
  });

  it("deletes on one device reach the other", async () => {
    const [personal] = await laptop.calendars.list();
    const event = await laptop.events.create(meeting(personal.id, "Cancelled"));
    await laptop.sync();
    await pc.sync();
    await laptop.events.remove(event.id);
    await laptop.sync();
    await pc.sync();
    expect(await pc.eventTitles()).toEqual([]);
  });

  it("syncs tags on days and notes", async () => {
    const exam = await laptop.tags.create({ name: "Exam", color: "#e06c75" });
    const day = Temporal.PlainDate.from("2026-10-21");
    await laptop.tags.setOnDay(day, exam.id, true);
    await laptop.notes.create({ day, body: "Revise", tags: [exam.id] });
    await laptop.sync();
    await pc.sync();

    expect(await pc.tags.onDays(day, day)).toEqual(new Map([["2026-10-21", [exam.id]]]));
    const [note] = await pc.notes.listOnDays(day, day);
    expect(note.tags).toEqual([exam.id]);

    // Untagging on the PC reaches the laptop.
    await pc.tags.setOnDay(day, exam.id, false);
    await pc.sync();
    await laptop.sync();
    expect(await laptop.tags.onDays(day, day)).toEqual(new Map());
  });

  it("only writes to GitHub when something changed", async () => {
    await laptop.sync();
    await pc.sync();
    await laptop.sync();
    const writes = github.writes;
    await laptop.sync();
    await pc.sync();
    expect(github.writes).toBe(writes);
  });

  it("does nothing until a key is set", async () => {
    const fresh = new Device(github);
    expect(await fresh.sync()).toBe(false);
    expect(github.gists.size).toBe(0);
  });
});
