import { beforeEach, describe, expect, it } from "vitest";
import { NoteRepository } from "../src/db/notes";
import { TagRepository } from "../src/db/tags";
import { Temporal } from "../src/time/temporal";
import { createTestDriver } from "./sqliteDriver";

const date = Temporal.PlainDate.from;
const week = [date("2026-10-19"), date("2026-10-25")] as const;

describe("TagRepository", () => {
  let tags: TagRepository;
  let notes: NoteRepository;

  beforeEach(() => {
    const db = createTestDriver();
    tags = new TagRepository(db);
    notes = new NoteRepository(db);
  });

  it("creates, renames and deletes tags", async () => {
    const exam = await tags.create({ name: " Exam ", color: "#E06C75" });
    expect(exam).toMatchObject({ name: "Exam", color: "#e06c75" });
    await tags.update(exam.id, { name: "Exams" });
    expect((await tags.list()).map((t) => t.name)).toEqual(["Exams"]);
    await tags.remove(exam.id);
    expect(await tags.list()).toEqual([]);
  });

  it("rejects an empty name or a bad color", async () => {
    await expect(tags.create({ name: " ", color: "#ffffff" })).rejects.toThrow();
    await expect(tags.create({ name: "Trip", color: "blue" })).rejects.toThrow();
  });

  it("puts tags on days and takes them off again", async () => {
    const exam = await tags.create({ name: "Exam", color: "#e06c75" });
    const trip = await tags.create({ name: "Trip", color: "#7aa2f7" });
    await tags.setOnDay(date("2026-10-21"), exam.id, true);
    await tags.setOnDay(date("2026-10-21"), trip.id, true);
    await tags.setOnDay(date("2026-10-30"), trip.id, true);
    expect(await tags.onDays(...week)).toEqual(new Map([["2026-10-21", [exam.id, trip.id]]]));

    await tags.setOnDay(date("2026-10-21"), exam.id, false);
    expect(await tags.onDays(...week)).toEqual(new Map([["2026-10-21", [trip.id]]]));

    // Tagging again after removing comes back, at the end of the list.
    await tags.setOnDay(date("2026-10-21"), exam.id, true);
    expect(await tags.onDays(...week)).toEqual(new Map([["2026-10-21", [trip.id, exam.id]]]));
  });

  it("hides deleted tags from days", async () => {
    const exam = await tags.create({ name: "Exam", color: "#e06c75" });
    await tags.setOnDay(date("2026-10-21"), exam.id, true);
    await tags.remove(exam.id);
    expect(await tags.onDays(...week)).toEqual(new Map());
  });

  it("stores a note's tags", async () => {
    const exam = await tags.create({ name: "Exam", color: "#e06c75" });
    const note = await notes.create({ day: date("2026-10-21"), body: "Revise", tags: [exam.id, exam.id] });
    expect(note.tags).toEqual([exam.id]);
    expect((await notes.get(note.id))!.tags).toEqual([exam.id]);
    await notes.update(note.id, { tags: [] });
    expect((await notes.get(note.id))!.tags).toEqual([]);
  });
});
