import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Db } from "@jobos/db";
import { schema } from "@jobos/db";
import type { SafeFetcher } from "../fetch/safe-fetcher.ts";
import { getProvider } from "../providers/registry.ts";
import type { ProviderId } from "../providers/types.ts";
import { classifyMarket } from "../market/market-filter.ts";
import { enrichJob } from "./normalize-job.ts";
import { logger } from "../logger.ts";

/**
 * Ingestion — refreshCompany is the seam (SPEC §2). One company, one
 * provider listing, full state machine:
 *
 *   unseen id                  → NEW (insert + version 1)
 *   hash changed               → UPDATED (update + version++)
 *   hash same                  → SAME (touch last_seen_at only)
 *   absent, was ACTIVE         → UNKNOWN (strike 1)
 *   absent, was UNKNOWN        → REMOVED (strike 2)
 *   present again, was REMOVED → ACTIVE (reactivation, no duplicate)
 *   provider error             → nothing removed, crawl_error recorded
 *
 * Market filter (grill G2) applies before storage; rejected jobs are
 * counted, never stored. Idempotent: re-running with the same listing is
 * all-SAME.
 */

export interface IngestDeps {
  db: Db;
  fetcher: SafeFetcher;
  marketCountries: string[];
}

export interface RefreshOutcome {
  new: number;
  updated: number;
  same: number;
  unknown: number;
  removed: number;
  reactivated: number;
  rejectedMarket: number;
  error: string | null;
}

const zero = (): RefreshOutcome => ({
  new: 0,
  updated: 0,
  same: 0,
  unknown: 0,
  removed: 0,
  reactivated: 0,
  rejectedMarket: 0,
  error: null,
});

export async function refreshCompany(
  deps: IngestDeps,
  companyId: string,
  runId: string | null,
): Promise<RefreshOutcome> {
  const { db, fetcher } = deps;
  const outcome = zero();
  const now = new Date();

  const [company] = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId));
  if (!company) {
    outcome.error = "company not found";
    await finalizeRun(db, runId, outcome);
    return outcome;
  }
  if (!company.atsProvider || !company.atsIdentifier) {
    outcome.error = "no provider configured";
    await finalizeRun(db, runId, outcome);
    return outcome;
  }

  const provider = getProvider(company.atsProvider as ProviderId);
  const listing = await provider.listJobs(fetcher, {
    atsIdentifier: company.atsIdentifier,
    ...(company.careersUrl ? { careersUrl: company.careersUrl } : {}),
  });

  if (!listing.ok) {
    outcome.error = listing.error.kind;
    await db
      .update(schema.companies)
      .set({
        lastCheckedAt: now,
        consecutiveFailures: sql`${schema.companies.consecutiveFailures} + 1`,
      })
      .where(eq(schema.companies.id, companyId));
    await db.insert(schema.crawlErrors).values({
      runId,
      companyId,
      provider: company.atsProvider,
      stage: "listJobs",
      error: JSON.stringify(listing.error),
    });
    await finalizeRun(db, runId, outcome);
    return outcome;
  }

  const seenExternalIds: string[] = [];

  for (const raw of listing.value) {
    const normalized = provider.normalize(raw);
    if (!normalized.title) continue; // broken record: never exposed (PRD §118)

    const eligibility = classifyMarket(
      normalized.locations,
      normalized.remoteType,
      deps.marketCountries,
    );
    if (eligibility === "REJECT") {
      outcome.rejectedMarket++;
      continue;
    }

    seenExternalIds.push(normalized.externalId);
    const enriched = enrichJob(normalized);

    const [existing] = await db
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.companyId, companyId),
          eq(schema.jobs.sourceProvider, provider.id),
          eq(schema.jobs.externalId, normalized.externalId),
        ),
      );

    const jobFields = {
      title: normalized.title,
      normalizedTitle: enriched.normalizedTitle,
      titleFunction: enriched.titleFunction,
      seniority: enriched.seniority,
      descriptionHtml: enriched.descriptionHtml,
      descriptionText: enriched.descriptionText,
      locations: normalized.locations,
      remoteType: normalized.remoteType,
      marketEligibility: eligibility,
      employmentType: normalized.employmentType,
      salaryMin: normalized.salary ? Math.round(normalized.salary.min) : null,
      salaryMax: normalized.salary ? Math.round(normalized.salary.max) : null,
      salaryCurrency: normalized.salary?.currency ?? null,
      salaryPeriod: normalized.salary?.period ?? null,
      applyUrl: normalized.applyUrl,
      sourceUrl: normalized.sourceUrl,
      sourcePostedAt: normalized.sourcePostedAt,
      sourceUpdatedAt: normalized.sourceUpdatedAt,
      contentHash: enriched.contentHash,
    };

    if (!existing) {
      const [inserted] = await db
        .insert(schema.jobs)
        .values({
          companyId,
          externalId: normalized.externalId,
          sourceProvider: provider.id,
          ...jobFields,
          status: "ACTIVE",
          firstSeenAt: now,
          lastSeenAt: now,
          lastCheckedAt: now,
          version: 1,
        })
        .returning({ id: schema.jobs.id });
      await db.insert(schema.jobVersions).values({
        jobId: inserted!.id,
        version: 1,
        contentHash: enriched.contentHash,
        snapshot: raw.payload as Record<string, unknown>,
      });
      await db.insert(schema.jobSources).values({
        jobId: inserted!.id,
        provider: provider.id,
        externalId: normalized.externalId,
        url: normalized.sourceUrl,
      });
      outcome.new++;
      continue;
    }

    const wasRemoved = existing.status === "REMOVED";
    const hashChanged = existing.contentHash !== enriched.contentHash;

    if (!hashChanged && !wasRemoved && existing.status === "ACTIVE") {
      await db
        .update(schema.jobs)
        .set({ lastSeenAt: now, lastCheckedAt: now })
        .where(eq(schema.jobs.id, existing.id));
      outcome.same++;
      continue;
    }

    const newVersion = hashChanged ? existing.version + 1 : existing.version;
    await db
      .update(schema.jobs)
      .set({
        ...jobFields,
        status: "ACTIVE",
        lastSeenAt: now,
        lastCheckedAt: now,
        version: newVersion,
      })
      .where(eq(schema.jobs.id, existing.id));
    if (hashChanged) {
      await db.insert(schema.jobVersions).values({
        jobId: existing.id,
        version: newVersion,
        contentHash: enriched.contentHash,
        snapshot: raw.payload as Record<string, unknown>,
      });
    }
    if (wasRemoved) {
      outcome.reactivated++;
      logger.info({ jobId: existing.id }, "job reactivated");
    } else if (hashChanged) {
      outcome.updated++;
    } else {
      outcome.same++;
    }
  }

  // Absence handling — ONLY on a successful listing (provider errors bailed
  // out above). Two-strike: ACTIVE→UNKNOWN, UNKNOWN→REMOVED.
  const absentFilter = and(
    eq(schema.jobs.companyId, companyId),
    eq(schema.jobs.sourceProvider, provider.id),
    seenExternalIds.length > 0 ? notInArray(schema.jobs.externalId, seenExternalIds) : undefined,
  );

  const removedRows = await db
    .update(schema.jobs)
    .set({ status: "REMOVED", lastCheckedAt: now })
    .where(and(absentFilter, eq(schema.jobs.status, "UNKNOWN")))
    .returning({ id: schema.jobs.id });
  outcome.removed = removedRows.length;

  const unknownRows = await db
    .update(schema.jobs)
    .set({ status: "UNKNOWN", lastCheckedAt: now })
    .where(and(absentFilter, eq(schema.jobs.status, "ACTIVE")))
    .returning({ id: schema.jobs.id });
  outcome.unknown = unknownRows.length;

  await db
    .update(schema.companies)
    .set({ lastCheckedAt: now, lastSuccessfulCheckAt: now, consecutiveFailures: 0 })
    .where(eq(schema.companies.id, companyId));

  await finalizeRun(db, runId, outcome);
  return outcome;
}

async function finalizeRun(db: Db, runId: string | null, o: RefreshOutcome): Promise<void> {
  if (!runId) return;
  await db
    .update(schema.refreshRuns)
    .set({
      companiesProcessed: sql`${schema.refreshRuns.companiesProcessed} + 1`,
      jobsNew: sql`${schema.refreshRuns.jobsNew} + ${o.new}`,
      jobsUpdated: sql`${schema.refreshRuns.jobsUpdated} + ${o.updated}`,
      jobsRemoved: sql`${schema.refreshRuns.jobsRemoved} + ${o.removed}`,
      jobsRejectedMarket: sql`${schema.refreshRuns.jobsRejectedMarket} + ${o.rejectedMarket}`,
      errors: sql`${schema.refreshRuns.errors} + ${o.error ? 1 : 0}`,
    })
    .where(eq(schema.refreshRuns.id, runId));
}
