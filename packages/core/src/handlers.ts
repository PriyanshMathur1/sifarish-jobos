import { getDb } from "@jobos/db";
import type { AppConfig } from "./config.ts";
import type { JobHandler, Queue } from "./queue/queue.ts";
import { QUEUES } from "./queue/queue.ts";
import { SafeFetcher } from "./fetch/safe-fetcher.ts";
import { refreshCompany } from "./ingestion/ingest.ts";
import { orchestrateRefresh, findMissedSlot } from "./ingestion/orchestrator.ts";
import { logger } from "./logger.ts";

export type HandlerMode = "worker" | "drain";

/**
 * Queue handler registry — the one place queue names meet implementations.
 * The SAME handlers serve both invocation modes (grill G8):
 * - "worker": long-lived process, handlers poll (queue.work)
 * - "drain":  serverless cron, handlers attached then drained (queue.register)
 * Handlers MUST be idempotent (PRD §106) — refreshCompany re-runs are
 * all-SAME, orchestrate fan-out is singleton-keyed per run.
 */
export function registerHandlers(
  queue: Queue,
  config: AppConfig,
  opts: { mode: HandlerMode },
): void {
  const db = getDb();
  const fetcher = new SafeFetcher();

  const attach = <T extends object>(name: string, handler: JobHandler<T>): void => {
    if (opts.mode === "worker") {
      void queue.work(name, handler);
    } else {
      queue.register(name, handler);
    }
  };

  attach(QUEUES.refreshOrchestrate, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "refresh orchestrate tick");
    await orchestrateRefresh(db, queue, "cron");
  });

  attach<{ companyId: string; runId: string | null }>(
    QUEUES.refreshCompany,
    async (payload, ctx) => {
      const outcome = await refreshCompany(
        { db, fetcher, marketCountries: config.MARKET_COUNTRIES },
        payload.companyId,
        payload.runId,
      );
      logger.info(
        { jobId: ctx.jobId, companyId: payload.companyId, ...outcome },
        "company refreshed",
      );
    },
  );

  attach(QUEUES.cleanup, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "cleanup tick");
  });
}

/**
 * Missed-run recovery (PRD §144): call on worker boot or before a cron
 * drain. At most one catch-up run per missed slot (singleton key = slot).
 */
export async function recoverMissedRun(queue: Queue, config: AppConfig): Promise<boolean> {
  const db = getDb();
  const missed = await findMissedSlot(db, config.JOB_REFRESH_SCHEDULE, config.APP_TZ);
  if (!missed) return false;
  logger.warn({ missedSlot: missed.toISOString() }, "missed refresh slot — scheduling recovery");
  await queue.enqueue(
    QUEUES.refreshOrchestrate,
    { recovery: true, slot: missed.toISOString() },
    { singletonKey: `recovery:${missed.toISOString()}` },
  );
  return true;
}
