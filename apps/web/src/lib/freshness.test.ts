import { describe, expect, it } from "vitest";
import { freshnessLabel } from "./freshness.ts";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("freshnessLabel (PRD §34)", () => {
  it("uses 'Posted' ONLY when the source stated a date", () => {
    expect(freshnessLabel(daysAgo(0), daysAgo(5))).toBe("Posted today");
    expect(freshnessLabel(daysAgo(1), daysAgo(5))).toBe("Posted yesterday");
    expect(freshnessLabel(daysAgo(12), daysAgo(5))).toBe("Posted 12 days ago");
  });

  it("falls back to 'Discovered' from first_seen — never fabricates a posting date", () => {
    expect(freshnessLabel(null, daysAgo(0))).toBe("Discovered today");
    expect(freshnessLabel(null, daysAgo(3))).toBe("Discovered 3 days ago");
    expect(freshnessLabel(null, daysAgo(65))).toBe("Discovered 2 months ago");
  });
});
