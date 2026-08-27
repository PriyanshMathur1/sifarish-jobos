import { config as loadDotenv } from "dotenv";
loadDotenv({ path: new URL("../../../.env", import.meta.url).pathname });

import { loadConfig, logger, PgBossQueue, QUEUES } from "@jobos/core";
import { registerHandlers } from "./handlers.ts";

/**
 * Long-lived worker (local/VPS mode). The same handlers serve the
 * serverless batch-drain endpoint in Vercel mode (grill G8) — dual-mode
 * by construction: handlers know nothing about how they are invoked.
 */
async function main() {
  const config = loadConfig();
  const queue = new PgBossQueue(config.DATABASE_URL);
  await queue.start();

  await registerHandlers(queue, config);
  await queue.schedule(QUEUES.refreshOrchestrate, config.JOB_REFRESH_SCHEDULE, config.APP_TZ);

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
