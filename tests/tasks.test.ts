import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHAPTER_ID, DEFAULT_NOTEBOOK_ID, NotebookRepository } from "../src/db/notebooks";
import { NoteRepository } from "../src/db/notes";
import { TaskRepository } from "../src/db/tasks";
import { describeDue, isVisible, latestNag, nagTimes, shouldNag } from "../src/notes/tasks";
import { Temporal } from "../src/time/temporal";
import { createTestDriver } from "./sqliteDriver";

const ZONE = "Europe/Stockholm";
const date = Temporal.PlainDate.from;
const at = (s: string) => Temporal.PlainDateTime.from(s).toZonedDateTime(ZONE);

let now = Date.parse("2026-10-22T12:00:00Z");
const clock = () => new Date((now += 1000));

describe("TaskRepository", () => {
  let tasks: TaskRepository;
  let notes: NoteRepository;
  let notebooks: NotebookRepository;

  beforeEach(() => {
    const db = createTestDriver();
    tasks = new TaskRepository(db, clock);
    notes = new NoteRepository(db, clock);
    notebooks = new NotebookRepository(db, clock);
  });

  it("makes a page a task, ticks it and unticks it", async () => {
    const page = await notes.create({ body: "Tankhead" });
    expect((await notes.get(page.id))!.task).toBe(false);
    await tasks.set("notes", page.id, { task: true });
    const ticked = await tasks.set("notes", page.id, { done: true });
    expect(ticked.doneAt).not.toBeNull();
    const read = (await notes.get(page.id))!;
    expect(read).toMatchObject({ task: true, doneAt: ticked.doneAt });
    // Ticking again keeps the first time.
    expect((await tasks.set("notes", page.id, { done: true })).doneAt).toBe(ticked.doneAt);
    expect((await tasks.set("notes", page.id, { done: false })).doneAt).toBeNull();
  });

  it("only ticks tasks, and clears everything when it stops being one", async () => {
    const page = await notes.create({ body: "x" });
    expect((await tasks.set("notes", page.id, { done: true })).doneAt).toBeNull();
    await tasks.set("notes", page.id, { dueDay: date("2026-10-30") });
    expect((await notes.get(page.id))!).toMatchObject({ task: true });
    await tasks.set("notes", page.id, { done: true });
    expect(await tasks.set("notes", page.id, { task: false })).toEqual({ task: false, doneAt: null, dueDay: null });
  });

  it("works on notebooks and chapters, and lists open important tasks", async () => {
    const { notebook, chapter } = await notebooks.createNotebook("Media to-do");
    await tasks.set("notebooks", notebook.id, { dueDay: date("2026-11-01") });
    await tasks.set("chapters", chapter.id, { dueDay: date("2026-10-25") });
    const page = await notes.create({ chapterId: chapter.id, body: "# Stalker playthrough\nall of it" });
    await tasks.set("notes", page.id, { dueDay: date("2026-10-28") });
    const ticked = await notes.create({ body: "done one" });
    await tasks.set("notes", ticked.id, { dueDay: date("2026-10-20") });
    await tasks.set("notes", ticked.id, { done: true });

    const open = await tasks.openImportant();
    expect(open.map((t) => [t.table, t.dueDay.toString()])).toEqual([
      ["chapters", "2026-10-25"],
      ["notes", "2026-10-28"],
      ["notebooks", "2026-11-01"],
    ]);
    expect((await notebooks.listNotebooks()).find((n) => n.id === notebook.id)!.dueDay?.toString()).toBe("2026-11-01");
    await notes.remove(page.id);
    expect((await tasks.openImportant()).map((t) => t.table)).toEqual(["chapters", "notebooks"]);
  });

  it("starts the default notebook and chapter as non-tasks", async () => {
    const [nb] = await notebooks.listNotebooks();
    expect(nb).toMatchObject({ id: DEFAULT_NOTEBOOK_ID, task: false, doneAt: null, dueDay: null });
    expect((await notebooks.listChapters())[0]).toMatchObject({ id: DEFAULT_CHAPTER_ID, task: false });
  });

  it("rejects unknown tables", async () => {
    await expect(tasks.set("tags" as never, "x", { task: true })).rejects.toThrow();
  });
});

describe("ticked tasks", () => {
  const nowI = Temporal.Instant.from("2026-10-22T12:00:00Z");
  const done = (iso: string) => ({ task: true, doneAt: iso, dueDay: null });

  it("stay for a week, then hide unless completed tasks are shown", () => {
    expect(isVisible(done("2026-10-16T12:00:01Z"), false, nowI)).toBe(true);
    expect(isVisible(done("2026-10-15T12:00:00Z"), false, nowI)).toBe(false);
    expect(isVisible(done("2026-10-01T12:00:00Z"), true, nowI)).toBe(true);
    expect(isVisible({ task: true, doneAt: null, dueDay: null }, false, nowI)).toBe(true);
  });
});

describe("asking whether an important task is done", () => {
  const due = date("2026-10-30");

  it("asks more often the later it gets, during the day", () => {
    expect(nagTimes(due, date("2026-10-29"))).toEqual([]);
    expect(nagTimes(due, due).map(String)).toEqual(["09:00:00", "13:00:00", "17:00:00", "21:00:00"]);
    expect(nagTimes(due, date("2026-10-31"))).toHaveLength(8); // 08:00 to 22:00 every 2 hours
    expect(nagTimes(due, date("2026-11-01"))).toHaveLength(15); // hourly
    expect(nagTimes(due, date("2026-11-05"))).toHaveLength(29); // every half hour
  });

  it("finds the latest time it should have asked", () => {
    expect(latestNag(due, at("2026-10-30T08:59"))).toBeNull();
    expect(latestNag(due, at("2026-10-30T14:00"))!.toPlainDateTime().toString()).toBe("2026-10-30T13:00:00");
    // Overnight it carries yesterday's last time.
    expect(latestNag(due, at("2026-10-31T07:00"))!.toPlainDateTime().toString()).toBe("2026-10-30T21:00:00");
  });

  it("asks once per time, and catches up after the app was closed", () => {
    expect(shouldNag(due, null, at("2026-10-29T23:00"))).toBe(false);
    expect(shouldNag(due, null, at("2026-10-30T09:00"))).toBe(true);
    const asked = at("2026-10-30T09:00").toInstant();
    expect(shouldNag(due, asked, at("2026-10-30T12:59"))).toBe(false);
    expect(shouldNag(due, asked, at("2026-10-30T13:00"))).toBe(true);
    // Closed for days: asks straight away when it opens.
    expect(shouldNag(due, asked, at("2026-11-04T03:00"))).toBe(true);
  });

  it("keeps the wall-clock times across the change from summer time", () => {
    // Summer time in Stockholm ends on 25/10/2026.
    expect(nagTimes(date("2026-10-25"), date("2026-10-25")).map(String)).toEqual([
      "09:00:00",
      "13:00:00",
      "17:00:00",
      "21:00:00",
    ]);
  });

  it("describes the deadline", () => {
    const today = date("2026-10-30");
    expect(describeDue(date("2026-10-30"), today)).toBe("due today");
    expect(describeDue(date("2026-10-31"), today)).toBe("due tomorrow");
    expect(describeDue(date("2026-11-02"), today)).toBe("due in 3 days");
    expect(describeDue(date("2026-10-28"), today)).toBe("2 days late");
  });
});
