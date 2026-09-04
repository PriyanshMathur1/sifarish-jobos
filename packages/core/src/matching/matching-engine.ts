import {
  normalizeLocation,
  normalizeTitle,
  normalizeSkill,
  seniorityOf,
  titleSimilarity,
  type Seniority,
} from "../taxonomy/taxonomy.ts";
import { extractSkills } from "./skills-in-text.ts";

/**
 * MatchingEngine — deterministic, explainable job scoring (AUTOPILOT-PLAN A2).
 *
 * Pure: (job, profile, now) → {score, band, reasons, gate}. No I/O, no
 * randomness, no model. Hard gates run first and zero the score; then five
 * weighted terms add up to at most 100. Every term contributes a sentence
 * the UI shows verbatim, so a user can always see WHY a job ranked where
 * it did, and can fix the profile field that drove it.
 *
 * Weights (sum 100): title 35 · skills 30 · seniority 15 · location 10 · freshness 10.
 */

export type MatchBand = "strong" | "good" | "maybe" | "weak";

export interface MatchProfile {
  currentTitle: string | null;
  yearsExperience: number | null;
  /** canonical skill names, strongest first (rank matters) */
  skills: string[];
  /** preferred cities (raw strings; normalized here) */
  locations: string[];
  targetRoles: string[];
  targetFunctions: string[];
  remotePref: "remote" | "hybrid" | "office" | "any";
  excludedCompanies: string[];
  industriesExcluded: string[];
  /** field → required|preferred (PRD §15). Only "required" changes behaviour: it gates. */
  strictness: Record<string, "required" | "preferred">;
}

export interface MatchJob {
  id: string;
  title: string;
  seniority: string;
  titleFunction: string | null;
  descriptionText: string | null;
  locations: string[];
  remoteType: "remote" | "hybrid" | "onsite" | null;
  marketEligibility: "IN_CONFIRMED" | "REMOTE_UNVERIFIED";
  companyName: string;
  companyIndustry: string | null;
  firstSeenAt: Date;
  sourcePostedAt?: Date | null;
}

export interface MatchResult {
  score: number;
  band: MatchBand;
  reasons: string[];
  /** non-null when a hard gate zeroed the score; the reason text */
  gate: string | null;
  parts: { title: number; skills: number; seniority: number; location: number; freshness: number };
}

const WEIGHTS = { title: 35, skills: 30, seniority: 15, location: 10, freshness: 10 } as const;

const LADDER: Record<Seniority, number> = {
  intern: 0,
  entry: 1,
  mid: 2,
  senior: 3,
  manager: 3,
  lead: 4,
  director: 5,
  vp: 6,
  executive: 7,
};

const MAX_SKILLS_CONSIDERED = 8;

export function bandOf(score: number): MatchBand {
  if (score >= 75) return "strong";
  if (score >= 55) return "good";
  if (score >= 35) return "maybe";
  return "weak";
}

function seniorityFromYears(years: number): Seniority {
  if (years <= 1) return "entry";
  if (years <= 4) return "mid";
  if (years <= 8) return "senior";
  if (years <= 12) return "lead";
  return "director";
}

/** Candidate level: years of experience when known, else the current title's markers. */
export function candidateSeniority(p: MatchProfile): Seniority {
  if (p.yearsExperience != null && p.yearsExperience >= 0)
    return seniorityFromYears(p.yearsExperience);
  if (p.currentTitle) return seniorityOf(p.currentTitle);
  return "mid";
}

function levelOf(s: string): number {
  return LADDER[s as Seniority] ?? LADDER.mid;
}

const norm = (s: string): string => s.trim().toLowerCase();

function gated(reason: string): MatchResult {
  return {
    score: 0,
    band: "weak",
    reasons: [reason],
    gate: reason,
    parts: { title: 0, skills: 0, seniority: 0, location: 0, freshness: 0 },
  };
}

function preferredCities(p: MatchProfile): Set<string> {
  const out = new Set<string>();
  for (const raw of p.locations) {
    const n = normalizeLocation(raw);
    if (n.city) out.add(n.city);
  }
  return out;
}

function ageLabel(days: number): string {
  if (days < 1) return "new today";
  if (days < 2) return "1 day old";
  if (days < 14) return `${Math.floor(days)} days old`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} old`;
}

export function scoreJob(job: MatchJob, profile: MatchProfile, now: Date = new Date()): MatchResult {
  // ── Hard gates ────────────────────────────────────────────────
  if (profile.excludedCompanies.some((c) => norm(c) === norm(job.companyName)))
    return gated(`Company excluded in your preferences (${job.companyName})`);

  if (
    job.companyIndustry &&
    profile.industriesExcluded.some((i) => norm(i) === norm(job.companyIndustry ?? ""))
  )
    return gated(`Industry excluded in your preferences (${job.companyIndustry})`);

  const candLevel = levelOf(candidateSeniority(profile));
  const jobLevel = levelOf(job.seniority);
  const levelGap = Math.abs(candLevel - jobLevel);
  if (levelGap >= 3)
    return gated(
      `Seniority is far from your level (${job.seniority} role, you are ${candidateSeniority(profile)})`,
    );

  const cities = preferredCities(profile);
  const jobCities = job.locations.map((l) => normalizeLocation(l));
  const cityHit = jobCities.find((l) => l.city && cities.has(l.city));
  const isRemote = job.remoteType === "remote" || jobCities.some((l) => l.kind === "remote");

  if (profile.strictness.remote === "required" && profile.remotePref === "remote" && !isRemote)
    return gated(`Not remote, and remote is required in your preferences`);

  if (profile.strictness.locations === "required" && cities.size > 0 && !cityHit && !isRemote)
    return gated(
      `Location required: ${[...cities].join(", ")}; this role is ${job.locations.join(" / ") || "unspecified"}`,
    );

  const reasons: string[] = [];

  // ── Title (35) ────────────────────────────────────────────────
  const targets = profile.targetRoles.length
    ? profile.targetRoles
    : profile.currentTitle
      ? [profile.currentTitle]
      : [];
  let titleSim = 0;
  let bestTarget: string | null = null;
  for (const t of targets) {
    const s = titleSimilarity(job.title, t);
    if (s > titleSim) {
      titleSim = s;
      bestTarget = t;
    }
  }
  const targetFns = new Set(
    (profile.targetFunctions.length
      ? profile.targetFunctions
      : profile.currentTitle
        ? [normalizeTitle(profile.currentTitle).function ?? ""]
        : []
    )
      .filter(Boolean)
      .map(norm),
  );
  const fnKnown = job.titleFunction != null;
  const fnMatch = fnKnown && targetFns.has(norm(job.titleFunction ?? ""));
  if (fnMatch) titleSim = Math.max(titleSim, 0.5);
  const titlePts = WEIGHTS.title * titleSim;
  if (titleSim >= 0.8 && bestTarget) reasons.push(`Title matches "${bestTarget}"`);
  else if (titleSim >= 0.5 && bestTarget) reasons.push(`Title is close to "${bestTarget}"`);
  else if (fnMatch) reasons.push(`Same function (${job.titleFunction})`);
  else if (fnKnown && targetFns.size > 0) reasons.push(`Different function (${job.titleFunction})`);
  else reasons.push(`Title does not match your target roles`);

  // ── Skills (30) ───────────────────────────────────────────────
  const topSkills = profile.skills.slice(0, MAX_SKILLS_CONSIDERED).map(normalizeSkill);
  const jobSkills = new Set(extractSkills(job.descriptionText ?? "", topSkills));
  let weightTotal = 0;
  let weightHit = 0;
  const hits: string[] = [];
  topSkills.forEach((s, i) => {
    const w = 1 / (1 + 0.25 * i);
    weightTotal += w;
    if (jobSkills.has(s)) {
      weightHit += w;
      hits.push(s);
    }
  });
  const skillRatio = weightTotal > 0 ? weightHit / weightTotal : 0;
  const skillPts = WEIGHTS.skills * skillRatio;
  if (hits.length > 0)
    reasons.push(`${hits.length} of your top ${topSkills.length} skills mentioned: ${hits.join(", ")}`);
  else if (topSkills.length > 0) reasons.push(`None of your top skills are mentioned`);

  // ── Seniority (15) ────────────────────────────────────────────
  const seniorityRatio = levelGap === 0 ? 1 : levelGap === 1 ? 0.7 : 0.3;
  const seniorityPts = WEIGHTS.seniority * seniorityRatio;
  if (levelGap === 0) reasons.push(`Seniority fits (${job.seniority})`);
  else reasons.push(`Seniority is ${levelGap === 1 ? "one" : "two"} step${levelGap === 1 ? "" : "s"} off (${job.seniority})`);

  // ── Location (10) ─────────────────────────────────────────────
  let locRatio: number;
  if (cityHit) {
    locRatio = 1;
    reasons.push(`In ${cityHit.city}`);
  } else if (isRemote) {
    locRatio = profile.remotePref === "office" ? 0.5 : profile.remotePref === "hybrid" ? 0.8 : 1;
    if (job.marketEligibility === "REMOTE_UNVERIFIED") {
      locRatio = Math.min(locRatio, 0.7);
      reasons.push(`Remote, eligibility unverified`);
    } else reasons.push(`Remote (India-eligible)`);
  } else if (jobCities.some((l) => l.country === "IN")) {
    locRatio = 0.4;
    reasons.push(`In ${job.locations.join(" / ")}, not one of your preferred locations`);
  } else {
    locRatio = 0.5;
    reasons.push(`Location unclear (${job.locations.join(" / ") || "unspecified"})`);
  }
  const locPts = WEIGHTS.location * locRatio;

  // ── Freshness (10) ────────────────────────────────────────────
  const seen = job.sourcePostedAt ?? job.firstSeenAt;
  const days = Math.max(0, (now.getTime() - seen.getTime()) / 86_400_000);
  const freshRatio = days <= 1 ? 1 : days <= 3 ? 0.8 : days <= 7 ? 0.6 : days <= 14 ? 0.4 : days <= 30 ? 0.2 : 0.1;
  const freshPts = WEIGHTS.freshness * freshRatio;
  reasons.push(days < 1 ? `New today` : `Listing is ${ageLabel(days)}`);

  let score = titlePts + skillPts + seniorityPts + locPts + freshPts;
  // A known, non-target function cannot rank above "maybe": the title term is
  // already ~0, this stops a skills-heavy JD in the wrong function from
  // reading as a good match.
  if (fnKnown && targetFns.size > 0 && !fnMatch) score = Math.min(score, 50);

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    band: bandOf(score),
    reasons,
    gate: null,
    parts: {
      title: Math.round(titlePts),
      skills: Math.round(skillPts),
      seniority: Math.round(seniorityPts),
      location: Math.round(locPts),
      freshness: Math.round(freshPts),
    },
  };
}
