import { expect, it } from "vitest";
import { Temporal } from "../src/time/temporal";
import { formatDate, formatTime, viewTitle } from "../src/ui/dates";

it("writes times on the 24-hour clock", () => {
  expect(formatTime(new Temporal.PlainTime(9))).toBe("09:00");
  expect(formatTime(new Temporal.PlainTime(0, 5))).toBe("00:05");
  expect(formatTime(new Temporal.PlainTime(14, 30))).toBe("14:30");
});

it("writes dates as numbers", () => {
  const day = Temporal.PlainDate.from("2026-10-05");
  expect(formatDate(day)).toBe("05/10/2026");
  expect(viewTitle("day", day)).toBe("Monday 05/10/2026");
  expect(viewTitle("week", day)).toBe("05/10 – 11/10/2026");
  expect(viewTitle("week", Temporal.PlainDate.from("2026-12-30"))).toBe("28/12/2026 – 03/01/2027");
});
