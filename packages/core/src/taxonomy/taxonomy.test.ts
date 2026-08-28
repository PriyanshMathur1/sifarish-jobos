import { describe, expect, it } from "vitest";
import {
  normalizeLocation,
  normalizeTitle,
  normalizeSkill,
  seniorityOf,
  titleSimilarity,
} from "./taxonomy.ts";

describe("normalizeLocation", () => {
  it.each([
    ["Bangalore", { city: "Bengaluru", country: "IN", kind: "city" }],
    ["Bengaluru, Karnataka, India", { city: "Bengaluru", country: "IN", kind: "city" }],
    ["Gurgaon", { city: "Gurugram", country: "IN", kind: "city" }],
    ["NCR", { city: "Delhi NCR", country: "IN", kind: "city" }],
    ["Mumbai, India", { city: "Mumbai", country: "IN", kind: "city" }],
    ["NYC", { city: "New York City", country: "US", kind: "city" }],
    ["Remote", { kind: "remote" }],
    ["Remote - India", { country: "IN", kind: "remote" }],
    ["Remote (US only)", { country: "US", kind: "remote" }],
    ["India", { country: "IN", kind: "country" }],
    ["London, UK", { city: "London", country: "GB", kind: "city" }],
  ])("%s", (input, expected) => {
    expect(normalizeLocation(input)).toMatchObject(expected);
  });

  it("unknown location keeps the raw string and unknown kind — never fabricates", () => {
    const r = normalizeLocation("Floating Office, Atlantis");
    expect(r.kind).toBe("unknown");
    expect(r.raw).toBe("Floating Office, Atlantis");
    expect(r.country).toBeUndefined();
  });
});

describe("normalizeTitle / seniority", () => {
  it.each([
    ["Software Development Engineer II", "Software Engineer"],
    ["SDE", "Software Engineer"],
    ["Sr. Product Manager", "Product Manager"],
    ["Senior Product Manager - Growth", "Product Manager"],
    ["Growth PM", "Product Manager"],
    ["VP, Product", "Product Manager"],
  ])("%s → canonical %s", (input, canonical) => {
    expect(normalizeTitle(input).canonical).toBe(canonical);
  });

  it.each([
    ["Product Management Intern", "intern"],
    ["Junior Developer", "entry"],
    ["Software Engineer", "mid"],
    ["Senior Product Manager", "senior"],
    ["Staff Engineer", "lead"],
    ["Engineering Manager", "manager"],
    ["Director of Product", "director"],
    ["VP of Engineering", "vp"],
    ["Chief Product Officer", "executive"],
  ])("%s → %s", (title, level) => {
    expect(seniorityOf(title)).toBe(level);
  });

  it("keeps the modifier so Growth PM ≠ plain PM in similarity", () => {
    const growth = normalizeTitle("Growth Product Manager");
    expect(growth.canonical).toBe("Product Manager");
    expect(growth.modifiers).toContain("growth");
  });
});

describe("normalizeSkill", () => {
  it.each([
    ["JS", "JavaScript"],
    ["Postgres", "PostgreSQL"],
    ["postgresql", "PostgreSQL"],
    ["React.js", "React"],
    ["GA4", "Google Analytics"],
  ])("%s → %s", (input, canonical) => {
    expect(normalizeSkill(input)).toBe(canonical);
  });

  it('never blindly maps ambiguous "PM" (PRD §37)', () => {
    expect(normalizeSkill("PM")).toBe("PM"); // left untouched without context
  });

  it("unknown skills pass through unchanged", () => {
    expect(normalizeSkill("Zig")).toBe("Zig");
  });
});

describe("titleSimilarity", () => {
  it("orders: same-canonical+modifier > same-canonical > different", () => {
    const exact = titleSimilarity("Growth Product Manager", "Product Manager — Growth");
    const family = titleSimilarity("Growth Product Manager", "Product Manager");
    const far = titleSimilarity("Product Manager", "Accountant");
    expect(exact).toBeGreaterThan(family);
    expect(family).toBeGreaterThan(far);
    expect(exact).toBeGreaterThan(0.9);
    expect(far).toBeLessThan(0.3);
  });

  it("alias variants are highly similar (SDE ≈ Software Engineer)", () => {
    expect(titleSimilarity("SDE II", "Software Engineer")).toBeGreaterThan(0.7);
  });
});
