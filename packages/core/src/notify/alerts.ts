import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sifarish/db";
import { logger } from "../logger.ts";
import type { MatchBand } from "../matching/matching-engine.ts";
import { escapeHtml, type Notifier, type NotifyTarget } from "./notifier.ts";

/**
 * Alerts: instant (per tick, new jobs at/above a band, never repeated per
 * job) and digest (once a day at the user's hour, last 24h). Both are
 * idempotent under retries: instant dedups on the alerts table, digest on
 * last_digest_at in the user's day.
 */

const BAND_FLOOR: Record<MatchBand, number> = { strong: 75, good: 55, maybe: 35, weak: 0 };

export interface AlertJob {
  jobId: string;
  title: string;
  companyName: string;
  score: number;
  band: MatchBand;
  reasons: string[];
  locations: string[];
}

export interface AlertDeps {
  db: Db;
  notifier: Notifier;
  appUrl: string;
  tz: string;
}

async function prefsAndTarget(db: Db, userId: string) {
  const [[prefs], [user]] = await Promise.all([
    db.select().from(schema.alertPreferences).where(eq(schema.alertPreferences.userId, userId)),
    db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)),
  ]);
  const p = prefs ?? {
    userId,
    channel: "email" as const,
    instantEnabled: true,
    instantMinBand: "strong" as const,
    digestEnabled: true,
    digestMinBand: "good" as const,
    digestHour: 9,
    telegramChatId: null,
    lastDigestAt: null,
  };
  let target: NotifyTarget = { channel: "none" };
  if (p.channel === "email" && user?.email) target = { channel: "email", to: user.email };
  if (p.channel === "telegram" && p.telegramChatId) target = { channel: "telegram", chatId: p.telegramChatId };
  return { prefs: p, target };
}

/** Local date string (YYYY-MM-DD) and hour in tz, without a date library. */
export function localParts(date: Date, tz: string): { day: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

export function renderJobs(jobs: AlertJob[], appUrl: string): { text: string; html: string } {
  const text = jobs
    .map(
      (j) =>
        `${j.score} ${j.band.toUpperCase()}  ${j.title} at ${j.companyName}` +
        (j.locations.length ? ` (${j.locations.slice(0, 2).join(", ")})` : "") +
        `\n   ${j.reasons.slice(0, 2).join("; ")}\n   ${appUrl}/jobs/${j.jobId}`,
    )
    .join("\n\n");
  const html = jobs
    .map(
      (j) =>
        `<b>${j.score}</b> ${escapeHtml(j.band)} · <a href="${appUrl}/jobs/${j.jobId}">${escapeHtml(j.title)}</a> at ${escapeHtml(j.companyName)}` +
        (j.locations.length ? ` (${escapeHtml(j.locations.slice(0, 2).join(", "))})` : "") +
        `\n<i>${escapeHtml(j.reasons.slice(0, 2).join("; "))}</i>`,
    )
    .join("\n\n");
  return { text, html };
}

async function candidateJobs(
  db: Db,
  userId: string,
  minBand: MatchBand,
  since: Date,
  excludeAlerted: "instant" | null,
): Promise<AlertJob[]> {
  const conds = [
    eq(schema.jobMatches.userId, userId),
    isNull(schema.jobMatches.gate),
    gte(schema.jobMatches.score, BAND_FLOOR[minBand]),
    inArray(schema.jobs.status, ["ACTIVE", "UNKNOWN"]),
    gte(schema.jobs.firstSeenAt, since),
  ];
  if (excludeAlerted) {
    conds.push(
      sql`not exists (select 1 from alerts a where a.user_id = ${userId} and a.job_id = ${schema.jobs.id} and a.kind = ${excludeAlerted})`,
    );
  }
  const rows = await db
    .select({
      jobId: schema.jobs.id,
      title: schema.jobs.title,
      companyName: schema.companies.name,
      score: schema.jobMatches.score,
      band: schema.jobMatches.band,
      reasons: schema.jobMatches.reasons,
      locations: schema.jobs.locations,
    })
    .from(schema.jobMatches)
    .innerJoin(schema.jobs, eq(schema.jobMatches.jobId, schema.jobs.id))
    .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
    .where(and(...conds))
    .orderBy(desc(schema.jobMatches.score))
    .limit(30);
  return rows as AlertJob[];
}

/** One message per tick with every not-yet-alerted new job at/above the band. */
export async function dispatchInstant(deps: AlertDeps, userId: string, now = new Date()): Promise<number> {
  const { prefs, target } = await prefsAndTarget(deps.db, userId);
  if (!prefs.instantEnabled || target.channel === "none") return 0;

  const since = new Date(now.getTime() - 24 * 3600_000);
  const jobs = await candidateJobs(deps.db, userId, prefs.instantMinBand, since, "instant");
  if (jobs.length === 0) return 0;

  const { text, html } = renderJobs(jobs, deps.appUrl);
  const subject =
    jobs.length === 1
      ? `New ${jobs[0]!.band} match: ${jobs[0]!.title} at ${jobs[0]!.companyName}`
      : `${jobs.length} new matches on Sifarish`;
  const out = await deps.notifier.send(target, { subject, text, html });
  if (!out.ok) {
    logger.warn({ userId, error: out.error }, "instant alert failed");
    return 0;
  }
  await deps.db
    .insert(schema.alerts)
    .values(jobs.map((j) => ({ userId, jobId: j.jobId, kind: "instant" as const, channel: target.channel })))
    .onConflictDoNothing();
  return jobs.length;
}

/** Once per local day, at or after digest_hour. Returns jobs included, or -1 when not due. */
export async function dispatchDigest(
  deps: AlertDeps,
  userId: string,
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<number> {
  const { prefs, target } = await prefsAndTarget(deps.db, userId);
  if (target.channel === "none") return -1;
  if (!opts.force) {
    if (!prefs.digestEnabled) return -1;
    const { day, hour } = localParts(now, deps.tz);
    if (hour < prefs.digestHour) return -1;
    if (prefs.lastDigestAt && localParts(prefs.lastDigestAt, deps.tz).day === day) return -1;
  }

  const since = new Date(now.getTime() - 24 * 3600_000);
  const jobs = await candidateJobs(deps.db, userId, prefs.digestMinBand, since, null);

  const subject =
    jobs.length === 0
      ? "Sifarish daily: nothing new above your bar"
      : `Sifarish daily: ${jobs.length} ${jobs.length === 1 ? "match" : "matches"} since yesterday`;
  const body = jobs.length === 0
    ? { text: `No new ${prefs.digestMinBand}+ matches in the last 24 hours.\n${deps.appUrl}/feed`, html: `No new ${prefs.digestMinBand}+ matches in the last 24 hours. <a href="${deps.appUrl}/feed">Open the feed</a>` }
    : renderJobs(jobs, deps.appUrl);

  const out = await deps.notifier.send(target, { subject, ...body });
  if (!out.ok) {
    logger.warn({ userId, error: out.error }, "digest failed");
    return -1;
  }
  if (!opts.force) {
    await deps.db
      .insert(schema.alertPreferences)
      .values({ userId, lastDigestAt: now })
      .onConflictDoUpdate({ target: schema.alertPreferences.userId, set: { lastDigestAt: now } });
  }
  await deps.db.insert(schema.alerts).values({ userId, jobId: null, kind: "digest", channel: target.channel });
  return jobs.length;
}
