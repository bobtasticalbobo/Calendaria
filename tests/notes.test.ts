import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHAPTER_ID, DEFAULT_NOTEBOOK_ID, NotebookRepository } from "../src/db/notebooks";
import { NoteReminderRepository } from "../src/db/noteReminders";
import { NoteRepository } from "../src/db/notes";
import { Temporal } from "../src/time/temporal";
import { createPartlyMigratedDriver, createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const date = Temporal.PlainDate.from;
const at = Temporal.PlainDateTime.from;
const instant = Temporal.Instant.from;

let now = Date.parse("2026-10-22T12:00:00Z");
const clock = () => new Date((now += 1000));

describe("NoteRepository", () => {
  let notes: NoteRepository;
  let reminders: NoteReminderRepository;

  beforeEach(() => {
    const db = createTestDriver();
    notes = new NoteRepository(db, clock);
    reminders = new NoteReminderRepository(db, clock);
  });

  it("stores and reads back a page exactly", async () => {
    const created = await notes.create({ day: date("2026-10-20"), body: "Buy milk\nand eggs", color: "pink" });
    expect(await notes.get(created.id)).toEqual(created);
    expect(created.chapterId).toBe(DEFAULT_CHAPTER_ID);
  });

  it("keeps pages without a day off the calendar", async () => {
    await notes.create({ body: "Ideas" });
    await notes.create({ day: date("2026-10-20"), body: "On a day" });
    expect((await notes.listOnDays(date("2026-10-01"), date("2026-10-31"))).map((n) => n.body)).toEqual(["On a day"]);
    expect(await notes.list()).toHaveLength(2);
  });

  it("puts new pages at the end of their chapter", async () => {
    const a = await notes.create({ body: "a" });
    const b = await notes.create({ body: "b" });
    expect(b.position).toBeGreaterThan(a.position);
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
    const note = await notes.create({ body: "call" });
    await reminders.create(note.id, at("2026-10-20T09:00"), ZONE);
    // 09:00 in Stockholm is 07:00 UTC in summer time.
    expect(await reminders.due(instant("2026-10-20T06:59Z"), instant("2026-10-20T07:00Z"))).toHaveLength(1);
    expect(await reminders.due(instant("2026-10-20T07:00Z"), instant("2026-10-20T08:00Z"))).toEqual([]);
  });

  it("keeps several reminders on one page, and lists them by wall-clock day", async () => {
    const note = await notes.create({ body: "Trip\n24/10/2026 pack\n26/10/2026 fly" });
    await reminders.create(note.id, at("2026-10-24T09:00"), ZONE);
    await reminders.create(note.id, at("2026-10-26T06:30"), ZONE);
    expect((await reminders.onDays(date("2026-10-24"), date("2026-10-24"))).map((r) => r.at.toString())).toEqual([
      "2026-10-24T09:00:00",
    ]);
    expect(await reminders.onDays(date("2026-10-20"), date("2026-10-31"))).toHaveLength(2);
  });

  it("stops reminding once the page is deleted, and again after it's restored", async () => {
    const note = await notes.create({ body: "call" });
    await reminders.create(note.id, at("2026-10-20T09:00"), ZONE);
    const window = [instant("2026-10-20T00:00Z"), instant("2026-10-21T00:00Z")] as const;
    await notes.remove(note.id);
    expect(await reminders.due(...window)).toEqual([]);
    await notes.restore(note.id);
    expect(await reminders.due(...window)).toHaveLength(1);
  });

  it("moves reminders on the note's day along when it is dragged to another day", async () => {
    const note = await notes.create({ day: date("2026-10-20") });
    await reminders.create(note.id, at("2026-10-20T09:00"), ZONE);
    const other = await reminders.create(note.id, at("2026-11-02T10:00"), ZONE);
    // Across the end of summer time: still 09:00 on the wall clock.
    const moved = await notes.moveToDay(note.id, date("2026-10-27"));
    expect(moved.day?.toString()).toBe("2026-10-27");
    expect(await reminders.due(instant("2026-10-27T07:59Z"), instant("2026-10-27T08:00Z"))).toHaveLength(1);
    expect((await reminders.get(other.id))!.at.toString()).toBe("2026-11-02T10:00:00");
  });

  it("removes a reminder", async () => {
    const note = await notes.create({ body: "x" });
    const r = await reminders.create(note.id, at("2026-10-20T09:00"), ZONE);
    await reminders.remove(r.id);
    expect(await reminders.list()).toEqual([]);
  });

  it("soft-deletes pages into the trash and restores them", async () => {
    const note = await notes.create({ day: date("2026-10-20"), body: "keep me" });
    await notes.remove(note.id);
    expect((await notes.get(note.id))!.deletedAt).not.toBeNull();
    expect(await notes.listOnDays(date("2026-10-20"), date("2026-10-20"))).toEqual([]);
    await expect(notes.update(note.id, { body: "x" })).rejects.toThrow(/not found/);
    expect((await notes.listTrash()).map((n) => n.id)).toEqual([note.id]);
    const restored = await notes.restore(note.id);
    expect(restored.deletedAt).toBeNull();
    expect(await notes.listTrash()).toEqual([]);
  });

  it("pins and unlinks pages", async () => {
    const note = await notes.create({ day: date("2026-10-20"), body: "x" });
    const updated = await notes.update(note.id, { pinned: true, day: null });
    expect(updated.pinned).toBe(true);
    expect((await notes.get(note.id))!.day).toBeNull();
  });
});

describe("NotebookRepository", () => {
  let notebooks: NotebookRepository;
  let notes: NoteRepository;

  beforeEach(() => {
    const db = createTestDriver();
    notebooks = new NotebookRepository(db, clock);
    notes = new NoteRepository(db, clock);
  });

  it("starts with one notebook holding the day notes chapter", async () => {
    expect((await notebooks.listNotebooks()).map((n) => n.id)).toEqual([DEFAULT_NOTEBOOK_ID]);
    expect((await notebooks.listChapters()).map((c) => [c.id, c.notebookId, c.name])).toEqual([
      [DEFAULT_CHAPTER_ID, DEFAULT_NOTEBOOK_ID, "Day notes"],
    ]);
  });

  it("makes a notebook with a first chapter, in order", async () => {
    const { notebook, chapter } = await notebooks.createNotebook("Work");
    expect(notebook.position).toBeGreaterThan(0);
    expect(chapter.notebookId).toBe(notebook.id);
    const second = await notebooks.createChapter(notebook.id, "Meetings");
    expect(second.position).toBeGreaterThan(chapter.position);
    await notebooks.updateChapter(second.id, { name: "Standups" });
    expect((await notebooks.listChapters()).find((c) => c.id === second.id)!.name).toBe("Standups");
    await expect(notebooks.updateNotebook(notebook.id, { name: "  " })).rejects.toThrow(/empty/);
  });

  it("deleting a notebook moves its pages to the trash", async () => {
    const { notebook, chapter } = await notebooks.createNotebook("Old");
    const page = await notes.create({ chapterId: chapter.id, body: "gone" });
    const kept = await notes.create({ body: "kept" });
    await notebooks.removeNotebook(notebook.id);
    expect((await notebooks.listNotebooks()).map((n) => n.id)).toEqual([DEFAULT_NOTEBOOK_ID]);
    expect((await notes.list()).map((n) => n.id)).toEqual([kept.id]);
    expect((await notes.listTrash()).map((n) => n.id)).toEqual([page.id]);
    // Restored into the day notes chapter, since its own is gone.
    expect((await notes.restore(page.id, DEFAULT_CHAPTER_ID)).chapterId).toBe(DEFAULT_CHAPTER_ID);
  });

  it("won't delete the default notebook or chapter", async () => {
    await expect(notebooks.removeNotebook(DEFAULT_NOTEBOOK_ID)).rejects.toThrow();
    await expect(notebooks.removeChapter(DEFAULT_CHAPTER_ID)).rejects.toThrow();
  });
});

describe("migration 0008", () => {
  it("moves existing notes into the day notes chapter and keeps their reminders", async () => {
    const { driver, migrateRest } = createPartlyMigratedDriver(7);
    await driver.execute(
      `INSERT INTO notes (id, day, body, color, remind_local, remind_zone, remind_utc, tags, created_at, updated_at, deleted_at)
       VALUES ('n1', '2026-10-20', 'Dentist', 'pink', '2026-10-20T09:00:00', '${ZONE}', '2026-10-20T07:00:00.000Z', '[]',
               '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.000Z', NULL),
              ('n2', '2026-10-21', 'Plain', 'yellow', NULL, NULL, NULL, '["t"]',
               '2026-10-19T10:00:00.000Z', '2026-10-19T11:00:00.000Z', NULL)`,
    );
    migrateRest();
    const notes = new NoteRepository(driver);
    const reminders = new NoteReminderRepository(driver);
    const [dentist, plain] = await notes.list();
    expect(dentist).toMatchObject({ id: "n1", body: "Dentist", color: "pink", chapterId: DEFAULT_CHAPTER_ID });
    expect(dentist.day?.toString()).toBe("2026-10-20");
    expect(plain.tags).toEqual(["t"]);
    expect(plain.updatedAt).toBe("2026-10-19T11:00:00.000Z");
    const [r] = await reminders.list();
    expect(r).toMatchObject({ id: "n1/remind", noteId: "n1", timeZone: ZONE });
    expect(r.at.toString()).toBe("2026-10-20T09:00:00");
    expect(await reminders.due(instant("2026-10-20T06:59Z"), instant("2026-10-20T07:00Z"))).toHaveLength(1);
  });
});
