import { beforeEach, describe, expect, it } from "vitest";
import { NoteRepository } from "../src/db/notes";
import { Temporal } from "../src/time/temporal";
import { createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const date = Temporal.PlainDate.from;
const instant = Temporal.Instant.from;

describe("NoteRepository", () => {
  let notes: NoteRepository;

  beforeEach(() => {
    notes = new NoteRepository(createTestDriver());
  });

  it("stores and reads back a note exactly", async () => {
    const created = await notes.create({
      day: date("2026-10-20"),
      body: "Buy milk\nand eggs",
      color: "pink",
      remind: { at: Temporal.PlainDateTime.from("2026-10-20T17:30"), timeZone: ZONE },
    });
    expect(await notes.get(created.id)).toEqual(created);
  });

  it("lists notes on the given days only", async () => {
    await notes.create({ day: date("2026-10-19"), body: "before" });
    await notes.create({ day: date("2026-10-20"), body: "first" });
    await notes.create({ day: date("2026-10-26"), body: "last" });
    await notes.create({ day: date("2026-10-27"), body: "after" });
    const found = await notes.listOnDays(date("2026-10-20"), date("2026-10-26"));
    expect(found.map((n) => n.body)).toEqual(["first", "last"]);
  });

  it("finds reminders due in a window, in the reminder's own zone", async () => {
    await notes.create({
      day: date("2026-10-20"),
      body: "call",
      remind: { at: Temporal.PlainDateTime.from("2026-10-20T09:00"), timeZone: ZONE },
    });
    await notes.create({ day: date("2026-10-20"), body: "no reminder" });
    // 09:00 in Stockholm is 07:00 UTC in summer time.
    expect(await notes.remindersDue(instant("2026-10-20T06:59Z"), instant("2026-10-20T07:00Z"))).toHaveLength(1);
    expect(await notes.remindersDue(instant("2026-10-20T07:00Z"), instant("2026-10-20T08:00Z"))).toEqual([]);
  });

  it("moves the reminder along when a note is dragged to another day", async () => {
    const note = await notes.create({
      day: date("2026-10-20"),
      remind: { at: Temporal.PlainDateTime.from("2026-10-20T09:00"), timeZone: ZONE },
    });
    // Across the end of summer time: still 09:00 on the wall clock.
    const moved = await notes.moveToDay(note.id, date("2026-10-27"));
    expect(moved.day.toString()).toBe("2026-10-27");
    expect(moved.remind!.at.toString()).toBe("2026-10-27T09:00:00");
    expect(await notes.remindersDue(instant("2026-10-27T07:59Z"), instant("2026-10-27T08:00Z"))).toHaveLength(1);
  });

  it("clears a reminder", async () => {
    const note = await notes.create({
      day: date("2026-10-20"),
      remind: { at: Temporal.PlainDateTime.from("2026-10-20T09:00"), timeZone: ZONE },
    });
    await notes.update(note.id, { remind: null });
    expect((await notes.get(note.id))!.remind).toBeNull();
    expect(await notes.remindersDue(instant("2026-10-20T00:00Z"), instant("2026-10-21T00:00Z"))).toEqual([]);
  });

  it("soft-deletes notes", async () => {
    const note = await notes.create({ day: date("2026-10-20") });
    await notes.remove(note.id);
    expect((await notes.get(note.id))!.deletedAt).not.toBeNull();
    expect(await notes.listOnDays(date("2026-10-20"), date("2026-10-20"))).toEqual([]);
    await expect(notes.update(note.id, { body: "x" })).rejects.toThrow(/not found/);
  });
});
