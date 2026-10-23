import { describe, expect, it } from "vitest";
import { inkOn, luminance } from "../src/ui/ink";

describe("inkOn", () => {
  it("puts dark text on bright colours", () => {
    expect(inkOn("#ff5a1f")).toBe("#0b0b0b");
    expect(inkOn("#ffcf00")).toBe("#0b0b0b");
    expect(inkOn("#fff")).toBe("#0b0b0b");
  });

  it("puts light text on dark colours", () => {
    expect(inkOn("#1a237e")).toBe("#f2f2ee");
    expect(inkOn("#000000")).toBe("#f2f2ee");
  });

  it("falls back to dark text for anything that isn't a hex colour", () => {
    expect(inkOn(undefined)).toBe("#0b0b0b");
    expect(inkOn("tomato")).toBe("#0b0b0b");
    expect(luminance("tomato")).toBeNull();
  });
});
