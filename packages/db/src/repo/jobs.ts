import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../client.ts";
import { companies, jobs, userJobEvents } from "../schema/index.ts";

/**
 * Jobs repository — search (Postgres FTS + trigram typo fallback), detail,
 * and per-user event recording. User-facing reads exclude REMOVED jobs and
 * jobs the user has hidden.
 */

export interface JobSearchFilters {
  q?: string;
  remote?: "remote" | "hybrid" | "onsite";
  market?: "IN_CONFIRMED" | "REMOTE_UNVERIFIED";
  companyId?: string;
  freshDays?: number;
  includeHidden?: boolean;
  savedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface JobListItem {
  id: string;
  title: string;
  companyName: string;
  companyId: string;
  locations: string[];
  remoteType: string | null;
  marketEligibility: string;
  employmentType: string | null;
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
  status: string;
  saved: boolean;
}

const hiddenJobIds = (userId: string) =>
  sql`(select job_id from user_job_events e
       where e.user_id = ${userId} and e.type = 'HIDE'
       and not exists (select 1 from user_job_events u
                       where u.user_id = e.user_id and u.job_id = e.job_id
                       and u.type = 'SAVE' and u.created_at > e.created_at))`;

const savedJobIds = (userId: string) =>
  sql`(select distinct on (job_id) job_id from (
        select job_id, type, created_at from user_job_events
        where user_id = ${userId} and type in ('SAVE','UNSAVE')
        order by job_id, created_at desc
      ) latest where latest.type = 'SAVE'
        and latest.created_at = (select max(created_at) from user_job_events x
                                 where x.user_id = ${userId} and x.job_id = latest.job_id
                                 and x.type in ('SAVE','UNSAVE')))`;

export async function searchJobs(
  db: Db,
  userId: string,
  f: JobSearchFilters,
): Promise<{ items: JobListItem[]; total: number }> {
  const page = f.page ?? 1;
  const pageSize = Math.min(f.pageSize ?? 25, 100);

  const conds: SQL[] = [inArray(jobs.status, ["ACTIVE", "UNKNOWN"])];
  if (f.remote) conds.push(eq(jobs.remoteType, f.remote));
  if (f.market) conds.push(eq(jobs.marketEligibility, f.market));
  if (f.companyId) conds.push(eq(jobs.companyId, f.companyId));
  if (f.freshDays) {
    conds.push(gte(jobs.firstSeenAt, sql`now() - make_interval(days => ${f.freshDays})`));
  }
  if (!f.includeHidden) {
    conds.push(sql`${jobs.id} not in ${hiddenJobIds(userId)}`);
  }
  if (f.savedOnly) {
    conds.push(sql`${jobs.id} in ${savedJobIds(userId)}`);
  }

  let rank: SQL | null = null;
  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    // FTS first; word-level trigram similarity on title as typo tolerance
    // (PRD §60) — word_similarity keeps "produt manger" matching "Product
    // Manager" without letting any shared word (e.g. "Manager") match.
    conds.push(
      or(
        sql`${jobs.search} @@ websearch_to_tsquery('english', ${q})`,
        sql`word_similarity(${q}, ${jobs.title}) > 0.55`,
        ilike(companies.name, `%${q}%`),
      )!,
    );
    rank = sql`ts_rank(${jobs.search}, websearch_to_tsquery('english', ${q})) + word_similarity(${q}, ${jobs.title})`;
  }

  const where = and(...conds);

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      companyId: jobs.companyId,
      locations: jobs.locations,
      remoteType: jobs.remoteType,
      marketEligibility: jobs.marketEligibility,
      employmentType: jobs.employmentType,
      sourcePostedAt: jobs.sourcePostedAt,
      firstSeenAt: jobs.firstSeenAt,
      status: jobs.status,
      saved: sql<boolean>`(${jobs.id} in ${savedJobIds(userId)})`,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(where)
    .orderBy(rank ? desc(rank) : desc(sql`coalesce(${jobs.sourcePostedAt}, ${jobs.firstSeenAt})`))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(where)) as [{ count: number }];

  return { items: rows as JobListItem[], total: count };
}

export async function getJobDetail(db: Db, userId: string, jobId: string) {
  const [row] = await db
    .select({
      job: jobs,
      companyName: companies.name,
      companyIndustry: companies.industry,
      saved: sql<boolean>`(${jobs.id} in ${savedJobIds(userId)})`,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId));
  return row ?? null;
}

export type JobEventType = "IMPRESSION" | "OPEN" | "SAVE" | "UNSAVE" | "HIDE" | "APPLY" | "CONTACT";

export async function recordJobEvent(
  db: Db,
  userId: string,
  jobId: string,
  type: JobEventType,
  reason?: string,
): Promise<void> {
  await db.insert(userJobEvents).values({ userId, jobId, type, reason: reason ?? null });
}

export async function listCompanies(db: Db) {
  return db
    .select({
      id: companies.id,
      name: companies.name,
      industry: companies.industry,
      atsProvider: companies.atsProvider,
      status: companies.status,
      lastSuccessfulCheckAt: companies.lastSuccessfulCheckAt,
      openJobs: sql<number>`(select count(*)::int from jobs j where j.company_id = ${companies.id} and j.status = 'ACTIVE')`,
    })
    .from(companies)
    .orderBy(companies.name);
}
