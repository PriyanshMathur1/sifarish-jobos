import type { AppConfig } from "./config.ts";
import type { JobHandler, Queue } from "./queue/queue.ts";
import { QUEUES } from "./queue/queue.ts";
import { logger } from "./logger.ts";

export type HandlerMode = "worker" | "drain";

/**
 * Queue handler registry — the one place queue names meet implementations.
 * The SAME handlers serve both invocation modes (grill G8):
 * - "worker": long-lived process, handlers poll (queue.work)
 * - "drain":  serverless cron, handlers attached then drained (queue.register)
 * Handlers MUST be idempotent (PRD §106). Phase 1 wires the real pipeline.
 */
export function registerHandlers(
  queue: Queue,
  _config: AppConfig,
  opts: { mode: HandlerMode },
): void {
  const attach = <T extends object>(name: string, handler: JobHandler<T>): void => {
    if (opts.mode === "worker") {
      void queue.work(name, handler);
    } else {
      queue.register(name, handler);
    }
  };

  attach(QUEUES.refreshOrchestrate, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "refresh orchestrate tick (pipeline arrives in Phase 1)");
  });

  attach(QUEUES.refreshCompany, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "company refresh tick (pipeline arrives in Phase 1)");
  });

  attach(QUEUES.cleanup, async (_payload, ctx) => {
    logger.info({ jobId: ctx.jobId }, "cleanup tick");
  });
}
