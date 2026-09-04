import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  answerBank,
  applyAttempts,
  applyRules,
  companies,
  deviceTokens,
  jobMatches,
  jobs,
  profiles,
  resumes,
  userJobEvents,
  users,
} from "../schema/index.ts";
import { markApplied } from "./tracker.ts";

/** Hosted-form families the runner can drive. Everything else is "open for manual apply". */
export const SUPPORTED_APPLY_PROVIDERS = ["greenhouse", "lever", "ashby"] as const;

export type ApplyRulesInput = {
  autoQueueBand: "strong" | "good" | "none";
  queueSaved: boolean;
  dailyCap: number;
  mode: "confirm" | "handsoff";
  maxAgeDays: number;
};

const DEFAULT_RULES: ApplyRulesInput = {
  autoQueueBand: "strong",
  queueSaved: true,
  dailyCap: 10,
  mode: "confirm",
  maxAgeDays: 14,
};

export async function getRules(db: Db, userId: string): Promise<ApplyRulesInput & { exists: boolean }> {
  const [row] = await db.select().from(applyRules).where(eq(applyRules.userId, userId));
  return row ? { ...row, exists: true } : { ...DEFAULT_RULES, exists: false };
}

export async function upsertRules(db: Db, userId: string, input: ApplyRulesInput): Promise<void> {
  await db
    .insert(applyRules)
    .values({ userId, ...input })
    .onConflictDoUpdate({ target: applyRules.userId, set: { ...input } });
}

const BAND_FLOOR = { strong: 75, good: 55 } as const;

/**
 * Build the queue from rules: jobs at/above the band (or saved), live,
 * supported provider, with an apply URL, fresh enough, not hidden, not
 * already attempted or applied. Idempotent (unique user+job).
 */
export async function enqueueFromRules(db: Db, userId: string, now = new Date()): Promise<number> {
  const rules = await getRules(db, userId);
  const since = new Date(now.getTime() - rules.maxAgeDays * 86_400_000);

  const conds = [
    inArray(jobs.status, ["ACTIVE"]),
    inArray(companies.atsProvider, [...SUPPORTED_APPLY_PROVIDERS]),
    sql`${jobs.applyUrl} is not null`,
    gte(jobs.firstSeenAt, since),
    sql`not exists (select 1 from apply_attempts a where a.user_id = ${userId} and a.job_id = ${jobs.id})`,
    sql`not exists (select 1 from applications p where p.user_id = ${userId} and p.job_id = ${jobs.id} and p.status not in ('INTERESTED','SAVED'))`,
    sql`not exists (select 1 from user_job_events e where e.user_id = ${userId} and e.job_id = ${jobs.id} and e.type = 'HIDE')`,
  ];

  const bandCond =
    rules.autoQueueBand === "none"
      ? sql`false`
      : sql`exists (select 1 from job_matches m where m.user_id = ${userId} and m.job_id = ${jobs.id} and m.gate is null and m.score >= ${BAND_FLOOR[rules.autoQueueBand]})`;
  const savedCond = rules.queueSaved
    ? sql`${jobs.id} in (select job_id from (
          select distinct on (job_id) job_id, type from user_job_events
          where user_id = ${userId} and type in ('SAVE','UNSAVE')
          order by job_id, created_at desc, id desc
        ) latest where latest.type = 'SAVE')`
    : sql`false`;

  const candidates = await db
    .select({
      id: jobs.id,
      applyUrl: jobs.applyUrl,
      provider: companies.atsProvider,
      saved: savedCond,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(...conds, sql`(${bandCond} or ${savedCond})`))
    .limit(50);

  if (candidates.length === 0) return 0;
  await db
    .insert(applyAttempts)
    .values(
      candidates.map((c) => ({
        userId,
        jobId: c.id,
        reason: c.saved ? "saved" : "band",
        mode: rules.mode,
        formUrl: c.applyUrl,
        provider: c.provider,
      })),
    )
    .onConflictDoNothing();
  return candidates.length;
}

/** Queue a single job by hand (from the job page). */
export async function enqueueJob(db: Db, userId: string, jobId: string): Promise<"queued" | "exists" | "unsupported"> {
  const [row] = await db
    .select({ applyUrl: jobs.applyUrl, provider: companies.atsProvider })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId));
  if (!row?.applyUrl || !row.provider || !(SUPPORTED_APPLY_PROVIDERS as readonly string[]).includes(row.provider)) return "unsupported";
  const rules = await getRules(db, userId);
  const inserted = await db
    .insert(applyAttempts)
    .values({ userId, jobId, reason: "manual", mode: rules.mode, formUrl: row.applyUrl, provider: row.provider })
    .onConflictDoNothing()
    .returning({ id: applyAttempts.id });
  return inserted.length ? "queued" : "exists";
}

export async function listAttempts(db: Db, userId: string) {
  return db
    .select({
      id: applyAttempts.id,
      jobId: applyAttempts.jobId,
      jobTitle: jobs.title,
      companyName: companies.name,
      status: applyAttempts.status,
      reason: applyAttempts.reason,
      mode: applyAttempts.mode,
      provider: applyAttempts.provider,
      blocker: applyAttempts.blocker,
      blockerQuestion: applyAttempts.blockerQuestion,
      questions: applyAttempts.questions,
      error: applyAttempts.error,
      hasScreenshot: sql<boolean>`(${applyAttempts.screenshot} is not null)`,
      score: jobMatches.score,
      band: jobMatches.band,
      submittedAt: applyAttempts.submittedAt,
      updatedAt: applyAttempts.updatedAt,
      createdAt: applyAttempts.createdAt,
    })
    .from(applyAttempts)
    .innerJoin(jobs, eq(applyAttempts.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(jobMatches, and(eq(jobMatches.jobId, jobs.id), eq(jobMatches.userId, userId)))
    .where(eq(applyAttempts.userId, userId))
    .orderBy(
      sql`case ${applyAttempts.status} when 'BLOCKED' then 0 when 'QUEUED' then 1 when 'RUNNING' then 2 else 3 end`,
      desc(applyAttempts.updatedAt),
    )
    .limit(200);
}

export async function attemptForJob(db: Db, userId: string, jobId: string) {
  const [row] = await db
    .select()
    .from(applyAttempts)
    .where(and(eq(applyAttempts.userId, userId), eq(applyAttempts.jobId, jobId)));
  return row ?? null;
}

export async function setAttemptStatus(
  db: Db,
  userId: string,
  attemptId: string,
  status: "QUEUED" | "SKIPPED" | "CANCELLED",
): Promise<void> {
  await db
    .update(applyAttempts)
    .set({ status, blocker: null, blockerQuestion: null, error: null })
    .where(and(eq(applyAttempts.id, attemptId), eq(applyAttempts.userId, userId)));
}

export async function submittedToday(db: Db, userId: string): Promise<number> {
  const [row] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(applyAttempts)
    .where(
      and(
        eq(applyAttempts.userId, userId),
        eq(applyAttempts.status, "SUBMITTED"),
        sql`${applyAttempts.submittedAt} >= date_trunc('day', now())`,
      ),
    )) as [{ n: number }];
  return row.n;
}

// ── Runner side ─────────────────────────────────────────────────

/** Everything one runner call needs: due attempts + the identity to fill with. */
export async function runnerBundle(db: Db, userId: string, limit: number) {
  const rules = await getRules(db, userId);
  const done = await submittedToday(db, userId);
  const remaining = Math.max(0, rules.dailyCap - done);

  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const answers = await db.select({ question: answerBank.questionText, key: answerBank.questionKey, answer: answerBank.answer }).from(answerBank).where(eq(answerBank.userId, userId));
  const [resume] = await db
    .select({ id: resumes.id, fileName: resumes.fileName, mime: resumes.mime })
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isDefault, true)));

  const attempts =
    remaining === 0
      ? []
      : await db
          .select({
            id: applyAttempts.id,
            jobId: applyAttempts.jobId,
            mode: applyAttempts.mode,
            formUrl: applyAttempts.formUrl,
            provider: applyAttempts.provider,
            attempts: applyAttempts.attempts,
            jobTitle: jobs.title,
            companyName: companies.name,
            jobStatus: jobs.status,
          })
          .from(applyAttempts)
          .innerJoin(jobs, eq(applyAttempts.jobId, jobs.id))
          .innerJoin(companies, eq(jobs.companyId, companies.id))
          .where(and(eq(applyAttempts.userId, userId), eq(applyAttempts.status, "QUEUED"), notInArray(jobs.status, ["REMOVED"])))
          .orderBy(applyAttempts.createdAt)
          .limit(Math.min(limit, remaining));

  return {
    email: user?.email ?? null,
    rules: { mode: rules.mode, dailyCap: rules.dailyCap, submittedToday: done, remaining },
    profile: profile
      ? {
          fullName: profile.fullName,
          currentTitle: profile.currentTitle,
          phone: profile.phone,
          linkedinUrl: profile.linkedinUrl,
          portfolioUrl: profile.portfolioUrl,
          currentLocation: profile.currentLocation,
          noticePeriodDays: profile.noticePeriodDays,
          currentCtcLpa: profile.currentCtcLpa,
          expectedCtcLpa: profile.expectedCtcLpa,
          workAuthorization: profile.workAuthorization,
          willingToRelocate: profile.willingToRelocate,
          yearsExperience: profile.yearsExperience,
        }
      : null,
    answers,
    resume: resume ?? null,
    attempts,
  };
}

export async function markRunning(db: Db, userId: string, attemptId: string, runnerName: string): Promise<boolean> {
  const rows = await db
    .update(applyAttempts)
    .set({ status: "RUNNING", startedAt: new Date(), runnerName, attempts: sql`${applyAttempts.attempts} + 1` })
    .where(and(eq(applyAttempts.id, attemptId), eq(applyAttempts.userId, userId), eq(applyAttempts.status, "QUEUED")))
    .returning({ id: applyAttempts.id });
  return rows.length > 0;
}

export interface AttemptReport {
  status: "SUBMITTED" | "BLOCKED" | "FAILED" | "SKIPPED";
  blocker?: string | null;
  blockerQuestion?: string | null;
  questions?: string[];
  error?: string | null;
  formUrl?: string | null;
  screenshot?: Buffer | null;
}

/** Runner report. SUBMITTED mirrors into the tracker (APPLIED + snapshot + APPLY event). */
export async function reportAttempt(db: Db, userId: string, attemptId: string, report: AttemptReport): Promise<boolean> {
  const [row] = await db
    .select({ jobId: applyAttempts.jobId })
    .from(applyAttempts)
    .where(and(eq(applyAttempts.id, attemptId), eq(applyAttempts.userId, userId)));
  if (!row) return false;

  // A RUNNING attempt that hits a transient failure goes back to QUEUED up to 3 tries.
  await db
    .update(applyAttempts)
    .set({
      status: report.status,
      blocker: report.blocker ?? null,
      blockerQuestion: report.blockerQuestion ?? null,
      questions: report.questions ?? [],
      error: report.error ?? null,
      formUrl: report.formUrl ?? undefined,
      screenshot: report.screenshot ?? null,
      submittedAt: report.status === "SUBMITTED" ? new Date() : null,
    })
    .where(eq(applyAttempts.id, attemptId));

  if (report.status === "SUBMITTED") {
    await markApplied(db, userId, row.jobId);
    await db.insert(userJobEvents).values({ userId, jobId: row.jobId, type: "APPLY", reason: "runner" });
  }
  return true;
}

export async function screenshotFor(db: Db, userId: string, attemptId: string) {
  const [row] = await db
    .select({ screenshot: applyAttempts.screenshot })
    .from(applyAttempts)
    .where(and(eq(applyAttempts.id, attemptId), eq(applyAttempts.userId, userId)));
  return row?.screenshot ?? null;
}

// ── Device tokens ───────────────────────────────────────────────

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Returns the plaintext once; only the hash is stored. */
export async function createDeviceToken(db: Db, userId: string, name: string): Promise<{ id: string; token: string }> {
  const token = `sfr_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(deviceTokens)
    .values({ userId, name: name.slice(0, 60), tokenHash: hashToken(token) })
    .returning({ id: deviceTokens.id });
  return { id: row!.id, token };
}

export async function listDeviceTokens(db: Db, userId: string) {
  return db
    .select({ id: deviceTokens.id, name: deviceTokens.name, lastUsedAt: deviceTokens.lastUsedAt, createdAt: deviceTokens.createdAt })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)))
    .orderBy(desc(deviceTokens.createdAt));
}

export async function revokeDeviceToken(db: Db, userId: string, id: string): Promise<void> {
  await db.update(deviceTokens).set({ revokedAt: new Date() }).where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)));
}

/** Resolve a bearer token to its user; touches lastUsedAt. */
export async function userForDeviceToken(db: Db, token: string): Promise<{ userId: string; name: string } | null> {
  if (!token.startsWith("sfr_")) return null;
  const [row] = await db
    .select({ id: deviceTokens.id, userId: deviceTokens.userId, name: deviceTokens.name })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.tokenHash, hashToken(token)), isNull(deviceTokens.revokedAt)));
  if (!row) return null;
  await db.update(deviceTokens).set({ lastUsedAt: new Date() }).where(eq(deviceTokens.id, row.id));
  return { userId: row.userId, name: row.name };
}
