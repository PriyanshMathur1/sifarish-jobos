import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../client.ts";
import { candidatePreferences, companies, jobMatches, jobs, profiles } from "../schema/index.ts";

/**
 * Matches repository — persisted MatchingEngine output plus the inputs the
 * engine needs. Owner-scoped like every other user-owned table.
 */

export type MatchBand = "strong" | "good" | "maybe" | "weak";

export interface MatchUpsert {
  userId: string;
  jobId: string;
  score: number;
  band: MatchBand;
  reasons: string[];
  gate: string | null;
  parts: { title: number; skills: number; seniority: number; location: number; freshness: number };
}

export async function upsertMany(db: Db, rows: MatchUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date();
  // Chunk so a company with hundreds of jobs never builds an oversized statement.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, computedAt: now }));
    await db
      .insert(jobMatches)
      .values(chunk)
      .onConflictDoUpdate({
        target: [jobMatches.userId, jobMatches.jobId],
        set: {
          score: sql`excluded.score`,
          band: sql`excluded.band`,
          reasons: sql`excluded.reasons`,
          gate: sql`excluded.gate`,
          parts: sql`excluded.parts`,
          computedAt: now,
        },
      });
  }
}

/** Users who have a profile — the only ones worth scoring for. */
export async function userIdsWithProfiles(db: Db): Promise<string[]> {
  const rows = await db.select({ userId: profiles.userId }).from(profiles);
  return rows.map((r) => r.userId);
}

/** Everything the engine needs about a user, in one read. */
export async function matchInputsForUser(db: Db, userId: string) {
  const [[profile], [prefs]] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.userId, userId)),
    db.select().from(candidatePreferences).where(eq(candidatePreferences.userId, userId)),
  ]);
  return { profile: profile ?? null, prefs: prefs ?? null };
}

export interface ScorableJob {
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
  sourcePostedAt: Date | null;
}

/** Live jobs to score: all of them, one company's, or an explicit id list. */
export async function scorableJobs(
  db: Db,
  scope: { companyId?: string; jobIds?: string[] } = {},
): Promise<ScorableJob[]> {
  const conds: SQL[] = [inArray(jobs.status, ["ACTIVE", "UNKNOWN"])];
  if (scope.companyId) conds.push(eq(jobs.companyId, scope.companyId));
  if (scope.jobIds) {
    if (scope.jobIds.length === 0) return [];
    conds.push(inArray(jobs.id, scope.jobIds));
  }
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      seniority: jobs.seniority,
      titleFunction: jobs.titleFunction,
      descriptionText: jobs.descriptionText,
      locations: jobs.locations,
      remoteType: jobs.remoteType,
      marketEligibility: jobs.marketEligibility,
      companyName: companies.name,
      companyIndustry: companies.industry,
      firstSeenAt: jobs.firstSeenAt,
      sourcePostedAt: jobs.sourcePostedAt,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(...conds));
  return rows;
}

export interface FeedItem {
  id: string;
  title: string;
  companyName: string;
  companyId: string;
  locations: string[];
  remoteType: string | null;
  marketEligibility: string;
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
  score: number;
  band: MatchBand;
  reasons: string[];
  saved: boolean;
}

export interface FeedFilters {
  minBand?: MatchBand;
  /** only jobs first seen within N days */
  sinceDays?: number;
  limit?: number;
}

const BAND_FLOOR: Record<MatchBand, number> = { strong: 75, good: 55, maybe: 35, weak: 0 };

/** Jobs whose LATEST save/unsave event is a SAVE. Mirrors repo/jobs.ts. */
const savedJobIds = (userId: string) =>
  sql`(select job_id from (
        select distinct on (job_id) job_id, type from user_job_events
        where user_id = ${userId} and type in ('SAVE','UNSAVE')
        order by job_id, created_at desc, id desc
      ) latest where latest.type = 'SAVE')`;

const hiddenJobIds = (userId: string) =>
  sql`(select job_id from user_job_events e
       where e.user_id = ${userId} and e.type = 'HIDE'
       and not exists (select 1 from user_job_events u
                       where u.user_id = e.user_id and u.job_id = e.job_id
                       and u.type = 'SAVE' and u.created_at > e.created_at))`;

/** The "For you" feed: scored, not hidden, not removed, best first. */
export async function feedForUser(db: Db, userId: string, f: FeedFilters = {}): Promise<FeedItem[]> {
  const conds: SQL[] = [
    eq(jobMatches.userId, userId),
    inArray(jobs.status, ["ACTIVE", "UNKNOWN"]),
    sql`${jobs.id} not in ${hiddenJobIds(userId)}`,
    sql`${jobMatches.gate} is null`,
  ];
  if (f.minBand) conds.push(gte(jobMatches.score, BAND_FLOOR[f.minBand]));
  if (f.sinceDays) conds.push(gte(jobs.firstSeenAt, sql`now() - make_interval(days => ${f.sinceDays})`));

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      companyId: jobs.companyId,
      locations: jobs.locations,
      remoteType: jobs.remoteType,
      marketEligibility: jobs.marketEligibility,
      sourcePostedAt: jobs.sourcePostedAt,
      firstSeenAt: jobs.firstSeenAt,
      score: jobMatches.score,
      band: jobMatches.band,
      reasons: jobMatches.reasons,
      saved: sql<boolean>`(${jobs.id} in ${savedJobIds(userId)})`,
    })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobMatches.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(...conds))
    .orderBy(desc(jobMatches.score), desc(jobs.firstSeenAt))
    .limit(Math.min(f.limit ?? 50, 200));
  return rows as FeedItem[];
}

export async function matchForJob(db: Db, userId: string, jobId: string) {
  const [row] = await db
    .select()
    .from(jobMatches)
    .where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobId, jobId)));
  return row ?? null;
}

/** Count per band for the dashboard / digest header. */
export async function bandCounts(db: Db, userId: string, sinceDays: number) {
  const rows = await db
    .select({ band: jobMatches.band, n: sql<number>`count(*)::int` })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobMatches.jobId, jobs.id))
    .where(
      and(
        eq(jobMatches.userId, userId),
        inArray(jobs.status, ["ACTIVE", "UNKNOWN"]),
        sql`${jobMatches.gate} is null`,
        gte(jobs.firstSeenAt, sql`now() - make_interval(days => ${sinceDays})`),
      ),
    )
    .groupBy(jobMatches.band);
  const out: Record<MatchBand, number> = { strong: 0, good: 0, maybe: 0, weak: 0 };
  for (const r of rows) out[r.band as MatchBand] = r.n;
  return out;
}
