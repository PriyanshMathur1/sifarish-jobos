import parser from "cron-parser";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@sifarish/db";
import { schema } from "@sifarish/db";
import type { Queue } from "../queue/queue.ts";
import { QUEUES } from "../queue/queue.ts";
import { logger } from "../logger.ts";

/**
 * Refresh orchestration (SPEC §4, PRD §26/§144): one orchestrate tick
 * creates a refresh_runs row and fans out one queue job per eligible
 * company (singleton-keyed per run). Recovery detects a missed schedule
 * slot and triggers at most ONE catch-up run, recorded as trigger
 * 'recovery' with scheduledAt = the missed slot.
 *
 * Eligibility: ACTIVE companies, minus sources that have failed on 5+
 * consecutive checks within the last 24h (persistent circuit break,
 * PRD §97) — those wait for the cooldown or a manual admin retry.
 */

const BREAK_THRESHOLD = 5;
const BREAK_COOLDOWN_HOURS = 24;

export async function orchestrateRefresh(
  db: Db,
  queue: Queue,
  trigger: "cron" | "recovery" | "manual" = "cron",
  scheduledFor: Date = new Date(),
): Promise<{ runId: string; companies: number }> {
  const eligible = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.status, "ACTIVE"),
        sql`(${schema.companies.consecutiveFailures} < ${BREAK_THRESHOLD}
             or ${schema.companies.lastCheckedAt} < now() - interval '${sql.raw(String(BREAK_COOLDOWN_HOURS))} hours')`,
      ),
    )
    .orderBy(sql`${schema.companies.lastCheckedAt} asc nulls first`);

  const [run] = await db
    .insert(schema.refreshRuns)
    .values({
      scheduledAt: scheduledFor,
      startedAt: new Date(),
      status: "RUNNING",
      trigger,
      companiesTotal: eligible.length,
    })
    .returning();

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

/**
 * Complete every RUNNING run whose fan-out has been fully processed
 * (companiesProcessed >= companiesTotal). Safe to call from any mode —
 * a run still being drained elsewhere is left RUNNING.
 */
export async function completeFinishedRuns(db: Db): Promise<number> {
  const rows = await db
    .update(schema.refreshRuns)
    .set({ status: "COMPLETED", completedAt: new Date() })
    .where(
      and(
        eq(schema.refreshRuns.status, "RUNNING"),
        gte(schema.refreshRuns.companiesProcessed, schema.refreshRuns.companiesTotal),
      ),
    )
    .returning({ id: schema.refreshRuns.id });
  return rows.length;
}

/**
 * Missed-run detection (PRD §144): the most recent schedule slot must have
 * a scheduled run (trigger cron/recovery) recorded at/after it — manual
 * admin refreshes don't count as the schedule having fired.
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
        inArray(schema.refreshRuns.trigger, ["cron", "recovery"]),
      ),
    )
    .limit(1);

  return existing ? null : prevSlot;
}
