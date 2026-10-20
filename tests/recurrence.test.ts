import { describe, expect, it } from "vitest";
import {
  type RepeatingEvent,
  expandOccurrences,
  seriesEnd,
} from "../src/time/recurrence";
import { buildRepeatRule, parseRepeatRule } from "../src/time/repeat";
import { Temporal } from "../src/time/temporal";
import { type EventTiming, timingBounds, toZoned, validateTiming } from "../src/time/timing";

const STOCKHOLM = "Europe/Stockholm";
const NEW_YORK = "America/New_York";

const dt = Temporal.PlainDateTime.from;
const date = Temporal.PlainDate.from;
const instant = Temporal.Instant.from;

function timed(start: string, end: string, timeZone = STOCKHOLM): EventTiming {
  return { allDay: false, start: dt(start), end: dt(end), timeZone };
}

function allDay(start: string, end: string): EventTiming {
  return { allDay: true, start: date(start), end: date(end) };
}

function expand(event: RepeatingEvent, from: string, to: string, viewZone = STOCKHOLM) {
  return expandOccurrences(event, instant(from), instant(to), viewZone);
}

/** Occurrence starts as exact UTC instants. */
function startsUtc(event: RepeatingEvent, from: string, to: string, viewZone = STOCKHOLM) {
  return expand(event, from, to, viewZone).map((o) =>
    timingBounds(o.timing, viewZone).start.toInstant().toString(),
  );
}

function repeating(timing: EventTiming, rule: string, exdates: string[] = []): RepeatingEvent {
  return { timing, recurrence: { rule, exdates } };
}

describe("daylight saving", () => {
  it("keeps a weekly 9:00 meeting at 9:00 local when the clocks go back", () => {
    const event = repeating(timed("2026-10-19T09:00", "2026-10-19T10:00"), "FREQ=WEEKLY");
    expect(startsUtc(event, "2026-10-18T00:00Z", "2026-11-03T00:00Z")).toEqual([
      "2026-10-19T07:00:00Z", // CEST, UTC+2
      "2026-10-26T08:00:00Z", // CET, UTC+1
      "2026-11-02T08:00:00Z",
    ]);
  });

  it("moves a time skipped by spring-forward to after the gap", () => {
    // 02:30 doesn't exist in Stockholm on 29 March 2026.
    expect(toZoned(dt("2026-03-29T02:30"), STOCKHOLM).toString()).toBe(
      "2026-03-29T03:30:00+02:00[Europe/Stockholm]",
    );
  });

  it("uses the first of two repeated times when the clocks go back", () => {
    // 02:30 happens twice in Stockholm on 25 October 2026.
    expect(toZoned(dt("2026-10-25T02:30"), STOCKHOLM).toInstant().toString()).toBe(
      "2026-10-25T00:30:00Z",
    );
  });

  it("keeps a daily event's real length on the night the clocks change", () => {
    const event = repeating(timed("2026-10-23T01:00", "2026-10-23T04:00"), "FREQ=DAILY;COUNT=3");
    const [, , onChangeNight] = expand(event, "2026-10-22T00:00Z", "2026-10-26T00:00Z");
    const { start, end } = timingBounds(onChangeNight.timing, STOCKHOLM);
    expect(start.until(end).total("hours")).toBe(3);
    expect(onChangeNight.timing.end.toString()).toBe("2026-10-25T03:00:00");
  });

  it("follows the event's own zone when it differs from the calendar's", () => {
    // The US changes clocks three weeks before Europe, so for those weeks a
    // 9:00 New York call is at 14:00 in Stockholm instead of 15:00.
    const event = repeating(timed("2026-03-02T09:00", "2026-03-02T10:00", NEW_YORK), "FREQ=WEEKLY");
    const local = expand(event, "2026-03-01T00:00Z", "2026-04-01T00:00Z").map((o) =>
      timingBounds(o.timing, STOCKHOLM).start.toPlainTime().toString(),
    );
    expect(local).toEqual(["15:00:00", "14:00:00", "14:00:00", "14:00:00", "15:00:00"]);
  });
});

describe("calendar edge cases", () => {
  it("skips months without a 31st for 'monthly on the 31st', per iCalendar", () => {
    const event = repeating(timed("2026-01-31T12:00", "2026-01-31T13:00"), "FREQ=MONTHLY;BYMONTHDAY=31");
    const days = expand(event, "2026-01-01T00:00Z", "2026-08-01T00:00Z").map((o) => o.key);
    expect(days).toEqual([
      "2026-01-31T12:00:00",
      "2026-03-31T12:00:00",
      "2026-05-31T12:00:00",
      "2026-07-31T12:00:00",
    ]);
  });

  it("lands on the last day of every month for 'monthly on the last day'", () => {
    const event = repeating(allDay("2028-01-31", "2028-02-01"), "FREQ=MONTHLY;BYMONTHDAY=-1");
    const days = expand(event, "2028-01-01T00:00Z", "2028-05-01T00:00Z").map((o) => o.key);
    expect(days).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
  });

  it("repeats a 29 February event only in leap years", () => {
    const event = repeating(allDay("2028-02-29", "2028-03-01"), "FREQ=YEARLY");
    const days = expand(event, "2028-01-01T00:00Z", "2037-01-01T00:00Z").map((o) => o.key);
    expect(days).toEqual(["2028-02-29", "2032-02-29", "2036-02-29"]);
  });

  it("continues weekly events across the new year", () => {
    const event = repeating(timed("2026-12-24T18:00", "2026-12-24T19:00"), "FREQ=WEEKLY");
    const days = expand(event, "2026-12-20T00:00Z", "2027-01-15T00:00Z").map((o) => o.key);
    expect(days).toEqual(["2026-12-24T18:00:00", "2026-12-31T18:00:00", "2027-01-07T18:00:00", "2027-01-14T18:00:00"]);
  });

  it("shows an all-day event on its date in every time zone", () => {
    const event: RepeatingEvent = { timing: allDay("2026-11-03", "2026-11-04"), recurrence: null };
    for (const zone of ["Pacific/Auckland", "Asia/Tokyo", "UTC", NEW_YORK, "Pacific/Honolulu"]) {
      const dayStart = Temporal.PlainDate.from("2026-11-03").toZonedDateTime(zone).toInstant();
      const dayEnd = Temporal.PlainDate.from("2026-11-04").toZonedDateTime(zone).toInstant();
      expect(expandOccurrences(event, dayStart, dayEnd, zone)).toHaveLength(1);
      const before = Temporal.PlainDate.from("2026-11-02").toZonedDateTime(zone).toInstant();
      expect(expandOccurrences(event, before, dayStart, zone)).toHaveLength(0);
    }
  });
});

describe("expandOccurrences", () => {
  it("includes events that started before the range but are still going", () => {
    const event: RepeatingEvent = {
      timing: timed("2026-10-18T20:00", "2026-10-21T08:00"),
      recurrence: null,
    };
    expect(expand(event, "2026-10-20T00:00Z", "2026-10-21T00:00Z")).toHaveLength(1);
    expect(expand(event, "2026-10-21T06:00Z", "2026-10-22T00:00Z")).toHaveLength(0);
  });

  it("includes zero-length events at their start time", () => {
    const event: RepeatingEvent = { timing: timed("2026-10-20T09:00", "2026-10-20T09:00"), recurrence: null };
    expect(expand(event, "2026-10-20T07:00Z", "2026-10-20T08:00Z")).toHaveLength(1);
    expect(expand(event, "2026-10-20T07:01Z", "2026-10-20T08:00Z")).toHaveLength(0);
  });

  it("leaves out deleted occurrences", () => {
    const event = repeating(timed("2026-10-19T09:00", "2026-10-19T10:00"), "FREQ=DAILY", [
      "2026-10-20T09:00:00",
    ]);
    const days = expand(event, "2026-10-19T00:00Z", "2026-10-22T00:00Z").map((o) => o.key);
    expect(days).toEqual(["2026-10-19T09:00:00", "2026-10-21T09:00:00"]);
  });

  it("respects COUNT even when the range starts mid-series", () => {
    const event = repeating(timed("2026-10-01T09:00", "2026-10-01T10:00"), "FREQ=DAILY;COUNT=10");
    expect(expand(event, "2026-10-08T00:00Z", "2026-12-01T00:00Z")).toHaveLength(3);
  });

  it("treats an imported UTC UNTIL as an exact instant", () => {
    // 2 November 09:00 Stockholm is 08:00Z, so it is the last occurrence.
    const event = repeating(
      timed("2026-10-19T09:00", "2026-10-19T10:00"),
      "FREQ=WEEKLY;UNTIL=20261102T080000Z",
    );
    const days = expand(event, "2026-10-01T00:00Z", "2027-01-01T00:00Z").map((o) => o.key);
    expect(days).toEqual(["2026-10-19T09:00:00", "2026-10-26T09:00:00", "2026-11-02T09:00:00"]);
  });

  it("finds occurrences far in the future", () => {
    const event = repeating(timed("2026-01-05T09:00", "2026-01-05T10:00"), "FREQ=WEEKLY;BYDAY=MO");
    expect(expand(event, "2036-01-01T00:00Z", "2036-01-08T00:00Z").map((o) => o.key)).toEqual([
      "2036-01-07T09:00:00",
    ]);
  });
});

describe("seriesEnd", () => {
  it("is null for a series that never ends", () => {
    expect(seriesEnd(repeating(timed("2026-10-19T09:00", "2026-10-19T10:00"), "FREQ=DAILY"))).toBeNull();
  });

  it("is the end of the last occurrence for a counted series", () => {
    const event = repeating(timed("2026-10-19T09:00", "2026-10-19T10:00"), "FREQ=WEEKLY;COUNT=3");
    expect(seriesEnd(event)?.toString()).toBe("2026-11-02T09:00:00Z");
  });
});

describe("validateTiming", () => {
  it("rejects events that end before they start and unknown zones", () => {
    expect(() => validateTiming(timed("2026-10-20T10:00", "2026-10-20T09:00"))).toThrow(/end after/);
    expect(() => validateTiming(allDay("2026-10-20", "2026-10-20"))).toThrow(/end after/);
    expect(() => validateTiming(timed("2026-10-20T09:00", "2026-10-20T10:00", "Mars/Olympus"))).toThrow(
      /time zone/,
    );
  });
});

describe("repeat rules from the editor", () => {
  const monday = date("2026-10-19");

  it("round-trips every preset", () => {
    for (const frequency of ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"] as const) {
      for (const end of [
        { type: "never" } as const,
        { type: "after", count: 5 } as const,
        { type: "on", date: date("2027-01-31") } as const,
      ]) {
        const rule = buildRepeatRule({ frequency, end }, monday, false);
        expect(parseRepeatRule(rule, monday)).toEqual({ frequency, end });
      }
    }
  });

  it("builds rules that use the start date", () => {
    expect(buildRepeatRule({ frequency: "weekly", end: { type: "never" } }, monday, false)).toBe(
      "FREQ=WEEKLY;BYDAY=MO",
    );
    expect(
      buildRepeatRule({ frequency: "monthly", end: { type: "on", date: date("2027-03-01") } }, monday, false),
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=19;UNTIL=20270301T235959");
  });

  it("includes the whole end date", () => {
    const rule = buildRepeatRule(
      { frequency: "daily", end: { type: "on", date: date("2026-10-21") } },
      monday,
      false,
    )!;
    const event = repeating(timed("2026-10-19T21:00", "2026-10-19T22:00"), rule);
    expect(expand(event, "2026-10-01T00:00Z", "2026-11-01T00:00Z")).toHaveLength(3);
  });

  it("keeps rules it can't edit as custom", () => {
    const imported = "FREQ=MONTHLY;BYDAY=2TU";
    const choice = parseRepeatRule(imported, monday);
    expect(choice.frequency).toBe("custom");
    expect(buildRepeatRule(choice, monday, false, imported)).toBe(imported);
  });
});
