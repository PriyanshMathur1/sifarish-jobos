import { describe, expect, it } from "vitest";
import { scoreJob, type MatchJob, type MatchProfile } from "./matching-engine.ts";
import { extractSkills } from "./skills-in-text.ts";

const NOW = new Date("2026-09-04T09:00:00Z");

const profile = (over: Partial<MatchProfile> = {}): MatchProfile => ({
  currentTitle: "Product Manager",
  yearsExperience: 5,
  skills: ["SQL", "Experimentation", "Amplitude", "Figma", "Python"],
  locations: ["Bengaluru"],
  targetRoles: ["Product Manager", "Growth Product Manager"],
  targetFunctions: ["Product"],
  remotePref: "any",
  excludedCompanies: [],
  industriesExcluded: [],
  strictness: {},
  ...over,
});

const job = (over: Partial<MatchJob> = {}): MatchJob => ({
  id: "j1",
  title: "Senior Product Manager, Growth",
  seniority: "senior",
  titleFunction: "Product",
  descriptionText:
    "You will run A/B testing and own funnels. Strong SQL and Amplitude required. Figma familiarity a plus.",
  locations: ["Bengaluru, India"],
  remoteType: "hybrid",
  marketEligibility: "IN_CONFIRMED",
  companyName: "Razorpay",
  companyIndustry: "Fintech",
  firstSeenAt: new Date("2026-09-04T03:00:00Z"),
  ...over,
});

describe("extractSkills", () => {
  it("resolves aliases to canonical names and matches candidate-supplied terms", () => {
    const found = extractSkills("Needs postgres, a/b testing and Amplitude. Also Looker.", [
      "Looker",
      "SQL",
    ]);
    expect(found).toEqual(
      expect.arrayContaining(["PostgreSQL", "Experimentation", "Amplitude", "Looker"]),
    );
    expect(found).not.toContain("SQL");
  });

  it("ignores ambiguous tokens and substrings", () => {
    expect(extractSkills("The PM will do QA on the mobile app")).toEqual([]);
    expect(extractSkills("javascripting is not a word")).toEqual([]);
  });
});

describe("scoreJob", () => {
  it("scores a close match as strong with readable reasons", () => {
    const r = scoreJob(job(), profile(), NOW);
    expect(r.gate).toBeNull();
    expect(r.band).toBe("strong");
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.reasons.join(" ")).toMatch(/title/i);
    expect(r.reasons.join(" ")).toMatch(/SQL/);
  });

  it("is deterministic", () => {
    const a = scoreJob(job(), profile(), NOW);
    const b = scoreJob(job(), profile(), NOW);
    expect(a).toEqual(b);
  });

  it("gates excluded companies to zero", () => {
    const r = scoreJob(job(), profile({ excludedCompanies: ["razorpay"] }), NOW);
    expect(r.score).toBe(0);
    expect(r.band).toBe("weak");
    expect(r.gate).toMatch(/excluded/i);
  });

  it("gates excluded industries", () => {
    const r = scoreJob(job(), profile({ industriesExcluded: ["Fintech"] }), NOW);
    expect(r.gate).toMatch(/industry/i);
  });

  it("gates seniority that is far off the candidate's level", () => {
    const intern = scoreJob(job({ title: "Product Intern", seniority: "intern" }), profile(), NOW);
    expect(intern.gate).toMatch(/seniority/i);
    const vp = scoreJob(job({ title: "VP Product", seniority: "vp" }), profile(), NOW);
    expect(vp.gate).toMatch(/seniority/i);
  });

  it("gates remote-only candidates out of onsite roles only when strictness says required", () => {
    const onsite = job({ remoteType: "onsite", locations: ["Mumbai"] });
    const soft = scoreJob(onsite, profile({ remotePref: "remote" }), NOW);
    expect(soft.gate).toBeNull();
    const hard = scoreJob(onsite, profile({ remotePref: "remote", strictness: { remote: "required" } }), NOW);
    expect(hard.gate).toMatch(/remote/i);
  });

  it("gates on required location when no job location resolves to a preferred city", () => {
    const r = scoreJob(
      job({ locations: ["Mumbai"], remoteType: "onsite" }),
      profile({ strictness: { locations: "required" } }),
      NOW,
    );
    expect(r.gate).toMatch(/location/i);
    const remoteOk = scoreJob(
      job({ locations: ["Remote - India"], remoteType: "remote" }),
      profile({ strictness: { locations: "required" } }),
      NOW,
    );
    expect(remoteOk.gate).toBeNull();
  });

  it("ranks a different function well below the target", () => {
    const eng = scoreJob(
      job({ title: "Senior Software Engineer", titleFunction: "Engineering", seniority: "senior" }),
      profile(),
      NOW,
    );
    const pm = scoreJob(job(), profile(), NOW);
    expect(eng.score).toBeLessThan(pm.score - 25);
    expect(eng.band).not.toBe("strong");
  });

  it("weights the candidate's top skills more than the tail", () => {
    const topHit = scoreJob(job({ descriptionText: "Must know SQL." }), profile(), NOW);
    const tailHit = scoreJob(job({ descriptionText: "Must know Python." }), profile(), NOW);
    expect(topHit.score).toBeGreaterThan(tailHit.score);
  });

  it("decays with age and rewards fresh postings", () => {
    const fresh = scoreJob(job(), profile(), NOW);
    const stale = scoreJob(job({ firstSeenAt: new Date("2026-08-01T00:00:00Z") }), profile(), NOW);
    expect(fresh.score).toBeGreaterThan(stale.score);
    expect(stale.reasons.join(" ")).toMatch(/weeks?|days?/i);
  });

  it("marks unverified remote eligibility in the reasons instead of hiding it", () => {
    const r = scoreJob(
      job({ locations: ["Remote"], remoteType: "remote", marketEligibility: "REMOTE_UNVERIFIED" }),
      profile(),
      NOW,
    );
    expect(r.reasons.join(" ")).toMatch(/eligibility unverified/i);
  });

  it("falls back to current title when no target roles are set", () => {
    const r = scoreJob(job(), profile({ targetRoles: [], targetFunctions: [] }), NOW);
    expect(r.band).toBe("strong");
  });

  it("never exceeds 100 or drops below 0", () => {
    const perfect = scoreJob(job(), profile(), NOW);
    expect(perfect.score).toBeLessThanOrEqual(100);
    const bad = scoreJob(
      job({
        title: "Warehouse Associate",
        titleFunction: null,
        seniority: "entry",
        descriptionText: "",
        locations: ["Jaipur"],
        remoteType: "onsite",
        firstSeenAt: new Date("2026-01-01T00:00:00Z"),
      }),
      profile(),
      NOW,
    );
    expect(bad.score).toBeGreaterThanOrEqual(0);
    expect(bad.band).toBe("weak");
  });
});
