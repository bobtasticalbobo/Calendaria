import { beforeEach, describe, expect, it } from "vitest";
import { NotebookRepository } from "../src/db/notebooks";
import { NoteRepository } from "../src/db/notes";
import { type TaskEvent, TaskRepository } from "../src/db/tasks";
import { computeStats, describeDays, rangeStart } from "../src/notes/stats";
import { Temporal } from "../src/time/temporal";
import { createPartlyMigratedDriver, createTestDriver } from "./sqliteDriver";

const date = Temporal.PlainDate.from;

describe("task history", () => {
  let now: number;
  const clock = () => new Date(now);
  let tasks: TaskRepository;
  let notes: NoteRepository;

  beforeEach(() => {
    now = Date.parse("2026-10-20T08:00:00Z");
    const db = createTestDriver();
    tasks = new TaskRepository(db, clock);
    notes = new NoteRepository(db, clock);
  });

  it("records making, deadlines, ticking and putting off", async () => {
    const page = await notes.create({ body: "# Tankhead\nplay it" });
    await tasks.set("notes", page.id, { task: true });
    now += 3_600_000;
    await tasks.set("notes", page.id, { dueDay: date("2026-10-22") });
    await tasks.set("notes", page.id, { dueDay: date("2026-10-22") }); // unchanged: no new event
    await tasks.snoozed("notes", page.id, "Tankhead", date("2026-10-22"));
    now += 3_600_000;
    await tasks.set("notes", page.id, { done: true });
    const events = await tasks.events();
    expect(events.map((e) => e.kind)).toEqual(["made", "deadline", "snoozed", "done"]);
    expect(events[3]).toMatchObject({ table: "notes", itemId: page.id, title: "# Tankhead" });
    expect(events[3].dueDay?.toString()).toBe("2026-10-22");
  });

  it("forgets a completion when the task is unticked", async () => {
    const page = await notes.create({ body: "x" });
    await tasks.set("notes", page.id, { task: true });
    await tasks.set("notes", page.id, { done: true });
    now += 1000;
    await tasks.set("notes", page.id, { done: false });
    expect((await tasks.events()).map((e) => e.kind)).toEqual(["made"]);
  });

  it("counts tasks ticked before the history existed", async () => {
    const { driver, migrateRest } = createPartlyMigratedDriver(9);
    const notebooks = new NotebookRepository(driver, clock);
    const oldNotes = new NoteRepository(driver, clock);
    const oldTasks = new TaskRepository(driver, clock);
    const { chapter } = await notebooks.createNotebook("Media");
    const page = await oldNotes.create({ chapterId: chapter.id, body: "Stalker\nmore" });
    // What 0.8.0 did: tick without any history.
    await driver.execute("UPDATE notes SET task = 1, done_at = '2026-10-19T10:00:00.000Z' WHERE id = $1", [page.id]);
    await driver.execute("UPDATE chapters SET task = 1, done_at = '2026-10-18T10:00:00.000Z' WHERE id = $1", [
      chapter.id,
    ]);
    migrateRest();
    const events = await oldTasks.events();
    expect(events.map((e) => [e.id, e.kind, e.title])).toEqual([
      [`${chapter.id}/done`, "done", "Chapter 1"],
      [`${page.id}/done`, "done", "Stalker"],
    ]);
  });
});

function event(kind: TaskEvent["kind"], at: string, extra: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id: `${kind}${at}${extra.itemId ?? ""}`,
    table: "notes",
    itemId: "a",
    kind,
    title: "A",
    dueDay: null,
    at: Temporal.Instant.from(at),
    ...extra,
  };
}

describe("statistics", () => {
  // Thursday 22/10/2026, 20:00 in Stockholm.
  const now = Temporal.ZonedDateTime.from("2026-10-22T20:00[Europe/Stockholm]");
  const events: TaskEvent[] = [
    event("made", "2026-10-19T08:00:00Z", { itemId: "a" }),
    event("done", "2026-10-20T08:00:00Z", { itemId: "a", dueDay: date("2026-10-21") }), // Tue 10:00, on time
    event("made", "2026-10-20T09:00:00Z", { itemId: "b" }),
    event("snoozed", "2026-10-21T07:00:00Z", { itemId: "b", title: "B" }),
    event("snoozed", "2026-10-21T11:00:00Z", { itemId: "b", title: "B" }),
    event("done", "2026-10-21T09:00:00Z", { itemId: "b", dueDay: date("2026-10-20") }), // Wed 11:00, late
    event("done", "2026-10-22T14:00:00Z", { itemId: "c" }), // Thu 16:00
    event("done", "2026-09-01T10:00:00Z", { itemId: "old" }),
  ];
  const items = [
    { id: "d", task: true, doneAt: null, dueDay: date("2026-10-21") },
    { id: "e", task: true, doneAt: null, dueDay: null },
    { id: "f", task: false, doneAt: null, dueDay: null },
  ];
  const notebookOf = (id: string) => (id === "a" || id === "b" ? "nb1" : id === "c" ? "nb2" : null);

  it("sums up a week", () => {
    const s = computeStats({ events, items, notebookOf, now, range: "week" });
    expect(s).toMatchObject({ done: 3, made: 2, openNow: 2, overdueNow: 1, onTime: 1, late: 1, streak: 3 });
    expect(s.perPeriod.map((b) => b.count)).toEqual([0, 0, 0, 0, 1, 1, 1]);
    expect(s.perPeriod[6].label).toBe("Thu");
    expect(s.byNotebook).toEqual([
      { notebookId: "nb1", count: 2 },
      { notebookId: "nb2", count: 1 },
    ]);
    expect(s.putOff).toEqual([{ itemId: "b", title: "B", count: 2 }]);
    expect(s.recent.map((c) => [c.event.itemId, c.late])).toEqual([
      ["c", false],
      ["b", true],
      ["a", false],
    ]);
    // a took 1 day, b took exactly 1 day too.
    expect(s.averageDays).toBeCloseTo(1);
    expect(s.heat[1][10]).toBe(1); // Tuesday 10:00 local
    expect(s.heat[3][16]).toBe(1); // Thursday 16:00 local
  });

  it("counts all time by month, and keeps the best streak", () => {
    const s = computeStats({ events, items, notebookOf, now, range: "all" });
    expect(s.done).toBe(4);
    expect(s.perPeriod.map((b) => [b.label, b.count])).toEqual([
      ["Sept", 1],
      ["Oct", 3],
    ]);
    expect(s.bestStreak).toBe(3);
  });

  it("keeps a streak alive until the day is over", () => {
    const morning = Temporal.ZonedDateTime.from("2026-10-23T08:00[Europe/Stockholm]");
    expect(computeStats({ events, items, notebookOf, now: morning, range: "week" }).streak).toBe(3);
    const later = Temporal.ZonedDateTime.from("2026-10-24T08:00[Europe/Stockholm]");
    expect(computeStats({ events, items, notebookOf, now: later, range: "week" }).streak).toBe(0);
  });

  it("starts ranges where expected", () => {
    const today = date("2026-10-22");
    expect(rangeStart("week", today)?.toString()).toBe("2026-10-16");
    expect(rangeStart("month", today)?.toString()).toBe("2026-09-23");
    expect(rangeStart("year", today)?.toString()).toBe("2025-11-01");
    expect(rangeStart("all", today)).toBeNull();
  });

  it("describes durations", () => {
    expect(describeDays(0.01)).toBe("under an hour");
    expect(describeDays(0.25)).toBe("6 hours");
    expect(describeDays(1)).toBe("1 day");
    expect(describeDays(2.46)).toBe("2.5 days");
  });
});
