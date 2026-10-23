import { describe, expect, it } from "vitest";
import { displayVersion, isNewer } from "../src/ui/useUpdate";

describe("versions", () => {
  it("shows milestones short and later steps zero-padded", () => {
    expect(displayVersion("0.9.0")).toBe("0.9");
    expect(displayVersion("0.9.1")).toBe("0.9.001");
    expect(displayVersion("0.9.42")).toBe("0.9.042");
  });

  it("compares numerically, not as text", () => {
    expect(isNewer("0.9.10", "0.9.9")).toBe(true);
    expect(isNewer("0.9.0", "0.8.3")).toBe(true);
    expect(isNewer("0.9.0", "0.9.0")).toBe(false);
    expect(isNewer("0.8.9", "0.9.0")).toBe(false);
  });
});
