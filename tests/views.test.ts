import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventOccurrence } from "../src/db/events";
import { Temporal } from "../src/time/temporal";
import type { EventTiming } from "../src/time/timing";
import { dayRange, startOfWeek, visibleDays } from "../src/ui/dates";
import { seriesTimingFromOccurrenceEdit } from "../src/ui/edit";
import { itemsOnDay, layoutDay } from "../src/ui/layout";

const ZONE = "Europe/Stockholm";
const date = Temporal.PlainDate.from;

function item(title: string, start: string, end: string): EventOccurrence {
  const timing: EventTiming = {
    allDay: false,
    start: Temporal.PlainDateTime.from(start),
    end: Temporal.PlainDateTime.from(end),
    timeZone: ZONE,
  };
  return {
    event: { id: title, title, timing } as CalendarEvent,
    occurrence: { key: start, timing },
  };
}

describe("visibleDays", () => {
  it("shows six Monday-first weeks covering the month", () => {
    const days = visibleDays("month", date("2026-02-14"));
    expect(days).toHaveLength(42);
    expect(days[0].toString()).toBe("2026-01-26");
    expect(days[0].dayOfWeek).toBe(1);
    expect(days.some((d) => d.toString() === "2026-02-28")).toBe(true);
  });

  it("starts weeks on Monday, including across a year boundary", () => {
    expect(startOfWeek(date("2027-01-03")).toString()).toBe("2026-12-28");
    expect(visibleDays("week", date("2026-10-20")).map((d) => d.day)).toEqual([19, 20, 21, 22, 23, 24, 25]);
  });

  it("covers a 25-hour day exactly when the clocks go back", () => {
    const { start, end } = dayRange([date("2026-10-25")], ZONE);
    expect(start.until(end).total("hours")).toBe(25);
  });
});

describe("layoutDay", () => {
  const day = date("2026-10-20");

  function layout(items: EventOccurrence[]) {
    const { timed } = itemsOnDay(items, day, ZONE);
    return Object.fromEntries(
      layoutDay(timed, day, ZONE).map((s) => [
        s.item.event.title,
        [s.startMinute, s.endMinute, s.column, s.columns],
      ]),
    );
  }

  it("puts overlapping events side by side and others full width", () => {
    expect(
      layout([
        item("A", "2026-10-20T09:00", "2026-10-20T10:00"),
        item("B", "2026-10-20T09:30", "2026-10-20T11:00"),
        item("C", "2026-10-20T10:00", "2026-10-20T10:30"),
        item("D", "2026-10-20T13:00", "2026-10-20T14:00"),
      ]),
    ).toEqual({
      A: [540, 600, 0, 2],
      B: [570, 660, 1, 2],
      C: [600, 630, 0, 2],
      D: [780, 840, 0, 1],
    });
  });

  it("clips events that run past midnight", () => {
    expect(
      layout([
        item("Late", "2026-10-19T22:00", "2026-10-20T02:00"),
        item("Night", "2026-10-20T23:00", "2026-10-21T01:00"),
      ]),
    ).toEqual({ Late: [0, 120, 0, 1], Night: [1380, 1440, 0, 1] });
  });

  it("ignores events on other days", () => {
    expect(layout([item("Tomorrow", "2026-10-21T00:00", "2026-10-21T01:00")])).toEqual({});
  });
});

describe("seriesTimingFromOccurrenceEdit", () => {
  const dt = Temporal.PlainDateTime.from;
  const series: EventTiming = {
    allDay: false,
    start: dt("2026-10-05T09:00"),
    end: dt("2026-10-05T10:00"),
    timeZone: ZONE,
  };
  const occurrence: EventTiming = { ...series, start: dt("2026-10-19T09:00"), end: dt("2026-10-19T10:00") };

  it("moves the series by the same change made to an occurrence", () => {
    const edited: EventTiming = { ...occurrence, start: dt("2026-10-20T13:30"), end: dt("2026-10-20T15:00") };
    expect(seriesTimingFromOccurrenceEdit(series, occurrence, edited)).toEqual({
      ...series,
      start: dt("2026-10-06T13:30"),
      end: dt("2026-10-06T15:00"),
    });
  });

  it("switches the whole series to all-day", () => {
    const edited: EventTiming = { allDay: true, start: date("2026-10-19"), end: date("2026-10-20") };
    expect(seriesTimingFromOccurrenceEdit(series, occurrence, edited)).toEqual({
      allDay: true,
      start: date("2026-10-05"),
      end: date("2026-10-06"),
    });
  });
});
