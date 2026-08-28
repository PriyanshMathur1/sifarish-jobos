import parser from "cron-parser";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@jobos/db";
import { schema } from "@jobos/db";
import type { Queue } from "../queue/queue.ts";
import { QUEUES } from "../queue/queue.ts";
import { logger } from "../logger.ts";

/**
 * Refresh orchestration (SPEC §4, PRD §26/§144): one orchestrate tick
 * creates a refresh_runs row and fans out one queue job per eligible
 * company (singleton-keyed per run, so a company is never enqueued twice
 * for the same run). Recovery detects a missed schedule slot and triggers
 * at most ONE catch-up run.
 */

export async function orchestrateRefresh(
  db: Db,
  queue: Queue,
  trigger: "cron" | "recovery" | "manual" = "cron",
): Promise<{ runId: string; companies: number }> {
  const [run] = await db
    .insert(schema.refreshRuns)
    .values({ scheduledAt: new Date(), startedAt: new Date(), status: "RUNNING", trigger })
    .returning();

  const eligible = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(eq(schema.companies.status, "ACTIVE"))
    .orderBy(sql`${schema.companies.lastCheckedAt} asc nulls first`);

  for (const c of eligible) {
    await queue.enqueue(
      QUEUES.refreshCompany,
      { companyId: c.id, runId: run!.id },
      { singletonKey: `${c.id}:${run!.id}` },
    );
  }

  logger.info({ runId: run!.id, companies: eligible.length, trigger }, "refresh run fanned out");
  return { runId: run!.id, companies: eligible.length };
}

/** Mark a run completed once its counters stop moving (called after drain / periodically). */
export async function completeRun(db: Db, runId: string): Promise<void> {
  await db
    .update(schema.refreshRuns)
    .set({ status: "COMPLETED", completedAt: new Date() })
    .where(eq(schema.refreshRuns.id, runId));
}

/**
 * Missed-run detection (PRD §144): if the most recent schedule slot has no
 * run at/after it, one recovery run is due. Never more than one — callers
 * enqueue with a singleton key derived from the slot.
 */
export async function findMissedSlot(
  db: Db,
  cronExpr: string,
  tz: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const interval = parser.parseExpression(cronExpr, { currentDate: now, tz });
  const prevSlot = interval.prev().toDate();

  const [existing] = await db
    .select({ id: schema.refreshRuns.id })
    .from(schema.refreshRuns)
    .where(
      and(
        gte(schema.refreshRuns.scheduledAt, prevSlot),
        or(isNull(schema.refreshRuns.status), sql`${schema.refreshRuns.status} <> 'FAILED'`),
      ),
    )
    .limit(1);

  return existing ? null : prevSlot;
}
