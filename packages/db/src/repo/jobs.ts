import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../client.ts";
import { companies, jobs, userJobEvents } from "../schema/index.ts";

/**
 * Jobs repository — search (Postgres FTS + trigram typo fallback), detail,
 * and per-user event recording.
 *
 * Visibility rules: LIST reads exclude REMOVED jobs and jobs the user has
 * hidden (a later SAVE un-hides — deliberate: saving signals renewed
 * interest). DETAIL reads stay accessible by direct URL for any status —
 * candidates must be able to revisit removed/hidden listings (PRD §32/§85);
 * the page badges the status honestly.
 */

export interface JobSearchFilters {
  q?: string;
  remote?: "remote" | "hybrid" | "onsite";
  market?: "IN_CONFIRMED" | "REMOTE_UNVERIFIED";
  companyId?: string;
  employmentType?: string;
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

/** Jobs whose LATEST save/unsave event is a SAVE (ties broken by event id, which is time-ordered UUIDv7). */
const savedJobIds = (userId: string) =>
  sql`(select job_id from (
        select distinct on (job_id) job_id, type from user_job_events
        where user_id = ${userId} and type in ('SAVE','UNSAVE')
        order by job_id, created_at desc, id desc
      ) latest where latest.type = 'SAVE')`;

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
  if (f.employmentType) conds.push(ilike(jobs.employmentType, `%${f.employmentType}%`));
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

/**
 * OPEN is recorded at most once per (user, job) per hour — server-component
 * renders re-fire on every revalidation and must not inflate counts.
 */
export async function recordOpenOnce(db: Db, userId: string, jobId: string): Promise<void> {
  await db.execute(sql`
    insert into user_job_events (id, user_id, job_id, type)
    select gen_random_uuid(), ${userId}, ${jobId}, 'OPEN'
    where not exists (
      select 1 from user_job_events
      where user_id = ${userId} and job_id = ${jobId} and type = 'OPEN'
      and created_at > now() - interval '1 hour'
    )`);
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
