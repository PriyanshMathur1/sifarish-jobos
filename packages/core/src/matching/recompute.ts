import { matchesRepo, type Db } from "@sifarish/db";
import { logger } from "../logger.ts";
import { scoreJob, type MatchProfile } from "./matching-engine.ts";

/**
 * Recompute persisted matches. Two entry points, same core:
 * - after a company refresh (new/updated jobs): every profiled user × that company's live jobs
 * - after a profile/preferences save: that user × every live job
 *
 * Idempotent (upsert keyed on user+job), so queue retries are safe.
 */

type Inputs = Awaited<ReturnType<typeof matchesRepo.matchInputsForUser>>;

export function toMatchProfile(inputs: Inputs): MatchProfile | null {
  const { profile, prefs } = inputs;
  if (!profile) return null;
  return {
    currentTitle: profile.currentTitle,
    yearsExperience: profile.yearsExperience,
    skills: profile.skills,
    locations: prefs?.locations?.length ? prefs.locations : profile.locations,
    targetRoles: prefs?.targetRoles ?? [],
    targetFunctions: prefs?.targetFunctions ?? [],
    remotePref: prefs?.remotePref ?? "any",
    excludedCompanies: prefs?.excludedCompanies ?? [],
    industriesExcluded: prefs?.industriesExcluded ?? [],
    strictness: prefs?.strictness ?? {},
  };
}

async function scoreScope(
  db: Db,
  userIds: string[],
  scope: { companyId?: string; jobIds?: string[] },
  now: Date,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const candidates = await matchesRepo.scorableJobs(db, scope);
  if (candidates.length === 0) return 0;

  let written = 0;
  for (const userId of userIds) {
    const profile = toMatchProfile(await matchesRepo.matchInputsForUser(db, userId));
    if (!profile) continue;
    const rows = candidates.map((j) => {
      const r = scoreJob(j, profile, now);
      return {
        userId,
        jobId: j.id,
        score: r.score,
        band: r.band,
        reasons: r.reasons,
        gate: r.gate,
        parts: r.parts,
      };
    });
    await matchesRepo.upsertMany(db, rows);
    written += rows.length;
  }
  return written;
}

/** After ingestion touched a company. */
export async function recomputeForCompany(db: Db, companyId: string, now = new Date()): Promise<number> {
  const userIds = await matchesRepo.userIdsWithProfiles(db);
  const n = await scoreScope(db, userIds, { companyId }, now);
  if (n > 0) logger.info({ companyId, matches: n }, "matches recomputed for company");
  return n;
}

/** After a user changed profile or preferences. */
export async function recomputeForUser(db: Db, userId: string, now = new Date()): Promise<number> {
  const n = await scoreScope(db, [userId], {}, now);
  logger.info({ userId, matches: n }, "matches recomputed for user");
  return n;
}
