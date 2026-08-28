import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  loadConfig,
  requestLogger,
  PgBossQueue,
  QUEUES,
  registerHandlers,
  recoverMissedRun,
} from "@jobos/core";
import { completeFinishedRuns } from "@jobos/core/ingestion/orchestrator";
import { getDb } from "@jobos/db";

export const maxDuration = 300;

function secretsMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Serverless-cron entry (grill G8): Vercel cron POSTs here twice daily.
 * Runs the SAME handlers as the long-lived worker, drained in a time-boxed
 * batch: recovery check → orchestrate → company fan-out → run completion.
 */
export async function POST(req: NextRequest) {
  const config = loadConfig();
  const log = requestLogger(req.headers.get("x-request-id") ?? crypto.randomUUID());

  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secretsMatch(token, config.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const queue = new PgBossQueue(config.DATABASE_URL);
  await queue.start();
  try {
    registerHandlers(queue, config, { mode: "drain" });
    const recovered = await recoverMissedRun(queue, config);
    if (!recovered) {
      await queue.enqueue(QUEUES.refreshOrchestrate, {}, { singletonKey: "cron-tick" });
    }
    const orchestrated = await queue.drain(QUEUES.refreshOrchestrate, 2);
    const refreshed = await queue.drain(QUEUES.refreshCompany, 500);

    // Close out only runs whose fan-out fully processed (others keep RUNNING).
    const completed = await completeFinishedRuns(getDb());
    void completed;

    log.info({ orchestrated, refreshed, recovered }, "cron drain complete");
    return NextResponse.json({ ok: true, orchestrated, refreshed, recovered });
  } finally {
    await queue.stop();
  }
}
