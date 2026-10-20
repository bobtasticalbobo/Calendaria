import { beforeEach, describe, expect, it } from "vitest";
import {
  CalendarRepository,
  DEFAULT_CALENDAR_COLOR,
  DEFAULT_CALENDAR_NAME,
} from "../src/db/calendars";
import { createTestDriver } from "./sqliteDriver";

function fakeClock(start = "2026-10-20T12:00:00.000Z") {
  let now = new Date(start).getTime();
  const clock = () => new Date(now);
  clock.advance = (ms: number) => {
    now += ms;
  };
  return clock;
}

describe("CalendarRepository", () => {
  let clock: ReturnType<typeof fakeClock>;
  let repo: CalendarRepository;

  beforeEach(() => {
    clock = fakeClock();
    repo = new CalendarRepository(createTestDriver(), clock);
  });

  it("creates a calendar with sync fields filled in", async () => {
    const cal = await repo.create({ name: "  Work  " });
    expect(cal).toMatchObject({
      name: "Work",
      color: DEFAULT_CALENDAR_COLOR,
      createdAt: "2026-10-20T12:00:00.000Z",
      updatedAt: "2026-10-20T12:00:00.000Z",
      deletedAt: null,
    });
    expect(cal.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(await repo.get(cal.id)).toEqual(cal);
  });

  it("gives every record a unique id", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add((await repo.create({ name: `c${i}` })).id);
    expect(ids.size).toBe(200);
  });

  it("rejects empty names and malformed colors", async () => {
    await expect(repo.create({ name: "   " })).rejects.toThrow(/empty/);
    await expect(repo.create({ name: "x", color: "blue" })).rejects.toThrow(/color/);
  });

  it("bumps updatedAt on update but keeps createdAt", async () => {
    const cal = await repo.create({ name: "Work" });
    clock.advance(60_000);
    const updated = await repo.update(cal.id, { color: "#FF0000" });
    expect(updated.color).toBe("#ff0000");
    expect(updated.createdAt).toBe("2026-10-20T12:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-10-20T12:01:00.000Z");
    expect(await repo.get(cal.id)).toEqual(updated);
  });

  it("soft-deletes, leaving a tombstone for sync", async () => {
    const cal = await repo.create({ name: "Old" });
    clock.advance(1000);
    await repo.remove(cal.id);
    expect(await repo.list()).toEqual([]);
    expect(await repo.get(cal.id)).toMatchObject({
      deletedAt: "2026-10-20T12:00:01.000Z",
      updatedAt: "2026-10-20T12:00:01.000Z",
    });
    await expect(repo.remove(cal.id)).rejects.toThrow(/not found/);
    await expect(repo.update(cal.id, { name: "x" })).rejects.toThrow(/not found/);
  });

  it("creates the default calendar only on first launch", async () => {
    await repo.ensureDefault();
    await repo.ensureDefault();
    const [cal, ...rest] = await repo.list();
    expect(cal.name).toBe(DEFAULT_CALENDAR_NAME);
    expect(rest).toEqual([]);

    await repo.remove(cal.id);
    await repo.ensureDefault();
    expect(await repo.list()).toEqual([]);
  });
});
