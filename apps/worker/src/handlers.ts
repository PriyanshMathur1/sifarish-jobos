import type { AppConfig, Queue } from "@jobos/core";
import { logger, QUEUES } from "@jobos/core";

/**
 * Queue handler registry — the one place queue names meet implementations.
 * Phase 1 replaces the placeholder with the real refresh orchestrator.
 * Handlers MUST be idempotent (PRD §106).
 */
export async function registerHandlers(queue: Queue, _config: AppConfig): Promise<void> {
  await queue.work(QUEUES.refreshOrchestrate, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "refresh orchestrate tick (pipeline arrives in Phase 1)");
  });

  await queue.work(QUEUES.cleanup, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "cleanup tick");
  });
}
