import { describe, expect, it } from "vitest";
import { Temporal } from "../src/time/temporal";
import { formatDate, formatTime, parseDate, parseTime, viewTitle } from "../src/ui/dates";

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

describe("typed dates and times", () => {
  const today = Temporal.PlainDate.from("2026-10-23");
  const d = (text: string) => parseDate(text, today)?.toString() ?? null;
  const t = (text: string) => parseTime(text)?.toString({ smallestUnit: "minute" }) ?? null;

  it("reads dates day first, whatever the computer's region", () => {
    expect(d("10/11/2026")).toBe("2026-11-10");
    expect(d("1.2.27")).toBe("2027-02-01");
    expect(d("24-12")).toBe("2026-12-24");
    expect(d("2026-10-30")).toBe("2026-10-30");
    expect(d(formatDate(today))).toBe("2026-10-23");
  });

  it("refuses days that don't exist", () => {
    expect(d("10/23/2026")).toBeNull();
    expect(d("29/02/2027")).toBeNull();
    expect(d("tomorrow")).toBeNull();
  });

  it("reads 24-hour times", () => {
    expect([t("9"), t("09:30"), t("9.30"), t("930"), t("2105"), t("00:00")]).toEqual([
      "09:00",
      "09:30",
      "09:30",
      "09:30",
      "21:05",
      "00:00",
    ]);
    expect([t("24:00"), t("9:75"), t("9 PM")]).toEqual([null, null, null]);
  });
});
