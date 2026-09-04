import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import {
  loadConfig,
  logger,
  PgBossQueue,
  QUEUES,
  registerHandlers,
  recoverMissedRun,
} from "@sifarish/core";

/**
 * Long-lived worker (local/VPS mode). The same handlers serve the
 * serverless batch-drain endpoint in Vercel mode (grill G8).
 */
async function main() {
  const config = loadConfig();
  const queue = new PgBossQueue(config.DATABASE_URL);
  await queue.start();

  registerHandlers(queue, config, { mode: "worker" });
  await queue.schedule(QUEUES.refreshOrchestrate, config.JOB_REFRESH_SCHEDULE, config.APP_TZ);
  // Autopilot: tier ticks + alerts/campaigns/reply sync, every 15 minutes.
  await queue.schedule(QUEUES.tierTick, "*/15 * * * *", config.APP_TZ);
  await queue.schedule(QUEUES.autopilotTick, "*/15 * * * *", config.APP_TZ);
  await recoverMissedRun(queue, config); // PRD §144: at most one catch-up run

  logger.info(
    { schedule: config.JOB_REFRESH_SCHEDULE, tz: config.APP_TZ },
    "worker up — refresh scheduled",
  );

  const shutdown = async () => {
    logger.info("worker shutting down");
    await queue.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  logger.error({ err: e }, "worker failed to start");
  process.exit(1);
});
