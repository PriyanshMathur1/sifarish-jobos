import { describe, expect, it } from "vitest";
import { inferEmails, learnPattern, applyPattern, parseName } from "./pattern-engine.ts";

describe("parseName", () => {
  it.each([
    ["Priyansh Mathur", { first: "priyansh", last: "mathur" }],
    ["A. R. Rahman", { first: "a", last: "rahman" }],
    ["Priya", { first: "priya", last: "" }],
    ["  Anita  D'Souza ", { first: "anita", last: "dsouza" }],
    ["José Álvarez", { first: "jose", last: "alvarez" }],
    ["Ravi Kumar Sharma", { first: "ravi", last: "sharma" }],
  ])("%s", (input, expected) => {
    expect(parseName(input)).toMatchObject(expected);
  });
});

describe("applyPattern", () => {
  const name = { first: "priyansh", last: "mathur" };
  it.each([
    ["first.last", "priyansh.mathur@acme.com"],
    ["first", "priyansh@acme.com"],
    ["flast", "pmathur@acme.com"],
    ["first_last", "priyansh_mathur@acme.com"],
    ["firstl", "priyanshm@acme.com"],
    ["f.last", "p.mathur@acme.com"],
    ["last.first", "mathur.priyansh@acme.com"],
  ])("%s → %s", (pattern, expected) => {
    expect(applyPattern(pattern, name, "acme.com")).toBe(expected);
  });

  it("returns null when the name lacks the parts a pattern needs", () => {
    expect(applyPattern("first.last", { first: "priya", last: "" }, "acme.com")).toBeNull();
  });
});

describe("learnPattern — from a verified observation (PRD §71)", () => {
  it.each([
    ["Priyansh Mathur", "priyansh.mathur@dezerv.in", "first.last"],
    ["Priyansh Mathur", "priyansh@dezerv.in", "first"],
    ["Priyansh Mathur", "pmathur@dezerv.in", "flast"],
    ["Priyansh Mathur", "priyanshm@dezerv.in", "firstl"],
  ])("%s + %s → %s", (fullName, email, expected) => {
    expect(learnPattern(fullName, email)).toBe(expected);
  });

  it("returns null when no known pattern explains the email — never guesses", () => {
    expect(learnPattern("Priyansh Mathur", "wizard42@dezerv.in")).toBeNull();
  });
});

describe("inferEmails — ranked candidates", () => {
  const name = "Anita Desai";

  it("company-learned patterns outrank generic guesses", () => {
    const candidates = inferEmails(name, {
      domain: "acme.com",
      learnedPatterns: [{ pattern: "flast", confidence: 0.9, evidenceCount: 3 }],
    });
    expect(candidates[0]).toMatchObject({
      email: "adesai@acme.com",
      pattern: "flast",
      basis: "company_pattern",
    });
    expect(candidates[0]!.confidence).toBeGreaterThan(candidates[1]!.confidence);
  });

  it("without learned patterns, falls back to the generic library in prior order", () => {
    const candidates = inferEmails(name, { domain: "acme.com", learnedPatterns: [] });
    expect(candidates.length).toBeGreaterThanOrEqual(4);
    expect(candidates[0]!.email).toBe("anita.desai@acme.com"); // first.last is the most common
    expect(candidates.every((c) => c.basis === "generated")).toBe(true);
    expect(candidates.every((c) => c.confidence <= 0.5)).toBe(true); // generated is never confident
  });

  it("no domain → no candidates (never invents a domain)", () => {
    expect(inferEmails(name, { domain: null, learnedPatterns: [] })).toEqual([]);
  });

  it("candidates are deduplicated when patterns collide", () => {
    const candidates = inferEmails("Priya", { domain: "acme.com", learnedPatterns: [] });
    const emails = candidates.map((c) => c.email);
    expect(new Set(emails).size).toBe(emails.length);
  });
});
